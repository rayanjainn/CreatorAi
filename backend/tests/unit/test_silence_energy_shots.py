"""Silence parsing/merge, RMS energy and shot helpers (pure logic plus a tiny ffmpeg run)."""

from __future__ import annotations

import subprocess
from itertools import pairwise

import numpy as np
import pytest

from app.media.ffmpeg import ffmpeg_available
from app.ml.energy import FLOOR_DB, decode_pcm, rms_db
from app.ml.shots import fixed_shots, nearest_index, normalize_shots, select_evenly
from app.ml.silence import detect_silences, merge_silences, parse_silencedetect, total_silence

STDERR = """
[silencedetect @ 0x1] silence_start: 1.5
[silencedetect @ 0x1] silence_end: 2.75 | silence_duration: 1.25
[silencedetect @ 0x1] silence_start: -0.02
[silencedetect @ 0x1] silence_end: 0.7 | silence_duration: 0.72
size=N/A time=00:00:09.00 bitrate=N/A speed= 500x
"""


def test_parse_silencedetect_pairs_and_clamps_negative_start() -> None:
    assert parse_silencedetect(STDERR) == [(1.5, 2.75), (0.0, 0.7)]


def test_parse_unterminated_silence_closed_at_duration() -> None:
    text = "silence_start: 8.2\n"
    assert parse_silencedetect(text, duration=10.0) == [(8.2, 10.0)]
    assert parse_silencedetect(text) == []


def test_merge_sorts_overlaps_and_adjacent_gaps() -> None:
    merged = merge_silences([(5.0, 6.0), (0.0, 0.7), (1.5, 2.75), (2.77, 3.0), (5.5, 6.5)])
    assert merged == [(0.0, 0.7), (1.5, 3.0), (5.0, 6.5)]
    assert total_silence(merged) == pytest.approx(0.7 + 1.5 + 1.5)
    assert merge_silences([]) == []


def test_rms_db_levels_and_partial_window() -> None:
    sr = 16_000
    loud = np.full(sr // 2, 0.5, dtype=np.float32)  # constant 0.5 -> -6.02 dBFS
    quiet = np.zeros(sr // 2, dtype=np.float32)
    tail = np.full(sr // 4, 0.5, dtype=np.float32)  # partial window keeps its own level
    db = rms_db(np.concatenate([loud, quiet, tail]))
    assert db == [-6.0, FLOOR_DB, -6.0]
    assert rms_db(np.zeros(0)) == []


@pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg required")
def test_detect_silences_and_decode_with_real_ffmpeg(tmp_path) -> None:  # type: ignore[no-untyped-def]
    wav = tmp_path / "t.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
         "sine=frequency=440:duration=2,volume=0.5", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
         "-filter_complex", "[0][1]concat=n=2:v=0:a=1[o]", "-map", "[o]", "-t", "4", str(wav)],
        check=True,
    )  # fmt: skip
    pcm = decode_pcm(wav)
    assert 3.9 * 16000 < pcm.size < 4.2 * 16000
    silences = detect_silences(wav, duration=4.0)
    assert len(silences) == 1 and 1.9 <= silences[0][0] <= 2.1 and silences[0][1] >= 3.9


def test_fixed_shots_cover_duration_and_merge_short_tail() -> None:
    assert fixed_shots(0) == []
    assert fixed_shots(45) == [(0.0, 20.0), (20.0, 40.0), (40.0, 45.0)]
    assert fixed_shots(41) == [(0.0, 20.0), (20.0, 41.0)]  # 1 s tail merged
    assert fixed_shots(10) == [(0.0, 10.0)]


def test_normalize_shots_makes_contiguous_cover() -> None:
    out = normalize_shots([(0.5, 3.0), (3.0, 6.0), (6.0, 9.5)], 10.0)
    assert out[0][0] == 0.0 and out[-1][1] == 10.0
    assert all(a[1] == b[0] for a, b in pairwise(out))
    assert normalize_shots([], 10.0) == []


def test_select_evenly_and_nearest() -> None:
    assert select_evenly(5, 12) == [0, 1, 2, 3, 4]
    picked = select_evenly(100, 12)
    assert len(picked) == 12 and picked[0] == 0 and picked[-1] == 99
    assert select_evenly(100, 1) == [50] and select_evenly(0, 5) == []
    assert nearest_index(7, [0, 5, 10]) == 5 and nearest_index(7, []) is None
