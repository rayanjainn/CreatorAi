"""ASS captions for the render graph (Plan.md section 8.9).

Captions already live in the timeline (built by ``timeline_service.rebuild_captions`` with the same
line rules the client uses), so this module only styles and serialises them. Three styles; sizes
are for a 1920 px tall frame and scale with the output height (x0.6 for 16:9, per the plan table):

=================  ==============  ====  =====  ===============================================
style              font            size  align  notes
=================  ==============  ====  =====  ===============================================
``bold_center``    Montserrat Bold   84   5     UPPERCASE, white, black outline 6
``minimal_bottom`` Inter Regular     52   2     MarginV 160 (9:16) / 60 (16:9), ``BorderStyle=3``
                                                semi-transparent box
``karaoke``        Montserrat Bold   80   2     MarginV 420, ``{\\kf}`` per word, yellow highlight
                                                over white
=================  ==============  ====  =====  ===============================================
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from app.media.fonts import FontFace
from app.schemas.timeline import CaptionItem, Timeline

BASE_HEIGHT = 1920
LANDSCAPE_SCALE = 0.6
WHITE = "&H00FFFFFF"
YELLOW = "&H0000FFFF"  # ASS colours are &HAABBGGRR
BLACK = "&H00000000"
BOX = "&H80000000"  # 50 % transparent black


@dataclass(frozen=True)
class StyleSpec:
    name: str
    role: str  # font role: "bold" | "regular"
    size: int
    alignment: int
    margin_v: int  # 9:16
    margin_v_landscape: int
    outline: float
    border_style: int = 1
    uppercase: bool = False
    karaoke: bool = False
    primary: str = WHITE
    secondary: str = WHITE
    outline_colour: str = BLACK
    back_colour: str = BLACK


STYLES: dict[str, StyleSpec] = {
    "bold_center": StyleSpec(
        "bold_center", "bold", 84, 5, 0, 0, 6, uppercase=True, back_colour="&H64000000"
    ),
    "minimal_bottom": StyleSpec(
        "minimal_bottom",
        "regular",
        52,
        2,
        160,
        60,
        10,
        border_style=3,
        outline_colour=BOX,
        back_colour=BOX,
    ),
    "karaoke": StyleSpec(
        "karaoke", "bold", 80, 2, 420, 420, 5, karaoke=True, primary=YELLOW, secondary=WHITE
    ),
}


def scale_for(width: int, height: int) -> float:
    """Font scale: ``height / 1920`` for portrait, 0.6 for landscape (1080 px tall)."""
    return LANDSCAPE_SCALE if width > height else height / BASE_HEIGHT


def _ts(seconds: float) -> str:
    cs = max(0, round(seconds * 100))
    h, rest = divmod(cs, 360000)
    m, rest = divmod(rest, 6000)
    s, c = divmod(rest, 100)
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def escape_text(text: str) -> str:
    """Make arbitrary caption text safe inside an ASS dialogue line."""
    cleaned = text.replace("\\", "").replace("\r", " ").replace("\n", " ")
    return cleaned.replace("{", "(").replace("}", ")")


def _style_line(spec: StyleSpec, face: FontFace, width: int, height: int) -> str:
    k = scale_for(width, height)
    landscape = width > height
    margin_v = spec.margin_v_landscape if landscape else spec.margin_v
    if spec.name != "minimal_bottom":
        margin_v = round(margin_v * k)  # minimal_bottom's 60/160 are already per aspect
    margin_h = round(60 * k)
    fields = [
        spec.name, face.family, round(spec.size * k), spec.primary, spec.secondary,
        spec.outline_colour, spec.back_colour, -1 if spec.role == "bold" else 0, 0, 0, 0,
        100, 100, 0, 0, spec.border_style, round(spec.outline * k, 1), 0,
        spec.alignment, margin_h, margin_h, margin_v, 1,
    ]  # fmt: skip
    return "Style: " + ",".join(str(f) for f in fields)


def _karaoke_text(cap: CaptionItem, shift: Callable[[float], float]) -> str:
    """``{\\kf<cs>}word`` per word; centiseconds run word-start to next word-start."""
    words = cap.words or []
    if not words:
        tokens = cap.text.split()
        span = max(0.04, cap.tl_end - cap.tl_start)
        step = span / max(1, len(tokens))
        starts = [cap.tl_start + i * step for i in range(len(tokens))]
        pairs = [(t, s, s + step) for t, s in zip(tokens, starts, strict=True)]
    else:
        pairs = [(w.w, w.t0, w.t1) for w in words]
    out: list[str] = []
    cursor = shift(cap.tl_start)
    for n, (token, t0, t1) in enumerate(pairs):
        t0, t1 = shift(t0), shift(t1)
        if n == 0 and t0 > cursor:  # words begin after the line appears
            out.append(f"{{\\k{round((t0 - cursor) * 100)}}}")
        end = shift(pairs[n + 1][1]) if n + 1 < len(pairs) else max(t1, t0 + 0.05)
        out.append(f"{{\\kf{max(1, round((end - t0) * 100))}}}{escape_text(token)} ")
    return "".join(out).rstrip()


def build_ass(
    timeline: Timeline,
    faces: Mapping[str, FontFace],
    *,
    time_map: Callable[[float], float] | None = None,
    duration: float | None = None,
) -> str:
    """The full ``.ass`` document for the timeline's non-rejected captions.

    ``time_map`` converts timeline seconds to output seconds (transitions overlap clips, so
    everything after one shifts earlier); ``duration`` clamps captions to the output length.
    """
    shift = time_map or (lambda t: t)
    width, height = timeline.width, timeline.height
    out = [
        "[Script Info]",
        "; Generated by CreatorAi. Captions come from the timeline.",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,"
        "Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,"
        "Alignment,MarginL,MarginR,MarginV,Encoding",
    ]
    for spec in STYLES.values():
        out.append(_style_line(spec, faces[spec.role], width, height))
    out += [
        "",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]
    limit = duration if duration is not None else shift(timeline.duration)
    for cap in sorted(timeline.tracks.captions, key=lambda c: c.tl_start):
        if cap.status == "rejected":
            continue
        start, end = shift(cap.tl_start), min(shift(cap.tl_end), limit)
        if end - start < 0.02:
            continue
        spec = STYLES[cap.style_override or timeline.caption_style]
        if spec.karaoke:
            text = _karaoke_text(cap, shift)
        else:
            text = escape_text(cap.text)
            text = text.upper() if spec.uppercase else text
        out.append(f"Dialogue: 0,{_ts(start)},{_ts(end)},{spec.name},,0,0,0,,{text}")
    return "\n".join(out) + "\n"
