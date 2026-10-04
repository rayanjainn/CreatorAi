"""Community feed: posts shared by everyone on the server, their comments and likes."""

from __future__ import annotations

from sqlalchemy import JSON, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, updated_at_col, workspace_fk


class CommunityPost(Base):
    __tablename__ = "community_posts"

    id: Mapped[str] = pk()
    author_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[str] = workspace_fk()
    render_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("renders.id", ondelete="SET NULL")
    )
    asset_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("assets.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False, default="")
    platforms: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    video_key: Mapped[str] = mapped_column(String, nullable=False)
    thumb_key: Mapped[str | None] = mapped_column(String)
    duration_sec: Mapped[float | None] = mapped_column(Float)
    aspect: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = created_at_col()
    updated_at: Mapped[str] = updated_at_col()


class CommunityComment(Base):
    __tablename__ = "community_comments"

    id: Mapped[str] = pk()
    post_id: Mapped[str] = mapped_column(
        String, ForeignKey("community_posts.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("community_comments.id", ondelete="CASCADE")
    )
    body: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = created_at_col()
    updated_at: Mapped[str] = updated_at_col()


class CommunityLike(Base):
    __tablename__ = "community_likes"

    post_id: Mapped[str] = mapped_column(
        String, ForeignKey("community_posts.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[str] = created_at_col()
