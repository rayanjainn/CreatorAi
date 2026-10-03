"""Timeline model, invariants (Plan 6.1) and deterministic ops."""

from __future__ import annotations

import random
from typing import Any

import pytest

from app.errors import AppError
from app.schemas.timeline import (
    AudioItem,
    CaptionItem,
    OverlayItem,
    Timeline,
    VideoItem,
    new_item_id,
)
from app.services import timeline_service as ts

A, B = "asset-a", "asset-b"
DURATIONS = {A: 60.0, B: 30.0, "music": 120.0}


def video(
    src_in: float,
    src_out: float,
    asset: str = A,
    *,
    status: str = "suggested",
    source: str = "ai",
    **kw: Any,
) -> VideoItem:
    return VideoItem(
        id=new_item_id("v"),
        source=source,
        status=status,
        asset_id=asset,
        src_in=src_in,
        src_out=src_out,
        tl_start=0,
        **kw,
    )


def caption(t0: float, t1: float, text: str = "hello there", **kw: Any) -> CaptionItem:
    return CaptionItem(
        id=new_item_id("c"),
        source="ai",
        status="suggested",
        tl_start=t0,
        tl_end=t1,
        text=text,
        **kw,
    )


def make(items: list[VideoItem], captions: list[CaptionItem] | None = None) -> Timeline:
    timeline = Timeline.empty()
    timeline.tracks.video = items
    timeline.tracks.captions = captions or []
    return ts.recompute_duration(timeline)


def base() -> Timeline:
    """Three items: A 5-15 (10 s), A 20-26 (6 s), B 2-10 (8 s): 24 s, captions in each."""
    t = make([video(5, 15), video(20, 26), video(2, 10, B)])
    t.tracks.captions = [caption(1, 3), caption(12, 14), caption(18, 21)]
    return t


def ok(timeline: Timeline) -> Timeline:
    assert ts.validate(timeline, DURATIONS) == [], ts.validate(timeline, DURATIONS)
    return timeline


# ── model ────────────────────────────────────────────────────────────────────────────────────
def test_model_roundtrip_and_ids() -> None:
    t = ok(base())
    again = Timeline.model_validate(t.dump())
    assert again == t and t.duration == pytest.approx(24)
    assert new_item_id("v").startswith("v_") and new_item_id("v") != new_item_id("v")
    assert t.tracks.video[1].tl_start == pytest.approx(10)


def test_sponsor_placeholder_rules() -> None:
    sponsor = VideoItem(
        id="v_s",
        source="ai",
        status="suggested",
        kind="sponsor",
        asset_id=None,
        placeholder=True,
        src_in=0,
        src_out=20,
        tl_start=0,
        text="Brought to you",
    )
    assert sponsor.asset_id is None and sponsor.duration == 20
    with pytest.raises(ValueError):
        VideoItem(
            id="v_x",
            source="ai",
            status="suggested",
            asset_id=None,
            src_in=0,
            src_out=5,
            tl_start=0,
        )
    with pytest.raises(ValueError):
        VideoItem(
            id="v_x",
            source="ai",
            status="suggested",
            asset_id="a",
            placeholder=True,
            src_in=0,
            src_out=5,
            tl_start=0,
        )


def test_strict_models_reject_unknown_fields_and_bad_ranges() -> None:
    with pytest.raises(ValueError):
        Timeline.model_validate({**base().dump(), "surprise": 1})
    raw = base().dump()
    raw["tracks"]["video"][0]["crop_x"] = 1.5
    with pytest.raises(ValueError):
        Timeline.model_validate(raw)
    raw = base().dump()
    raw["tracks"]["video"][0]["transition_in"] = {"type": "fade", "dur": 0.0}
    with pytest.raises(ValueError):
        Timeline.model_validate(raw)


# ── validate ─────────────────────────────────────────────────────────────────────────────────
def codes(timeline: Timeline) -> set[str]:
    return {v.code for v in ts.validate(timeline, DURATIONS)}


