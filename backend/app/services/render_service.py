"""Rendering a clip's timeline to an mp4 (Plan.md sections 3.3 ``render.run`` and 8.9).

``render.run`` stages: build graph 10 -> ffmpeg 95 (``-progress pipe:1`` parsed into 10..95) ->
thumbnail 100. The render reads the ORIGINAL asset files (never proxies) and the exact timeline
revision recorded on the ``renders`` row (``edit_revision``), so later edits never change a render
in flight. Output: ``renders/{id}.mp4`` and ``renders/{id}.jpg`` through the StorageBackend.

Request semantics: the timeline is copied, aspect/size come from the preset, the caption style is
the requested one (default: the preset's). Captions are rebuilt for the new style's line length
only when every caption is still AI-made, none was rejected and none has a style override;
otherwise the stored captions are kept as they are.
"""

from __future__ import annotations

import contextlib
import logging
import re
import shutil
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import session_scope
from app.errors import AppError, not_found
from app.media import render_graph
from app.media.captions_ass import build_ass
from app.media.captions_png import write_track
from app.media.cards import render_card
from app.media.ffmpeg import FFmpegCanceled, FFmpegError, probe, run
from app.media.fonts import stage_fonts
from app.media.presets import Preset, check_duration, get_preset
from app.models import (
    Asset,
    Clip,
    ContentItem,
    Edit,
    EditRevision,
    PublishJob,
    Render,
    utcnow,
)
from app.repositories.clips import ClipRepository, EditRepository
from app.schemas.timeline import Timeline
from app.security import sign_media
from app.services import edit_service
from app.services import timeline_service as ts
from app.services.activity import log_activity
from app.storage.local import get_storage
from app.workers.runner import JOB_HANDLERS, JobCanceled, JobContext, enqueue

log = logging.getLogger(__name__)

JOB_TYPE = "render.run"
ACTIVE = ("queued", "rendering")
FFMPEG_TIMEOUT_SEC = 3600.0


# ── request ───────────────────────────────────────────────────────────────────────────────────
def retarget_timeline(
    timeline: Timeline, preset: Preset, style: str, words_provider: ts.WordsProvider | None = None
) -> Timeline:
    """Copy of ``timeline`` sized for ``preset`` with ``style`` applied (items keep overrides)."""
    out = timeline.model_copy(deep=True)
    old_style = out.caption_style
    out.aspect, out.width, out.height = preset.aspect, preset.width, preset.height  # type: ignore[assignment]
    out.caption_style = style  # type: ignore[assignment]
    caps = out.tracks.captions
    regroup = ts.LINE_WORDS[style] != ts.LINE_WORDS[old_style]
    pristine = all(
        c.source == "ai" and c.status != "rejected" and not c.style_override for c in caps
    )
    if regroup and caps and pristine and words_provider is not None:
        out = ts.rebuild_captions(out, words_provider)
    return out


def _active_assets(timeline: Timeline) -> list[str]:
    ids: list[str] = []
    for v in timeline.tracks.video:
        if v.status != "rejected" and v.asset_id and v.asset_id not in ids:
            ids.append(v.asset_id)
    for a in timeline.tracks.audio:
        if a.status != "rejected" and a.asset_id not in ids:
            ids.append(a.asset_id)
    return ids


def _load_assets(db: Session, workspace_id: str, timeline: Timeline) -> dict[str, Asset]:
    """The assets the render needs, each ``ready`` with its original file on disk."""
    found = edit_service._assets(db, workspace_id, _active_assets(timeline))
    storage = get_storage()
    for asset_id in _active_assets(timeline):
        asset = found.get(asset_id)
        if asset is None:
            raise AppError(
                "ASSET_NOT_READY",
                "A source file of this clip was deleted",
                details={"asset_id": asset_id},
            )
        if asset.status != "ready" or not storage.exists(asset.storage_key):
            raise AppError(
                "ASSET_NOT_READY",
                f"{asset.filename} is not ready to render yet",
                details={"asset_id": asset_id, "status": asset.status},
            )
    return found


