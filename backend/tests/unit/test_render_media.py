"""Render building blocks without running ffmpeg: presets, ASS captions, graph strings, fonts."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from app.errors import AppError
from app.media import fonts, presets, render_graph
from app.media.captions_ass import STYLES, build_ass, escape_text, scale_for
from app.media.cards import render_card
from app.schemas.timeline import (
    AudioItem,
    CaptionItem,
    CaptionWord,
    OverlayItem,
    Timeline,
    Transition,
    VideoItem,
)

ASSETS = {
    "A": render_graph.AssetSource("/m/a.mp4", True, 1920, 1080),
    "S": render_graph.AssetSource("/m/silent.mp4", False, 1080, 1920),
}


def vid(
    n: int,
    a: float,
    b: float,
    start: float,
    asset: str | None = "A",
    status: str = "accepted",
    **kw: object,
) -> VideoItem:
    return VideoItem(
        id=f"v_{n}", source="ai", status=status, asset_id=asset, src_in=a, src_out=b,  # type: ignore[arg-type]
        tl_start=start, **kw,  # type: ignore[arg-type]
    )  # fmt: skip


def timeline(items: list[VideoItem], aspect: str = "9:16", style: str = "bold_center") -> Timeline:
    tl = Timeline.empty(aspect, style)  # type: ignore[arg-type]
    tl.tracks.video = items
    tl.duration = sum(i.src_out - i.src_in for i in items if i.status != "rejected")
    return tl


def caption(
    n: int, a: float, b: float, text: str, words: bool = False, **kw: object
) -> CaptionItem:
    toks = text.split()
    step = (b - a) / len(toks)
    ws = [CaptionWord(w=t, t0=a + i * step, t1=a + (i + 1) * step) for i, t in enumerate(toks)]
    return CaptionItem(
        id=f"c_{n}", source="ai", status="accepted", tl_start=a, tl_end=b, text=text,  # type: ignore[arg-type]
        words=ws if words else None, **kw,  # type: ignore[arg-type]
    )  # fmt: skip


# ── presets ───────────────────────────────────────────────────────────────────────────────────
def test_presets_match_the_plan_table() -> None:
    table = {
        n: (p.aspect, p.width, p.height, p.max_duration, p.caption_style, p.publishable)
        for n, p in presets.PRESETS.items()
    }
    assert table == {
        "yt_short": ("9:16", 1080, 1920, 60.0, "bold_center", True),
        "reels": ("9:16", 1080, 1920, 90.0, "bold_center", False),
        "tiktok": ("9:16", 1080, 1920, 60.0, "karaoke", False),
        "yt_long": ("16:9", 1920, 1080, None, "minimal_bottom", True),
    }


def test_preset_caps_and_unknown() -> None:
    presets.check_duration(presets.get_preset("yt_short"), 60.0)
    presets.check_duration(presets.get_preset("yt_long"), 3 * 3600)
    with pytest.raises(AppError) as err:
        presets.check_duration(presets.get_preset("yt_short"), 61.5)
    assert err.value.code == "DURATION_EXCEEDS_PRESET" and err.value.status == 422
    assert err.value.details["max_duration"] == 60.0
    with pytest.raises(AppError) as unknown:
        presets.get_preset("vimeo")
    assert unknown.value.code == "VALIDATION_ERROR"


# ── ASS ───────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def faces() -> dict[str, fonts.FontFace]:
    return {r: fonts.resolve_font(r) for r in ("bold", "regular")}


def style_lines(ass: str) -> dict[str, list[str]]:
    rows = [ln for ln in ass.splitlines() if ln.startswith("Style: ")]
    return {r.split(",")[0][7:]: r.split(",") for r in rows}


def test_ass_styles_follow_the_table_and_scale(faces: dict[str, fonts.FontFace]) -> None:
    portrait = style_lines(build_ass(timeline([vid(1, 0, 5, 0)]), faces))
    # fields: name, font, size, primary, secondary, outline, back, bold, ..., borderstyle(15),
    # outline(16), shadow(17), alignment(18), mL, mR, mV(21)
    bold = portrait["bold_center"]
    assert (bold[1], bold[2], bold[7], bold[15], bold[16], bold[18]) == (
        "Montserrat", "84", "-1", "1", "6.0", "5",
    )  # fmt: skip
    minimal = portrait["minimal_bottom"]
    assert (minimal[1], minimal[2], minimal[7], minimal[15], minimal[18], minimal[21]) == (
        "Inter", "52", "0", "3", "2", "160",
    )  # fmt: skip
    assert minimal[5] == "&H80000000"  # semi-transparent box
    kara = portrait["karaoke"]
    assert (kara[2], kara[18], kara[21], kara[3], kara[4]) == (
        "80", "2", "420", "&H0000FFFF", "&H00FFFFFF",
    )  # fmt: skip

    wide = style_lines(build_ass(timeline([vid(1, 0, 5, 0)], "16:9"), faces))
    assert wide["bold_center"][2] == str(round(84 * 0.6))
    assert wide["minimal_bottom"][2] == str(round(52 * 0.6))
    assert wide["minimal_bottom"][21] == "60"  # MarginV 60 for 16:9
    assert wide["karaoke"][2] == "48"
    assert scale_for(1080, 1920) == 1.0 and scale_for(1920, 1080) == 0.6


def test_ass_header_events_and_uppercase(faces: dict[str, fonts.FontFace]) -> None:
    tl = timeline([vid(1, 0, 10, 0)], "9:16", "bold_center")
    tl.tracks.captions = [
        caption(1, 0.5, 2.0, "hello big world"),
        caption(2, 3.0, 4.0, "plain {braces} \\ here", style_override="minimal_bottom"),
        caption(3, 5.0, 6.0, "rejected one"),
    ]
    tl.tracks.captions[2].status = "rejected"
    ass = build_ass(tl, faces)
    assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass
    dialogue = [ln for ln in ass.splitlines() if ln.startswith("Dialogue")]
    assert len(dialogue) == 2  # rejected caption not rendered
    assert dialogue[0] == "Dialogue: 0,0:00:00.50,0:00:02.00,bold_center,,0,0,0,,HELLO BIG WORLD"
    assert dialogue[1].endswith(
        "minimal_bottom,,0,0,0,,plain (braces)  here"
    )  # override keeps case
    assert escape_text("a\nb{c}") == "a b(c)"


def test_ass_karaoke_kf_tags_and_time_map(faces: dict[str, fonts.FontFace]) -> None:
    tl = timeline([vid(1, 0, 10, 0)], "9:16", "karaoke")
    tl.tracks.captions = [caption(1, 1.0, 2.5, "one two three", words=True)]
    ass = build_ass(tl, faces)
    line = next(ln for ln in ass.splitlines() if ln.startswith("Dialogue"))
    assert ",karaoke,," in line
    assert line.endswith("{\\kf50}one {\\kf50}two {\\kf50}three")  # 0.5 s per word
    shifted = build_ass(tl, faces, time_map=lambda t: t - 0.4)
    assert "0:00:00.60,0:00:02.10,karaoke" in shifted
    # words without timings are spread evenly
    tl.tracks.captions = [caption(2, 0.0, 1.5, "a b c")]
    even = next(ln for ln in build_ass(tl, faces).splitlines() if ln.startswith("Dialogue"))
    assert even.count("\\kf50") == 3


# ── render graph ──────────────────────────────────────────────────────────────────────────────
def test_graph_single_clip_9x16_crop_scale_and_audio() -> None:
    tl = timeline([vid(1, 2.0, 7.5, 0, crop_x=0.3)])
    plan = render_graph.build_plan(tl, ASSETS, x264_preset="ultrafast", amix_normalize=True)
    g = plan.filter_complex
    assert plan.input_args == ["-ss", "1.000", "-i", "/m/a.mp4"]  # 1 s seek pad
    assert (
        "[0:v]trim=start=1.000:end=6.500,setpts=PTS-STARTPTS,"
        "crop=w=ih*9/16:h=ih:x='max(0,min(iw-out_w,0.3000*iw-out_w/2))':y=0,"
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,"
        "format=yuv420p[v_0]" in g
    )
    assert "[0:a]atrim=start=1.000:end=6.500,asetpts=PTS-STARTPTS,aresample=48000," in g
    assert "[v_0]null[vj]" in g and "[aj]anull[aout]" in g
    assert plan.duration == 5.5
    out = plan.output_args
    assert out[:4] == ["-map", "[vout]", "-map", "[aout]"]
    for pair in (("-preset", "ultrafast"), ("-crf", "20"), ("-r", "30"), ("-b:a", "160k")):
        assert out[out.index(pair[0]) + 1] == pair[1]
    assert "+faststart" in out and out[-1] == "out.mp4"


def test_graph_16x9_target_has_no_portrait_crop_and_narrow_source_skips_it() -> None:
    wide = render_graph.build_plan(timeline([vid(1, 0, 4, 0)], "16:9"), ASSETS, amix_normalize=True)
    assert "crop=w=ih*9/16" not in wide.filter_complex
    assert (
        "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" in wide.filter_complex
    )
    narrow = render_graph.build_plan(timeline([vid(1, 0, 4, 0, asset="S")]), ASSETS)
    assert "crop=w=ih*9/16" not in narrow.filter_complex  # already 9:16
    assert "anullsrc=r=48000:cl=stereo:d=4.000" in narrow.filter_complex  # source has no audio
    unknown = {"A": render_graph.AssetSource("/m/a.mp4")}
    guess = render_graph.build_plan(timeline([vid(1, 0, 4, 0)]), unknown)
    assert "crop=w='min(iw,ih*9/16)'" in guess.filter_complex


def test_graph_concat_for_cuts_and_rejected_items_are_skipped() -> None:
    items = [
        vid(1, 0, 3, 0),
        vid(2, 5, 9, 3, status="rejected"),
        vid(3, 10, 12, 3, transition_in=Transition(type="cut", dur=0.0)),
    ]
    plan = render_graph.build_plan(timeline(items), ASSETS, amix_normalize=True)
    assert "[v_0][a_0][v_1][a_1]concat=n=2:v=1:a=1[vj][aj]" in plan.filter_complex
    assert "xfade" not in plan.filter_complex and plan.duration == 5.0
    assert plan.input_args.count("-i") == 2  # the rejected item has no input
    with pytest.raises(ValueError):
        render_graph.build_plan(timeline([vid(1, 0, 3, 0, status="rejected")]), ASSETS)
    with pytest.raises(ValueError):
        render_graph.build_plan(timeline([vid(1, 0, 3, 0, asset="missing")]), ASSETS)


def test_graph_xfade_offsets_and_time_map() -> None:
    items = [
        vid(1, 0, 6, 0),
        vid(2, 10, 16, 6, transition_in=Transition(type="fade", dur=0.4)),
        vid(3, 20, 24, 12, transition_in=Transition(type="dissolve", dur=0.3)),
    ]
    plan = render_graph.build_plan(timeline(items), ASSETS, amix_normalize=True)
    g = plan.filter_complex
    assert "[v_0][v_1]xfade=transition=fade:duration=0.400:offset=5.600[xv_1]" in g
    assert "[a_0][a_1]acrossfade=d=0.400[xa_1]" in g
    # running = 6 + 6 - 0.4 = 11.6 -> offset = 11.6 - 0.3
    assert "[xv_1][v_2]xfade=transition=dissolve:duration=0.300:offset=11.300[vj]" in g
    assert "[xa_1][a_2]acrossfade=d=0.300[aj]" in g
    assert plan.duration == pytest.approx(16 - 0.7)
    assert plan.time_map(0.0) == 0.0 and plan.time_map(5.9) == pytest.approx(5.9)
    assert plan.time_map(6.0) == pytest.approx(5.6) and plan.time_map(13.0) == pytest.approx(12.3)


def test_graph_mixed_cut_and_fade_chain_and_clamped_transition() -> None:
    items = [
        vid(1, 0, 3, 0),
        vid(2, 4, 8, 3),  # cut
        vid(3, 9, 9.6, 7, transition_in=Transition(type="fade", dur=0.5)),  # clamps to 0.3
    ]
    plan = render_graph.build_plan(timeline(items), ASSETS, amix_normalize=True)
    g = plan.filter_complex
    assert "[v_0][a_0][v_1][a_1]concat=n=2:v=1:a=1[cv_1][xa_1];[cv_1]fps=30[xv_1]" in g
    assert "xfade=transition=fade:duration=0.300:offset=6.700[vj]" in g


def test_graph_sponsor_placeholder_card_overlays_captions_and_audio_mix() -> None:
    sponsor = VideoItem(
        id="v_9", source="user", status="accepted", kind="sponsor", placeholder=True,
        text="Thanks Acme", asset_id=None, src_in=0, src_out=3, tl_start=4.0,
    )  # fmt: skip
    tl = timeline([vid(1, 0, 4, 0), sponsor])
    tl.tracks.overlays = [
        OverlayItem(id="o_1", source="user", status="accepted", kind="lower_third",
                    tl_start=1, tl_end=3, text="Alex"),
        OverlayItem(id="o_2", source="user", status="rejected", kind="text",
                    tl_start=1, tl_end=3, text="no"),
    ]  # fmt: skip
    tl.tracks.captions = [caption(1, 0.5, 2.0, "hi there")]
    tl.tracks.audio = [
        AudioItem(id="a_1", source="ai", status="accepted", kind="music", asset_id="A",
                  src_in=0, src_out=60, tl_start=0.5, gain_db=-18),
        AudioItem(id="a_2", source="ai", status="rejected", kind="sfx", asset_id="A",
                  src_in=0, src_out=2, tl_start=1),
    ]  # fmt: skip
    modern = render_graph.build_plan(tl, ASSETS, amix_normalize=True, caption_renderer="libass")
    g = modern.filter_complex
    assert "color=c=#111111:s=1080x1920:r=30:d=3.000[bg_1]" in g
    assert "[bg_1][1:v]overlay=0:0:format=auto,format=yuv420p,setsar=1[v_1]" in g
    assert [c.kind for c in modern.cards] == ["sponsor_card", "lower_third"]
    assert "overlay=0:0:format=auto:enable='between(t,1.000,3.000)'[ov0]" in g
    assert "[ov0]subtitles=filename=captions.ass:fontsdir=fonts[vsub]" in g and modern.uses_captions
    assert "volume=-18dB,adelay=500|500,apad[m_0]" in g
    assert "[aj][m_0]amix=inputs=2:duration=first:normalize=0[amixed]" in g
    assert g.count("amix=inputs") == 1  # the rejected sfx is not mixed
    legacy = render_graph.build_plan(tl, ASSETS, amix_normalize=False, caption_renderer="libass")
    assert "normalize" not in legacy.filter_complex
    assert "amix=inputs=2:duration=first[amixed];[amixed]volume=2[aout]" in legacy.filter_complex


def test_amix_capability_detection_is_a_bool() -> None:
    from app.media.ffmpeg import ffmpeg_available

    if not ffmpeg_available():
        pytest.skip("ffmpeg required")
    render_graph.amix_supports_normalize.cache_clear()
    assert isinstance(render_graph.amix_supports_normalize(), bool)


# ── fonts and cards ───────────────────────────────────────────────────────────────────────────
def test_vendored_fonts_resolve_and_fallback_warns(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    bold, regular = fonts.resolve_font("bold"), fonts.resolve_font("regular")
    assert (bold.family, regular.family) == ("Montserrat", "Inter")
    assert not bold.fallback and not regular.fallback
    fonts._warned.clear()
    with caplog.at_level("WARNING"):
        stand_in = fonts.resolve_font("bold", fonts_dir=tmp_path)  # nothing vendored here
        fonts.resolve_font("bold", fonts_dir=tmp_path)
    assert stand_in.fallback and stand_in.path.is_file()
    assert sum("Montserrat font not found" in r.message for r in caplog.records) == 1
    staged = fonts.stage_fonts(tmp_path / "fonts")
    assert set(staged) == {"bold", "regular"} and staged["bold"].path.parent == tmp_path / "fonts"


@pytest.mark.parametrize(
    ("kind", "size"),
    [("sponsor_card", (1080, 1920)), ("lower_third", (1920, 1080)), ("text", (1080, 1920))],
)
def test_cards_are_full_frame_pngs_with_alpha(
    tmp_path: Path, faces: dict[str, fonts.FontFace], kind: str, size: tuple[int, int]
) -> None:
    path = render_card(
        kind, "A fairly long sponsor message for the card", *size, tmp_path / "c.png", faces
    )
    with Image.open(path) as img:
        assert img.size == size and img.mode == "RGBA"
        assert img.getchannel("A").getbbox() is not None  # something was drawn
    assert set(STYLES) == {"bold_center", "minimal_bottom", "karaoke"}
