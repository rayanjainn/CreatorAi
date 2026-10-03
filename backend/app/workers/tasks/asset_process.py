"""``asset.process`` job (Plan.md sections 3.3 and 8.1).

Stages and cumulative progress: probe 5, audio 15, proxy 30, silence+energy 38, transcribe 60,
segments 66, shots 72, keyframes 78, caption 88, embed 97, finalize 100. Checkpoints live in
``assets.analysis.stages_done`` so retries and ``POST /assets/{id}/reprocess`` resume instead of
restarting. Payload: ``from_stage`` (restart there), ``skip_hooks`` (do not fire after-ready hooks).
"""

from __future__ import annotations

from typing import Any

from app.services.ingest.pipeline import process_asset
from app.workers.runner import JobContext, register_job

JOB_TYPE = "asset.process"


def handle(ctx: JobContext) -> dict[str, Any]:
    return process_asset(ctx)


def register() -> None:
    register_job(JOB_TYPE, handle)


register()
