"""Digital Twin: style profile, memories, chat and suggested actions."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.deps import CtxDep, DbDep
from app.services import twin

router = APIRouter(prefix="/twin", tags=["twin"])


class ChatBody(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    content_item_id: str | None = None
    clip_id: str | None = None


class ApplyBody(BaseModel):
    index: int = Field(default=0, ge=0, le=5)


@router.get("")
def overview(ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return twin.overview(db, ctx.workspace_id)


@router.get("/messages")
def messages(ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return twin.history(db, ctx.workspace_id)


@router.post("/chat")
def chat(body: ChatBody, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return twin.chat(db, ctx.workspace_id, body.message, body.content_item_id, body.clip_id)


@router.delete("/messages", status_code=204)
def clear(ctx: CtxDep, db: DbDep) -> None:
    twin.clear_history(db, ctx.workspace_id)


@router.post("/messages/{message_id}/apply")
def apply(message_id: str, body: ApplyBody, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return twin.apply_action(db, ctx.workspace_id, message_id, body.index)


@router.post("/style/update")
def update_style(ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return twin.update_style(db, ctx.workspace_id)
