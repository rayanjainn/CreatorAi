"""Thin ffmpeg/ffprobe wrapper: availability check, ``run`` with progress, and ``probe``."""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings


class FFmpegError(RuntimeError):
    """ffmpeg/ffprobe failed; ``stderr`` holds the tail of its log."""

    def __init__(self, message: str, stderr: str = "") -> None:
        super().__init__(message)
        self.stderr = stderr


class FFmpegTimeout(FFmpegError):
    pass


class FFmpegCanceled(FFmpegError):
    """``should_cancel`` returned true: the ffmpeg process was killed."""


def ffmpeg_available() -> bool:
    settings = get_settings()
    return (
        shutil.which(settings.ffmpeg_bin) is not None
        and shutil.which(settings.ffprobe_bin) is not None
    )


def ffmpeg_version() -> str | None:
    """First line of ``ffmpeg -version`` (e.g. ``ffmpeg version 6.1``) or ``None`` if missing."""
    if not ffmpeg_available():
        return None
    out = subprocess.run(
        [get_settings().ffmpeg_bin, "-version"],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    first = out.stdout.splitlines()[0] if out.stdout else ""
    parts = first.split()
    return parts[2] if len(parts) > 2 else first or None


@dataclass(frozen=True)
class RunResult:
    returncode: int
    stderr: str


def run(
    args: Sequence[str | Path],
    *,
    timeout: float = 600.0,
    duration: float | None = None,
    on_progress: Callable[[float], None] | None = None,
    cwd: Path | None = None,
    check: bool = True,
    should_cancel: Callable[[], bool] | None = None,
) -> RunResult:
    """Run ffmpeg with ``args`` (without the binary name).

    When ``duration`` and ``on_progress`` are given, ``-progress pipe:1`` is parsed and the
    callback receives a 0-1 fraction. ``should_cancel`` is polled while ffmpeg runs; when it
    returns true the process is killed and :class:`FFmpegCanceled` is raised. Raises
    :class:`FFmpegTimeout` / :class:`FFmpegError`.
    """
    cmd = [get_settings().ffmpeg_bin, "-hide_banner", "-nostdin", "-y"]
    if on_progress and duration:
        cmd += ["-progress", "pipe:1", "-nostats"]
    cmd += [str(a) for a in args]
    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=cwd, bufsize=1
        )
    except FileNotFoundError as exc:
        raise FFmpegError("ffmpeg is not installed or not on PATH") from exc

    stderr_lines: list[str] = []

    def drain_stderr() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            stderr_lines.append(line)
            del stderr_lines[:-200]

    def read_progress() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            key, _, value = line.strip().partition("=")
            if key in ("out_time_us", "out_time_ms") and on_progress and duration:
                try:
                    seconds = int(value) / 1_000_000
                except ValueError:
                    continue
                on_progress(max(0.0, min(1.0, seconds / duration)))

    threads = [threading.Thread(target=drain_stderr, daemon=True)]
    threads.append(threading.Thread(target=read_progress, daemon=True))
    for t in threads:
        t.start()
    deadline = time.monotonic() + timeout
    canceled = False
    try:
        while True:
            try:
                proc.wait(timeout=0.2 if should_cancel else timeout)
                break
            except subprocess.TimeoutExpired as exc:
                if should_cancel and should_cancel():
                    proc.kill()
                    proc.wait()
                    canceled = True
                    break
                if time.monotonic() >= deadline:
                    proc.kill()
                    proc.wait()
                    raise FFmpegTimeout(
                        f"ffmpeg timed out after {timeout:g}s", "".join(stderr_lines)
                    ) from exc
    finally:
        for t in threads:
            t.join(timeout=2)
    if canceled:
        raise FFmpegCanceled("ffmpeg was canceled", "".join(stderr_lines)[-2000:])
    stderr = "".join(stderr_lines)
    if check and proc.returncode != 0:
        raise FFmpegError(f"ffmpeg exited with code {proc.returncode}", stderr[-2000:])
    return RunResult(proc.returncode, stderr)


@dataclass(frozen=True)
class ProbeResult:
    duration: float
    width: int | None
    height: int | None
    fps: float | None
    has_video: bool
    has_audio: bool
    format_name: str
    size_bytes: int


def _parse_rate(rate: str | None) -> float | None:
    if not rate or "/" not in rate:
        return None
    num, _, den = rate.partition("/")
    try:
        return round(float(num) / float(den), 3) if float(den) else None
    except ValueError:
        return None


def probe(path: Path | str) -> ProbeResult:
    """ffprobe a media file (Plan.md section 8.1 probe stage)."""
    cmd = [
        get_settings().ffprobe_bin, "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]  # fmt: skip
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=False)
    except FileNotFoundError as exc:
        raise FFmpegError("ffprobe is not installed or not on PATH") from exc
    if out.returncode != 0:
        raise FFmpegError("ffprobe could not read the file", out.stderr[-2000:])
    data = json.loads(out.stdout or "{}")
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    fmt = data.get("format", {})
    duration = float(fmt.get("duration") or (video or {}).get("duration") or 0.0)
    return ProbeResult(
        duration=duration,
        width=video.get("width") if video else None,
        height=video.get("height") if video else None,
        fps=_parse_rate(video.get("avg_frame_rate")) if video else None,
        has_video=video is not None,
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
        format_name=str(fmt.get("format_name", "")),
        size_bytes=int(fmt.get("size") or 0),
    )
