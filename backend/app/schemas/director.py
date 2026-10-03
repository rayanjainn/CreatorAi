"""Models for the AI Director: plans, shot lists and reviews."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.llm.schemas import ShotListEntry
from app.schemas.common import Provenance
from app.schemas.content import Domain


class PlanRequest(BaseModel):
    """Every field defaults from the content item and the creator profile."""

    objective: str | None = Field(default=None, max_length=1000)
    audience: str | None = Field(default=None, max_length=300)
    domain: Domain | None = None
    target_duration_sec: int | None = Field(default=None, ge=10, le=3600)
    platform: str | None = Field(default=None, max_length=40)


class PlanPatch(BaseModel):
    shot_list: list[ShotListEntry] = Field(min_length=1)


class PlanOut(BaseModel):
    id: str
    content_item_id: str
    version: int
    created_at: str
    plan: dict[str, Any]
    inputs: dict[str, Any]
    fixups: list[str]
    shot_provenance: list[Provenance]
    edited_by_user: dict[str, Any]
    provenance: Provenance


class PlanVersionOut(BaseModel):
    id: str
    version: int
    created_at: str
    angle: str
    duration_sec: float
    scenes: int
    provenance: Provenance


class ReviewOut(BaseModel):
    id: str
    content_item_id: str
    version: int
    created_at: str
    overall_score: float
    scores: dict[str, float | None]
    strengths: list[str]
    issues: list[dict[str, Any]]
    missing_scenes: list[dict[str, Any]]
    suggestions: list[str]
    metrics: dict[str, Any]
    warnings: list[dict[str, Any]]
    assets_used: list[dict[str, Any]]
    provenance: Provenance
    provenance_by_part: dict[str, Provenance]


class ReviewVersionOut(BaseModel):
    id: str
    version: int
    created_at: str
    overall_score: float
    provenance: Provenance
