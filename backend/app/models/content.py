"""Board items, idea suggestions and Director outputs."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, updated_at_col, workspace_fk


class ContentItem(Base):
    __tablename__ = "content_items"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    title: Mapped[str] = mapped_column(String, nullable=False)
    idea_text: Mapped[str] = mapped_column(String, nullable=False, default="")
    objective: Mapped[str] = mapped_column(String, nullable=False, default="")
    domain: Mapped[str | None] = mapped_column(String)
    stage: Mapped[str] = mapped_column(String, nullable=False, default="idea")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    target_duration_sec: Mapped[int | None] = mapped_column(Integer)
    published_at: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = created_at_col()
    updated_at: Mapped[str] = updated_at_col()


class IdeaSuggestion(Base):
    __tablename__ = "idea_suggestions"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    title: Mapped[str] = mapped_column(String, nullable=False)
    rationale: Mapped[str] = mapped_column(String, nullable=False, default="")
    source: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="suggested")
    created_at: Mapped[str] = created_at_col()


class DirectorOutput(Base):
    __tablename__ = "director_outputs"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[str] = created_at_col()
