"""``analytics.sync`` job and its nightly trigger: refresh the counters of published videos."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select

from app.db import session_scope
from app.models import YoutubeConnection
from app.services import youtube_service
from app.workers.runner import JobContext, enqueue, register_job
from app.workers.scheduler import NIGHTLY_CALLBACKS, register_nightly

log = logging.getLogger(__name__)
JOB_TYPE = "analytics.sync"


def handle(ctx: JobContext) -> dict[str, Any]:
    ctx.progress(5, "reading YouTube")
    with ctx.session_factory() as db:
        out = youtube_service.sync(db, ctx.workspace_id)
        db.commit()
    ctx.progress(100, "done")
    return out


def sync_all() -> None:
    """Nightly: one sync job per connected workspace."""
    with session_scope() as db:
        ids = list(
            db.scalars(
                select(YoutubeConnection.workspace_id).where(YoutubeConnection.status == "active")
            )
        )
    for ws in ids:
        enqueue(JOB_TYPE, "workspace", ws, {}, workspace_id=ws)


def register() -> None:
    register_job(JOB_TYPE, handle)
    if sync_all not in NIGHTLY_CALLBACKS:
        register_nightly(sync_all)


register()
