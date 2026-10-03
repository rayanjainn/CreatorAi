"""Job status, SSE progress stream, cancel and retry."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.deps import CtxDep, DbDep, PageDep
from app.errors import AppError
from app.models import Job
from app.repositories.jobs import JobRepository
from app.schemas.jobs import JobOut
from app.workers.events import is_terminal, job_event
from app.workers.pubsub import pubsub
from app.workers.runner import get_runner

router = APIRouter(prefix="/jobs", tags=["jobs"])

KEEPALIVE_SEC = 15.0


def _sse(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.get("", response_model=list[JobOut])
def list_jobs(
    ctx: CtxDep,
    db: DbDep,
    page: PageDep,
    status: Annotated[str | None, Query()] = None,
    entity_type: Annotated[str | None, Query()] = None,
    entity_id: Annotated[str | None, Query()] = None,
) -> list[Job]:
    return JobRepository(db).list_filtered(
        ctx.workspace_id,
        status=status,
        entity_type=entity_type,
        entity_id=entity_id,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, ctx: CtxDep, db: DbDep) -> Job:
    return JobRepository(db).require(ctx.workspace_id, job_id)


@router.get("/{job_id}/events")
def job_events(job_id: str, ctx: CtxDep, db: DbDep) -> StreamingResponse:
    """SSE stream: ``progress`` events, keepalive comments, then a final ``done`` event."""
    job = JobRepository(db).require(ctx.workspace_id, job_id)
    initial = pubsub.last_event(job_id) or job_event(job)

    def stream() -> Iterator[str]:
        sub = pubsub.subscribe(job_id)
        try:
            event = initial
            yield _sse("progress", event)
            while not is_terminal(event):
                nxt = sub.get(timeout=KEEPALIVE_SEC)
                if nxt is None:
                    yield ": keepalive\n\n"
                    continue
                event = nxt
                yield _sse("progress", event)
            yield _sse("done", event)
        finally:
            sub.close()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: str, ctx: CtxDep, db: DbDep) -> Job:
    job = JobRepository(db).require(ctx.workspace_id, job_id)
    if job.status not in ("queued", "running"):
        raise AppError("JOB_NOT_CANCELABLE", f"Job already {job.status}")
    get_runner().request_cancel(job_id)
    return job


@router.post("/{job_id}/retry", response_model=JobOut)
def retry_job(job_id: str, ctx: CtxDep, db: DbDep) -> Job:
    job = JobRepository(db).require(ctx.workspace_id, job_id)
    if job.status != "failed":
        raise AppError("JOB_NOT_RETRYABLE", "Only failed jobs can be retried")
    db.commit()
    get_runner().retry(job_id)
    db.refresh(job)
    return job
