"""Digital Twin memories and chat history."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, pk, workspace_fk


class TwinMemory(Base):
    __tablename__ = "twin_memories"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    kind: Mapped[str] = mapped_column(String, nullable=False)
    text: Mapped[str] = mapped_column(String, nullable=False)
    source_id: Mapped[str | None] = mapped_column(String)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary)
    created_at: Mapped[str] = created_at_col()


class TwinMessage(Base):
    __tablename__ = "twin_messages"

    id: Mapped[str] = pk()
    workspace_id: Mapped[str] = workspace_fk()
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    actions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    context: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[str] = created_at_col()
