"""Caption burn-in without libass: transparent full-frame PNGs drawn with Pillow.

Used when ffmpeg has no ``subtitles`` filter (Homebrew's ffmpeg 9, most minimal builds). The
visual rules mirror the ASS renderer (``captions_ass``) and the shared timing/style rules in
``captions_common`` decide which captions show and when, so the two cannot drift. See Plan.md 8.9:

* ``bold_center``    UPPERCASE white Montserrat Bold with a black outline, centred mid-frame.
* ``minimal_bottom`` Inter Regular on a 50 % black box, bottom (MarginV 160 / 60).
* ``karaoke``        Montserrat Bold, bottom MarginV 420, the word being spoken is yellow and the
                     rest white (one PNG state per word window; no word timings = static line).

Output is a :class:`CaptionTrack`: distinct visual states (one PNG each, de-duplicated) and, per
"lane" (a set of captions that never overlap in time), the ``[start, end)`` each state shows. The
render graph feeds each lane to ffmpeg as ONE ``concat`` demuxer input (:func:`concat_list`) and
overlays it once, so a 60 s karaoke clip with ~150 states is one decoder and one overlay filter
instead of 150 inputs held in memory.

Missing glyphs (emoji, CJK, ...) fall back to another system font per character and are dropped
when nothing has them; nothing here raises on odd text.
"""

from __future__ import annotations

import functools
import subprocess
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.media.captions_common import (
    STYLES,
    CaptionEvent,
    StyleSpec,
    caption_events,
    karaoke_words,
    scale_for,
)
from app.media.fonts import FontFace
from app.schemas.timeline import Timeline

MAX_WIDTH_FRACTION = 0.86  # caption block width, as a share of the frame width
MAX_LINES = 3
MIN_SHRINK = 0.5
MIN_STATE_SEC = 1 / 30  # shorter windows are merged into a neighbour
WHITE = (255, 255, 255, 255)
YELLOW = (255, 255, 0, 255)
BLACK = (0, 0, 0, 255)
BOX = (0, 0, 0, 128)
BLANK_NAME = "cap_blank.png"
EMOJI_SIZE = 109  # the only size bitmap colour-emoji fonts load at

_FALLBACK_FILES = [
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    "/usr/share/fonts/truetype/unifont/unifont.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Apple Color Emoji.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "C:/Windows/Fonts/seguiemj.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
]


@dataclass(frozen=True)
class VisualState:
    """Everything that decides the pixels of one PNG."""

    style: str
    tokens: tuple[str, ...]
    highlight: int | None = None  # karaoke: index of the yellow word


@dataclass(frozen=True)
class Slot:
    start: float
    end: float
    filename: str


@dataclass
class CaptionTrack:
    """``states`` maps PNG filename -> visual; ``lanes`` are non-overlapping slot sequences."""

    states: dict[str, VisualState] = field(default_factory=dict)
    lanes: list[list[Slot]] = field(default_factory=list)

    def lane_list_name(self, lane: int) -> str:
        return f"captions_{lane}.txt"

    @property
    def slot_count(self) -> int:
        return sum(len(lane) for lane in self.lanes)


# ── timing ──────────────────────────────────────────────────────────────────────────────────
def _plain_tokens(text: str, spec: StyleSpec) -> tuple[str, ...]:
    cleaned = text.replace("\\", "").replace("\r", " ").replace("\n", " ")
    return tuple((cleaned.upper() if spec.uppercase else cleaned).split())


def event_states(
    ev: CaptionEvent, shift: Callable[[float], float]
) -> list[tuple[float, float, VisualState]]:
    """``[(start, end, state)]`` for one caption: one state, or one per word window (karaoke)."""
    spec = ev.spec
    if not spec.karaoke:
        tokens = _plain_tokens(ev.caption.text, spec)
        return [(ev.start, ev.end, VisualState(spec.name, tokens))] if tokens else []
    words, timed = karaoke_words(ev.caption, shift)
    pairs = [(t.replace("\\", "").strip(), a) for t, a, _ in words]
    pairs = [(t, a) for t, a in pairs if t]
    if not pairs:
        return []
    tokens = tuple(t for t, _ in pairs)
    if not timed:
        return [(ev.start, ev.end, VisualState(spec.name, tokens))]
    starts: list[float] = []
    for _, a in pairs:  # monotonic, inside the line
        starts.append(min(ev.end, max(ev.start, a, starts[-1] if starts else ev.start)))
    segs: list[list] = []  # [start, end, highlight]
    if starts[0] > ev.start:
        segs.append([ev.start, starts[0], None])
    for k, a in enumerate(starts):
        segs.append([a, starts[k + 1] if k + 1 < len(starts) else ev.end, k])
    merged: list[list] = []
    carry: float | None = None  # start of a dropped leading sliver
    for a, b, hl in segs:
        if carry is not None:
            a, carry = carry, None
        if b - a < MIN_STATE_SEC:
            if merged:
                merged[-1][1] = b
            else:
                carry = a
            continue
        merged.append([a, b, hl])
    return [(a, b, VisualState(spec.name, tokens, hl)) for a, b, hl in merged]


