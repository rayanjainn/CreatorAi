"""Board lifecycle, drag-move ordering, stage rules, ideas and the activity log."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.models import Asset, Clip, ContentItem, Job
from app.services import twin_events
from tests.helpers import V1, Hdr, install_gateway, wipe_provider_keys


def mk(client: TestClient, auth: Hdr, title: str, **extra: Any) -> dict[str, Any]:
    res = client.post(f"{V1}/content", json={"title": title, **extra}, headers=auth)
    assert res.status_code == 201, res.text
    body: dict[str, Any] = res.json()
    return body


def board(client: TestClient, auth: Hdr, **params: Any) -> dict[str, Any]:
    res = client.get(f"{V1}/content/board", params=params, headers=auth)
    assert res.status_code == 200, res.text
    out: dict[str, Any] = res.json()
    return out


def column(client: TestClient, auth: Hdr, stage: str) -> list[tuple[str, int]]:
    cols = {c["stage"]: c for c in board(client, auth)["columns"]}
    return [(c["title"], c["position"]) for c in cols[stage]["cards"]]


def seed_script(client: TestClient, auth: Hdr, item_id: str) -> dict[str, Any]:
    res = client.post(
        f"{V1}/content/{item_id}/script/generate",
        json={"hook": "Stop editing slowly."},
        headers=auth,
    )
    assert res.status_code == 200, res.text
    out: dict[str, Any] = res.json()
    return out


def test_requires_auth(client: TestClient) -> None:
    assert client.get(f"{V1}/content/board").status_code == 401
    assert client.get(f"{V1}/activity").status_code == 401


def test_create_get_patch_list_filters(client: TestClient, auth: Hdr) -> None:
    a = mk(client, auth, "Editing in 10 minutes", domain="technology", target_duration_sec=45)
    mk(client, auth, "Budget travel tips", domain="lifestyle", idea_text="cheap flights")
    assert a["stage"] == "idea" and a["position"] == 0
    assert a["progress"]["percent"] == 0 and a["running_jobs"] == {
        "active": False,
        "count": 0,
        "types": [],
    }

    got = client.get(f"{V1}/content/{a['id']}", headers=auth).json()
    assert got["title"] == "Editing in 10 minutes"

    patched = client.patch(
        f"{V1}/content/{a['id']}", json={"objective": "teach", "title": "Edit faster"}, headers=auth
    ).json()
    assert patched["title"] == "Edit faster" and patched["objective"] == "teach"
    # stage cannot be patched
    assert (
        client.patch(f"{V1}/content/{a['id']}", json={"stage": "edit"}, headers=auth).status_code
        == 422
    )

    listed = client.get(f"{V1}/content", headers=auth).json()
    assert listed["total"] == 2 and {i["title"] for i in listed["items"]} == {
        "Edit faster",
        "Budget travel tips",
    }
    by_domain = client.get(f"{V1}/content", params={"domain": "lifestyle"}, headers=auth).json()
    assert [i["title"] for i in by_domain["items"]] == ["Budget travel tips"]
    by_q = client.get(f"{V1}/content", params={"q": "flights"}, headers=auth).json()
    assert by_q["total"] == 1  # matches idea_text
    assert client.get(f"{V1}/content", params={"stage": "shoot"}, headers=auth).json()["total"] == 0
    assert client.get(f"{V1}/content", params={"stage": "bogus"}, headers=auth).status_code == 422
    assert client.post(f"{V1}/content", json={"title": "  "}, headers=auth).status_code == 422
    assert client.get(f"{V1}/content/nope", headers=auth).status_code == 404


def test_board_groups_columns_in_order(client: TestClient, auth: Hdr) -> None:
    mk(client, auth, "One")
    mk(client, auth, "Two", domain="business")
    data = board(client, auth)
    assert [c["stage"] for c in data["columns"]] == [
        "idea",
        "script",
        "shoot",
        "edit",
        "review",
        "published",
    ]
    assert data["columns"][0]["count"] == 2 and data["total"] == 2
    assert [c["title"] for c in data["columns"][0]["cards"]] == ["One", "Two"]
    assert [c["title"] for c in board(client, auth, domain="business")["columns"][0]["cards"]] == [
        "Two"
    ]
    assert board(client, auth, q="zzz")["total"] == 0


def test_drag_move_reorders_and_normalises_positions(client: TestClient, auth: Hdr) -> None:
    ids = {t: mk(client, auth, t)["id"] for t in "ABCD"}
    assert column(client, auth, "idea") == [("A", 0), ("B", 1), ("C", 2), ("D", 3)]

    # reorder inside a column: D to the top
    client.post(
        f"{V1}/content/{ids['D']}/move", json={"stage": "idea", "position": 0}, headers=auth
    )
    assert column(client, auth, "idea") == [("D", 0), ("A", 1), ("B", 2), ("C", 3)]
    # move down: D to index 2
    client.post(
        f"{V1}/content/{ids['D']}/move", json={"stage": "idea", "position": 2}, headers=auth
    )
    assert column(client, auth, "idea") == [("A", 0), ("B", 1), ("D", 2), ("C", 3)]

    # across columns: the source closes its gap, the target is renumbered
    client.post(f"{V1}/content/{ids['A']}/move", json={"stage": "script"}, headers=auth)
    client.post(
        f"{V1}/content/{ids['C']}/move", json={"stage": "script", "position": 0}, headers=auth
    )
    assert column(client, auth, "idea") == [("B", 0), ("D", 1)]
    assert column(client, auth, "script") == [("C", 0), ("A", 1)]
    # position past the end clamps; omitted position appends
    client.post(
        f"{V1}/content/{ids['B']}/move", json={"stage": "script", "position": 99}, headers=auth
    )
    assert column(client, auth, "script") == [("C", 0), ("A", 1), ("B", 2)]
    client.post(f"{V1}/content/{ids['D']}/move", json={"stage": "script"}, headers=auth)
    assert column(client, auth, "script")[-1] == ("D", 3)
    assert column(client, auth, "idea") == []
    assert (
        client.post(
            f"{V1}/content/{ids['A']}/move", json={"stage": "nope"}, headers=auth
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{V1}/content/{ids['A']}/move", json={"stage": "idea", "position": -1}, headers=auth
        ).status_code
        == 422
    )


def test_stage_moves_are_logged(client: TestClient, auth: Hdr) -> None:
    item = mk(client, auth, "Logged")
    client.post(f"{V1}/content/{item['id']}/move", json={"stage": "script"}, headers=auth)
    client.post(
        f"{V1}/content/{item['id']}/move", json={"stage": "script", "position": 0}, headers=auth
    )  # no-op
    rows = client.get(f"{V1}/activity", params={"action": "stage_moved"}, headers=auth).json()
    assert rows["total"] == 1
    entry = rows["items"][0]
    assert entry["entity_type"] == "content_item" and entry["entity_id"] == item["id"]
    assert entry["meta"]["from"] == "idea" and entry["meta"]["to"] == "script"
    everything = client.get(f"{V1}/activity", headers=auth).json()
    assert [r["action"] for r in everything["items"]] == [
        "stage_moved",
        "content_created",
    ]  # newest first
    only_entity = client.get(
        f"{V1}/activity", params={"entity_id": item["id"]}, headers=auth
    ).json()
    assert only_entity["total"] == 2
    page = client.get(f"{V1}/activity", params={"limit": 1, "offset": 1}, headers=auth).json()
    assert page["total"] == 2 and page["items"][0]["action"] == "content_created"


def test_moving_to_shoot_needs_a_script_and_approves_it(client: TestClient, auth: Hdr) -> None:
    events: list[tuple[str, str, dict[str, Any]]] = []
    twin_events.register(twin_events.SCRIPT_APPROVED, lambda e, w, p: events.append((e, w, p)))
    try:
        item = mk(client, auth, "Needs script")
        res = client.post(f"{V1}/content/{item['id']}/move", json={"stage": "shoot"}, headers=auth)
        assert res.status_code == 409 and res.json()["error"]["code"] == "NO_SCRIPT"
        assert events == []

        script = seed_script(client, auth, item["id"])
        assert script["approved"] is False
        moved = client.post(
            f"{V1}/content/{item['id']}/move", json={"stage": "shoot"}, headers=auth
        )
        assert moved.status_code == 200 and moved.json()["stage"] == "shoot"
        assert moved.json()["progress"]["script_approved"] is True

        current = client.get(f"{V1}/content/{item['id']}/script", headers=auth).json()
        assert current["approved"] is True and current["approved_at"]
        assert len(events) == 1
        event, _workspace, payload = events[0]
        assert event == "script_approved"
        assert payload["content_item_id"] == item["id"] and payload["script_id"] == script["id"]
        assert payload["version"] == 1 and payload["title"] == "Needs script"

        # moving back and forth does not fire the event again
        client.post(f"{V1}/content/{item['id']}/move", json={"stage": "edit"}, headers=auth)
        client.post(f"{V1}/content/{item['id']}/move", json={"stage": "shoot"}, headers=auth)
        assert len(events) == 1
        actions = [r["action"] for r in client.get(f"{V1}/activity", headers=auth).json()["items"]]
        assert actions.count("script_approved") == 1 and actions.count("stage_moved") == 3
    finally:
        twin_events.clear()


def test_moving_to_published_stamps_the_date(client: TestClient, auth: Hdr) -> None:
    item = mk(client, auth, "Done")
    moved = client.post(
        f"{V1}/content/{item['id']}/move", json={"stage": "published"}, headers=auth
    ).json()
    assert moved["published_at"]


def test_card_progress_thumbnail_and_running_jobs(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    item = mk(client, auth, "Rich card")
    seed_script(client, auth, item["id"])
    with session_scope() as db:
        ready = Asset(workspace_id=workspace_id, content_item_id=item["id"], kind="video",
                      filename="a.mp4", storage_key="k", mime="video/mp4", size_bytes=1, sha256="1",
                      status="ready", thumb_key=f"media/{workspace_id}/x/thumb.jpg")  # fmt: skip
        busy = Asset(workspace_id=workspace_id, content_item_id=item["id"], kind="video",
                     filename="b.mp4", storage_key="k2", mime="video/mp4", size_bytes=1, sha256="2",
                     status="processing")  # fmt: skip
        db.add_all([ready, busy])
        db.flush()
        db.add(Job(workspace_id=workspace_id, type="asset.process", entity_type="asset",
                   entity_id=busy.id, status="running"))  # fmt: skip
        db.add(Clip(workspace_id=workspace_id, content_item_id=item["id"], source_asset_id=ready.id,
                    start_sec=0, end_sec=5, status="accepted"))  # fmt: skip
    card = board(client, auth)["columns"][0]["cards"][0]
    assert card["thumbnail_url"] and card["thumbnail_url"].startswith("/media/")
    p = card["progress"]
    assert (p["assets_total"], p["assets_ready"]) == (2, 1)
    assert p["has_script"] and p["script_version"] == 1 and not p["script_approved"]
    assert (p["clips_count"], p["clips_accepted"]) == (1, 1)
    assert p["percent"] == round(100 * 3 / 6)  # script + footage + clips
    assert card["running_jobs"] == {"active": True, "count": 1, "types": ["asset.process"]}


def test_delete_requires_confirmation_and_cascades(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    keep = mk(client, auth, "Keep")
    item = mk(client, auth, "Doomed")
    seed_script(client, auth, item["id"])
    with session_scope() as db:
        db.add(Asset(id="asset-1", workspace_id=workspace_id, content_item_id=item["id"], kind="video",
                     filename="a.mp4", storage_key="k", mime="video/mp4", size_bytes=1, sha256="1",
                     status="ready"))  # fmt: skip
    res = client.delete(f"{V1}/content/{item['id']}", headers=auth)
    assert res.status_code == 409 and res.json()["error"]["code"] == "CONFIRMATION_REQUIRED"
    assert res.json()["error"]["details"]["cascade"] == {
        "scripts": 1, "director_outputs": 0, "clips": 0, "assets_detached": 1,
    }  # fmt: skip
    assert client.get(f"{V1}/content/{item['id']}", headers=auth).status_code == 200

    done = client.delete(f"{V1}/content/{item['id']}", params={"confirm": "true"}, headers=auth)
    assert done.status_code == 200 and done.json()["deleted"] is True
    assert client.get(f"{V1}/content/{item['id']}", headers=auth).status_code == 404
    with session_scope() as db:
        assert db.get(ContentItem, item["id"]) is None
        asset = db.get(Asset, "asset-1")
        assert asset is not None and asset.content_item_id is None  # footage stays in the library
    assert column(client, auth, "idea") == [("Keep", 0)]
    assert client.get(f"{V1}/content/{keep['id']}/script", headers=auth).status_code == 409
    log = client.get(f"{V1}/activity", params={"action": "content_deleted"}, headers=auth).json()
    assert log["total"] == 1


def test_other_workspaces_items_are_not_found(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    item = mk(client, auth, "Private")
    monkeypatch.setattr(get_settings(), "auth_allow_multi", True)
    other = client.post(
        f"{V1}/auth/signup", json={"email": "other@example.com", "password": "password123"}
    ).json()
    theirs = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get(f"{V1}/content/{item['id']}", headers=theirs).status_code == 404
    move = client.post(f"{V1}/content/{item['id']}/move", json={"stage": "script"}, headers=theirs)
    assert move.status_code == 404
    assert (
        client.delete(f"{V1}/content/{item['id']}?confirm=true", headers=theirs).status_code == 404
    )
    assert client.get(f"{V1}/content/board", headers=theirs).json()["total"] == 0
    assert client.get(f"{V1}/activity", headers=theirs).json()["total"] == 0


# ── ideas ─────────────────────────────────────────────────────────────────────────────────────
def test_generate_ideas_marks_mock_and_avoids_existing_titles(
    client: TestClient, auth: Hdr
) -> None:
    mk(client, auth, "editing: the beginner mistakes nobody warns you about")
    res = client.post(f"{V1}/ideas/generate", json={"topic": "editing", "count": 4}, headers=auth)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["provenance"] == {"source": "mock", "provider": "mock", "model": "mock-v1"}
    assert len(body["ideas"]) == 4
    for idea in body["ideas"]:
        assert idea["source"] == "twin" and idea["status"] == "suggested"
        assert idea["title"].startswith("[MOCK]")
        assert idea["provenance"]["source"] == "mock"
    assert all("beginner mistakes nobody warns you about" not in i["title"] for i in body["ideas"])

    listed = client.get(f"{V1}/ideas", headers=auth).json()
    assert listed["total"] == 4 and listed["items"][0]["provenance"]["source"] == "mock"
    # a second run never repeats titles that are already suggested
    again = client.post(
        f"{V1}/ideas/generate", json={"topic": "editing", "count": 4}, headers=auth
    ).json()
    first = {i["title"] for i in body["ideas"]}
    assert not first & {i["title"] for i in again["ideas"]}
    assert client.post(f"{V1}/ideas/generate", json={"count": 99}, headers=auth).status_code == 422


def test_idea_duplicates_against_the_board_are_skipped(client: TestClient, auth: Hdr) -> None:
    from app.services.content_service import normalise_title

    assert normalise_title("[MOCK] Hello,  World!") == "hello world"
    mk(client, auth, "editing: idea number 2")  # the mock's 9th title: must be skipped
    body = client.post(
        f"{V1}/ideas/generate", json={"topic": "editing", "count": 10}, headers=auth
    ).json()
    assert all(normalise_title(i["title"]) != "editing idea number 2" for i in body["ideas"])


def test_accept_and_dismiss_ideas(client: TestClient, auth: Hdr) -> None:
    ideas = client.post(f"{V1}/ideas/generate", json={"count": 3}, headers=auth).json()["ideas"]
    accepted = client.post(f"{V1}/ideas/{ideas[0]['id']}/accept", headers=auth)
    assert accepted.status_code == 200
    item = accepted.json()["content_item"]
    assert item["stage"] == "idea" and item["title"] == ideas[0]["title"]
    assert item["domain"] == "technology"  # the profile's domain
    assert accepted.json()["idea"]["status"] == "accepted"
    assert board(client, auth)["columns"][0]["count"] == 1
    again = client.post(f"{V1}/ideas/{ideas[0]['id']}/accept", headers=auth)
    assert again.status_code == 409

    dismissed = client.post(f"{V1}/ideas/{ideas[1]['id']}/dismiss", headers=auth).json()
    assert dismissed["status"] == "dismissed"
    assert client.post(f"{V1}/ideas/{ideas[0]['id']}/dismiss", headers=auth).status_code == 409
    open_ideas = client.get(f"{V1}/ideas", headers=auth).json()
    assert [i["id"] for i in open_ideas["items"]] == [ideas[2]["id"]]
    assert (
        client.get(f"{V1}/ideas", params={"status": "dismissed"}, headers=auth).json()["total"] == 1
    )
    assert client.post(f"{V1}/ideas/nope/accept", headers=auth).status_code == 404
    actions = {r["action"] for r in client.get(f"{V1}/activity", headers=auth).json()["items"]}
    assert {"ideas_generated", "idea_accepted", "idea_dismissed"} <= actions


def test_ideas_surface_llm_not_configured_when_mock_is_off(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    wipe_provider_keys(monkeypatch, allow_mock=False)
    res = client.post(f"{V1}/ideas/generate", json={}, headers=auth)
    assert res.status_code == 503 and res.json()["error"]["code"] == "LLM_NOT_CONFIGURED"
    assert client.get(f"{V1}/ideas", headers=auth).json()["total"] == 0


def test_ideas_use_the_real_provider_and_report_it(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json

    import httpx

    from tests.helpers import gemini_gateway

    def reply(request: httpx.Request) -> httpx.Response:
        prompt = json.loads(request.content)["contents"][0]["parts"][0]["text"]
        assert "Titles already on the board" in prompt
        payload = {"ideas": [{"title": "Real idea one", "rationale": "because"}]}
        return httpx.Response(
            200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}
        )

    install_gateway(monkeypatch, gemini_gateway(reply))
    body = client.post(f"{V1}/ideas/generate", json={"topic": "x", "count": 1}, headers=auth).json()
    assert body["provenance"]["source"] == "ai" and body["provenance"]["provider"] == "gemini"
    assert body["ideas"][0]["title"] == "Real idea one"
    assert body["ideas"][0]["provenance"]["provider"] == "gemini"


def test_schedule_a_day_and_clear_it(client: TestClient, auth: Hdr) -> None:
    item = client.post(f"{V1}/content", json={"title": "Plan me"}, headers=auth).json()
    res = client.patch(
        f"{V1}/content/{item['id']}", json={"scheduled_for": "2026-11-03"}, headers=auth
    )
    assert res.status_code == 200 and res.json()["scheduled_for"] == "2026-11-03"
    bad = client.patch(
        f"{V1}/content/{item['id']}", json={"scheduled_for": "tomorrow"}, headers=auth
    )
    assert bad.status_code == 422
    cleared = client.patch(f"{V1}/content/{item['id']}", json={"scheduled_for": None}, headers=auth)
    assert cleared.json()["scheduled_for"] is None


def test_llm_usage_report_counts_calls_per_provider_and_task(client: TestClient, auth: Hdr) -> None:
    item = client.post(f"{V1}/content", json={"title": "Usage"}, headers=auth).json()["id"]
    assert (
        client.post(f"{V1}/content/{item}/hooks", json={"count": 3}, headers=auth).status_code
        == 200
    )
    assert (
        client.post(f"{V1}/content/{item}/hooks", json={"count": 3}, headers=auth).status_code
        == 200
    )
    rep = client.get(f"{V1}/llm/usage", params={"days": 7}, headers=auth).json()
    assert rep["total"]["calls"] >= 2 and rep["total"]["ok"] >= 2
    assert rep["by_task"][0]["task"] == "script.hooks"
    assert rep["by_provider"][0]["name"].startswith("mock")
    assert len(rep["by_day"]) == 7 and rep["by_day"][-1]["calls"] >= 2
