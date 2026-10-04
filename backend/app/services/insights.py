# ruff: noqa: E501
"""Creator intelligence: production patterns counted from the creator's own workspace.

Everything here is a count or an average over rows that exist; nothing is estimated or invented. Performance figures
(views, retention) need a YouTube connection and are not part of this report. The response says so (``performance``).
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ActivityLog, Asset, Clip, ContentItem, Render, Script
from app.models.base import utcnow

STAGES = ("idea", "script", "shoot", "edit", "publish", "published")
STALE_DAYS = 14


def _ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _week(dt: datetime) -> str:
    start = (dt - timedelta(days=dt.weekday())).date()
    return start.isoformat()


def _weeks(now: datetime, n: int) -> list[str]:
    monday = now - timedelta(days=now.weekday())
    return [(monday - timedelta(weeks=i)).date().isoformat() for i in range(n - 1, -1, -1)]


def production_report(db: Session, workspace_id: str, days: int = 90) -> dict[str, Any]:
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    weeks = _weeks(now, max(4, min(26, days // 7)))

    items = list(db.scalars(select(ContentItem).where(ContentItem.workspace_id == workspace_id)))
    assets = list(db.scalars(select(Asset).where(Asset.workspace_id == workspace_id)))
    clips = list(db.scalars(select(Clip).where(Clip.workspace_id == workspace_id)))
    renders = list(db.scalars(select(Render).where(Render.workspace_id == workspace_id)))
    scripts = list(
        db.scalars(
            select(Script).where(Script.workspace_id == workspace_id, Script.is_current.is_(True))
        )
    )
    activity = list(
        db.scalars(
            select(ActivityLog).where(
                ActivityLog.workspace_id == workspace_id,
                ActivityLog.created_at >= (now - timedelta(days=30)).isoformat(),
            )
        )
    )

    # ---- pipeline
    by_stage = dict.fromkeys(STAGES, 0)
    for it in items:
        by_stage[it.stage] = by_stage.get(it.stage, 0) + 1
    created = Counter(_week(d) for it in items if (d := _ts(it.created_at)) and d >= since)
    published = Counter(_week(d) for it in items if (d := _ts(it.published_at)) and d >= since)
    lead_days = [
        (p - c).total_seconds() / 86400
        for it in items
        if (p := _ts(it.published_at)) and (c := _ts(it.created_at))
    ]
    stale = []
    for it in items:
        if it.stage == "published":
            continue
        upd = _ts(it.updated_at)
        if upd and (now - upd).days >= STALE_DAYS:
            stale.append(
                {"id": it.id, "title": it.title, "stage": it.stage, "days": (now - upd).days}
            )
    stale.sort(key=lambda r: -r["days"])

    # ---- footage
    ready = [a for a in assets if a.status == "ready"]
    footage = {
        "assets": len(assets),
        "ready": len(ready),
        "hours": round(sum(a.duration_sec or 0 for a in assets if a.kind == "video") / 3600, 2),
        "gigabytes": round(sum(a.size_bytes for a in assets) / 1e9, 2),
        "by_kind": dict(Counter(a.kind for a in assets)),
        "failed": sum(1 for a in assets if a.status == "failed"),
    }

    # ---- clips
    decided = [c for c in clips if c.status in ("accepted", "rejected")]
    accepted = [c for c in clips if c.status == "accepted"]
    scores = [c.score for c in clips if c.score]
    buckets = Counter(min(int(s * 5), 4) for s in scores)  # 0-.2 ... .8-1
    clip_stats = {
        "total": len(clips),
        "by_status": dict(Counter(c.status for c in clips)),
        "by_kind": dict(Counter(c.kind for c in clips)),
        "accept_rate": round(len(accepted) / len(decided), 3) if len(decided) >= 3 else None,
        "avg_score": round(sum(scores) / len(scores), 3) if scores else None,
        "score_buckets": [
            {"from": i / 5, "to": (i + 1) / 5, "count": buckets.get(i, 0)} for i in range(5)
        ],
        "avg_length_sec": round(sum(c.end_sec - c.start_sec for c in clips) / len(clips), 1)
        if clips
        else None,
        "accepted_avg_length_sec": round(
            sum(c.end_sec - c.start_sec for c in accepted) / len(accepted), 1
        )
        if accepted
        else None,
    }

    # ---- scripts
    script_stats = {
        "count": len(scripts),
        "avg_length_sec": round(
            sum(s.length_sec for s in scripts if s.length_sec)
            / max(1, sum(1 for s in scripts if s.length_sec)),
            1,
        )
        if any(s.length_sec for s in scripts)
        else None,
        "by_platform": dict(Counter(s.platform for s in scripts if s.platform)),
        "by_tone": dict(Counter(s.tone for s in scripts if s.tone)),
    }

    # ---- renders
    done = [r for r in renders if r.status == "done"]
    render_stats = {
        "total": len(renders),
        "done": len(done),
        "failed": sum(1 for r in renders if r.status == "failed"),
        "by_preset": dict(Counter(r.preset for r in done)),
        "minutes": round(sum(r.duration_sec or 0 for r in done) / 60, 1),
    }

    # ---- activity (last 30 days, per day)
    per_day = Counter((d.date().isoformat()) for a in activity if (d := _ts(a.created_at)))
    last30 = [(now - timedelta(days=i)).date().isoformat() for i in range(29, -1, -1)]

    report = {
        "generated_at": utcnow(),
        "range_days": days,
        "basis": "Counted from your own projects, footage, clips and exports. Nothing here is estimated.",
        "provenance": {"source": "user", "provider": None, "model": None},
        "pipeline": {
            "total": len(items),
            "by_stage": by_stage,
            "weekly": [
                {"week": w, "created": created.get(w, 0), "published": published.get(w, 0)}
                for w in weeks
            ],
            "avg_days_to_publish": round(sum(lead_days) / len(lead_days), 1) if lead_days else None,
            "stale": stale[:5],
            "stale_days": STALE_DAYS,
        },
        "footage": footage,
        "clips": clip_stats,
        "scripts": script_stats,
        "renders": render_stats,
        "activity": [{"date": d, "count": per_day.get(d, 0)} for d in last30],
        "performance": {
            "available": False,
            "reason": "Views and retention need a YouTube connection, which is not set up. No performance numbers are shown rather than made-up ones.",
        },
    }
    report["nudges"] = nudges(report)
    return report


def nudges(r: dict[str, Any]) -> list[dict[str, str]]:
    """Plain rule-based suggestions from the counts above (each one names the numbers it used)."""
    out: list[dict[str, str]] = []
    p, c, f = r["pipeline"], r["clips"], r["footage"]
    if p["total"] == 0:
        out.append(
            {
                "kind": "start",
                "text": "Start with one idea: describe a video on the dashboard and it lands on your board.",
                "href": "/dashboard",
            }
        )
        return out
    if p["stale"]:
        top = p["stale"][0]
        out.append(
            {
                "kind": "stale",
                "text": f"“{top['title']}” has not moved for {top['days']} days (stage: {top['stage']}). Finish it or archive it.",
                "href": f"/projects/{top['id']}/plan",
            }
        )
    if p["by_stage"].get("idea", 0) >= 5:
        out.append(
            {
                "kind": "backlog",
                "text": f"{p['by_stage']['idea']} ideas are waiting. Pick the one you are most excited about and write its script.",
                "href": "/board",
            }
        )
    if f["assets"] == 0:
        out.append(
            {
                "kind": "footage",
                "text": "No footage yet. Upload a long video and Smart Clips can find the best short moments.",
                "href": "/assets",
            }
        )
    if c["by_status"].get("suggested", 0) >= 5:
        out.append(
            {
                "kind": "review",
                "text": f"{c['by_status']['suggested']} clips are waiting for your yes or no. Reviewing them trains nothing, but clears the queue.",
                "href": "/smart-clips",
            }
        )
    if (
        c["accept_rate"] is not None
        and c["accepted_avg_length_sec"]
        and c["avg_length_sec"]
        and c["accepted_avg_length_sec"] < c["avg_length_sec"] - 5
    ):
        out.append(
            {
                "kind": "length",
                "text": f"You accept shorter clips (about {c['accepted_avg_length_sec']:.0f}s) than the ones suggested (about {c['avg_length_sec']:.0f}s). Ask for shorter ones.",
                "href": "/smart-clips",
            }
        )
    if r["renders"]["failed"]:
        out.append(
            {
                "kind": "renders",
                "text": f"{r['renders']['failed']} exports failed. Open the clip and export again; the reason is on the Jobs page.",
                "href": "/jobs",
            }
        )
    return out
