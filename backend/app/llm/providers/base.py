"""Provider interface shared by Gemini, Groq and the offline mock."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import httpx


class ProviderError(Exception):
    """A provider call failed; ``retryable`` marks 429/5xx and network errors."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        retry_after: float | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after
        self.retryable = retryable


@dataclass(frozen=True)
class LLMRequest:
    """Everything a provider needs. ``variables`` is only read by the mock provider."""

    task: str
    prompt: str
    schema_json: dict[str, Any]
    max_tokens: int
    model: str
    images: list[bytes] = field(default_factory=list)
    variables: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class LLMResult:
    text: str
    tokens_in: int
    tokens_out: int
    model: str


class Provider(ABC):
    name: str
    supports_images: bool = False

    @abstractmethod
    def configured(self) -> bool:
        """Whether credentials are present (the mock is always configured)."""

    @abstractmethod
    def model_for(self, tier: str) -> str:
        """Model id for a tier (``main``/``lite``/``chat``/``mock``)."""

    @abstractmethod
    def generate(self, request: LLMRequest) -> LLMResult:
        """One JSON-mode completion. Raise :class:`ProviderError` on failure."""


def estimate_tokens(text: str) -> int:
    """Cheap token estimate (``len/4``) used for rate limiting and Groq budgeting."""
    return max(1, len(text) // 4)


def http_error(provider: str, response: httpx.Response) -> ProviderError:
    """Map a non-200 response to a ``ProviderError`` (429/5xx retryable, honours Retry-After)."""
    retry_after: float | None = None
    header = response.headers.get("retry-after")
    if header:
        try:
            retry_after = float(header)
        except ValueError:
            retry_after = None
    return ProviderError(
        f"{provider} HTTP {response.status_code}: {response.text[:200]}",
        status=response.status_code,
        retry_after=retry_after,
        retryable=response.status_code == 429 or response.status_code >= 500,
    )
