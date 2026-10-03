"""Deterministic ``asset.process`` stages (Plan.md section 8.1) except transcribe and caption."""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import session_scope
from app.errors import AppError
from app.media.audio import extract_audio
from app.media.ffmpeg import FFmpegError, probe
from app.media.frames import make_keyframe, make_proxy, make_thumb, poster_time
from app.media.kinds import is_text_document
from app.ml.embedder import embed_texts, embedder_info, embedder_provenance
from app.ml.energy import energy_envelope
from app.ml.segments import segments_from_words
from app.ml.shots import detect_shots, select_evenly
from app.ml.silence import detect_silences, total_silence
from app.ml.vectors import pack_vector
from app.models import Asset, AssetShot, utcnow
from app.repositories.assets import SegmentRepository, ShotRepository
from app.schemas.common import Provenance
from app.services import hooks, search_service
from app.services.assets import analysis_of, update_analysis
from app.services.ingest.run import Run, set_provenance

log = logging.getLogger(__name__)
MAX_DOC_CHARS = 200_000
IMAGE_THUMB = "thumb.jpg"


def media_failed(stage: str, exc: FFmpegError) -> AppError:
    tail = (exc.stderr or "").strip().splitlines()[-1:] or [""]
    return AppError(
        "MEDIA_FAILED",
        f"ffmpeg failed during {stage}: {exc} {tail[0]}".strip(),
        details={"stage": stage, "stderr": (exc.stderr or "")[-500:]},
    )


# ── probe ─────────────────────────────────────────────────────────────────────────────────────
def stage_probe(run: Run) -> None:
    asset = run.snapshot()
    if asset.kind == "document":
        text: str | None = None
        if is_text_document(asset.filename, asset.mime):
            raw = run.original_path().read_bytes()[: MAX_DOC_CHARS * 4]
            text = raw.decode("utf-8", errors="replace")[:MAX_DOC_CHARS]

        def doc(_: Session, a: Asset) -> None:
            if text is not None:
                update_analysis(a, text=text, text_chars=len(text))
            else:
                update_analysis(a, stored_only=True)

        run.commit("probe", doc)
        return
    try:
        info = probe(run.original_path())
    except FFmpegError as exc:
        raise AppError(
            "MEDIA_FAILED",
            f"Could not read this file as {asset.kind}: it may be corrupt or unsupported",
            details={"stage": "probe", "stderr": (exc.stderr or "")[-500:]},
        ) from exc
    kind = asset.kind
    if kind == "video" and not info.has_video:
        kind = "audio"
    if kind == "audio" and not info.has_audio:
        raise AppError("MEDIA_FAILED", "No audio or video stream found in this file")
    if kind in ("image", "video") and not info.has_video:
        raise AppError("MEDIA_FAILED", f"No picture found in this {kind} file")

    def apply(_: Session, a: Asset) -> None:
        a.kind = kind
        a.duration_sec = round(info.duration, 3) if kind in ("video", "audio") else None
        a.width = info.width if kind in ("video", "image") else None
        a.height = info.height if kind in ("video", "image") else None
        a.fps = info.fps if kind == "video" else None
        update_analysis(
            a,
            probe={
                "has_audio": info.has_audio,
                "has_video": info.has_video,
                "format": info.format_name,
            },
        )

    run.commit("probe", apply)


# ── audio / proxy / silence ───────────────────────────────────────────────────────────────────
def stage_audio(run: Run) -> None:
    asset = run.snapshot()
    key = run.key("audio/full.mp3")
    try:
        extract_audio(
            run.original_path(),
            run.path(key),
            duration=asset.duration_sec,
            on_progress=run.progress_callback(),
        )
    except FFmpegError as exc:
        raise media_failed("audio", exc) from exc

    def apply(_: Session, a: Asset) -> None:
        a.audio_key = key

    run.commit("audio", apply)


