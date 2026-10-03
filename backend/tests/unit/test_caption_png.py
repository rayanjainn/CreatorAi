"""Pillow caption renderer (no libass): timing parity with ASS, PNG output, graph strings."""

from __future__ import annotations

from itertools import pairwise
from pathlib import Path

import pytest

from app.media import caption_support, fonts, render_graph
from app.media.captions_ass import build_ass
from app.media.captions_common import caption_events
from app.media.captions_png import VisualState, build_track, concat_list, render_state
from tests.unit.test_render_media import ASSETS, caption, timeline, vid


@pytest.fixture(scope="module")
def faces(tmp_path_factory: pytest.TempPathFactory) -> dict[str, fonts.FontFace]:
    return fonts.stage_fonts(tmp_path_factory.mktemp("fonts"))


def _ass_times(ass: str) -> list[tuple[str, float, float]]:
    out = []
    for ln in ass.splitlines():
        if ln.startswith("Dialogue"):
            f = ln.split(",", 9)

            def sec(ts: str) -> float:
                h, m, s = ts.split(":")
                return int(h) * 3600 + int(m) * 60 + float(s)

            out.append((f[3], sec(f[1]), sec(f[2])))
    return out


@pytest.mark.parametrize("style", ["bold_center", "minimal_bottom", "karaoke"])
def test_png_lines_match_ass_events(style: str, faces: dict[str, fonts.FontFace]) -> None:
    """Same timeline -> the same caption lines at the same times in both renderers."""
    tl = timeline([vid(1, 0, 5, 0), vid(2, 0, 5, 5, transition_in=None)], "9:16", style)
    tl.tracks.captions = [
        caption(1, 0.5, 2.0, "hello big world", words=True),
        caption(2, 2.5, 4.0, "second line here", words=True, style_override="minimal_bottom"),
        caption(3, 4.2, 4.21, "too short to show"),
        caption(4, 5.5, 7.0, "after the join", words=True),
        caption(5, 8.0, 9.0, "rejected", words=True),
        caption(6, 9.0, 30.0, "clamped to the end", words=True),
    ]
    tl.tracks.captions[4].status = "rejected"
    shift = lambda t: t - 0.3 if t >= 5 else t  # noqa: E731  (a transition-like remap)
    ass = _ass_times(build_ass(tl, faces, time_map=shift, duration=9.5))
    track = build_track(tl, shift, 9.5)
    events = caption_events(tl, shift, 9.5)
    assert [(e.spec.name, round(e.start, 2), round(e.end, 2)) for e in events] == [
        (n, round(a, 2), round(b, 2)) for n, a, b in ass
    ]
    # every event is covered exactly by its PNG slots: first slot starts at the line start,
    # slots are contiguous, the last ends at the line end
    slots = sorted((s for lane in track.lanes for s in lane), key=lambda s: s.start)
    for ev in events:
        mine = [s for s in slots if s.start >= ev.start - 1e-6 and s.end <= ev.end + 1e-6]
        assert mine and abs(mine[0].start - ev.start) < 0.04 and abs(mine[-1].end - ev.end) < 0.04
        assert all(abs(a.end - b.start) < 1e-6 for a, b in pairwise(mine))
    assert len(track.lanes) == 1


def test_karaoke_states_one_per_word_and_highlight_moves(
    tmp_path: Path, faces: dict[str, fonts.FontFace]
) -> None:
    tl = timeline([vid(1, 0, 10, 0)], "9:16", "karaoke")
    tl.tracks.captions = [caption(1, 1.0, 2.5, "one two three", words=True)]
    track = build_track(tl)
    lane = track.lanes[0]
    assert [round(s.start, 2) for s in lane] == [1.0, 1.5, 2.0] and lane[-1].end == 2.5
    assert [track.states[s.filename].highlight for s in lane] == [0, 1, 2]
    a = render_state(track.states[lane[0].filename], 1080, 1920, faces)
    b = render_state(track.states[lane[1].filename], 1080, 1920, faces)
    assert a.size == (1080, 1920) and a.mode == "RGBA"
    assert a.tobytes() != b.tobytes()  # the yellow word moved
    yellow = lambda im: sum(  # noqa: E731
        1 for px in im.getdata() if px[3] == 255 and px[0] > 240 and px[1] > 240 and px[2] < 20
    )
    assert yellow(a) > 500 and yellow(b) > 500
    # words without timings: one static state
    tl.tracks.captions = [caption(2, 0.0, 1.5, "a b c")]
    static = build_track(tl)
    assert len(static.states) == 1 and next(iter(static.states.values())).highlight is None


