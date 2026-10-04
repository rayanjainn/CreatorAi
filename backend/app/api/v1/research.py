"""Research agent: cited briefs from web search."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.deps import CtxDep, DbDep
from app.services import research

router = APIRouter(prefix="/research", tags=["research"])


class ResearchBody(BaseModel):
    topic: str = Field(min_length=3, max_length=300)
    content_item_id: str | None = None


@router.post("", status_code=201)
def create(body: ResearchBody, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return research.create(db, ctx.workspace_id, body.topic, body.content_item_id)


@router.get("")
def list_briefs(ctx: CtxDep, db: DbDep, content_item_id: str | None = None) -> list[dict[str, Any]]:
    return research.list_briefs(db, ctx.workspace_id, content_item_id)
