# ruff: noqa: E501
"""Generate the golden cases the frontend timeline library is tested against.

``python scripts/dump_timeline_golden.py [out.json]`` runs the REAL backend implementation
(``app.services.timeline_service``) on hand-built timelines plus seeded random op sequences and records inputs and
outputs. ``frontend/src/lib/timeline/golden.json`` is that file; the vitest suite replays every case through the
TypeScript mirror (``frontend/src/lib/timeline/ops.ts``) and demands the same timeline, so the two implementations can
not drift. ``backend/tests/unit/test_timeline_golden.py`` fails when the checked-in file is stale.

New item ids come from a counter (``<prefix>_<hex>``, starting at 1000 for every case) so the output is deterministic.
"""

from __future__ import annotations

import itertools
import json
import random
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import REPO_ROOT
from app.errors import AppError
from app.schemas import timeline as tl_schema
from app.schemas.timeline import AudioItem, CaptionItem, OverlayItem, Timeline, VideoItem
from app.services import timeline_service as ts

A, B, M = "asset-a", "asset-b", "music-1"
DURATIONS = {A: 60.0, B: 30.0, M: 120.0}
SILENCES = {A: [(8.0, 12.0), (22.0, 24.0), (4.5, 5.6)], B: [(3.0, 4.5)]}
DEFAULT_OUT = REPO_ROOT / "frontend" / "src" / "lib" / "timeline" / "golden.json"

_op_counter = itertools.count(1000)  # ids created by the ops under test
_fixture_counter = itertools.count(1)  # ids of hand-built fixtures (never collide with the above)
_op_mode = False


def _next_id(prefix: str) -> str:
    n = next(_op_counter if _op_mode else _fixture_counter)
    return f"{prefix.rstrip('_')}_{n:010x}"


def reset_ids(start: int = 1000) -> None:
    global _op_counter
    _op_counter = itertools.count(start)


# the services import the generator by name, so patch both places
tl_schema.new_item_id = _next_id  # type: ignore[assignment]
ts.new_item_id = _next_id  # type: ignore[assignment]


def make_words() -> dict[str, list[dict[str, Any]]]:
    """Deterministic transcripts: a word every ~0.4 s with a pause after every 7th word."""
    out: dict[str, list[dict[str, Any]]] = {}
    for asset, total in ((A, 27.0), (B, 11.0)):
        t, n, ws = 0.2, 0, []
        while t < total:
            dur = 0.28 + 0.03 * (n % 4)
            ws.append(
                {
                    "word": f"w{n}" + ("." if n % 7 == 6 else ""),
                    "start": round(t, 3),
                    "end": round(t + dur, 3),
                }
            )
            t += dur + (1.1 if n % 7 == 6 else 0.1)
            n += 1
        out[asset] = ws
    return out


WORDS = make_words()


def video(src_in: float, src_out: float, asset: str | None = A, **kw: Any) -> VideoItem:
    base: dict[str, Any] = {
        "id": _next_id("v"),
        "source": "ai",
        "status": "suggested",
        "tl_start": 0,
    }
    base.update(kw)
    return VideoItem(asset_id=asset, src_in=src_in, src_out=src_out, **base)


def caption(t0: float, t1: float, text: str = "hello there", **kw: Any) -> CaptionItem:
    return CaptionItem(
        id=_next_id("c"), source="ai", status="suggested", tl_start=t0, tl_end=t1, text=text, **kw
    )


def make(items: list[VideoItem], **kw: Any) -> Timeline:
    t = Timeline.empty(**kw)
    t.tracks.video = items
    return ts.recompute_duration(t)