def test_karaoke_lead_in_state_and_dedupe() -> None:
    tl = timeline([vid(1, 0, 10, 0)], "9:16", "karaoke")
    cap = caption(1, 1.0, 3.0, "go go", words=True)
    assert cap.words is not None
    cap.words[0].t0, cap.words[0].t1 = 1.4, 2.0  # speech starts after the line appears
    tl.tracks.captions = [cap, caption(2, 4.0, 5.0, "go go", words=True)]
    track = build_track(tl)
    first = track.lanes[0][0]
    assert track.states[first.filename].highlight is None and (first.start, first.end) == (1.0, 1.4)
    # the repeated caption text re-uses the same PNGs
    assert len(track.states) < len(track.lanes[0])


def test_overlapping_captions_use_a_second_lane() -> None:
    tl = timeline([vid(1, 0, 10, 0)], "9:16", "bold_center")
    tl.tracks.captions = [caption(1, 1, 3, "first"), caption(2, 2, 4, "second")]
    assert len(build_track(tl).lanes) == 2


def test_concat_list_fills_gaps_with_blank_frames() -> None:
    tl = timeline([vid(1, 0, 10, 0)], "9:16", "bold_center")
    tl.tracks.captions = [caption(1, 0.5, 1.0, "a"), caption(2, 2.0, 2.5, "b")]
    text = concat_list(build_track(tl).lanes[0])
    assert text.splitlines()[:7] == [
        "ffconcat version 1.0",
        "file 'cap_blank.png'", "duration 0.500",
        "file 'cap_0.png'", "duration 0.500",
        "file 'cap_blank.png'", "duration 1.000",
    ]  # fmt: skip
    assert text.rstrip().endswith("file 'cap_blank.png'\nduration 1.0")


def test_bold_center_is_uppercase_centered_and_outlined(faces: dict[str, fonts.FontFace]) -> None:
    img = render_state(VisualState("bold_center", ("Hello", "world")), 1080, 1920, faces)
    box = img.getchannel("A").getbbox()
    assert box is not None
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    assert abs(cx - 540) < 20 and abs(cy - 960) < 60  # mid-frame
    px = img.load()
    assert px is not None
    colours = {px[x, y][:3] for x in range(box[0], box[2]) for y in range(box[1], box[3], 3)}
    assert (255, 255, 255) in colours and (0, 0, 0) in colours  # white fill, black outline


def test_minimal_bottom_has_a_semi_transparent_box_at_the_bottom(
    faces: dict[str, fonts.FontFace],
) -> None:
    img = render_state(VisualState("minimal_bottom", ("subtitle", "text")), 1920, 1080, faces)
    box = img.getchannel("A").getbbox()
    assert box is not None and abs(box[3] - (1080 - 60)) <= 2  # box bottom sits MarginV 60 up
    px = img.getpixel((box[0] + 2, box[1] + 2))
    assert isinstance(px, tuple) and px[3] == 128 and px[:3] == (0, 0, 0)