def stage_proxy(run: Run) -> None:
    asset = run.snapshot()
    proxy, thumb = run.key("proxy.mp4"), run.key(IMAGE_THUMB)
    try:
        make_proxy(
            run.original_path(),
            run.path(proxy),
            preset=get_settings().render_x264_preset,
            duration=asset.duration_sec,
            on_progress=run.progress_callback(),
        )
        make_thumb(run.original_path(), run.path(thumb), poster_time(asset.duration_sec))
    except FFmpegError as exc:
        raise media_failed("proxy", exc) from exc

    def apply(_: Session, a: Asset) -> None:
        a.proxy_key, a.thumb_key = proxy, thumb

    run.commit("proxy", apply)


def stage_silence(run: Run) -> None:
    asset = run.snapshot()
    if not asset.audio_key:
        raise AppError("MEDIA_FAILED", "Audio track was not extracted")
    audio = run.path(asset.audio_key)
    try:
        energy = energy_envelope(audio)
        run.check_cancel()
        silences = detect_silences(audio, duration=asset.duration_sec)
    except FFmpegError as exc:
        raise media_failed("silence", exc) from exc

    def apply(_: Session, a: Asset) -> None:
        update_analysis(
            a,
            silences=[[s, e] for s, e in silences],
            energy=energy,
            silence_total_sec=total_silence(silences),
        )

    run.commit("silence", apply)


# ── segments ──────────────────────────────────────────────────────────────────────────────────
def load_transcript(run: Run) -> dict[str, Any]:
    key = run.key("transcript.json")
    if not run.storage.exists(key):
        raise AppError("MEDIA_FAILED", "Transcript file is missing; re-run from transcription")
    with run.storage.open(key) as fh:
        data: dict[str, Any] = json.load(fh)
    return data


def stage_segments(run: Run) -> None:
    transcript = load_transcript(run)
    segments = segments_from_words(transcript.get("words") or [])
    rows = [
        {
            "idx": s["idx"],
            "start_sec": s["start"],
            "end_sec": s["end"],
            "text": s["text"],
            "words": s["words"],
        }
        for s in segments
    ]

    def apply(db: Session, a: Asset) -> None:
        SegmentRepository(db).replace(a.workspace_id, a.id, rows)
        update_analysis(a, segment_count=len(rows))

    run.commit("segments", apply)


# ── shots / keyframes ─────────────────────────────────────────────────────────────────────────
def stage_shots(run: Run) -> None:
    asset = run.snapshot()
    source = run.path(asset.proxy_key) if asset.proxy_key else run.original_path()
    duration = asset.duration_sec or 0.0
    shots, method = detect_shots(source, duration)
    run.check_cancel()
    rows = [{"idx": i, "start_sec": s, "end_sec": e} for i, (s, e) in enumerate(shots)]

    def apply(db: Session, a: Asset) -> None:
        ShotRepository(db).replace(a.workspace_id, a.id, rows)
        update_analysis(a, shots={"method": method, "count": len(rows)}, captioned_shots=[])
        set_provenance(
            a,
            "shots",
            Provenance.heuristic(
                "scenedetect" if method == "scenedetect" else "fixed-20s"
            ).model_dump(),
        )

    run.commit("shots", apply)


def stage_keyframes(run: Run) -> None:
    asset = run.snapshot()
    if asset.kind == "image":
        _image_keyframe(run, asset)
        return
    with_db = [(s.idx, s.start_sec, s.end_sec) for s in _shot_rows(run)]
    chosen = select_evenly(len(with_db), get_settings().keyframe_extract_max)
    keys: dict[int, str] = {}
    source = run.original_path()
    for n, pos in enumerate(chosen):
        run.check_cancel()
        idx, start, end = with_db[pos]
        key = run.key(f"keyframes/shot_{idx:03d}.jpg")
        try:
            make_keyframe(source, run.path(key), (start + end) / 2)
            keys[idx] = key
        except FFmpegError as exc:  # one unreadable frame must not fail the asset
            log.warning("keyframe for shot %s of %s failed: %s", idx, asset.id, exc)
        run.fraction((n + 1) / max(1, len(chosen)))

    def apply(db: Session, a: Asset) -> None:
        for shot in ShotRepository(db).for_asset(a.workspace_id, a.id):
            shot.keyframe_key = keys.get(shot.idx)
        update_analysis(a, keyframes=len(keys))

    run.commit("keyframes", apply)


