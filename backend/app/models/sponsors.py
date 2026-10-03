"""Sponsor briefs and detected slots."""

from __future__ import annotations

from sqlalchemy import JSON, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, workspace_fk


class SponsorBrief(Base):
    __tablename__ = "sponsor_briefs"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False
    )
    brand: Mapped[str] = mapped_column(String, nullable=False)
    product: Mapped[str] = mapped_column(String, nullable=False)
    key_points: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    cta: Mapped[str] = mapped_column(String, nullable=False, default="")
    do_not_say: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    created_at: Mapped[str] = created_at_col()


class SponsorSlot(Base):
    __tablename__ = "sponsor_slots"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    brief_id: Mapped[str] = mapped_column(
        String, ForeignKey("sponsor_briefs.id", ondelete="CASCADE"), nullable=False
    )
    asset_id: Mapped[str] = mapped_column(
        String, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    at_sec: Mapped[float] = mapped_column(Float, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    rationale: Mapped[str] = mapped_column(String, nullable=False, default="")
    integration_script: Mapped[str] = mapped_column(String, nullable=False, default="")
    status: Mapped[str] = mapped_column(String, nullable=False, default="suggested")
    created_at: Mapped[str] = created_at_col()
