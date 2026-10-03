"""Shared response building blocks.

Provenance contract: EVERY API response that contains generated content carries a ``provenance``
object so the UI can badge it. ``source`` is one of:

``ai``         produced by a real model (LLM, embedder, ASR); ``provider`` and ``model`` say which
``mock``       produced by the offline mock provider (only possible with ``LLM_ALLOW_MOCK=true``)
``heuristic``  deterministic fallback (hashing embedder, rule-based scoring), not an AI model
``demo``       seeded demo data (``is_seed`` rows, ``make seed``)
``user``       typed or edited by the user
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Literal, Protocol

from pydantic import BaseModel

Source = Literal["ai", "mock", "heuristic", "demo", "user"]


class _MetaLike(Protocol):
    provider: str
    model: str
    is_mock: bool


class Provenance(BaseModel):
    source: Source
    provider: str | None = None
    model: str | None = None

    @classmethod
    def from_meta(cls, meta: _MetaLike) -> Provenance:
        """From an :class:`app.llm.types.LLMMeta` (``llm.run_with_meta``)."""
        source: Source = "mock" if meta.is_mock else "ai"
        return cls(source=source, provider=meta.provider, model=meta.model)

    @classmethod
    def heuristic(cls, provider: str = "rules", model: str | None = None) -> Provenance:
        return cls(source="heuristic", provider=provider, model=model)

    @classmethod
    def demo(cls) -> Provenance:
        return cls(source="demo")

    @classmethod
    def user(cls) -> Provenance:
        return cls(source="user")


class WithProvenance(BaseModel):
    """Mixin base for response models that contain generated content."""

    provenance: Provenance


def attach_provenance(payload: dict[str, Any], provenance: Provenance) -> dict[str, Any]:
    """Return ``payload`` plus a serialised ``provenance`` key (for dict-shaped responses)."""
    return {**payload, "provenance": provenance.model_dump()}


# Weakest first: a result that mixes sources reports the weakest one.
_STRENGTH: dict[str, int] = {"mock": 0, "heuristic": 1, "demo": 2, "ai": 3, "user": 4}


def weakest(provenances: Iterable[Provenance | None]) -> Provenance | None:
    """Weakest of several provenances (mock < heuristic < demo < ai < user); ``None`` if none."""
    items = [p for p in provenances if p is not None]
    if not items:
        return None
    return min(items, key=lambda p: _STRENGTH.get(p.source, 0))
