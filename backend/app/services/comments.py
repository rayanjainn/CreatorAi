"""Comments on a project (optionally on a clip, at a timecode) and who-is-here presence."""

from __future__ import annotations

import threading
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models import Clip, Comment, ContentItem, User
from app.services import access
from app.services.activity import log_activity
from app.services.team import display_name

PRESENCE_TTL = 30.0


def _require_item(db: Session, workspace_id: str, item_id: str) -> ContentItem:
    item = db.get(ContentItem, item_id)
    if item is None or item.workspace_id != workspace_id:
        raise not_found("Project")
    return item


def _out(c: Comment, author: User | None, me: str) -> dict[str, Any]:
    return {
        "id": c.id,
        "content_item_id": c.content_item_id,
        "clip_id": c.clip_id,
        "parent_id": c.parent_id,
        "at_sec": c.at_sec,
        "body": c.body,
        "resolved": bool(c.resolved),
        "author_id": c.author_id,
        "author_name": display_name(author) if author else "Former member",
        "created_at": c.created_at,
        "updated_at": c.updated_at,
        "mine": c.author_id == me,
    }


def list_comments(
    db: Session, workspace_id: str, item_id: str, me: str, *, clip_id: str | None = None
) -> list[dict[str, Any]]:
    _require_item(db, workspace_id, item_id)
    stmt = select(Comment, User).join(User, User.id == Comment.author_id, isouter=True)
    stmt = stmt.where(Comment.workspace_id == workspace_id, Comment.content_item_id == item_id)
    if clip_id:
        stmt = stmt.where(Comment.clip_id == clip_id)
    rows = db.execute(stmt.order_by(Comment.created_at)).all()
    return [_out(c, u, me) for c, u in rows]


def add_comment(
    db: Session,
    workspace_id: str,
    item_id: str,
    author: User,
    *,
    body: str,
    clip_id: str | None,
    at_sec: float | None,
    parent_id: str | None,
) -> dict[str, Any]:
    _require_item(db, workspace_id, item_id)
    if clip_id:
        clip = db.get(Clip, clip_id)
        if clip is None or clip.workspace_id != workspace_id or clip.content_item_id != item_id:
            raise not_found("Clip")
    if parent_id:
        parent = db.get(Comment, parent_id)
        if parent is None or parent.content_item_id != item_id:
            raise not_found("Comment")
        clip_id = parent.clip_id  # a reply lives where its thread lives
    row = Comment(
        workspace_id=workspace_id,
        content_item_id=item_id,
        clip_id=clip_id,
        parent_id=parent_id,
        author_id=author.id,
        at_sec=at_sec,
        body=body.strip(),
    )
    db.add(row)
    db.flush()
    log_activity(db, workspace_id, "comment_added", "content_item", item_id, clip_id=clip_id)
    return _out(row, author, author.id)


def _require_comment(db: Session, workspace_id: str, comment_id: str) -> Comment:
    row = db.get(Comment, comment_id)
    if row is None or row.workspace_id != workspace_id:
        raise not_found("Comment")
    return row


def patch_comment(
    db: Session,
    workspace_id: str,
    comment_id: str,
    user: User,
    role: str,
    *,
    body: str | None,
    resolved: bool | None,
) -> dict[str, Any]:
    row = _require_comment(db, workspace_id, comment_id)
    if body is not None:
        if row.author_id != user.id:
            raise AppError("FORBIDDEN", "You can only edit your own comments.", status=403)
        row.body = body.strip()
    if resolved is not None:
        # anyone who can edit the project can resolve a thread; so can its author
        effective = access.effective_role(db, user.id, workspace_id, role, row.content_item_id)
        if row.author_id != user.id and not access.at_least(effective, "editor"):
            raise AppError(
                "FORBIDDEN", "Only editors can resolve other people's comments.", status=403
            )
        row.resolved = resolved
    db.flush()
    author = db.get(User, row.author_id)
    return _out(row, author, user.id)


def delete_comment(db: Session, workspace_id: str, comment_id: str, user: User, role: str) -> None:
    row = _require_comment(db, workspace_id, comment_id)
    if row.author_id != user.id and not access.at_least(role, "admin"):
        raise AppError("FORBIDDEN", "You can only delete your own comments.", status=403)
    db.delete(row)
    db.flush()


# ── presence (who has this project open): in memory, a few seconds of memory is all it needs ──
_lock = threading.Lock()
_seen: dict[tuple[str, str], dict[str, tuple[str, float]]] = {}


def beat(workspace_id: str, item_id: str, user_id: str, where: str) -> None:
    now = time.monotonic()
    with _lock:
        room = _seen.setdefault((workspace_id, item_id), {})
        room[user_id] = (where, now)
        for uid in [u for u, (_, t) in room.items() if now - t > PRESENCE_TTL]:
            del room[uid]


def here(db: Session, workspace_id: str, item_id: str, me: str) -> list[dict[str, Any]]:
    """Others with the project open right now (not the caller)."""
    now = time.monotonic()
    with _lock:
        room = dict(_seen.get((workspace_id, item_id), {}))
    out: list[dict[str, Any]] = []
    for uid, (where, t) in room.items():
        if uid == me or now - t > PRESENCE_TTL:
            continue
        user = db.get(User, uid)
        if user is not None:
            out.append(
                {
                    "user_id": uid,
                    "name": display_name(user),
                    "where": where,
                    "seconds_ago": int(now - t),
                }
            )
    out.sort(key=lambda r: r["name"].lower())
    return out