def base() -> Timeline:
    """A 5-15, A 20-26, B 2-10 (24 s) with captions, a music layer and overlays."""
    t = make([video(5, 15), video(20, 26), video(2, 10, B)])
    for n, v in enumerate(t.tracks.video):
        v.id = f"v_base{n}"  # stable ids: every base() call returns the same timeline
    t.tracks.captions = [caption(1, 3), caption(12, 14), caption(18, 21)]
    for n, cap in enumerate(t.tracks.captions):
        cap.id = f"c_base{n}"
    t.tracks.audio = [
        AudioItem(id="a_base0", source="ai", status="suggested", kind="music", asset_id=M,
                  src_in=0, src_out=24, tl_start=0, gain_db=-18),
        AudioItem(id="a_base1", source="user", status="accepted", kind="sfx", asset_id=M,
                  src_in=3, src_out=5, tl_start=9, gain_db=-6),
    ]  # fmt: skip
    t.tracks.overlays = [
        OverlayItem(id="o_base0", source="user", status="accepted", kind="text", tl_start=2, tl_end=5, text="Hi"),
        OverlayItem(id="o_base1", source="ai", status="suggested", kind="lower_third", tl_start=11, tl_end=15, text="Name"),
    ]  # fmt: skip
    return t


def with_captions(t: Timeline, style: str | None = None) -> Timeline:
    if style:
        t = ts.set_caption_style(t, style)  # type: ignore[arg-type]
    return ts.rebuild_captions(t, lambda asset: WORDS[asset])


def sponsor_timeline() -> Timeline:
    t = make(
        [
            video(0, 8),
            VideoItem(id=_next_id("v"), source="ai", status="suggested", kind="sponsor", asset_id=None,
                      placeholder=True, text="This episode is brought to you by a very good brand", src_in=0, src_out=6, tl_start=0),
            video(10, 18),
        ]
    )  # fmt: skip
    return t


def rich() -> Timeline:
    """Rebuilt captions, a rejected middle item, transitions, a crop and overlays on every item."""
    t = with_captions(base())
    t = ts.set_status(t, t.tracks.video[1].id, "rejected")
    t.tracks.video[2].transition_in = tl_schema.Transition(type="fade", dur=0.3)
    t.tracks.video[0].crop_x = 0.2
    return t


def ctx_json(ctx_words: bool = True) -> dict[str, Any]:
    return {
        "asset_durations": DURATIONS,
        "silences": {k: [list(x) for x in v] for k, v in SILENCES.items()},
        "words": WORDS if ctx_words else {},
    }


def op_ctx() -> ts.OpContext:
    return ts.OpContext(
        asset_durations=DURATIONS,
        silences={k: list(v) for k, v in SILENCES.items()},
        words_provider=lambda asset: WORDS[asset],
    )


def run(t: Timeline, op: str, params: dict[str, Any]) -> dict[str, Any]:
    global _op_mode
    _op_mode = True
    try:
        return {"timeline": ts.apply_op(t, op, params, op_ctx()).dump()}
    except AppError as exc:
        return {"error": {"code": exc.code, "op": (exc.details or {}).get("op")}}
    finally:
        _op_mode = False


INPUTS: dict[str, Any] = {}


def intern(data: dict[str, Any]) -> str:
    """Store an input timeline once and return its key (the file stays small)."""
    key = f"t{len(INPUTS):03d}"
    for k, v in INPUTS.items():
        if v == data:
            return k
    INPUTS[key] = data
    return key


def case(name: str, t: Timeline, op: str, params: dict[str, Any]) -> dict[str, Any]:
    reset_ids()
    return {
        "name": name,
        "input": intern(t.dump()),
        "op": op,
        "params": params,
        "expected": run(t, op, params),
    }


def violations(t: Timeline, durations: dict[str, float] | None) -> list[list[Any]]:
    return [[v.code, v.path, v.item_id] for v in ts.validate(t, durations)]