def test_validate_detects_each_invariant() -> None:
    t = base()
    t.tracks.video[1].tl_start += 1
    assert "VIDEO_GAP" in codes(t)
    t = base()
    t.tracks.video[1].tl_start -= 1
    assert "VIDEO_OVERLAP" in codes(t)
    t = base()
    t.tracks.video[1].tl_start = 3
    t.tracks.video[2].tl_start = 9.0
    assert "VIDEO_ORDER" in codes(t) or "VIDEO_OVERLAP" in codes(t)
    t = base()
    t.tracks.video[0].tl_start = 1
    assert "VIDEO_START" in codes(t)
    t = base()
    t.tracks.video[0].src_out = 70  # past the asset
    assert "SRC_BEYOND_ASSET" in codes(t)
    t = base()
    t.tracks.video[0].src_in = 15
    assert "SRC_RANGE" in codes(t)
    t = base()
    t.duration = 99
    assert codes(t) == {"DURATION_MISMATCH"}
    t = base()
    t.tracks.captions[0].tl_end = 100
    assert codes(t) == {"LAYER_RANGE"}
    t = base()
    t.tracks.captions[0].tl_end = t.tracks.captions[0].tl_start
    assert codes(t) == {"LAYER_RANGE"}
    t = base()
    t.tracks.captions[1].id = t.tracks.captions[0].id
    assert codes(t) == {"DUPLICATE_ID"}
    t = base()
    t.tracks.video[0].id = "x_bad"
    assert codes(t) == {"ID_PREFIX"}
    t = base()
    t.width = 100
    assert codes(t) == {"DIMENSIONS"}


def test_validate_skips_rejected_video_in_gapless_check() -> None:
    t = base()
    t.tracks.video[1].status = "rejected"
    t.tracks.video[1].tl_start = 999  # ignored
    t.tracks.video[2].tl_start = 10
    t.duration = 18
    t.tracks.captions = []
    assert ts.validate(t, DURATIONS) == []


def test_ensure_valid_error_details() -> None:
    t = base()
    t.tracks.video[1].tl_start += 2
    with pytest.raises(AppError) as exc:
        ts.ensure_valid(t, DURATIONS)
    assert exc.value.status == 422 and exc.value.code == "VALIDATION_ERROR"
    violation = exc.value.details["violations"][0]
    assert violation["code"] == "VIDEO_GAP" and violation["path"] == "tracks.video[1]"
    assert violation["item_id"] == t.tracks.video[1].id
    with pytest.raises(AppError) as schema_exc:
        ts.parse_timeline({"version": 2})
    assert schema_exc.value.details["violations"][0]["code"] == "SCHEMA"


# ── ops ──────────────────────────────────────────────────────────────────────────────────────
def test_ops_do_not_mutate_their_input() -> None:
    t = base()
    snapshot = t.dump()
    ts.delete_item(t, t.tracks.video[0].id)
    ts.split_item(t, 5)
    ts.tighten_pauses(t, {A: [(8, 12)]})
    ts.trim(t, 1, -1)
    assert t.dump() == snapshot


def test_tighten_pauses_splits_with_pause_removed_reason() -> None:
    t = base()
    out = ok(ts.tighten_pauses(t, {A: [(8.0, 12.0)]}, keep_sec=0.2))
    first, second = out.tracks.video[0], out.tracks.video[1]
    assert first.id == t.tracks.video[0].id
    assert (first.src_in, first.src_out) == (5, 8.1)
    assert (second.src_in, second.src_out) == (11.9, 15)
    assert second.reason == "pause removed" and second.source == "ai" and second.id != first.id
    assert second.tl_start == pytest.approx(first.tl_start + first.duration)
    assert out.duration == pytest.approx(t.duration - (12 - 8) + 0.2)
    # untouched items stay, their captions move with the footage (caption at 18-21 -> 14.2-17.2)
    cap = next(c for c in out.tracks.captions if c.text == "hello there" and c.tl_start > 12)
    assert cap.tl_start == pytest.approx(18 - 3.8)


def test_tighten_pauses_trims_leading_and_trailing_and_is_idempotent() -> None:
    t = make([video(5, 15)])
    silences = {A: [(4.0, 6.0), (14.0, 16.0)]}
    once = ok(ts.tighten_pauses(t, silences, keep_sec=0.2))
    item = once.tracks.video[0]
    assert (item.src_in, item.src_out) == (5.9, 14.1)
    assert ts.tighten_pauses(once, silences, keep_sec=0.2).dump() == once.dump()
    smaller = ok(ts.tighten_pauses(once, silences, keep_sec=0.1))
    assert (smaller.tracks.video[0].src_in, smaller.tracks.video[0].src_out) == (5.95, 14.05)


