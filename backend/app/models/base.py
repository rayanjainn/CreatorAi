"""Declarative base and shared column helpers (ids, UTC ISO timestamps)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def new_id() -> str:
    """A fresh uuid4 string primary key."""
    return str(uuid.uuid4())


def utcnow() -> str:
    """Current UTC time as ``2026-10-03T12:00:00Z`` (the format of every timestamp column)."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class Base(DeclarativeBase):
    """Base for all models. Tables are created by SQL migrations, never by ``create_all``."""

    def to_dict(self) -> dict[str, Any]:
        return {c.key: getattr(self, c.key) for c in self.__mapper__.column_attrs}


def pk() -> Mapped[str]:
    return mapped_column(String, primary_key=True, default=new_id)


def workspace_fk() -> Mapped[str]:
    return mapped_column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)


def created_at_col() -> Mapped[str]:
    return mapped_column(String, nullable=False, default=utcnow)


def updated_at_col() -> Mapped[str]:
    return mapped_column(String, nullable=False, default=utcnow, onupdate=utcnow)
