# ruff: noqa: E501
"""Research agent: web search, then a cited brief written by the LLM from those results only.

The citation rule is enforced in code: a brief may only cite URLs the search returned for this run;
anything else is dropped. If the search found results but the model cited none, the brief is rejected.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.integrations import websearch
from app.llm import gateway as llm
from app.llm.schemas import ResearchBriefOutput
from app.models import ContentItem
from app.models.research import ResearchBrief


def _norm(url: str) -> str:
    return url.strip().rstrip("/")


def restrict_sources(doc: dict[str, Any], results: list[dict[str, str]]) -> dict[str, Any]:
    allowed = {_norm(r["url"]): r["url"] for r in results}
    seen: set[str] = set()
    sources = []
    for s in doc.get("sources", []):
        key = _norm(s["url"])
        if key in allowed and key not in seen:
            seen.add(key)
            sources.append({"title": s["title"], "url": allowed[key]})
    return {**doc, "sources": sources}


def out(b: ResearchBrief) -> dict[str, Any]:
    return {
        "id": b.id,
        "topic": b.topic,
        "content_item_id": b.content_item_id,
        "doc": b.doc,
        "provenance": b.provenance,
        "created_at": b.created_at,
    }


def create(db: Session, ws: str, topic: str, content_item_id: str | None) -> dict[str, Any]:
    topic = topic.strip()
    if content_item_id:
        item = db.get(ContentItem, content_item_id)
        if item is None or item.workspace_id != ws:
            raise AppError("NOT_FOUND", "Project not found", status=404)
    results = websearch.get_search()(topic)
    if not results:
        raise AppError(
            "NO_RESULTS",
            "The web search found nothing for that topic. Try other words.",
            status=404,
        )
    brief, meta = llm.run_with_meta(
        "research.brief",
        {"topic": topic, "results": results},
        ResearchBriefOutput,
        ws,
        cache=False,
    )
    doc = restrict_sources(brief.model_dump(), results)
    if not doc["sources"]:
        raise AppError(
            "BAD_OUTPUT", "The brief cited no source from the search. Try again.", status=502
        )
    row = ResearchBrief(
        workspace_id=ws, content_item_id=content_item_id, topic=topic, doc=doc,
        results=results, provenance=meta.provenance.model_dump(),
    )  # fmt: skip
    db.add(row)
    db.flush()
    return out(row)


def list_briefs(db: Session, ws: str, content_item_id: str | None) -> list[dict[str, Any]]:
    q = select(ResearchBrief).where(ResearchBrief.workspace_id == ws)
    if content_item_id:
        q = q.where(ResearchBrief.content_item_id == content_item_id)
    return [out(b) for b in db.scalars(q.order_by(ResearchBrief.created_at.desc()).limit(30))]