def start_render(
    db: Session, workspace_id: str, clip_id: str, preset_name: str, caption_style: str | None
) -> tuple[Render, str]:
    """Validate and enqueue a render (``422 DURATION_EXCEEDS_PRESET``, ``409 ASSET_NOT_READY``)."""
    preset = get_preset(preset_name)
    clip = ClipRepository(db).require(workspace_id, clip_id)
    edit = EditRepository(db).for_clip(workspace_id, clip_id)
    if edit is None:
        raise not_found("Edit")
    timeline = ts.parse_timeline(edit.timeline)
    duration = sum(v.src_out - v.src_in for v in ts.active(timeline.tracks.video))
    if duration <= 0:
        raise AppError("VALIDATION_ERROR", "This clip has no video to render")
    check_duration(preset, duration)
    _load_assets(db, workspace_id, timeline)
    if JOB_TYPE not in JOB_HANDLERS:
        raise AppError("INTERNAL_ERROR", "Rendering is not available in this build")
    render = Render(
        workspace_id=workspace_id,
        clip_id=clip.id,
        preset=preset.name,
        caption_style=caption_style or preset.caption_style,
        edit_revision=edit.revision,
        status="queued",
    )
    db.add(render)
    db.flush()
    render_id = render.id
    db.commit()
    job_id = enqueue(
        JOB_TYPE, "render", render_id, {"render_id": render_id}, workspace_id=workspace_id
    )
    db.expire_all()
    render = db.get(Render, render_id)  # type: ignore[assignment]
    assert render is not None
    if render.job_id is None:
        render.job_id = job_id
    return render, job_id


# ── job ───────────────────────────────────────────────────────────────────────────────────────
def _fail(render_id: str, message: str) -> None:
    with session_scope() as db:
        row = db.get(Render, render_id)
        if row is not None and row.status != "done":
            row.status, row.error, row.finished_at = "failed", message[:500], utcnow()


def _nice_error(exc: FFmpegError) -> str:
    lines = [ln.strip() for ln in (exc.stderr or "").splitlines() if ln.strip()]
    errors = [ln for ln in lines if re.search(r"error|invalid|no such|failed", ln, re.I)]
    tail = (errors or lines or [str(exc)])[-1]
    return f"ffmpeg failed: {tail[:300]}"


