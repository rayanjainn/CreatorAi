"""Board use-cases: content items, ordering, stage rules, idea suggestions.

Plain Python (no FastAPI). LLM calls happen before the first write of a request so the request's
SQLite transaction never holds the writer lock while the gateway logs its own usage row.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from sqlalchemy.orm import Session

from app.errors import AppError
from app.llm import gateway as llm
from app.llm.schemas import ContentIdeasOutput
from app.models import ContentItem, IdeaSuggestion, Script, utcnow
from app.repositories.content import (
    STAGES,
    ContentItemRepository,
    IdeaRepository,
    ScriptRepository,
)
from app.repositories.profiles import ProfileRepository
from app.schemas.common import Provenance
from app.security import sign_media
from app.services import search_service, twin_events
from app.services.activity import log_activity

log = logging.getLogger(__name__)

PROGRESS_STEPS = 6  # plan, script, approved script, footage ready, clips, published


# ── cards and board ───────────────────────────────────────────────────────────────────────────
def build_cards(db: Session, workspace_id: str, items: list[ContentItem]) -> list[dict[str, Any]]:
    """Board cards for ``items`` using one aggregate query per kind (no N+1)."""
    repo = ContentItemRepository(db)
    ids = [i.id for i in items]
    assets = repo.asset_stats(workspace_id, ids)
    scripts = repo.script_flags(workspace_id, ids)
    plans = repo.with_outputs(workspace_id, ids, "plan")
    reviews = repo.with_outputs(workspace_id, ids, "review")
    clips = repo.clip_counts(workspace_id, ids)
    jobs = repo.running_jobs(workspace_id, ids)
    cards = []
    for item in items:
        a, s, c = assets[item.id], scripts.get(item.id), clips[item.id]
        has_script = bool(s and s["has_body"])
        approved = bool(s and s["approved"])
        done = [
            item.id in plans,
            has_script,
            approved,
            a["ready"] > 0,
            c["total"] > 0,
            item.stage == "published",
        ]
        types = sorted(set(jobs.get(item.id, [])))
        cards.append(
            {
                **_item_dict(item),
                "thumbnail_url": sign_media(a["thumb_key"]) if a["thumb_key"] else None,
                "progress": {
                    "assets_total": a["total"],
                    "assets_ready": a["ready"],
                    "has_plan": item.id in plans,
                    "has_review": item.id in reviews,
                    "has_script": has_script,
                    "script_version": s["version"] if s else None,
                    "script_approved": approved,
                    "clips_count": c["total"],
                    "clips_accepted": c["accepted"],
                    "percent": round(100 * sum(done) / PROGRESS_STEPS),
                },
                "running_jobs": {
                    "active": bool(jobs.get(item.id)),
                    "count": len(jobs.get(item.id, [])),
                    "types": types,
                },
            }
        )
    return cards


def _item_dict(item: ContentItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "title": item.title,
        "idea_text": item.idea_text,
        "objective": item.objective,
        "domain": item.domain,
        "stage": item.stage,
        "position": item.position,
        "target_duration_sec": item.target_duration_sec,
        "published_at": item.published_at,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def board(
    db: Session, workspace_id: str, q: str | None = None, domain: str | None = None
) -> dict[str, Any]:
    items = ContentItemRepository(db).board(workspace_id, q, domain)
    cards = {c["id"]: c for c in build_cards(db, workspace_id, items)}
    columns = []
    for stage in STAGES:
        column = [cards[i.id] for i in items if i.stage == stage]
        columns.append({"stage": stage, "count": len(column), "cards": column})
    return {"columns": columns, "total": len(items)}


def card(db: Session, workspace_id: str, item: ContentItem) -> dict[str, Any]:
    return build_cards(db, workspace_id, [item])[0]


# ── CRUD ──────────────────────────────────────────────────────────────────────────────────────
def create_item(db: Session, workspace_id: str, values: dict[str, Any]) -> ContentItem:
    repo = ContentItemRepository(db)
    stage = values.get("stage") or "idea"
    item = repo.add(
        workspace_id,
        title=values["title"].strip(),
        idea_text=values.get("idea_text") or "",
        objective=values.get("objective") or "",
        domain=values.get("domain"),
        target_duration_sec=values.get("target_duration_sec"),
        stage=stage,
        position=repo.next_position(workspace_id, stage),
        published_at=utcnow() if stage == "published" else None,
    )
    log_activity(db, workspace_id, "content_created", "content_item", item.id,
                 title=item.title, stage=item.stage)  # fmt: skip
    return item


def update_item(
    db: Session, workspace_id: str, item_id: str, changes: dict[str, Any]
) -> ContentItem:
    item = ContentItemRepository(db).require(workspace_id, item_id)
    changed = {k: v for k, v in changes.items() if getattr(item, k) != v}
    for key, value in changed.items():
        setattr(item, key, value)
    if changed:
        db.flush()
        log_activity(db, workspace_id, "content_updated", "content_item", item.id,
                     fields=sorted(changed))  # fmt: skip
    return item


def delete_item(db: Session, workspace_id: str, item_id: str, confirm: bool) -> dict[str, Any]:
    """Delete with confirmation: without ``confirm`` nothing happens and the cascade is reported.

    Scripts, beats, Director outputs, matches and clips go with the item; its assets are kept
    (unlinked) because footage lives in the library.
    """
    repo = ContentItemRepository(db)
    item = repo.require(workspace_id, item_id)
    cascade = repo.cascade_counts(workspace_id, item_id)
    if not confirm:
        raise AppError(
            "CONFIRMATION_REQUIRED",
            "Deleting this content item also deletes its scripts, plans, reviews, matches and "
            "clips (its assets stay in the library). Repeat with confirm=true to proceed.",
            details={"cascade": cascade},
        )
    stage, title = item.stage, item.title
    db.delete(item)
    db.flush()
    _renumber(repo.in_stage(workspace_id, stage))
    log_activity(db, workspace_id, "content_deleted", "content_item", item_id,
                 title=title, stage=stage, cascade=cascade)  # fmt: skip
    search_service.invalidate(workspace_id)
    return {"deleted": True, "id": item_id, "cascade": cascade}


# ── moving and stage rules ────────────────────────────────────────────────────────────────────
def _renumber(column: list[ContentItem]) -> None:
    for n, entry in enumerate(column):
        if entry.position != n:
            entry.position = n


def approve_current_script(
    db: Session, workspace_id: str, item: ContentItem, script: Script, via: str
) -> bool:
    """Mark ``script`` approved and fire the twin approval event (once). Returns True if new."""
    if (script.meta or {}).get("approval"):
        return False
    script.meta = {
        **(script.meta or {}),
        "approval": {"approved_at": utcnow(), "version": script.version, "via": via},
    }
    db.flush()
    log_activity(db, workspace_id, "script_approved", "script", script.id,
                 content_item_id=item.id, version=script.version, via=via)  # fmt: skip
    twin_events.emit(
        twin_events.SCRIPT_APPROVED,
        workspace_id,
        {
            "content_item_id": item.id,
            "script_id": script.id,
            "version": script.version,
            "title": item.title,
        },
        db=db,
    )
    return True


def move_item(
    db: Session,
    workspace_id: str,
    item_id: str,
    stage: str,
    position: int | None = None,
    via: str = "move",
) -> ContentItem:
    """Move an item to ``stage`` at ``position`` and normalise both columns to 0..n-1.

    Rules: entering ``shoot`` needs a current script with scenes (``NO_SCRIPT``) and approves it
    (twin ``script_approved`` event); entering ``published`` stamps ``published_at``; a change of
    stage is logged as ``stage_moved``.
    """
    if stage not in STAGES:
        raise AppError("VALIDATION_ERROR", f"Unknown stage {stage!r}", details={"stages": STAGES})
    repo = ContentItemRepository(db)
    item = repo.require(workspace_id, item_id)
    from_stage = item.stage
    approved_now = False
    if stage == "shoot":
        script = ScriptRepository(db).current(workspace_id, item.id)
        if script is None or not script.scenes:
            raise AppError(
                "NO_SCRIPT",
                "Write or generate a script before moving this item to Shoot.",
                details={"content_item_id": item.id},
            )
        approved_now = approve_current_script(db, workspace_id, item, script, via)

    target = [i for i in repo.in_stage(workspace_id, stage) if i.id != item.id]
    at = len(target) if position is None else max(0, min(position, len(target)))
    target.insert(at, item)
    item.stage = stage
    _renumber(target)
    if from_stage != stage:
        _renumber([i for i in repo.in_stage(workspace_id, from_stage) if i.id != item.id])
        if stage == "published" and not item.published_at:
            item.published_at = utcnow()
        log_activity(db, workspace_id, "stage_moved", "content_item", item.id,
                     title=item.title, **{"from": from_stage, "to": stage},
                     position=at, script_approved=approved_now)  # fmt: skip
    db.flush()
    return item


# ── ideas ─────────────────────────────────────────────────────────────────────────────────────
def idea_out(idea: IdeaSuggestion) -> dict[str, Any]:
    return {
        "id": idea.id,
        "title": idea.title,
        "rationale": idea.rationale,
        "source": idea.source,
        "status": idea.status,
        "created_at": idea.created_at,
        "provenance": idea.provenance,
    }


_NORM = re.compile(r"[^a-z0-9]+")


def normalise_title(title: str) -> str:
    return _NORM.sub(" ", title.lower().replace("[mock]", "")).strip()


def generate_ideas(db: Session, workspace_id: str, topic: str | None, count: int) -> dict[str, Any]:
    """``content.ideas`` -> ``idea_suggestions`` (source ``twin``; the table only allows
    ``insights`` and ``twin`` and ``twin`` is the creator-context-driven one).

    Titles that repeat an existing content item or idea (after normalisation) are skipped.
    """
    items, ideas = ContentItemRepository(db), IdeaRepository(db)
    recent = [*items.recent_titles(workspace_id), *ideas.recent_titles(workspace_id)]
    profile = ProfileRepository(db).get(workspace_id)
    out, meta = llm.run_with_meta(
        "content.ideas",
        {
            "topic": (topic or "").strip(),
            "count": count,
            "recent_titles": recent[:60],
            "domain": profile.domain,
        },
        ContentIdeasOutput,
        workspace_id,
        cache=False,  # a repeated click must be able to produce new ideas
    )
    provenance = meta.provenance
    seen = {normalise_title(t) for t in recent}
    rows: list[IdeaSuggestion] = []
    skipped = 0
    for idea in out.ideas:
        key = normalise_title(idea.title)
        if not key or key in seen:
            skipped += 1
            continue
        seen.add(key)
        rows.append(
            ideas.add(
                workspace_id,
                title=idea.title.strip()[:200],
                rationale=idea.rationale.strip(),
                source="twin",
                status="suggested",
                provenance=provenance.model_dump(),
            )
        )
    log_activity(db, workspace_id, "ideas_generated", "idea_suggestion", None,
                 count=len(rows), skipped=skipped, topic=topic or "",
                 provider=provenance.provider, source=provenance.source)  # fmt: skip
    return {
        "ideas": [idea_out(r) for r in rows],
        "skipped_duplicates": skipped,
        "provenance": provenance,
    }


def accept_idea(db: Session, workspace_id: str, idea_id: str) -> tuple[IdeaSuggestion, ContentItem]:
    repo = IdeaRepository(db)
    idea = repo.require(workspace_id, idea_id)
    if idea.status != "suggested":
        raise AppError("CONFLICT", f"Idea is already {idea.status}")
    domain = ProfileRepository(db).get(workspace_id).domain
    item = create_item(
        db,
        workspace_id,
        {"title": idea.title, "idea_text": idea.rationale, "domain": domain, "stage": "idea"},
    )
    idea.status = "accepted"
    db.flush()
    log_activity(db, workspace_id, "idea_accepted", "idea_suggestion", idea.id,
                 content_item_id=item.id)  # fmt: skip
    return idea, item


def dismiss_idea(db: Session, workspace_id: str, idea_id: str) -> IdeaSuggestion:
    idea = IdeaRepository(db).require(workspace_id, idea_id)
    if idea.status == "accepted":
        raise AppError("CONFLICT", "Idea was already accepted onto the board")
    if idea.status != "dismissed":
        idea.status = "dismissed"
        db.flush()
        log_activity(db, workspace_id, "idea_dismissed", "idea_suggestion", idea.id)
    return idea


def provenance_of(raw: dict[str, Any] | None) -> Provenance | None:
    return Provenance.model_validate(raw) if raw else None
