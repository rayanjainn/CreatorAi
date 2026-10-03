"""Job event payload (Plan.md section 6.3)."""

from __future__ import annotations

from typing import Any

from app.models import Job

TERMINAL_STATUSES = frozenset({"succeeded", "failed", "canceled"})


def job_event(job: Job, message: str | None = None) -> dict[str, Any]:
    """Build the SSE payload for a job row."""
    terminal = job.status in TERMINAL_STATUSES
    return {
        "job_id": job.id,
        "type": job.type,
        "status": job.status,
        "progress": job.progress,
        "stage": job.stage,
        "message": message
        if message is not None
        else (job.error if job.status == "failed" else None),
        "result": job.result if terminal else None,
    }


def is_terminal(event: dict[str, Any]) -> bool:
    return event.get("status") in TERMINAL_STATUSES
