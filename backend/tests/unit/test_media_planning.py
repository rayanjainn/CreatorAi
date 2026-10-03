"""Audio chunk planning, asset kind detection and ffmpeg frame helpers."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from PIL import Image

from app.media.audio import cut_chunk, extract_audio, plan_chunks
from app.media.ffmpeg import ffmpeg_available, probe
from app.media.frames import make_keyframe, make_proxy, make_thumb, poster_time
from app.media.kinds import detect_kind, guess_mime, is_text_document, safe_filename


def test_short_audio_is_one_chunk() -> None:
    chunks = plan_chunks(480.0, [(100.0, 101.0)])
    assert [(c.index, c.start, c.end) for c in chunks] == [(0, 0.0, 480.0)]
    assert plan_chunks(600.0, [])[0].end == 600.0


def test_split_at_silence_midpoint_nearest_to_target() -> None:
    silences = [
        (590.0, 592.0),
        (606.0, 608.0),
        (900.0, 901.0),
    ]  # mids 591 (9 s away) and 607 (7 s away)
    chunks = plan_chunks(1000.0, silences)
    assert [(c.start, c.end) for c in chunks] == [(0.0, 607.0), (607.0, 1000.0)]
    assert chunks[1].duration == pytest.approx(393.0)


def test_split_exactly_at_target_without_nearby_silence() -> None:
    chunks = plan_chunks(1300.0, [(100.0, 101.0), (700.0, 701.0)])  # none within +-30 s
    assert [(c.start, c.end) for c in chunks] == [(0.0, 600.0), (600.0, 1200.0), (1200.0, 1300.0)]


def test_silence_outside_window_is_ignored_and_tail_is_not_split() -> None:
    chunks = plan_chunks(600.5 + 0.2, [(640.0, 641.0)])
    assert len(chunks) == 1  # target 600 is within 1 s of the end: no pointless tail chunk
    chunks = plan_chunks(1500.0, [(631.0, 633.0)])  # mid 632 is 32 s from 600: ignored
    assert chunks[0].end == 600.0


def test_chunk_offsets_are_monotonic_for_long_audio() -> None:
    chunks = plan_chunks(3700.0, [(i * 600.0 - 5.0, i * 600.0 - 4.0) for i in range(1, 7)])
    starts = [c.start for c in chunks]
    assert starts == sorted(starts) and chunks[-1].end == 3700.0
    assert all(c.duration > 0 for c in chunks)


def test_detect_kind() -> None:
    assert detect_kind("a.MP4", "application/octet-stream") == "video"
    assert detect_kind("a.png", "") == "image"
    assert detect_kind("voice.m4a", None) == "audio"
    assert detect_kind("noext", "video/mp4") == "video"
    assert detect_kind("notes.md", "text/markdown") == "document"
    assert detect_kind("blob.bin", "application/octet-stream") == "document"
    assert is_text_document("notes.txt") and not is_text_document("a.pdf")
    assert guess_mime("a.mp4", "application/octet-stream") == "video/mp4"
    assert guess_mime("a.bin", "Text/Plain; charset=utf-8") == "text/plain"


def test_safe_filename_strips_directories() -> None:
    assert safe_filename("../../etc/passwd") == "passwd"
    assert safe_filename("C:\\clips\\take 1.mp4") == "take 1.mp4"
    assert safe_filename("   ") == "upload"


def test_poster_time() -> None:
    assert poster_time(30) == 1.0 and poster_time(1.0) == 0.5 and poster_time(None) == 0.0


@pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg required")
def test_proxy_thumb_keyframe_audio_chunk_with_real_ffmpeg(tmp_path: Path) -> None:
    src = tmp_path / "src.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=1280x720:d=4:r=25",
         "-f", "lavfi", "-i", "sine=frequency=330:duration=4", "-c:v", "libx264", "-c:a", "aac",
         "-shortest", str(src)],
        check=True,
    )  # fmt: skip
    proxy, thumb, key, audio, chunk = (
        tmp_path / n for n in ("p.mp4", "t.jpg", "k.jpg", "a.mp3", "c.mp3")
    )
    make_proxy(src, proxy, duration=4.0)
    assert probe(proxy).height == 480
    make_thumb(src, thumb, poster_time(4.0))
    assert Image.open(thumb).size[0] <= 640
    make_keyframe(src, key, 2.0)
    assert max(Image.open(key).size) <= 384  # both sides <= 384 px
    extract_audio(src, audio, duration=4.0)
    assert probe(audio).duration == pytest.approx(4.0, abs=0.2)
    cut_chunk(audio, chunk, 1.0, 3.0)
    assert probe(chunk).duration == pytest.approx(2.0, abs=0.15)
