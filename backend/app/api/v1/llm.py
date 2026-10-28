"""LLM status for the settings page."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.deps import CtxDep, DbDep
from app.llm.gateway import get_gateway
from app.llm.tasks import TASK_ROUTES
from app.services import usage

router = APIRouter(prefix="/llm", tags=["llm"])


@router.get("/status")
def llm_status(_: CtxDep) -> dict[str, Any]:
    """Which providers are configured, circuit state and today's usage counts."""
    return {**get_gateway().status(), "tasks": sorted(TASK_ROUTES)}


@router.post("/test")
def llm_test(_: CtxDep) -> dict[str, Any]:
    """Tiny real round-trip per configured provider so the user can verify their keys."""
    results = get_gateway().test_providers()
    return {"data_mode": get_gateway().data_mode(), "results": results}


@router.get("/usage")
def llm_usage(
    ctx: CtxDep, db: DbDep, days: int = Query(default=30, ge=1, le=365)
) -> dict[str, Any]:
    """Calls, errors, cache hits, tokens and latency per provider and task (from ``llm_usage``)."""
    return usage.report(db, ctx.workspace_id, days)
