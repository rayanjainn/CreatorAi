"""Models for clips (Plan.md section 8.8) and their edits (timelines, revisions)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Provenance
from app.schemas.timeline import Timeline


class GenerateClipsRequest(BaseModel):
    asset_id: str | None = None
    count: int | None = Field(default=None, ge=1, le=8)
    include_full_cut: bool = False


class ClipsEnqueued(BaseModel):
    job_id: str
    asset_id: str


class ClipPreview(BaseModel):
    url: str | None = Field(description="signed proxy URL; play from start_sec to end_sec")
    start_sec: float
    end_sec: float


class ClipOut(BaseModel):
    id: str
    content_item_id: str
    source_asset_id: str
    kind: Literal["short", "full"]
    title: str
    hook: str
    caption: str
    reason: str
    score: float
    rank: int | None = None
    start_sec: float
    end_sec: float
    duration_sec: float
    status: Literal["suggested", "accepted", "rejected"]
    features: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)
    preview: ClipPreview
    thumbnail_url: str | None = None
    edit_revision: int | None = None
    timeline_duration: float | None = None
    created_at: str
    updated_at: str
    provenance: Provenance
    provenance_by_part: dict[str, Provenance]


class ClipPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=120)
    hook: str | None = Field(default=None, max_length=300)
    caption: str | None = Field(default=None, max_length=300)


class EditOut(BaseModel):
    clip_id: str
    edit_id: str
    revision: int
    timeline: Timeline
    updated_at: str
    assets: dict[str, dict[str, Any]] = Field(
        description="per referenced asset: filename, duration, proxy_url, waveform energy, words"
    )
    violations: list[dict[str, Any]] = Field(default_factory=list)
    provenance: Provenance


class EditSave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timeline: Timeline
    base_revision: int = Field(ge=1)
    note: str = Field(default="", max_length=200)


class EditSaved(BaseModel):
    revision: int
    timeline: Timeline
    updated_at: str


class RevisionSummary(BaseModel):
    revision: int
    note: str
    created_at: str
    duration: float
    video_items: int


class RevisionOut(BaseModel):
    revision: int
    note: str
    created_at: str
    timeline: Timeline


class RestoreRequest(BaseModel):
    base_revision: int | None = Field(default=None, ge=1)


class EditOpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: str
    params: dict[str, Any] = Field(default_factory=dict)
    base_revision: int = Field(ge=1)
    note: str = Field(default="", max_length=200)


class EditOpResult(BaseModel):
    op: str
    revision: int
    timeline: Timeline
    changed_layers: list[dict[str, Any]] = Field(default_factory=list)
    updated_at: str
