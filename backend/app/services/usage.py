"""AI usage report: what the LLM gateway logged in ``llm_usage`` for this workspace.

Counts and sums only. Token numbers are what each provider reported; providers that report none
count as 0, which the report says rather than estimating them.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LlmUsage


def _bucket() -> dict[str, Any]:
    return {"calls": 0, "ok": 0, "errors": 0, "invalid": 0, "cache_hits": 0, "tokens_in": 0,
            "tokens_out": 0, "latency_ms": 0}  # fmt: skip


def _add(b: dict[str, Any], row: LlmUsage) -> None:
    b["calls"] += 1
    b["cache_hits"] += int(bool(row.cache_hit))
    b["tokens_in"] += row.tokens_in or 0
    b["tokens_out"] += row.tokens_out or 0
    key = row.status if row.status in ("ok", "invalid") else "errors"
    b[key] += 1
    if not row.cache_hit and row.status == "ok":
        b["latency_ms"] += row.latency_ms or 0


def _finish(b: dict[str, Any]) -> dict[str, Any]:
    live = b["ok"] - b["cache_hits"]
    return {
        **{k: v for k, v in b.items() if k != "latency_ms"},
        "avg_latency_ms": round(b["latency_ms"] / live) if live > 0 else None,
    }


def report(db: Session, ws: str, days: int = 30) -> dict[str, Any]:
    since = (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = list(
        db.scalars(
            select(LlmUsage).where(LlmUsage.workspace_id == ws, LlmUsage.created_at >= since)
        )
    )
    total = _bucket()
    by_provider: dict[str, dict[str, Any]] = defaultdict(_bucket)
    by_task: dict[str, dict[str, Any]] = defaultdict(_bucket)
    by_day: dict[str, int] = defaultdict(int)
    for r in rows:
        _add(total, r)
        _add(by_provider[f"{r.provider} · {r.model}"], r)
        _add(by_task[r.task], r)
        by_day[r.created_at[:10]] += 1
    today = datetime.now(UTC).date()
    return {
        "days": days,
        "total": _finish(total),
        "by_provider": sorted(
            ({"name": k, **_finish(v)} for k, v in by_provider.items()), key=lambda x: -x["calls"]
        ),
        "by_task": sorted(
            ({"task": k, **_finish(v)} for k, v in by_task.items()), key=lambda x: -x["calls"]
        ),
        "by_day": [
            {"date": (d := (today - timedelta(days=n)).isoformat()), "calls": by_day.get(d, 0)}
            for n in range(min(days, 30) - 1, -1, -1)
        ],
        "note": (
            "Token counts are what each provider reported. Mock calls are included and "
            "labelled by provider."
        ),
    }
