"""Loudness envelope: RMS in dB per 0.5 s window from 16 kHz mono PCM (Plan.md section 8.1)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from app.config import get_settings
from app.media.ffmpeg import FFmpegError

SAMPLE_RATE = 16_000
WINDOW_SEC = 0.5
FLOOR_DB = -90.0


def decode_pcm(path: Path, timeout: float = 900.0) -> NDArray[np.float32]:
    """Decode any audio/video file to mono 16 kHz float32 samples in [-1, 1] via ffmpeg."""
    cmd = [
        get_settings().ffmpeg_bin, "-hide_banner", "-nostdin", "-v", "error", "-i", str(path),
        "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-",
    ]  # fmt: skip
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise FFmpegError("ffmpeg is not installed or not on PATH") from exc
    if proc.returncode != 0:
        raise FFmpegError("could not decode audio", proc.stderr.decode(errors="replace")[-2000:])
    return np.frombuffer(proc.stdout, dtype="<f4").astype(np.float32, copy=False)


def rms_db(
    samples: NDArray[np.floating],
    sample_rate: int = SAMPLE_RATE,
    window_sec: float = WINDOW_SEC,
) -> list[float]:
    """RMS level in dBFS for each ``window_sec`` window (the last partial window is included).

    Digital silence maps to ``FLOOR_DB`` (-90) instead of ``-inf`` so the result is JSON-safe.
    """
    win = max(1, round(sample_rate * window_sec))
    data = np.asarray(samples, dtype=np.float64)
    if data.size == 0:
        return []
    pad = (-data.size) % win
    frames = np.concatenate([data, np.zeros(pad)]) if pad else data
    frames = frames.reshape(-1, win)
    counts = np.full(frames.shape[0], win, dtype=np.float64)
    if pad:
        counts[-1] = win - pad
    rms = np.sqrt((frames**2).sum(axis=1) / counts)
    with np.errstate(divide="ignore"):
        db = 20.0 * np.log10(rms)
    db = np.where(np.isfinite(db), db, FLOOR_DB)
    return [round(float(max(FLOOR_DB, v)), 1) for v in db]


def energy_envelope(path: Path) -> list[float]:
    """Decode ``path`` and return the 0.5 s RMS dB envelope."""
    return rms_db(decode_pcm(path))
