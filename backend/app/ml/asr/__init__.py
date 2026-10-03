"""ASR providers. ``get_asr_chain()`` returns the usable ones in order (Plan.md section 8.2).

The ingest pipeline tries a sidecar transcript first, then walks this chain
(Groq Whisper, then local faster-whisper) and fails the ``transcribe`` stage with
``ASR_UNAVAILABLE`` when the chain is empty or every provider failed. Never fabricate a transcript.
"""

from __future__ import annotations

from app.config import Settings, get_settings
from app.ml.asr.base import ASRError, ASRProvider, Segment, Transcript, Word
from app.ml.asr.groq import GroqASR
from app.ml.asr.local import LocalASR

__all__ = [
    "ASRError",
    "ASRProvider",
    "GroqASR",
    "LocalASR",
    "Segment",
    "Transcript",
    "Word",
    "get_asr_chain",
]


def get_asr_chain(settings: Settings | None = None) -> list[ASRProvider]:
    """Configured ASR providers in order, per ``ASR_PROVIDER`` (auto: groq then faster-whisper)."""
    settings = settings or get_settings()
    mode = settings.asr_provider
    candidates: list[ASRProvider] = []
    if mode in ("auto", "groq"):
        candidates.append(GroqASR(settings))
    if mode in ("auto", "faster-whisper"):
        candidates.append(LocalASR(settings))
    return [p for p in candidates if p.configured()]
