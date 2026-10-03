"""Resumable chunked uploads: init, PUT chunks (idempotent), status, complete, abort."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import session_scope
from app.deps import CtxDep, DbDep
from app.errors import AppError
from app.models import Upload
from app.repositories.assets import AssetRepository, UploadRepository
from app.schemas.assets import UploadComplete, UploadInit, UploadOut
from app.services import assets as asset_service
from app.services import uploads as upload_service
from app.workers.scheduler import register_nightly

router = APIRouter(prefix="/uploads", tags=["uploads"])


def _purge_stale_uploads() -> None:
    with session_scope() as db:
        upload_service.purge_stale_uploads(db)


register_nightly(_purge_stale_uploads)


def _out(upload: Upload) -> UploadOut:
    return UploadOut(
        id=upload.id,
        filename=upload.filename,
        mime=upload.mime,
        size_bytes=upload.size_bytes,
        chunk_size=upload.chunk_size,
        total_chunks=upload.total_chunks,
        received_chunks=sorted(upload.received_chunks or []),
        status=upload.status,
        asset_id=upload.asset_id,
        content_item_id=upload.content_item_id,
        created_at=upload.created_at,
    )


@router.post("", response_model=UploadOut, status_code=201)
def init_upload(body: UploadInit, ctx: CtxDep, db: DbDep) -> UploadOut:
    """Start an upload; ``chunk_size`` is the size of every chunk except the (smaller) last."""
    upload = upload_service.init_upload(
        db,
        ctx.workspace_id,
        filename=body.filename,
        mime=body.mime,
        size_bytes=body.size_bytes,
        content_item_id=body.content_item_id,
    )
    return _out(upload)


def _store_chunk(db: Session, workspace_id: str, upload_id: str, n: int, body: bytes) -> Upload:
    return upload_service.put_chunk(db, workspace_id, upload_id, n, iter([body]))


@router.put("/{upload_id}/chunks/{n}", response_model=UploadOut)
async def put_chunk(upload_id: str, n: int, request: Request, ctx: CtxDep, db: DbDep) -> UploadOut:
    """Raw-body chunk ``n`` (0-based). Re-sending a chunk replaces it, so retries are safe."""
    limit = get_settings().upload_chunk_size
    body = bytearray()
    async for block in request.stream():
        body += block
        if len(body) > limit:
            raise AppError(
                "VALIDATION_ERROR",
                f"Chunk is larger than the chunk size ({limit} bytes)",
                details={"chunk_size": limit},
            )
    upload = await run_in_threadpool(_store_chunk, db, ctx.workspace_id, upload_id, n, bytes(body))
    return _out(upload)


@router.get("/{upload_id}", response_model=UploadOut)
def get_upload(upload_id: str, ctx: CtxDep, db: DbDep) -> UploadOut:
    """Status for resuming: ``received_chunks`` lists the chunk indexes already stored."""
    upload = UploadRepository(db).require(ctx.workspace_id, upload_id)
    if upload.status == "uploading":
        upload_service.refresh_received(upload)
    return _out(upload)


@router.post("/{upload_id}/complete", response_model=UploadComplete)
def complete_upload(upload_id: str, ctx: CtxDep, db: DbDep) -> UploadComplete:
    """Assemble the chunks, hash, dedupe by sha256 and enqueue ``asset.process``."""
    upload, asset, duplicate, job_id = upload_service.complete_upload(
        db, ctx.workspace_id, upload_id
    )
    job = AssetRepository(db).latest_jobs(ctx.workspace_id, [asset.id]).get(asset.id)
    return UploadComplete(
        upload=_out(upload),
        asset=asset_service.asset_out(asset, job),  # type: ignore[arg-type]
        job_id=job_id,
        duplicate=duplicate,
    )


@router.post("/{upload_id}/abort", response_model=UploadOut)
def abort_upload(upload_id: str, ctx: CtxDep, db: DbDep) -> UploadOut:
    return _out(upload_service.abort_upload(db, ctx.workspace_id, upload_id))
