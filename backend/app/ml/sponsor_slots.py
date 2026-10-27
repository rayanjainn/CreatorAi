"""Sponsor slot detection (Plan.md section 8.10): where in a video a sponsor read fits best.

Candidates are the boundaries between transcript segments inside ``[0.15 D, 0.90 D]`` (and at
least 15 s from the start, 20 s from the end). Each boundary is scored on three signals:

- ``topic_shift``: ``1 - cos(mean(emb[i-2..i]), mean(emb[i+1..i+3]))``, min-max normalised
- ``pause``: ``min(1, gap / 1.5 s)`` where the gap is the silence between the two segments plus any
  detected silence overlapping it
- ``relevance``: ``cos(brief, mean(emb[i-2..i]))``, min-max normalised

``score = 0.40 topic_shift + 0.30 pause + 0.30 relevance``; the top 3 are kept with a minimum
separation of ``max(90 s, D / 3)``. Pure functions over numpy arrays: no DB, no models.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

W_TOPIC, W_PAUSE, W_RELEVANCE = 0.40, 0.30, 0.30
PAUSE_FULL_SEC = 1.5
START_MARGIN_SEC, END_MARGIN_SEC = 15.0, 20.0
MIN_SEPARATION_SEC = 90.0
TOP_K = 3


@dataclass(frozen=True)
class Seg:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class SlotCandidate:
    at_sec: float
    index: int  # the boundary sits after segment ``index``
    score: float
    topic_shift: float
    pause: float
    relevance: float
    kind: str  # pause | topic_shift | both
    before: str
    after: str

    @property
    def rationale(self) -> str:
        parts = []
        if self.kind in ("topic_shift", "both"):
            parts.append("the topic changes here")
        if self.kind in ("pause", "both"):
            parts.append("there is a natural pause")
        if self.relevance >= 0.6:
            parts.append("the surrounding talk is close to the product")
        text = " and ".join(parts) or "a clean sentence boundary"
        return text[0].upper() + text[1:] + "."


def _unit(v: NDArray[np.float32]) -> NDArray[np.float32]:
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def _cos(a: NDArray[np.float32], b: NDArray[np.float32]) -> float:
    return float(np.dot(_unit(a), _unit(b)))


def _minmax(values: list[float]) -> list[float]:
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi - lo < 1e-9:
        return [0.5 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]


def _gap(prev_end: float, next_start: float, silences: Sequence[tuple[float, float]]) -> float:
    """Silence between two segments, widened by any detected silence that touches the gap."""
    lo, hi = prev_end, max(prev_end, next_start)
    for s, e in silences:
        if e >= lo - 0.05 and s <= hi + 0.05:
            lo, hi = min(lo, s), max(hi, e)
    return max(0.0, hi - lo)


def _kind(topic: float, pause: float) -> str:
    if pause >= 0.4 and topic >= 0.5:
        return "both"
    if topic >= 0.5:
        return "topic_shift"
    return "pause"


def find_slots(
    segments: Sequence[Seg],
    embeddings: NDArray[np.float32],
    brief_embedding: NDArray[np.float32],
    duration: float,
    silences: Sequence[tuple[float, float]] = (),
    *,
    top_k: int = TOP_K,
) -> list[SlotCandidate]:
    """Best sponsor slots, ordered by time. ``embeddings[i]`` belongs to ``segments[i]``."""
    if len(segments) < 2 or duration <= 0:
        return []
    lo = max(0.15 * duration, START_MARGIN_SEC)
    hi = min(0.90 * duration, duration - END_MARGIN_SEC)
    raw: list[tuple[int, float, float, float, float]] = []
    for i in range(len(segments) - 1):
        at = (segments[i].end + segments[i + 1].start) / 2
        if not lo <= at <= hi:
            continue
        before = embeddings[max(0, i - 2) : i + 1].mean(axis=0)
        after = embeddings[i + 1 : i + 4].mean(axis=0)
        topic = 1.0 - _cos(before, after)
        pause = min(1.0, _gap(segments[i].end, segments[i + 1].start, silences) / PAUSE_FULL_SEC)
        relevance = _cos(brief_embedding, before)
        raw.append((i, round(at, 3), topic, pause, relevance))
    if not raw:
        return []
    topics = _minmax([r[2] for r in raw])
    relevances = _minmax([r[4] for r in raw])
    scored = []
    for (i, at, _, pause, _r), topic, relevance in zip(raw, topics, relevances, strict=True):
        score = W_TOPIC * topic + W_PAUSE * pause + W_RELEVANCE * relevance
        scored.append(
            SlotCandidate(
                at_sec=at, index=i, score=round(score, 4), topic_shift=round(topic, 4),
                pause=round(pause, 4), relevance=round(relevance, 4), kind=_kind(topic, pause),
                before=segments[i].text, after=segments[i + 1].text,
            )
        )  # fmt: skip
    separation = max(MIN_SEPARATION_SEC, duration / 3)
    picked: list[SlotCandidate] = []
    for cand in sorted(scored, key=lambda c: (-c.score, c.at_sec)):
        if all(abs(cand.at_sec - p.at_sec) >= separation for p in picked):
            picked.append(cand)
        if len(picked) >= top_k:
            break
    return sorted(picked, key=lambda c: c.at_sec)


def context_window(segments: Sequence[Seg], index: int, words: int = 100) -> tuple[str, str]:
    """About ``words`` words of transcript before and after the boundary after ``index``."""
    half = max(1, words // 2)
    before: list[str] = []
    for seg in reversed(segments[: index + 1]):
        before = seg.text.split() + before
        if len(before) >= half:
            break
    after: list[str] = []
    for seg in segments[index + 1 :]:
        after += seg.text.split()
        if len(after) >= half:
            break
    return " ".join(before[-half:]), " ".join(after[:half])