def test_tighten_pauses_short_silence_and_all_silent_item() -> None:
    t = make([video(5, 15)])
    assert ts.tighten_pauses(t, {A: [(8, 8.2)]}, keep_sec=0.2).dump() == t.dump()
    gone = make([video(5, 7), video(10, 20)])
    out = ok(ts.tighten_pauses(gone, [(4, 8)], keep_sec=0.1))  # flat list applies to every asset
    assert [(v.src_in, v.src_out) for v in out.tracks.video] == [
        (10, 20)
    ]  # the silent item is gone


def test_trim_first_last_and_clamps_to_asset() -> None:
    t = base()
    out = ok(ts.trim(t, 1.0, -2.0, asset_durations=DURATIONS))
    assert out.tracks.video[0].src_in == 6 and out.tracks.video[-1].src_out == 8
    assert out.duration == pytest.approx(24 - 3)
    # caption 1-3 sat in the first second of item 0: head cut moves it by -1 and clips it to >= 0
    assert out.tracks.captions[0].tl_start == pytest.approx(0)
    longer = ts.trim(t, 0, 50, asset_durations=DURATIONS)
    assert longer.tracks.video[-1].src_out == 30  # clamped to asset B
    on_item = ok(ts.trim(t, 0, -3, item_id=t.tracks.video[1].id))
    assert on_item.tracks.video[1].src_out == 23
    with pytest.raises(AppError):
        ts.trim(t, 9.95, 0, item_id=t.tracks.video[0].id)


def test_split_item_keeps_everything_in_place() -> None:
    t = base()
    out = ok(ts.split_item(t, 4.0))
    assert len(out.tracks.video) == 4 and out.duration == t.duration
    a, b = out.tracks.video[0], out.tracks.video[1]
    assert (a.src_in, a.src_out, b.src_in, b.src_out) == (5, 9, 9, 15) and b.tl_start == 4
    assert [c.model_dump() for c in out.tracks.captions] == [
        c.model_dump() for c in t.tracks.captions
    ]
    for bad in (0.05, 10.0, 0.0, 99.0):
        with pytest.raises(AppError):
            ts.split_item(t, bad)
    sponsor = make(
        [
            VideoItem(
                id="v_s",
                source="ai",
                status="suggested",
                kind="sponsor",
                asset_id=None,
                placeholder=True,
                src_in=0,
                src_out=20,
                tl_start=0,
            )
        ]
    )
    with pytest.raises(AppError):
        ts.split_item(sponsor, 10)


def test_delete_video_ripples_and_retimes_layers() -> None:
    t = base()
    out = ok(ts.delete_item(t, t.tracks.video[0].id))
    assert [v.tl_start for v in out.tracks.video] == [0, pytest.approx(6)]
    assert out.duration == pytest.approx(14)
    # the caption inside the deleted item is gone; the others moved 10 s earlier
    assert [(c.tl_start, c.tl_end) for c in out.tracks.captions] == [
        (pytest.approx(2), pytest.approx(4)),
        (pytest.approx(8), pytest.approx(11)),
    ]
    cap_id = t.tracks.captions[0].id
    same = ts.delete_item(t, cap_id)
    assert same.duration == t.duration and len(same.tracks.captions) == 2
    with pytest.raises(AppError) as exc:
        ts.delete_item(t, "v_missing")
    assert exc.value.status == 404


def test_reorder_moves_footage_and_its_captions() -> None:
    t = base()
    last = t.tracks.video[2].id
    t.tracks.captions.append(caption(16, 19, "from b"))  # inside item 2 (10..18)? 16-18 only
    t.tracks.captions[-1].tl_end = 18
    out = ok(ts.reorder(t, last, 0))
    assert out.tracks.video[0].id == last
    moved = next(c for c in out.tracks.captions if c.text == "from b")
    assert (moved.tl_start, moved.tl_end) == (pytest.approx(0), pytest.approx(2))
    assert out.duration == t.duration
    assert ts.reorder(t, t.tracks.video[0].id, 99).tracks.video[-1].id == t.tracks.video[0].id