def build_track(
    timeline: Timeline,
    time_map: Callable[[float], float] | None = None,
    duration: float | None = None,
) -> CaptionTrack:
    """The PNG states and when each shows, from the same events the ASS renderer uses."""
    shift = time_map or (lambda t: t)
    track = CaptionTrack()
    by_state: dict[VisualState, str] = {}
    lane_ends: list[float] = []
    for ev in caption_events(timeline, shift, duration):
        for a, b, state in event_states(ev, shift):
            name = by_state.get(state)
            if name is None:
                name = by_state[state] = f"cap_{len(by_state)}.png"
                track.states[name] = state
            lane = next((i for i, end in enumerate(lane_ends) if a >= end - 1e-6), None)
            if lane is None:
                lane = len(lane_ends)
                lane_ends.append(0.0)
                track.lanes.append([])
            lane_ends[lane] = b
            track.lanes[lane].append(Slot(a, b, name))
    return track


def concat_list(lane: list[Slot]) -> str:
    """ffconcat script: the lane's PNGs back to back, blank frames in the gaps."""
    lines = ["ffconcat version 1.0"]
    cursor = 0.0  # milliseconds, rounded per slot so durations never drift
    for slot in lane:
        a, b = round(slot.start * 1000), round(slot.end * 1000)
        if a > cursor:
            lines += [f"file '{BLANK_NAME}'", f"duration {(a - cursor) / 1000:.3f}"]
        if b > max(a, cursor):
            lines += [f"file '{slot.filename}'", f"duration {(b - max(a, cursor)) / 1000:.3f}"]
            cursor = b
    lines += [f"file '{BLANK_NAME}'", "duration 1.0"]  # last frame repeats to the end of the video
    return "\n".join(lines) + "\n"


# ── fonts ───────────────────────────────────────────────────────────────────────────────────
@functools.lru_cache(maxsize=64)
def _load(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, max(6, size))


def _glyph_bytes(font: ImageFont.FreeTypeFont, ch: str) -> bytes:
    tile = Image.new("L", (96, 96), 0)
    ImageDraw.Draw(tile).text((8, 8), ch, font=font, fill=255)
    return tile.tobytes()


@functools.lru_cache(maxsize=4096)
def _covers(path: str, ch: str) -> bool:
    """True when the font has a real glyph for ``ch`` (not its .notdef box)."""
    try:
        font = _load(path, 48)
        return _glyph_bytes(font, ch) != _glyph_bytes(font, "\uffff")
    except (OSError, ValueError):
        return False


