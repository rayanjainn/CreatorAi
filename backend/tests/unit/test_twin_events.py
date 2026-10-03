from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import text

from app.db import get_session_factory
from app.services import twin_events


@pytest.fixture(autouse=True)
def _clean() -> Any:
    twin_events.clear()
    yield
    twin_events.clear()


def test_emit_without_listeners_is_a_noop() -> None:
    twin_events.emit(twin_events.SCRIPT_APPROVED, "ws", {"x": 1})


def test_listeners_receive_events_and_wildcards() -> None:
    seen: list[tuple[str, str, dict[str, Any]]] = []
    twin_events.register("script_approved", lambda e, w, p: seen.append((e, w, p)))
    twin_events.register("*", lambda e, w, p: seen.append(("*" + e, w, p)))
    twin_events.emit("script_approved", "ws1", {"a": 1})
    twin_events.emit("other", "ws1", {"b": 2})
    assert seen == [
        ("script_approved", "ws1", {"a": 1}),
        ("*script_approved", "ws1", {"a": 1}),
        ("*other", "ws1", {"b": 2}),
    ]


def test_failing_listener_does_not_break_others() -> None:
    seen: list[str] = []

    def boom(*_: Any) -> None:
        raise RuntimeError("nope")

    twin_events.register("e", boom)
    twin_events.register("e", lambda e, w, p: seen.append(e))
    twin_events.emit("e", "ws", {})
    assert seen == ["e"]


def test_events_with_a_session_wait_for_commit_and_drop_on_rollback() -> None:
    seen: list[str] = []
    twin_events.register("e", lambda e, w, p: seen.append(p["n"]))
    factory = get_session_factory()
    db = factory()
    db.execute(text("select 1"))
    twin_events.emit("e", "ws", {"n": "committed"}, db=db)
    assert seen == []
    db.commit()
    assert seen == ["committed"]
    db.close()

    db = factory()
    db.execute(text("select 1"))
    twin_events.emit("e", "ws", {"n": "rolled back"}, db=db)
    db.rollback()
    db.close()
    assert seen == ["committed"]