def test_set_status_rejecting_video_ripples_and_restoring_does_too() -> None:
    t = base()
    middle = t.tracks.video[1].id
    rejected = ok(ts.set_status(t, middle, "rejected"))
    assert rejected.duration == pytest.approx(18) and rejected.tracks.video[
        2
    ].tl_start == pytest.approx(10)
    assert all(c.tl_end <= 18 + 1e-6 for c in rejected.tracks.captions)
    restored = ok(ts.set_status(rejected, middle, "accepted"))
    assert restored.duration == pytest.approx(24)
    layer = ts.set_status(t, t.tracks.captions[0].id, "rejected")
    assert layer.tracks.captions[0].status == "rejected" and layer.duration == t.duration


def test_accept_all_leaves_rejected() -> None:
    t = base()
    t.tracks.captions[0].status = "rejected"
    t.tracks.audio.append(
        AudioItem(
            id="a_m",
            source="ai",
            status="suggested",
            kind="music",
            asset_id="music",
            src_in=0,
            src_out=20,
            tl_start=0,
            gain_db=-18,
        )
    )
    out = ts.accept_all(t)
    assert {v.status for v in out.tracks.video} == {"accepted"}
    assert out.tracks.captions[0].status == "rejected" and out.tracks.audio[0].status == "accepted"


def test_toggle_music_and_caption_style() -> None:
    t = base()
    with pytest.raises(AppError):
        ts.toggle_music(t, True)
    t.tracks.audio.append(
        AudioItem(
            id="a_m",
            source="ai",
            status="suggested",
            kind="music",
            asset_id="music",
            src_in=0,
            src_out=20,
            tl_start=0,
        )
    )
    assert ts.toggle_music(t, False).tracks.audio[0].status == "rejected"
    assert ts.toggle_music(t, True).tracks.audio[0].status == "accepted"
    t.tracks.captions[0].style_override = "karaoke"
    styled = ts.set_caption_style(t, "minimal_bottom")
    assert (
        styled.caption_style == "minimal_bottom"
        and styled.tracks.captions[0].style_override == "karaoke"
    )
    assert (
        ts.set_caption_style(t, "karaoke", clear_overrides=True).tracks.captions[0].style_override
        is None
    )


def test_ripple_insert_splits_and_shifts_later_layers() -> None:
    t = base()
    sponsor = VideoItem(
        id=new_item_id("v"),
        source="ai",
        status="suggested",
        kind="sponsor",
        asset_id=None,
        placeholder=True,
        src_in=0,
        src_out=5,
        tl_start=0,
        text="Ad",
    )
    out = ok(ts.ripple_insert(t, 4.0, sponsor))
    ids = [(v.kind, v.src_in, v.src_out) for v in out.tracks.video]
    assert ids == [
        ("clip", 5, 9),
        ("sponsor", 0, 5),
        ("clip", 9, 15),
        ("clip", 20, 26),
        ("clip", 2, 10),
    ]
    assert out.duration == pytest.approx(29)
    assert out.tracks.video[1].tl_start == pytest.approx(4)
    # caption 12-14 (source 17..? no: inside item 0 offset 7..9 => source 12..14) moves 5 s later
    moved = [c for c in out.tracks.captions if c.text == "hello there"]
    assert sorted(round(c.tl_start, 2) for c in moved) == [1, 17, 23]
    front = ok(ts.ripple_insert(t, 0, sponsor))
    assert front.tracks.video[0].kind == "sponsor"
    back = ok(ts.ripple_insert(t, 500, sponsor))
    assert back.tracks.video[-1].kind == "sponsor" and back.tracks.video[
        -1
    ].tl_start == pytest.approx(24)
    boundary = ok(ts.ripple_insert(t, 10, sponsor))
    assert [v.kind for v in boundary.tracks.video] == ["clip", "sponsor", "clip", "clip"]


# ── captions (Plan 8.9) ──────────────────────────────────────────────────────────────────────
def words(spec: list[tuple[str, float, float]]) -> list[dict[str, Any]]:
    return [{"word": w, "start": s, "end": e} for w, s, e in spec]


SPEECH = words(
    [
        ("one", 5.0, 5.3),
        ("two", 5.4, 5.7),
        ("three", 5.8, 6.1),
        ("four.", 6.2, 6.5),
        ("five", 9.0, 9.3),
        ("six", 9.4, 9.7),
        ("outside", 40.0, 40.4),
    ]
)


