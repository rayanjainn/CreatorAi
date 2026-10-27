"""Brand deals, the rate estimate, pitch emails and the brand-site lookup."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from app.deps import CtxDep, DbDep
from app.services import monetization as svc

router = APIRouter(prefix="/monetization", tags=["monetization"])

Stage = Literal["prospect", "pitched", "negotiating", "contracted", "delivered", "paid", "lost"]
DATE = r"^\d{4}-\d{2}-\d{2}$"


class DealBody(BaseModel):
    brand: str = Field(min_length=1, max_length=120)
    website: str = Field(default="", max_length=300)
    contact_name: str = Field(default="", max_length=120)
    contact_email: str = Field(default="", max_length=200)
    stage: Stage = "prospect"
    fee: float | None = Field(default=None, ge=0, le=10_000_000)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    deliverables: str = Field(default="", max_length=1000)
    due_date: str | None = Field(default=None, pattern=DATE)
    notes: str = Field(default="", max_length=4000)
    content_item_id: str | None = None


class DealPatch(BaseModel):
    brand: str | None = Field(default=None, max_length=120)
    website: str | None = Field(default=None, max_length=300)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_email: str | None = Field(default=None, max_length=200)
    stage: Stage | None = None
    fee: float | None = Field(default=None, ge=0, le=10_000_000)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    deliverables: str | None = Field(default=None, max_length=1000)
    due_date: str | None = Field(default=None, pattern=DATE)
    notes: str | None = Field(default=None, max_length=4000)
    content_item_id: str | None = None


class RateBody(BaseModel):
    avg_views: int = Field(ge=1, le=1_000_000_000)
    cpm_low: float | None = Field(default=None, ge=0, le=1000)
    cpm_high: float | None = Field(default=None, ge=0, le=1000)
    placements: int = Field(default=1, ge=1, le=20)


class ChannelStats(BaseModel):
    subscribers: str = Field(default="", max_length=60)
    avg_views: str = Field(default="", max_length=60)
    audience: str = Field(default="", max_length=300)
    top_countries: str = Field(default="", max_length=200)
    engagement: str = Field(default="", max_length=100)


class PitchBody(BaseModel):
    stats: ChannelStats = Field(default_factory=ChannelStats)
    notes: str = Field(default="", max_length=600)


class LookupBody(BaseModel):
    website: str = Field(min_length=3, max_length=300)


@router.get("/deals")
def list_deals(ctx: CtxDep, db: DbDep, stage: Stage | None = None) -> list[dict[str, Any]]:
    return svc.list_deals(db, ctx.workspace_id, stage)


@router.post("/deals", status_code=201)
def create_deal(body: DealBody, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.create_deal(db, ctx.workspace_id, body.model_dump())


@router.patch("/deals/{deal_id}")
def update_deal(deal_id: str, body: DealPatch, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return svc.update_deal(db, ctx.workspace_id, deal_id, body.model_dump(exclude_unset=True))


@router.delete("/deals/{deal_id}", status_code=204)
def delete_deal(deal_id: str, ctx: CtxDep, db: DbDep) -> Response:
    svc.delete_deal(db, ctx.workspace_id, deal_id)
    return Response(status_code=204)


@router.post("/deals/{deal_id}/pitch")
def pitch(deal_id: str, body: PitchBody, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Write an outreach email with the configured model, from the numbers given only."""
    return svc.generate_pitch(db, ctx.workspace_id, deal_id, body.stats.model_dump(), body.notes)


@router.get("/summary")
def summary(ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Pipeline value by stage, paid total, win rate, overdue and upcoming deliverables."""
    return svc.summary(db, ctx.workspace_id)


@router.post("/rate")
def rate(body: RateBody, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """``views / 1000 x CPM`` for a range, plus the creator's paid-deal history (heuristic)."""
    return svc.rate_estimate(
        db, ctx.workspace_id, avg_views=body.avg_views, cpm_low=body.cpm_low,
        cpm_high=body.cpm_high, placements=body.placements,
    )  # fmt: skip


@router.post("/lookup")
def lookup(body: LookupBody, ctx: CtxDep) -> dict[str, Any]:
    """Read a few public pages of the brand's site; report emails and links printed there."""
    return svc.brand_lookup(body.website)
