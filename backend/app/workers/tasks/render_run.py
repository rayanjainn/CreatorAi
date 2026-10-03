"""``render.run`` job (Plan.md 3.3): build graph 10 -> ffmpeg 95 -> thumbnail 100."""

from __future__ import annotations

from typing import Any

from app.services.render_service import JOB_TYPE, run_render
from app.workers.runner import JobContext, register_job


def handle(ctx: JobContext) -> dict[str, Any]:
    return run_render(ctx)


def register() -> None:
    register_job(JOB_TYPE, handle)


register()
