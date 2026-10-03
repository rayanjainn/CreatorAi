"""Text embedders. Real by default: fastembed (ONNX MiniLM, a core dependency), then
sentence-transformers if installed, and only then the hashing embedder, which is a flagged
*heuristic* fallback (``embedder_info()["real"]`` is False and a WARNING is logged once).

All backends return L2-normalised 384-d float32 matrices. Select one with ``EMBED_BACKEND``
(``auto`` = fastembed -> sentence-transformers -> hashing). The first real use downloads the model
(``make models`` preloads it); offline or on any load failure the hashing fallback kicks in.
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
from app.schemas.common import Provenance

log = logging.getLogger(__name__)


class Embedder(Protocol):
    name: str
    model: str
    dim: int
    real: bool

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
    real = False  # heuristic, not a neural model: provenance source "heuristic"

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
    real = True

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
    real = True

    def __init__(self, model: str) -> None:
        from fastembed import TextEmbedding

        self.model = model.removeprefix("sentence-transformers/")
        self._model: Any = TextEmbedding(model_name=f"sentence-transformers/{self.model}")

    def embed(self, texts: list[str]) -> Matrix:
        return normalize(np.asarray(list(self._model.embed(texts)), dtype=np.float32))


_lock = threading.Lock()
_instance: Embedder | None = None


_warned = False


def _warn_heuristic(reason: str) -> None:
    global _warned
    if not _warned:
        _warned = True
        log.warning(
            "EMBEDDINGS ARE A HEURISTIC FALLBACK (hashing embedder, not a neural model): %s. "
            "Matching and search quality is reduced. Run `make models` while online to download "
            "the real embedding model, then restart.",
            reason,
        )


def _build(backend: str, model: str) -> Embedder:
    order = {
        "auto": ["fastembed", "sentence-transformers", "hashing"],
        "sentence-transformers": ["sentence-transformers", "fastembed", "hashing"],
        "fastembed": ["fastembed", "sentence-transformers", "hashing"],
        "hashing": ["hashing"],
    }[backend]
    failures: list[str] = []
    for candidate in order:
        if candidate == "hashing":
            _warn_heuristic(
                "EMBED_BACKEND=hashing"
                if backend == "hashing"
                else "; ".join(failures) or "no real embedder installed"
            )
            return HashingEmbedder()
        module = "sentence_transformers" if candidate == "sentence-transformers" else "fastembed"
        if importlib.util.find_spec(module) is None:
            failures.append(f"{candidate} not installed")
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
            failures.append(f"{candidate} failed to load ({type(exc).__name__}: {exc})")
    _warn_heuristic("; ".join(failures))
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
    global _instance, _warned
    with _lock:
        _instance = None
        _warned = False


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
        "real": embedder.real,
        "provenance": embedder_provenance(embedder).model_dump(),
        "model": embedder.model,
        "dim": embedder.dim,
        "match_ok": ok,
        "match_weak": weak,
    }


def embedder_provenance(embedder: Embedder | None = None) -> Provenance:
    """``ai`` for a neural embedder, ``heuristic`` for the hashing fallback."""
    embedder = embedder or get_embedder()
    if embedder.real:
        return Provenance(source="ai", provider=embedder.name, model=embedder.model)
    return Provenance.heuristic(embedder.name, embedder.model)
