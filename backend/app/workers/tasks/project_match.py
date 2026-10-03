"""``project.match`` job (Plan.md 3.3, 8.5): load 10, embed spans 40, align 80, save 100."""

from __future__ import annotations

from typing import Any

from app.services.match_service import JOB_TYPE, run_match
from app.workers.runner import JobContext, register_job


def handle(ctx: JobContext) -> dict[str, Any]:
    return run_match(ctx)


def register() -> None:
    register_job(JOB_TYPE, handle)


register()
