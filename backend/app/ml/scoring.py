"""Clip candidate windows and scoring (Plan.md section 8.8, steps 2-5). Pure functions, no I/O.

1. :func:`candidate_windows`: a window starts only at a segment whose predecessor ended a sentence
   and grows through consecutive segments until it is at least ``min_sec`` long; the first segment
   boundary at or after ``min_sec`` closes it when the length is <= ``max_sec`` (else it is
   dropped).
2. :func:`raw_features`: ``beat_similarity`` (max cosine to a script beat), ``hook_signals`` of the
   first sentence, ``speech_rate`` = ``1 - min(1, |words/s - 2.7| / 1.5)``, ``audio_energy``
   (mean dB),
   ``emphasis`` (mean |VADER compound| per sentence) and ``visual_change``
   (``min(1, shots / (duration / 10))``).
3. :func:`score_windows`: every feature is min-max normalised across the windows, then
   ``0.30 beat + 0.20 hook + 0.15 rate + 0.15 energy + 0.10 emphasis + 0.10 visual``. A feature that
   is unavailable (no script, no energy envelope) is dropped and the remaining weights are
   renormalised to sum to 1.
4. :func:`nms`: sort by score, keep a window only if its IoU with every kept window is < 0.3.

The score is rule-based, so callers report provenance ``heuristic`` for it.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from app.ml.hooks import hook_signals

WEIGHTS: dict[str, float] = {
    "beat_similarity": 0.30,
    "hook_signals": 0.20,
    "speech_rate": 0.15,
    "audio_energy": 0.15,
    "emphasis": 0.10,
    "visual_change": 0.10,
}
TARGET_WPS = 2.7
RATE_TOLERANCE = 1.5
ENERGY_WINDOW_SEC = 0.5
NMS_IOU = 0.3
_SENTENCE_END = re.compile(r"[.!?][\"'”’)\]]*$")
_SENTENCES = re.compile(r"(?<=[.!?])\s+")
_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’-]*")
RELAXED_MINS = (12.0, 6.0, 3.0)  # fallbacks when nothing closes at min_sec (short footage)


@dataclass(frozen=True)
class Seg:
    start: float
    end: float
    text: str


@dataclass
class Window:
    first: int  # first / last segment index (inclusive)
    last: int
    start: float
    end: float
    text: str
    raw: dict[str, float | None] = field(default_factory=dict)
    norm: dict[str, float] = field(default_factory=dict)
    score: float = 0.0
    relaxed_min: float | None = None  # set when the 20 s minimum had to be lowered

    @property
    def duration(self) -> float:
        return self.end - self.start


def ends_sentence(text: str) -> bool:
    return bool(_SENTENCE_END.search(text.strip()))


def candidate_windows(
    segs: Sequence[Seg], min_sec: float = 20.0, max_sec: float = 45.0
) -> list[Window]:
    """Plan 8.8 step 2 (see module docstring)."""
    out: list[Window] = []
    for i, first in enumerate(segs):
        if i > 0 and not ends_sentence(segs[i - 1].text):
            continue
        for j in range(i, len(segs)):
            length = segs[j].end - first.start
            if length < min_sec:
                continue
            if length <= max_sec:
                text = " ".join(s.text.strip() for s in segs[i : j + 1]).strip()
                out.append(Window(i, j, first.start, segs[j].end, text))
            break  # the first boundary >= min_sec closes the window (or the window is dropped)
    return out


def windows_with_fallback(
    segs: Sequence[Seg], min_sec: float = 20.0, max_sec: float = 45.0
) -> list[Window]:
    """Like :func:`candidate_windows`, but short footage that yields nothing retries with a lower
    minimum (12, 6, 3 s) and flags the windows ``relaxed_min``."""
    found = candidate_windows(segs, min_sec, max_sec)
    if found:
        return found
    for relaxed in RELAXED_MINS:
        if relaxed >= min_sec:
            continue
        found = candidate_windows(segs, relaxed, max_sec)
        if found:
            for window in found:
                window.relaxed_min = relaxed
            return found
    return []


@lru_cache(maxsize=1)
def _vader() -> Any:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

    return SentimentIntensityAnalyzer()


def emphasis(text: str) -> float:
    """Mean absolute VADER compound over the sentences of ``text``."""
    sentences = [s for s in _SENTENCES.split(text.strip()) if s.strip()]
    if not sentences:
        return 0.0
    scores = [abs(_vader().polarity_scores(s)["compound"]) for s in sentences]
    return sum(scores) / len(scores)


def speech_rate_score(words: int, duration: float) -> float:
    if duration <= 0:
        return 0.0
    return 1.0 - min(1.0, abs(words / duration - TARGET_WPS) / RATE_TOLERANCE)


def mean_energy(envelope: Sequence[float], start: float, end: float) -> float | None:
    """Mean dB of the 0.5 s envelope bins overlapping ``[start, end]`` (None without data)."""
    if not envelope:
        return None
    lo = max(0, math.floor(start / ENERGY_WINDOW_SEC))
    hi = min(len(envelope), math.ceil(end / ENERGY_WINDOW_SEC))
    chunk = envelope[lo:hi]
    return sum(chunk) / len(chunk) if chunk else None


def shots_in(shots: Sequence[tuple[float, float]], start: float, end: float) -> int:
    return sum(1 for s, e in shots if e > start and s < end)


def raw_features(
    window: Window,
    *,
    beat_similarity: float | None,
    envelope: Sequence[float],
    shots: Sequence[tuple[float, float]],
) -> dict[str, float | None]:
    words = len(_WORD.findall(window.text))
    visual = min(1.0, shots_in(shots, window.start, window.end) / max(1e-9, window.duration / 10.0))
    return {
        "beat_similarity": None if beat_similarity is None else max(0.0, float(beat_similarity)),
        "hook_signals": hook_signals(window.text),
        "speech_rate": speech_rate_score(words, window.duration),
        "audio_energy": mean_energy(envelope, window.start, window.end),
        "emphasis": emphasis(window.text),
        "visual_change": visual,
    }


def minmax(values: Sequence[float]) -> list[float]:
    """Scale to [0, 1]; a constant series carries no information and maps to 0.5."""
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi - lo < 1e-12:
        return [0.5] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


def effective_weights(available: Sequence[str]) -> dict[str, float]:
    """Weights of the available features rescaled to sum to 1 (redistribution)."""
    total = sum(WEIGHTS[f] for f in available)
    if total <= 0:
        return {}
    return {f: WEIGHTS[f] / total for f in available}


def score_windows(windows: list[Window]) -> dict[str, float]:
    """Fill ``norm`` and ``score`` of every window in place; returns the weights used."""
    if not windows:
        return {}
    available = [f for f in WEIGHTS if all(w.raw.get(f) is not None for w in windows)]
    weights = effective_weights(available)
    normalised = {f: minmax([float(w.raw[f]) for w in windows]) for f in available}  # type: ignore[arg-type]
    for n, window in enumerate(windows):
        window.norm = {f: round(normalised[f][n], 4) for f in available}
        window.score = round(sum(weights[f] * normalised[f][n] for f in available), 4)
    return weights


def iou(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = min(a[1], b[1]) - max(a[0], b[0])
    if inter <= 0:
        return 0.0
    return inter / ((a[1] - a[0]) + (b[1] - b[0]) - inter)


def nms(windows: Sequence[Window], threshold: float = NMS_IOU, top_k: int = 8) -> list[Window]:
    """Highest score first; drop windows overlapping a kept one by IoU >= ``threshold``."""
    kept: list[Window] = []
    for window in sorted(windows, key=lambda w: (-w.score, w.start)):
        if all(iou((window.start, window.end), (k.start, k.end)) < threshold for k in kept):
            kept.append(window)
            if len(kept) >= top_k:
                break
    return kept


# ── deterministic fallback copy (Plan 8.8 step 6) ─────────────────────────────────────────────
def first_sentence(text: str) -> str:
    parts = _SENTENCES.split(text.strip(), maxsplit=1)
    return parts[0].strip() if parts and parts[0] else ""


def fallback_copy(text: str) -> dict[str, str]:
    """title = first 8 words, hook = first sentence, caption = first 150 characters."""
    clean = " ".join(text.split())
    return {
        "title": " ".join(clean.split()[:8]),
        "hook": first_sentence(clean) or " ".join(clean.split()[:15]),
        "caption": clean[:150],
    }
