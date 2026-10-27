"""Sponsor briefs and slots for a project (Plan 8.10)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from app.deps import CtxDep, DbDep
from app.services import sponsor_service as svc

router = APIRouter(tags=["sponsors"])


class BriefBody(BaseModel):
    brand: str = Field(min_length=1, max_length=120)
    product: str = Field(min_length=1, max_length=160)
    key_points: list[str] = Field(default_factory=list, max_length=10)
    cta: str = Field(default="", max_length=300)
    do_not_say: list[str] = Field(default_factory=list, max_length=10)
    duration_sec: int = Field(default=20, ge=10, le=60)
    deal_id: str | None = None


class BriefPatch(BaseModel):
    brand: str | None = Field(default=None, max_length=120)
    product: str | None = Field(default=None, max_length=160)
    key_points: list[str] | None = Field(default=None, max_length=10)
    cta: str | None = Field(default=None, max_length=300)
    do_not_say: list[str] | None = Field(default=None, max_length=10)
    duration_sec: int | None = Field(default=None, ge=10, le=60)
    deal_id: str | None = None


class FindBody(BaseModel):
    asset_id: str | None = None


class SlotPatch(BaseModel):
    integration_script: str | None = Field(default=None, max_length=2000)
    lower_third: str | None = Field(default=None, max_length=60)
    transition_back: str | None = Field(default=None, max_length=400)
    status: Literal["suggested", "rejected"] | None = None


class AcceptBody(BaseModel):
    clip_id: str


@router.get("/content/{item_id}/sponsors")
def list_briefs(item_id: str, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    """The project's sponsor briefs, each with its slots."""
    return svc.list_briefs(db, ctx.workspace_id, item_id)


@router.post("/content/{item_id}/sponsors", status_code=201)
def create_brief(item_id: str, body: BriefBody, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.create_brief(db, ctx.workspace_id, item_id, body.model_dump())


@router.patch("/sponsors/{brief_id}")
def update_brief(brief_id: str, body: BriefPatch, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.update_brief(db, ctx.workspace_id, brief_id, body.model_dump(exclude_unset=True))


@router.delete("/sponsors/{brief_id}", status_code=204)
def delete_brief(brief_id: str, ctx: CtxDep, db: DbDep) -> Response:
    svc.delete_brief(db, ctx.workspace_id, brief_id)
    return Response(status_code=204)


@router.post("/sponsors/{brief_id}/find-slots")
def find_slots(brief_id: str, body: FindBody, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Score the transcript boundaries and write the reads (replaces earlier suggestions)."""
    return svc.find_slots(db, ctx.workspace_id, brief_id, body.asset_id)


@router.patch("/sponsor-slots/{slot_id}")
def update_slot(slot_id: str, body: SlotPatch, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.update_slot(db, ctx.workspace_id, slot_id, body.model_dump(exclude_unset=True))


@router.post("/sponsor-slots/{slot_id}/accept")
def accept_slot(slot_id: str, body: AcceptBody, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Insert the read into the clip as a sponsor placeholder (a new edit revision)."""
    return svc.accept(db, ctx.workspace_id, slot_id, body.clip_id)
