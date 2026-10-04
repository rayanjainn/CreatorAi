"""Library assets: one-shot upload, list, detail, edit, delete, reprocess and transcripts."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.deps import CtxDep, DbDep, PageDep
from app.errors import AppError, not_found
from app.ml.transcripts import SidecarFormat
from app.repositories.assets import AssetRepository, SegmentRepository
from app.schemas.assets import (
    AssetDetail,
    AssetOut,
    AssetPatch,
    AssetUploadResult,
    Page,
    ReprocessOut,
    ReprocessRequest,
    TranscriptOut,
)
from app.schemas.common import Provenance
from app.services import assets as asset_service
from app.services import uploads as upload_service

router = APIRouter(prefix="/assets", tags=["assets"])
MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024


def _card(db: Session, workspace_id: str, asset_id: str) -> dict[str, Any]:
    asset = AssetRepository(db).require(workspace_id, asset_id)
    job = AssetRepository(db).latest_jobs(workspace_id, [asset.id]).get(asset.id)
    return asset_service.asset_out(asset, job)


@router.post("/upload", response_model=AssetUploadResult, status_code=201)
def upload_asset(
    ctx: CtxDep,
    db: DbDep,
    file: Annotated[UploadFile, File(description="The media file or document")],
    sidecar: Annotated[
        UploadFile | None,
        File(description="Optional transcript: *.words.json, *.srt or *.vtt"),
    ] = None,
    content_item_id: Annotated[str | None, Form()] = None,
) -> AssetUploadResult:
    """One-shot multipart upload for small files (use /uploads for big ones)."""
    sidecar_data: tuple[str, str | None] | None = None
    if sidecar is not None and sidecar.filename:
        raw = sidecar.file.read(MAX_TRANSCRIPT_BYTES + 1)
        if len(raw) > MAX_TRANSCRIPT_BYTES:
            raise AppError("VALIDATION_ERROR", "Transcript file is too large")
        sidecar_data = (raw.decode("utf-8-sig", errors="replace"), sidecar.filename)
    tmp, digest, size = upload_service.store_stream(ctx.workspace_id, file.file)
    try:
        asset, duplicate = asset_service.register_file(
            db,
            ctx.workspace_id,
            tmp_path=tmp,
            filename=file.filename or "upload",
            mime=file.content_type,
            sha256=digest,
            size_bytes=size,
            content_item_id=content_item_id or None,
            sidecar=sidecar_data,
        )
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    job_id = None
    if not duplicate or sidecar_data is not None:
        job_id = asset_service.start_processing(
            db, ctx.workspace_id, asset, **({"reprocess": True} if duplicate else {})
        )
    return AssetUploadResult(
        asset=AssetOut(**_card(db, ctx.workspace_id, asset.id)), job_id=job_id, duplicate=duplicate
    )


@router.get("", response_model=Page[AssetOut])
def list_assets(
    ctx: CtxDep,
    db: DbDep,
    page: PageDep,
    kind: Annotated[str | None, Query(pattern="^(video|image|audio|document)$")] = None,
    status: Annotated[str | None, Query(pattern="^(uploaded|processing|ready|failed)$")] = None,
    tag: str | None = None,
    content_item_id: str | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    sort: Annotated[
        str, Query(pattern="^-?(created_at|filename|duration|size|status)$")
    ] = "-created_at",
) -> dict[str, Any]:
    """Filter by kind/status/tag/project/text; ``sort`` is a field with an optional ``-`` prefix."""
    rows, total = AssetRepository(db).search(
        ctx.workspace_id,
        kind=kind,
        status=status,
        tag=tag,
        content_item_id=content_item_id,
        q=q,
        sort=sort,
        limit=page.limit,
        offset=page.offset,
    )
    return {
        "items": asset_service.asset_page(db, ctx.workspace_id, rows),
        "total": total,
        "limit": page.limit,
        "offset": page.offset,
    }


@router.get("/{asset_id}", response_model=AssetDetail)
def get_asset(
    asset_id: str, ctx: CtxDep, db: DbDep, include_energy: bool = False
) -> dict[str, Any]:
    """Asset with signed URLs (original/proxy/thumb/audio), shots, segments and analysis."""
    asset = AssetRepository(db).require(ctx.workspace_id, asset_id)
    return asset_service.asset_detail(db, ctx.workspace_id, asset, include_energy=include_energy)


@router.patch("/{asset_id}", response_model=AssetOut)
def patch_asset(asset_id: str, body: AssetPatch, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    asset_service.patch_asset(
        db, ctx.workspace_id, asset_id, body.model_dump(include=body.model_fields_set)
    )
    return _card(db, ctx.workspace_id, asset_id)


@router.delete("/{asset_id}", status_code=204)
def delete_asset(asset_id: str, ctx: CtxDep, db: DbDep) -> None:
    asset_service.delete_asset(db, ctx.workspace_id, asset_id)


@router.post("/{asset_id}/reprocess", response_model=ReprocessOut, status_code=202)
def reprocess_asset(
    asset_id: str, ctx: CtxDep, db: DbDep, body: ReprocessRequest | None = None
) -> dict[str, Any]:
    """Resume at the first stage missing in ``stages_done`` (or restart from ``stage``)."""
    _, job_id = asset_service.reprocess(
        db,
        ctx.workspace_id,
        asset_id,
        body.stage if body else None,
        mode=body.mode if body else None,
    )
    return {"job_id": job_id, "asset": _card(db, ctx.workspace_id, asset_id)}


# ── transcripts ───────────────────────────────────────────────────────────────────────────────
@router.get("/{asset_id}/transcript", response_model=TranscriptOut)
def get_transcript(asset_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    asset = AssetRepository(db).require(ctx.workspace_id, asset_id)
    segments = SegmentRepository(db).for_asset(ctx.workspace_id, asset.id)
    if not segments:
        raise not_found("Transcript", reason="not_available_yet")
    analysis = asset_service.analysis_of(asset)
    asr = analysis.get("asr") or {}
    prov = asset_service.stage_provenance(analysis).get("transcribe") or Provenance.user()
    return {
        "asset_id": asset.id,
        "source": asr.get("source", "asr"),
        "provider": asr.get("provider"),
        "model": asr.get("model"),
        "language": asr.get("language"),
        "words_estimated": bool(asr.get("words_estimated", False)),
        "segments": [
            {
                "idx": g.idx,
                "start": g.start_sec,
                "end": g.end_sec,
                "text": g.text,
                "words": g.words or [],
            }
            for g in segments
        ],
        "provenance": prov,
    }


async def _put_transcript(
    asset_id: str,
    request: Request,
    ctx: CtxDep,
    db: DbDep,
    format: Annotated[str | None, Query(pattern="^(words\\.json|srt|vtt)$")] = None,
) -> dict[str, Any]:
    body = await request.body()
    if len(body) > MAX_TRANSCRIPT_BYTES:
        raise AppError("VALIDATION_ERROR", "Transcript is too large")
    text = body.decode("utf-8-sig", errors="replace")
    fmt: SidecarFormat | None = format  # type: ignore[assignment]
    return await run_in_threadpool(_attach, db, ctx.workspace_id, asset_id, text, fmt)


def _attach(
    db: Session, workspace_id: str, asset_id: str, text: str, fmt: SidecarFormat | None
) -> dict[str, Any]:
    asset = AssetRepository(db).require(workspace_id, asset_id)
    if asset.kind not in ("video", "audio"):
        raise AppError("CONFLICT", f"{asset.kind} assets have no transcript")
    if asset.analysis.get("probe", {}).get("has_audio") is False:
        raise AppError("CONFLICT", "This video has no audio track to transcribe")
    asset_service.store_sidecar(asset, text, None, fmt)
    db.flush()
    job_id = None
    if not AssetRepository(db).active_jobs(workspace_id, asset_id):
        job_id = asset_service.start_processing(db, workspace_id, asset, reprocess=True)
    return {"job_id": job_id, "asset": _card(db, workspace_id, asset_id)}


router.add_api_route(
    "/{asset_id}/transcript",
    _put_transcript,
    methods=["PUT", "POST"],
    response_model=ReprocessOut,
    status_code=202,
    summary="Attach an SRT, VTT or words.json transcript and re-run from transcription",
)
