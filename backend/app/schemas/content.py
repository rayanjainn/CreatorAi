"""Models for the content board, ideas and the activity log."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import Provenance

Stage = Literal["idea", "script", "shoot", "edit", "review", "published"]
Domain = Literal["education", "technology", "entertainment", "lifestyle", "business"]


class ContentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    idea_text: str = Field(default="", max_length=5000)
    objective: str = Field(default="", max_length=1000)
    domain: Domain | None = None
    target_duration_sec: int | None = Field(default=None, ge=5, le=3600)
    stage: Stage = "idea"

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("title must not be blank")
        return value


class ContentPatch(BaseModel):
    """Partial update; ``stage`` and ``position`` change only via ``POST /content/{id}/move``."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    idea_text: str | None = Field(default=None, max_length=5000)
    objective: str | None = Field(default=None, max_length=1000)
    domain: Domain | None = None
    target_duration_sec: int | None = Field(default=None, ge=5, le=3600)


class MoveRequest(BaseModel):
    stage: Stage
    position: int | None = Field(default=None, ge=0, description="0-based; default: end of column")


class ContentItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    idea_text: str
    objective: str
    domain: str | None
    stage: str
    position: int
    target_duration_sec: int | None
    published_at: str | None
    created_at: str
    updated_at: str


class ProgressOut(BaseModel):
    assets_total: int
    assets_ready: int
    has_plan: bool
    has_review: bool
    has_script: bool
    script_version: int | None
    script_approved: bool
    clips_count: int
    clips_accepted: int
    percent: int = Field(description="Checklist progress 0-100 for the card's progress ring")


class RunningJobsOut(BaseModel):
    active: bool
    count: int
    types: list[str]


class CardOut(ContentItemOut):
    thumbnail_url: str | None
    progress: ProgressOut
    running_jobs: RunningJobsOut


class BoardColumn(BaseModel):
    stage: Stage
    count: int
    cards: list[CardOut]


class BoardOut(BaseModel):
    columns: list[BoardColumn]
    total: int


class DeleteOut(BaseModel):
    deleted: bool
    id: str
    cascade: dict[str, int]


class IdeaOut(BaseModel):
    id: str
    title: str
    rationale: str
    source: str
    status: str
    created_at: str
    provenance: Provenance | None = Field(
        default=None, description="null for rows stored without a model (e.g. by insights)"
    )


class IdeasGenerateRequest(BaseModel):
    topic: str | None = Field(default=None, max_length=300)
    count: int = Field(default=5, ge=1, le=10)


class IdeasGenerateOut(BaseModel):
    ideas: list[IdeaOut]
    skipped_duplicates: int
    provenance: Provenance


class IdeaAcceptOut(BaseModel):
    idea: IdeaOut
    content_item: ContentItemOut


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action: str
    entity_type: str
    entity_id: str | None
    meta: dict[str, Any]
    created_at: str
