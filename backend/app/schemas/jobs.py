"""Job response model."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    entity_type: str
    entity_id: str | None
    status: str
    progress: int
    stage: str
    error: str | None
    result: dict[str, Any]
    attempts: int
    created_at: str
    started_at: str | None
    finished_at: str | None
