"""Monotonic alignment (Plan 8.5) on synthetic similarity matrices."""

from __future__ import annotations

import numpy as np
import pytest

from app.ml.alignment import (
    align,
    ambiguous,
    brute_force_best,
    classify,
    compatible,
    is_valid_path,
    path_score,
    top_alternatives,
)

THETA, OK = 0.30, 0.45


def spans(*ranges: tuple[float, float]) -> tuple[np.ndarray, np.ndarray]:
    return np.array([r[0] for r in ranges]), np.array([r[1] for r in ranges])


def test_identity_alignment_follows_the_diagonal() -> None:
    starts, ends = spans((0, 5), (5, 10), (10, 15), (15, 20))
    sim = np.full((4, 4), 0.1)
    np.fill_diagonal(sim, 0.8)
    path = align(sim, starts, ends, THETA)
    assert path == [(0, 0), (1, 1), (2, 2), (3, 3)]


def test_monotonic_and_skips_beats_without_a_good_span() -> None:
    starts, ends = spans((0, 5), (5, 10), (10, 15))
    sim = np.array([[0.7, 0.1, 0.1], [0.1, 0.1, 0.1], [0.1, 0.1, 0.9], [0.1, 0.8, 0.1]])
    path = align(sim, starts, ends, THETA)
    # beat 1 has nothing; beat 3's best span (1) lies before beat 2's (2): only one can win
    assert (0, 0) in path and is_valid_path(path, starts, ends)
    assert [b for b, _ in path] == sorted(b for b, _ in path)
    assert (2, 2) in path and all(b != 1 for b, _ in path)


def test_out_of_order_footage_prefers_the_higher_gain_order() -> None:
    starts, ends = spans((0, 5), (10, 15))
    sim = np.array([[0.40, 0.90], [0.85, 0.40]])  # footage is reversed relative to the script
    path = align(sim, starts, ends, THETA)
    assert path_score(sim, path, THETA) == pytest.approx(0.6)
    assert path == [(0, 1)]
    assert is_valid_path(path, starts, ends)


def test_tolerance_allows_one_second_overlap_but_not_more() -> None:
    sim = np.array([[0.9, 0.1], [0.1, 0.9]])
    ok_starts, ok_ends = spans((0, 5), (4.5, 9))  # overlap 0.5 s <= tolerance
    assert align(sim, ok_starts, ok_ends, THETA) == [(0, 0), (1, 1)]
    bad_starts, bad_ends = spans((0, 5), (3.0, 9))  # overlap 2 s > tolerance
    path = align(sim, bad_starts, bad_ends, THETA)
    assert len(path) == 1  # cannot use both
    assert compatible(5.0, 4.0, 9.0) and not compatible(5.0, 3.9, 9.0)


def test_a_span_never_serves_two_beats_through_the_tolerance() -> None:
    starts, ends = spans((0, 0.8))  # shorter than the tolerance
    sim = np.array([[0.9], [0.9]])
    assert len(align(sim, starts, ends, THETA)) == 1


def test_nothing_above_theta_gives_an_empty_path() -> None:
    starts, ends = spans((0, 5), (5, 10))
    assert align(np.full((3, 2), 0.2), starts, ends, THETA) == []
    assert align(np.zeros((0, 2)), starts, ends, THETA) == []
    assert align(np.zeros((2, 0)), np.array([]), np.array([]), THETA) == []


def test_input_span_order_does_not_matter() -> None:
    starts, ends = spans((10, 15), (0, 5), (5, 10))  # shuffled
    sim = np.array([[0.1, 0.9, 0.1], [0.1, 0.1, 0.9], [0.9, 0.1, 0.1]])
    assert align(sim, starts, ends, THETA) == [(0, 1), (1, 2), (2, 0)]


@pytest.mark.parametrize("seed", range(40))
def test_matches_brute_force_on_random_small_cases(seed: int) -> None:
    rng = np.random.default_rng(seed)
    n_beats, n_spans = int(rng.integers(1, 5)), int(rng.integers(1, 7))
    starts = rng.uniform(0, 20, n_spans).round(1)
    ends = starts + rng.uniform(0.5, 6, n_spans).round(1)
    sim = rng.uniform(0.0, 1.0, (n_beats, n_spans))
    path = align(sim, starts, ends, THETA)
    assert is_valid_path(path, starts, ends)
    assert all(sim[i, j] > THETA for i, j in path)
    assert path_score(sim, path, THETA) == pytest.approx(
        brute_force_best(sim, starts, ends, THETA), abs=1e-9
    )


def test_large_problem_runs_vectorised() -> None:
    rng = np.random.default_rng(1)
    n_spans = 6000
    starts = np.sort(rng.uniform(0, 3000, n_spans))
    ends = starts + rng.uniform(2, 30, n_spans)
    sim = rng.uniform(0, 0.6, (60, n_spans))
    path = align(sim, starts, ends, THETA)
    assert is_valid_path(path, starts, ends)


def test_classify_statuses_out_of_order_and_alternatives() -> None:
    starts, ends = spans((0, 5), (5, 10), (10, 15))
    assets = ["a", "a", "a"]
    sim = np.array(
        [
            [0.90, 0.20, 0.10],  # matched
            [0.10, 0.35, 0.20],  # on path but weak (0.35 < 0.45)
            [0.20, 0.10, 0.10],  # missing
            [0.80, 0.10, 0.10],  # best span is earlier than the path: out of order
        ]
    )
    path = align(sim, starts, ends, THETA)
    outcomes = classify(sim, path, starts, ends, assets, OK, THETA)
    assert [o.status for o in outcomes] == ["matched", "weak", "missing", "weak"]
    assert outcomes[0].span == 0 and not outcomes[0].out_of_order
    assert outcomes[1].span == 1 and not outcomes[1].out_of_order
    assert outcomes[2].span is None
    assert outcomes[3].out_of_order and outcomes[3].span == 0
    assert all(len(o.alternatives) <= 3 for o in outcomes)
    assert outcomes[0].alternatives[0] == 0


def test_alternatives_skip_near_duplicate_spans() -> None:
    starts, ends = spans((0, 10), (0.5, 10.5), (30, 40), (60, 70))
    scores = np.array([0.9, 0.85, 0.5, 0.4])
    assert top_alternatives(scores, starts, ends, ["a"] * 4) == [0, 2, 3]
    # other assets are never "the same moment"
    assert top_alternatives(scores, starts, ends, ["a", "b", "a", "a"], limit=2) == [0, 1]


def test_ambiguity_needs_two_close_spans_above_ok() -> None:
    row = np.array([0.60, 0.59, 0.2])
    assert ambiguous(row, [0, 1], OK, 0.03)
    assert not ambiguous(np.array([0.60, 0.50]), [0, 1], OK, 0.03)
    assert not ambiguous(np.array([0.44, 0.43]), [0, 1], OK, 0.03)
    assert not ambiguous(row, [0], OK, 0.03)
