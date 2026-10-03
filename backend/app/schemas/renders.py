"""Render request/response models (Plan.md sections 5 and 8.9)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

PresetName = Literal["yt_short", "reels", "tiktok", "yt_long"]
CaptionStyleName = Literal["bold_center", "minimal_bottom", "karaoke"]


class RenderRequest(BaseModel):
    preset: PresetName
    caption_style: CaptionStyleName | None = Field(
        default=None, description="defaults to the preset's caption style"
    )


class RenderOut(BaseModel):
    id: str
    clip_id: str
    clip_title: str = ""
    clip_kind: Literal["short", "full"] = "short"
    content_item_id: str
    preset: PresetName
    caption_style: CaptionStyleName | None = None
    edit_revision: int
    status: Literal["queued", "rendering", "done", "failed"]
    job_id: str | None = None
    duration_sec: float | None = None
    size_bytes: int | None = None
    error: str | None = None
    publishable: bool = Field(description="True for presets that can go to YouTube")
    created_at: str
    finished_at: str | None = None
    preview_url: str | None = Field(default=None, description="signed inline URL (done only)")
    download_url: str | None = Field(
        default=None, description="signed URL that answers with Content-Disposition: attachment"
    )
    thumbnail_url: str | None = None
    stale: bool = Field(
        default=False, description="the clip was edited after this render (edit_revision is older)"
    )


class RenderEnqueued(BaseModel):
    render: RenderOut
    job_id: str