def validate_cases() -> list[dict[str, Any]]:
    out = []

    def add(name: str, t: Timeline, durations: dict[str, float] | None = DURATIONS) -> None:
        out.append(
            {
                "name": name,
                "input": intern(t.dump()),
                "asset_durations": durations,
                "expected": violations(t, durations),
            }
        )

    good = base()
    add("valid", good)
    add("valid without durations", good, None)
    t = base()
    t.tracks.video[1].tl_start = 11
    add("gap", t)
    t = base()
    t.tracks.video[1].tl_start = 9
    add("overlap", t)
    t = base()
    t.tracks.video[0].tl_start = 1
    add("first not at 0", t)
    t = base()
    t.tracks.video[1].tl_start = 30
    t.tracks.video[2].tl_start = 26
    add("gap then order", t)
    t = base()
    t.duration = 99
    add("duration mismatch", t)
    t = base()
    t.tracks.video[2].src_out = 40
    add("beyond asset", t)
    t = base()
    t.tracks.video[2].asset_id = "nope"
    add("unknown asset", t)
    t = base()
    t.tracks.captions[0].tl_end = 100
    add("caption past duration", t)
    t = base()
    t.tracks.captions[0].tl_start = 3
    t.tracks.captions[0].tl_end = 3
    add("caption empty range", t)
    t = base()
    t.tracks.overlays[0].tl_end = 99
    add("overlay past duration", t)
    t = base()
    t.tracks.captions[1].id = t.tracks.captions[0].id
    add("duplicate id", t)
    t = base()
    t.tracks.captions[0].id = "x_abc"
    add("bad prefix", t)
    t = base()
    t.width = 100
    add("dimensions", t)
    t = base()
    t.tracks.audio[0].src_out = 200
    add("audio beyond asset", t)
    t = base()
    t.tracks.video[0].src_out = 5
    add("empty source range", t)
    r = rich()
    add("rich valid", r)
    t = base()
    t.tracks.video[1].status = "rejected"
    add("rejected not relaid", t)
    return out


