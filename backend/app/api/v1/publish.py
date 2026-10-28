"""Publish a finished render of a project to YouTube."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.deps import CtxDep, DbDep
from app.services import publish_service as svc

router = APIRouter(tags=["publish"])


class PublishBody(BaseModel):
    render_id: str
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=5000)
    tags: list[str] = Field(default_factory=list, max_length=60)
    visibility: Literal["private", "unlisted", "public"] = "private"
    scheduled_at: str | None = Field(default=None, max_length=40)


@router.get("/content/{item_id}/publish/defaults")
def defaults(item_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Pre-filled title, description and tags, the finished renders and the connection status."""
    return svc.defaults(db, ctx.workspace_id, item_id)


@router.get("/content/{item_id}/publish")
def list_jobs(item_id: str, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return svc.list_jobs(db, ctx.workspace_id, item_id)


@router.post("/content/{item_id}/publish", status_code=202)
def create(item_id: str, body: PublishBody, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Start the upload (job ``publish.upload``); returns the publish row and ``job_id``."""
    return svc.create(db, ctx.workspace_id, item_id, body.model_dump())


@router.post("/publish/{publish_id}/retry", status_code=202)
def retry(publish_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.retry(db, ctx.workspace_id, publish_id)