def test_rebuild_captions_groups_three_words_and_extends_ends() -> None:
    t = make([video(5, 12)])
    out = ok(ts.rebuild_captions(t, lambda asset: SPEECH))
    lines = [(c.text, c.tl_start, c.tl_end) for c in out.tracks.captions]
    assert [x[0] for x in lines] == ["one two three", "four.", "five six"]
    first = out.tracks.captions[0]
    assert (
        first.tl_start == pytest.approx(0.0)
        and first.source == "ai"
        and first.status == "suggested"
    )
    assert first.words and first.words[0].w == "one" and first.words[-1].t1 == pytest.approx(1.1)
    # first line ends 1.1 s; the next starts at 1.2 s (word "four."): end = min(+0.3, next - 0.02)
    assert first.tl_end == pytest.approx(1.18)
    assert all(c.tl_end <= t.duration for c in out.tracks.captions)
    assert not any("outside" in c.text for c in out.tracks.captions)


def test_rebuild_captions_minimal_style_and_max_line_seconds() -> None:
    t = make([video(5, 12)])
    t.caption_style = "minimal_bottom"
    out = ts.rebuild_captions(t, lambda asset: SPEECH)
    assert out.tracks.captions[0].text == "one two three four."  # 7 words max, within 2 s
    slow = words([(f"w{i}", 5 + i * 0.7, 5 + i * 0.7 + 0.3) for i in range(8)])
    lines = ts.group_lines(ts._norm_words(slow), "minimal_bottom")
    assert all(line[-1][2] - line[0][1] <= 2.0 + 1e-9 for line in lines) and len(lines) > 1


def test_rebuild_captions_follow_item_positions_and_clamp_to_item() -> None:
    t = make([video(9.0, 9.6), video(5, 6.0)])  # item 0 contains "five"+half of "six"
    out = ok(ts.rebuild_captions(t, lambda asset: SPEECH))
    c0 = out.tracks.captions[0]
    assert c0.text == "five six" and c0.tl_start == pytest.approx(0) and c0.tl_end <= 0.6 + 1e-9
    assert all(c.tl_end <= out.duration for c in out.tracks.captions)
    # sponsor placeholder text becomes estimated captions at 2.5 words/second
    sponsor = VideoItem(
        id="v_s",
        source="ai",
        status="suggested",
        kind="sponsor",
        asset_id=None,
        placeholder=True,
        src_in=0,
        src_out=2,
        tl_start=0,
        text="a b c d e f g",
    )
    s = ok(ts.rebuild_captions(make([sponsor]), lambda asset: []))
    assert s.tracks.captions and s.tracks.captions[0].text == "a b c"
    assert s.tracks.captions[-1].tl_end <= 2.0 + 1e-9


# ── overlays ride along ──────────────────────────────────────────────────────────────────────
def test_overlays_are_retimed_with_their_footage() -> None:
    t = base()
    t.tracks.overlays.append(
        OverlayItem(
            id="o_1",
            source="ai",
            status="suggested",
            kind="lower_third",
            tl_start=11,
            tl_end=13,
            text="x",
        )
    )
    out = ok(ts.delete_item(t, t.tracks.video[0].id))
    assert (out.tracks.overlays[0].tl_start, out.tracks.overlays[0].tl_end) == (
        pytest.approx(1),
        pytest.approx(3),
    )


# ── dispatcher ───────────────────────────────────────────────────────────────────────────────
def test_apply_op_validates_names_and_params() -> None:
    t = base()
    ctx = ts.OpContext(
        asset_durations=DURATIONS, silences={A: [(8.0, 12.0)]}, words_provider=lambda asset: SPEECH
    )
    assert ts.apply_op(t, "tighten_pauses", {"keep_sec": 0.1}, ctx).duration < t.duration
    assert ts.apply_op(
        t, "trim_clip", {"start_delta": 1, "end_delta": -1}, ctx
    ).duration == pytest.approx(22)
    assert ts.apply_op(t, "set_caption_style", {"style": "karaoke"}, ctx).caption_style == "karaoke"
    assert ts.apply_op(t, "accept_all", {}, ctx).tracks.video[0].status == "accepted"
    assert ts.apply_op(t, "rebuild_captions", {}, ctx).tracks.captions
    assert (
        ts.apply_op(t, "set_crop_x", {"item_id": t.tracks.video[0].id, "crop_x": 0.2}, ctx)
        .tracks.video[0]
        .crop_x
        == 0.2
    )
    for op, params in [
        ("nope", {}),
        ("tighten_pauses", {"keep_sec": 5}),
        ("trim", {"start_delta": 99}),
        ("set_caption_style", {"style": "comic"}),
        ("split_item", {}),
        ("tighten_pauses", {"bogus": 1}),
    ]:
        with pytest.raises(AppError) as exc:
            ts.apply_op(t, op, params, ctx)
        assert exc.value.status == 422 and exc.value.details["op"] == op
    with pytest.raises(AppError):
        ts.apply_op(t, "rebuild_captions", {}, ts.OpContext())


