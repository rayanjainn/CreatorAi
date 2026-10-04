"""Request and response models of the YouTube import endpoints (``/api/v1/yt-import``)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ImportStatus = Literal["queued", "downloading", "processing", "clipping", "done", "failed"]


class YtImportStatus(BaseModel):
    available: bool
    search_configured: bool
    search_provider: str
    asr_available: bool
    max_duration_sec: int
    max_height: int


class YtVideoResult(BaseModel):
    video_id: str
    url: str
    title: str
    snippet: str = ""
    channel: str | None = None
    duration_sec: float | None = None
    published: str | None = None


class YtSearchOut(BaseModel):
    query: str
    provider: str
    results: list[YtVideoResult]


class YtImportCreate(BaseModel):
    url: str = Field(min_length=10, max_length=500)
    topic: str | None = Field(default=None, max_length=300)
    content_item_id: str | None = None
    auto_clips: bool = True
    clip_count: int = Field(default=4, ge=1, le=8)


class YtImportOut(BaseModel):
    id: str
    url: str
    video_id: str
    title: str
    channel: str | None
    duration_sec: float | None
    topic: str | None
    options: dict[str, Any]
    status: ImportStatus
    progress: int
    stage: str
    error: str | None
    error_code: str | None
    content_item_id: str | None
    asset_id: str | None
    asset_status: str | None
    thumbnail_url: str | None
    transcript_source: Literal["asr", "youtube_captions"] | None
    clips_count: int
    job_id: str | None
    clips_job_id: str | None
    created_at: str
    updated_at: str
