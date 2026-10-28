"""Account safety and workspace data: password change, signing out everywhere, login throttling,
exporting everything the creator made, and wiping it.

Signing out works through ``users.token_version``: every token carries the version it was issued
with (``tv``) and ``deps`` rejects tokens whose version is older than the user's.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import (
    ActivityLog,
    Asset,
    AssetSegment,
    BrandDeal,
    Clip,
    ContentItem,
    CreatorProfile,
    DirectorOutput,
    IdeaSuggestion,
    InsightSnapshot,
    Job,
    LumiclipProject,
    PublishJob,
    Render,
    Script,
    TwinMemory,
    TwinMessage,
    Upload,
    User,
    Workspace,
    YtVideo,
    utcnow,
)
from app.models.research import ResearchBrief
from app.security import hash_password, issue_token, verify_password
from app.services.activity import log_activity
from app.storage.local import get_storage

LOGIN_WINDOW_SEC = 15 * 60
LOGIN_MAX_FAILURES = 5
_FAILURES: dict[str, deque[float]] = {}
_LOCK = threading.Lock()


# ── login throttling ──────────────────────────────────────────────────────────────────────────
def _key(email: str, ip: str | None) -> str:
    return f"{email.strip().lower()}|{ip or ''}"


def check_login_allowed(email: str, ip: str | None) -> None:
    """``429 TOO_MANY_ATTEMPTS`` after 5 failures for this email and address in 15 minutes."""
    now = time.monotonic()
    with _LOCK:
        q = _FAILURES.get(_key(email, ip))
        while q and now - q[0] > LOGIN_WINDOW_SEC:
            q.popleft()
        if q and len(q) >= LOGIN_MAX_FAILURES:
            wait = int(LOGIN_WINDOW_SEC - (now - q[0])) + 1
            raise AppError(
                "TOO_MANY_ATTEMPTS",
                f"Too many wrong passwords. Try again in {max(1, wait // 60)} minute(s), or reset "
                "the password with `make reset-password`.",
                details={"retry_after": wait},
                headers={"Retry-After": str(wait)},
            )


def record_login(email: str, ip: str | None, ok: bool) -> None:
    with _LOCK:
        key = _key(email, ip)
        if ok:
            _FAILURES.pop(key, None)
        else:
            _FAILURES.setdefault(key, deque(maxlen=LOGIN_MAX_FAILURES * 2)).append(time.monotonic())


def reset_throttle() -> None:
    with _LOCK:
        _FAILURES.clear()


# ── password and sessions ─────────────────────────────────────────────────────────────────────
def _user(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise AppError("UNAUTHORIZED", "Account no longer exists")
    return user


def change_password(
    db: Session, user_id: str, workspace_id: str, current: str, new: str
) -> dict[str, str]:
    """Set a new password, sign out every other session and return a fresh token for this one."""
    user = _user(db, user_id)
    if not verify_password(current, user.password_hash):
        raise AppError("INVALID_CREDENTIALS", "Your current password is not right.", status=422)
    if current == new:
        raise AppError("VALIDATION_ERROR", "Pick a password you have not used here.")
    user.password_hash = hash_password(new)
    user.token_version = (user.token_version or 0) + 1
    db.flush()
    log_activity(db, workspace_id, "password_changed", "user", user_id)
    return {"access_token": issue_token(user_id, workspace_id, user.token_version)}


def sign_out_everywhere(db: Session, user_id: str, workspace_id: str) -> dict[str, str]:
    user = _user(db, user_id)
    user.token_version = (user.token_version or 0) + 1
    db.flush()
    log_activity(db, workspace_id, "signed_out_everywhere", "user", user_id)
    return {"access_token": issue_token(user_id, workspace_id, user.token_version)}


# ── export ────────────────────────────────────────────────────────────────────────────────────
def export(db: Session, ws: str) -> dict[str, Any]:
    """Everything the creator wrote or decided, as JSON (media files are not included)."""

    def rows(model: Any, *order: Any) -> list[Any]:
        q = select(model).where(model.workspace_id == ws)
        return list(db.scalars(q.order_by(*order) if order else q))

    workspace = db.get(Workspace, ws)
    profile = db.get(CreatorProfile, ws)
    segments: dict[str, list[str]] = {}
    for seg in rows(AssetSegment, AssetSegment.asset_id, AssetSegment.idx):
        segments.setdefault(seg.asset_id, []).append(seg.text)
    return {
        "format": "creatorai-export",
        "version": 1,
        "exported_at": utcnow(),
        "workspace": {"id": ws, "name": getattr(workspace, "name", None)},
        "profile": {
            k: getattr(profile, k)
            for k in (
                "display_name",
                "domain",
                "audience",
                "tone",
                "language",
                "platforms",
                "style_profile",
            )
        }
        if profile
        else None,
        "projects": [
            {
                k: getattr(c, k)
                for k in (
                    "id",
                    "title",
                    "idea_text",
                    "objective",
                    "domain",
                    "stage",
                    "target_duration_sec",
                    "scheduled_for",
                    "published_at",
                    "created_at",
                )
            }
            for c in rows(ContentItem, ContentItem.created_at)
        ],
        "scripts": [
            {
                "content_item_id": s.content_item_id,
                "version": s.version,
                "current": s.is_current,
                "body_md": s.body_md,
                "meta": s.meta,
                "hook_options": s.hook_options,
                "selected_hook": s.selected_hook,
                "created_at": s.created_at,
            }
            for s in rows(Script, Script.created_at)
        ],
        "director": [
            {
                "content_item_id": d.content_item_id,
                "kind": d.kind,
                "version": d.version,
                "payload": d.payload,
                "created_at": d.created_at,
            }
            for d in rows(DirectorOutput, DirectorOutput.created_at)
        ],
        "ideas": [
            {"title": i.title, "rationale": i.rationale, "source": i.source, "status": i.status}
            for i in rows(IdeaSuggestion)
        ],
        "assets": [
            {
                "id": a.id,
                "filename": a.filename,
                "kind": a.kind,
                "duration_sec": a.duration_sec,
                "description": a.description,
                "tags": a.tags,
                "content_item_id": a.content_item_id,
                "transcript": " ".join(segments.get(a.id, [])),
                "created_at": a.created_at,
            }
            for a in rows(Asset, Asset.created_at)
        ],
        "clips": [
            {
                "id": c.id,
                "content_item_id": c.content_item_id,
                "kind": c.kind,
                "title": c.title,
                "hook": c.hook,
                "caption": c.caption,
                "start_sec": c.start_sec,
                "end_sec": c.end_sec,
                "status": c.status,
            }
            for c in rows(Clip, Clip.created_at)
        ],
        "brand_deals": [
            {
                k: getattr(d, k)
                for k in (
                    "brand",
                    "website",
                    "contact_name",
                    "contact_email",
                    "stage",
                    "fee",
                    "currency",
                    "deliverables",
                    "due_date",
                    "notes",
                    "pitch",
                    "created_at",
                )
            }
            for d in rows(BrandDeal, BrandDeal.created_at)
        ],
        "research": [
            {"topic": r.topic, "doc": r.doc, "created_at": r.created_at}
            for r in rows(ResearchBrief, ResearchBrief.created_at)
        ],
        "twin_memories": [
            {"kind": m.kind, "text": m.text, "created_at": m.created_at}
            for m in rows(TwinMemory, TwinMemory.created_at)
        ],
        "published_videos": [
            {
                "youtube_video_id": v.youtube_video_id,
                "title": v.title,
                "published_at": v.published_at,
            }
            for v in rows(YtVideo)
            if not v.is_seed
        ],
    }


# ── wipe ──────────────────────────────────────────────────────────────────────────────────────
def wipe(db: Session, ws: str, role: str) -> dict[str, int]:
    """Delete every project, file and generated row of the workspace; keep the account, the
    team, the profile settings and the YouTube connection."""
    if role != "owner":
        raise AppError("FORBIDDEN", "Only the workspace owner can wipe its data.", status=403)
    busy = db.scalar(
        select(Job.id).where(Job.workspace_id == ws, Job.status.in_(("queued", "running"))).limit(1)
    )
    if busy:
        raise AppError("CONFLICT", "Jobs are still running. Wait for them or cancel them first.")
    storage = get_storage()
    files = 0
    for r in db.scalars(select(Render).where(Render.workspace_id == ws)):
        for key in (r.output_key, r.thumb_key):
            if key:
                files += storage.delete_prefix(key)
    counts: dict[str, int] = {}
    for model in (PublishJob, Render, Clip, BrandDeal, ResearchBrief, ContentItem, Asset, Upload,
                  IdeaSuggestion, TwinMemory, TwinMessage, InsightSnapshot, YtVideo,
                  LumiclipProject, Job, ActivityLog):  # fmt: skip
        result = db.execute(delete(model).where(model.workspace_id == ws))
        counts[model.__tablename__] = int(result.rowcount or 0)  # type: ignore[attr-defined]
    files += storage.delete_prefix(f"media/{ws}")
    profile = db.get(CreatorProfile, ws)
    if profile is not None:
        profile.style_profile, profile.approvals_since_style_update = {}, 0
    db.flush()
    log_activity(db, ws, "workspace_wiped", "workspace", ws, **counts)
    return {**counts, "files": files}