def op_cases() -> list[dict[str, Any]]:
    c: list[dict[str, Any]] = []
    b = base()
    rb = rich()
    cap = with_captions(base())
    kar = with_captions(base(), "karaoke")
    ids = [v.id for v in b.tracks.video]

    for keep in (0.05, 0.15, 0.4):
        c.append(case(f"tighten keep {keep}", b, "tighten_pauses", {"keep_sec": keep}))
    c.append(case("tighten default", b, "tighten_pauses", {}))
    c.append(case("tighten with captions", cap, "tighten_pauses", {"keep_sec": 0.1}))
    c.append(
        case(
            "tighten karaoke twice-ish",
            ts.apply_op(kar, "tighten_pauses", {"keep_sec": 0.4}, op_ctx()),
            "tighten_pauses",
            {"keep_sec": 0.05},
        )
    )
    c.append(case("tighten keep too high", b, "tighten_pauses", {"keep_sec": 0.9}))
    c.append(
        case(
            "tighten skips rejected and sponsor",
            sponsor_timeline(),
            "tighten_pauses",
            {"keep_sec": 0.1},
        )
    )
    c.append(case("tighten rich", rb, "tighten_pauses", {"keep_sec": 0.2}))

    c.append(case("trim first/last default", b, "trim", {"start_delta": 1, "end_delta": -1}))
    c.append(case("trim extend start", b, "trim", {"start_delta": -2}))
    c.append(case("trim extend end clamps to asset", b, "trim", {"end_delta": 10}))
    c.append(
        case("trim item", cap, "trim", {"item_id": ids[1], "start_delta": 0.5, "end_delta": -0.5})
    )
    c.append(case("trim too short", b, "trim", {"item_id": ids[1], "start_delta": 5.95}))
    c.append(case("trim unknown item", b, "trim", {"item_id": "v_nope", "start_delta": 1}))
    c.append(
        case("trim non video", b, "trim", {"item_id": b.tracks.captions[0].id, "start_delta": 1})
    )
    c.append(case("trim_clip alias", b, "trim_clip", {"start_delta": 0.5}))
    c.append(case("trim placeholder", sponsor_timeline(), "trim", {"start_delta": 0.5}))
    c.append(case("trim param out of range", b, "trim", {"start_delta": 11}))
    c.append(
        case(
            "trim with captions + overlays",
            rb,
            "trim",
            {"item_id": rb.tracks.video[0].id, "start_delta": 1.2, "end_delta": -0.4},
        )
    )

    for at in (3.0, 10.0, 12.5, 23.95, 0.05):
        c.append(case(f"split at {at}", cap, "split_item", {"at_tl": at}))
    c.append(case("split item_id", cap, "split_item", {"at_tl": 12.0, "item_id": ids[1]}))
    c.append(case("split sponsor", sponsor_timeline(), "split_item", {"at_tl": 10.0}))
    c.append(case("split past end", b, "split_item", {"at_tl": 99}))
    c.append(case("split rich", rb, "split_item", {"at_tl": 5.0}))

    for n, vid in enumerate(ids):
        c.append(case(f"delete video {n}", cap, "delete_item", {"item_id": vid}))
    c.append(case("delete caption", cap, "delete_item", {"item_id": cap.tracks.captions[0].id}))
    c.append(case("delete audio", b, "delete_item", {"item_id": b.tracks.audio[0].id}))
    c.append(case("delete overlay", b, "delete_item", {"item_id": b.tracks.overlays[0].id}))
    c.append(case("delete unknown", b, "delete_item", {"item_id": "v_zzz"}))
    c.append(case("delete rich", rb, "delete_item", {"item_id": rb.tracks.video[0].id}))

    for idx in (0, 1, 2, 9):
        c.append(
            case(f"reorder first to {idx}", cap, "reorder", {"item_id": ids[0], "to_index": idx})
        )
        c.append(
            case(
                f"reorder last to {idx}",
                rich(),
                "reorder",
                {"item_id": rb.tracks.video[2].id, "to_index": idx},
            )
        )
    c.append(
        case(
            "reorder caption", cap, "reorder", {"item_id": cap.tracks.captions[0].id, "to_index": 1}
        )
    )

    for status in ("rejected", "accepted", "suggested"):
        c.append(
            case(f"status video {status}", cap, "set_status", {"item_id": ids[1], "status": status})
        )
    c.append(
        case(
            "restore rejected video",
            rb,
            "set_status",
            {"item_id": rb.tracks.video[1].id, "status": "accepted"},
        )
    )
    c.append(
        case(
            "status caption",
            cap,
            "set_status",
            {"item_id": cap.tracks.captions[1].id, "status": "rejected"},
        )
    )
    c.append(
        case(
            "status audio", b, "set_status", {"item_id": b.tracks.audio[0].id, "status": "accepted"}
        )
    )
    c.append(case("status bad value", b, "set_status", {"item_id": ids[0], "status": "nope"}))

    c.append(case("accept all", rb, "accept_all", {}))
    c.append(case("toggle music off", b, "toggle_music", {"on": False}))
    c.append(case("toggle music on", ts.toggle_music(b, False), "toggle_music", {"on": True}))
    c.append(case("toggle music without music", make([video(0, 5)]), "toggle_music", {"on": True}))
    for style in ("karaoke", "minimal_bottom", "bold_center"):
        c.append(case(f"caption style {style}", cap, "set_caption_style", {"style": style}))
    ov = with_captions(base())
    ov.tracks.captions[0].style_override = "karaoke"
    c.append(
        case(
            "caption style clear overrides",
            ov,
            "set_caption_style",
            {"style": "minimal_bottom", "clear_overrides": True},
        )
    )
    c.append(
        case("caption style keep overrides", ov, "set_caption_style", {"style": "minimal_bottom"})
    )
    c.append(case("caption style bad", b, "set_caption_style", {"style": "wild"}))

    for style in ("bold_center", "karaoke", "minimal_bottom"):
        c.append(
            case(
                f"rebuild captions {style}",
                ts.set_caption_style(base(), style),
                "rebuild_captions",
                {},
            )
        )  # type: ignore[arg-type]
    c.append(case("rebuild max_words 2", b, "rebuild_captions", {"max_words": 2}))
    c.append(case("rebuild max_words 12", b, "rebuild_captions", {"max_words": 12}))
    c.append(case("rebuild max_words bad", b, "rebuild_captions", {"max_words": 99}))
    c.append(case("rebuild after trim", ts.trim(base(), 1.3, -0.7), "rebuild_captions", {}))
    c.append(case("rebuild with sponsor script", sponsor_timeline(), "rebuild_captions", {}))
    c.append(case("rebuild rich (rejected skipped)", rb, "rebuild_captions", {}))

    c.append(case("crop", b, "set_crop_x", {"item_id": ids[0], "crop_x": 0.8}))
    c.append(
        case("crop non video", b, "set_crop_x", {"item_id": b.tracks.captions[0].id, "crop_x": 0.8})
    )
    c.append(case("crop out of range", b, "set_crop_x", {"item_id": ids[0], "crop_x": 1.5}))

    new_item = video(30, 34).model_dump(mode="json")
    new_item["id"] = "v_inserted01"
    for at in (0, 4.0, 10.0, 17.95, 24.0, 99):
        c.append(
            case(f"ripple insert at {at}", cap, "ripple_insert", {"at_tl": at, "item": new_item})
        )
    c.append(case("ripple insert rich", rb, "ripple_insert", {"at_tl": 7.0, "item": new_item}))

    broken = base()
    broken.tracks.video[1].tl_start = 50
    broken.duration = 3
    c.append(case("recompute duration", broken, "recompute_duration", {}))
    c.append(case("unknown op", b, "explode", {}))
    return c


