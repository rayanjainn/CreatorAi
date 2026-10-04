"""LumiClip cloud clipper: start from a URL or a library video, follow it, import clips.

Our own local clipper (``clip_service``) stays the default. This is the optional cloud path for
links (YouTube and friends) and for people without the compute to analyse long footage locally.
"""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import socket
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import AppError, not_found
from app.integrations import cloudinary as cloud
from app.integrations import lumiclip as lumi
from app.media.kinds import safe_filename
from app.models import Asset, LumiclipProject
from app.models.base import new_id
from app.schemas.common import Provenance
from app.security import sign_media
from app.services import assets as asset_service
from app.services.activity import log_activity
from app.storage.local import get_storage

log = logging.getLogger(__name__)
MAX_CLIP_BYTES = 4 * 1024**3
PROVENANCE = Provenance(source="ai", provider="lumiclip", model=None)


def _require_project(db: Session, workspace_id: str, project_id: str) -> LumiclipProject:
    row = db.execute(
        select(LumiclipProject).where(
            LumiclipProject.workspace_id == workspace_id, LumiclipProject.id == project_id
        )
    ).scalar_one_or_none()
    if row is None:
        raise not_found("LumiClip project")
    return row


def list_projects(
    db: Session, workspace_id: str, *, content_item_id: str | None = None, limit: int = 30
) -> list[LumiclipProject]:
    stmt = select(LumiclipProject).where(LumiclipProject.workspace_id == workspace_id)
    if content_item_id:
        stmt = stmt.where(LumiclipProject.content_item_id == content_item_id)
    stmt = stmt.order_by(LumiclipProject.created_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars())


def project_out(row: LumiclipProject) -> dict[str, Any]:
    imported = row.imported or {}
    clips = [{**c, "imported_asset_id": imported.get(c.get("id", ""))} for c in (row.clips or [])]
    return {
        "id": row.id,
        "remote_id": row.remote_id,
        "source_url": row.source_url,
        "source_asset_id": row.source_asset_id,
        "content_item_id": row.content_item_id,
        "aspect_ratio": row.aspect_ratio,
        "options": row.options or {},
        "status": row.status,
        "step": row.step,
        "message": row.message,
        "error": row.error,
        "error_category": row.error_category,
        "expected_clips": row.expected_clips,
        "source_duration_sec": row.source_duration_sec,
        "clips": clips,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "provenance": PROVENANCE,
    }


def _apply(row: LumiclipProject, remote: lumi.RemoteProject) -> None:
    row.status = remote.status
    row.step = remote.step or row.step
    row.message = remote.message
    row.error = remote.error
    row.error_category = remote.error_category
    row.expected_clips = remote.expected_clips or row.expected_clips
    row.source_duration_sec = remote.duration or row.source_duration_sec
    if remote.clips or remote.status == "completed":
        row.clips = [c.as_dict() for c in remote.clips]


def start_project(
    db: Session,
    workspace_id: str,
    *,
    url: str | None,
    asset_id: str | None,
    content_item_id: str | None,
    aspect_ratio: str,
    start_time: float | None,
    end_time: float | None,
    language: str | None,
    subtitle_style: str | None,
) -> LumiclipProject:
    settings = get_settings()
    if not settings.lumiclip_configured:
        raise AppError(
            "LUMICLIP_NOT_CONFIGURED",
            "LumiClip is not set up. Add LUMICLIP_API_KEY to .env and restart the API.",
            status=503,
        )
    asset_service.require_content_item(db, workspace_id, content_item_id)
    source_url = url or ""
    source_asset: Asset | None = None
    if asset_id:
        source_asset = db.get(Asset, asset_id)
        if source_asset is None or source_asset.workspace_id != workspace_id:
            raise not_found("Asset")
        if source_asset.kind != "video" or source_asset.status != "ready":
            raise AppError(
                "ASSET_NOT_READY",
                "Pick a video from your library that has finished processing.",
                details={"asset_id": asset_id},
            )
        path = get_storage().path_for(source_asset.storage_key)
        uploaded = cloud.get_cloudinary_client().upload_video(
            path, folder=f"creatorai/{workspace_id}"
        )
        source_url = str(uploaded.get("secure_url") or uploaded.get("url") or "")
        if not source_url:
            raise AppError("CLOUDINARY_FAILED", "Cloudinary did not return a URL.", status=502)
    remote = lumi.get_lumiclip_client().generate(
        source_url,
        aspect_ratio=aspect_ratio,
        start_time=start_time,
        end_time=end_time,
        language=language,
        subtitle_style=subtitle_style,
    )
    row = LumiclipProject(
        id=new_id(),
        workspace_id=workspace_id,
        content_item_id=content_item_id or (source_asset.content_item_id if source_asset else None),
        source_url=source_url,
        source_asset_id=asset_id,
        remote_id=remote.id,
        aspect_ratio=aspect_ratio,
        options={
            k: v
            for k, v in {
                "start_time": start_time,
                "end_time": end_time,
                "language": language,
                "subtitle_style": subtitle_style,
            }.items()
            if v not in (None, "")
        },
    )
    _apply(row, remote)
    db.add(row)
    db.flush()
    log_activity(
        db, workspace_id, "lumiclip_started", "lumiclip_project", row.id, source=source_url
    )
    return row


