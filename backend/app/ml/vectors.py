"""Embedding storage and brute-force cosine search (float32 BLOBs + numpy)."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

Matrix = NDArray[np.float32]
EMBED_DIM = 384


def pack_vector(vector: Sequence[float] | NDArray[np.floating]) -> bytes:
    """Little-endian float32 bytes for a SQLite BLOB column."""
    return np.asarray(vector, dtype="<f4").tobytes()


def unpack_vector(blob: bytes) -> NDArray[np.float32]:
    return np.frombuffer(blob, dtype="<f4").astype(np.float32, copy=False)


def pack_matrix(matrix: Matrix) -> list[bytes]:
    """One BLOB per row."""
    return [pack_vector(row) for row in np.atleast_2d(matrix)]


def unpack_matrix(blobs: Sequence[bytes | None], dim: int = EMBED_DIM) -> Matrix:
    """Stack BLOBs into an ``(n, dim)`` matrix; missing/mismatched blobs become zero rows."""
    out = np.zeros((len(blobs), dim), dtype=np.float32)
    for i, blob in enumerate(blobs):
        if blob and len(blob) == dim * 4:
            out[i] = unpack_vector(blob)
    return out


def normalize(matrix: Matrix) -> Matrix:
    """L2-normalise rows (zero rows stay zero)."""
    norms = np.linalg.norm(matrix, axis=-1, keepdims=True)
    return (matrix / np.where(norms == 0, 1.0, norms)).astype(np.float32, copy=False)


def cosine_matrix(queries: Matrix, corpus: Matrix) -> Matrix:
    """Cosine similarity ``(q, n)`` between every query and corpus row."""
    q = normalize(np.atleast_2d(queries).astype(np.float32, copy=False))
    c = normalize(np.atleast_2d(corpus).astype(np.float32, copy=False))
    return q @ c.T


def top_k(
    query: NDArray[np.floating], corpus: Matrix, k: int, batch_size: int = 50_000
) -> list[tuple[int, float]]:
    """Best ``k`` corpus rows for one query as ``(index, cosine)``, highest first.

    The corpus is scanned in batches so memory stays flat for large libraries.
    """
    if corpus.shape[0] == 0 or k <= 0:
        return []
    q = normalize(np.asarray(query, dtype=np.float32)[None, :])
    best_idx = np.empty(0, dtype=np.int64)
    best_score = np.empty(0, dtype=np.float32)
    for start in range(0, corpus.shape[0], batch_size):
        chunk = normalize(corpus[start : start + batch_size])
        scores = (chunk @ q.T).ravel()
        take = min(k, scores.shape[0])
        part = np.argpartition(-scores, take - 1)[:take]
        best_idx = np.concatenate([best_idx, part + start])
        best_score = np.concatenate([best_score, scores[part]])
    order = np.argsort(-best_score)[:k]
    return [(int(best_idx[i]), float(best_score[i])) for i in order]
