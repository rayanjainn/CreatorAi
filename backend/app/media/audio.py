"""Audio extraction and ASR chunk planning (Plan.md sections 8.1 and 8.2)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.media.ffmpeg import run

Interval = tuple[float, float]
CHUNK_SEARCH_WINDOW_SEC = 30.0


@dataclass(frozen=True)
class Chunk:
    """One ASR chunk: ``[start, end]`` seconds of the full audio; its offset is ``start``."""

    index: int
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def extract_audio(
    src: Path,
    dest: Path,
    *,
    duration: float | None = None,
    on_progress: Callable[[float], None] | None = None,
) -> None:
    """16 kHz mono MP3 at 48 kbps (a 10-minute chunk is about 3.6 MB, far under Groq's 25 MB)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    run(
        ["-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", dest],
        duration=duration,
        on_progress=on_progress,
    )


def plan_chunks(
    duration: float,
    silences: list[Interval],
    chunk_sec: float = 600.0,
    window: float = CHUNK_SEARCH_WINDOW_SEC,
) -> list[Chunk]:
    """Split ``duration`` into ~``chunk_sec`` chunks, cutting inside silences (Plan 8.2 step 1).

    For each multiple of ``chunk_sec`` the silence whose midpoint is within ``window`` seconds of
    it (nearest wins) supplies the cut point; with no such silence the cut is exactly the target.
    """
    if duration <= chunk_sec or chunk_sec <= 0:
        return [Chunk(0, 0.0, max(duration, 0.0))]
    cuts: list[float] = []
    target = chunk_sec
    while target < duration - 1.0:
        candidates = [
            (abs((s + e) / 2 - target), (s + e) / 2)
            for s, e in silences
            if abs((s + e) / 2 - target) <= window
        ]
        cut = min(candidates)[1] if candidates else target
        previous = cuts[-1] if cuts else 0.0
        if previous + 1.0 < cut < duration - 1.0:
            cuts.append(round(cut, 3))
        target += chunk_sec
    bounds = [0.0, *cuts, duration]
    return [Chunk(i, bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)]


def cut_chunk(src: Path, dest: Path, start: float, end: float) -> None:
    """``ffmpeg -ss a -to b -i full.mp3 -c copy chunk.mp3`` (stream copy, no re-encode)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    run(["-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", src, "-c", "copy", dest])
