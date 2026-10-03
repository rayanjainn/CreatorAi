"""Activity log helper (``activity_log`` rows: stage_moved, script_approved, ...)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ActivityLog


def log_activity(
    db: Session,
    workspace_id: str,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    **meta: Any,
) -> ActivityLog:
    """Append a row (flushed, committed with the caller's transaction)."""
    row = ActivityLog(
        workspace_id=workspace_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        meta=meta,
    )
    db.add(row)
    db.flush()
    return row


def list_activity(
    db: Session,
    workspace_id: str,
    *,
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[ActivityLog], int]:
    """Newest first, plus the total number of matching rows."""
    stmt = select(ActivityLog).where(ActivityLog.workspace_id == workspace_id)
    if action:
        stmt = stmt.where(ActivityLog.action == action)
    if entity_type:
        stmt = stmt.where(ActivityLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(ActivityLog.entity_id == entity_id)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.order_by(ActivityLog.id.desc()).limit(limit).offset(offset)).scalars()
    return list(rows), int(total)
