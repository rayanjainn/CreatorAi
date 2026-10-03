from __future__ import annotations

import numpy as np

from app.ml.embedder import HashingEmbedder, embed_texts, embedder_info, get_embedder
from app.ml.vectors import cosine_matrix

RELATED = [
    (
        "How I edit YouTube videos faster with a simple workflow",
        "My weekly video editing workflow for creators",
    ),
    (
        "Show the export settings in the editing software",
        "Choose the export settings before you render the video",
    ),
    (
        "Why most beginners fail at growing a channel",
        "Beginner channels fail because growth takes consistency",
    ),
]
UNRELATED = [
    "The best pasta recipe uses garlic and ripe tomatoes",
    "Heavy rain is expected across the coast this weekend",
]


def test_vectors_are_normalised_384d_float32() -> None:
    m = embed_texts(["hello world", "", "another sentence here"])
    assert m.shape == (3, 384) and m.dtype == np.float32
    assert np.allclose(np.linalg.norm(m[[0, 2]], axis=1), 1.0, atol=1e-5)


def test_related_text_scores_above_unrelated() -> None:
    emb = HashingEmbedder()
    for a, b in RELATED:
        va, vb = emb.embed([a, b])
        related = float(va @ vb)
        for other in UNRELATED:
            unrelated = float(va @ emb.embed([other])[0])
            assert related > unrelated + 0.15, (a, b, other, related, unrelated)
        assert related > 0.2


def test_deterministic_and_stopword_damped() -> None:
    emb = HashingEmbedder()
    assert np.array_equal(emb.embed(["same text"]), emb.embed(["same text"]))
    sims = cosine_matrix(emb.embed(["the of and to in a"]), emb.embed(["a cat sat on the mat"]))
    assert sims[0, 0] < 0.15  # stopword overlap alone is not similarity


def test_singleton_and_info() -> None:
    assert get_embedder() is get_embedder()
    info = embedder_info()
    assert info["backend"] == "hashing" and info["dim"] == 384
    assert info["match_ok"] > info["match_weak"]


# ── real-by-default backend order and flagged heuristic fallback ─────────────────────────────
import logging  # noqa: E402

import pytest  # noqa: E402

from app.ml import embedder as emb_mod  # noqa: E402


class _Stub:
    real = True
    dim = 384

    def __init__(self, model: str) -> None:
        self.model = model


class StubFast(_Stub):
    name = "fastembed"


class StubST(_Stub):
    name = "sentence-transformers"


@pytest.fixture
def fresh(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    emb_mod.reset_embedder()
    yield monkeypatch
    emb_mod.reset_embedder()


def test_auto_prefers_fastembed_then_sentence_transformers(fresh: pytest.MonkeyPatch) -> None:
    fresh.setattr(emb_mod, "FastEmbedEmbedder", StubFast)
    fresh.setattr(emb_mod, "SentenceTransformerEmbedder", StubST)
    fresh.setattr(emb_mod.importlib.util, "find_spec", lambda name: object())
    assert emb_mod._build("auto", "m").name == "fastembed"

    def boom(model: str) -> None:
        raise OSError("offline")

    fresh.setattr(emb_mod, "FastEmbedEmbedder", boom)
    assert emb_mod._build("auto", "m").name == "sentence-transformers"


def test_hashing_fallback_is_flagged_and_warns_once(
    fresh: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def boom(model: str) -> None:
        raise OSError("no internet")

    fresh.setattr(emb_mod, "FastEmbedEmbedder", boom)
    fresh.setattr(emb_mod, "SentenceTransformerEmbedder", boom)
    fresh.setattr(emb_mod.importlib.util, "find_spec", lambda name: object())
    with caplog.at_level(logging.WARNING, logger="app.ml.embedder"):
        first = emb_mod._build("auto", "m")
        emb_mod._build("auto", "m")
    assert first.name == "hashing" and first.real is False
    loud = [r for r in caplog.records if "HEURISTIC FALLBACK" in r.getMessage()]
    assert len(loud) == 1 and "no internet" in loud[0].getMessage()


def test_embedder_info_flags_real_and_provenance(fresh: pytest.MonkeyPatch) -> None:
    fresh.setattr(emb_mod, "_instance", HashingEmbedder())
    info = embedder_info()
    assert info["real"] is False and info["provenance"]["source"] == "heuristic"
    fresh.setattr(emb_mod, "_instance", StubFast("all-MiniLM-L6-v2"))
    info = embedder_info()
    assert info["real"] is True
    assert info["provenance"] == {
        "source": "ai",
        "provider": "fastembed",
        "model": "all-MiniLM-L6-v2",
    }
