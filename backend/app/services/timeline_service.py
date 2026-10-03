"""Timeline validation and deterministic edit operations (Plan.md sections 6.1, 8.8, 8.9).

Pure functions on :class:`app.schemas.timeline.Timeline`: no database, no FastAPI. Every operation
returns a **new** timeline (the input is never mutated), re-lays the video track out gapless and
returns it with ``duration`` recomputed, so a result of any op passes :func:`validate` as long as
the input did.

Video track model: ``tracks.video`` is an ordered list. *Active* items (``status != "rejected"``)
are gapless from 0 (``tl_start[i+1] == tl_start[i] + (src_out - src_in)``) and make up
``duration``; a rejected item stays in the list, occupies no time and has ``tl_start`` equal to the
position where it would sit.

Captions and overlays are timeline-positioned, so an op that moves video (trim, delete, reorder,
reject, tighten, ripple insert) *retimes* them through source time: a caption is anchored to the
source range of the video item under its start, and re-placed wherever that source range lives
afterwards. Parts whose footage is gone are dropped or clipped. Audio items are never retimed.

Public signatures (all return a new ``Timeline``)::

    validate(timeline, asset_durations=None) -> list[TimelineViolation]
    ensure_valid(timeline, asset_durations=None) -> Timeline           # raises VALIDATION_ERROR
    recompute_duration(timeline)
    tighten_pauses(timeline, silences, keep_sec=0.15, *, source="ai")
    trim(timeline, start_delta=0, end_delta=0, *, item_id=None, asset_durations=None)
    set_caption_style(timeline, style, *, clear_overrides=False)
    toggle_music(timeline, on)
    split_item(timeline, at_tl, *, item_id=None)
    delete_item(timeline, item_id)
    reorder(timeline, item_id, to_index)
    set_status(timeline, item_id, status)
    accept_all(timeline)
    rebuild_captions(timeline, words_provider, *, max_words=None, source="ai", status="suggested")
    ripple_insert(timeline, at_tl, item)
    apply_op(timeline, op, params, ctx) -> Timeline                    # dispatcher for the API
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.errors import AppError
from app.schemas.timeline import (
    ID_PREFIX,
    SIZES,
    CaptionItem,
    CaptionStyle,
    CaptionWord,
    LayerStatus,
    OverlayItem,
    Timeline,
    TimelineViolation,
    VideoItem,
    new_item_id,
)

EPS = 1e-3  # tolerance (seconds) for every timeline comparison
MIN_PIECE_SEC = 0.1  # shortest video item an op may produce
MIN_LAYER_SEC = 0.04  # shortest caption/overlay kept after retiming
SPONSOR_WORDS_PER_SEC = 2.5
LINE_WORDS = {"bold_center": 3, "karaoke": 3, "minimal_bottom": 7}
MAX_LINE_SEC = 2.0
LINE_TAIL_SEC = 0.3
LINE_GAP_SEC = 0.02

Interval = tuple[float, float]
Silences = Mapping[str, Sequence[Interval]] | Sequence[Interval]
WordsProvider = Callable[[str], Sequence[Mapping[str, Any]]]  # asset_id -> [{word,start,end}]
LAYER_TRACKS = ("video", "captions", "audio", "overlays")


# ── validation ────────────────────────────────────────────────────────────────────────────────
def active(items: Iterable[Any]) -> list[Any]:
    """Items whose status is not ``rejected`` (these render and take timeline time)."""
    return [i for i in items if i.status != "rejected"]


def validate(
    timeline: Timeline, asset_durations: Mapping[str, float] | None = None
) -> list[TimelineViolation]:
    """Every broken invariant of Plan 6.1 (empty list = valid).

    ``asset_durations`` maps asset id -> seconds; source ranges are checked against it when given.
    Codes: DIMENSIONS, VIDEO_START, VIDEO_ORDER, VIDEO_GAP, VIDEO_OVERLAP, SRC_RANGE,
    SRC_BEYOND_ASSET, LAYER_RANGE, DUPLICATE_ID, ID_PREFIX, DURATION_MISMATCH, SPONSOR_PLACEHOLDER.
    """
    out: list[TimelineViolation] = []

    def add(code: str, message: str, path: str, item_id: str | None = None) -> None:
        out.append(TimelineViolation(code=code, message=message, path=path, item_id=item_id))

    if SIZES.get(timeline.aspect) != (timeline.width, timeline.height):
        w, h = SIZES[timeline.aspect]
        add("DIMENSIONS", f"{timeline.aspect} must be {w}x{h}", "width")

    seen: set[str] = set()
    for track in LAYER_TRACKS:
        for n, item in enumerate(getattr(timeline.tracks, track)):
            path = f"tracks.{track}[{n}]"
            if item.id in seen:
                add("DUPLICATE_ID", f"id {item.id!r} is used more than once", path, item.id)
            seen.add(item.id)
            if not item.id.startswith(ID_PREFIX[track]):
                add("ID_PREFIX", f"id must start with {ID_PREFIX[track]!r}", path, item.id)

    video = timeline.tracks.video
    cursor = 0.0
    previous: VideoItem | None = None
    for n, item in enumerate(video):
        path = f"tracks.video[{n}]"
        length = item.src_out - item.src_in
        if length <= 0:
            add("SRC_RANGE", "src_out must be greater than src_in", path, item.id)
        if item.kind == "sponsor" and item.asset_id is not None and item.placeholder:
            add(
                "SPONSOR_PLACEHOLDER",
                "a linked sponsor segment is not a placeholder",
                path,
                item.id,
            )
        if item.asset_id is not None and asset_durations is not None:
            limit = asset_durations.get(item.asset_id)
            if limit is None:
                add("SRC_BEYOND_ASSET", f"unknown asset {item.asset_id}", path, item.id)
            elif item.src_out > limit + EPS:
                add(
                    "SRC_BEYOND_ASSET",
                    f"src_out {item.src_out:g} is past the end of the asset ({limit:g} s)",
                    path,
                    item.id,
                )
        if item.status == "rejected":
            continue
        if previous is None:
            if abs(item.tl_start) > EPS:
                add("VIDEO_START", "the first video item must start at 0", path, item.id)
        else:
            if item.tl_start < previous.tl_start - EPS:
                add("VIDEO_ORDER", "video items must be sorted by tl_start", path, item.id)
            elif item.tl_start < cursor - EPS:
                add("VIDEO_OVERLAP", f"overlaps the previous item (ends {cursor:g})", path, item.id)
            elif item.tl_start > cursor + EPS:
                add("VIDEO_GAP", f"gap before this item (previous ends {cursor:g})", path, item.id)
        cursor = item.tl_start + length
        previous = item
    total = sum(i.src_out - i.src_in for i in active(video))
    if abs(timeline.duration - total) > EPS:
        add(
            "DURATION_MISMATCH",
            f"duration is {timeline.duration:g} but the video track adds up to {total:g}",
            "duration",
        )
    for track in ("captions", "overlays"):
        for n, layer in enumerate(getattr(timeline.tracks, track)):
            if layer.tl_start < -EPS or layer.tl_end <= layer.tl_start + 1e-9:
                add("LAYER_RANGE", "needs 0 <= tl_start < tl_end", f"tracks.{track}[{n}]", layer.id)
            elif layer.tl_end > timeline.duration + EPS:
                add(
                    "LAYER_RANGE",
                    f"tl_end {layer.tl_end:g} is past the timeline duration {timeline.duration:g}",
                    f"tracks.{track}[{n}]",
                    layer.id,
                )
    for n, audio in enumerate(timeline.tracks.audio):
        if audio.src_out <= audio.src_in:
            add("SRC_RANGE", "src_out must be greater than src_in", f"tracks.audio[{n}]", audio.id)
        limit = (asset_durations or {}).get(audio.asset_id)
        if limit is not None and audio.src_out > limit + EPS:
            add(
                "SRC_BEYOND_ASSET",
                f"src_out is past the end of the asset ({limit:g} s)",
                f"tracks.audio[{n}]",
                audio.id,
            )
    return out


def ensure_valid(
    timeline: Timeline, asset_durations: Mapping[str, float] | None = None
) -> Timeline:
    """Return ``timeline`` or raise ``VALIDATION_ERROR`` (422) with ``details.violations``."""
    violations = validate(timeline, asset_durations)
    if violations:
        raise AppError(
            "VALIDATION_ERROR",
            f"Timeline is invalid: {violations[0].message}",
            details={"violations": [v.model_dump() for v in violations]},
        )
    return timeline


def parse_timeline(raw: Any) -> Timeline:
    """Parse stored/received JSON, turning a structural error into the same 422 shape."""
    try:
        return Timeline.model_validate(raw)
    except ValidationError as exc:
        errors = [
            {"code": "SCHEMA", "message": e["msg"], "path": ".".join(str(p) for p in e["loc"])}
            for e in exc.errors()
        ]
        raise AppError(
            "VALIDATION_ERROR",
            f"Timeline is invalid: {errors[0]['message']}",
            details={"violations": errors},
        ) from exc


# ── internals ─────────────────────────────────────────────────────────────────────────────────
def _bad(op: str, message: str, **details: Any) -> AppError:
    return AppError("VALIDATION_ERROR", message, details={"op": op, **details})


def _copy(timeline: Timeline) -> Timeline:
    return timeline.model_copy(deep=True)


def _relayout(timeline: Timeline) -> None:
    """Gapless layout of the video track and the derived duration (in place)."""
    cursor = 0.0
    for item in timeline.tracks.video:
        item.tl_start = round(cursor, 6)
        if item.status != "rejected":
            cursor += item.src_out - item.src_in
    timeline.duration = round(cursor, 6)


def _find(timeline: Timeline, item_id: str) -> tuple[str, int]:
    for track in LAYER_TRACKS:
        for n, item in enumerate(getattr(timeline.tracks, track)):
            if item.id == item_id:
                return track, n
    raise AppError("NOT_FOUND", f"Timeline item {item_id} not found", details={"item_id": item_id})


def _source_key(item: VideoItem) -> str:
    return item.asset_id or item.id


@dataclass
class _Anchor:
    owner: VideoItem
    s0: float
    s1: float


def _owner_at(items: Sequence[VideoItem], t: float) -> VideoItem | None:
    owner = None
    for item in items:
        if item.tl_start <= t + EPS and t < item.tl_start + item.duration - EPS:
            owner = item
    return owner


def _place(anchor: _Anchor, new_items: Sequence[VideoItem]) -> tuple[float, float, float] | None:
    """New ``(t0, t1, shift)`` for a source-anchored range, or None when its footage is gone."""
    owner = anchor.owner
    candidates = [i for i in new_items if i.id == owner.id]
    candidates += [
        i
        for i in sorted(new_items, key=lambda i: i.tl_start)
        if i.id != owner.id and _source_key(i) == _source_key(owner)
    ]
    for item in candidates:
        a, b = max(anchor.s0, item.src_in), min(anchor.s1, item.src_out)
        if b - a >= MIN_LAYER_SEC:
            t0 = item.tl_start + (a - item.src_in)
            old_t0 = owner.tl_start + (a - owner.src_in)
            return t0, item.tl_start + (b - item.src_in), t0 - old_t0
    return None


def _retime_layers(old: Timeline, new: Timeline) -> None:
    """Re-place captions and overlays of ``new`` (still on ``old`` times) after video moved."""
    old_items, new_items = active(old.tracks.video), active(new.tracks.video)
    if not old_items:
        _clamp_layers(new)
        return
    keep_c: list[CaptionItem] = []
    for cap in new.tracks.captions:
        owner = _owner_at(old_items, cap.tl_start)
        if owner is None:
            keep_c.append(cap)
            continue
        s0 = owner.src_in + (cap.tl_start - owner.tl_start)
        s1 = owner.src_in + (min(cap.tl_end, owner.tl_start + owner.duration) - owner.tl_start)
        placed = _place(_Anchor(owner, s0, s1), new_items)
        if placed is None:
            continue
        t0, t1, shift = placed
        if cap.words:
            cap.words = [
                CaptionWord(w=w.w, t0=round(w.t0 + shift, 3), t1=round(w.t1 + shift, 3))
                for w in cap.words
                if t0 - EPS <= w.t0 + shift < t1
            ] or None
        cap.tl_start, cap.tl_end = round(t0, 6), round(t1, 6)
        keep_c.append(cap)
    new.tracks.captions = keep_c
    keep_o: list[OverlayItem] = []
    for over in new.tracks.overlays:
        owner = _owner_at(old_items, over.tl_start)
        if owner is None:
            keep_o.append(over)
            continue
        s0 = owner.src_in + (over.tl_start - owner.tl_start)
        end = min(over.tl_end, owner.tl_start + owner.duration)
        placed = _place(_Anchor(owner, s0, owner.src_in + (end - owner.tl_start)), new_items)
        if placed is None:
            continue
        over.tl_start, over.tl_end = round(placed[0], 6), round(placed[1], 6)
        keep_o.append(over)
    new.tracks.overlays = keep_o
    _clamp_layers(new)


def _clamp_layers(timeline: Timeline) -> None:
    """Keep captions/overlays inside ``[0, duration]``; drop the ones that vanish."""
    end = timeline.duration
    for track in ("captions", "overlays"):
        kept = []
        for layer in getattr(timeline.tracks, track):
            layer.tl_start = max(0.0, layer.tl_start)
            layer.tl_end = min(end, layer.tl_end)
            if layer.tl_end - layer.tl_start >= MIN_LAYER_SEC:
                kept.append(layer)
        setattr(timeline.tracks, track, kept)


def _finish(old: Timeline, new: Timeline) -> Timeline:
    """Re-layout the video track and retime layers from ``old``."""
    _relayout(new)
    _retime_layers(old, new)
    return new


# ── operations ────────────────────────────────────────────────────────────────────────────────
def recompute_duration(timeline: Timeline) -> Timeline:
    """Re-lay the video track out gapless and set ``duration`` (no layer retiming)."""
    out = _copy(timeline)
    _relayout(out)
    return out


def _intervals_for(silences: Silences, asset_id: str | None) -> list[Interval]:
    raw = silences.get(asset_id or "", []) if isinstance(silences, Mapping) else silences
    return sorted((float(s), float(e)) for s, e in raw if e > s)


def pause_ranges(
    src_in: float, src_out: float, silences: Sequence[Interval], keep_sec: float
) -> list[Interval]:
    """Source ranges left of ``[src_in, src_out]`` after dropping silences (Plan 8.8 step 7).

    Each silence loses everything except ``keep_sec / 2`` next to the speech on either side
    (silences too short to lose anything are kept whole); leading and trailing silence is trimmed
    the same way. Pieces shorter than ``MIN_PIECE_SEC`` are dropped.
    """
    half = max(0.0, keep_sec) / 2.0
    removals: list[Interval] = []
    for s, e in silences:
        if e <= src_in or s >= src_out:
            continue
        lo = src_in if s <= src_in else s + half
        hi = src_out if e >= src_out else e - half
        if hi - lo > EPS and (e - s > keep_sec + EPS or s <= src_in or e >= src_out):
            removals.append((max(lo, src_in), min(hi, src_out)))
    pieces: list[Interval] = []
    cursor = src_in
    for lo, hi in sorted(removals):
        if lo > cursor:
            pieces.append((cursor, lo))
        cursor = max(cursor, hi)
    if cursor < src_out:
        pieces.append((cursor, src_out))
    return [(round(a, 3), round(b, 3)) for a, b in pieces if b - a >= MIN_PIECE_SEC]


def tighten_pauses(
    timeline: Timeline, silences: Silences, keep_sec: float = 0.15, *, source: str = "ai"
) -> Timeline:
    """Drop silences inside every active clip item, keeping ``keep_sec`` of pause (half each side).

    ``silences`` is ``{asset_id: [(start, end), ...]}`` in source seconds (``assets.analysis
    ["silences"]``) or a flat list applied to every asset. The first piece of a split item keeps its
    id; later pieces are new ``ai`` items with ``reason="pause removed"``. Running it again with a
    smaller ``keep_sec`` shrinks the remaining pads; it never grows anything back.
    """
    if not 0 <= keep_sec <= 2:
        raise _bad("tighten_pauses", "keep_sec must be between 0 and 2", keep_sec=keep_sec)
    out = _copy(timeline)
    video: list[VideoItem] = []
    for item in out.tracks.video:
        if item.status == "rejected" or item.kind != "clip" or item.asset_id is None:
            video.append(item)
            continue
        pieces = pause_ranges(
            item.src_in, item.src_out, _intervals_for(silences, item.asset_id), keep_sec
        )
        if pieces == [(item.src_in, item.src_out)]:
            video.append(item)
            continue
        if not pieces:  # nothing but silence: the item disappears
            continue
        for n, (a, b) in enumerate(pieces):
            if n == 0:
                item.src_in, item.src_out = a, b
                video.append(item)
                continue
            piece = item.model_copy(deep=True)
            piece.id = new_item_id("v")
            piece.src_in, piece.src_out = a, b
            piece.transition_in = None
            piece.source = "ai" if source == "ai" else "user"
            piece.reason = "pause removed"
            video.append(piece)
    out.tracks.video = video
    return _finish(timeline, out)


def trim(
    timeline: Timeline,
    start_delta: float = 0.0,
    end_delta: float = 0.0,
    *,
    item_id: str | None = None,
    asset_durations: Mapping[str, float] | None = None,
) -> Timeline:
    """Move source edges: ``src_in += start_delta`` and ``src_out += end_delta`` (seconds).

    A positive ``start_delta`` or a negative ``end_delta`` shortens. Without ``item_id`` the start
    applies to the first active video item and the end to the last (the Twin's ``trim_clip``).
    """
    out = _copy(timeline)
    items = active(out.tracks.video)
    if not items:
        raise _bad("trim", "the timeline has no video to trim")
    if item_id is not None:
        track, n = _find(out, item_id)
        if track != "video":
            raise _bad("trim", "only video items can be trimmed", item_id=item_id)
        first = last = out.tracks.video[n]
    else:
        first, last = items[0], items[-1]
    if first.asset_id is None or last.asset_id is None:
        raise _bad("trim", "sponsor placeholders cannot be trimmed by source edge")
    first.src_in = round(max(0.0, first.src_in + start_delta), 3)
    last.src_out = round(last.src_out + end_delta, 3)
    for item in {first.id: first, last.id: last}.values():
        limit = (asset_durations or {}).get(item.asset_id or "")
        if limit is not None and item.src_out > limit:
            item.src_out = round(limit, 3)
        if item.src_out - item.src_in < MIN_PIECE_SEC:
            raise _bad("trim", "the trim would leave less than 0.1 s", item_id=item.id)
    return _finish(timeline, out)


def set_caption_style(
    timeline: Timeline, style: CaptionStyle, *, clear_overrides: bool = False
) -> Timeline:
    out = _copy(timeline)
    out.caption_style = style
    if clear_overrides:
        for cap in out.tracks.captions:
            cap.style_override = None
    return out


def toggle_music(timeline: Timeline, on: bool) -> Timeline:
    """Accept (``on``) or reject the AI music layer(s). Error if the timeline has none."""
    out = _copy(timeline)
    music = [a for a in out.tracks.audio if a.kind == "music"]
    if not music:
        raise _bad("toggle_music", "this timeline has no music layer")
    for item in music:
        item.status = "accepted" if on else "rejected"
    return out


def split_item(timeline: Timeline, at_tl: float, *, item_id: str | None = None) -> Timeline:
    """Cut the clip item under timeline time ``at_tl`` in two (the first keeps its id).

    Nothing moves, so captions and overlays stay exactly where they are.
    """
    out = _copy(timeline)
    for n, item in enumerate(out.tracks.video):
        if item.status == "rejected" or (item_id is not None and item.id != item_id):
            continue
        if item.tl_start + MIN_PIECE_SEC <= at_tl <= item.tl_start + item.duration - MIN_PIECE_SEC:
            if item.asset_id is None:
                raise _bad("split_item", "sponsor placeholders cannot be split", item_id=item.id)
            cut = round(item.src_in + (at_tl - item.tl_start), 3)
            tail = item.model_copy(deep=True)
            tail.id = new_item_id("v")
            tail.src_in, tail.transition_in, tail.reason = cut, None, None
            item.src_out = cut
            out.tracks.video.insert(n + 1, tail)
            _relayout(out)
            return out
    raise _bad(
        "split_item",
        "no video item can be split there (the cut must be at least 0.1 s from its edges)",
        at_tl=at_tl,
        item_id=item_id,
    )


def delete_item(timeline: Timeline, item_id: str) -> Timeline:
    """Remove any item. Deleting video ripples the track gapless and retimes the layers."""
    out = _copy(timeline)
    track, n = _find(out, item_id)
    del getattr(out.tracks, track)[n]
    if track == "video":
        return _finish(timeline, out)
    return out


def reorder(timeline: Timeline, item_id: str, to_index: int) -> Timeline:
    """Move a video item to ``to_index`` of the video list (clamped); layers follow it."""
    out = _copy(timeline)
    track, n = _find(out, item_id)
    if track != "video":
        raise _bad("reorder", "only video items can be reordered", item_id=item_id)
    item = out.tracks.video.pop(n)
    out.tracks.video.insert(max(0, min(to_index, len(out.tracks.video))), item)
    return _finish(timeline, out)


def set_status(timeline: Timeline, item_id: str, status: LayerStatus) -> Timeline:
    """Set a layer's status. Rejecting/restoring video ripples the track and retimes the layers."""
    out = _copy(timeline)
    track, n = _find(out, item_id)
    item = getattr(out.tracks, track)[n]
    if item.status == status:
        return out
    item.status = status
    if track == "video":
        return _finish(timeline, out)
    return out


def accept_all(timeline: Timeline) -> Timeline:
    """Every ``suggested`` layer becomes ``accepted`` (rejected ones stay rejected)."""
    out = _copy(timeline)
    for track in LAYER_TRACKS:
        for item in getattr(out.tracks, track):
            if item.status == "suggested":
                item.status = "accepted"
    return out


def ripple_insert(timeline: Timeline, at_tl: float, item: VideoItem) -> Timeline:
    """Insert ``item`` at timeline time ``at_tl``, pushing everything after it later.

    A clip item under ``at_tl`` is split there first. The inserted item's ``tl_start`` is set by
    the layout; captions and overlays after the point shift by the item's length.
    """
    out = _copy(timeline)
    new = item.model_copy(deep=True)
    index = len(out.tracks.video)
    for n, existing in enumerate(out.tracks.video):
        if existing.status == "rejected":
            continue
        end = existing.tl_start + existing.duration
        if at_tl <= existing.tl_start + EPS:
            index = n
            break
        if at_tl < end - EPS:
            if end - at_tl < MIN_PIECE_SEC or at_tl - existing.tl_start < MIN_PIECE_SEC:
                index = n if at_tl - existing.tl_start < end - at_tl else n + 1
                break
            out = split_item(out, at_tl, item_id=existing.id)
            index = n + 1
            break
    out.tracks.video.insert(index, new)
    return _finish(timeline, out)


# ── captions (Plan 8.9) ───────────────────────────────────────────────────────────────────────
def _norm_words(raw: Sequence[Mapping[str, Any]]) -> list[tuple[str, float, float]]:
    out = []
    for w in raw:
        text = str(w.get("word", w.get("w", ""))).strip()
        if text:
            out.append(
                (
                    text,
                    float(w.get("start", w.get("t0", 0.0))),
                    float(w.get("end", w.get("t1", 0.0))),
                )
            )
    return sorted(out, key=lambda w: (w[1], w[2]))


def group_lines(
    words: Sequence[tuple[str, float, float]], style: str, max_words: int | None = None
) -> list[list[tuple[str, float, float]]]:
    """Lines of at most ``3`` (bold_center/karaoke) or ``7`` (minimal_bottom) words and 2 s."""
    limit = max_words or LINE_WORDS.get(style, 3)
    lines: list[list[tuple[str, float, float]]] = []
    current: list[tuple[str, float, float]] = []
    for word in words:
        if current and (len(current) >= limit or word[2] - current[0][1] > MAX_LINE_SEC):
            lines.append(current)
            current = []
        current.append(word)
    if current:
        lines.append(current)
    return lines


def _item_lines(
    item: VideoItem, words: Sequence[tuple[str, float, float]], style: str, max_words: int | None
) -> list[tuple[float, float, list[tuple[str, float, float]]]]:
    """Timeline-time lines for one video item: ``(t0, t1, [(word, t0, t1)])``."""
    inside = []
    for text, start, end in words:
        mid = (start + end) / 2
        if item.src_in <= mid < item.src_out:
            t0 = item.tl_start + max(start, item.src_in) - item.src_in
            t1 = item.tl_start + min(max(end, start), item.src_out) - item.src_in
            inside.append((text, t0, max(t1, t0 + 0.01)))
    item_end = item.tl_start + item.duration
    lines = group_lines(inside, style, max_words)
    out = []
    for n, line in enumerate(lines):
        t0, t1 = line[0][1], line[-1][2]
        nxt = lines[n + 1][0][1] - LINE_GAP_SEC if n + 1 < len(lines) else item_end
        end = max(t1, min(t1 + LINE_TAIL_SEC, nxt, item_end))
        out.append((round(t0, 3), round(min(end, item_end), 3), line))
    return out


def rebuild_captions(
    timeline: Timeline,
    words_provider: WordsProvider,
    *,
    max_words: int | None = None,
    source: str = "ai",
    status: LayerStatus = "suggested",
) -> Timeline:
    """Replace the caption track with captions built from word timestamps (Plan 8.9).

    ``words_provider(asset_id)`` returns ``[{word, start, end}]`` in source seconds. For every
    active clip item the words inside ``[src_in, src_out]`` are mapped to timeline time and grouped
    into lines; sponsor placeholders with ``text`` get lines estimated at 2.5 words/second.
    """
    out = _copy(timeline)
    style = out.caption_style
    cache: dict[str, list[tuple[str, float, float]]] = {}
    captions: list[CaptionItem] = []
    for item in active(out.tracks.video):
        if item.asset_id is None:
            words = _estimate_words(item.text or "", item.duration)
        else:
            if item.asset_id not in cache:
                cache[item.asset_id] = _norm_words(words_provider(item.asset_id))
            words = cache[item.asset_id]
        base = item if item.asset_id else item.model_copy(update={"src_in": 0.0})
        for t0, t1, line in _item_lines(base, words, style, max_words):
            if t1 - t0 < MIN_LAYER_SEC:
                continue
            captions.append(
                CaptionItem(
                    id=new_item_id("c"),
                    source="ai" if source == "ai" else "user",
                    status=status,
                    reason="from transcript" if item.asset_id else "sponsor script",
                    tl_start=t0,
                    tl_end=t1,
                    text=" ".join(w[0] for w in line),
                    words=[CaptionWord(w=w[0], t0=round(w[1], 3), t1=round(w[2], 3)) for w in line],
                )
            )
    out.tracks.captions = captions
    return out


def _estimate_words(text: str, duration: float) -> list[tuple[str, float, float]]:
    tokens = re.findall(r"\S+", text)
    out, cursor = [], 0.0
    step = 1.0 / SPONSOR_WORDS_PER_SEC
    for token in tokens:
        if cursor >= duration - 1e-6:
            break
        out.append((token, round(cursor, 3), round(min(cursor + step, duration), 3)))
        cursor += step
    return out


# ── dispatcher for the API (/clips/{id}/edit/ops, Twin actions) ──────────────────────────────
@dataclass
class OpContext:
    """Data an op may need beyond the timeline itself."""

    asset_durations: Mapping[str, float] = field(default_factory=dict)
    silences: Mapping[str, Sequence[Interval]] = field(default_factory=dict)
    words_provider: WordsProvider | None = None


class _Params(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Tighten(_Params):
    keep_sec: float = Field(default=0.15, ge=0.05, le=0.4)


class _Trim(_Params):
    start_delta: float = Field(default=0.0, ge=-10, le=10)
    end_delta: float = Field(default=0.0, ge=-10, le=10)
    item_id: str | None = None


class _Style(_Params):
    style: CaptionStyle
    clear_overrides: bool = False


class _On(_Params):
    on: bool


class _Split(_Params):
    at_tl: float = Field(ge=0)
    item_id: str | None = None


class _ItemId(_Params):
    item_id: str


class _Reorder(_Params):
    item_id: str
    to_index: int = Field(ge=0)


class _Status(_Params):
    item_id: str
    status: Literal["suggested", "accepted", "rejected"]


class _Rebuild(_Params):
    max_words: int | None = Field(default=None, ge=1, le=12)


class _Crop(_Params):
    item_id: str
    crop_x: float = Field(ge=0, le=1)


class _Insert(_Params):
    at_tl: float = Field(ge=0)
    item: dict[str, Any]


class _NoParams(_Params):
    pass


def _set_crop(timeline: Timeline, item_id: str, crop_x: float) -> Timeline:
    out = _copy(timeline)
    track, n = _find(out, item_id)
    if track != "video":
        raise _bad("set_crop_x", "only video items have crop_x", item_id=item_id)
    out.tracks.video[n].crop_x = crop_x
    return out


def _words(ctx: OpContext) -> WordsProvider:
    if ctx.words_provider is None:
        raise _bad("rebuild_captions", "no transcript words are available for this timeline")
    return ctx.words_provider


OPS: dict[str, tuple[type[_Params], Callable[[Timeline, Any, OpContext], Timeline]]] = {
    "tighten_pauses": (_Tighten, lambda t, p, c: tighten_pauses(t, c.silences, p.keep_sec)),
    "trim": (
        _Trim,
        lambda t, p, c: trim(
            t, p.start_delta, p.end_delta, item_id=p.item_id, asset_durations=c.asset_durations
        ),
    ),
    "set_caption_style": (
        _Style,
        lambda t, p, c: set_caption_style(t, p.style, clear_overrides=p.clear_overrides),
    ),
    "toggle_music": (_On, lambda t, p, c: toggle_music(t, p.on)),
    "split_item": (_Split, lambda t, p, c: split_item(t, p.at_tl, item_id=p.item_id)),
    "delete_item": (_ItemId, lambda t, p, c: delete_item(t, p.item_id)),
    "reorder": (_Reorder, lambda t, p, c: reorder(t, p.item_id, p.to_index)),
    "set_status": (_Status, lambda t, p, c: set_status(t, p.item_id, p.status)),
    "accept_all": (_NoParams, lambda t, p, c: accept_all(t)),
    "rebuild_captions": (
        _Rebuild,
        lambda t, p, c: rebuild_captions(t, _words(c), max_words=p.max_words),
    ),
    "set_crop_x": (_Crop, lambda t, p, c: _set_crop(t, p.item_id, p.crop_x)),
    "ripple_insert": (
        _Insert,
        lambda t, p, c: ripple_insert(t, p.at_tl, VideoItem.model_validate(p.item)),
    ),
    "recompute_duration": (_NoParams, lambda t, p, c: recompute_duration(t)),
}
OPS["trim_clip"] = OPS["trim"]  # Twin action name (Plan 6.8)


def apply_op(timeline: Timeline, op: str, params: Mapping[str, Any], ctx: OpContext) -> Timeline:
    """Validate ``params`` for ``op`` and run it. Unknown ops and bad params raise 422."""
    entry = OPS.get(op)
    if entry is None:
        raise _bad(op, f"unknown op {op!r}", allowed=sorted(OPS))
    model, fn = entry
    try:
        parsed = model.model_validate(dict(params or {}))
    except ValidationError as exc:
        raise _bad(
            op,
            f"invalid params: {exc.errors()[0]['msg']}",
            errors=[
                {"path": ".".join(map(str, e["loc"])), "message": e["msg"]} for e in exc.errors()
            ],
        ) from exc
    return fn(timeline, parsed, ctx)


def layer_changes(before: Timeline, after: Timeline) -> list[dict[str, Any]]:
    """Layers whose status changed between two timelines (for ``layer_accepted``/``_rejected``).

    One entry per ``(new status, track, kind)`` with the affected ids; layers that only exist in
    ``after`` count when they start out ``accepted``/``rejected`` (a ``suggested`` birth is not a
    user decision).
    """
    prior = {
        item.id: item.status for track in LAYER_TRACKS for item in getattr(before.tracks, track)
    }
    groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    for track in LAYER_TRACKS:
        for item in getattr(after.tracks, track):
            old = prior.get(item.id)
            if (
                item.status == old
                or item.status == "suggested"
                or (old is None and item.status == "accepted" and item.source == "user")
            ):
                continue
            kind = getattr(item, "kind", track)
            key = (item.status, track, str(kind))
            group = groups.setdefault(
                key,
                {
                    "status": item.status,
                    "layer": track,
                    "kind": str(kind),
                    "item_ids": [],
                    "sources": set(),
                },
            )
            group["item_ids"].append(item.id)
            group["sources"].add(item.source)
    out = []
    for group in groups.values():
        group["sources"] = sorted(group["sources"])
        out.append(group)
    return out
