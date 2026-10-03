"""AI Director: plans, shot lists, exports and footage reviews."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.deps import CtxDep, DbDep
from app.schemas.director import (
    PlanOut,
    PlanPatch,
    PlanRequest,
    PlanVersionOut,
    ReviewOut,
    ReviewVersionOut,
)
from app.services import director_service as svc

router = APIRouter(prefix="/content/{item_id}/director", tags=["director"])


@router.post("/plan", response_model=PlanOut)
def create_plan(
    item_id: str, ctx: CtxDep, db: DbDep, body: PlanRequest | None = None
) -> dict[str, Any]:
    """``director.plan`` with the domain template; persists a new version (durations fixed up)."""
    return svc.generate_plan(db, ctx.workspace_id, item_id, (body or PlanRequest()).model_dump())


@router.get("/plan", response_model=PlanOut)
def get_plan(
    item_id: str, ctx: CtxDep, db: DbDep, version: Annotated[int | None, Query(ge=1)] = None
) -> dict[str, Any]:
    """Latest plan (or ``?version=n``); ``409 NO_PLAN`` when none exists."""
    return svc.get_plan(db, ctx.workspace_id, item_id, version)


@router.get("/plan/versions", response_model=list[PlanVersionOut])
def plan_versions(item_id: str, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return svc.list_plans(db, ctx.workspace_id, item_id)


@router.get("/plan/export")
def export_plan(
    item_id: str,
    ctx: CtxDep,
    db: DbDep,
    format: Annotated[str, Query(pattern="^(csv|md)$")] = "md",
    version: Annotated[int | None, Query(ge=1)] = None,
) -> Response:
    body, media_type, filename = svc.export_plan(db, ctx.workspace_id, item_id, format, version)
    return Response(
        content=body,
        media_type=f"{media_type}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/plan", response_model=PlanOut)
def patch_plan(item_id: str, body: PlanPatch, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Edit the latest plan's shot list (one entry per scene); edited rows become ``user``."""
    shots = [s.model_dump() for s in body.shot_list]
    return svc.update_shot_list(db, ctx.workspace_id, item_id, shots)


@router.post("/review", response_model=ReviewOut)
def create_review(item_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Deterministic scores (Plan 8.7) + one ``director.review`` call for the wording."""
    return svc.generate_review(db, ctx.workspace_id, item_id)


@router.get("/review", response_model=ReviewOut)
def get_review(
    item_id: str, ctx: CtxDep, db: DbDep, version: Annotated[int | None, Query(ge=1)] = None
) -> dict[str, Any]:
    return svc.get_review(db, ctx.workspace_id, item_id, version)


@router.get("/review/versions", response_model=list[ReviewVersionOut])
def review_versions(item_id: str, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return svc.list_reviews(db, ctx.workspace_id, item_id)
