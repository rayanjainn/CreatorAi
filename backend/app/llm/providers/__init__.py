"""LLM providers."""

from __future__ import annotations

from app.config import Settings
from app.llm.providers.base import Provider
from app.llm.providers.gemini import GeminiProvider
from app.llm.providers.groq import GroqProvider
from app.llm.providers.mock import MockProvider
from app.llm.providers.ollama import OllamaProvider


def build_providers(settings: Settings) -> dict[str, Provider]:
    """The default provider set, keyed by name."""
    return {
        "gemini": GeminiProvider(settings),
        "groq": GroqProvider(settings),
        "ollama": OllamaProvider(settings),
        "mock": MockProvider(),
    }
