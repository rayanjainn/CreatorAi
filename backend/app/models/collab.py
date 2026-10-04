"""Teams: workspace members, per-project roles, invites and comments."""

from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, updated_at_col, workspace_fk


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"

    workspace_id: Mapped[str] = mapped_column(
        String, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    invited_by: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[str] = created_at_col()


class ProjectMember(Base):
    __tablename__ = "project_members"

    content_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = created_at_col()


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    email: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    content_item_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="CASCADE")
    )
    project_role: Mapped[str | None] = mapped_column(String)
    token: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    invited_by: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL")
    )
    expires_at: Mapped[str] = mapped_column(String, nullable=False)
    accepted_at: Mapped[str | None] = mapped_column(String)
    accepted_by: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[str] = created_at_col()


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    content_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False
    )
    clip_id: Mapped[str | None] = mapped_column(String, ForeignKey("clips.id", ondelete="CASCADE"))
    parent_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("comments.id", ondelete="CASCADE")
    )
    author_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    at_sec: Mapped[float | None] = mapped_column(Float)
    body: Mapped[str] = mapped_column(String, nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[str] = created_at_col()
    updated_at: Mapped[str] = updated_at_col()
