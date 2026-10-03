from __future__ import annotations

import json
import threading
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import session_scope
from app.models import Job
from app.workers.pubsub import pubsub
from app.workers.runner import (
    JobCanceled,
    JobContext,
    enqueue,
    get_runner,
    mark_interrupted_jobs,
    register_job,
)


def get_job(job_id: str) -> Job:
    with session_scope() as db:
        job = db.get(Job, job_id)
        assert job is not None
        return job


def wait_for(job_id: str, *statuses: str, timeout: float = 10.0) -> Job:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = get_job(job_id)
        if job.status in statuses:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} stuck in {get_job(job_id).status}")


def sse_events(client: TestClient, job_id: str, headers: dict[str, str]) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    with client.stream("GET", f"/api/v1/jobs/{job_id}/events", headers=headers) as res:
        assert res.headers["content-type"].startswith("text/event-stream")
        event = ""
        for line in res.iter_lines():
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                out.append((event, json.loads(line.split(":", 1)[1])))
    return out


def test_inline_job_success_persists_progress_and_result(workspace_id: str) -> None:
    seen: list[tuple[int, str]] = []

    def handler(ctx: JobContext) -> dict[str, Any]:
        seen.append((ctx.attempt, ctx.payload["name"]))
        ctx.progress(30, "probe", "halfway")
        ctx.progress(120, "finalize")  # clamped
        return {"ok": True}

    register_job("asset.process", handler)
    job_id = enqueue("asset.process", "asset", "a1", {"name": "demo"}, workspace_id=workspace_id)
    job = get_job(job_id)
    assert job.status == "succeeded" and job.progress == 100 and job.result == {"ok": True}
    assert job.started_at and job.finished_at and job.entity_id == "a1"
    assert seen == [(1, "demo")]
    last = pubsub.last_event(job_id)
    assert last and last["status"] == "succeeded" and last["result"] == {"ok": True}


def test_inline_failure_records_error_without_raising(workspace_id: str) -> None:
    def boom(ctx: JobContext) -> None:
        raise RuntimeError("kaput")

    job_id = get_runner().submit("x.fail", "io", boom, workspace_id, "thing", None)
    job = get_job(job_id)
    assert job.status == "failed" and job.error == "kaput"


def test_threaded_runner_progress_events_in_order(workspace_id: str) -> None:
    get_settings().jobs_inline = False
    gate = threading.Event()

    def handler(ctx: JobContext) -> dict[str, Any]:
        sub_ready.wait(5)
        for pct, stage in [(10, "probe"), (60, "transcribe"), (90, "embed")]:
            ctx.progress(pct, stage, f"at {stage}")
        gate.set()
        return {"asset_id": ctx.entity_id}

    sub_ready = threading.Event()
    register_job("asset.process", handler)
    job_id = enqueue("asset.process", "asset", "a9", workspace_id=workspace_id)
    sub = pubsub.subscribe(job_id)
    sub_ready.set()
    events = []
    deadline = time.time() + 10
    while time.time() < deadline:
        event = sub.get(timeout=0.5)
        if event is None:
            continue
        events.append(event)
        if event["status"] == "succeeded":
            break
    sub.close()
    stages = [e["stage"] for e in events if e["status"] == "running"]
    assert stages[-3:] == ["probe", "transcribe", "embed"] or {
        "probe",
        "transcribe",
        "embed",
    } <= set(stages)
    progress = [e["progress"] for e in events]
    assert progress == sorted(progress) and progress[-1] == 100
    assert events[-1]["result"] == {"asset_id": "a9"}
    assert any(e["message"] == "at transcribe" for e in events)


def test_cancel_running_job(client: TestClient, auth: dict[str, str], workspace_id: str) -> None:
    get_settings().jobs_inline = False
    started = threading.Event()

    def handler(ctx: JobContext) -> None:
        started.set()
        for _ in range(500):
            ctx.check_cancel()
            time.sleep(0.01)

    register_job("render.run", handler)
    job_id = enqueue("render.run", "render", "r1", workspace_id=workspace_id)
    assert started.wait(5)
    res = client.post(f"/api/v1/jobs/{job_id}/cancel", headers=auth)
    assert res.status_code == 200
    job = wait_for(job_id, "canceled")
    assert job.error is None
    again = client.post(f"/api/v1/jobs/{job_id}/cancel", headers=auth)
    assert again.status_code == 409 and again.json()["error"]["code"] == "JOB_NOT_CANCELABLE"


def test_cancel_via_exception_marks_canceled(workspace_id: str) -> None:
    def handler(ctx: JobContext) -> None:
        raise JobCanceled()

    job_id = get_runner().submit("x.cancel", "media", handler, workspace_id, "t", None)
    assert get_job(job_id).status == "canceled"


def test_automatic_retry_then_success(workspace_id: str) -> None:
    settings = get_settings()
    settings.job_max_retries = 2
    attempts: list[int] = []

    def flaky(ctx: JobContext) -> dict[str, Any]:
        attempts.append(ctx.attempt)
        if ctx.attempt < 3:
            raise RuntimeError(f"try {ctx.attempt}")
        return {"attempts": ctx.attempt}

    job_id = get_runner().submit("x.flaky", "io", flaky, workspace_id, "t", None)
    job = get_job(job_id)
    assert attempts == [1, 2, 3] and job.status == "succeeded" and job.attempts == 3


def test_retries_exhausted_fails(workspace_id: str) -> None:
    get_settings().job_max_retries = 1
    calls: list[int] = []

    def bad(ctx: JobContext) -> None:
        calls.append(ctx.attempt)
        raise ValueError("nope")

    job = get_job(get_runner().submit("x.bad", "io", bad, workspace_id, "t", None))
    assert calls == [1, 2] and job.status == "failed" and job.error == "nope"


