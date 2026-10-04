"""Digital Twin: honest without a key, memories from approvals, nothing applied by itself."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.helpers import V1, Hdr


def test_overview_starts_empty(client: TestClient, auth: Hdr) -> None:
    body = client.get(f"{V1}/twin", headers=auth).json()
    assert body["memory_count"] == 0 and body["style"] == {} and body["style_revision"] == 0
    assert client.get(f"{V1}/twin/messages", headers=auth).json() == []


def test_chat_replies_with_provenance_and_is_remembered(client: TestClient, auth: Hdr) -> None:
    res = client.post(f"{V1}/twin/chat", json={"message": "give me an idea"}, headers=auth)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["role"] == "assistant" and body["content"]
    assert body["provenance"]["source"] in ("ai", "mock")  # always labelled
    hist = client.get(f"{V1}/twin/messages", headers=auth).json()
    assert [m["role"] for m in hist] == ["user", "assistant"]
    assert client.delete(f"{V1}/twin/messages", headers=auth).status_code == 204


def test_style_update_needs_an_approved_script(client: TestClient, auth: Hdr) -> None:
    res = client.post(f"{V1}/twin/style/update", headers=auth)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "NOTHING_TO_LEARN"


def test_accepting_a_clip_or_script_creates_a_memory_listener_path(
    client: TestClient, auth: Hdr
) -> None:
    from app.services import twin

    twin.remember(
        client.get(f"{V1}/me", headers=auth).json()["workspace_id"],
        "approved_script",
        "A tight script",
        "s1",
    )
    again = client.get(f"{V1}/twin", headers=auth).json()
    assert again["memory_count"] == 1 and again["approvals_since_update"] == 1
