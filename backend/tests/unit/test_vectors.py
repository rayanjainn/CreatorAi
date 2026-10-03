from __future__ import annotations

import numpy as np

from app.ml.vectors import (
    cosine_matrix,
    normalize,
    pack_matrix,
    pack_vector,
    top_k,
    unpack_matrix,
    unpack_vector,
)


def test_pack_roundtrip_is_float32_little_endian() -> None:
    vec = np.array([0.5, -1.25, 3.0], dtype=np.float32)
    blob = pack_vector(vec)
    assert len(blob) == 12
    assert np.array_equal(unpack_vector(blob), vec)


def test_unpack_matrix_handles_missing_rows() -> None:
    rng = np.random.default_rng(0)
    rows = normalize(rng.normal(size=(2, 384)).astype(np.float32))
    mat = unpack_matrix([*pack_matrix(rows), None, b"short"])
    assert mat.shape == (4, 384)
    assert np.allclose(mat[:2], rows) and not mat[2:].any()


def test_top_k_orders_by_cosine_and_batches() -> None:
    rng = np.random.default_rng(1)
    corpus = rng.normal(size=(500, 32)).astype(np.float32)
    query = corpus[123] * 2.0  # same direction, different norm
    hits = top_k(query, corpus, 5, batch_size=64)
    assert hits[0][0] == 123 and abs(hits[0][1] - 1.0) < 1e-5
    assert [s for _, s in hits] == sorted((s for _, s in hits), reverse=True)
    expected = np.argsort(-cosine_matrix(query[None], corpus)[0])[:5]
    assert [i for i, _ in hits] == expected.tolist()


def test_top_k_edge_cases() -> None:
    assert top_k(np.ones(4), np.zeros((0, 4), dtype=np.float32), 3) == []
    assert top_k(np.ones(4), np.ones((2, 4), dtype=np.float32), 10)[0][1] > 0.99
    assert len(top_k(np.ones(4), np.ones((2, 4), dtype=np.float32), 10)) == 2
