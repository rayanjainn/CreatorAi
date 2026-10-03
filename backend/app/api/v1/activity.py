"""Activity log (``stage_moved``, ``script_approved``, ...), newest first."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.deps import CtxDep, DbDep, PageDep
from app.schemas.assets import Page
from app.schemas.content import ActivityOut
from app.services.activity import list_activity

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("", response_model=Page[ActivityOut])
def get_activity(
    ctx: CtxDep,
    db: DbDep,
    page: PageDep,
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> dict[str, Any]:
    rows, total = list_activity(
        db, ctx.workspace_id, action=action, entity_type=entity_type, entity_id=entity_id,
        limit=page.limit, offset=page.offset,
    )  # fmt: skip
    return {"items": rows, "total": total, "limit": page.limit, "offset": page.offset}