def run_render(ctx: JobContext) -> dict[str, Any]:
    render_id = str(ctx.payload.get("render_id") or ctx.entity_id)
    workdir = get_settings().tmp_dir / "renders" / render_id
    try:
        return _run(ctx, render_id, workdir)
    except JobCanceled:
        _fail(render_id, "Canceled")
        raise
    except FFmpegCanceled:
        _fail(render_id, "Canceled")
        raise JobCanceled() from None
    except FFmpegError as exc:
        message = _nice_error(exc)
        _fail(render_id, message)
        raise AppError("MEDIA_FAILED", message, retryable=False) from exc
    except Exception as exc:
        _fail(render_id, getattr(exc, "message", None) or str(exc) or exc.__class__.__name__)
        raise
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _run(ctx: JobContext, render_id: str, workdir: Path) -> dict[str, Any]:
    settings = get_settings()
    ws = ctx.workspace_id
    ctx.progress(0, "build graph")
    with ctx.session_factory() as db:
        render = db.get(Render, render_id)
        if render is None or render.workspace_id != ws:
            raise AppError("NOT_FOUND", "Render not found", retryable=False)
        clip = db.get(Clip, render.clip_id)
        edit = db.execute(select(Edit).where(Edit.clip_id == render.clip_id)).scalar_one_or_none()
        if clip is None or edit is None:
            raise AppError("NOT_FOUND", "Clip not found", retryable=False)
        snapshot = db.execute(
            select(EditRevision).where(
                EditRevision.edit_id == edit.id, EditRevision.revision == render.edit_revision
            )
        ).scalar_one_or_none()
        timeline = ts.parse_timeline((snapshot or edit).timeline)
        preset = get_preset(render.preset)
        style = render.caption_style or preset.caption_style
        assets = _load_assets(db, ws, timeline)
        sources: dict[str, render_graph.AssetSource] = {}
        storage = get_storage()
        for asset_id, asset in assets.items():
            path = storage.path_for(asset.storage_key)
            info = probe(path)
            sources[asset_id] = render_graph.AssetSource(
                str(path), info.has_audio, info.width, info.height
            )
        clip_ids = {v.asset_id for v in timeline.tracks.video if v.asset_id}
        words = {a: edit_service._words(db, ws, a) for a in clip_ids}
        render.status, render.error = "rendering", None
        render.job_id = render.job_id or ctx.job_id
        db.commit()
        clip_title, item_id = clip.title, clip.content_item_id

    target = retarget_timeline(timeline, preset, style, lambda a: words.get(a, []))
    shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True)
    faces = stage_fonts(workdir / "fonts")
    plan = render_graph.build_plan(
        target, sources, x264_preset=settings.render_x264_preset, output="out.mp4"
    )
    for card in plan.cards:
        render_card(
            card.kind,
            card.text,
            target.width,
            target.height,
            workdir / card.filename,
            faces,
            card.style,
        )
    if plan.caption_track is not None:  # no libass: Pillow PNG states + concat lists
        write_track(plan.caption_track, target.width, target.height, faces, workdir)
    else:
        (workdir / "captions.ass").write_text(
            build_ass(target, faces, time_map=plan.time_map, duration=plan.duration),
            encoding="utf-8",
        )
    ctx.progress(10, "build graph")

    last = {"pct": 10}

    def on_progress(fraction: float) -> None:
        pct = 10 + int(85 * fraction)
        if pct > last["pct"]:
            last["pct"] = pct
            with contextlib.suppress(JobCanceled):  # the cancel poll below kills ffmpeg
                ctx.progress(pct, "ffmpeg")

    def canceled() -> bool:
        try:
            ctx.check_cancel()
        except JobCanceled:
            return True
        return False

    ctx.progress(10, "ffmpeg")
    run(
        plan.ffmpeg_args(),
        timeout=FFMPEG_TIMEOUT_SEC,
        duration=plan.duration,
        on_progress=on_progress,
        cwd=workdir,
        should_cancel=canceled,
    )
    ctx.progress(95, "thumbnail")
    out_file, thumb = workdir / "out.mp4", workdir / "thumb.jpg"
    at = min(1.0, plan.duration / 2)
    run(["-ss", f"{at:.2f}", "-i", out_file, "-frames:v", "1", "-q:v", "3", thumb], timeout=120)
    info = probe(out_file)
    storage = get_storage()
    out_key, thumb_key = f"renders/{render_id}.mp4", f"renders/{render_id}.jpg"
    size = storage.put_file(out_key, out_file)
    storage.put_file(thumb_key, thumb)
    with ctx.session_factory() as db:
        render = db.get(Render, render_id)
        assert render is not None
        render.status, render.error = "done", None
        render.output_key, render.thumb_key = out_key, thumb_key
        render.duration_sec, render.size_bytes, render.finished_at = (
            round(info.duration, 3),
            size,
            utcnow(),
        )
        log_activity(
            db, ws, "render_done", "render", render_id,
            clip_id=render.clip_id, content_item_id=item_id, preset=render.preset,
            caption_style=style, edit_revision=render.edit_revision,
            duration_sec=render.duration_sec, size_bytes=size, clip_title=clip_title,
        )  # fmt: skip
        db.commit()
    return {
        "render_id": render_id,
        "output_key": out_key,
        "duration_sec": round(info.duration, 3),
        "size_bytes": size,
    }


# ── reading ───────────────────────────────────────────────────────────────────────────────────
def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:50] or "clip"


