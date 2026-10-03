"""Resumable chunked uploads (Plan.md section 5 ``uploads``) and the one-shot upload path.

Chunks live in ``data/tmp/uploads/<workspace>/<upload>/NNNNNN.part``. The chunk files on disk are
the source of truth for what was received; ``uploads.received_chunks`` mirrors them for clients.
"""

from __future__ import annotations

import hashlib
import logging
import math
import shutil
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import BinaryIO

from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import AppError
from app.media.kinds import guess_mime, safe_filename
from app.models import Asset, Upload, new_id
from app.repositories.assets import AssetRepository, UploadRepository
from app.services import assets as asset_service

log = logging.getLogger(__name__)
READ_BLOCK = 1024 * 1024


# ── paths and guards ──────────────────────────────────────────────────────────────────────────
def upload_dir(workspace_id: str, upload_id: str) -> Path:
    return get_settings().tmp_dir / "uploads" / workspace_id / upload_id


def chunk_path(workspace_id: str, upload_id: str, index: int) -> Path:
    return upload_dir(workspace_id, upload_id) / f"{index:06d}.part"


def free_disk_bytes() -> int:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(settings.data_dir).free


def check_capacity(size_bytes: int) -> None:
    """Reject files over ``MAX_UPLOAD_BYTES`` and when the disk cannot hold them (2x + margin)."""
    settings = get_settings()
    if size_bytes > settings.max_upload_bytes:
        raise AppError(
            "UPLOAD_TOO_LARGE",
            f"File is {size_bytes} bytes; the limit is {settings.max_upload_bytes} bytes "
            "(raise MAX_UPLOAD_BYTES to allow larger files)",
            details={"max_bytes": settings.max_upload_bytes, "size_bytes": size_bytes},
        )
    needed = size_bytes * 2 + settings.min_free_disk_mb * 1024 * 1024
    free = free_disk_bytes()
    if free < needed:
        raise AppError(
            "INSUFFICIENT_STORAGE",
            f"Not enough free disk space: need about {needed // (1024 * 1024)} MB "
            f"(2x the file plus {settings.min_free_disk_mb} MB), {free // (1024 * 1024)} MB free",
            details={"needed_bytes": needed, "free_bytes": free},
        )


def expected_chunk_len(upload: Upload, index: int) -> int:
    if index < upload.total_chunks - 1:
        return upload.chunk_size
    return upload.size_bytes - upload.chunk_size * (upload.total_chunks - 1)


# ── lifecycle ─────────────────────────────────────────────────────────────────────────────────
def init_upload(
    db: Session,
    workspace_id: str,
    *,
    filename: str,
    mime: str,
    size_bytes: int,
    content_item_id: str | None,
) -> Upload:
    check_capacity(size_bytes)
    asset_service.require_content_item(db, workspace_id, content_item_id)
    name = safe_filename(filename)
    chunk_size = max(1, get_settings().upload_chunk_size)
    upload = Upload(
        id=new_id(),
        workspace_id=workspace_id,
        content_item_id=content_item_id,
        filename=name,
        mime=guess_mime(name, mime),
        size_bytes=size_bytes,
        chunk_size=chunk_size,
        total_chunks=max(1, math.ceil(size_bytes / chunk_size)),
        received_chunks=[],
    )
    db.add(upload)
    db.flush()
    upload_dir(workspace_id, upload.id).mkdir(parents=True, exist_ok=True)
    return upload


def received_on_disk(upload: Upload) -> list[int]:
    """Chunk indexes whose file exists with exactly the expected size (the truth for resume)."""
    directory = upload_dir(upload.workspace_id, upload.id)
    found: list[int] = []
    if directory.is_dir():
        for path in directory.glob("*.part"):
            try:
                index = int(path.stem)
            except ValueError:
                continue
            if 0 <= index < upload.total_chunks and path.stat().st_size == expected_chunk_len(
                upload, index
            ):
                found.append(index)
    return sorted(found)


def refresh_received(upload: Upload) -> Upload:
    upload.received_chunks = received_on_disk(upload)
    return upload


def require_open(db: Session, workspace_id: str, upload_id: str) -> Upload:
    upload = UploadRepository(db).require(workspace_id, upload_id)
    if upload.status != "uploading":
        raise AppError("UPLOAD_CLOSED", f"Upload is already {upload.status}")
    return upload


def put_chunk(
    db: Session, workspace_id: str, upload_id: str, index: int, stream: Iterator[bytes]
) -> Upload:
    """Store chunk ``index`` (idempotent: re-sending replaces the file). Validates its size."""
    upload = require_open(db, workspace_id, upload_id)
    if not 0 <= index < upload.total_chunks:
        raise AppError(
            "VALIDATION_ERROR",
            f"Chunk index {index} is out of range (0..{upload.total_chunks - 1})",
        )
    expected = expected_chunk_len(upload, index)
    directory = upload_dir(workspace_id, upload.id)
    directory.mkdir(parents=True, exist_ok=True)
    final = chunk_path(workspace_id, upload.id, index)
    part = final.with_suffix(f".{new_id()[:8]}.tmp")
    written = 0
    try:
        with part.open("wb") as out:
            for block in stream:
                written += len(block)
                if written > expected:
                    raise AppError(
                        "VALIDATION_ERROR",
                        f"Chunk {index} is larger than the expected {expected} bytes",
                        details={"expected": expected},
                    )
                out.write(block)
        if written != expected:
            raise AppError(
                "VALIDATION_ERROR",
                f"Chunk {index} has {written} bytes, expected {expected}",
                details={"expected": expected, "received": written},
            )
        part.replace(final)
    finally:
        part.unlink(missing_ok=True)
    return refresh_received(upload)


