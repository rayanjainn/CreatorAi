"""Content board: items, kanban view, ordering and stage moves."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.deps import CtxDep, DbDep, PageDep
from app.repositories.content import ContentItemRepository
from app.schemas.assets import Page
from app.schemas.content import (
    BoardOut,
    CardOut,
    ContentCreate,
    ContentItemOut,
    ContentPatch,
    DeleteOut,
    Domain,
    MoveRequest,
    Stage,
)
from app.services import content_service

router = APIRouter(prefix="/content", tags=["content"])


@router.get("", response_model=Page[ContentItemOut])
def list_content(
    ctx: CtxDep,
    db: DbDep,
    page: PageDep,
    stage: Stage | None = None,
    domain: Domain | None = None,
    q: Annotated[str | None, Query(max_length=200, description="title / idea text")] = None,
) -> dict[str, Any]:
    items, total = ContentItemRepository(db).search(
        ctx.workspace_id, stage=stage, q=q, domain=domain, limit=page.limit, offset=page.offset
    )
    return {"items": items, "total": total, "limit": page.limit, "offset": page.offset}


@router.get("/board", response_model=BoardOut)
def get_board(
    ctx: CtxDep, db: DbDep, q: Annotated[str | None, Query(max_length=200)] = None,
    domain: Domain | None = None,
) -> dict[str, Any]:  # fmt: skip
    """Columns ``idea`` to ``published`` with ordered cards (thumbnail, progress, running jobs)."""
    return content_service.board(db, ctx.workspace_id, q, domain)


@router.post("", response_model=CardOut, status_code=201)
def create_content(body: ContentCreate, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    item = content_service.create_item(db, ctx.workspace_id, body.model_dump())
    return content_service.card(db, ctx.workspace_id, item)


@router.get("/{item_id}", response_model=CardOut)
def get_content(item_id: str, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    item = ContentItemRepository(db).require(ctx.workspace_id, item_id)
    return content_service.card(db, ctx.workspace_id, item)


@router.patch("/{item_id}", response_model=CardOut)
def patch_content(item_id: str, body: ContentPatch, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    item = content_service.update_item(
        db, ctx.workspace_id, item_id, body.model_dump(exclude_unset=True)
    )
    return content_service.card(db, ctx.workspace_id, item)


@router.post("/{item_id}/move", response_model=CardOut)
def move_content(item_id: str, body: MoveRequest, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Drag and drop: move to ``stage`` at ``position``; both columns are renumbered 0..n-1.

    Entering ``shoot`` needs a script (``409 NO_SCRIPT``) and approves it.
    """
    item = content_service.move_item(db, ctx.workspace_id, item_id, body.stage, body.position)
    return content_service.card(db, ctx.workspace_id, item)


@router.delete("/{item_id}", response_model=DeleteOut)
def delete_content(
    item_id: str,
    ctx: CtxDep,
    db: DbDep,
    confirm: Annotated[bool, Query(description="must be true to actually delete")] = False,
) -> dict[str, Any]:
    """Cascade delete; without ``confirm=true``: ``409 CONFIRMATION_REQUIRED`` + cascade counts."""
    return content_service.delete_item(db, ctx.workspace_id, item_id, confirm)
