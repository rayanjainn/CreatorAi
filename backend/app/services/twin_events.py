"""Approval events for the Digital Twin (Plan.md section 8.11).

The content workflow *emits* events; the Twin feature *listens*. Nothing is registered by default,
so emitting is a no-op until the Twin agent subscribes::

    from app.services import twin_events
    # listener signature: (event, workspace_id, payload)
    twin_events.register(twin_events.SCRIPT_APPROVED, on_script_approved)
    twin_events.register("*", on_any_event)  # every event

Events and payloads:

``script_approved``: ``{"content_item_id", "script_id", "version", "title"}``, fired once per
script when its content item moves to ``shoot`` (or ``POST /scripts/{id}/approve``).

``emit(..., db=session)`` defers delivery until that session has **committed** (and drops it on
rollback), so a listener may open its own session and write without hitting SQLite's single writer
lock. Without ``db`` it delivers immediately. A failing listener is logged and never breaks the
request that caused the event.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

SCRIPT_APPROVED = "script_approved"

Listener = Callable[[str, str, dict[str, Any]], None]  # (event, workspace_id, payload)
_LISTENERS: dict[str, list[Listener]] = {}
_PENDING_KEY = "twin_events_pending"


def register(event_name: str, listener: Listener) -> None:
    """Call ``listener(event, workspace_id, payload)`` for ``event_name`` (``"*"`` = all events)."""
    listeners = _LISTENERS.setdefault(event_name, [])
    if listener not in listeners:
        listeners.append(listener)


def unregister(event_name: str, listener: Listener) -> None:
    if listener in _LISTENERS.get(event_name, []):
        _LISTENERS[event_name].remove(listener)


def clear() -> None:
    """Remove every listener (tests)."""
    _LISTENERS.clear()


def listeners_for(event_name: str) -> list[Listener]:
    return [*_LISTENERS.get(event_name, []), *_LISTENERS.get("*", [])]


def _deliver(event_name: str, workspace_id: str, payload: dict[str, Any]) -> None:
    for listener in listeners_for(event_name):
        try:
            listener(event_name, workspace_id, dict(payload))
        except Exception:
            log.exception("twin event listener %s failed for %s", listener, event_name)


def emit(
    event_name: str, workspace_id: str, payload: dict[str, Any], db: Session | None = None
) -> None:
    """Deliver an event to the registered listeners (after ``db`` commits when given)."""
    if db is None:
        _deliver(event_name, workspace_id, payload)
        return
    pending: list[tuple[str, str, dict[str, Any]]] | None = db.info.get(_PENDING_KEY)
    if pending is None:
        pending = db.info[_PENDING_KEY] = []

        @event.listens_for(db, "after_commit", once=True)
        def _flush(session: Session) -> None:
            items = session.info.pop(_PENDING_KEY, [])
            for name, ws, data in items:
                _deliver(name, ws, data)

        @event.listens_for(db, "after_rollback", once=True)
        def _drop(session: Session) -> None:
            session.info.pop(_PENDING_KEY, None)

    pending.append((event_name, workspace_id, payload))