def assemble(upload: Upload) -> tuple[Path, str, int]:
    """Concatenate all chunks into one temp file; returns ``(path, sha256, size)``."""
    missing = sorted(set(range(upload.total_chunks)) - set(received_on_disk(upload)))
    if missing:
        raise AppError(
            "UPLOAD_INCOMPLETE",
            f"{len(missing)} chunk(s) missing",
            details={"missing": missing[:200], "total_chunks": upload.total_chunks},
        )
    directory = upload_dir(upload.workspace_id, upload.id)
    target = directory / "assembled.bin"
    digest = hashlib.sha256()
    size = 0
    with target.open("wb") as out:
        for index in range(upload.total_chunks):
            with chunk_path(upload.workspace_id, upload.id, index).open("rb") as src:
                while block := src.read(READ_BLOCK):
                    digest.update(block)
                    out.write(block)
                    size += len(block)
    if size != upload.size_bytes:
        target.unlink(missing_ok=True)
        raise AppError(
            "UPLOAD_INCOMPLETE",
            f"Assembled {size} bytes but {upload.size_bytes} were declared",
        )
    return target, digest.hexdigest(), size


def complete_upload(
    db: Session, workspace_id: str, upload_id: str
) -> tuple[Upload, Asset, bool, str | None]:
    """Assemble, hash, dedupe and register the asset, then enqueue processing.

    Returns ``(upload, asset, duplicate, job_id)``. Completing an already completed upload is
    idempotent and returns its asset.
    """
    upload = UploadRepository(db).require(workspace_id, upload_id)
    if upload.status == "completed" and upload.asset_id:
        asset = AssetRepository(db).require(workspace_id, upload.asset_id)
        return upload, asset, False, None
    if upload.status == "aborted":
        raise AppError("UPLOAD_CLOSED", "Upload was aborted")
    path, digest, size = assemble(upload)
    asset, duplicate = asset_service.register_file(
        db,
        workspace_id,
        tmp_path=path,
        filename=upload.filename,
        mime=upload.mime,
        sha256=digest,
        size_bytes=size,
        content_item_id=upload.content_item_id,
    )
    upload.status = "completed"
    upload.asset_id = asset.id
    upload.received_chunks = list(range(upload.total_chunks))
    db.flush()
    shutil.rmtree(upload_dir(workspace_id, upload.id), ignore_errors=True)
    job_id = None
    if not duplicate:
        job_id = asset_service.start_processing(db, workspace_id, asset)
    return upload, asset, duplicate, job_id


def abort_upload(db: Session, workspace_id: str, upload_id: str) -> Upload:
    upload = UploadRepository(db).require(workspace_id, upload_id)
    if upload.status == "completed":
        raise AppError("UPLOAD_CLOSED", "Upload already completed; delete the asset instead")
    upload.status = "aborted"
    shutil.rmtree(upload_dir(workspace_id, upload.id), ignore_errors=True)
    db.flush()
    return upload


# ── one-shot upload ───────────────────────────────────────────────────────────────────────────
def store_stream(workspace_id: str, source: BinaryIO) -> tuple[Path, str, int]:
    """Copy ``source`` to a temp file, hashing and enforcing ``MAX_UPLOAD_BYTES`` as it goes."""
    settings = get_settings()
    if free_disk_bytes() < settings.min_free_disk_mb * 1024 * 1024:
        raise AppError(
            "INSUFFICIENT_STORAGE",
            f"Less than {settings.min_free_disk_mb} MB of disk space is free",
        )
    directory = settings.tmp_dir / "uploads" / workspace_id
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{new_id()}.bin"
    digest = hashlib.sha256()
    size = 0
    try:
        with target.open("wb") as out:
            while block := source.read(READ_BLOCK):
                size += len(block)
                if size > settings.max_upload_bytes:
                    raise AppError(
                        "UPLOAD_TOO_LARGE",
                        f"File exceeds the {settings.max_upload_bytes} byte limit",
                        details={"max_bytes": settings.max_upload_bytes},
                    )
                digest.update(block)
                out.write(block)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    if size == 0:
        target.unlink(missing_ok=True)
        raise AppError("VALIDATION_ERROR", "The uploaded file is empty")
    return target, digest.hexdigest(), size


def purge_stale_uploads(db: Session, now: datetime | None = None) -> int:
    """Abort unfinished uploads older than ``UPLOAD_STALE_HOURS`` and delete their chunks."""
    cutoff = (now or datetime.now(UTC)) - timedelta(hours=get_settings().upload_stale_hours)
    stale = UploadRepository(db).stale(cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"))
    for upload in stale:
        upload.status = "aborted"
        shutil.rmtree(upload_dir(upload.workspace_id, upload.id), ignore_errors=True)
    db.flush()
    return len(stale)
