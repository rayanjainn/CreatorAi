"""Digital Twin: honest without a key, memories from approvals, nothing applied by itself."""

from __future__ import annotations

from typing import Any

import pytest
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


def _ask(client: TestClient, auth: Hdr, message: str, **scope: str) -> dict:  # type: ignore[type-arg]
    res = client.post(f"{V1}/twin/chat", json={"message": message, **scope}, headers=auth)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["actions"], body
    return body  # type: ignore[no-any-return]


def test_trim_and_hook_suggestions_are_applied_not_just_opened(
    client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str
) -> None:
    from tests.helpers import make_item_with_script, seed_demo_asset

    item, _ = make_item_with_script(client, auth)
    seed_demo_asset(client, auth, demo_media, item, workspace_id)
    gen = client.post(f"{V1}/content/{item}/clips/generate", json={"count": 1}, headers=auth)
    assert gen.status_code == 202, gen.text
    clip = client.get(f"{V1}/content/{item}/clips", headers=auth).json()[0]
    before = client.get(f"{V1}/clips/{clip['id']}/edit", headers=auth).json()

    msg = _ask(client, auth, "trim the ending a bit", clip_id=clip["id"], content_item_id=item)
    assert msg["actions"][0]["type"] == "trim_clip"
    out = client.post(
        f"{V1}/twin/messages/{msg['id']}/apply", json={"index": 0}, headers=auth
    ).json()
    assert out["applied"] is True and out.get("open_editor") is not True
    after = client.get(f"{V1}/clips/{clip['id']}/edit", headers=auth).json()
    assert after["revision"] == before["revision"] + 1
    assert after["timeline"]["duration"] == pytest.approx(
        before["timeline"]["duration"] - 1.0, abs=0.05
    )

    msg = _ask(client, auth, "give me new hooks", content_item_id=item)
    assert msg["actions"][0]["type"] == "regenerate_hooks"
    out = client.post(
        f"{V1}/twin/messages/{msg['id']}/apply", json={"index": 0}, headers=auth
    ).json()
    assert out["applied"] is True and out["href"] == f"/projects/{item}/script"
    script = client.get(f"{V1}/content/{item}/script", headers=auth).json()
    assert len(script["hook_options"]) >= 3


def test_rejecting_ai_captions_in_three_of_five_clips_becomes_a_preference(
    client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str
) -> None:
    from app.services import twin, twin_events
    from tests.helpers import make_item_with_script, seed_demo_asset

    if not twin_events.listeners_for(twin_events.LAYER_REJECTED):
        twin.register_listeners()
    item, _ = make_item_with_script(client, auth)
    seed_demo_asset(client, auth, demo_media, item, workspace_id)
    gen = client.post(
        f"{V1}/content/{item}/clips/generate",
        json={"count": 3, "include_full_cut": True},
        headers=auth,
    )
    assert gen.status_code == 202, gen.text
    clips = client.get(f"{V1}/content/{item}/clips", headers=auth).json()
    assert len(clips) >= 3

    def reject_first_caption(clip_id: str) -> None:
        edit = client.get(f"{V1}/clips/{clip_id}/edit", headers=auth).json()
        cap = edit["timeline"]["tracks"]["captions"][0]["id"]
        res = client.post(
            f"{V1}/clips/{clip_id}/edit/ops",
            json={
                "op": "set_status",
                "params": {"item_id": cap, "status": "rejected"},
                "base_revision": edit["revision"],
            },
            headers=auth,
        )
        assert res.status_code == 200, res.text

    for c in clips[:2]:
        reject_first_caption(c["id"])
    texts = [m["text"] for m in client.get(f"{V1}/twin", headers=auth).json()["memories"]]
    assert "Usually rejects AI captions" not in texts  # two clips are not a pattern yet
    reject_first_caption(clips[2]["id"])
    overview = client.get(f"{V1}/twin", headers=auth).json()
    assert "Usually rejects AI captions" in [m["text"] for m in overview["memories"]]
    assert "Leave captions off unless asked" in overview["style"]["donts"]
    assert twin.learn_from_rejections(workspace_id) == []  # not added twice
