"""Model preloading (``make models``): download the embedder and optionally an ASR model.

Downloads need internet on first use. The embedder is cached under ``data/models/fastembed``
(``FASTEMBED_CACHE_PATH`` overrides it) and Whisper in the Hugging Face cache, so the app works
offline once these have run.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.config import Settings, get_settings


def _fastembed_loader(model: str) -> Any:
    from fastembed import TextEmbedding

    return TextEmbedding(model_name=model, cache_dir=str(get_settings().fastembed_cache_dir))


def _whisper_downloader(name: str) -> str:
    from faster_whisper.utils import download_model

    return str(download_model(name))


def preload_embedder(
    settings: Settings | None = None, loader: Callable[[str], Any] = _fastembed_loader
) -> str:
    """Download and smoke-test the fastembed model; returns a one-line success message."""
    settings = settings or get_settings()
    model = settings.embed_model
    if not model.startswith("sentence-transformers/"):
        model = f"sentence-transformers/{model}"
    encoder = loader(model)
    vectors = list(encoder.embed(["warm-up"]))
    return f"embedder ready: fastembed {model} ({len(vectors[0])}-d)"


def preload_asr(
    name: str | None = None,
    settings: Settings | None = None,
    downloader: Callable[[str], str] = _whisper_downloader,
) -> str:
    """Download the faster-whisper model (``WHISPER_LOCAL_MODEL`` unless ``name`` is given)."""
    settings = settings or get_settings()
    name = name or settings.whisper_local_model
    path = downloader(name)
    return f"asr ready: faster-whisper {name} ({path})"
