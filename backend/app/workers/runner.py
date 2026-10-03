"""In-process job runner: three thread pools, a ``jobs`` table and a handler registry.

Handlers are plain functions ``fn(ctx: JobContext) -> dict | None``. Register one with
``register_job("asset.process", handler)`` and start it with ``enqueue(...)``.
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.db import get_session_factory, session_scope
from app.errors import AppError
from app.models import Job, utcnow
from app.workers.events import job_event
from app.workers.pubsub import pubsub

log = logging.getLogger(__name__)

QUEUES = ("media", "llm", "io")
JobHandler = Callable[["JobContext"], "dict[str, Any] | None"]

# Queue per job type from Plan.md section 3.3; unknown types default to ``media``.
DEFAULT_QUEUES: dict[str, str] = {
    "asset.process": "media",
    "project.match": "media",
    "clips.generate": "media",
    "render.run": "media",
    "publish.upload": "io",
    "analytics.sync": "io",
    "twin.update": "llm",
}

JOB_HANDLERS: dict[str, JobHandler] = {}
JOB_QUEUES: dict[str, str] = {}


class JobCanceled(Exception):
    """Raised by ``JobContext.check_cancel`` when the user canceled the job."""


class JobContext:
    """Handed to every handler: progress reporting, cancel checks, payload and result."""

    def __init__(
        self,
        job_id: str,
        job_type: str,
        workspace_id: str,
        entity_type: str,
        entity_id: str | None,
        payload: dict[str, Any],
        cancel_event: threading.Event,
        attempt: int,
    ) -> None:
        self.job_id = job_id
        self.type = job_type
        self.workspace_id = workspace_id
        self.entity_type = entity_type
        self.entity_id = entity_id
        self.payload = payload
        self.attempt = attempt
        self.result: dict[str, Any] = {}
        self._cancel = cancel_event

    @property
    def session_factory(self) -> sessionmaker[Session]:
        """Own DB sessions (never share across threads): ``with ctx.session_factory() as db``."""
        return get_session_factory()

    def check_cancel(self) -> None:
        if self._cancel.is_set():
            raise JobCanceled()

    def progress(self, pct: int | float, stage: str, message: str | None = None) -> None:
        """Persist and broadcast progress (0-100). Also a cancellation checkpoint."""
        self.check_cancel()
        value = max(0, min(100, int(pct)))
        job = _update_job(self.job_id, progress=value, stage=stage)
        if job is not None:
            pubsub.publish(self.job_id, job_event(job, message))


def register_job(job_type: str, handler: JobHandler, queue: str | None = None) -> None:
    """Register the handler for ``job_type`` on ``queue`` (default from Plan.md section 3.3)."""
    chosen = queue or DEFAULT_QUEUES.get(job_type, "media")
    if chosen not in QUEUES:
        raise ValueError(f"unknown queue {chosen!r}; expected one of {QUEUES}")
    JOB_HANDLERS[job_type] = handler
    JOB_QUEUES[job_type] = chosen


def enqueue(
    job_type: str,
    entity_type: str,
    entity_id: str | None,
    payload: dict[str, Any] | None = None,
    *,
    workspace_id: str,
) -> str:
    """Create and start a job of a registered type; returns the job id."""
    handler = JOB_HANDLERS.get(job_type)
    if handler is None:
        raise AppError("INTERNAL_ERROR", f"No handler registered for job type {job_type!r}")
    return get_runner().submit(
        job_type,
        JOB_QUEUES[job_type],
        handler,
        workspace_id,
        entity_type,
        entity_id,
        **(payload or {}),
    )


def _get_job(job_id: str) -> Job | None:
    with session_scope() as db:
        return db.get(Job, job_id)


def _update_job(job_id: str, **values: Any) -> Job | None:
    with session_scope() as db:
        db.execute(update(Job).where(Job.id == job_id).values(**values))
        return db.get(Job, job_id)


class JobRunner:
    """Owns the named thread pools and drives each job through its status transitions."""

    def __init__(self) -> None:
        settings = get_settings()
        sizes = {
            "media": settings.job_pool_media,
            "llm": settings.job_pool_llm,
            "io": settings.job_pool_io,
        }
        self._pools = {
            name: ThreadPoolExecutor(max_workers=size, thread_name_prefix=f"job-{name}")
            for name, size in sizes.items()
        }
        self._cancel: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        self._timers: set[threading.Timer] = set()

    # -- public API -------------------------------------------------------------------------
    def submit(
        self,
        job_type: str,
        queue: str,
        fn: JobHandler,
        workspace_id: str,
        entity_type: str,
        entity_id: str | None,
        **kwargs: Any,
    ) -> str:
        """Create the ``jobs`` row and run ``fn(JobContext)`` on ``queue`` (inline in tests)."""
        if queue not in self._pools:
            raise ValueError(f"unknown queue {queue!r}")
        job = Job(
            workspace_id=workspace_id,
            type=job_type,
            entity_type=entity_type,
            entity_id=entity_id,
            payload=json.loads(json.dumps(kwargs, default=str)),
        )
        with session_scope() as db:
            db.add(job)
            db.flush()
            job_id = job.id
            snapshot = job_event(job)
        pubsub.publish(job_id, snapshot)
        self.start(job_id, queue, fn)
        return job_id

    def start(self, job_id: str, queue: str, fn: JobHandler) -> None:
        """Run an existing job row (used by ``submit`` and retries)."""
        with self._lock:
            self._cancel.setdefault(job_id, threading.Event())
        if get_settings().jobs_inline:
            self._execute(job_id, queue, fn)
        else:
            self._pools[queue].submit(self._execute, job_id, queue, fn)

    def request_cancel(self, job_id: str) -> None:
        with self._lock:
            self._cancel.setdefault(job_id, threading.Event()).set()

    def retry(self, job_id: str) -> None:
        """Reset a failed job and run it again with its stored payload."""
        job = _get_job(job_id)
        handler = JOB_HANDLERS.get(job.type) if job else None
        if job is None or handler is None:
            raise AppError("JOB_NOT_RETRYABLE", "No handler is registered for this job type")
        with self._lock:
            self._cancel[job_id] = threading.Event()
        reset = _update_job(
            job_id, status="queued", progress=0, stage="", error=None, attempts=0,
            result={}, started_at=None, finished_at=None,
        )  # fmt: skip
        if reset is not None:
            pubsub.publish(job_id, job_event(reset))
        self.start(job_id, JOB_QUEUES[job.type], handler)

    def shutdown(self) -> None:
        for timer in list(self._timers):
            timer.cancel()
        for pool in self._pools.values():
            pool.shutdown(wait=False, cancel_futures=True)

    # -- execution --------------------------------------------------------------------------
    def _execute(self, job_id: str, queue: str, fn: JobHandler) -> None:
        settings = get_settings()
        cancel = self._cancel.setdefault(job_id, threading.Event())
        while True:
            row = _get_job(job_id)
            if row is None:
                return
            if cancel.is_set():
                self._finish(job_id, "canceled", stage="canceled")
                return
            attempt = row.attempts + 1
            started = row.started_at or utcnow()
            running = _update_job(
                job_id, status="running", attempts=attempt, started_at=started, error=None
            )
            if running is not None:
                pubsub.publish(job_id, job_event(running))
            ctx = JobContext(
                job_id, row.type, row.workspace_id, row.entity_type, row.entity_id,
                dict(row.payload or {}), cancel, attempt,
            )  # fmt: skip
            try:
                returned = fn(ctx)
                ctx.result.update(returned or {})
                self._finish(job_id, "succeeded", result=ctx.result)
                return
            except JobCanceled:
                self._finish(job_id, "canceled", stage="canceled")
                return
            except Exception as exc:
                message = str(exc) or exc.__class__.__name__
                retries_left = attempt <= settings.job_max_retries and getattr(
                    exc, "retryable", True
                )
                if not retries_left or cancel.is_set():
                    log.exception("job %s (%s) failed", job_id, row.type)
                    self._finish(job_id, "failed", error=message)
                    return
                delay = 0.0 if settings.jobs_inline else self._backoff(attempt)
                log.warning(
                    "job %s failed (attempt %s), retrying in %ss: %s",
                    job_id,
                    attempt,
                    delay,
                    message,
                )
                queued = _update_job(
                    job_id, status="queued", error=message, stage=f"retrying in {delay:g}s"
                )
                if queued is not None:
                    pubsub.publish(job_id, job_event(queued, message))
                if settings.jobs_inline:
                    continue
                if delay <= 0:
                    self._pools[queue].submit(self._execute, job_id, queue, fn)
                else:
                    self._schedule_retry(delay, job_id, queue, fn)
                return

    @staticmethod
    def _backoff(attempt: int) -> float:
        steps = get_settings().retry_backoff_list
        if not steps:
            return 0.0
        return steps[min(attempt - 1, len(steps) - 1)]

    def _schedule_retry(self, delay: float, job_id: str, queue: str, fn: JobHandler) -> None:
        def fire() -> None:
            self._timers.discard(timer)
            self._pools[queue].submit(self._execute, job_id, queue, fn)

        timer = threading.Timer(delay, fire)
        timer.daemon = True
        self._timers.add(timer)
        timer.start()

    def _finish(
        self,
        job_id: str,
        status: str,
        *,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        stage: str | None = None,
    ) -> None:
        values: dict[str, Any] = {"status": status, "finished_at": utcnow(), "error": error}
        if result is not None:
            values["result"] = result
        if status == "succeeded":
            values["progress"] = 100
            values["stage"] = stage or "done"
        elif stage:
            values["stage"] = stage
        job = _update_job(job_id, **values)
        if job is not None:
            pubsub.publish(job_id, job_event(job))
        with self._lock:
            self._cancel.pop(job_id, None)


def mark_interrupted_jobs() -> int:
    """On boot: jobs left ``queued``/``running`` by a previous process become retryable failures."""
    with session_scope() as db:
        result = db.execute(
            update(Job)
            .where(Job.status.in_(("queued", "running")))
            .values(status="failed", error="interrupted by restart", finished_at=utcnow())
        )
        return int(result.rowcount or 0)  # type: ignore[attr-defined]


_runner: JobRunner | None = None
_runner_lock = threading.Lock()


def get_runner() -> JobRunner:
    global _runner
    with _runner_lock:
        if _runner is None:
            _runner = JobRunner()
        return _runner


def shutdown_runner() -> None:
    global _runner
    with _runner_lock:
        if _runner is not None:
            _runner.shutdown()
        _runner = None
