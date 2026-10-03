"""Asset use-cases: registering files, serialising, patching, deleting and re-processing.

Plain Python (no FastAPI). Routers call these; the ``asset.process`` job calls the lower-level
helpers (``update_analysis`` and friends) with its own sessions.
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import AppError, not_found
from app.media.kinds import detect_kind, extension, guess_mime, safe_filename
from app.ml.transcripts import SidecarFormat, parse_sidecar
from app.models import Asset, ContentItem, new_id, utcnow
from app.repositories.assets import AssetRepository, SegmentRepository, ShotRepository
from app.schemas.common import Provenance, weakest
from app.security import sign_media
from app.services import search_service
from app.services.ingest.plan import STAGES, invalidate_from
from app.storage.local import get_storage
from app.workers.runner import JOB_HANDLERS, enqueue, get_runner

log = logging.getLogger(__name__)

PROCESS_JOB = "asset.process"
# Stages whose output is generated content (measurements like shots/segments are not badged).
PROVENANCE_STAGES = ("transcribe", "caption", "embed")
MAX_TAGS = 50


# ── keys and analysis helpers ─────────────────────────────────────────────────────────────────
def asset_prefix(workspace_id: str, asset_id: str) -> str:
    return f"media/{workspace_id}/{asset_id}"


def analysis_of(asset: Asset) -> dict[str, Any]:
    return dict(asset.analysis or {})


def update_analysis(asset: Asset, **changes: Any) -> dict[str, Any]:
    """Replace ``asset.analysis`` with a copy plus ``changes`` (JSON columns need reassignment)."""
    data = analysis_of(asset)
    data.update(changes)
    asset.analysis = data
    return data


def stage_provenance(analysis: dict[str, Any]) -> dict[str, Provenance]:
    out: dict[str, Provenance] = {}
    for stage, raw in (analysis.get("provenance") or {}).items():
        try:
            out[stage] = Provenance.model_validate(raw)
        except ValueError:
            continue
    return out


def overall_provenance(analysis: dict[str, Any]) -> Provenance:
    """Weakest provenance of the generated stages present; ``user`` when nothing is generated."""
    by_stage = stage_provenance(analysis)
    present = [by_stage[s] for s in PROVENANCE_STAGES if s in by_stage]
    return weakest(present) or Provenance.user()


def enrich_provenance(analysis: dict[str, Any]) -> dict[str, Provenance]:
    """Per-stage provenance, with ``caption`` reported as ``user`` once the user edited it."""
    by_stage = stage_provenance(analysis)
    if "description" in (analysis.get("user_edited") or []):
        by_stage["description"] = Provenance.user()
    return by_stage


# ── serialisation ─────────────────────────────────────────────────────────────────────────────
def _url(key: str | None) -> str | None:
    return sign_media(key) if key else None


def asset_out(asset: Asset, job: Any | None = None) -> dict[str, Any]:
    """Library-card representation, including provenance and the latest processing job."""
    analysis = analysis_of(asset)
    return {
        "id": asset.id,
        "kind": asset.kind,
        "filename": asset.filename,
        "mime": asset.mime,
        "size_bytes": asset.size_bytes,
        "sha256": asset.sha256,
        "duration_sec": asset.duration_sec,
        "width": asset.width,
        "height": asset.height,
        "fps": asset.fps,
        "status": asset.status,
        "error": asset.error,
        "description": asset.description,
        "tags": list(asset.tags or []),
        "folder": asset.folder,
        "content_item_id": asset.content_item_id,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
        "thumb_url": _url(asset.thumb_key),
        "stages_done": [s for s in analysis.get("stages_done", []) if isinstance(s, str)],
        "warnings": list(analysis.get("warnings") or []),
        "job": None
        if job is None
        else {
            "id": job.id,
            "status": job.status,
            "progress": job.progress,
            "stage": job.stage,
            "error": job.error,
        },
        "provenance": overall_provenance(analysis),
        "provenance_by_stage": enrich_provenance(analysis),
    }


def public_analysis(analysis: dict[str, Any], include_energy: bool = False) -> dict[str, Any]:
    """Analysis JSON for the detail view: no energy curve (unless asked) and truncated text."""
    out = {k: v for k, v in analysis.items() if k not in ("energy", "text", "sidecar")}
    if include_energy and "energy" in analysis:
        out["energy"] = analysis["energy"]
    if isinstance(analysis.get("text"), str):
        out["text"] = analysis["text"][:5000]
        out["text_chars"] = len(analysis["text"])
    sidecar = analysis.get("sidecar")
    if isinstance(sidecar, dict):
        out["sidecar"] = {k: v for k, v in sidecar.items() if k != "key"}
    return out


def asset_detail(
    db: Session, workspace_id: str, asset: Asset, *, include_energy: bool = False
) -> dict[str, Any]:
    """Full asset: card + signed URLs, shots with keyframe URLs, segments and analysis."""
    repo = AssetRepository(db)
    job = repo.latest_jobs(workspace_id, [asset.id]).get(asset.id)
    analysis = analysis_of(asset)
    captioned = set(analysis.get("captioned_shots") or [])
    shots = [
        {
            "idx": s.idx,
            "start_sec": s.start_sec,
            "end_sec": s.end_sec,
            "caption": s.caption,
            "tags": list(s.tags or []),
            "keyframe_url": _url(s.keyframe_key),
            "captioned": s.idx in captioned,
        }
        for s in ShotRepository(db).for_asset(workspace_id, asset.id)
    ]
    segments = [
        {"idx": g.idx, "start_sec": g.start_sec, "end_sec": g.end_sec, "text": g.text}
        for g in SegmentRepository(db).for_asset(workspace_id, asset.id)
    ]
    return {
        **asset_out(asset, job),
        "urls": {
            "original": _url(asset.storage_key),
            "proxy": _url(asset.proxy_key),
            "thumb": _url(asset.thumb_key),
            "audio": _url(asset.audio_key),
        },
        "shots": shots,
        "segments": segments,
        "analysis": public_analysis(analysis, include_energy),
    }


def asset_page(db: Session, workspace_id: str, assets: list[Asset]) -> list[dict[str, Any]]:
    jobs = AssetRepository(db).latest_jobs(workspace_id, [a.id for a in assets])
    return [asset_out(a, jobs.get(a.id)) for a in assets]


# ── registering files ─────────────────────────────────────────────────────────────────────────
def require_content_item(db: Session, workspace_id: str, content_item_id: str | None) -> None:
    if content_item_id is None:
        return
    found = (
        db.query(ContentItem.id)
        .filter(ContentItem.id == content_item_id, ContentItem.workspace_id == workspace_id)
        .first()
    )
    if found is None:
        raise not_found("Content item")


def store_sidecar(
    asset: Asset,
    text: str,
    filename: str | None = None,
    fmt: SidecarFormat | None = None,
    *,
    source: str | None = None,
) -> None:
    """Validate and save a transcript sidecar for ``asset`` and invalidate transcription onward.

    Raises ``VALIDATION_ERROR`` for unparsable transcripts. The sidecar's provenance is ``user``
    (or ``demo`` when the file itself declares it); ``source`` forces one of those two.
    """
    parsed = parse_sidecar(text, fmt, filename)
    storage = get_storage()
    prefix = asset_prefix(asset.workspace_id, asset.id)
    for old in ("words.json", "srt", "vtt"):
        storage.delete_prefix(f"{prefix}/sidecar.{old}")
    key = f"{prefix}/sidecar.{parsed.format}"
    storage.path_for(key).parent.mkdir(parents=True, exist_ok=True)
    storage.path_for(key).write_text(text, encoding="utf-8")
    chosen = source if source in ("user", "demo") else parsed.source
    done = invalidate_from(analysis_of(asset).get("stages_done", []), "transcribe")
    update_analysis(
        asset,
        sidecar={
            "key": key,
            "format": parsed.format,
            "source": chosen,
            "filename": filename,
            "words": len(parsed.transcript.words),
        },
        stages_done=done,
    )


def register_file(
    db: Session,
    workspace_id: str,
    *,
    tmp_path: Path,
    filename: str,
    mime: str | None,
    sha256: str,
    size_bytes: int,
    content_item_id: str | None = None,
    sidecar: tuple[str, str | None] | None = None,
    sidecar_source: str | None = None,
    folder: str = "/",
) -> tuple[Asset, bool]:
    """Turn a finished file into an asset, deduplicating by ``(workspace, sha256)``.

    ``tmp_path`` is moved into storage (or deleted when it is a duplicate). Returns
    ``(asset, duplicate)``. A ``sidecar`` is ``(text, filename)``; an invalid one raises before
    anything is stored.
    """
    require_content_item(db, workspace_id, content_item_id)
    if sidecar is not None:
        parse_sidecar(sidecar[0], None, sidecar[1])  # validate up front
    repo = AssetRepository(db)
    existing = repo.find_by_sha(workspace_id, sha256)
    if existing is not None:
        tmp_path.unlink(missing_ok=True)
        if content_item_id and existing.content_item_id is None:
            existing.content_item_id = content_item_id
        if sidecar is not None:
            store_sidecar(existing, sidecar[0], sidecar[1], source=sidecar_source)
        db.flush()
        return existing, True

    name = safe_filename(filename)
    asset = Asset(
        workspace_id=workspace_id,
        content_item_id=content_item_id,
        kind=detect_kind(name, mime),
        filename=name,
        storage_key="",
        mime=guess_mime(name, mime),
        size_bytes=size_bytes,
        sha256=sha256,
        folder=folder,
        analysis={"stages_done": []},
    )
    asset.id = new_id()
    asset.storage_key = f"{asset_prefix(workspace_id, asset.id)}/original{extension(name)}"
    dest = get_storage().path_for(asset.storage_key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with db.begin_nested():
            db.add(asset)
            db.flush()
    except IntegrityError:  # lost a race against a concurrent upload of the same bytes
        tmp_path.unlink(missing_ok=True)
        winner = repo.find_by_sha(workspace_id, sha256)
        if winner is None:
            raise
        return winner, True
    try:
        os.replace(tmp_path, dest)
    except OSError:
        shutil.move(str(tmp_path), dest)
    if sidecar is not None:
        store_sidecar(asset, sidecar[0], sidecar[1], source=sidecar_source)
    db.flush()
    return asset, False


def find_sidecar(path: Path) -> Path | None:
    """A transcript sitting next to ``path``: ``<name>.words.json``, ``<stem>.words.json``,
    then ``.srt`` and ``.vtt`` (``clip.mp4`` -> ``clip.mp4.words.json`` or ``clip.words.json``)."""
    for base in (path.name, path.stem):
        for suffix in (".words.json", ".srt", ".vtt"):
            candidate = path.with_name(base + suffix)
            if candidate.is_file() and candidate != path:
                return candidate
    return None


def ingest_local_file(
    db: Session,
    workspace_id: str,
    path: Path,
    *,
    content_item_id: str | None = None,
    mime: str | None = None,
    sidecar: Path | None = None,
    sidecar_source: str | None = None,
    process: bool = True,
) -> tuple[Asset, bool, str | None]:
    """Register a file from disk (copied, the original is untouched), picking up a neighbouring
    transcript sidecar automatically. For seeding and scripts; the API uses ``register_file``.

    Returns ``(asset, duplicate, job_id)``.
    """
    sidecar = sidecar or find_sidecar(path)
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while block := fh.read(1024 * 1024):
            digest.update(block)
    tmp_dir = get_settings().tmp_dir / "uploads" / workspace_id
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp = tmp_dir / f"{new_id()}.bin"
    shutil.copyfile(path, tmp)
    asset, duplicate = register_file(
        db,
        workspace_id,
        tmp_path=tmp,
        filename=path.name,
        mime=mime,
        sha256=digest.hexdigest(),
        size_bytes=path.stat().st_size,
        content_item_id=content_item_id,
        sidecar=(sidecar.read_text(encoding="utf-8-sig"), sidecar.name) if sidecar else None,
        sidecar_source=sidecar_source,
    )
    job_id = None
    if process and (not duplicate or sidecar is not None):
        job_id = start_processing(
            db, workspace_id, asset, **({"reprocess": True} if duplicate else {})
        )
    return asset, duplicate, job_id


# ── processing ────────────────────────────────────────────────────────────────────────────────
def processing_available() -> bool:
    return PROCESS_JOB in JOB_HANDLERS


def start_processing(db: Session, workspace_id: str, asset: Asset, **payload: Any) -> str | None:
    """Commit, then enqueue ``asset.process`` (``None`` when no handler is registered).

    The commit matters: the job runs on its own DB session (inline in tests) and must see the row.
    """
    if not processing_available():
        return None
    db.commit()
    job_id = enqueue(PROCESS_JOB, "asset", asset.id, payload, workspace_id=workspace_id)
    db.expire_all()
    return job_id


def reprocess(
    db: Session, workspace_id: str, asset_id: str, stage: str | None = None
) -> tuple[Asset, str | None]:
    """Resume (or, with ``stage``, restart from that stage) the pipeline for an asset."""
    repo = AssetRepository(db)
    asset = repo.require(workspace_id, asset_id)
    if stage is not None and stage not in STAGES:
        raise AppError(
            "VALIDATION_ERROR", f"Unknown stage {stage!r}", details={"stages": list(STAGES)}
        )
    if repo.active_jobs(workspace_id, asset_id):
        raise AppError("CONFLICT", "This asset is already being processed")
    if not processing_available():
        raise AppError("INTERNAL_ERROR", "Asset processing is not available")
    payload: dict[str, Any] = {"reprocess": True}
    if stage:
        payload["from_stage"] = stage
    job_id = start_processing(db, workspace_id, asset, **payload)
    return repo.require(workspace_id, asset_id), job_id


# ── patch / delete ────────────────────────────────────────────────────────────────────────────
def clean_tags(tags: list[str]) -> list[str]:
    seen: dict[str, str] = {}
    for tag in tags:
        value = " ".join(str(tag).split())[:40]
        if value and value.lower() not in seen:
            seen[value.lower()] = value
    if len(seen) > MAX_TAGS:
        raise AppError("VALIDATION_ERROR", f"At most {MAX_TAGS} tags are allowed")
    return list(seen.values())


def patch_asset(db: Session, workspace_id: str, asset_id: str, changes: dict[str, Any]) -> Asset:
    """Apply user edits (``tags``, ``folder``, ``description``, ``content_item_id``)."""
    asset = AssetRepository(db).require(workspace_id, asset_id)
    edited = set(analysis_of(asset).get("user_edited") or [])
    if "content_item_id" in changes:
        require_content_item(db, workspace_id, changes["content_item_id"])
        asset.content_item_id = changes["content_item_id"]
    if changes.get("tags") is not None:
        asset.tags = clean_tags(changes["tags"])
        edited.add("tags")
    if changes.get("description") is not None:
        asset.description = changes["description"].strip()
        edited.add("description")
    if changes.get("folder") is not None:
        folder = "/" + changes["folder"].strip().strip("/")
        asset.folder = folder
    if edited:
        update_analysis(asset, user_edited=sorted(edited))
    asset.updated_at = utcnow()
    db.flush()
    search_service.invalidate(workspace_id)
    return asset


def delete_asset(db: Session, workspace_id: str, asset_id: str) -> None:
    """Remove the asset row (segments and shots cascade) and every file stored for it."""
    repo = AssetRepository(db)
    asset = repo.require(workspace_id, asset_id)
    for job in repo.active_jobs(workspace_id, asset_id):
        get_runner().request_cancel(job.id)
    prefix = asset_prefix(workspace_id, asset.id)
    repo.delete(workspace_id, asset.id)
    with contextlib.suppress(AppError):
        get_storage().delete_prefix(prefix)
    search_service.invalidate(workspace_id)
