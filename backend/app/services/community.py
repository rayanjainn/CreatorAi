"""Community feed shared by every account on this server: posts, comments and likes.

Unlike everything else, the feed is **not** workspace-scoped: any signed-in user sees every post.
Only the *source* of a post is scoped: you can share a finished render (or a ready library video)
of the workspace you are in. Its files are copied under ``community/{post_id}/`` so the post keeps
working when the render is deleted or re-rendered. Authors edit and delete their posts; comment
authors edit and delete their comments, and a post's author may remove comments on it.
"""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import String, cast, func, literal_column, select
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models import (
    Asset,
    Clip,
    CommunityComment,
    CommunityLike,
    CommunityPost,
    Render,
    User,
    Workspace,
)
from app.models.base import new_id
from app.security import sign_media
from app.services.activity import log_activity
from app.services.team import display_name
from app.storage.local import get_storage

PLATFORMS = ("youtube", "instagram", "tiktok")
# Timestamps have one-second resolution; SQLite's rowid keeps insertion order within a second.
POST_SEQ = literal_column("community_posts.rowid")
COMMENT_SEQ = literal_column("community_comments.rowid")
PRESET_ASPECT = {"yt_short": "9:16", "reels": "9:16", "tiktok": "9:16", "yt_long": "16:9"}
Sort = Literal["new", "top", "discussed"]


def _clean_tags(tags: list[str]) -> list[str]:
    out: list[str] = []
    for t in tags:
        tag = t.strip().lstrip("#").lower()[:32]
        if tag and tag not in out:
            out.append(tag)
    return out[:10]


def _clean_platforms(platforms: list[str]) -> list[str]:
    bad = [p for p in platforms if p not in PLATFORMS]
    if bad:
        raise AppError(
            "VALIDATION_ERROR", f"Unknown platform: {bad[0]}", details={"allowed": PLATFORMS}
        )
    return [p for p in PLATFORMS if p in platforms]


def _counts(db: Session, post_ids: list[str], me: str) -> dict[str, dict[str, Any]]:
    if not post_ids:
        return {}
    likes = dict(
        db.execute(
            select(CommunityLike.post_id, func.count())
            .where(CommunityLike.post_id.in_(post_ids))
            .group_by(CommunityLike.post_id)
        ).all()
    )
    comments = dict(
        db.execute(
            select(CommunityComment.post_id, func.count())
            .where(CommunityComment.post_id.in_(post_ids))
            .group_by(CommunityComment.post_id)
        ).all()
    )
    mine = set(
        db.scalars(
            select(CommunityLike.post_id).where(
                CommunityLike.post_id.in_(post_ids), CommunityLike.user_id == me
            )
        )
    )
    return {
        pid: {
            "like_count": int(likes.get(pid, 0)),
            "comment_count": int(comments.get(pid, 0)),
            "liked_by_me": pid in mine,
        }
        for pid in post_ids
    }


def _author(user: User | None) -> dict[str, Any]:
    if user is None:
        return {"id": None, "name": "Former member"}
    return {"id": user.id, "name": display_name(user)}


def post_out(
    db: Session, post: CommunityPost, me: str, counts: dict[str, Any] | None = None
) -> dict[str, Any]:
    counts = counts or _counts(db, [post.id], me)[post.id]
    workspace = db.get(Workspace, post.workspace_id)
    return {
        "id": post.id,
        "title": post.title,
        "body": post.body,
        "platforms": list(post.platforms or []),
        "tags": list(post.tags or []),
        "author": _author(db.get(User, post.author_id)),
        "workspace_name": workspace.name if workspace else None,
        "video_url": sign_media(post.video_key),
        "thumbnail_url": sign_media(post.thumb_key) if post.thumb_key else None,
        "duration_sec": post.duration_sec,
        "aspect": post.aspect,
        "render_id": post.render_id,
        "asset_id": post.asset_id,
        "mine": post.author_id == me,
        "created_at": post.created_at,
        "updated_at": post.updated_at,
        **counts,
    }


def _require_post(db: Session, post_id: str) -> CommunityPost:
    post = db.get(CommunityPost, post_id)
    if post is None:
        raise not_found("Post")
    return post


