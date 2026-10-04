"""Rows of optional third-party integrations (the LumiClip cloud clipper, YouTube imports)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, updated_at_col, workspace_fk


class LumiclipProject(Base):
    __tablename__ = "lumiclip_projects"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="SET NULL")
    )
    source_url: Mapped[str] = mapped_column(String, nullable=False)
    source_asset_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("assets.id", ondelete="SET NULL")
    )
    remote_id: Mapped[str] = mapped_column(String, nullable=False)
    aspect_ratio: Mapped[str] = mapped_column(String, nullable=False, default="9:16")
    options: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String, nullable=False, default="processing")
    step: Mapped[str] = mapped_column(String, nullable=False, default="")
    message: Mapped[str | None] = mapped_column(String)
    error: Mapped[str | None] = mapped_column(String)
    error_category: Mapped[str | None] = mapped_column(String)
    expected_clips: Mapped[int | None] = mapped_column(Integer)
    source_duration_sec: Mapped[float | None] = mapped_column(Float)
    clips: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    imported: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[str] = created_at_col()
    updated_at: Mapped[str] = updated_at_col()


class YtImport(Base):
    __tablename__ = "yt_imports"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="SET NULL")
    )
    url: Mapped[str] = mapped_column(String, nullable=False)
    video_id: Mapped[str] = mapped_column(String, nullable=False)
    topic: Mapped[str | None] = mapped_column(String)
    title: Mapped[str] = mapped_column(String, nullable=False)
    channel: Mapped[str | None] = mapped_column(String)
    duration_sec: Mapped[float | None] = mapped_column(Float)
    options: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    job_id: Mapped[str | None] = mapped_column(String)
    asset_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("assets.id", ondelete="SET NULL")
    )
    clips_job_id: Mapped[str | None] = mapped_column(String)
    transcript_source: Mapped[str | None] = mapped_column(String)
    error: Mapped[str | None] = mapped_column(String)
    error_code: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = created_at_col()
    updated_at: Mapped[str] = updated_at_col()
