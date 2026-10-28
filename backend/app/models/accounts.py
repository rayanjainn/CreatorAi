"""Users, workspaces, creator profile and the YouTube connection."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, updated_at_col


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = pk()
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String)
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = created_at_col()


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = pk()
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False, default="My Channel")
    created_at: Mapped[str] = created_at_col()


class CreatorProfile(Base):
    __tablename__ = "creator_profiles"

    workspace_id: Mapped[str] = mapped_column(
        String, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    domain: Mapped[str] = mapped_column(String, nullable=False)
    audience: Mapped[str] = mapped_column(String, nullable=False, default="")
    tone: Mapped[str] = mapped_column(String, nullable=False, default="conversational")
    language: Mapped[str] = mapped_column(String, nullable=False, default="en")
    platforms: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=lambda: ["youtube_shorts"]
    )
    style_profile: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    style_profile_rev: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    approvals_since_style_update: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    onboarding_done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[str] = updated_at_col()


class YoutubeConnection(Base):
    __tablename__ = "youtube_connections"

    workspace_id: Mapped[str] = mapped_column(
        String, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    channel_id: Mapped[str] = mapped_column(String, nullable=False)
    channel_title: Mapped[str | None] = mapped_column(String)
    refresh_token_enc: Mapped[str] = mapped_column(String, nullable=False)
    scopes: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    connected_at: Mapped[str] = created_at_col()
    last_sync_at: Mapped[str | None] = mapped_column(String)


__all__ = ["CreatorProfile", "User", "Workspace", "YoutubeConnection"]
