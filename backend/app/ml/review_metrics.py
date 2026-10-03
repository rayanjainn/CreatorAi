"""Deterministic Director review metrics (Plan.md section 8.7). Pure functions, no I/O.

Inputs are on one *global timeline* (assets concatenated in upload order; ``spans`` maps a global
second back to ``(asset_id, asset_second)``):

* ``segments``: ``[{"start", "end", "text", "words"?: [{"word", "start", "end"}]}]``;
* ``silences``: ``[(start, end)]``;
* ``beats``: ``[{"scene_idx", "beat_idx", "text"}]`` of the current script, and ``matches``:
  ``[{"scene_idx", "beat_idx", "status", "asset_id"?, "start_sec"?, "end_sec"?}]`` from
  ``beat_matches``. Without any match row coverage is ``None`` (unknown) and ``overall`` is
  renormalised over the scores that exist.

Formulas (weights ``0.25 hook + 0.20 clarity + 0.20 pacing + 0.25 coverage + 0.10 cta``):

``wpm`` = words / (duration / 60); ``pause_ratio`` = total silence of at least 0.6 s / duration;
the first sentence of the speech in the first 15 s feeds ``hook_signals``; fillers are
``um, uh, you know, like, basically, actually, so``; the CTA must appear in the last 20 % of the
transcript *words*. Scores are rounded to one decimal.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from collections.abc import Iterable, Sequence
from itertools import pairwise
from typing import Any

from app.ml.hooks import hook_signals

WEIGHTS: dict[str, float] = {
    "hook": 0.25,
    "clarity": 0.20,
    "pacing": 0.20,
    "coverage": 0.25,
    "cta": 0.10,
}
FILLERS = ("um", "uh", "you know", "like", "basically", "actually", "so")
_SINGLE_FILLERS = frozenset(f for f in FILLERS if " " not in f)
CTA_PHRASES = (
    "subscribe",
    "follow",
    "comment",
    "link in",
    "check out",
    "sign up",
    "download",
    "share",
)
HOOK_WINDOW_SEC = 15.0
PAUSE_MIN_SEC = 0.6
LONG_SILENCE_SEC = 2.5
FILLER_WINDOW_SEC = 20.0
COVERAGE_CREDIT = {"matched": 1.0, "confirmed": 1.0, "weak": 0.5}

_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’-]*")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_CTA_RES = [re.compile(rf"\b{re.escape(p)}\b") for p in CTA_PHRASES]


def tokens(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(text or "")]


def count_fillers(words: Sequence[str]) -> int:
    """Occurrences of the filler list in a lower-case token sequence (``you know`` is a bigram)."""
    singles = sum(1 for w in words if w in _SINGLE_FILLERS)
    bigrams = sum(1 for a, b in pairwise(words) if a == "you" and b == "know")
    return singles + bigrams


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _r(x: float) -> float:
    return round(x, 1)


def silence_total(silences: Iterable[tuple[float, float]], min_len: float = PAUSE_MIN_SEC) -> float:
    return sum(e - s for s, e in silences if e - s >= min_len)


def speech_in_window(segments: Sequence[dict[str, Any]], start: float, end: float) -> str:
    """Words spoken in ``[start, end)``: word times when present, else segments starting inside."""
    parts: list[str] = []
    for seg in segments:
        words = seg.get("words") or []
        if words:
            parts.extend(str(w["word"]) for w in words if start <= float(w["start"]) < end)
        elif start <= float(seg["start"]) < end:
            parts.append(str(seg["text"]))
    return " ".join(parts)


def sentence_stats(segments: Sequence[dict[str, Any]], n_words: int) -> tuple[int, float]:
    """``(sentence_count, avg_sentence_words)``; unpunctuated transcripts count segments."""
    text = " ".join(str(s["text"]).strip() for s in segments)
    sentences = [s for s in _SENTENCE_END.split(text) if s.strip()]
    if not re.search(r"[.!?]", text):
        sentences = [str(s["text"]) for s in segments if str(s["text"]).strip()]
    n = max(1, len(sentences))
    return n, n_words / n


def score_hook(segments: Sequence[dict[str, Any]]) -> tuple[float, dict[str, Any]]:
    text = speech_in_window(segments, 0.0, HOOK_WINDOW_SEC)
    first_start = min(
        (
            float(s["words"][0]["start"]) if s.get("words") else float(s["start"])
            for s in segments
            if str(s["text"]).strip()
        ),
        default=None,
    )
    signals = hook_signals(text)
    quick = 1.0 if first_start is not None and first_start <= 2.0 else 0.6
    score = 100 * (0.7 * signals + 0.3 * quick)
    return score, {
        "hook_signals": round(signals, 3),
        "first_speech_sec": None if first_start is None else round(first_start, 2),
        "hook_text": text,
    }


def score_pacing(
    words: int, duration: float, silences: Sequence[tuple[float, float]]
) -> tuple[float, dict[str, Any]]:
    wpm = words / (duration / 60) if duration > 0 else 0.0
    pause_ratio = silence_total(silences) / duration if duration > 0 else 0.0
    score = 100 * (
        0.5 * (1 - min(1.0, abs(wpm - 160) / 80)) + 0.5 * (1 - min(1.0, pause_ratio / 0.25))
    )
    return score, {"wpm": round(wpm, 1), "pause_ratio": round(pause_ratio, 4)}


def score_clarity(
    segments: Sequence[dict[str, Any]], words: Sequence[str]
) -> tuple[float, dict[str, Any]]:
    fillers = count_fillers(words)
    per_100 = 100 * fillers / len(words) if words else 0.0
    _, avg_sentence = sentence_stats(segments, len(words))
    score = 100 * (
        0.6 * (1 - min(1.0, per_100 / 8)) + 0.4 * (1 - min(1.0, max(0.0, avg_sentence - 18) / 18))
    )
    return score, {
        "fillers": fillers,
        "fillers_per_100_words": round(per_100, 2),
        "avg_sentence_words": round(avg_sentence, 2),
    }


def score_cta(words: Sequence[str]) -> tuple[float, dict[str, Any]]:
    if not words:
        return 40.0, {"cta_found": False, "cta_phrase": None}
    tail_n = max(1, math.ceil(0.2 * len(words)))
    tail = " ".join(words[-tail_n:])
    for phrase, pattern in zip(CTA_PHRASES, _CTA_RES, strict=True):
        if pattern.search(tail):
            return 100.0, {"cta_found": True, "cta_phrase": phrase}
    return 40.0, {"cta_found": False, "cta_phrase": None}


def beat_credit(status: str | None) -> float:
    return COVERAGE_CREDIT.get(status or "", 0.0)


def score_coverage(
    beats: Sequence[dict[str, Any]], matches: Sequence[dict[str, Any]]
) -> tuple[float | None, dict[str, Any]]:
    """``100 * (matched + confirmed + 0.5 * weak) / total beats``; ``None`` without match rows."""
    if not beats or not matches:
        return None, {"coverage_known": False, "beats": len(beats), "matched_rows": len(matches)}
    status_by_beat = {(m["scene_idx"], m["beat_idx"]): m.get("status") for m in matches}
    credit = sum(beat_credit(status_by_beat.get((b["scene_idx"], b["beat_idx"]))) for b in beats)
    counts: dict[str, int] = defaultdict(int)
    for b in beats:
        counts[status_by_beat.get((b["scene_idx"], b["beat_idx"])) or "unmatched"] += 1
    return 100 * credit / len(beats), {
        "coverage_known": True,
        "beats": len(beats),
        "beat_status_counts": dict(counts),
    }


def combine_overall(scores: dict[str, float | None]) -> float:
    """Weighted mean over the scores that are not ``None`` (weights renormalised)."""
    present = {k: v for k, v in scores.items() if v is not None and k in WEIGHTS}
    total = sum(WEIGHTS[k] for k in present)
    if total <= 0:
        return 0.0
    return sum(WEIGHTS[k] * float(v) for k, v in present.items()) / total  # type: ignore[arg-type]


# ── candidate issues ──────────────────────────────────────────────────────────────────────────
def locate(
    spans: Sequence[dict[str, Any]] | None, at_sec: float
) -> tuple[str | None, float | None]:
    """Map a global second to ``(asset_id, asset_second)`` using the asset spans."""
    for span in spans or []:
        if span["offset"] <= at_sec <= span["offset"] + span["duration"]:
            return span.get("asset_id"), round(at_sec - span["offset"], 3)
    return None, None


def _scene_for(
    matches: Sequence[dict[str, Any]], asset_id: str | None, asset_sec: float | None
) -> int | None:
    if asset_id is None or asset_sec is None:
        return None
    for m in matches:
        if (
            m.get("asset_id") == asset_id
            and m.get("start_sec") is not None
            and m.get("end_sec") is not None
            and m["start_sec"] <= asset_sec <= m["end_sec"]
            and m.get("status") in COVERAGE_CREDIT
        ):
            return int(m["scene_idx"])
    return None


def scene_coverages(
    beats: Sequence[dict[str, Any]], matches: Sequence[dict[str, Any]]
) -> dict[int, float]:
    status_by_beat = {(m["scene_idx"], m["beat_idx"]): m.get("status") for m in matches}
    per_scene: dict[int, list[float]] = defaultdict(list)
    for b in beats:
        per_scene[int(b["scene_idx"])].append(
            beat_credit(status_by_beat.get((b["scene_idx"], b["beat_idx"])))
        )
    return {idx: 100 * sum(v) / len(v) for idx, v in per_scene.items()}


def candidate_issues(
    *,
    segments: Sequence[dict[str, Any]],
    silences: Sequence[tuple[float, float]],
    duration: float,
    scores: dict[str, float | None],
    cta_found: bool,
    beats: Sequence[dict[str, Any]],
    matches: Sequence[dict[str, Any]],
    spans: Sequence[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Top-3 silences >= 2.5 s, 3 lowest-coverage scenes, weak hook, missing CTA, filler windows."""
    out: list[dict[str, Any]] = []

    long_silences = sorted(
        ((s, e) for s, e in silences if e - s >= LONG_SILENCE_SEC), key=lambda se: -(se[1] - se[0])
    )[:3]
    for start, end in long_silences:
        asset_id, asset_sec = locate(spans, start)
        out.append(
            {
                "type": "pacing",
                "severity": "high" if end - start >= 5 else "medium",
                "at_sec": round(start, 2),
                "duration_sec": round(end - start, 2),
                "scene_idx": _scene_for(matches, asset_id, asset_sec),
                "asset_id": asset_id,
                "asset_sec": asset_sec,
                "detail": f"{end - start:.1f} s of silence",
            }
        )

    if matches:
        low = sorted(
            ((idx, cov) for idx, cov in scene_coverages(beats, matches).items() if cov < 100),
            key=lambda ic: (ic[1], ic[0]),
        )[:3]
        for idx, cov in low:
            out.append(
                {
                    "type": "coverage",
                    "severity": "high" if cov < 40 else "medium" if cov < 70 else "low",
                    "at_sec": None,
                    "scene_idx": idx,
                    "asset_id": None,
                    "asset_sec": None,
                    "detail": f"scene {idx} coverage {cov:.0f}%",
                }
            )

    hook = scores.get("hook")
    if hook is not None and hook < 60:
        first = min((float(s["start"]) for s in segments), default=0.0)
        asset_id, asset_sec = locate(spans, first)
        out.append(
            {
                "type": "hook",
                "severity": "high" if hook < 40 else "medium",
                "at_sec": round(first, 2),
                "scene_idx": 0 if matches else None,
                "asset_id": asset_id,
                "asset_sec": asset_sec,
                "detail": f"hook score {hook:.0f}",
            }
        )

    if not cta_found:
        asset_id, asset_sec = locate(spans, duration)
        out.append(
            {
                "type": "cta",
                "severity": "medium",
                "at_sec": round(duration, 2),
                "scene_idx": None,
                "asset_id": asset_id,
                "asset_sec": asset_sec,
                "detail": "no call to action in the last 20% of the transcript",
            }
        )

    out.extend(_filler_windows(segments, spans))
    return out


