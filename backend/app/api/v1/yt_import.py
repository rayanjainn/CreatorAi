"""YouTube import: find videos on a topic, download one, analyse it and cut short clips."""

from __future__ import annotations

import re
from typing import Any

import httpx
from fastapi import APIRouter, Query, Response

from app.deps import CtxDep, DbDep
from app.errors import AppError
from app.schemas.yt_import import YtImportCreate, YtImportOut, YtImportStatus, YtSearchOut
from app.services import yt_import as svc

router = APIRouter(prefix="/yt-import", tags=["yt-import"])
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


@router.get("/status", response_model=YtImportStatus)
def status(ctx: CtxDep) -> dict[str, Any]:
    return svc.status()


@router.get("/search", response_model=YtSearchOut)
def search(
    ctx: CtxDep, q: str = Query(min_length=2, max_length=300), limit: int = Query(10, ge=1, le=20)
) -> dict[str, Any]:
    """YouTube videos about ``q`` from the configured web search (Serper or Tavily)."""
    return svc.search(q, limit)


@router.get("/thumbnail/{video_id}")
def thumbnail(video_id: str, ctx: CtxDep) -> Response:
    """YouTube's thumbnail for a video id, fetched here so the browser loads nothing remote."""
    if not _VIDEO_ID.match(video_id):
        raise AppError("VALIDATION_ERROR", "Not a YouTube video id")
    try:
        res = httpx.get(f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg", timeout=10.0)
    except httpx.HTTPError as exc:
        raise AppError("NOT_FOUND", "Thumbnail unavailable", status=404) from exc
    if res.status_code != 200:
        raise AppError("NOT_FOUND", "Thumbnail unavailable", status=404)
    return Response(
        res.content, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"}
    )


@router.post("", response_model=YtImportOut, status_code=201)
def start(body: YtImportCreate, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Probe the link, create a project (unless ``content_item_id``) and queue the download."""
    return svc.start(
        db,
        ctx.workspace_id,
        url=body.url,
        topic=body.topic,
        content_item_id=body.content_item_id,
        auto_clips=body.auto_clips,
        clip_count=body.clip_count,
    )


@router.get("", response_model=list[YtImportOut])
def list_(
    ctx: CtxDep,
    db: DbDep,
    content_item_id: str | None = None,
    limit: int = Query(30, ge=1, le=100),
) -> list[dict[str, Any]]:
    return svc.list_imports(db, ctx.workspace_id, content_item_id=content_item_id, limit=limit)


@router.get("/{import_id}", response_model=YtImportOut)
def get(import_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.get(db, ctx.workspace_id, import_id)


@router.delete("/{import_id}", status_code=204)
def remove(import_id: str, ctx: CtxDep, db: DbDep) -> Response:
    svc.delete(db, ctx.workspace_id, import_id)
    return Response(status_code=204)
