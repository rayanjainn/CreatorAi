"""Types returned alongside every LLM result."""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.common import Provenance


@dataclass(frozen=True)
class LLMMeta:
    """Which provider/model produced an output (``llm.run_with_meta``)."""

    provider: str
    model: str
    is_mock: bool = False
    cache_hit: bool = False
    latency_ms: int = 0

    @property
    def provenance(self) -> Provenance:
        return Provenance.from_meta(self)
