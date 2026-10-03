"""Script-to-footage matching: run, read, swap, confirm and reject (Plan.md section 8.5)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.deps import CtxDep, DbDep
from app.schemas.matching import BeatMatchOut, MatchEnqueued, MatchOut, SwapRequest
from app.services import match_service as svc

router = APIRouter(tags=["matching"])


@router.post("/content/{item_id}/match", response_model=MatchEnqueued, status_code=202)
def run_matching(item_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Enqueue ``project.match`` (``409 NO_SCRIPT`` / ``409 ASSET_NOT_READY``).

    Never automatic after a script edit: the user presses "Run matching"."""
    return svc.start_match(db, ctx.workspace_id, item_id)


@router.get("/content/{item_id}/match", response_model=MatchOut)
def get_matching(item_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Beats with matched spans, coverage, missing/weak scenes and the last job."""
    return svc.get_match(db, ctx.workspace_id, item_id)


@router.post("/beat-matches/{match_id}/swap", response_model=BeatMatchOut)
def swap_match(match_id: str, body: SwapRequest, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.swap(db, ctx.workspace_id, match_id, body.model_dump())


@router.post("/beat-matches/{match_id}/confirm", response_model=BeatMatchOut)
def confirm_match(match_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.confirm(db, ctx.workspace_id, match_id)


@router.post("/beat-matches/{match_id}/reject", response_model=BeatMatchOut)
def reject_match(match_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.reject(db, ctx.workspace_id, match_id)
