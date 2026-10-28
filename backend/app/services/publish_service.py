"""Publishing a finished render to YouTube (job ``publish.upload`` on the ``io`` queue).

``defaults`` pre-fills the form from the project's script meta and, when an accepted sponsor
read is still in the rendered clip, puts the paid-promotion line first in the description
(Plan 8.10 step 8; the creator can edit it). ``create`` checks the render is done and its preset
is publishable, stores a ``publish_jobs`` row and starts the upload. A scheduled video is
uploaded as private with ``publishAt``, which is how YouTube schedules.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.integrations import youtube as yt
from app.media.presets import get_preset
from app.models import Clip, ContentItem, PublishJob, Render, Script, YtVideo, utcnow
from app.services import render_service, sponsor_service, youtube_service
from app.services.activity import log_activity
from app.storage.local import get_storage
from app.workers.runner import JobContext, enqueue

log = logging.getLogger(__name__)

JOB_TYPE = "publish.upload"
DISCLOSURE = "This video includes a paid promotion from {brands}."
TITLE_MAX, DESCRIPTION_MAX, TAGS_CHARS_MAX = 100, 5000, 480


def publish_out(p: PublishJob) -> dict[str, Any]:
    return {
        "id": p.id,
        "content_item_id": p.content_item_id,
        "render_id": p.render_id,
        "platform": p.platform,
        "title": p.title,
        "description": p.description,
        "tags": p.tags or [],
        "visibility": p.visibility,
        "scheduled_at": p.scheduled_at,
        "status": p.status,
        "youtube_video_id": p.youtube_video_id,
        "url": f"https://youtu.be/{p.youtube_video_id}" if p.youtube_video_id else None,
        "studio_url": (
            f"https://studio.youtube.com/video/{p.youtube_video_id}/edit"
            if p.youtube_video_id
            else None
        ),
        "error": p.error,
        "created_at": p.created_at,
        "published_at": p.published_at,
    }


def _item(db: Session, ws: str, item_id: str) -> ContentItem:
    item = db.get(ContentItem, item_id)
    if item is None or item.workspace_id != ws:
        raise not_found("Project")
    return item


def _renders(db: Session, ws: str, item_id: str) -> list[tuple[Render, Clip]]:
    rows = db.execute(
        select(Render, Clip)
        .join(Clip, Clip.id == Render.clip_id)
        .where(Render.workspace_id == ws, Clip.content_item_id == item_id, Render.status == "done")
        .order_by(Render.created_at.desc())
    ).all()
    return [(r, c) for r, c in rows]


def _join_tags(tags: list[str]) -> list[str]:
    """YouTube allows about 500 characters of tags in total; keep whole tags until that."""
    out, used = [], 0
    for t in tags:
        t = t.strip().lstrip("#")[:100]
        if not t or t.lower() in {x.lower() for x in out}:
            continue
        if used + len(t) + 1 > TAGS_CHARS_MAX:
            break
        out.append(t)
        used += len(t) + 1
    return out


def defaults(db: Session, ws: str, item_id: str) -> dict[str, Any]:
    item = _item(db, ws, item_id)
    script = db.scalar(
        select(Script).where(
            Script.workspace_id == ws,
            Script.content_item_id == item_id,
            Script.is_current.is_(True),
        )
    )
    meta = (script.meta if script else None) or {}
    titles = [str(t) for t in meta.get("titles") or [] if str(t).strip()]
    renders = _renders(db, ws, item_id)
    out = []
    for r, c in renders:
        brands = sponsor_service.disclosure_brands(db, ws, c.id)
        out.append({**render_service.render_out(r, c), "sponsor_brands": brands})
    return {
        "title": (titles[0] if titles else item.title.removeprefix("[DEMO] "))[:TITLE_MAX],
        "title_options": titles[:5],
        "description": str(meta.get("description") or ""),
        "tags": _join_tags([str(t) for t in meta.get("tags") or []]),
        "renders": out,
        "disclosure_template": DISCLOSURE,
        "connection": youtube_service.status(db, ws),
    }


def list_jobs(db: Session, ws: str, item_id: str) -> list[dict[str, Any]]:
    _item(db, ws, item_id)
    rows = db.scalars(
        select(PublishJob)
        .where(PublishJob.workspace_id == ws, PublishJob.content_item_id == item_id)
        .order_by(PublishJob.created_at.desc())
    )
    return [publish_out(p) for p in rows]


def _parse_schedule(value: str | None) -> str | None:
    if not value:
        return None
    try:
        when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AppError("VALIDATION_ERROR", "scheduled_at must be an ISO date and time") from exc
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    if when <= datetime.now(UTC):
        raise AppError("VALIDATION_ERROR", "Pick a time in the future to schedule the video.")
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def create(db: Session, ws: str, item_id: str, body: dict[str, Any]) -> dict[str, Any]:
    _item(db, ws, item_id)
    render = db.get(Render, body["render_id"])
    clip = db.get(Clip, render.clip_id) if render else None
    if (
        render is None
        or render.workspace_id != ws
        or clip is None
        or clip.content_item_id != item_id
    ):
        raise not_found("Render")
    if render.status != "done" or not render.output_key:
        raise AppError("ASSET_NOT_READY", "This render is not finished yet.")
    preset = get_preset(render.preset)
    if not preset.publishable:
        raise AppError(
            "VALIDATION_ERROR",
            f"{preset.label} renders are download-only. Render the clip as a YouTube preset to "
            "publish it here.",
            details={"preset": render.preset},
        )
    youtube_service.access_token(db, ws)  # fails early when there is no usable connection
    title = str(body["title"]).strip()[:TITLE_MAX]
    if not title:
        raise AppError("VALIDATION_ERROR", "A video needs a title.")
    scheduled = _parse_schedule(body.get("scheduled_at"))
    visibility = "private" if scheduled else body.get("visibility", "private")
    row = PublishJob(
        workspace_id=ws, content_item_id=item_id, render_id=render.id, title=title,
        description=str(body.get("description") or "")[:DESCRIPTION_MAX],
        tags=_join_tags(list(body.get("tags") or [])), visibility=visibility,
        scheduled_at=scheduled, status="queued",
    )  # fmt: skip
    db.add(row)
    db.flush()
    log_activity(db, ws, "publish_started", "content_item", item_id, publish_id=row.id)
    out = publish_out(row)
    db.commit()  # the job runs in its own session (SQLite has one writer)
    job_id = enqueue(JOB_TYPE, "publish_job", out["id"], {"publish_id": out["id"]}, workspace_id=ws)
    return {**out, "job_id": job_id}


def retry(db: Session, ws: str, publish_id: str) -> dict[str, Any]:
    row = db.get(PublishJob, publish_id)
    if row is None or row.workspace_id != ws:
        raise not_found("Publish job")
    if row.status != "failed":
        raise AppError("CONFLICT", "Only a failed upload can be retried.")
    row.status, row.error = "queued", None
    out = publish_out(row)
    db.commit()
    job_id = enqueue(JOB_TYPE, "publish_job", out["id"], {"publish_id": out["id"]}, workspace_id=ws)
    return {**out, "job_id": job_id}


# ── the job ───────────────────────────────────────────────────────────────────────────────────
def run_upload(ctx: JobContext) -> dict[str, Any]:
    ws = ctx.workspace_id
    publish_id = str(ctx.payload.get("publish_id") or ctx.entity_id)
    ctx.progress(2, "preparing")
    with ctx.session_factory() as db:
        row = db.get(PublishJob, publish_id)
        if row is None or row.workspace_id != ws:
            raise AppError("NOT_FOUND", "Publish job not found", retryable=False)
        render = db.get(Render, row.render_id)
        if render is None or not render.output_key:
            raise AppError("NOT_FOUND", "The render file is gone", retryable=False)
        path = get_storage().path_for(render.output_key)
        if not path.exists():
            raise AppError("NOT_FOUND", "The render file is gone", retryable=False)
        try:
            token = youtube_service.access_token(db, ws)
        except AppError as exc:
            row.status, row.error = "failed", exc.message
            db.commit()
            raise
        status: dict[str, Any] = {"privacyStatus": row.visibility, "selfDeclaredMadeForKids": False}
        if row.scheduled_at:
            status = {**status, "privacyStatus": "private", "publishAt": row.scheduled_at}
        metadata = {
            "snippet": {
                "title": row.title,
                "description": row.description,
                "tags": row.tags or [],
                "categoryId": "22",
            },
            "status": status,
        }
        aspect = get_preset(render.preset).aspect
        duration = render.duration_sec
        item_id, title, scheduled = row.content_item_id, row.title, row.scheduled_at
        row.status, row.error = "uploading", None
        db.commit()

    def progress(sent: int, total: int) -> None:
        ctx.progress(5 + 90 * sent / max(total, 1), "uploading")

    try:
        video = yt.upload(token, path, metadata, on_progress=progress)
    except Exception as exc:
        with ctx.session_factory() as db:
            row = db.get(PublishJob, publish_id)
            if row is not None:
                row.status = "failed"
                row.error = exc.message if isinstance(exc, AppError) else str(exc)[:400]
                db.commit()
        raise
    video_id = str(video["id"])
    ctx.progress(97, "saving")
    with ctx.session_factory() as db:
        row = db.get(PublishJob, publish_id)
        assert row is not None
        row.youtube_video_id = video_id
        row.status = "scheduled" if scheduled else "published"
        row.published_at = scheduled or utcnow()
        exists = db.scalar(
            select(YtVideo).where(YtVideo.workspace_id == ws, YtVideo.youtube_video_id == video_id)
        )
        if exists is None:
            db.add(
                YtVideo(
                    workspace_id=ws, youtube_video_id=video_id, content_item_id=item_id,
                    title=title, published_at=row.published_at,
                    duration_sec=int(duration) if duration else None,
                    format="short" if aspect == "9:16" else "long", is_seed=False,
                )
            )  # fmt: skip
        item = db.get(ContentItem, item_id)
        if item is not None and not scheduled:
            item.stage = "published"
            item.published_at = item.published_at or utcnow()
        elif item is not None and scheduled:
            item.scheduled_for = scheduled[:10]
        log_activity(
            db, ws, "video_scheduled" if scheduled else "video_published", "content_item",
            item_id, youtube_video_id=video_id, publish_id=publish_id,
        )  # fmt: skip
        db.commit()
    ctx.progress(100, "done")
    return {"youtube_video_id": video_id, "url": f"https://youtu.be/{video_id}"}
