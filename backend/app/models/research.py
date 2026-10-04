"""Research briefs (cited web research)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, workspace_fk


class ResearchBrief(Base):
    __tablename__ = "research_briefs"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="SET NULL")
    )
    topic: Mapped[str] = mapped_column(String, nullable=False)
    doc: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    results: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    provenance: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[str] = created_at_col()
