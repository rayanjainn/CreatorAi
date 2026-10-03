"""Text embedders: sentence-transformers or fastembed when installed, else a hashing embedder.

All backends return L2-normalised 384-d float32 matrices. Select one with ``EMBED_BACKEND``
(``auto`` prefers sentence-transformers, then fastembed, then the zero-download hashing one).
"""

from __future__ import annotations

import hashlib
import importlib.util
import logging
import math
import re
import threading
from collections import Counter
from functools import lru_cache
from itertools import pairwise
from typing import Any, Protocol

import numpy as np

from app.config import get_settings
from app.ml.vectors import EMBED_DIM, Matrix, normalize

log = logging.getLogger(__name__)


class Embedder(Protocol):
    name: str
    model: str
    dim: int

    def embed(self, texts: list[str]) -> Matrix: ...


_TOKEN_RE = re.compile(r"[^\W_]+(?:'[^\W_]+)?", re.UNICODE)
_STOPWORDS = frozenset(
    """
    a an the and or but if then so of to in on at by for with from as is are was were be
    been being am do does did have has had i me my we our you your he she it its they them
    their this that these those there here what which who whom how why when where not no yes
    just very can will would could should may might also than too into over about up down
    out off again more most some any all each other such only own same s t don
    """.split()
)
_SUFFIXES = ("ingly", "ations", "ation", "ing", "edly", "ies", "ied", "ed", "es", "ly", "s")


def _stem(token: str) -> str:
    for suffix in _SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= 3:
            return token[: -len(suffix)]
    return token


@lru_cache(maxsize=65536)
def _bucket(feature: str) -> tuple[int, float]:
    digest = hashlib.blake2b(feature.encode(), digest_size=8).digest()
    value = int.from_bytes(digest, "little")
    return value % EMBED_DIM, 1.0 if (value >> 40) & 1 else -1.0


class HashingEmbedder:
    """Signed feature hashing over word unigrams and bigrams, with stopword damping.

    No model download and fully deterministic. Texts that share content words (and, more weakly,
    adjacent word pairs) get a clearly higher cosine than unrelated texts.
    """

    name = "hashing"
    model = "hashing-384"
    dim = EMBED_DIM

    def _features(self, text: str) -> Counter[str]:
        raw = [t.lower() for t in _TOKEN_RE.findall(text)]
        stems = [_stem(t) for t in raw]
        feats: Counter[str] = Counter()
        for tok, stem in zip(raw, stems, strict=True):
            weight = 0.15 if tok in _STOPWORDS else min(1.6, 0.7 + 0.12 * len(stem))
            feats[f"u:{stem}"] += weight
        content = [s for t, s in zip(raw, stems, strict=True) if t not in _STOPWORDS]
        for left, right in pairwise(content):
            feats[f"b:{left}_{right}"] += 0.9
        return feats

    def embed(self, texts: list[str]) -> Matrix:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            for feature, weight in self._features(text).items():
                index, sign = _bucket(feature)
                out[row, index] += sign * math.log1p(weight)
        return normalize(out)


class SentenceTransformerEmbedder:
    name = "sentence-transformers"
    dim = EMBED_DIM

    def __init__(self, model: str) -> None:
        from sentence_transformers import SentenceTransformer

        self.model = model
        self._model: Any = SentenceTransformer(model)

    def embed(self, texts: list[str]) -> Matrix:
        vectors = self._model.encode(texts, batch_size=64, normalize_embeddings=True)
        return normalize(np.asarray(vectors, dtype=np.float32))


class FastEmbedEmbedder:
    name = "fastembed"
    dim = EMBED_DIM

    def __init__(self, model: str) -> None:
        from fastembed import TextEmbedding

        self.model = model.removeprefix("sentence-transformers/")
        self._model: Any = TextEmbedding(model_name=f"sentence-transformers/{self.model}")

    def embed(self, texts: list[str]) -> Matrix:
        return normalize(np.asarray(list(self._model.embed(texts)), dtype=np.float32))


_lock = threading.Lock()
_instance: Embedder | None = None


def _build(backend: str, model: str) -> Embedder:
    order = {
        "auto": ["sentence-transformers", "fastembed", "hashing"],
        "sentence-transformers": ["sentence-transformers", "hashing"],
        "fastembed": ["fastembed", "hashing"],
        "hashing": ["hashing"],
    }[backend]
    for candidate in order:
        if candidate == "hashing":
            return HashingEmbedder()
        module = "sentence_transformers" if candidate == "sentence-transformers" else "fastembed"
        if importlib.util.find_spec(module) is None:
            continue
        try:
            cls = (
                SentenceTransformerEmbedder
                if candidate == "sentence-transformers"
                else FastEmbedEmbedder
            )
            return cls(model)
        except Exception as exc:
            log.warning("embedder %s unavailable (%s); falling back", candidate, exc)
    return HashingEmbedder()


def get_embedder() -> Embedder:
    """Process-wide singleton, built lazily from settings."""
    global _instance
    with _lock:
        if _instance is None:
            settings = get_settings()
            _instance = _build(settings.embed_backend, settings.embed_model)
            log.info("embedder: %s (%s)", _instance.name, _instance.model)
        return _instance


def reset_embedder() -> None:
    global _instance
    with _lock:
        _instance = None


def embed_texts(texts: list[str]) -> Matrix:
    """L2-normalised ``(len(texts), 384)`` float32 matrix."""
    if not texts:
        return np.zeros((0, EMBED_DIM), dtype=np.float32)
    return get_embedder().embed(texts)


def embedder_info() -> dict[str, Any]:
    """Active backend, model, dimension and match thresholds (for /health and tuning)."""
    embedder = get_embedder()
    ok, weak = get_settings().match_thresholds(embedder.name)
    return {
        "backend": embedder.name,
        "model": embedder.model,
        "dim": embedder.dim,
        "match_ok": ok,
        "match_weak": weak,
    }
