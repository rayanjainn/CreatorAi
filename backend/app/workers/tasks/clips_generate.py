"""``clips.generate`` job (Plan.md 3.3, 8.8): candidates 30, score 50, rerank 85, timelines 100."""

from __future__ import annotations

from typing import Any

from app.services.clip_service import JOB_TYPE, run_generate
from app.workers.runner import JobContext, register_job


def handle(ctx: JobContext) -> dict[str, Any]:
    return run_generate(ctx)


def register() -> None:
    register_job(JOB_TYPE, handle)


register()
