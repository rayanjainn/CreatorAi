"""Proxy video, poster/thumbnail and keyframe generation (Plan.md section 8.1)."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from app.media.ffmpeg import run

# Both sides end up <= 384 px (a Gemini image costs 258 tokens up to 384 px).
KEYFRAME_SCALE = "scale='if(gt(iw,ih),384,-2)':'if(gt(iw,ih),-2,384)'"
THUMB_SCALE = "scale='min(640,iw)':-2"


def make_proxy(
    src: Path,
    dest: Path,
    *,
    preset: str = "veryfast",
    duration: float | None = None,
    on_progress: Callable[[float], None] | None = None,
) -> None:
    """480p H.264 proxy, keyframe every 2 s, faststart (Plan 8.1 proxy command)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            "-i", src, "-vf", "scale=-2:480", "-c:v", "libx264", "-preset", preset, "-crf", "28",
            "-force_key_frames", "expr:gte(t,n_forced*2)", "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart", dest,
        ],
        duration=duration,
        on_progress=on_progress,
    )  # fmt: skip


def poster_time(duration: float | None) -> float:
    """Poster frame at 1 s, or the middle of clips shorter than 2 s."""
    if not duration or duration <= 0:
        return 0.0
    return 1.0 if duration >= 2.0 else duration / 2


def make_thumb(src: Path, dest: Path, at_sec: float = 1.0) -> None:
    """Single JPEG frame (width <= 640) used as the poster / library thumbnail."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    run(
        ["-ss", f"{at_sec:.3f}", "-i", src, "-frames:v", "1", "-vf", THUMB_SCALE, "-q:v", "3", dest]
    )


def make_keyframe(src: Path, dest: Path, at_sec: float) -> None:
    """One frame at ``at_sec`` scaled so both sides are <= 384 px."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    run(["-ss", f"{max(at_sec, 0.0):.3f}", "-i", src, "-frames:v", "1", "-vf", KEYFRAME_SCALE,
         "-q:v", "3", dest])  # fmt: skip