def test_layer_changes_group_by_type() -> None:
    t = base()
    music = AudioItem(
        id="a_m",
        source="ai",
        status="suggested",
        kind="music",
        asset_id="music",
        src_in=0,
        src_out=20,
        tl_start=0,
    )
    t.tracks.audio.append(music)
    after = ts.accept_all(t)
    after = ts.set_status(after, t.tracks.captions[0].id, "rejected")
    changes = ts.layer_changes(t, after)
    by_key = {(c["status"], c["layer"], c["kind"]): c for c in changes}
    assert ("accepted", "audio", "music") in by_key and (
        "rejected",
        "captions",
        "captions",
    ) in by_key
    assert len(by_key[("accepted", "video", "clip")]["item_ids"]) == 3
    assert ts.layer_changes(t, t) == []


# ── property-style: random op sequences keep every invariant ─────────────────────────────────
@pytest.mark.parametrize("seed", range(25))
def test_random_op_sequences_keep_invariants(seed: int) -> None:
    rng = random.Random(seed)
    t = ts.rebuild_captions(
        base(), lambda asset: SPEECH + words([("x", 20.5, 20.9), ("y", 21.0, 21.4)])
    )
    ok(t)
    ctx = ts.OpContext(
        asset_durations=DURATIONS,
        silences={A: [(8.0, 12.0), (22.0, 24.0), (4.5, 5.6)], B: [(3.0, 4.5)]},
        words_provider=lambda asset: SPEECH,
    )
    for _ in range(14):
        video_items = t.tracks.video
        pick = rng.choice(video_items).id if video_items else "v_none"
        choice = rng.choice(
            [
                "tighten",
                "trim",
                "split",
                "delete",
                "reorder",
                "status",
                "caption",
                "accept",
                "rebuild",
                "crop",
            ]
        )
        try:
            if choice == "tighten":
                t = ts.apply_op(t, "tighten_pauses", {"keep_sec": rng.choice([0.1, 0.2, 0.4])}, ctx)
            elif choice == "trim":
                t = ts.apply_op(
                    t,
                    "trim",
                    {"start_delta": rng.uniform(-1, 2), "end_delta": rng.uniform(-2, 1)},
                    ctx,
                )
            elif choice == "split":
                t = ts.apply_op(
                    t, "split_item", {"at_tl": rng.uniform(0, max(t.duration, 0.1))}, ctx
                )
            elif choice == "delete" and len(video_items) > 1:
                t = ts.apply_op(t, "delete_item", {"item_id": pick}, ctx)
            elif choice == "reorder":
                t = ts.apply_op(
                    t, "reorder", {"item_id": pick, "to_index": rng.randrange(0, 5)}, ctx
                )
            elif choice == "status" and len(ts.active(video_items)) > 1:
                t = ts.apply_op(
                    t,
                    "set_status",
                    {"item_id": pick, "status": rng.choice(["rejected", "accepted", "suggested"])},
                    ctx,
                )
            elif choice == "caption":
                t = ts.apply_op(
                    t, "set_caption_style", {"style": rng.choice(["karaoke", "bold_center"])}, ctx
                )
            elif choice == "accept":
                t = ts.apply_op(t, "accept_all", {}, ctx)
            elif choice == "rebuild":
                t = ts.apply_op(t, "rebuild_captions", {}, ctx)
            elif choice == "crop":
                t = ts.apply_op(t, "set_crop_x", {"item_id": pick, "crop_x": rng.random()}, ctx)
        except AppError as exc:
            assert exc.status in (404, 422)  # rejected cleanly, timeline unchanged
        ok(t)
        assert t.duration == pytest.approx(sum(v.duration for v in ts.active(t.tracks.video)))
