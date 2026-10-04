# ruff: noqa: E501
"""Digital Twin: a style profile learned from approved scripts, memories of approved work, and a chat.

Everything the Twin says comes from a real LLM call (``twin.chat``); with no key configured the chat
returns ``LLM_NOT_CONFIGURED`` and nothing is made up. The Twin never changes your work by itself:
chat replies may carry *suggested actions*, applied one at a time with ``apply_action``.
Memories are written when a script is approved or a clip is accepted (``twin_events``).
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import session_scope
from app.errors import AppError
from app.llm import gateway as llm
from app.llm.schemas import ALLOWED_ACTION_TYPES, StyleExtractOutput, TwinChatOutput
from app.ml.embedder import embed_texts
from app.ml.vectors import pack_vector
from app.models import Clip, ContentItem, CreatorProfile, IdeaSuggestion, Script, TwinMemory
from app.models.twin import TwinMessage
from app.services import twin_events

log = logging.getLogger(__name__)
STYLE_EVERY = 3  # refresh the style profile after this many new approvals


def _profile(db: Session, ws: str) -> CreatorProfile:
    p = db.get(CreatorProfile, ws)
    if p is None:
        raise AppError("NOT_FOUND", "No creator profile", status=404)
    return p


def overview(db: Session, ws: str) -> dict[str, Any]:
    p = _profile(db, ws)
    mem = list(
        db.scalars(
            select(TwinMemory)
            .where(TwinMemory.workspace_id == ws)
            .order_by(TwinMemory.created_at.desc())
        )
    )
    return {
        "style": p.style_profile or {},
        "style_revision": p.style_profile_rev,
        "approvals_since_update": p.approvals_since_style_update,
        "update_every": STYLE_EVERY,
        "memory_count": len(mem),
        "memories": [
            {"id": m.id, "kind": m.kind, "text": m.text[:240], "created_at": m.created_at}
            for m in mem[:30]
        ],
    }


def history(db: Session, ws: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = list(
        db.scalars(
            select(TwinMessage)
            .where(TwinMessage.workspace_id == ws)
            .order_by(TwinMessage.created_at.desc(), TwinMessage.id.desc())
            .limit(limit)
        )
    )[::-1]
    return [_msg(m) for m in rows]


def _msg(m: TwinMessage) -> dict[str, Any]:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "actions": m.actions or [],
        "provenance": (m.context or {}).get("provenance"),
        "created_at": m.created_at,
    }


def _scope(db: Session, ws: str, item_id: str | None, clip_id: str | None) -> dict[str, Any]:
    scope: dict[str, Any] = {}
    item = db.get(ContentItem, item_id) if item_id else None
    clip = db.get(Clip, clip_id) if clip_id else None
    if clip and clip.workspace_id == ws:
        item = item or db.get(ContentItem, clip.content_item_id)
        scope["clip_id"] = clip.id
        scope["clip"] = {
            "id": clip.id, "title": clip.title, "hook": clip.hook, "status": clip.status,
            "length_sec": round(clip.end_sec - clip.start_sec, 1),
        }  # fmt: skip
    if item and item.workspace_id == ws:
        scope["content_item_id"] = item.id
        scope["content_item"] = {"id": item.id, "title": item.title, "stage": item.stage}
    return scope


def chat(
    db: Session,
    ws: str,
    message: str,
    content_item_id: str | None = None,
    clip_id: str | None = None,
) -> dict[str, Any]:
    p = _profile(db, ws)
    scope = _scope(db, ws, content_item_id, clip_id)
    out, meta = llm.run_with_meta(
        "twin.chat",
        {
            "message": message,
            "scope": scope,
            "style_summary": (p.style_profile or {}).get("summary", "not learned yet"),
            "memories": "see creator context",
            "allowed_actions": list(ALLOWED_ACTION_TYPES),
        },
        TwinChatOutput,
        ws,
        cache=False,
    )
    prov = meta.provenance.model_dump()
    actions = [a.model_dump() for a in out.actions][:1]
    db.add(TwinMessage(workspace_id=ws, role="user", content=message, context=scope))
    reply = TwinMessage(
        workspace_id=ws, role="assistant", content=out.reply, actions=actions,
        context={"provenance": prov, **scope},
    )  # fmt: skip
    db.add(reply)
    db.flush()
    return _msg(reply)


def clear_history(db: Session, ws: str) -> None:
    for m in db.scalars(select(TwinMessage).where(TwinMessage.workspace_id == ws)):
        db.delete(m)


def apply_action(db: Session, ws: str, message_id: str, index: int = 0) -> dict[str, Any]:
    """Apply one suggested action. Only actions the server can do on its own run here; editor
    actions are returned as ``open_editor`` so the person does them with the editor's own tools."""
    m = db.get(TwinMessage, message_id)
    if m is None or m.workspace_id != ws or index >= len(m.actions or []):
        raise AppError("NOT_FOUND", "That suggestion no longer exists", status=404)
    action = m.actions[index]
    kind, params = action.get("type"), action.get("params") or {}
    if kind == "create_idea":
        title = str(params.get("title") or params.get("idea") or "").strip()
        if not title:
            raise AppError("VALIDATION_ERROR", "The suggestion has no idea title", status=422)
        db.add(
            IdeaSuggestion(
                workspace_id=ws, title=title[:200], rationale=str(params.get("rationale", "")),
                source="twin", status="suggested", provenance=(m.context or {}).get("provenance"),
            )
        )  # fmt: skip
        db.flush()
        return {"applied": True, "kind": kind, "message": f"Added “{title[:80]}” to your ideas."}
    return {
        "applied": False,
        "kind": kind,
        "open_editor": True,
        "clip_id": action.get("clip_id"),
        "content_item_id": action.get("content_item_id"),
        "message": "Do this one in the editor so you can see the result before keeping it.",
    }


