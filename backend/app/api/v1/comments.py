"""Comments on projects and clips, and who-is-here presence."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response

from app.deps import CtxDep, DbDep
from app.errors import not_found
from app.models import ContentItem, User
from app.schemas.team import CommentCreate, CommentOut, CommentPatch, PresenceBeat, PresenceOut
from app.services import comments as svc

router = APIRouter(tags=["comments"])


@router.get("/content/{item_id}/comments", response_model=list[CommentOut])
def list_comments(
    item_id: str, ctx: CtxDep, db: DbDep, clip_id: str | None = None
) -> list[dict[str, Any]]:
    return svc.list_comments(db, ctx.workspace_id, item_id, ctx.user_id, clip_id=clip_id)


@router.post("/content/{item_id}/comments", response_model=CommentOut, status_code=201)
def add_comment(item_id: str, body: CommentCreate, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Anyone in the workspace can comment, including viewers."""
    author = db.get(User, ctx.user_id)
    assert author is not None
    return svc.add_comment(
        db,
        ctx.workspace_id,
        item_id,
        author,
        body=body.body,
        clip_id=body.clip_id,
        at_sec=body.at_sec,
        parent_id=body.parent_id,
    )


@router.patch("/comments/{comment_id}", response_model=CommentOut)
def patch_comment(comment_id: str, body: CommentPatch, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    user = db.get(User, ctx.user_id)
    assert user is not None
    return svc.patch_comment(
        db, ctx.workspace_id, comment_id, user, ctx.role, body=body.body, resolved=body.resolved
    )


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: str, ctx: CtxDep, db: DbDep) -> Response:
    user = db.get(User, ctx.user_id)
    assert user is not None
    svc.delete_comment(db, ctx.workspace_id, comment_id, user, ctx.role)
    return Response(status_code=204)


@router.post("/content/{item_id}/presence", response_model=list[PresenceOut])
def presence(item_id: str, body: PresenceBeat, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    """Heartbeat (every ~10 s while a project is open); returns the others who are here now."""
    item = db.get(ContentItem, item_id)
    if item is None or item.workspace_id != ctx.workspace_id:
        raise not_found("Project")
    svc.beat(ctx.workspace_id, item_id, ctx.user_id, body.where)
    return svc.here(db, ctx.workspace_id, item_id, ctx.user_id)
