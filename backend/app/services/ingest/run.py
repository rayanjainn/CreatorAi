"""State shared by the ``asset.process`` stages: job context, storage access and checkpoints."""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.db import session_scope
from app.models import Asset
from app.services import search_service
from app.services.assets import analysis_of, asset_prefix, update_analysis
from app.services.ingest.plan import STAGE_PROGRESS, invalidate_from, stage_of, stage_start
from app.storage.local import get_storage
from app.workers.runner import JobCanceled, JobContext

log = logging.getLogger(__name__)
Mutate = Callable[[Session, Asset], None]


class AssetGone(Exception):
    """The asset was deleted while its job was running; the job stops quietly."""


class Run:
    """One ``asset.process`` execution for one asset."""

    def __init__(self, job: JobContext, asset_id: str) -> None:
        self.job = job
        self.asset_id = asset_id
        self.workspace_id = job.workspace_id
        self.storage = get_storage()
        self.stage = ""

    # ── storage ──────────────────────────────────────────────────────────────────────────────
    @property
    def prefix(self) -> str:
        return asset_prefix(self.workspace_id, self.asset_id)

    def key(self, name: str) -> str:
        return f"{self.prefix}/{name}"

    def path(self, key: str) -> Path:
        return self.storage.path_for(key)

    # ── reading ──────────────────────────────────────────────────────────────────────────────
    def snapshot(self) -> Asset:
        """A detached copy of the asset row for read-only use between checkpoints."""
        with session_scope() as db:
            asset = db.get(Asset, self.asset_id)
            if asset is None or asset.workspace_id != self.workspace_id:
                raise AssetGone
            db.expunge(asset)
            return asset

    def analysis(self) -> dict[str, Any]:
        return analysis_of(self.snapshot())

    def original_path(self) -> Path:
        return self.path(self.snapshot().storage_key)

    # ── progress ─────────────────────────────────────────────────────────────────────────────
    def begin(self, stage: str) -> None:
        self.stage = stage
        self.job.progress(stage_start(stage), stage)

    def fraction(self, fraction: float) -> None:
        """Report progress inside the current stage (``fraction`` 0-1); a cancel checkpoint."""
        start, end = stage_start(self.stage), STAGE_PROGRESS[self.stage]
        self.job.progress(start + (end - start) * max(0.0, min(1.0, fraction)), self.stage)

    def check_cancel(self) -> None:
        self.job.check_cancel()

    def progress_callback(self) -> Callable[[float], None]:
        """For ffmpeg's progress thread: throttled, and never raises (the stage-end checkpoint
        handles cancellation, because an exception in that thread would be lost)."""
        last = [-1]

        def callback(fraction: float) -> None:
            pct = int(fraction * 100)
            if pct == last[0]:
                return
            last[0] = pct
            with contextlib.suppress(JobCanceled):
                self.fraction(fraction)

        return callback

    # ── checkpoints ──────────────────────────────────────────────────────────────────────────
    def commit(
        self,
        stage: str,
        mutate: Mutate | None = None,
        *,
        note: str | None = None,
        warnings: list[dict[str, str]] | None = None,
    ) -> None:
        """Apply ``mutate`` and record ``stage`` in ``analysis.stages_done`` in ONE transaction.

        Later stages are invalidated (their inputs just changed). ``note`` records a skipped stage
        as ``"<stage>: <reason>"`` instead of the bare stage name, so a plain ``reprocess`` retries
        it. ``warnings`` replaces this stage's entries in ``analysis.warnings``.
        """
        with session_scope() as db:
            asset = db.get(Asset, self.asset_id)
            if asset is None or asset.workspace_id != self.workspace_id:
                raise AssetGone
            if mutate is not None:
                mutate(db, asset)
            analysis = analysis_of(asset)
            done = invalidate_from(list(analysis.get("stages_done", [])), stage)
            done = [d for d in done if stage_of(d) != stage]
            done.append(note if note else stage)
            current = [w for w in analysis.get("warnings", []) if w.get("stage") != stage]
            update_analysis(asset, stages_done=done, warnings=current + (warnings or []))
        search_service.invalidate(self.workspace_id)
        self.job.progress(STAGE_PROGRESS[stage], stage)

    def update(self, mutate: Mutate) -> None:
        """Mutate the asset without recording a stage."""
        with session_scope() as db:
            asset = db.get(Asset, self.asset_id)
            if asset is None or asset.workspace_id != self.workspace_id:
                raise AssetGone
            mutate(db, asset)


def set_provenance(asset: Asset, stage: str, provenance: dict[str, Any] | None) -> None:
    """Record (or, with ``None``, clear) the provenance of a generated stage."""
    data = dict(analysis_of(asset).get("provenance") or {})
    if provenance is None:
        data.pop(stage, None)
    else:
        data[stage] = provenance
    update_analysis(asset, provenance=data)