def render_out(render: Render, clip: Clip, current_revision: int | None = None) -> dict[str, Any]:
    preset = get_preset(render.preset)
    done = render.status == "done" and render.output_key
    filename = f"{_slug(clip.title)}-{render.preset}.mp4"
    return {
        "id": render.id,
        "clip_id": render.clip_id,
        "clip_title": clip.title,
        "clip_kind": clip.kind,
        "content_item_id": clip.content_item_id,
        "preset": render.preset,
        "caption_style": render.caption_style,
        "edit_revision": render.edit_revision,
        "status": render.status,
        "job_id": render.job_id,
        "duration_sec": render.duration_sec,
        "size_bytes": render.size_bytes,
        "error": render.error,
        "publishable": preset.publishable,
        "created_at": render.created_at,
        "finished_at": render.finished_at,
        "preview_url": sign_media(render.output_key) if done and render.output_key else None,
        "download_url": (
            sign_media(render.output_key, download_name=filename)
            if done and render.output_key
            else None
        ),
        "thumbnail_url": sign_media(render.thumb_key) if done and render.thumb_key else None,
        "stale": current_revision is not None and render.edit_revision < current_revision,
    }


def _outs(db: Session, workspace_id: str, renders: list[Render]) -> list[dict[str, Any]]:
    clip_ids = {r.clip_id for r in renders}
    clips = {
        c.id: c
        for c in db.execute(
            select(Clip).where(Clip.workspace_id == workspace_id, Clip.id.in_(clip_ids))
        ).scalars()
    }
    revisions = EditRepository(db).by_clips(workspace_id, list(clip_ids))
    return [
        render_out(
            r, clips[r.clip_id], revisions[r.clip_id].revision if r.clip_id in revisions else None
        )
        for r in renders
        if r.clip_id in clips
    ]


def get_render(db: Session, workspace_id: str, render_id: str) -> dict[str, Any]:
    render = db.get(Render, render_id)
    if render is None or render.workspace_id != workspace_id:
        raise not_found("Render")
    return _outs(db, workspace_id, [render])[0]


def list_for_clip(db: Session, workspace_id: str, clip_id: str) -> list[dict[str, Any]]:
    ClipRepository(db).require(workspace_id, clip_id)
    rows = db.execute(
        select(Render)
        .where(Render.workspace_id == workspace_id, Render.clip_id == clip_id)
        .order_by(Render.created_at.desc(), Render.id)
    ).scalars()
    return _outs(db, workspace_id, list(rows))


def list_for_content(db: Session, workspace_id: str, item_id: str) -> list[dict[str, Any]]:
    """Every render of every clip of the item, newest first (the export section's list)."""
    item = db.get(ContentItem, item_id)
    if item is None or item.workspace_id != workspace_id:
        raise not_found("Content item")
    rows = db.execute(
        select(Render)
        .join(Clip, Clip.id == Render.clip_id)
        .where(Render.workspace_id == workspace_id, Clip.content_item_id == item_id)
        .order_by(Render.created_at.desc(), Render.id)
    ).scalars()
    return _outs(db, workspace_id, list(rows))


def list_all(
    db: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Renders of every clip, newest first (the cross-project Repurpose / export hub)."""
    stmt = select(Render).where(Render.workspace_id == workspace_id)
    if status:
        stmt = stmt.where(Render.status == status)
    rows = db.execute(
        stmt.order_by(Render.created_at.desc(), Render.id).limit(limit).offset(offset)
    ).scalars()
    return _outs(db, workspace_id, list(rows))


def delete_render(db: Session, workspace_id: str, render_id: str) -> None:
    render = db.get(Render, render_id)
    if render is None or render.workspace_id != workspace_id:
        raise not_found("Render")
    if render.status in ACTIVE:
        raise AppError(
            "CONFLICT", "This render is still running. Cancel its job first.",
            details={"job_id": render.job_id},
        )  # fmt: skip
    used = db.execute(
        select(PublishJob.id).where(PublishJob.render_id == render_id).limit(1)
    ).first()
    if used is not None:
        raise AppError("CONFLICT", "This render was used for a publish job and cannot be deleted")
    storage = get_storage()
    for key in (render.output_key, render.thumb_key):
        if key:
            storage.delete_prefix(key)
    db.delete(render)
