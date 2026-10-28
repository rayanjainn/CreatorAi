"""YouTube connection: OAuth start and callback, status, disconnect and a stats sync."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response
from fastapi.responses import RedirectResponse

from app.deps import CtxDep, DbDep
from app.services import youtube_service as svc
from app.workers.runner import enqueue

router = APIRouter(prefix="/youtube", tags=["youtube"])


@router.get("/status")
def status(ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Whether Google OAuth is configured here and which channel is connected."""
    return svc.status(db, ctx.workspace_id)


@router.post("/oauth/start")
def oauth_start(ctx: CtxDep) -> dict[str, str]:
    """The Google consent URL to open (admins and owners only)."""
    return svc.start(ctx.workspace_id, ctx.user_id)


@router.get("/oauth/callback", include_in_schema=False)
def oauth_callback(
    db: DbDep, code: str | None = None, state: str | None = None, error: str | None = None
) -> RedirectResponse:
    """Google redirects the browser here; no bearer token, the signed ``state`` names the
    workspace. Always answers with a redirect to Settings carrying the outcome."""
    return RedirectResponse(svc.callback(db, code=code, state=state, error=error), status_code=303)


@router.delete("/connection", status_code=204)
def disconnect(ctx: CtxDep, db: DbDep) -> Response:
    svc.disconnect(db, ctx.workspace_id)
    return Response(status_code=204)


@router.post("/sync", status_code=202)
def sync(ctx: CtxDep) -> dict[str, str]:
    """Refresh views, likes and comments of the videos published from CreatorAi (a job)."""
    job_id = enqueue(
        "analytics.sync", "workspace", ctx.workspace_id, {}, workspace_id=ctx.workspace_id
    )
    return {"job_id": job_id}
