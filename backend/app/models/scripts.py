"""Scripts and their beats."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, updated_at_col, workspace_fk


class Script(Base):
    __tablename__ = "scripts"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    hook_options: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    selected_hook: Mapped[str] = mapped_column(String, nullable=False, default="")
    body_md: Mapped[str] = mapped_column(String, nullable=False, default="")
    scenes: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    tone: Mapped[str | None] = mapped_column(String)
    platform: Mapped[str | None] = mapped_column(String)
    length_sec: Mapped[int | None] = mapped_column(Integer)
    provider: Mapped[str | None] = mapped_column(String)
    model: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = created_at_col()
    updated_at: Mapped[str] = updated_at_col()


class ScriptBeat(Base):
    __tablename__ = "script_beats"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    script_id: Mapped[str] = mapped_column(
        String, ForeignKey("scripts.id", ondelete="CASCADE"), nullable=False
    )
    scene_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    beat_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(String, nullable=False)
    intent: Mapped[str] = mapped_column(String, nullable=False, default="")
    est_sec: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary)