def test_threaded_retry_uses_backoff_timer(workspace_id: str) -> None:
    settings = get_settings()
    settings.jobs_inline = False
    settings.job_max_retries = 2
    settings.job_retry_backoff = "0.05,0.05"
    stamps: list[float] = []

    def flaky(ctx: JobContext) -> None:
        stamps.append(time.time())
        if ctx.attempt == 1:
            raise RuntimeError("first")

    try:
        job_id = get_runner().submit("x.t", "llm", flaky, workspace_id, "t", None)
        assert wait_for(job_id, "succeeded").attempts == 2
        assert stamps[1] - stamps[0] >= 0.04
    finally:
        settings.job_retry_backoff = "0,0"


def test_retry_endpoint_for_failed_job(
    client: TestClient, auth: dict[str, str], workspace_id: str
) -> None:
    state = {"fail": True}

    def handler(ctx: JobContext) -> dict[str, Any]:
        if state["fail"]:
            raise RuntimeError("down")
        return {"payload": ctx.payload}

    register_job("analytics.sync", handler)
    job_id = enqueue("analytics.sync", "workspace", None, {"days": 7}, workspace_id=workspace_id)
    assert get_job(job_id).status == "failed"
    state["fail"] = False
    res = client.post(f"/api/v1/jobs/{job_id}/retry", headers=auth)
    assert res.status_code == 200
    job = get_job(job_id)
    assert job.status == "succeeded" and job.result == {"payload": {"days": 7}}
    assert client.post(f"/api/v1/jobs/{job_id}/retry", headers=auth).json()["error"]["code"] == (
        "JOB_NOT_RETRYABLE"
    )


def test_interrupted_jobs_marked_failed_on_boot(workspace_id: str) -> None:
    with session_scope() as db:
        for status in ("queued", "running", "succeeded"):
            db.add(Job(workspace_id=workspace_id, type="t", entity_type="e", status=status))
    assert mark_interrupted_jobs() == 2
    with session_scope() as db:
        rows = db.query(Job).order_by(Job.status).all()
    assert sorted(r.status for r in rows) == ["failed", "failed", "succeeded"]
    assert {r.error for r in rows if r.status == "failed"} == {"interrupted by restart"}


def test_list_and_get_are_workspace_scoped(
    client: TestClient, auth: dict[str, str], workspace_id: str
) -> None:
    register_job("twin.update", lambda ctx: {"done": 1})
    first = enqueue("twin.update", "workspace", workspace_id, workspace_id=workspace_id)
    with session_scope() as db:
        from app.models import User, Workspace

        user = User(email="o@x.io", password_hash="x")
        db.add(user)
        db.flush()
        other = Workspace(owner_id=user.id)
        db.add(other)
        db.flush()
        foreign = Job(workspace_id=other.id, type="t", entity_type="e")
        db.add(foreign)
        db.flush()
        foreign_id = foreign.id
    listed = client.get("/api/v1/jobs", headers=auth).json()
    assert [j["id"] for j in listed] == [first]
    assert client.get("/api/v1/jobs?status=failed", headers=auth).json() == []
    assert client.get(f"/api/v1/jobs/{first}", headers=auth).json()["status"] == "succeeded"
    assert client.get(f"/api/v1/jobs/{foreign_id}", headers=auth).status_code == 404
    assert client.get(f"/api/v1/jobs/{foreign_id}/events", headers=auth).status_code == 404
    assert client.post(f"/api/v1/jobs/{foreign_id}/cancel", headers=auth).status_code == 404
    assert client.get("/api/v1/jobs").status_code == 401


def test_sse_streams_progress_then_done(
    client: TestClient, auth: dict[str, str], workspace_id: str
) -> None:
    def handler(ctx: JobContext) -> dict[str, Any]:
        ctx.progress(50, "half")
        return {"r": 1}

    register_job("project.match", handler)
    job_id = enqueue("project.match", "content_item", "c1", workspace_id=workspace_id)
    events = sse_events(client, job_id, auth)
    assert events[-1][0] == "done"
    assert events[-1][1]["status"] == "succeeded" and events[-1][1]["result"] == {"r": 1}
    assert events[-1][1]["job_id"] == job_id and events[-1][1]["type"] == "project.match"


def test_sse_live_updates_from_running_job(
    client: TestClient, auth: dict[str, str], workspace_id: str
) -> None:
    get_settings().jobs_inline = False
    release = threading.Event()

    def handler(ctx: JobContext) -> dict[str, Any]:
        ctx.progress(40, "working", "step 1")
        release.wait(5)
        ctx.progress(80, "finishing")
        return {"fin": True}

    register_job("clips.generate", handler)
    job_id = enqueue("clips.generate", "content_item", "c2", workspace_id=workspace_id)
    wait_for(job_id, "running")
    threading.Timer(0.3, release.set).start()
    events = sse_events(client, job_id, auth)
    stages = [e["stage"] for kind, e in events if kind == "progress"]
    assert "working" in stages and events[-1][0] == "done"
    assert events[-1][1]["progress"] == 100


@pytest.mark.parametrize("queue", ["media", "llm", "io"])
def test_named_pools_exist(queue: str) -> None:
    assert queue in get_runner()._pools


def test_non_retryable_error_is_not_retried(workspace_id: str) -> None:
    from app.errors import AppError

    get_settings().job_max_retries = 2
    calls: list[int] = []

    def handler(ctx: JobContext) -> dict[str, object]:
        calls.append(ctx.attempt)
        raise AppError("ASR_UNAVAILABLE", "no asr", retryable=False)

    register_job("twin.update", handler)
    job_id = enqueue("twin.update", "workspace", None, {}, workspace_id=workspace_id)
    assert get_job(job_id).status == "failed"
    assert calls == [1]
