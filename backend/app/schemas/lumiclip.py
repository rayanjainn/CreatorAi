"""Request and response models of the LumiClip cloud clipper endpoints."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import Provenance


class LumiclipStatus(BaseModel):
    configured: bool
    cloudinary_configured: bool
    base_url: str


class LumiclipStart(BaseModel):
    """Exactly one of ``url`` (a public link, e.g. YouTube) or ``asset_id`` (a library video)."""

    url: str | None = Field(default=None, max_length=2000)
    asset_id: str | None = None
    content_item_id: str | None = None
    aspect_ratio: Literal["9:16", "16:9"] = "9:16"
    start_time: float | None = Field(default=None, ge=0)
    end_time: float | None = Field(default=None, ge=0)
    language: str | None = Field(default=None, max_length=16)
    subtitle_style: str | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def _source(self) -> LumiclipStart:
        if bool(self.url) == bool(self.asset_id):
            raise ValueError("send exactly one of url or asset_id")
        if self.url and not self.url.lower().startswith(("http://", "https://")):
            raise ValueError("url must start with http:// or https://")
        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class LumiclipClipOut(BaseModel):
    id: str
    title: str
    duration: float
    score: float
    reason: str
    status: str
    download_url: str | None
    thumbnail_url: str | None
    quality: str | None
    imported_asset_id: str | None = None


class LumiclipProjectOut(BaseModel):
    id: str
    remote_id: str
    source_url: str
    source_asset_id: str | None
    content_item_id: str | None
    aspect_ratio: str
    options: dict[str, Any]
    status: str
    step: str
    message: str | None
    error: str | None
    error_category: str | None
    expected_clips: int | None
    source_duration_sec: float | None
    clips: list[LumiclipClipOut]
    created_at: str
    updated_at: str
    provenance: Provenance


class LumiclipImport(BaseModel):
    """Save a finished clip into the library. ``light`` skips transcription (no AI key needed)."""

    mode: Literal["full", "light"] = "light"
    content_item_id: str | None = None


class LumiclipImportOut(BaseModel):
    asset_id: str
    duplicate: bool
    job_id: str | None
    project: LumiclipProjectOut


class LumiclipExport(BaseModel):
    quality: Literal["720p", "1080p"] = "1080p"


class YtdlpDownloadRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    content_item_id: str | None = None

    @model_validator(mode="after")
    def _validate_url(self) -> YtdlpDownloadRequest:
        u = self.url.strip().lower()
        if not u.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return self


class YtdlpDownloadOut(BaseModel):
    asset_id: str
    filename: str
    title: str
    duration_sec: float | None = None
    size_bytes: int
    download_url: str
    stream_url: str
    thumbnail_url: str | None = None
    duplicate: bool
    job_id: str | None = None
