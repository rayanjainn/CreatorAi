"""Publish jobs, YouTube video mirror, daily metrics and insight snapshots."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, workspace_fk


class PublishJob(Base):
    __tablename__ = "publish_jobs"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False
    )
    render_id: Mapped[str] = mapped_column(
        String, ForeignKey("renders.id", ondelete="RESTRICT"), nullable=False
    )
    platform: Mapped[str] = mapped_column(String, nullable=False, default="youtube")
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    visibility: Mapped[str] = mapped_column(String, nullable=False, default="private")
    scheduled_at: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    youtube_video_id: Mapped[str | None] = mapped_column(String)
    error: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = created_at_col()
    published_at: Mapped[str | None] = mapped_column(String)


class YtVideo(Base):
    __tablename__ = "yt_videos"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    youtube_video_id: Mapped[str] = mapped_column(String, nullable=False)
    content_item_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    published_at: Mapped[str | None] = mapped_column(String)
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    format: Mapped[str] = mapped_column(String, nullable=False, default="short")
    hook_text: Mapped[str] = mapped_column(String, nullable=False, default="")
    hook_type: Mapped[str] = mapped_column(String, nullable=False, default="other")
    topic: Mapped[str] = mapped_column(String, nullable=False, default="")
    retention: Mapped[list[dict[str, float]] | None] = mapped_column(JSON)
    is_seed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class YtMetricDaily(Base):
    __tablename__ = "yt_metrics_daily"

    id: Mapped[str] = pk()
    yt_video_id: Mapped[str] = mapped_column(
        String, ForeignKey("yt_videos.id", ondelete="CASCADE"), nullable=False
    )
    day: Mapped[str] = mapped_column(String, nullable=False)
    views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    watch_time_min: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    avg_view_duration_sec: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    avg_view_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    likes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    comments: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    subscribers_gained: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class InsightSnapshot(Base):
    __tablename__ = "insight_snapshots"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    kind: Mapped[str] = mapped_column(String, nullable=False)
    range_days: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = created_at_col()
