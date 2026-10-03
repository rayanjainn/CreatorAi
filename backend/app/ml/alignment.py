"""Monotonic script-to-footage alignment (Plan.md section 8.5). Pure numpy, no I/O.

Beats are ordered; spans are candidate transcript ranges positioned on one global timeline (an
asset's offset is the sum of the durations before it, so spans of different assets never overlap).
With similarity ``S[i][j]`` and ``theta`` = ``MATCH_WEAK`` the gain of pairing beat ``i`` with span
``j`` is ``g = S - theta``. A path is a set of ``(beat, span)`` pairs with strictly increasing beats
in which every consecutive pair is *compatible*: ``end[k] <= start[j] + tol`` (``tol`` = 1.0 s lets
neighbouring spans overlap slightly). The best path maximises the summed gain; beats off the path
are skipped. Only spans with ``g > 0`` take part (a pair below ``theta`` can never help).

DP (one vectorised pass per beat, O(beats x spans)): with spans sorted by end,

    f[i][j] = g[i][j] + max(0, P[c[j]])        c[j] = last span with end <= start[j] + tol_j
    G[k]    = max over earlier beats i' < i of f[i'][k]       (running, updated after each beat)
    P       = prefix maximum of G

``tol_j = min(tol, (end[j] - start[j]) / 2)``: a span can never follow itself, so two beats never
share one span through the tolerance. Back-pointers (predecessor beat and span) give the path.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import pairwise

import numpy as np
from numpy.typing import NDArray

Floats = NDArray[np.float64]

DEFAULT_TOLERANCE_SEC = 1.0
_NEG = -np.inf


def compatible(
    prev_end: float, next_start: float, next_end: float, tol: float = DEFAULT_TOLERANCE_SEC
) -> bool:
    """May a span ending at ``prev_end`` precede the span ``[next_start, next_end]``?"""
    return prev_end <= next_start + min(tol, (next_end - next_start) / 2.0) + 1e-9


def align(
    sim: NDArray[np.floating],
    starts: NDArray[np.floating],
    ends: NDArray[np.floating],
    theta: float,
    tol: float = DEFAULT_TOLERANCE_SEC,
) -> list[tuple[int, int]]:
    """Best monotonic alignment as ``[(beat, span), ...]`` (beats ascending, input span indices).

    ``sim`` is ``(beats, spans)``; ``starts``/``ends`` are the spans' global seconds (any order).
    """
    sim = np.asarray(sim, dtype=np.float64)
    n_beats, n_spans = sim.shape
    if n_beats == 0 or n_spans == 0:
        return []
    starts = np.asarray(starts, dtype=np.float64)
    ends = np.asarray(ends, dtype=np.float64)
    order = np.argsort(ends, kind="stable")
    s_sorted, e_sorted = starts[order], ends[order]
    sim = sim[:, order]
    tol_j = np.minimum(tol, np.maximum(e_sorted - s_sorted, 0.0) / 2.0)
    # cutoff[j]: index of the last span with end <= start[j] + tol_j (-1 when none)
    cutoff = np.searchsorted(e_sorted, s_sorted + tol_j + 1e-9, side="right") - 1

    gain = sim - theta
    best_g = np.zeros(n_spans)  # G[k]: best f over earlier beats (0 = start a fresh path)
    src_beat = np.full(n_spans, -1, dtype=np.int64)  # beat that achieved G[k]
    f = np.full((n_beats, n_spans), _NEG)
    pred_span = np.full((n_beats, n_spans), -1, dtype=np.int64)
    pred_beat = np.full((n_beats, n_spans), -1, dtype=np.int64)
    positions = np.arange(n_spans)
    for i in range(n_beats):
        # prefix maximum of G and the span where it was reached
        prefix = np.maximum.accumulate(best_g)
        record = np.where(best_g == prefix, positions, 0)
        argprefix = np.maximum.accumulate(record)
        valid = cutoff >= 0
        safe = np.where(valid, cutoff, 0)
        prev_val = np.where(valid, prefix[safe], 0.0)
        prev_span = np.where(valid, argprefix[safe], -1)
        use_prev = prev_val > 0
        row = gain[i]
        ok = row > 0
        f_row = np.where(ok, row + np.where(use_prev, prev_val, 0.0), _NEG)
        f[i] = f_row
        pred_span[i] = np.where(ok & use_prev, prev_span, -1)
        pred_beat[i] = np.where(ok & use_prev, src_beat[np.where(use_prev, prev_span, 0)], -1)
        better = f_row > best_g
        best_g = np.where(better, f_row, best_g)
        src_beat = np.where(better, i, src_beat)

    flat = int(np.argmax(f))
    bi, bj = divmod(flat, n_spans)
    if not np.isfinite(f[bi, bj]) or f[bi, bj] <= 0:
        return []
    path: list[tuple[int, int]] = []
    while bi >= 0 and bj >= 0:
        path.append((bi, int(order[bj])))
        bi, bj = int(pred_beat[bi, bj]), int(pred_span[bi, bj])
    path.reverse()
    return path


def path_score(sim: NDArray[np.floating], path: list[tuple[int, int]], theta: float) -> float:
    return float(sum(float(sim[i, j]) - theta for i, j in path))


def is_valid_path(
    path: list[tuple[int, int]],
    starts: NDArray[np.floating],
    ends: NDArray[np.floating],
    tol: float = DEFAULT_TOLERANCE_SEC,
) -> bool:
    """Strictly increasing beats and compatible consecutive spans."""
    for (b0, s0), (b1, s1) in pairwise(path):
        if b1 <= b0 or not compatible(float(ends[s0]), float(starts[s1]), float(ends[s1]), tol):
            return False
    return True


def brute_force_best(
    sim: NDArray[np.floating],
    starts: NDArray[np.floating],
    ends: NDArray[np.floating],
    theta: float,
    tol: float = DEFAULT_TOLERANCE_SEC,
) -> float:
    """Exhaustive best path score (tests only: exponential in the number of beats)."""
    n_beats, n_spans = sim.shape
    gain = np.asarray(sim, dtype=np.float64) - theta

    def best_from(beat: int, prev: int | None) -> float:
        best = 0.0
        for i in range(beat, n_beats):
            for j in range(n_spans):
                if gain[i, j] <= 0:
                    continue
                if prev is not None and not compatible(
                    float(ends[prev]), float(starts[j]), float(ends[j]), tol
                ):
                    continue
                best = max(best, float(gain[i, j]) + best_from(i + 1, j))
        return best

    return best_from(0, None)


# ── statuses and alternatives ────────────────────────────────────────────────────────────────
@dataclass
class BeatOutcome:
    """Result for one beat: status, chosen span (index into the input spans) and ranked spans."""

    beat: int
    status: str  # matched | weak | missing
    span: int | None
    score: float
    out_of_order: bool = False
    alternatives: list[int] = field(default_factory=list)  # span indices, best score first


def top_alternatives(
    scores: NDArray[np.floating],
    starts: NDArray[np.floating],
    ends: NDArray[np.floating],
    asset_ids: list[str],
    limit: int = 3,
    max_overlap: float = 0.5,
    min_score: float = 0.0,
) -> list[int]:
    """Best ``limit`` spans by score, skipping ones that overlap an already kept span of the same
    asset by more than ``max_overlap`` (IoU) so alternatives are genuinely different moments."""
    kept: list[int] = []
    for j in np.argsort(-scores, kind="stable"):
        j = int(j)
        if float(scores[j]) <= min_score:
            break
        clash = False
        for k in kept:
            if asset_ids[k] != asset_ids[j]:
                continue
            inter = min(ends[j], ends[k]) - max(starts[j], starts[k])
            union = max(ends[j], ends[k]) - min(starts[j], starts[k])
            if inter > 0 and union > 0 and inter / union > max_overlap:
                clash = True
                break
        if not clash:
            kept.append(j)
            if len(kept) == limit:
                break
    return kept


def classify(
    sim: NDArray[np.floating],
    path: list[tuple[int, int]],
    starts: NDArray[np.floating],
    ends: NDArray[np.floating],
    asset_ids: list[str],
    ok: float,
    weak: float,
) -> list[BeatOutcome]:
    """Plan 8.5 step 5: path beats are ``matched`` (S >= ok) or ``weak`` (weak <= S < ok); a beat
    off the path takes its best span ignoring order: ``weak`` + ``out_of_order`` when S >= ok,
    otherwise ``missing``. Every beat gets its top-3 alternatives."""
    sim = np.asarray(sim, dtype=np.float64)
    on_path = dict(path)
    out: list[BeatOutcome] = []
    for i in range(sim.shape[0]):
        alts = top_alternatives(sim[i], starts, ends, asset_ids)
        if i in on_path:
            j = on_path[i]
            score = float(sim[i, j])
            out.append(BeatOutcome(i, "matched" if score >= ok else "weak", j, score, False, alts))
            continue
        if sim.shape[1] and float(sim[i].max()) >= ok:
            j = alts[0] if alts else int(np.argmax(sim[i]))
            out.append(BeatOutcome(i, "weak", j, float(sim[i, j]), True, alts))
        else:
            best = float(sim[i].max()) if sim.shape[1] else 0.0
            out.append(BeatOutcome(i, "missing", None, max(best, 0.0), False, alts))
    return out


def ambiguous(sim_row: NDArray[np.floating], alts: list[int], ok: float, margin: float) -> bool:
    """Best two (distinct) spans both >= ok and closer than ``margin``."""
    if len(alts) < 2:
        return False
    a, b = float(sim_row[alts[0]]), float(sim_row[alts[1]])
    return a >= ok and b >= ok and (a - b) < margin
