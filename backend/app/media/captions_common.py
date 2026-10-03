"""Caption rules shared by the ASS (libass) and PNG (Pillow) renderers.

Both renderers must agree on WHICH captions show, WHEN, and in WHAT style, so that logic lives
here and nothing else decides it: :func:`caption_events` (rejected captions dropped, time map and
output-duration clamp applied, style chosen) and :func:`karaoke_words` (per-word timing). Styles
and sizes are for a 1920 px tall frame and scale with the output height (x0.6 for 16:9).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from app.schemas.timeline import CaptionItem, Timeline

BASE_HEIGHT = 1920
LANDSCAPE_SCALE = 0.6
WHITE = "&H00FFFFFF"
YELLOW = "&H0000FFFF"  # ASS colours are &HAABBGGRR
BLACK = "&H00000000"
BOX = "&H80000000"  # 50 % transparent black
MIN_EVENT_SEC = 0.02


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


@dataclass(frozen=True)
class CaptionEvent:
    """One caption as it appears in the output: ``[start, end)`` in output seconds."""

    caption: CaptionItem
    spec: StyleSpec
    start: float
    end: float


def caption_events(
    timeline: Timeline,
    time_map: Callable[[float], float] | None = None,
    duration: float | None = None,
) -> list[CaptionEvent]:
    """Non-rejected captions in start order, mapped to output time and clamped to ``duration``."""
    shift = time_map or (lambda t: t)
    limit = duration if duration is not None else shift(timeline.duration)
    events: list[CaptionEvent] = []
    for cap in sorted(timeline.tracks.captions, key=lambda c: c.tl_start):
        if cap.status == "rejected":
            continue
        start, end = shift(cap.tl_start), min(shift(cap.tl_end), limit)
        if end - start < MIN_EVENT_SEC:
            continue
        events.append(
            CaptionEvent(cap, STYLES[cap.style_override or timeline.caption_style], start, end)
        )
    return events


def karaoke_words(
    cap: CaptionItem, shift: Callable[[float], float]
) -> tuple[list[tuple[str, float, float]], bool]:
    """``([(token, start, end)], timed)`` in output seconds for a karaoke line.

    ``timed`` is False when the caption has no word timings: the tokens are then spread evenly
    over the line (the ASS renderer sweeps them; the PNG renderer shows the line statically).
    """
    words = cap.words or []
    if not words:
        tokens = cap.text.split()
        span = max(0.04, cap.tl_end - cap.tl_start)
        step = span / max(1, len(tokens))
        pairs = [
            (t, cap.tl_start + i * step, cap.tl_start + (i + 1) * step)
            for i, t in enumerate(tokens)
        ]
        return [(t, shift(a), shift(b)) for t, a, b in pairs], False
    return [(w.w, shift(w.t0), shift(w.t1)) for w in words], True
