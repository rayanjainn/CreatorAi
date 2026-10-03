"""Silence detection (Plan.md section 8.1, silence + energy stage).

``detect_silences`` runs ffmpeg ``silencedetect`` and parses its stderr; the parser and the
interval merge are pure functions so they are unit-tested without ffmpeg.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from app.config import get_settings
from app.media.ffmpeg import FFmpegError

Interval = tuple[float, float]

_START_RE = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_END_RE = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")


def parse_silencedetect(stderr: str, duration: float | None = None) -> list[Interval]:
    """Parse ``silence_start`` / ``silence_end`` lines into ``[(start, end), ...]`` seconds.

    A ``silence_start`` without a matching end (the file ends while silent) is closed at
    ``duration`` when known, otherwise it is dropped. Negative starts are clamped to 0.
    """
    out: list[Interval] = []
    open_start: float | None = None
    for line in stderr.splitlines():
        start = _START_RE.search(line)
        if start:
            open_start = max(0.0, float(start.group(1)))
            continue
        end = _END_RE.search(line)
        if end and open_start is not None:
            stop = float(end.group(1))
            if stop > open_start:
                out.append((round(open_start, 3), round(stop, 3)))
            open_start = None
    if open_start is not None and duration is not None and duration > open_start:
        out.append((round(open_start, 3), round(duration, 3)))
    return out


def merge_silences(intervals: list[Interval], gap: float = 0.05) -> list[Interval]:
    """Sort and merge intervals that overlap or are separated by at most ``gap`` seconds."""
    merged: list[list[float]] = []
    for start, end in sorted(i for i in intervals if i[1] > i[0]):
        if merged and start <= merged[-1][1] + gap:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(round(s, 3), round(e, 3)) for s, e in merged]


def detect_silences(
    audio_path: Path,
    *,
    duration: float | None = None,
    noise_db: float | None = None,
    min_sec: float | None = None,
    timeout: float = 900.0,
) -> list[Interval]:
    """Silent stretches of ``audio_path`` (defaults: ``SILENCE_NOISE_DB`` / ``SILENCE_MIN_SEC``)."""
    settings = get_settings()
    noise = settings.silence_noise_db if noise_db is None else noise_db
    min_len = settings.silence_min_sec if min_sec is None else min_sec
    cmd = [
        settings.ffmpeg_bin, "-hide_banner", "-nostdin", "-i", str(audio_path),
        "-af", f"silencedetect=noise={noise:g}dB:d={min_len:g}", "-f", "null", "-",
    ]  # fmt: skip
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise FFmpegError("ffmpeg is not installed or not on PATH") from exc
    if proc.returncode != 0:
        raise FFmpegError("silencedetect failed", proc.stderr[-2000:])
    return merge_silences(parse_silencedetect(proc.stderr, duration))


def total_silence(intervals: list[Interval]) -> float:
    return round(sum(e - s for s, e in intervals), 3)