def sequence(seed: int, steps: int = 18) -> dict[str, Any]:
    """Seeded random op sequence; every step is recorded with its output (or its error)."""
    rng = random.Random(seed)
    t = with_captions(base()) if seed % 2 == 0 else rich()
    reset_ids()
    start = t.dump()
    recorded: list[dict[str, Any]] = []
    for _ in range(steps):
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
                "music",
                "delcap",
            ]
        )
        op, params = "recompute_duration", {}
        if choice == "tighten":
            op, params = "tighten_pauses", {"keep_sec": rng.choice([0.1, 0.2, 0.4])}
        elif choice == "trim":
            op, params = (
                "trim",
                {
                    "start_delta": round(rng.uniform(-1, 2), 3),
                    "end_delta": round(rng.uniform(-2, 1), 3),
                    **({"item_id": pick} if rng.random() < 0.5 else {}),
                },
            )
        elif choice == "split":
            op, params = "split_item", {"at_tl": round(rng.uniform(0, max(t.duration, 0.1)), 3)}
        elif choice == "delete" and len(video_items) > 1:
            op, params = "delete_item", {"item_id": pick}
        elif choice == "reorder":
            op, params = "reorder", {"item_id": pick, "to_index": rng.randrange(0, 6)}
        elif choice == "status" and len(ts.active(video_items)) > 1:
            op, params = (
                "set_status",
                {"item_id": pick, "status": rng.choice(["rejected", "accepted", "suggested"])},
            )
        elif choice == "caption":
            op, params = (
                "set_caption_style",
                {"style": rng.choice(["karaoke", "bold_center", "minimal_bottom"])},
            )
        elif choice == "accept":
            op, params = "accept_all", {}
        elif choice == "rebuild":
            op, params = "rebuild_captions", {}
        elif choice == "crop":
            op, params = "set_crop_x", {"item_id": pick, "crop_x": round(rng.random(), 3)}
        elif choice == "music":
            op, params = "toggle_music", {"on": rng.random() < 0.5}
        elif choice == "delcap" and t.tracks.captions:
            op, params = "delete_item", {"item_id": rng.choice(t.tracks.captions).id}
        result = run(t, op, params)
        recorded.append({"op": op, "params": params, "expected": result})
        if "timeline" in result:
            t = Timeline.model_validate(result["timeline"])
    return {"name": f"random seed {seed}", "input": intern(start), "steps": recorded}


def layer_change_cases() -> list[dict[str, Any]]:
    out = []
    b = base()
    pairs = {
        "accept all": (b, ts.accept_all(b)),
        "reject video": (b, ts.set_status(b, b.tracks.video[0].id, "rejected")),
        "reject music": (b, ts.toggle_music(b, False)),
        "no change": (b, b),
        "restore": (ts.set_status(b, b.tracks.video[0].id, "rejected"), b),
    }
    for name, (before, after) in pairs.items():
        changes = ts.layer_changes(before, after)
        out.append(
            {
                "name": name,
                "before": intern(before.dump()),
                "after": intern(after.dump()),
                "expected": changes,
            }
        )
    return out


def build() -> dict[str, Any]:
    global _fixture_counter
    reset_ids()
    _fixture_counter = itertools.count(1)
    INPUTS.clear()
    data = {
        "note": "Generated by backend/scripts/dump_timeline_golden.py from the real timeline_service. Do not edit.",
        "ctx": ctx_json(),
        "validate": validate_cases(),
        "cases": op_cases(),
        "sequences": [sequence(seed, 12) for seed in range(6)],
        "layer_changes": layer_change_cases(),
    }
    data["inputs"] = dict(INPUTS)
    return data


def render(data: dict[str, Any]) -> str:
    return json.dumps(data, separators=(",", ":")) + "\n"


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(build()))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
