"""RRF fusion, FTS query building, hit merging and vector scan speed."""

from __future__ import annotations

import time

import numpy as np

from app.ml.vectors import normalize
from app.services.search_service import (
    RRF_K,
    Hit,
    _vector_top,
    fts_query,
    merge_hits,
    rrf_fuse,
)


def test_rrf_fuse_sums_reciprocal_ranks_with_k60() -> None:
    fused = rrf_fuse([["a", "b", "c"], ["c", "a"]])
    assert RRF_K == 60
    assert fused["a"] == 1 / 61 + 1 / 62
    assert fused["c"] == 1 / 63 + 1 / 61
    assert fused["b"] == 1 / 62
    assert sorted(fused, key=lambda k: -fused[k]) == ["a", "c", "b"]
    assert rrf_fuse([]) == {} and rrf_fuse([[], []]) == {}


def test_fts_query_drops_stopwords_and_quotes_terms() -> None:
    assert fts_query("How do I trim the dead air?") == '"how" OR "trim" OR "dead" OR "air"'.replace(
        '"how" OR ', ""
    )
    assert fts_query("the and of") is None and fts_query("   ") is None
    assert fts_query('say "hello" hello') == '"say" OR "hello"'
    assert fts_query("b-roll") == '"roll"'  # single letters dropped, punctuation stripped


def h(asset: str, start: float, end: float, score: float, kind: str = "speech") -> Hit:
    return Hit(asset, start, end, kind, f"{asset}@{start}", score=score)


def test_merge_hits_within_gap_keeps_best_and_widens_range() -> None:
    hits = [h("a", 10, 14, 0.03), h("b", 10, 14, 0.02), h("a", 20, 24, 0.015), h("a", 50, 54, 0.01)]
    merged = merge_hits(hits)
    assert [(m.asset_id, m.start, m.end) for m in merged] == [
        ("a", 10, 24),  # 6 s gap -> merged
        ("b", 10, 14),  # other asset untouched
        ("a", 50, 54),  # 26 s away -> separate
    ]
    assert merged[0].score == 0.03 and merged[0].snippet == "a@10"


def test_merge_respects_gap_boundary_and_max_span() -> None:
    assert len(merge_hits([h("a", 0, 4, 2), h("a", 12, 16, 1)])) == 1  # gap exactly 8 s
    assert len(merge_hits([h("a", 0, 4, 2), h("a", 12.1, 16, 1)])) == 2
    chain = [h("a", i * 10, i * 10 + 6, 10 - i) for i in range(8)]  # would chain to a 76 s span
    merged = merge_hits(chain)
    assert len(merged) > 1 and all(m.end - m.start <= 45.0 for m in merged)


def test_vector_top_masks_assets_applies_floor_and_is_fast() -> None:
    rng = np.random.default_rng(1)
    n = 20_000  # roughly 5 hours of segments
    matrix = normalize(rng.normal(size=(n, 384)).astype(np.float32))
    assets = rng.integers(0, 4, size=n)
    query = matrix[777].copy()
    allowed = np.array([True, True, True, True])
    start = time.perf_counter()
    top = _vector_top(matrix, assets, allowed, query, floor=0.0)
    elapsed = time.perf_counter() - start
    assert top[0][0] == 777 and abs(top[0][1] - 1.0) < 1e-4 and len(top) == 30
    assert elapsed < 0.3, f"vector scan took {elapsed:.3f}s"
    only_other = np.array([a != assets[777] for a in range(4)])
    assert all(
        assets[row] != assets[777] for row, _ in _vector_top(matrix, assets, only_other, query, 0.0)
    )
    assert _vector_top(matrix, assets, allowed, query, floor=1.01) == []
    assert _vector_top(matrix, assets, np.zeros(4, dtype=bool), query, 0.0) == []
