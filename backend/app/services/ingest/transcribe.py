"""Transcribe stage (Plan.md section 8.2 + LOCAL_FIRST): sidecar, then ASR chain, never invented.

Order: (1) a sidecar transcript attached to the asset (provenance ``user``, or ``demo`` when the
file declares it); (2) ``get_asr_chain()`` (Groq Whisper, then local faster-whisper) over ~10 minute
chunks cut at silences, with per-chunk retries and per-chunk fallback to the next provider;
(3) otherwise the stage fails with ``ASR_UNAVAILABLE`` and an actionable message.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import session_scope
from app.errors import AppError
from app.media.audio import Chunk, cut_chunk, plan_chunks
from app.media.ffmpeg import FFmpegError
from app.ml.asr import ASRError, ASRProvider, get_asr_chain
from app.ml.asr.base import Segment, Transcript, Word
from app.ml.transcripts import parse_sidecar, transcript_to_json
from app.models import Asset, CreatorProfile
from app.schemas.common import Provenance
from app.services.assets import update_analysis
from app.services.ingest.run import Run, set_provenance

log = logging.getLogger(__name__)
_sleep: Callable[[float], None] = time.sleep  # tests replace this
MAX_BACKOFF_SEC = 30.0
ASR_HELP = (
    "Set GROQ_API_KEY (Groq Whisper, free tier), or run `make models-asr` once while online to "
    "install local Whisper, or attach a transcript (.words.json, .srt or .vtt) to this asset."
)


@dataclass
class ChunkedResult:
    transcript: Transcript
    providers: list[str] = field(default_factory=list)
    chunks: int = 1


def asr_unavailable(message: str, *, retryable: bool = False, **details: object) -> AppError:
    return AppError(
        "ASR_UNAVAILABLE",
        f"{message} {ASR_HELP}",
        details={"hint": ASR_HELP, **details},
        retryable=retryable,
    )


def transcribe_chunks(
    chain: list[ASRProvider],
    chunks: list[Chunk],
    chunk_file: Callable[[Chunk], Path],
    *,
    language: str | None,
    max_tries: int,
    on_chunk: Callable[[int, int], None] | None = None,
) -> ChunkedResult:
    """Transcribe ``chunks`` sequentially (Groq allows ~20 requests/minute).

    Per chunk, each provider gets ``max_tries`` attempts when its error is retryable (429/5xx or a
    network error; waits follow ``retry_after`` or 1 s, 2 s, 4 s...). A provider that fails
    permanently, or exhausts its retries, is skipped for the rest of the asset and the chunk falls
    through to the next provider. Word and segment times are re-based by each chunk's start.
    """
    dead: set[str] = set()
    errors: list[str] = []
    retryable_seen = False
    merged_words: list[Word] = []
    merged_segments: list[Segment] = []
    used: list[str] = []
    language_out: str | None = None
    estimated = False
    models: dict[str, str] = {}
    for position, chunk in enumerate(chunks):
        result: Transcript | None = None
        for provider in chain:
            if provider.name in dead:
                continue
            for attempt in range(max_tries):
                try:
                    result = provider.transcribe(
                        chunk_file(chunk),
                        language=language,
                        offset_sec=chunk.start,
                    )
                    break
                except ASRError as exc:
                    errors.append(f"{provider.name}: {exc}")
                    retryable_seen = retryable_seen or exc.retryable
                    if not exc.retryable or attempt == max_tries - 1:
                        dead.add(provider.name)
                        break
                    _sleep(min(exc.retry_after or 2.0**attempt, MAX_BACKOFF_SEC))
            if result is not None:
                if provider.name not in used:
                    used.append(provider.name)
                    models[provider.name] = provider.model
                break
        if result is None:
            raise asr_unavailable(
                "Every transcription provider failed: " + "; ".join(errors[-4:]) + ".",
                retryable=retryable_seen,
                errors=errors[-10:],
            )
        merged_words += result.words
        merged_segments += result.segments
        language_out = language_out or result.language
        estimated = estimated or result.words_estimated
        if on_chunk:
            on_chunk(position + 1, len(chunks))
    end = chunks[-1].end if chunks else 0.0
    provider_name = "+".join(used)
    transcript = Transcript(
        provider=provider_name,
        model="+".join(models[p] for p in used),
        language=language_out,
        words=sorted(merged_words, key=lambda w: (w.start, w.end)),
        segments=sorted(merged_segments, key=lambda s: s.start),
        duration=end,
        words_estimated=estimated,
    )
    return ChunkedResult(transcript, used, len(chunks))


def _profile_language(workspace_id: str) -> str | None:
    with session_scope() as db:
        profile = db.get(CreatorProfile, workspace_id)
        language = (profile.language if profile else "") or ""
    return None if language in ("", "auto") else language


def stage_transcribe(run: Run) -> None:
    asset = run.snapshot()
    sidecar = (asset.analysis or {}).get("sidecar")
    if sidecar and run.storage.exists(sidecar["key"]):
        _from_sidecar(run, sidecar)
        return
    _from_asr(run, asset)


def _from_sidecar(run: Run, sidecar: dict[str, str]) -> None:
    text = run.path(sidecar["key"]).read_text(encoding="utf-8", errors="replace")
    parsed = parse_sidecar(text, sidecar.get("format"), sidecar.get("filename"))  # type: ignore[arg-type]
    source = "demo" if sidecar.get("source") == "demo" else "user"
    provenance = Provenance(source=source, provider="sidecar", model=parsed.format)  # type: ignore[arg-type]
    _store(run, parsed.transcript, "sidecar", provenance, providers=["sidecar"], chunks=1)


def _from_asr(run: Run, asset: Asset) -> None:
    chain = get_asr_chain()
    if not chain:
        raise asr_unavailable("No transcription source is available for this audio.")
    if not asset.audio_key:
        raise AppError("MEDIA_FAILED", "Audio track was not extracted")
    settings = get_settings()
    full = run.path(asset.audio_key)
    duration = asset.duration_sec or 0.0
    silences = [(float(s), float(e)) for s, e in (asset.analysis or {}).get("silences", [])]
    chunks = plan_chunks(duration, silences, settings.asr_chunk_sec)

    def chunk_file(chunk: Chunk) -> Path:
        if len(chunks) == 1:
            return full
        dest = run.path(run.key(f"audio/chunk_{chunk.index:03d}.mp3"))
        try:
            cut_chunk(full, dest, chunk.start, chunk.end)
        except FFmpegError as exc:
            raise AppError(
                "MEDIA_FAILED", f"Could not cut audio chunk {chunk.index}: {exc}"
            ) from exc
        return dest

    def on_chunk(done: int, total: int) -> None:
        run.fraction(done / total)

    result = transcribe_chunks(
        chain,
        chunks,
        chunk_file,
        language=_profile_language(run.workspace_id),
        max_tries=max(1, settings.asr_max_tries),
        on_chunk=on_chunk,
    )
    provenance = Provenance(
        source="ai", provider=result.transcript.provider, model=result.transcript.model
    )
    _store(run, result.transcript, "asr", provenance, result.providers, result.chunks)


def _store(
    run: Run,
    transcript: Transcript,
    source: str,
    provenance: Provenance,
    providers: list[str],
    chunks: int,
) -> None:
    payload = transcript_to_json(transcript, source=source, provenance=provenance.model_dump())
    path = run.path(run.key("transcript.json"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    no_speech = not transcript.words

    def apply(_: Session, a: Asset) -> None:
        update_analysis(
            a,
            asr={
                "source": source,
                "provider": transcript.provider,
                "model": transcript.model,
                "language": transcript.language,
                "providers": providers,
                "chunks": chunks,
                "words": len(transcript.words),
                "words_estimated": transcript.words_estimated,
                "no_speech": no_speech,
            },
        )
        set_provenance(a, "transcribe", provenance.model_dump())

    run.commit("transcribe", apply)
