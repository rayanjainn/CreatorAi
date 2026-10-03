"""The ``asset.process`` driver: runs the stages in order with idempotent checkpoints.

Resume rule (Plan.md 8.1): a stage runs when it is missing from ``analysis.stages_done``; running a
stage invalidates every later one. ``from_stage`` (job payload) forces a restart at that stage, and
the embed stage re-runs on its own when the stored vectors came from a different embedder.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import Asset
from app.services import search_service
from app.services.assets import analysis_of, update_analysis
from app.services.ingest import caption, stages, transcribe
from app.services.ingest.plan import STAGES, invalidate_from, stage_of, stages_for
from app.services.ingest.run import AssetGone, Run
from app.workers.runner import JobCanceled, JobContext

log = logging.getLogger(__name__)

STAGE_FUNCS: dict[str, Callable[[Run], None]] = {
    "probe": stages.stage_probe,
    "audio": stages.stage_audio,
    "proxy": stages.stage_proxy,
    "silence": stages.stage_silence,
    "transcribe": transcribe.stage_transcribe,
    "segments": stages.stage_segments,
    "shots": stages.stage_shots,
    "keyframes": stages.stage_keyframes,
    "caption": caption.stage_caption,
    "embed": stages.stage_embed,
    "finalize": stages.stage_finalize,
}


def _done(analysis: dict[str, Any]) -> set[str]:
    """Stages truly completed (exact names; ``"caption: skipped ..."`` notes do not count)."""
    return {s for s in analysis.get("stages_done", []) if isinstance(s, str) and s in STAGES}


def _should_run(stage: str, analysis: dict[str, Any]) -> bool:
    if stage not in _done(analysis):
        return True
    return stage == "embed" and stages.embedder_is_stale(analysis)


def process_asset(job: JobContext) -> dict[str, Any]:
    """Run (or resume) the pipeline for ``job.entity_id``; see module docstring."""
    asset_id = job.entity_id or ""
    run = Run(job, asset_id)
    from_stage = job.payload.get("from_stage")
    try:
        run.snapshot()
    except AssetGone:
        return {"asset_id": asset_id, "skipped": "asset no longer exists"}
    if from_stage is not None and from_stage not in STAGES:
        raise AppError("VALIDATION_ERROR", f"Unknown stage {from_stage!r}", retryable=False)

    def start(_: Session, a: Asset) -> None:
        a.status = "processing"
        a.error = None
        data = analysis_of(a)
        data.pop("failed_stage", None)
        data.pop("error_code", None)
        if from_stage:
            data["stages_done"] = invalidate_from(list(data.get("stages_done", [])), from_stage)
        a.analysis = data

    try:
        run.update(start)
        search_service.invalidate(run.workspace_id)
        for stage in STAGES:
            snapshot = run.snapshot()
            analysis = analysis_of(snapshot)
            has_audio = (analysis.get("probe") or {}).get("has_audio", True)
            if stage not in stages_for(snapshot.kind, has_audio=has_audio):
                continue
            if not _should_run(stage, analysis):
                continue
            run.check_cancel()
            run.begin(stage)
            STAGE_FUNCS[stage](run)
    except AssetGone:
        return {"asset_id": asset_id, "skipped": "asset was deleted during processing"}
    except JobCanceled:
        _record(run, status="uploaded", error="Processing canceled", code="CANCELED")
        search_service.invalidate(run.workspace_id)
        raise
    except AppError as exc:
        _record(run, status="failed", error=exc.message, code=exc.code)
        search_service.invalidate(run.workspace_id)
        raise
    except Exception as exc:
        log.exception("asset %s failed in stage %s", asset_id, run.stage)
        _record(
            run,
            status="failed",
            error=f"Unexpected error in stage '{run.stage}': {exc}",
            code="INTERNAL_ERROR",
        )
        search_service.invalidate(run.workspace_id)
        raise
    final = run.snapshot()
    analysis = analysis_of(final)
    return {
        "asset_id": asset_id,
        "status": final.status,
        "stages_done": [s for s in analysis.get("stages_done", []) if stage_of(s) in STAGES],
        "warnings": analysis.get("warnings", []),
    }


def _record(run: Run, *, status: str, error: str, code: str) -> None:
    """Persist a failure/cancel on the asset; never raises (the original error is re-raised)."""

    def apply(_: Session, a: Asset) -> None:
        a.status = status
        a.error = error
        update_analysis(a, failed_stage=run.stage or None, error_code=code)

    try:
        run.update(apply)
    except Exception:
        log.exception("could not record failure for asset %s", run.asset_id)
