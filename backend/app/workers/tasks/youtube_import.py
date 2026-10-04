"""``youtube.import`` job: download a YouTube video with yt-dlp into the library (queue ``io``)."""

from __future__ import annotations

from typing import Any

from app.services.yt_import import JOB_TYPE, run_import
from app.workers.runner import JobContext, register_job


def handle(ctx: JobContext) -> dict[str, Any]:
    return run_import(ctx)


def register() -> None:
    register_job(JOB_TYPE, handle)


register()