def _shot_rows(run: Run) -> list[AssetShot]:
    with session_scope() as db:
        rows = ShotRepository(db).for_asset(run.workspace_id, run.asset_id)
        for row in rows:
            db.expunge(row)
        return rows


def _image_keyframe(run: Run, asset: Asset) -> None:
    thumb, key = run.key(IMAGE_THUMB), run.key("keyframes/shot_000.jpg")
    try:
        make_thumb(run.original_path(), run.path(thumb), 0.0)
        make_keyframe(run.original_path(), run.path(key), 0.0)
    except FFmpegError as exc:
        raise media_failed("keyframes", exc) from exc

    def apply(db: Session, a: Asset) -> None:
        a.thumb_key = thumb
        ShotRepository(db).replace(
            a.workspace_id,
            a.id,
            [{"idx": 0, "start_sec": 0.0, "end_sec": 0.0, "keyframe_key": key}],
        )
        update_analysis(a, keyframes=1, captioned_shots=[])

    run.commit("keyframes", apply)


# ── embed ─────────────────────────────────────────────────────────────────────────────────────
def shot_text(caption: str, tags: list[str]) -> str:
    """Text embedded for a shot: ``caption + ". " + tags`` (Plan.md 8.1)."""
    return f"{caption.strip()}. {', '.join(tags)}".strip(". ").strip() if (caption or tags) else ""


def embedder_is_stale(analysis: dict[str, Any]) -> bool:
    """True when stored vectors came from another embedding backend/model than the active one."""
    stored = analysis.get("embedder") or {}
    if not stored:
        return False
    info = embedder_info()
    return stored.get("backend") != info["backend"] or stored.get("model") != info["model"]


def stage_embed(run: Run) -> None:
    with session_scope() as db:
        segs = [
            (s.id, s.text) for s in SegmentRepository(db).for_asset(run.workspace_id, run.asset_id)
        ]
        shots = [
            (s.id, shot_text(s.caption, list(s.tags or [])))
            for s in ShotRepository(db).for_asset(run.workspace_id, run.asset_id)
        ]
    shot_items = [(i, t) for i, t in shots if t]
    vectors = embed_texts([t for _, t in segs] + [t for _, t in shot_items])
    run.check_cancel()
    info = embedder_info()

    def apply(db: Session, a: Asset) -> None:
        by_id: dict[str, bytes] = {}
        for (row_id, _), vec in zip(segs + shot_items, vectors, strict=True):
            by_id[row_id] = pack_vector(vec)
        for seg in SegmentRepository(db).for_asset(a.workspace_id, a.id):
            seg.embedding = by_id.get(seg.id)
        for shot in ShotRepository(db).for_asset(a.workspace_id, a.id):
            shot.embedding = by_id.get(shot.id)
        update_analysis(
            a,
            embedder={
                "backend": info["backend"],
                "model": info["model"],
                "dim": info["dim"],
                "real": info["real"],
                "embedded_at": utcnow(),
                "segments": len(segs),
                "shots": len(shot_items),
            },
        )
        set_provenance(a, "embed", embedder_provenance().model_dump())

    run.commit("embed", apply)


# ── finalize ──────────────────────────────────────────────────────────────────────────────────
def stage_finalize(run: Run) -> None:
    def apply(_: Session, a: Asset) -> None:
        a.status = "ready"
        a.error = None
        data = analysis_of(a)
        data.pop("failed_stage", None)
        data.pop("error_code", None)
        data["processed_at"] = utcnow()
        a.analysis = data

    run.commit("finalize", apply)
    search_service.invalidate(run.workspace_id)
    if not run.job.payload.get("skip_hooks"):
        hooks.run_after_asset_ready(run.workspace_id, run.asset_id)
