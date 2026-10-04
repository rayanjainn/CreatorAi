"""Creator intelligence: production patterns computed from the workspace's own data."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.deps import CtxDep, DbDep
from app.services import insights

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/production")
def production(
    ctx: CtxDep, db: DbDep, days: Annotated[int, Query(ge=7, le=365)] = 90
) -> dict[str, Any]:
    return insights.production_report(db, ctx.workspace_id, days)
