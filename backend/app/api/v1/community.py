"""Community feed shared by everyone on this server: posts of finished work, likes, comments."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Query, Response

from app.deps import CtxDep, DbDep, PageDep
from app.models import User
from app.schemas.community import (
    CommunityCommentCreate,
    CommunityCommentOut,
    CommunityCommentPatch,
    LikeOut,
    PostCreate,
    PostOut,
    PostPage,
    PostPatch,
)
from app.services import community as svc

router = APIRouter(prefix="/community", tags=["community"])


def _user(db: DbDep, user_id: str) -> User:
    user = db.get(User, user_id)
    assert user is not None
    return user


@router.get("/posts", response_model=PostPage)
def list_posts(
    ctx: CtxDep,
    db: DbDep,
    page: PageDep,
    sort: Literal["new", "top", "discussed"] = "new",
    platform: str | None = None,
    tag: str | None = None,
    author: str | None = Query(None, description='a user id, or "me"'),
    q: str | None = Query(None, max_length=200),
) -> dict[str, Any]:
    """Every post on this server (not only your workspace's), newest first by default."""
    return svc.list_posts(
        db, ctx.user_id, sort=sort, platform=platform, tag=tag, author=author, q=q,
        limit=page.limit, offset=page.offset,
    )  # fmt: skip


@router.post("/posts", response_model=PostOut, status_code=201)
def create_post(body: PostCreate, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Share a finished render (or a ready video) of the current workspace (editor role)."""
    return svc.create_post(
        db,
        ctx.workspace_id,
        _user(db, ctx.user_id),
        render_id=body.render_id,
        asset_id=body.asset_id,
        title=body.title,
        body=body.body,
        platforms=list(body.platforms),
        tags=body.tags,
    )


@router.get("/posts/{post_id}", response_model=PostOut)
def get_post(post_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.get_post(db, post_id, ctx.user_id)


@router.patch("/posts/{post_id}", response_model=PostOut)
def patch_post(post_id: str, body: PostPatch, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.patch_post(db, post_id, ctx.user_id, body.model_dump(exclude_unset=True))


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: str, ctx: CtxDep, db: DbDep) -> Response:
    svc.delete_post(db, post_id, ctx.user_id)
    return Response(status_code=204)


@router.put("/posts/{post_id}/like", response_model=LikeOut)
def like(post_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.set_like(db, post_id, ctx.user_id, True)


@router.delete("/posts/{post_id}/like", response_model=LikeOut)
def unlike(post_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.set_like(db, post_id, ctx.user_id, False)


@router.get("/posts/{post_id}/comments", response_model=list[CommunityCommentOut])
def list_comments(post_id: str, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return svc.list_comments(db, post_id, ctx.user_id)


@router.post("/posts/{post_id}/comments", response_model=CommunityCommentOut, status_code=201)
def add_comment(
    post_id: str, body: CommunityCommentCreate, ctx: CtxDep, db: DbDep
) -> dict[str, Any]:
    return svc.add_comment(
        db, post_id, _user(db, ctx.user_id), body=body.body, parent_id=body.parent_id
    )


@router.patch("/comments/{community_comment_id}", response_model=CommunityCommentOut)
def patch_comment(
    community_comment_id: str, body: CommunityCommentPatch, ctx: CtxDep, db: DbDep
) -> dict[str, Any]:
    return svc.patch_comment(db, community_comment_id, _user(db, ctx.user_id), body.body)


@router.delete("/comments/{community_comment_id}", status_code=204)
def delete_comment(community_comment_id: str, ctx: CtxDep, db: DbDep) -> Response:
    svc.delete_comment(db, community_comment_id, ctx.user_id)
    return Response(status_code=204)