def test_wrapping_and_auto_shrink_keep_text_inside_the_frame(
    faces: dict[str, fonts.FontFace],
) -> None:
    long = tuple("the quick brown fox jumps over the lazy dog again and again".split())
    img = render_state(VisualState("bold_center", long), 1080, 1920, faces)
    box = img.getchannel("A").getbbox()
    assert box is not None and box[0] >= 0 and box[2] <= 1080
    assert (box[2] - box[0]) <= 1080 * 0.86 + 20
    wide = render_state(VisualState("karaoke", ("A" * 60,)), 1080, 1920, faces)
    wb = wide.getchannel("A").getbbox()
    assert wb is not None and wb[2] - wb[0] <= 1080 * 0.9  # one huge word shrinks to fit


def test_odd_glyphs_never_crash(faces: dict[str, fonts.FontFace]) -> None:
    for text in ("emoji 🎬🔥 time", "日本語 テスト", "مرحبا بالعالم", "\u0000퟿\U0010ffff x"):
        img = render_state(VisualState("bold_center", tuple(text.split())), 540, 960, faces)
        assert img.size == (540, 960)
    img = render_state(VisualState("karaoke", ()), 540, 960, faces)
    assert img.getchannel("A").getbbox() is None


def test_graph_pillow_mode_adds_one_concat_input_per_lane() -> None:
    tl = timeline([vid(1, 0, 4, 0)], "9:16", "karaoke")
    tl.tracks.overlays = []
    tl.tracks.captions = [caption(1, 0.5, 2.0, "hi there you", words=True)]
    plan = render_graph.build_plan(tl, ASSETS, amix_normalize=True, caption_renderer="pillow")
    assert plan.caption_renderer == "pillow" and plan.uses_captions
    assert plan.input_args[-6:] == ["-f", "concat", "-safe", "0", "-i", "captions_0.txt"]
    g = plan.filter_complex
    assert "subtitles" not in g
    assert (
        "[vj][1:v]overlay=0:0:format=auto:eof_action=repeat[vcap0];[vcap0]format=yuv420p[vout]" in g
    )
    assert plan.caption_track is not None and len(plan.caption_track.lanes) == 1
    # libass mode is unchanged
    ass = render_graph.build_plan(tl, ASSETS, amix_normalize=True, caption_renderer="libass")
    assert "[vj]subtitles=filename=captions.ass:fontsdir=fonts[vsub]" in ass.filter_complex
    assert ass.caption_track is None
    # no (visible) captions: nothing added in either mode
    tl.tracks.captions = []
    bare = render_graph.build_plan(tl, ASSETS, amix_normalize=True, caption_renderer="pillow")
    assert not bare.uses_captions and "concat" not in " ".join(bare.input_args)


def test_graph_pillow_mode_after_a_transition_uses_output_time() -> None:
    items = [vid(1, 0, 4, 0), vid(2, 0, 4, 4, transition_in=None)]
    from app.schemas.timeline import Transition

    items[1].transition_in = Transition(type="fade", dur=0.5)
    tl = timeline(items, "9:16", "bold_center")
    tl.tracks.captions = [caption(1, 5.0, 6.0, "late")]
    plan = render_graph.build_plan(tl, ASSETS, amix_normalize=True, caption_renderer="pillow")
    assert plan.caption_track is not None
    slot = plan.caption_track.lanes[0][0]
    assert (round(slot.start, 3), round(slot.end, 3)) == (4.5, 5.5)  # timeline 5-6 minus 0.5 s


def test_caption_renderer_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(caption_support, "libass_available", lambda: False)
    assert caption_support.captions_supported_renderers() == ("pillow",)
    assert caption_support.resolve_caption_renderer("auto") == "pillow"
    assert caption_support.resolve_caption_renderer("libass") == "libass"  # explicit wins
    monkeypatch.setattr(
        caption_support, "get_settings", lambda: type("S", (), {"caption_renderer": "auto"})()
    )
    assert caption_support.caption_features() == {"renderer": "pillow", "libass": False}
    monkeypatch.setattr(caption_support, "libass_available", lambda: True)
    assert caption_support.captions_supported_renderers() == ("libass", "pillow")
    assert caption_support.resolve_caption_renderer("auto") == "libass"
    assert caption_support.resolve_caption_renderer("pillow") == "pillow"