def update_style(db: Session, ws: str) -> dict[str, Any]:
    """Re-learn the style profile from the creator's approved (current) scripts."""
    p = _profile(db, ws)
    rows = list(
        db.scalars(
            select(Script)
            .join(ContentItem, ContentItem.id == Script.content_item_id)
            .where(
                Script.workspace_id == ws, Script.is_current.is_(True),
                ContentItem.stage.in_(("shoot", "edit", "publish", "published")),
            )
            .order_by(Script.created_at.desc())
            .limit(6)
        )
    )  # fmt: skip
    if not rows:
        raise AppError(
            "NOTHING_TO_LEARN",
            "Approve a script first (move a project with a script to Shoot): the Twin learns from approved scripts.",
            status=409,
        )
    out, meta = llm.run_with_meta(
        "twin.style_extract",
        {
            "current_summary": (p.style_profile or {}).get("summary", ""),
            "scripts": [r.body_md[:1200] for r in rows],
        },
        StyleExtractOutput,
        ws,
        cache=False,
    )
    p.style_profile = {**out.model_dump(), "provenance": meta.provenance.model_dump()}
    p.style_profile_rev += 1
    p.approvals_since_style_update = 0
    db.flush()
    return overview(db, ws)


def remember(ws: str, kind: str, text: str, source_id: str | None) -> None:
    text = text.strip()
    if not text:
        return
    with session_scope() as db:
        if source_id and db.scalar(
            select(TwinMemory.id).where(TwinMemory.workspace_id == ws, TwinMemory.kind == kind,
                                         TwinMemory.source_id == source_id)
        ):  # fmt: skip
            return
        vec = embed_texts([text])[0]
        db.add(TwinMemory(workspace_id=ws, kind=kind, text=text[:4000], source_id=source_id,
                          embedding=pack_vector(vec)))  # fmt: skip
        p = db.get(CreatorProfile, ws)
        if p is not None:
            p.approvals_since_style_update += 1


def _on_event(event: str, ws: str, payload: dict[str, Any]) -> None:
    if event == twin_events.SCRIPT_APPROVED:
        with session_scope() as db:
            s = db.get(Script, payload["script_id"])
            body = s.body_md if s else ""
        remember(ws, "approved_script", f"{payload.get('title', '')}\n{body}", payload["script_id"])
    elif event == twin_events.CLIP_ACCEPTED:
        with session_scope() as db:
            c = db.get(Clip, payload["clip_id"])
            text = f"{c.title}. {c.hook}. {c.caption}" if c else ""
        remember(ws, "approved_clip", text, payload["clip_id"])


def register_listeners() -> None:
    twin_events.register(twin_events.SCRIPT_APPROVED, _on_event)
    twin_events.register(twin_events.CLIP_ACCEPTED, _on_event)
