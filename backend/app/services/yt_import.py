"""YouTube import: find videos on a topic (web search), download one with yt-dlp, then run it
through the same pipeline as an upload (probe, proxy, transcribe, index, embed) and, when asked,
Smart Clips, so short 9:16 clips are waiting at the end.

Flow::

    POST /yt-import -> probe (title, length) -> project (content item) -> job ``youtube.import``
    youtube.import  -> download (+ captions when no ASR is configured) -> asset -> asset.process
    asset ready     -> hook: clips.generate on that asset (``options.auto_clips``)
    GET             -> status from the jobs: queued, downloading, processing, clipping, done

Transcripts come from the normal ASR chain (Groq Whisper, local faster-whisper). Only when neither
is available is the video's YouTube caption track used, and it is labelled as such (provider
``youtube``; auto-captions are ``ai``, uploader subtitles ``user``). Nothing is invented.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import session_scope
from app.errors import AppError, not_found
from app.integrations import websearch, ytdlp
from app.media.kinds import safe_filename
from app.ml.asr import get_asr_chain
from app.models import Asset, Clip, ContentItem, Job, YtImport
from app.security import sign_media
from app.services import assets as asset_service
from app.services import clip_service, content_service
from app.services.activity import log_activity
from app.services.hooks import register_after_asset_ready
from app.workers.runner import JOB_HANDLERS, JobContext

log = logging.getLogger(__name__)
JOB_TYPE = "youtube.import"
ACTIVE = ("queued", "downloading", "processing", "clipping")
# Share of the overall progress bar for each phase.
PHASES = {"download": (0, 30), "process": (30, 80), "clips": (80, 100)}
NOT_RETRYABLE = {"YT_UNAVAILABLE", "YT_LOGIN_REQUIRED", "YT_TOO_LONG", "VALIDATION_ERROR"}


def status() -> dict[str, Any]:
    s = get_settings()
    return {
        "available": ytdlp.available(),
        "search_configured": s.search_configured,
        "search_provider": s.search_provider,
        "asr_available": bool(get_asr_chain()),
        "max_duration_sec": s.yt_import_max_sec,
        "max_height": s.yt_import_max_height,
    }


def _require_ytdlp() -> None:
    if not ytdlp.available():
        raise AppError(
            "YT_IMPORT_UNAVAILABLE",
            "yt-dlp is not installed in the backend environment. Run `make setup` (or "
            "`pip install yt-dlp`) and restart the API.",
            status=503,
        )


def search(query: str, limit: int = 10) -> dict[str, Any]:
    results = websearch.get_video_search()(query.strip(), limit)
    return {"query": query.strip(), "provider": get_settings().search_provider, "results": results}


# ── reading ────────────────────────────────────────────────────────────────────────────────────


def _require(db: Session, workspace_id: str, import_id: str) -> YtImport:
    row = db.get(YtImport, import_id)
    if row is None or row.workspace_id != workspace_id:
        raise not_found("Import")
    return row


def _job(db: Session, job_id: str | None) -> Job | None:
    return db.get(Job, job_id) if job_id else None


def _latest_process_job(db: Session, asset_id: str) -> Job | None:
    return db.scalar(
        select(Job)
        .where(Job.type == "asset.process", Job.entity_id == asset_id)
        .order_by(Job.created_at.desc())
        .limit(1)
    )


def _fail(row: YtImport, code: str, message: str) -> None:
    row.status, row.error_code, row.error = "failed", code, message


def advance(db: Session, row: YtImport) -> YtImport:
    """Move ``row.status`` forward from what its jobs and asset say (idempotent, cheap)."""
    if row.status in ("queued", "downloading"):
        job = _job(db, row.job_id)
        if job is not None and job.status in ("failed", "canceled") and row.status != "failed":
            _fail(row, row.error_code or "YT_DOWNLOAD_FAILED", row.error or job.error or "Failed")
    if row.status == "processing" and row.asset_id:
        asset = db.get(Asset, row.asset_id)
        if asset is None:
            _fail(row, "NOT_FOUND", "The imported video was deleted from the library.")
        elif asset.status == "failed":
            _fail(row, (asset.analysis or {}).get("error_code") or "MEDIA_FAILED",
                  asset.error or "Processing failed")  # fmt: skip
    elif row.status == "processing" and row.asset_id is None:
        _fail(row, "NOT_FOUND", "The imported video was deleted from the library.")
    if row.status == "clipping":
        job = _job(db, row.clips_job_id)
        if job is None or job.status == "succeeded":
            row.status = "done"
        elif job.status in ("failed", "canceled"):
            _fail(row, "CLIPS_FAILED", job.error or "Clip generation failed")
    db.flush()
    return row


def _progress(db: Session, row: YtImport) -> tuple[int, str]:
    """Overall percent and a short stage label for the progress bar."""
    if row.status == "done":
        return 100, "done"
    if row.status in ("queued", "downloading"):
        job = _job(db, row.job_id)
        lo, hi = PHASES["download"]
        pct = job.progress if job else 0
        return int(lo + (hi - lo) * pct / 100), (job.stage if job and job.stage else "queued")
    if row.status == "processing" and row.asset_id:
        job = _latest_process_job(db, row.asset_id)
        lo, hi = PHASES["process"]
        pct = job.progress if job else 0
        return int(lo + (hi - lo) * pct / 100), (job.stage if job and job.stage else "analysis")
    if row.status == "clipping":
        job = _job(db, row.clips_job_id)
        lo, hi = PHASES["clips"]
        pct = job.progress if job else 0
        return int(lo + (hi - lo) * pct / 100), (job.stage if job and job.stage else "clips")
    return 0, row.status


def out(db: Session, row: YtImport) -> dict[str, Any]:
    pct, stage = _progress(db, row)
    asset = db.get(Asset, row.asset_id) if row.asset_id else None
    clips = 0
    if row.content_item_id and row.asset_id:
        clips = int(
            db.scalar(
                select(func.count(Clip.id)).where(
                    Clip.content_item_id == row.content_item_id,
                    Clip.source_asset_id == row.asset_id,
                    Clip.kind == "short",
                )
            )
            or 0
        )
    return {
        "id": row.id,
        "url": row.url,
        "video_id": row.video_id,
        "title": row.title,
        "channel": row.channel,
        "duration_sec": row.duration_sec,
        "topic": row.topic,
        "options": row.options or {},
        "status": row.status,
        "progress": pct,
        "stage": stage,
        "error": row.error,
        "error_code": row.error_code,
        "content_item_id": row.content_item_id,
        "asset_id": row.asset_id,
        "asset_status": asset.status if asset else None,
        "thumbnail_url": sign_media(asset.thumb_key) if asset and asset.thumb_key else None,
        "transcript_source": row.transcript_source,
        "clips_count": clips,
        "job_id": row.job_id,
        "clips_job_id": row.clips_job_id,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def get(db: Session, workspace_id: str, import_id: str) -> dict[str, Any]:
    return out(db, advance(db, _require(db, workspace_id, import_id)))


def list_imports(
    db: Session, workspace_id: str, *, content_item_id: str | None = None, limit: int = 30
) -> list[dict[str, Any]]:
    stmt = select(YtImport).where(YtImport.workspace_id == workspace_id)
    if content_item_id:
        stmt = stmt.where(YtImport.content_item_id == content_item_id)
    rows = list(db.scalars(stmt.order_by(YtImport.created_at.desc()).limit(limit)))
    return [out(db, advance(db, r) if r.status in ACTIVE else r) for r in rows]


def delete(db: Session, workspace_id: str, import_id: str) -> None:
    """Forget the import (the project, video and clips it made stay)."""
    row = _require(db, workspace_id, import_id)
    if row.status in ("queued", "downloading"):
        raise AppError("CONFLICT", "Cancel the download first (Jobs page) or wait for it.")
    db.delete(row)
    db.flush()


# ── starting ───────────────────────────────────────────────────────────────────────────────────


def start(
    db: Session,
    workspace_id: str,
    *,
    url: str,
    topic: str | None,
    content_item_id: str | None,
    auto_clips: bool,
    clip_count: int,
) -> dict[str, Any]:
    _require_ytdlp()
    if JOB_TYPE not in JOB_HANDLERS:
        raise AppError("INTERNAL_ERROR", "YouTube import is not available in this build")
    info = ytdlp.probe(url)  # network, a few seconds; validates the link and the length first
    if content_item_id:
        asset_service.require_content_item(db, workspace_id, content_item_id)
    else:
        item = content_service.create_item(
            db,
            workspace_id,
            {
                "title": info.title[:200],
                "idea_text": f"Imported from YouTube: {info.url}"
                + (f" (topic: {topic.strip()})" if topic and topic.strip() else ""),
                "stage": "edit",
            },
        )
        content_item_id = item.id
    row = YtImport(
        workspace_id=workspace_id,
        content_item_id=content_item_id,
        url=info.url,
        video_id=info.video_id,
        topic=(topic or "").strip() or None,
        title=info.title,
        channel=info.channel,
        duration_sec=info.duration_sec,
        options={"auto_clips": auto_clips, "clip_count": clip_count, "language": info.language},
    )
    db.add(row)
    db.flush()
    log_activity(db, workspace_id, "yt_import_started", "yt_import", row.id,
                 url=info.url, title=info.title, content_item_id=content_item_id)  # fmt: skip
    db.commit()  # the job runs on its own session (inline in tests) and must see the row
    from app.workers.runner import enqueue

    enqueue(JOB_TYPE, "yt_import", row.id, {"import_id": row.id}, workspace_id=workspace_id)
    db.expire_all()
    return get(db, workspace_id, row.id)


# ── the job ────────────────────────────────────────────────────────────────────────────────────


def run_import(ctx: JobContext) -> dict[str, Any]:
    import_id = str(ctx.payload["import_id"])
    ws = ctx.workspace_id
    with session_scope() as db:
        row = _require(db, ws, import_id)
        url, title, opts = row.url, row.title, dict(row.options or {})
        row.status, row.job_id, row.error, row.error_code = "downloading", ctx.job_id, None, None
    settings = get_settings()
    work = settings.tmp_dir / "yt" / import_id
    want_captions = not get_asr_chain()
    try:
        ctx.progress(2, "download", "starting yt-dlp")

        def on_progress(frac: float, message: str) -> None:
            ctx.progress(2 + 93 * frac, "download", message)

        got = ytdlp.download(
            url, work, want_captions=want_captions, language=opts.get("language"),
            on_progress=on_progress,
        )  # fmt: skip
        ctx.progress(96, "library", "adding to the library")
        digest, size = hashlib.sha256(), 0
        with got.path.open("rb") as fh:
            while block := fh.read(1024 * 1024):
                digest.update(block)
                size += len(block)
        tmp = settings.tmp_dir / "uploads" / ws / f"{import_id}.mp4"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(got.path), tmp)
        sidecar = None
        source = None
        if got.captions:
            sidecar = (json.dumps(got.captions), "youtube.words.json")
            source = "youtube_auto" if got.caption_kind == "auto" else "youtube_subs"
        with session_scope() as db:
            row = _require(db, ws, import_id)
            asset, duplicate = asset_service.register_file(
                db,
                ws,
                tmp_path=tmp,
                filename=safe_filename(f"{title[:120]} (youtube).mp4"),
                mime="video/mp4",
                sha256=digest.hexdigest(),
                size_bytes=size,
                content_item_id=row.content_item_id,
                sidecar=sidecar,
                sidecar_source=source,
            )
            if asset.content_item_id is None:
                asset.content_item_id = row.content_item_id
            row.asset_id = asset.id
            row.status = "processing"
            row.transcript_source = (
                "youtube_captions" if sidecar else ("asr" if not want_captions else None)
            )
            ready = duplicate and asset.status == "ready"
            processing = duplicate and asset.status == "processing"
            job_id = None
            if not ready and not processing:
                job_id = asset_service.start_processing(db, ws, asset)
            asset_id = asset.id
        if ready:  # the same video was imported before and is analysed already
            on_asset_ready(ws, asset_id)
        ctx.progress(100, "library", "queued for analysis")
        return {"asset_id": asset_id, "duplicate": duplicate, "process_job_id": job_id,
                "captions": source}  # fmt: skip
    except AppError as exc:
        if exc.code in NOT_RETRYABLE:
            exc.retryable = False  # type: ignore[attr-defined]
        _record_failure(ws, import_id, exc.code, exc.message)
        raise
    except Exception as exc:
        if exc.__class__.__name__ == "JobCanceled":
            _record_failure(ws, import_id, "CANCELED", "Canceled")
        else:
            _record_failure(ws, import_id, "YT_DOWNLOAD_FAILED", str(exc)[:300])
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _record_failure(workspace_id: str, import_id: str, code: str, message: str) -> None:
    with session_scope() as db:
        db.execute(
            update(YtImport)
            .where(YtImport.id == import_id, YtImport.workspace_id == workspace_id)
            .values(status="failed", error_code=code, error=message)
        )


# ── after the asset is ready: Smart Clips ──────────────────────────────────────────────────────


def on_asset_ready(workspace_id: str, asset_id: str) -> None:
    """Hook: an imported video finished analysis. Start Smart Clips on it (or mark it done)."""
    with session_scope() as db:
        rows = list(
            db.scalars(
                select(YtImport).where(
                    YtImport.workspace_id == workspace_id,
                    YtImport.asset_id == asset_id,
                    YtImport.status == "processing",
                )
            )
        )
        todo = []
        for row in rows:
            opts = row.options or {}
            if opts.get("auto_clips") and row.content_item_id:
                row.status = "clipping"
                todo.append((row.id, row.content_item_id, int(opts.get("clip_count") or 4)))
            else:
                row.status = "done"
    for import_id, item_id, count in todo:
        try:
            with session_scope() as db:
                if db.get(ContentItem, item_id) is None:
                    raise not_found("Project")
                res = clip_service.start_generate(
                    db, workspace_id, item_id, {"asset_id": asset_id, "count": count}
                )
                db.execute(
                    update(YtImport)
                    .where(YtImport.id == import_id)
                    .values(clips_job_id=res["job_id"])
                )
        except AppError as exc:
            log.warning("auto clips for import %s did not start: %s", import_id, exc)
            _record_failure(workspace_id, import_id, exc.code, exc.message)


register_after_asset_ready(on_asset_ready)