def list_posts(
    db: Session,
    me: str,
    *,
    sort: Sort = "new",
    platform: str | None = None,
    tag: str | None = None,
    author: str | None = None,
    q: str | None = None,
    limit: int = 24,
    offset: int = 0,
) -> dict[str, Any]:
    stmt = select(CommunityPost)
    if platform:
        if platform not in PLATFORMS:
            raise AppError("VALIDATION_ERROR", f"Unknown platform: {platform}")
        stmt = stmt.where(cast(CommunityPost.platforms, String).like(f'%"{platform}"%'))
    if tag:
        needle = tag.strip().lstrip("#").lower()
        stmt = stmt.where(cast(CommunityPost.tags, String).like(f'%"{needle}"%'))
    if author:
        stmt = stmt.where(CommunityPost.author_id == (me if author == "me" else author))
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(CommunityPost.title.ilike(like) | CommunityPost.body.ilike(like))
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    if sort == "top":
        likes = (
            select(func.count())
            .where(CommunityLike.post_id == CommunityPost.id)
            .correlate(CommunityPost)
            .scalar_subquery()
        )
        stmt = stmt.order_by(likes.desc(), CommunityPost.created_at.desc(), POST_SEQ.desc())
    elif sort == "discussed":
        comments = (
            select(func.count())
            .where(CommunityComment.post_id == CommunityPost.id)
            .correlate(CommunityPost)
            .scalar_subquery()
        )
        stmt = stmt.order_by(comments.desc(), CommunityPost.created_at.desc(), POST_SEQ.desc())
    else:
        stmt = stmt.order_by(CommunityPost.created_at.desc(), POST_SEQ.desc())
    posts = list(db.scalars(stmt.limit(limit).offset(offset)))
    counts = _counts(db, [p.id for p in posts], me)
    return {
        "items": [post_out(db, p, me, counts[p.id]) for p in posts],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_post(db: Session, post_id: str, me: str) -> dict[str, Any]:
    return post_out(db, _require_post(db, post_id), me)


def _source_files(
    db: Session, workspace_id: str, render_id: str | None, asset_id: str | None
) -> tuple[str, str | None, float | None, str | None, str]:
    """``(video_key, thumb_key, duration, aspect, default_title)`` of what is being shared."""
    if bool(render_id) == bool(asset_id):
        raise AppError("VALIDATION_ERROR", "Share exactly one of render_id or asset_id.")
    if render_id:
        render = db.get(Render, render_id)
        if render is None or render.workspace_id != workspace_id:
            raise not_found("Render")
        if render.status != "done" or not render.output_key:
            raise AppError("ASSET_NOT_READY", "Only finished renders can be shared.", status=409)
        clip = db.get(Clip, render.clip_id)
        title = clip.title if clip else "My clip"
        aspect = PRESET_ASPECT.get(render.preset)
        return render.output_key, render.thumb_key, render.duration_sec, aspect, title
    asset = db.get(Asset, asset_id)
    if asset is None or asset.workspace_id != workspace_id:
        raise not_found("Asset")
    if asset.kind != "video" or asset.status != "ready":
        raise AppError("ASSET_NOT_READY", "Only ready library videos can be shared.", status=409)
    aspect = None
    if asset.width and asset.height:
        aspect = "9:16" if asset.height > asset.width else "16:9"
    title = asset.filename.rsplit(".", 1)[0]
    return asset.storage_key, asset.thumb_key, asset.duration_sec, aspect, title


def create_post(
    db: Session,
    workspace_id: str,
    author: User,
    *,
    render_id: str | None,
    asset_id: str | None,
    title: str | None,
    body: str,
    platforms: list[str],
    tags: list[str],
) -> dict[str, Any]:
    video_key, thumb_key, duration, aspect, default_title = _source_files(
        db, workspace_id, render_id, asset_id
    )
    storage = get_storage()
    if not storage.exists(video_key):
        raise AppError("ASSET_NOT_READY", "The video file is missing on disk.", status=409)
    post_id = new_id()
    new_video = f"community/{post_id}/video.mp4"
    storage.put_file(new_video, storage.path_for(video_key))
    new_thumb = None
    if thumb_key and storage.exists(thumb_key):
        new_thumb = f"community/{post_id}/thumb.jpg"
        storage.put_file(new_thumb, storage.path_for(thumb_key))
    post = CommunityPost(
        id=post_id,
        author_id=author.id,
        workspace_id=workspace_id,
        render_id=render_id,
        asset_id=asset_id,
        title=(title or default_title).strip()[:200] or "Untitled",
        body=body.strip(),
        platforms=_clean_platforms(platforms),
        tags=_clean_tags(tags),
        video_key=new_video,
        thumb_key=new_thumb,
        duration_sec=duration,
        aspect=aspect,
    )
    db.add(post)
    db.flush()
    log_activity(db, workspace_id, "community_posted", "community_post", post.id, title=post.title)
    return post_out(db, post, author.id)


def _require_author(post: CommunityPost, user_id: str) -> None:
    if post.author_id != user_id:
        raise AppError("FORBIDDEN", "Only the author can change this post.", status=403)


def patch_post(db: Session, post_id: str, me: str, changes: dict[str, Any]) -> dict[str, Any]:
    post = _require_post(db, post_id)
    _require_author(post, me)
    if changes.get("title") is not None:
        title = changes["title"].strip()
        if not title:
            raise AppError("VALIDATION_ERROR", "A post needs a title.")
        post.title = title[:200]
    if changes.get("body") is not None:
        post.body = changes["body"].strip()
    if changes.get("platforms") is not None:
        post.platforms = _clean_platforms(changes["platforms"])
    if changes.get("tags") is not None:
        post.tags = _clean_tags(changes["tags"])
    db.flush()
    return post_out(db, post, me)


def delete_post(db: Session, post_id: str, me: str) -> None:
    post = _require_post(db, post_id)
    _require_author(post, me)
    db.delete(post)
    db.flush()
    get_storage().delete_prefix(f"community/{post_id}")


def set_like(db: Session, post_id: str, me: str, liked: bool) -> dict[str, Any]:
    _require_post(db, post_id)
    row = db.get(CommunityLike, (post_id, me))
    if liked and row is None:
        db.add(CommunityLike(post_id=post_id, user_id=me))
    elif not liked and row is not None:
        db.delete(row)
    db.flush()
    counts = _counts(db, [post_id], me)[post_id]
    return {"post_id": post_id, "liked": counts["liked_by_me"], "like_count": counts["like_count"]}


# ── comments ─────────────────────────────────────────────────────────────────────────────────


def _comment_out(
    c: CommunityComment, author: User | None, me: str, post_author: str
) -> dict[str, Any]:
    return {
        "id": c.id,
        "post_id": c.post_id,
        "parent_id": c.parent_id,
        "body": c.body,
        "author": _author(author),
        "mine": c.author_id == me,
        "can_delete": c.author_id == me or post_author == me,
        "by_post_author": c.author_id == post_author,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
    }


def list_comments(db: Session, post_id: str, me: str) -> list[dict[str, Any]]:
    post = _require_post(db, post_id)
    rows = db.execute(
        select(CommunityComment, User)
        .join(User, User.id == CommunityComment.author_id, isouter=True)
        .where(CommunityComment.post_id == post_id)
        .order_by(CommunityComment.created_at, COMMENT_SEQ)
    ).all()
    return [_comment_out(c, u, me, post.author_id) for c, u in rows]


def add_comment(
    db: Session, post_id: str, author: User, *, body: str, parent_id: str | None
) -> dict[str, Any]:
    post = _require_post(db, post_id)
    text = body.strip()
    if not text:
        raise AppError("VALIDATION_ERROR", "A comment cannot be empty.")
    if parent_id:
        parent = db.get(CommunityComment, parent_id)
        if parent is None or parent.post_id != post_id:
            raise not_found("Comment")
        parent_id = parent.parent_id or parent.id  # replies stay one level deep
    row = CommunityComment(post_id=post_id, author_id=author.id, parent_id=parent_id, body=text)
    db.add(row)
    db.flush()
    return _comment_out(row, author, author.id, post.author_id)


def _require_comment(db: Session, comment_id: str) -> CommunityComment:
    row = db.get(CommunityComment, comment_id)
    if row is None:
        raise not_found("Comment")
    return row


def patch_comment(db: Session, comment_id: str, user: User, body: str) -> dict[str, Any]:
    row = _require_comment(db, comment_id)
    if row.author_id != user.id:
        raise AppError("FORBIDDEN", "You can only edit your own comments.", status=403)
    text = body.strip()
    if not text:
        raise AppError("VALIDATION_ERROR", "A comment cannot be empty.")
    row.body = text
    db.flush()
    post = _require_post(db, row.post_id)
    return _comment_out(row, user, user.id, post.author_id)


def delete_comment(db: Session, comment_id: str, me: str) -> None:
    row = _require_comment(db, comment_id)
    post = _require_post(db, row.post_id)
    if row.author_id != me and post.author_id != me:
        raise AppError(
            "FORBIDDEN", "Only the comment's author or the post's author can remove it.", status=403
        )
    db.delete(row)
    db.flush()
