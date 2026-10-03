"""Clips, timelines (edits), revisions and renders."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, updated_at_col, workspace_fk


class Clip(Base):
    __tablename__ = "clips"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False
    )
    source_asset_id: Mapped[str] = mapped_column(
        String, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String, nullable=False, default="short")
    title: Mapped[str] = mapped_column(String, nullable=False, default="")
    hook: Mapped[str] = mapped_column(String, nullable=False, default="")
    caption: Mapped[str] = mapped_column(String, nullable=False, default="")
    reason: Mapped[str] = mapped_column(String, nullable=False, default="")
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    features: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    start_sec: Mapped[float] = mapped_column(Float, nullable=False)
    end_sec: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="suggested")
    created_at: Mapped[str] = created_at_col()
    updated_at: Mapped[str] = updated_at_col()


class Edit(Base):
    __tablename__ = "edits"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    clip_id: Mapped[str] = mapped_column(
        String, ForeignKey("clips.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    timeline: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[str] = updated_at_col()


class EditRevision(Base):
    __tablename__ = "edit_revisions"

    id: Mapped[str] = pk()
    edit_id: Mapped[str] = mapped_column(
        String, ForeignKey("edits.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    timeline: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    note: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[str] = created_at_col()


class Render(Base):
    __tablename__ = "renders"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    clip_id: Mapped[str] = mapped_column(
        String, ForeignKey("clips.id", ondelete="CASCADE"), nullable=False
    )
    preset: Mapped[str] = mapped_column(String, nullable=False)
    edit_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    output_key: Mapped[str | None] = mapped_column(String)
    thumb_key: Mapped[str | None] = mapped_column(String)
    duration_sec: Mapped[float | None] = mapped_column(Float)
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = created_at_col()
    finished_at: Mapped[str | None] = mapped_column(String)
