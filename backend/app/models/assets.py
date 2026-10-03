"""Uploads, assets and their analysed segments / shots."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Float, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, updated_at_col, workspace_fk


class Upload(Base):
    __tablename__ = "uploads"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="SET NULL")
    )
    filename: Mapped[str] = mapped_column(String, nullable=False)
    mime: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_size: Mapped[int] = mapped_column(Integer, nullable=False)
    total_chunks: Mapped[int] = mapped_column(Integer, nullable=False)
    received_chunks: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String, nullable=False, default="uploading")
    asset_id: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = created_at_col()


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    storage_key: Mapped[str] = mapped_column(String, nullable=False)
    proxy_key: Mapped[str | None] = mapped_column(String)
    thumb_key: Mapped[str | None] = mapped_column(String)
    audio_key: Mapped[str | None] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String, nullable=False)
    duration_sec: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    fps: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String, nullable=False, default="uploaded")
    error: Mapped[str | None] = mapped_column(String)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    folder: Mapped[str] = mapped_column(String, nullable=False, default="/")
    analysis: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[str] = created_at_col()
    updated_at: Mapped[str] = updated_at_col()


class AssetSegment(Base):
    """A transcript segment. ``asset_segments_fts`` (FTS5) is synced by SQL triggers."""

    __tablename__ = "asset_segments"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    asset_id: Mapped[str] = mapped_column(
        String, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    start_sec: Mapped[float] = mapped_column(Float, nullable=False)
    end_sec: Mapped[float] = mapped_column(Float, nullable=False)
    text: Mapped[str] = mapped_column(String, nullable=False)
    words: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary)


class AssetShot(Base):
    __tablename__ = "asset_shots"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    asset_id: Mapped[str] = mapped_column(
        String, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    start_sec: Mapped[float] = mapped_column(Float, nullable=False)
    end_sec: Mapped[float] = mapped_column(Float, nullable=False)
    keyframe_key: Mapped[str | None] = mapped_column(String)
    caption: Mapped[str] = mapped_column(String, nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary)
