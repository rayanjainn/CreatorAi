"""Script-beat to footage matches."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, pk, updated_at_col, workspace_fk


class BeatMatch(Base):
    __tablename__ = "beat_matches"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False
    )
    script_beat_id: Mapped[str] = mapped_column(
        String, ForeignKey("script_beats.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    asset_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("assets.id", ondelete="SET NULL")
    )
    start_sec: Mapped[float | None] = mapped_column(Float)
    end_sec: Mapped[float | None] = mapped_column(Float)
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(String, nullable=False)
    alternatives: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    provenance: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    updated_at: Mapped[str] = updated_at_col()