@functools.lru_cache(maxsize=1024)
def _fallback_path(ch: str) -> str | None:
    candidates: list[str] = []
    try:
        out = subprocess.run(
            ["fc-match", "-f", "%{file}", f":charset={ord(ch):x}"],
            capture_output=True, text=True, timeout=5, check=False,
        )  # fmt: skip
        if out.returncode == 0 and out.stdout.strip():
            candidates.append(out.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    candidates += _FALLBACK_FILES
    for path in candidates:
        if Path(path).is_file() and (_is_emoji_font(path) or _covers(path, ch)):
            if _is_emoji_font(path) and not _emoji_ok(path, ch):
                continue
            return path
    return None


def _is_emoji_font(path: str) -> bool:
    return "emoji" in Path(path).name.lower()


@functools.lru_cache(maxsize=1024)
def _emoji_ok(path: str, ch: str) -> bool:
    try:
        font = ImageFont.truetype(path, EMOJI_SIZE)
        return (
            font.getbbox(ch, embedded_color=True) != (0, 0, 0, 0)
            and font.getmask(ch, mode="RGBA").getbbox() is not None
        )
    except (OSError, ValueError):
        return False


Run = tuple[str, str]  # (font path, text)


def _runs(text: str, primary: str) -> list[Run]:
    """Split ``text`` into runs that one font covers; uncovered characters are dropped."""
    runs: list[Run] = []
    for ch in text:
        if ch in "\u200d\ufe0f\ufe0e" or not ch.isprintable():
            continue
        path: str | None = primary if ch == " " or _covers(primary, ch) else _fallback_path(ch)
        if path is None:
            continue
        if runs and runs[-1][0] == path and not _is_emoji_font(path):
            runs[-1] = (path, runs[-1][1] + ch)
        else:
            runs.append((path, ch))
    return runs


def _run_width(run: Run, size: int) -> float:
    path, text = run
    if _is_emoji_font(path):
        return size * 1.15 * len(text)
    return _load(path, size).getlength(text)


# ── rendering ───────────────────────────────────────────────────────────────────────────────
def _layout(
    tokens: tuple[str, ...], primary: str, size: int, max_w: float
) -> tuple[list[list[int]], dict[int, list[Run]], dict[int, float], float]:
    runs = {i: _runs(t, primary) for i, t in enumerate(tokens)}
    widths = {i: sum(_run_width(r, size) for r in rs) for i, rs in runs.items()}
    space = _load(primary, size).getlength(" ")
    lines: list[list[int]] = []
    cur: list[int] = []
    cur_w = 0.0
    for i in range(len(tokens)):
        add = widths[i] if not cur else cur_w + space + widths[i]
        if cur and add > max_w:
            lines.append(cur)
            cur, cur_w = [i], widths[i]
        else:
            cur.append(i)
            cur_w = add
    if cur:
        lines.append(cur)
    return lines, runs, widths, space


def render_state(
    state: VisualState, width: int, height: int, faces: Mapping[str, FontFace]
) -> Image.Image:
    """The full-frame RGBA PNG for ``state`` (transparent except for the caption)."""
    spec = STYLES[state.style]
    k = scale_for(width, height)
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    if not state.tokens:
        return img
    primary = str(faces[spec.role].path)
    margin_h = round(60 * k)
    max_w = min(width * MAX_WIDTH_FRACTION, width - 2 * margin_h)
    box = spec.border_style == 3
    pad = round(spec.outline * k) if box else 0  # libass box padding = outline size
    size = max(8, round(spec.size * k))
    base = size
    while True:
        lines, runs, widths, space = _layout(state.tokens, primary, size, max_w - 2 * pad)
        too_wide = max(widths.values(), default=0.0) > max_w - 2 * pad
        if size <= 8 or (not too_wide and (len(lines) <= MAX_LINES or size <= base * MIN_SHRINK)):
            break
        size = max(8, int(size * 0.93))
    scale = size / base
    outline = 0 if box else max(1, round(spec.outline * k * scale))
    font = _load(primary, size)
    ascent, descent = font.getmetrics()
    line_h = ascent + descent
    block_h = line_h * len(lines) + 2 * pad
    margin_v = spec.margin_v_landscape if width > height else spec.margin_v
    if spec.name != "minimal_bottom":
        margin_v = round(margin_v * k)
    top = (height - block_h) / 2 if spec.alignment == 5 else height - margin_v - block_h
    draw = ImageDraw.Draw(img)
    line_w = [sum(widths[i] for i in ln) + space * (len(ln) - 1) for ln in lines]
    if box:
        for n, w in enumerate(line_w):
            x0 = (width - w) / 2 - pad
            y0 = top + n * line_h
            draw.rectangle([x0, y0, x0 + w + 2 * pad, y0 + line_h + 2 * pad], fill=BOX)
    for n, ln in enumerate(lines):
        x = (width - line_w[n]) / 2
        baseline = top + pad + n * line_h + ascent
        for i in ln:
            fill = YELLOW if state.highlight == i else WHITE
            for run in runs[i]:
                x = _draw_run(img, draw, run, x, baseline, size, fill, outline)
            x += space
    return img


def _draw_run(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    run: Run,
    x: float,
    baseline: float,
    size: int,
    fill: tuple[int, int, int, int],
    outline: int,
) -> float:
    path, text = run
    w = _run_width(run, size)
    try:
        if _is_emoji_font(path):
            glyphs = ImageFont.truetype(path, EMOJI_SIZE)
            step = w / max(1, len(text))
            for n, ch in enumerate(text):
                tile = Image.new("RGBA", (EMOJI_SIZE * 2, EMOJI_SIZE * 2), (0, 0, 0, 0))
                ImageDraw.Draw(tile).text((10, 10), ch, font=glyphs, embedded_color=True)
                box = tile.getbbox()
                if not box:
                    continue
                tile = tile.crop(box)
                factor = size * 1.05 / max(1, tile.height)
                tile = tile.resize(
                    (max(1, round(tile.width * factor)), max(1, round(tile.height * factor)))
                )
                img.alpha_composite(
                    tile, (max(0, round(x + n * step)), max(0, round(baseline - tile.height)))
                )
        else:
            draw.text(
                (x, baseline), text, font=_load(path, size), fill=fill, anchor="ls",
                stroke_width=outline, stroke_fill=BLACK,
            )  # fmt: skip
    except (OSError, ValueError):  # a font that cannot draw this text: skip it, never fail
        pass
    return x + w


def write_track(
    track: CaptionTrack, width: int, height: int, faces: Mapping[str, FontFace], dest: Path
) -> list[Path]:
    """Write every state PNG, the blank frame and one ffconcat list per lane into ``dest``."""
    dest.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    blank = dest / BLANK_NAME
    Image.new("RGBA", (width, height), (0, 0, 0, 0)).save(blank, "PNG", compress_level=1)
    written.append(blank)
    for name, state in track.states.items():
        path = dest / name
        render_state(state, width, height, faces).save(path, "PNG", compress_level=1)
        written.append(path)
    for n, lane in enumerate(track.lanes):
        path = dest / track.lane_list_name(n)
        path.write_text(concat_list(lane), encoding="utf-8")
        written.append(path)
    return written
