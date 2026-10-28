"""ASR chunk fallback/retry, caption helpers, stage plan and hooks (pure logic, no ffmpeg)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.errors import AppError
from app.media.audio import Chunk
from app.ml.asr import ASRError
from app.ml.asr.base import ASRProvider, Segment, Transcript, Word
from app.services import hooks
from app.services.ingest import transcribe as tr
from app.services.ingest.caption import choose_shots, inherit_tags, nearest_line
from app.services.ingest.plan import (
    STAGE_PROGRESS,
    STAGES,
    invalidate_from,
    stage_start,
    stages_for,
)
from app.services.ingest.stages import shot_text


class FakeASR(ASRProvider):
    def __init__(self, name: str, script: list[Any]) -> None:
        self.name = name
        self.script = list(script)
        self.calls: list[tuple[str, float]] = []

    def configured(self) -> bool:
        return True

    @property
    def model(self) -> str:
        return f"{self.name}-model"

    def transcribe(
        self, audio_path: Path, *, language: str | None = None, offset_sec: float = 0.0
    ) -> Transcript:
        self.calls.append((audio_path.name, offset_sec))
        step = self.script.pop(0) if self.script else "ok"
        if isinstance(step, Exception):
            raise step
        words = [Word("hello", 1.0 + offset_sec, 1.5 + offset_sec)]
        segs = [Segment("hello", 1.0 + offset_sec, 1.5 + offset_sec)]
        return Transcript(self.name, self.model, "en", words, segs, 2.0)


CHUNKS = [Chunk(0, 0.0, 600.0), Chunk(1, 600.0, 900.0)]


def files(chunk: Chunk) -> Path:
    return Path(f"chunk_{chunk.index}.mp3")


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    waits: list[float] = []
    monkeypatch.setattr(tr, "_sleep", waits.append)
    return waits


def test_chunk_offsets_rebase_word_times() -> None:
    groq = FakeASR("groq", [])
    result = tr.transcribe_chunks([groq], CHUNKS, files, language=None, max_tries=3)
    assert [w.start for w in result.transcript.words] == [1.0, 601.0]
    assert groq.calls == [("chunk_0.mp3", 0.0), ("chunk_1.mp3", 600.0)]
    assert result.providers == ["groq"] and result.transcript.provider == "groq"


def test_retryable_error_is_retried_with_backoff(no_sleep: list[float]) -> None:
    flaky = ASRError("429", retryable=True)
    groq = FakeASR("groq", [flaky, ASRError("503", retryable=True), "ok"])
    result = tr.transcribe_chunks([groq], CHUNKS[:1], files, language=None, max_tries=3)
    assert len(groq.calls) == 3 and no_sleep == [1.0, 2.0] and result.providers == ["groq"]


def test_retry_after_header_is_honoured(no_sleep: list[float]) -> None:
    groq = FakeASR("groq", [ASRError("429", retryable=True, retry_after=7.0), "ok"])
    tr.transcribe_chunks([groq], CHUNKS[:1], files, language=None, max_tries=3)
    assert no_sleep == [7.0]


def test_falls_back_to_next_provider_after_retries_exhausted() -> None:
    groq = FakeASR("groq", [ASRError("429", retryable=True)] * 3)
    local = FakeASR("faster-whisper", [])
    result = tr.transcribe_chunks([groq, local], CHUNKS, files, language=None, max_tries=3)
    assert len(groq.calls) == 3  # exhausted once, then skipped for the next chunk
    assert len(local.calls) == 2 and result.transcript.provider == "faster-whisper"
    assert result.providers == ["faster-whisper"]


def test_permanent_error_skips_provider_and_mixed_providers_are_reported() -> None:
    groq = FakeASR("groq", ["ok", ASRError("400 bad audio")])
    local = FakeASR("faster-whisper", [])
    result = tr.transcribe_chunks([groq, local], CHUNKS, files, language=None, max_tries=3)
    assert result.providers == ["groq", "faster-whisper"]
    assert result.transcript.provider == "groq+faster-whisper"
    assert result.transcript.model == "groq-model+faster-whisper-model"


def test_all_providers_failing_raises_asr_unavailable_with_hint() -> None:
    bad = FakeASR("groq", [ASRError("boom")])
    with pytest.raises(AppError) as exc:
        tr.transcribe_chunks([bad], CHUNKS[:1], files, language=None, max_tries=3)
    err = exc.value
    assert err.code == "ASR_UNAVAILABLE" and not err.retryable
    assert "GROQ_API_KEY" in err.message and "make models-asr" in err.message
    transient = FakeASR("groq", [ASRError("503", retryable=True)] * 3)
    with pytest.raises(AppError) as exc2:
        tr.transcribe_chunks([transient], CHUNKS[:1], files, language=None, max_tries=3)
    assert exc2.value.retryable  # a transient outage may be retried by the job runner


def test_stage_plan_and_invalidation() -> None:
    assert list(STAGE_PROGRESS) == list(STAGES) and STAGE_PROGRESS["finalize"] == 100
    assert stage_start("probe") == 0 and stage_start("transcribe") == 38
    assert stages_for("video") == list(STAGES)
    assert stages_for("video", has_audio=False) == [
        "probe", "proxy", "shots", "keyframes", "caption", "embed", "finalize",
    ]  # fmt: skip
    assert stages_for("audio") == [
        "probe", "audio", "silence", "transcribe", "segments", "embed", "finalize",
    ]  # fmt: skip
    assert stages_for("image") == ["probe", "keyframes", "caption", "embed", "finalize"]
    assert stages_for("document") == ["probe", "finalize"]
    done = ["probe", "audio", "caption: skipped (llm unavailable)", "embed", "finalize"]
    assert invalidate_from(done, "caption") == ["probe", "audio"]
    assert invalidate_from(done, "embed") == [
        "probe",
        "audio",
        "caption: skipped (llm unavailable)",
    ]


def shot(idx: int, start: float, end: float, kf: bool = True) -> Any:
    return SimpleNamespace(
        idx=idx, start_sec=start, end_sec=end, keyframe_key=f"k{idx}" if kf else None
    )


def test_choose_shots_caps_at_12_evenly_and_needs_keyframes() -> None:
    shots = [shot(i, i, i + 1) for i in range(40)]
    picked = choose_shots(shots)
    assert len(picked) == 12 and picked[0].idx == 0 and picked[-1].idx == 39
    assert choose_shots([shot(0, 0, 1, kf=False)]) == []


def test_inherit_tags_from_nearest_captioned_shot() -> None:
    shots = [shot(i, i * 10, i * 10 + 10) for i in range(6)]
    out = inherit_tags(shots, {1: ["a"], 4: ["b"]})
    assert out[0] == ["a"] and out[2] == ["a"] and out[3] == ["b"] and out[5] == ["b"]
    assert out[1] == ["a"] and out[4] == ["b"] and inherit_tags(shots, {}) == {}


def test_nearest_line_prefers_covering_segment() -> None:
    segs = [
        SimpleNamespace(start_sec=0.0, end_sec=5.0, text="first"),
        SimpleNamespace(start_sec=8.0, end_sec=12.0, text="second " * 100),
    ]
    assert nearest_line(segs, 3.0) == "first"
    far = nearest_line(segs, 7.0)  # between the two: the closer one wins, text is trimmed
    assert far.startswith("second") and len(far) <= 240
    assert nearest_line([], 1.0) == ""


def test_shot_text_combines_caption_and_tags() -> None:
    assert shot_text("A desk", ["desk", "mic"]) == "A desk. desk, mic"
    assert shot_text("", ["desk"]) == "desk" and shot_text("", []) == ""


def test_after_ready_hooks_run_and_failures_are_isolated(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []

    def good(ws: str, asset: str) -> None:
        calls.append((ws, asset))

    def bad(ws: str, asset: str) -> None:
        raise RuntimeError("hook exploded")

    monkeypatch.setattr(hooks, "_AFTER_READY", [bad, good])
    hooks.run_after_asset_ready("w1", "a1")
    assert calls == [("w1", "a1")]


def test_a_retry_only_transcribes_the_chunks_that_failed(tmp_path: Path) -> None:
    chunks = [Chunk(0, 0.0, 600.0), Chunk(1, 600.0, 1200.0), Chunk(2, 1200.0, 1500.0)]
    store = tr.ChunkStore(tmp_path / "asr_chunks", "audio.mp3|1500|auto|plan-a")
    first = FakeASR("groq", ["ok", "ok", ASRError("boom")])
    with pytest.raises(AppError):
        tr.transcribe_chunks([first], chunks, files, language=None, max_tries=1, store=store)
    assert len(first.calls) == 3
    again = FakeASR("groq", [])
    result = tr.transcribe_chunks([again], chunks, files, language=None, max_tries=1, store=store)
    assert again.calls == [("chunk_2.mp3", 1200.0)]  # chunks 0 and 1 came from the checkpoint
    assert [w.start for w in result.transcript.words] == [1.0, 601.0, 1201.0]
    assert result.providers == ["groq"]
    # a different plan (other audio, boundaries or language) ignores the old checkpoints
    other = FakeASR("groq", [])
    stale = tr.ChunkStore(tmp_path / "asr_chunks", "audio.mp3|1500|en|plan-a")
    tr.transcribe_chunks([other], chunks, files, language="en", max_tries=1, store=stale)
    assert len(other.calls) == 3
    stale.clear()
    assert not list((tmp_path / "asr_chunks").glob("chunk_*.json"))
