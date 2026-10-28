"""``publish.upload`` job: send a finished render to YouTube (``services/publish_service``)."""

from __future__ import annotations

from typing import Any

from app.services.publish_service import JOB_TYPE, run_upload
from app.workers.runner import JobContext, register_job


def handle(ctx: JobContext) -> dict[str, Any]:
    return run_upload(ctx)


def register() -> None:
    register_job(JOB_TYPE, handle)


register()
