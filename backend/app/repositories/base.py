"""Workspace-scoped repository pattern.

Every method takes ``workspace_id`` as its first argument and puts it in the WHERE clause, so a
query that forgets the workspace cannot be written. Subclass, set ``model``, and add the
domain-specific queries your module needs (always via ``self._scoped(workspace_id)``).
"""

from __future__ import annotations

from typing import Any, ClassVar, Generic, TypeVar

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.base import Base

ModelT = TypeVar("ModelT", bound=Base)


class WorkspaceRepository(Generic[ModelT]):
    """CRUD helpers for tables that have ``id`` and ``workspace_id`` columns."""

    model: ClassVar[type[Base]]
    entity_name: ClassVar[str] = "Resource"

    def __init__(self, db: Session) -> None:
        self.db = db

    def _scoped(self, workspace_id: str) -> Select[Any]:
        return select(self.model).where(self.model.workspace_id == workspace_id)  # type: ignore[attr-defined]

    def get(self, workspace_id: str, entity_id: str) -> ModelT | None:
        stmt = self._scoped(workspace_id).where(self.model.id == entity_id)  # type: ignore[attr-defined]
        return self.db.execute(stmt).scalar_one_or_none()  # type: ignore[return-value]

    def require(self, workspace_id: str, entity_id: str) -> ModelT:
        """Like ``get`` but raises ``NOT_FOUND`` (404), also for another workspace's rows."""
        row = self.get(workspace_id, entity_id)
        if row is None:
            raise not_found(self.entity_name)
        return row

    def list(
        self,
        workspace_id: str,
        *,
        limit: int = 50,
        offset: int = 0,
        order_by: Any = None,
        **filters: Any,
    ) -> list[ModelT]:
        stmt = self._scoped(workspace_id)
        for column, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(self.model, column) == value)
        if order_by is not None:
            stmt = stmt.order_by(*order_by if isinstance(order_by, (list, tuple)) else (order_by,))
        return list(self.db.execute(stmt.limit(limit).offset(offset)).scalars())  # type: ignore[arg-type]

    def add(self, workspace_id: str, **values: Any) -> ModelT:
        row = self.model(workspace_id=workspace_id, **values)
        self.db.add(row)
        self.db.flush()
        return row  # type: ignore[return-value]

    def delete(self, workspace_id: str, entity_id: str) -> None:
        self.db.delete(self.require(workspace_id, entity_id))
        self.db.flush()
