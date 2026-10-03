from __future__ import annotations

from pathlib import Path

import pytest

from app.media import ffmpeg

pytestmark = pytest.mark.skipif(not ffmpeg.ffmpeg_available(), reason="ffmpeg not installed")


@pytest.fixture(scope="module")
def clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("media") / "tiny.mp4"
    ffmpeg.run(
        ["-f", "lavfi", "-i", "testsrc=size=160x120:rate=15:duration=2",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path],
    )  # fmt: skip
    return path


def test_version_and_availability() -> None:
    assert ffmpeg.ffmpeg_available() and ffmpeg.ffmpeg_version()


def test_probe(clip: Path) -> None:
    info = ffmpeg.probe(clip)
    assert (info.width, info.height) == (160, 120)
    assert info.has_video and info.has_audio
    assert info.duration == pytest.approx(2.0, abs=0.2)
    assert info.fps == pytest.approx(15.0)
    assert info.size_bytes == clip.stat().st_size


def test_run_reports_progress(clip: Path, tmp_path: Path) -> None:
    fractions: list[float] = []
    ffmpeg.run(
        ["-i", clip, "-vf", "scale=80:60", "-c:v", "libx264", tmp_path / "out.mp4"],
        duration=2.0,
        on_progress=fractions.append,
    )
    assert (tmp_path / "out.mp4").stat().st_size > 0
    assert fractions and fractions[-1] == pytest.approx(1.0, abs=0.15)
    assert fractions == sorted(fractions)


def test_failure_raises_with_stderr(tmp_path: Path) -> None:
    with pytest.raises(ffmpeg.FFmpegError) as exc:
        ffmpeg.run(["-i", tmp_path / "missing.mp4", tmp_path / "o.mp4"])
    assert "missing.mp4" in exc.value.stderr
    with pytest.raises(ffmpeg.FFmpegError):
        ffmpeg.probe(tmp_path / "missing.mp4")


def test_timeout_kills_process(tmp_path: Path) -> None:
    with pytest.raises(ffmpeg.FFmpegTimeout):
        ffmpeg.run(
            ["-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=60:duration=600",
             "-c:v", "libx264", "-preset", "veryslow", tmp_path / "slow.mp4"],
            timeout=0.5,
        )  # fmt: skip
