"""Models for script-to-footage matching (Plan.md section 8.5)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import Provenance

MatchStatus = Literal["matched", "weak", "missing", "confirmed", "rejected", "unmatched"]


class MatchEnqueued(BaseModel):
    job_id: str
    pending_assets: list[str] = Field(default_factory=list)


class AlternativeOut(BaseModel):
    index: int
    asset_id: str
    filename: str | None = None
    start_sec: float
    end_sec: float
    timecode: str
    score: float
    text: str = ""
    out_of_order: bool = False
    is_current: bool = False
    thumbnail_url: str | None = None


class BeatMatchOut(BaseModel):
    """One script beat with its match (``match_id``/``asset_id`` are null while unmatched)."""

    script_beat_id: str
    scene_idx: int
    beat_idx: int
    text: str
    est_sec: float
    match_id: str | None = None
    status: MatchStatus
    asset_id: str | None = None
    filename: str | None = None
    start_sec: float | None = None
    end_sec: float | None = None
    timecode: str | None = None
    confidence: float = 0.0
    matched_text: str = ""
    out_of_order: bool = False
    shared_span: bool = Field(
        default=False,
        description="out-of-order only because a neighbouring beat uses the same take",
    )
    thumbnail_url: str | None = None
    preview_url: str | None = None
    alternatives: list[AlternativeOut] = Field(default_factory=list)
    provenance: Provenance | None = None
    updated_at: str | None = None


class CoverageOut(BaseModel):
    total: int
    matched: int
    weak: int
    missing: int
    confirmed: int
    rejected: int
    unmatched: int
    coverage_pct: float | None = Field(description="100 * (matched+confirmed+0.5*weak) / beats")
    matched_sec: float = 0.0


class SceneIssueOut(BaseModel):
    scene_idx: int
    title: str
    kind: Literal["missing", "weak"]
    beat_ids: list[str]
    beats: list[str]
    est_sec: float
    suggestion: str
    provenance: Provenance


class MatchJobOut(BaseModel):
    id: str
    status: str
    progress: int
    stage: str
    error: str | None = None
    finished_at: str | None = None
    notes: list[str] = Field(default_factory=list)


class MatchOut(BaseModel):
    content_item_id: str
    script_id: str
    script_version: int
    ran: bool = Field(description="false until project.match has produced rows for this script")
    embedder: dict[str, Any]
    beats: list[BeatMatchOut]
    coverage: CoverageOut
    missing_scenes: list[SceneIssueOut]
    weak_scenes: list[SceneIssueOut]
    job: MatchJobOut | None = None
    provenance: Provenance


class SwapRequest(BaseModel):
    """Either ``alternative_index`` or a custom ``asset_id`` + ``start_sec`` + ``end_sec``."""

    alternative_index: int | None = Field(default=None, ge=0)
    asset_id: str | None = None
    start_sec: float | None = Field(default=None, ge=0)
    end_sec: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _one_form(self) -> SwapRequest:
        custom = (self.asset_id, self.start_sec, self.end_sec)
        if self.alternative_index is not None:
            if any(v is not None for v in custom):
                raise ValueError("send either alternative_index or asset_id/start_sec/end_sec")
        elif any(v is None for v in custom):
            raise ValueError("send alternative_index, or asset_id with start_sec and end_sec")
        elif (
            self.end_sec is not None
            and self.start_sec is not None
            and (self.end_sec <= self.start_sec)
        ):
            raise ValueError("end_sec must be greater than start_sec")
        return self
