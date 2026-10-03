"""Smart clips: generate, list, review (Plan.md section 8.8)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.deps import CtxDep, DbDep
from app.schemas.clips import ClipOut, ClipPatch, ClipsEnqueued, GenerateClipsRequest
from app.services import clip_service as svc

router = APIRouter(tags=["clips"])


@router.post("/content/{item_id}/clips/generate", response_model=ClipsEnqueued, status_code=202)
def generate_clips(
    item_id: str, ctx: CtxDep, db: DbDep, body: GenerateClipsRequest | None = None
) -> dict[str, Any]:
    """Enqueue ``clips.generate`` (``409 ASSET_NOT_READY`` without a processed video)."""
    return svc.start_generate(
        db, ctx.workspace_id, item_id, (body or GenerateClipsRequest()).model_dump()
    )


@router.get("/clips", response_model=list[ClipOut])
def list_all_clips(
    ctx: CtxDep,
    db: DbDep,
    status: Annotated[str | None, Query(pattern="^(suggested|accepted|rejected)$")] = None,
    kind: Annotated[str | None, Query(pattern="^(short|full)$")] = None,
    content_item_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[dict[str, Any]]:
    """Clips across every content item, best score first (feeds the Smart Clips hub)."""
    return svc.list_all_clips(
        db,
        ctx.workspace_id,
        status=status,
        kind=kind,
        content_item_id=content_item_id,
        limit=limit,
        offset=offset,
    )


@router.get("/content/{item_id}/clips", response_model=list[ClipOut])
def list_clips(
    item_id: str,
    ctx: CtxDep,
    db: DbDep,
    status: Annotated[str | None, Query(pattern="^(suggested|accepted|rejected)$")] = None,
    kind: Annotated[str | None, Query(pattern="^(short|full)$")] = None,
) -> list[dict[str, Any]]:
    return svc.list_clips(db, ctx.workspace_id, item_id, status, kind)


@router.get("/clips/{clip_id}", response_model=ClipOut)
def get_clip(clip_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.get_clip(db, ctx.workspace_id, clip_id)


@router.patch("/clips/{clip_id}", response_model=ClipOut)
def patch_clip(clip_id: str, body: ClipPatch, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Edit title / hook / caption; edited fields become provenance ``user``."""
    return svc.patch_clip(db, ctx.workspace_id, clip_id, body.model_dump(exclude_unset=True))


@router.post("/clips/{clip_id}/accept", response_model=ClipOut)
def accept_clip(clip_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Accept (emits the ``clip_accepted`` twin event after commit and logs activity)."""
    return svc.accept(db, ctx.workspace_id, clip_id)


@router.post("/clips/{clip_id}/reject", response_model=ClipOut)
def reject_clip(clip_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.reject(db, ctx.workspace_id, clip_id)