def refresh_project(db: Session, workspace_id: str, project_id: str) -> LumiclipProject:
    """Ask LumiClip for fresh progress while the project runs (finished ones are final)."""
    row = _require_project(db, workspace_id, project_id)
    if row.status in lumi.DONE_STATUSES | {"failed"}:
        return row
    _apply(row, lumi.get_lumiclip_client().get_project(row.remote_id))
    db.flush()
    return row


def delete_project(db: Session, workspace_id: str, project_id: str) -> None:
    db.delete(_require_project(db, workspace_id, project_id))
    db.flush()


def export_clip(
    db: Session, workspace_id: str, project_id: str, clip_id: str, quality: str
) -> dict[str, Any]:
    row = _require_project(db, workspace_id, project_id)
    _find_clip(row, clip_id)
    return lumi.get_lumiclip_client().export_clip(clip_id, quality)


def _find_clip(row: LumiclipProject, clip_id: str) -> dict[str, Any]:
    for c in row.clips or []:
        if c.get("id") == clip_id:
            return c
    raise not_found("Clip")


def _check_public_host(url: str) -> None:
    """Only http(s) URLs to public hosts are fetched (no loopback, LAN or link-local targets)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise AppError("VALIDATION_ERROR", "The clip link is not a web URL.")
    if get_settings().lumiclip_allow_private_downloads:  # local fake in tests only
        return
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except OSError as exc:
        raise AppError("LUMICLIP_FAILED", "The clip link does not resolve.", status=502) from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise AppError("VALIDATION_ERROR", "Refusing to download from a private address.")


def _download(url: str, dest: Path, http: httpx.Client | None = None) -> tuple[str, int]:
    """Stream ``url`` to ``dest``; returns ``(sha256, size)``."""
    _check_public_host(url)
    client = http or httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0), follow_redirects=True)
    digest, size = hashlib.sha256(), 0
    try:
        with client.stream("GET", url) as res, dest.open("wb") as out:
            if res.status_code >= 400:
                raise AppError(
                    "LUMICLIP_FAILED",
                    f"The clip could not be downloaded ({res.status_code}). "
                    "It may have expired: reopen the project.",
                    status=502,
                )
            for block in res.iter_bytes(1024 * 1024):
                size += len(block)
                if size > MAX_CLIP_BYTES:
                    raise AppError(
                        "UPLOAD_TOO_LARGE", "The clip is larger than the upload limit.", status=413
                    )
                digest.update(block)
                out.write(block)
    except httpx.HTTPError as exc:
        dest.unlink(missing_ok=True)
        raise AppError(
            "LUMICLIP_UNREACHABLE",
            f"Could not download the clip ({exc.__class__.__name__}).",
            status=502,
        ) from exc
    except AppError:
        dest.unlink(missing_ok=True)
        raise
    return digest.hexdigest(), size


def import_clip(
    db: Session,
    workspace_id: str,
    project_id: str,
    clip_id: str,
    *,
    mode: str = "light",
    content_item_id: str | None = None,
    http: httpx.Client | None = None,
) -> tuple[LumiclipProject, Asset, bool, str | None]:
    """Download a finished clip into the library (``(project, asset, duplicate, job_id)``)."""
    row = _require_project(db, workspace_id, project_id)
    clip = _find_clip(row, clip_id)
    if clip.get("status") not in ("completed", "complete", "done") or not clip.get("download_url"):
        raise AppError("ASSET_NOT_READY", "This clip is not ready to download yet.", status=409)
    tmp_dir = get_settings().tmp_dir / "uploads" / workspace_id
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp = tmp_dir / f"{new_id()}.bin"
    digest, size = _download(str(clip["download_url"]), tmp, http)
    target_item = content_item_id or row.content_item_id
    asset, duplicate = asset_service.register_file(
        db,
        workspace_id,
        tmp_path=tmp,
        filename=safe_filename(f"{clip.get('title') or 'clip'} (lumiclip).mp4"),
        mime="video/mp4",
        sha256=digest,
        size_bytes=size,
        content_item_id=target_item,
    )
    job_id = None
    if not duplicate:
        if mode == "light":
            asset.analysis = {**(asset.analysis or {}), "mode": "light"}
            db.flush()
        job_id = asset_service.start_processing(db, workspace_id, asset)
    row.imported = {**(row.imported or {}), clip_id: asset.id}
    db.flush()
    log_activity(db, workspace_id, "lumiclip_clip_imported", "asset", asset.id, clip_id=clip_id)
    return row, asset, duplicate, job_id


def download_yt_video(
    db: Session,
    workspace_id: str,
    url: str,
    content_item_id: str | None = None,
) -> dict[str, Any]:
    """Download a video using yt-dlp, register it into workspace assets, and return direct download URL."""
    import yt_dlp

    url_str = url.strip()
    if not url_str.lower().startswith(("http://", "https://")):
        raise AppError("VALIDATION_ERROR", "The video link must start with http:// or https://")

    tmp_dir = get_settings().tmp_dir / "ytdlp" / workspace_id
    tmp_dir.mkdir(parents=True, exist_ok=True)
    temp_id = new_id()
    out_template = str(tmp_dir / f"{temp_id}.%(ext)s")

    ydl_opts = {
        "format": "b/best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best",
        "outtmpl": out_template,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "merge_output_format": "mp4",
        "nocheckcertificate": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url_str, download=True)
            if info is None:
                raise AppError("YTDLP_FAILED", "Could not extract video info from the URL.", status=400)

            downloaded_file: Path | None = None
            if info.get("requested_downloads") and len(info["requested_downloads"]) > 0:
                fp = info["requested_downloads"][0].get("filepath")
                if fp and Path(fp).exists():
                    downloaded_file = Path(fp)

            if not downloaded_file:
                fn = ydl.prepare_filename(info)
                base_path = Path(out_template.replace("%(ext)s", ""))
                if Path(fn).exists():
                    downloaded_file = Path(fn)
                else:
                    mp4_file = Path(str(base_path) + ".mp4")
                    if mp4_file.exists():
                        downloaded_file = mp4_file
                    else:
                        matches = [p for p in tmp_dir.glob(f"{temp_id}.*") if not p.name.endswith(".part")]
                        if matches:
                            downloaded_file = matches[0]

            if not downloaded_file or not downloaded_file.exists():
                raise AppError("YTDLP_FAILED", "Failed to locate downloaded video file.", status=500)

            raw_title = info.get("title") or "YouTube Video"
            safe_name = safe_filename(f"{raw_title}.mp4")

            digest = hashlib.sha256()
            size = 0
            with downloaded_file.open("rb") as f:
                while chunk := f.read(1024 * 1024):
                    size += len(chunk)
                    digest.update(chunk)

            asset, duplicate = asset_service.register_file(
                db,
                workspace_id,
                tmp_path=downloaded_file,
                filename=safe_name,
                mime="video/mp4",
                sha256=digest.hexdigest(),
                size_bytes=size,
                content_item_id=content_item_id,
            )

            job_id = None
            if not duplicate:
                job_id = asset_service.start_processing(db, workspace_id, asset)

            log_activity(db, workspace_id, "ytdlp_download", "asset", asset.id, url=url_str)

            download_url = sign_media(asset.storage_key, download_name=asset.filename)
            stream_url = sign_media(asset.storage_key)
            thumbnail_url = sign_media(asset.thumb_key) if asset.thumb_key else None

            return {
                "asset_id": asset.id,
                "filename": asset.filename,
                "title": raw_title,
                "duration_sec": asset.duration_sec or info.get("duration"),
                "size_bytes": asset.size_bytes,
                "download_url": download_url,
                "stream_url": stream_url,
                "thumbnail_url": thumbnail_url,
                "duplicate": duplicate,
                "job_id": job_id,
            }
    except Exception as exc:
        if isinstance(exc, AppError):
            raise exc
        log.warning(f"yt-dlp download failed for {url_str}: {exc}")
        raise AppError(
            "YTDLP_DOWNLOAD_FAILED",
            f"Could not download video with yt-dlp: {str(exc)}",
            status=502,
        ) from exc

