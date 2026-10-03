"""Timeline editor API: edit, optimistic saves, revisions and server-side ops."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.deps import CtxDep, DbDep
from app.schemas.clips import (
    EditOpRequest,
    EditOpResult,
    EditOut,
    EditSave,
    EditSaved,
    RestoreRequest,
    RevisionOut,
    RevisionSummary,
)
from app.services import edit_service as svc

router = APIRouter(prefix="/clips/{clip_id}/edit", tags=["edits"])


@router.get("", response_model=EditOut)
def get_edit(clip_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Timeline + revision + per-asset signed proxy URLs, waveform energy and words."""
    return svc.get_edit(db, ctx.workspace_id, clip_id)


@router.put("", response_model=EditSaved)
def save_edit(clip_id: str, body: EditSave, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Save a whole timeline. ``409 REVISION_CONFLICT`` (``details.current_revision``) when
    ``base_revision`` is stale; ``422`` with ``details.violations`` when an invariant breaks."""
    return svc.save_edit(
        db, ctx.workspace_id, clip_id, body.timeline, body.base_revision, body.note
    )


@router.post("/ops", response_model=EditOpResult)
def apply_op(clip_id: str, body: EditOpRequest, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Apply one deterministic op (``tighten_pauses``, ``trim``, ``set_caption_style``,
    ``toggle_music``, ``split_item``, ``delete_item``, ``reorder``, ``set_status``,
    ``accept_all``, ``rebuild_captions``, ``set_crop_x``, ``ripple_insert``) server-side."""
    return svc.apply_op(
        db, ctx.workspace_id, clip_id, body.op, body.params, body.base_revision, body.note
    )


@router.get("/revisions", response_model=list[RevisionSummary])
def list_revisions(clip_id: str, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return svc.list_revisions(db, ctx.workspace_id, clip_id)


@router.get("/revisions/{revision}", response_model=RevisionOut)
def get_revision(clip_id: str, revision: int, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.get_revision(db, ctx.workspace_id, clip_id, revision)


@router.post("/revisions/{revision}/restore", response_model=EditSaved)
def restore_revision(
    clip_id: str, revision: int, ctx: CtxDep, db: DbDep, body: RestoreRequest | None = None
) -> dict[str, Any]:
    """Creates a NEW revision holding the old content (optional ``base_revision`` check)."""
    return svc.restore_revision(
        db, ctx.workspace_id, clip_id, revision, body.base_revision if body else None
    )
