"""Optional cloud clipper: ``/api/v1/lumiclip/*`` (keys stay on the server)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Response

from app.config import get_settings
from app.deps import CtxDep, DbDep
from app.schemas.lumiclip import (
    LumiclipExport,
    LumiclipImport,
    LumiclipImportOut,
    LumiclipProjectOut,
    LumiclipStart,
    LumiclipStatus,
)
from app.services import lumiclip as svc

router = APIRouter(prefix="/lumiclip", tags=["lumiclip"])


@router.get("/status", response_model=LumiclipStatus)
def status(ctx: CtxDep) -> dict[str, Any]:
    s = get_settings()
    return {
        "configured": s.lumiclip_configured,
        "cloudinary_configured": s.cloudinary_configured,
        "base_url": s.lumiclip_base_url,
    }


@router.post("/projects", response_model=LumiclipProjectOut, status_code=201)
def start(body: LumiclipStart, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Start clipping a public URL, or a library video (uploaded to Cloudinary first)."""
    row = svc.start_project(
        db,
        ctx.workspace_id,
        url=body.url,
        asset_id=body.asset_id,
        content_item_id=body.content_item_id,
        aspect_ratio=body.aspect_ratio,
        start_time=body.start_time,
        end_time=body.end_time,
        language=body.language,
        subtitle_style=body.subtitle_style,
    )
    return svc.project_out(row)


@router.get("/projects", response_model=list[LumiclipProjectOut])
def list_(
    ctx: CtxDep,
    db: DbDep,
    content_item_id: str | None = None,
    limit: int = Query(30, ge=1, le=100),
) -> list[dict[str, Any]]:
    rows = svc.list_projects(db, ctx.workspace_id, content_item_id=content_item_id, limit=limit)
    return [svc.project_out(r) for r in rows]


@router.get("/projects/{project_id}", response_model=LumiclipProjectOut)
def get(project_id: str, ctx: CtxDep, db: DbDep, refresh: bool = True) -> dict[str, Any]:
    """The project; while it is running this asks LumiClip for fresh progress first."""
    row = (
        svc.refresh_project(db, ctx.workspace_id, project_id)
        if refresh
        else svc._require_project(db, ctx.workspace_id, project_id)
    )
    return svc.project_out(row)


@router.delete("/projects/{project_id}", status_code=204)
def remove(project_id: str, ctx: CtxDep, db: DbDep) -> Response:
    svc.delete_project(db, ctx.workspace_id, project_id)
    return Response(status_code=204)


@router.post("/projects/{project_id}/clips/{clip_id}/import", response_model=LumiclipImportOut)
def import_clip(
    project_id: str, clip_id: str, body: LumiclipImport, ctx: CtxDep, db: DbDep
) -> dict[str, Any]:
    """Save a finished clip into the library (then it can be edited and exported like any asset)."""
    row, asset, duplicate, job_id = svc.import_clip(
        db,
        ctx.workspace_id,
        project_id,
        clip_id,
        mode=body.mode,
        content_item_id=body.content_item_id,
    )
    return {
        "asset_id": asset.id,
        "duplicate": duplicate,
        "job_id": job_id,
        "project": svc.project_out(row),
    }


@router.post("/projects/{project_id}/clips/{clip_id}/export")
def export_clip(
    project_id: str, clip_id: str, body: LumiclipExport, ctx: CtxDep, db: DbDep
) -> dict[str, Any]:
    """Ask LumiClip to render a clip at a quality; returns its ``{status, url, ...}``."""
    return svc.export_clip(db, ctx.workspace_id, project_id, clip_id, body.quality)