def _filler_windows(
    segments: Sequence[dict[str, Any]], spans: Sequence[dict[str, Any]] | None
) -> list[dict[str, Any]]:
    buckets: dict[int, list[str]] = defaultdict(list)
    for seg in segments:
        buckets[int(float(seg["start"]) // FILLER_WINDOW_SEC)].extend(tokens(str(seg["text"])))
    found: list[tuple[float, int, int]] = []
    for bucket, words in buckets.items():
        fillers = count_fillers(words)
        density = 100 * fillers / len(words) if words else 0.0
        if len(words) >= 15 and fillers >= 3 and density > 8:
            found.append((density, bucket, fillers))
    found.sort(key=lambda t: (-t[0], t[1]))
    out = []
    for density, bucket, fillers in found[:2]:
        at = bucket * FILLER_WINDOW_SEC
        asset_id, asset_sec = locate(spans, at)
        out.append(
            {
                "type": "clarity",
                "severity": "medium",
                "at_sec": round(at, 2),
                "scene_idx": None,
                "asset_id": asset_id,
                "asset_sec": asset_sec,
                "detail": f"{fillers} filler words in 20 s ({density:.0f} per 100 words)",
            }
        )
    return out


def missing_beats(
    beats: Sequence[dict[str, Any]], matches: Sequence[dict[str, Any]]
) -> list[dict[str, Any]]:
    status_by_beat = {(m["scene_idx"], m["beat_idx"]): m.get("status") for m in matches}
    return [
        {"scene_idx": b["scene_idx"], "beat_idx": b["beat_idx"], "text": b["text"]}
        for b in beats
        if status_by_beat.get((b["scene_idx"], b["beat_idx"])) == "missing"
    ]


def compute_review(
    *,
    segments: Sequence[dict[str, Any]],
    silences: Sequence[tuple[float, float]],
    duration: float,
    beats: Sequence[dict[str, Any]] = (),
    matches: Sequence[dict[str, Any]] = (),
    spans: Sequence[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """All Plan 8.7 metrics: ``{scores, overall, metrics, candidates, missing}``."""
    segs = sorted(segments, key=lambda s: float(s["start"]))
    words: list[str] = []
    for seg in segs:
        words.extend(tokens(str(seg["text"])))
    duration = max(float(duration), max((float(s["end"]) for s in segs), default=0.0))

    hook, hook_m = score_hook(segs)
    pacing, pacing_m = score_pacing(len(words), duration, silences)
    clarity, clarity_m = score_clarity(segs, words)
    cta, cta_m = score_cta(words)
    coverage, coverage_m = score_coverage(beats, matches)
    raw: dict[str, float | None] = {
        "hook": hook,
        "clarity": clarity,
        "pacing": pacing,
        "coverage": coverage,
        "cta": cta,
    }
    scores = {k: None if v is None else _r(v) for k, v in raw.items()}
    overall = _r(combine_overall(raw))
    metrics: dict[str, Any] = {
        "duration_sec": round(duration, 2),
        "words": len(words),
        "silence_total_sec": round(silence_total(silences), 2),
        "overall_weights": {
            k: (
                round(w / sum(WEIGHTS[x] for x in WEIGHTS if raw[x] is not None), 4)
                if raw[k] is not None
                else 0.0
            )
            for k, w in WEIGHTS.items()
        },
        **hook_m,
        **pacing_m,
        **clarity_m,
        **cta_m,
        **coverage_m,
    }
    candidates = candidate_issues(
        segments=segs,
        silences=silences,
        duration=duration,
        scores=raw,
        cta_found=bool(cta_m["cta_found"]),
        beats=beats,
        matches=matches,
        spans=spans,
    )
    return {
        "scores": scores,
        "overall": overall,
        "metrics": metrics,
        "candidates": candidates,
        "missing": missing_beats(beats, matches),
    }
