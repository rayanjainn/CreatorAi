"""Renders: export a clip's timeline to mp4 (Plan.md 8.9)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query, Response

from app.deps import CtxDep, DbDep
from app.schemas.renders import RenderEnqueued, RenderOut, RenderRequest
from app.services import render_service as svc

router = APIRouter(tags=["renders"])


@router.post("/clips/{clip_id}/renders", response_model=RenderEnqueued, status_code=202)
def create_render(clip_id: str, body: RenderRequest, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Enqueue ``render.run`` (poll ``job_id`` or ``GET /renders/{id}``).

    ``422 DURATION_EXCEEDS_PRESET`` (``details.max_duration``) when the clip is longer than the
    preset allows; ``409 ASSET_NOT_READY`` when a source file is missing or still processing.
    """
    render, job_id = svc.start_render(
        db, ctx.workspace_id, clip_id, body.preset, body.caption_style
    )
    return {"render": svc.get_render(db, ctx.workspace_id, render.id), "job_id": job_id}


@router.get("/renders", response_model=list[RenderOut])
def list_renders(
    ctx: CtxDep,
    db: DbDep,
    status: Annotated[str | None, Query(pattern="^(queued|rendering|done|failed)$")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[dict[str, Any]]:
    """Every render of every clip, newest first (feeds the Repurpose hub)."""
    return svc.list_all(db, ctx.workspace_id, status=status, limit=limit, offset=offset)


@router.get("/clips/{clip_id}/renders", response_model=list[RenderOut])
def list_clip_renders(clip_id: str, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return svc.list_for_clip(db, ctx.workspace_id, clip_id)


@router.get("/content/{item_id}/renders", response_model=list[RenderOut])
def list_content_renders(item_id: str, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    """The export section's "Renders" list: every render of every clip of the item."""
    return svc.list_for_content(db, ctx.workspace_id, item_id)


@router.get("/renders/{render_id}", response_model=RenderOut)
def get_render(render_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Status plus signed ``preview_url`` / ``download_url`` (attachment) once ``done``."""
    return svc.get_render(db, ctx.workspace_id, render_id)


@router.delete("/renders/{render_id}", status_code=204)
def delete_render(render_id: str, ctx: CtxDep, db: DbDep) -> Response:
    svc.delete_render(db, ctx.workspace_id, render_id)
    return Response(status_code=204)
