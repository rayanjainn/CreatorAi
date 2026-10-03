"""Hooks, script generation and editing, versions, scene tools, metadata and approval."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.deps import CtxDep, DbDep
from app.schemas.scripts import (
    GenerateScriptRequest,
    HooksOut,
    HooksRequest,
    RegenerateSceneRequest,
    SceneRewriteOut,
    ScriptMetaOut,
    ScriptOut,
    ScriptPatch,
    ScriptVersionOut,
    TightenRequest,
)
from app.services import script_service as svc

router = APIRouter(tags=["scripts"])


@router.post("/content/{item_id}/hooks", response_model=HooksOut)
def make_hooks(
    item_id: str, ctx: CtxDep, db: DbDep, body: HooksRequest | None = None
) -> dict[str, Any]:
    """``script.hooks``: hook options stored on the current script (created as v1 if missing)."""
    body = body or HooksRequest()
    return svc.generate_hooks(db, ctx.workspace_id, item_id, body.count, body.tone, body.platform)


@router.post("/content/{item_id}/script/generate", response_model=ScriptOut)
def generate_script(
    item_id: str, body: GenerateScriptRequest, ctx: CtxDep, db: DbDep
) -> dict[str, Any]:
    """``script.generate`` (uses the latest Director plan structure); creates a new version."""
    return svc.generate_script(
        db, ctx.workspace_id, item_id, body.hook, body.tone, body.platform, body.length_sec
    )


@router.get("/content/{item_id}/script", response_model=ScriptOut)
def get_current_script(item_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Current script with est_sec counters and the Twin banner flag (``409 NO_SCRIPT`` if none)."""
    script = svc.current_script(db, ctx.workspace_id, item_id)
    return svc.script_out(db, ctx.workspace_id, script)


@router.get("/content/{item_id}/scripts", response_model=list[ScriptVersionOut])
def list_script_versions(item_id: str, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return svc.list_versions(db, ctx.workspace_id, item_id)


@router.get("/scripts/{script_id}", response_model=ScriptOut)
def get_script(script_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.get_script(db, ctx.workspace_id, script_id)


@router.patch("/scripts/{script_id}", response_model=ScriptOut)
def patch_script(script_id: str, body: ScriptPatch, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """User edits. Edited parts get provenance ``user``; beats are re-synced."""
    patch = body.model_dump(exclude_unset=True)
    if body.meta is not None:
        patch["meta"] = body.meta.model_dump(exclude_unset=True)
    return svc.update_script(db, ctx.workspace_id, script_id, patch)


@router.post("/scripts/{script_id}/restore", response_model=ScriptOut)
def restore_script(script_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.restore_script(db, ctx.workspace_id, script_id)


@router.post("/scripts/{script_id}/approve", response_model=ScriptOut)
def approve_script(script_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Approve and move the content item to ``shoot`` (fires the twin approval event)."""
    return svc.approve_script(db, ctx.workspace_id, script_id)


@router.post("/scripts/{script_id}/scenes/{idx}/regenerate", response_model=SceneRewriteOut)
def regenerate_scene(
    script_id: str, idx: int, ctx: CtxDep, db: DbDep, body: RegenerateSceneRequest | None = None
) -> dict[str, Any]:
    body = body or RegenerateSceneRequest()
    return svc.rewrite_scene(
        db, ctx.workspace_id, script_id, idx, "regenerate", instruction=body.instruction
    )


@router.post("/scripts/{script_id}/scenes/{idx}/tighten", response_model=SceneRewriteOut)
def tighten_scene(
    script_id: str, idx: int, ctx: CtxDep, db: DbDep, body: TightenRequest | None = None
) -> dict[str, Any]:
    body = body or TightenRequest()
    return svc.rewrite_scene(
        db, ctx.workspace_id, script_id, idx, "tighten", ratio=body.target_ratio
    )


@router.post("/scripts/{script_id}/meta", response_model=ScriptMetaOut)
def generate_meta(script_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """``script.meta``: titles, description, CTAs, captions, tags, pinned comment, thumb text."""
    return svc.generate_meta(db, ctx.workspace_id, script_id)
