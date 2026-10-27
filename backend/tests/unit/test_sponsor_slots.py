"""Sponsor slot scoring (Plan 8.10) and the sponsor insert into a clip timeline."""

from __future__ import annotations

import itertools

import numpy as np
import pytest

from app.ml import sponsor_slots as ss
from app.schemas.timeline import Timeline, VideoItem
from app.services import timeline_service as ts


def _vec(i: int, dim: int = 8) -> np.ndarray:
    v = np.zeros(dim, dtype=np.float32)
    v[i % dim] = 1.0
    return v


def _video(segs: list[tuple[float, float, int]]) -> tuple[list[ss.Seg], np.ndarray]:
    seg_list = [ss.Seg(a, b, f"sentence {n}") for n, (a, b, _) in enumerate(segs)]
    return seg_list, np.vstack([_vec(t) for _, _, t in segs])


def test_topic_change_with_a_pause_wins_and_is_kind_both() -> None:
    # topic 0 for the first minute, a 2 s pause, then topic 1
    segs = [(i * 6.0, i * 6.0 + 5.5, 0) for i in range(10)]
    segs += [(62.0 + i * 6.0, 62.0 + i * 6.0 + 5.5, 1) for i in range(10)]
    seg_list, emb = _video(segs)
    found = ss.find_slots(seg_list, emb, _vec(0), duration=122.0)
    assert found, "expected a slot"
    best = max(found, key=lambda c: c.score)
    assert best.at_sec == pytest.approx(60.75, abs=0.01)
    assert best.kind == "both" and best.pause == pytest.approx(1.0)
    assert "topic changes" in best.rationale


def test_margins_and_separation() -> None:
    segs = [(i * 4.0, i * 4.0 + 3.0, i % 3) for i in range(100)]  # 400 s, a change everywhere
    seg_list, emb = _video(segs)
    found = ss.find_slots(seg_list, emb, _vec(1), duration=400.0)
    assert 1 <= len(found) <= 3
    assert all(60.0 <= c.at_sec <= 360.0 for c in found)  # [0.15 D, 0.90 D]
    times = [c.at_sec for c in found]
    assert times == sorted(times)
    assert all(b - a >= max(90.0, 400 / 3) for a, b in itertools.pairwise(times))


def test_short_or_empty_videos_have_no_slots() -> None:
    seg_list, emb = _video([(0.0, 5.0, 0), (5.5, 10.0, 1)])
    assert ss.find_slots(seg_list, emb, _vec(0), duration=10.0) == []
    assert ss.find_slots([], np.zeros((0, 8), np.float32), _vec(0), duration=100.0) == []


def test_silence_widens_the_pause() -> None:
    segs = [(i * 5.0, i * 5.0 + 4.9, 0) for i in range(20)]
    seg_list, emb = _video(segs)
    plain = ss.find_slots(seg_list, emb, _vec(0), duration=100.0, top_k=1)
    loud = ss.find_slots(seg_list, emb, _vec(0), duration=100.0, silences=[(44.5, 46.2)], top_k=1)
    assert loud[0].at_sec == pytest.approx(44.95, abs=0.01)
    assert loud[0].pause > plain[0].pause


def test_context_window_reads_both_sides() -> None:
    segs = [ss.Seg(i, i + 1, f"w{i}a w{i}b") for i in range(10)]
    before, after = ss.context_window(segs, 4, words=6)
    assert before == "w3b w4a w4b" and after == "w5a w5b w6a"


def _clip_timeline() -> Timeline:
    tl = Timeline.empty()
    tl.tracks.video = [
        VideoItem(
            id="v_a", source="ai", status="accepted", asset_id="A", src_in=0, src_out=10, tl_start=0
        ),
        VideoItem(
            id="v_b",
            source="ai",
            status="accepted",
            asset_id="A",
            src_in=20,
            src_out=30,
            tl_start=10,
        ),
    ]
    return ts.recompute_duration(tl)


def test_insert_sponsor_splits_ripples_and_adds_disclosure_and_captions() -> None:
    tl = _clip_timeline()
    out, item_id = ts.insert_sponsor(
        tl,
        4.0,
        duration=12,
        script="This video is brought to you by Acme. " * 4,
        brand="Acme",
        slot_id="slot-1",
    )
    assert ts.validate(out, {"A": 60.0}) == []
    assert out.duration == pytest.approx(32.0)
    sponsor = next(v for v in out.tracks.video if v.id == item_id)
    assert sponsor.kind == "sponsor" and sponsor.placeholder and sponsor.asset_id is None
    assert sponsor.tl_start == pytest.approx(4.0)
    lower = [o for o in out.tracks.overlays if o.kind == "lower_third"]
    assert lower[0].text == "Sponsored · Acme" and lower[0].sponsor_slot_id == "slot-1"
    assert (lower[0].tl_start, lower[0].tl_end) == (pytest.approx(4.0), pytest.approx(16.0))
    caps = [c for c in out.tracks.captions if c.reason == "sponsor script"]
    assert caps and all(4.0 <= c.tl_start < c.tl_end <= 16.0 for c in caps)


def test_map_to_clip_follows_the_cut() -> None:
    from app.services.sponsor_service import map_to_clip

    tl = _clip_timeline()
    assert map_to_clip(tl, "A", 5.0) == pytest.approx(5.0)
    assert map_to_clip(tl, "A", 25.0) == pytest.approx(15.0)
    assert map_to_clip(tl, "A", 15.0) is None  # cut out of this clip
    assert map_to_clip(tl, "B", 5.0) is None
