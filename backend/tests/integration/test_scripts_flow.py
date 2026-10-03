"""Hooks -> script -> versions -> edits -> scene tools -> meta -> approval, with provenance."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.models import CreatorProfile, ScriptBeat
from tests.helpers import V1, Hdr, gemini_gateway, install_gateway, wipe_provider_keys


def new_item(client: TestClient, auth: Hdr, title: str = "Editing in 10 minutes") -> str:
    res = client.post(
        f"{V1}/content", json={"title": title, "target_duration_sec": 45}, headers=auth
    )
    return str(res.json()["id"])


def gen(
    client: TestClient, auth: Hdr, item: str, hook: str = "Stop editing slowly.", **kw: Any
) -> dict[str, Any]:
    res = client.post(
        f"{V1}/content/{item}/script/generate", json={"hook": hook, **kw}, headers=auth
    )
    assert res.status_code == 200, res.text
    out: dict[str, Any] = res.json()
    return out


def beats_of(script_id: str) -> list[ScriptBeat]:
    with session_scope() as db:
        rows = (
            db.query(ScriptBeat)
            .filter(ScriptBeat.script_id == script_id)
            .order_by(ScriptBeat.scene_idx, ScriptBeat.beat_idx)
            .all()
        )
        db.expunge_all()
        return rows


def test_hooks_create_script_v1_and_carry_provenance(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    res = client.post(
        f"{V1}/content/{item}/hooks", json={"count": 4, "tone": "witty"}, headers=auth
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["provenance"] == {"source": "mock", "provider": "mock", "model": "mock-v1"}
    assert len(body["hooks"]) == 4
    for hook in body["hooks"]:
        assert set(hook) >= {"text", "type", "why", "signal_score", "detected_type"}
        assert hook["text"].startswith("[MOCK]") and 0 <= hook["signal_score"] <= 1
    current = client.get(f"{V1}/content/{item}/script", headers=auth).json()
    assert current["id"] == body["script_id"] and current["version"] == 1
    assert [h["text"] for h in current["hook_options"]] == [h["text"] for h in body["hooks"]]
    assert (
        current["hook_options"][0]["provenance"]["source"] == "mock"
    )  # persisted with the payload
    assert current["scenes"] == [] and current["provenance"]["source"] == "mock"
    # default body: the second call replaces options on the same row
    again = client.post(f"{V1}/content/{item}/hooks", headers=auth).json()
    assert again["script_id"] == body["script_id"] and len(again["hooks"]) == 5
    assert client.get(f"{V1}/content/{item}/scripts", headers=auth).json()[0]["version"] == 1
    assert len(client.get(f"{V1}/content/{item}/scripts", headers=auth).json()) == 1


def test_generate_script_persists_scenes_beats_and_provenance(
    client: TestClient, auth: Hdr
) -> None:
    item = new_item(client, auth)
    hooks = client.post(f"{V1}/content/{item}/hooks", headers=auth).json()
    chosen = hooks["hooks"][0]["text"]
    script = gen(client, auth, item, hook=chosen, tone="witty", platform="shorts", length_sec=45)
    assert script["version"] == 1 and script["id"] == hooks["script_id"]  # hook-only row is reused
    assert script["provenance"]["source"] == "mock"
    assert (script["provider"], script["model"]) == ("mock", "mock-v1")
    assert script["selected_hook"] == chosen and len(script["hook_options"]) == 5  # kept
    assert script["scenes"][0]["text"].startswith(chosen)
    assert script["body_md"].startswith("[MOCK]")
    assert script["meta"]["titles"][0].startswith("[MOCK]")
    assert script["counters"]["scene_count"] == len(script["scenes"])
    assert script["counters"]["word_count"] > 0 and script["counters"]["target_sec"] == 45
    assert script["generation"]["used_plan_structure"] is False
    assert all(s["provenance"]["source"] == "mock" for s in script["scenes"])
    assert script["style_applied"] is False

    rows = beats_of(script["id"])
    assert [(b.scene_idx, b.beat_idx) for b in rows] == [
        (s["idx"], b["idx"]) for s in script["scenes"] for b in s["beats"]
    ]
    assert (
        all(b.embedding for b in rows) and rows[0].text == script["scenes"][0]["beats"][0]["text"]
    )
    info = script["meta"].get("beats_embedding")  # reserved keys are not exposed in meta
    assert info is None
    with session_scope() as db:
        from app.models import Script

        stored = db.get(Script, script["id"])
        assert stored is not None
        embedding = stored.meta["beats_embedding"]
        assert (
            embedding["backend"] == "hashing" and embedding["provenance"]["source"] == "heuristic"
        )


def test_hook_is_repaired_when_the_model_ignores_it(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    def reply(request: httpx.Request) -> httpx.Response:
        payload = {
            "body_md": "# x\n\n## Hook\nWelcome back friends.",
            "scenes": [
                {
                    "idx": 0,
                    "title": "Hook",
                    "text": "Welcome back friends.",
                    "beats": [
                        {"idx": 0, "text": "Welcome back friends.", "intent": "greet", "est_sec": 2}
                    ],
                },
                {
                    "idx": 1,
                    "title": "Body",
                    "text": "Do the thing.",
                    "beats": [{"idx": 0, "text": "Do the thing.", "intent": "teach", "est_sec": 2}],
                },
            ],
            "meta": {"titles": ["T"], "description": "d"},
        }
        return httpx.Response(
            200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}
        )

    install_gateway(monkeypatch, gemini_gateway(reply))
    item = new_item(client, auth)
    script = gen(client, auth, item, hook="What if editing took ten minutes?", length_sec=45)
    assert script["scenes"][0]["text"].startswith("What if editing took ten minutes?")
    assert script["scenes"][0]["beats"][0]["intent"] == "hook"
    assert script["generation"]["hook_repaired"] is True
    assert script["body_md"].startswith("# Editing in 10 minutes")  # rebuilt after the repair
    assert script["provenance"] == {"source": "ai", "provider": "gemini", "model": script["model"]}
    # far fewer words than 45 s * 2.5: flagged in the metric, not an error
    assert script["generation"]["within_tolerance"] is False
    assert script["generation"]["words"] < script["generation"]["target_words"]


def test_generate_uses_the_director_plan_structure(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    plan = client.post(
        f"{V1}/content/{item}/director/plan", json={"domain": "technology"}, headers=auth
    )
    assert plan.status_code == 200, plan.text
    sections = [s["section"] for s in plan.json()["plan"]["structure"]]
    script = gen(client, auth, item)
    assert (
        script["generation"]["used_plan_structure"] is True
        and script["generation"]["plan_version"] == 1
    )
    assert [s["title"] for s in script["scenes"]] == sections


def test_versioning_and_restore(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    v1 = gen(client, auth, item, hook="First hook here.")
    v2 = gen(client, auth, item, hook="Second hook here.")
    assert (v1["version"], v2["version"]) == (1, 2) and v1["id"] != v2["id"]
    versions = client.get(f"{V1}/content/{item}/scripts", headers=auth).json()
    assert [(v["version"], v["is_current"]) for v in versions] == [(2, True), (1, False)]
    assert versions[0]["selected_hook"] == "Second hook here." and versions[0]["word_count"] > 0
    current = client.get(f"{V1}/content/{item}/script", headers=auth).json()
    assert current["id"] == v2["id"]
    # each version keeps its own beats
    assert beats_of(v1["id"]) and beats_of(v2["id"])

    restored = client.post(f"{V1}/scripts/{v1['id']}/restore", headers=auth)
    assert restored.status_code == 200 and restored.json()["is_current"] is True
    assert client.get(f"{V1}/content/{item}/script", headers=auth).json()["id"] == v1["id"]
    versions = client.get(f"{V1}/content/{item}/scripts", headers=auth).json()
    assert [(v["version"], v["is_current"]) for v in versions] == [(2, False), (1, True)]
    assert client.get(f"{V1}/scripts/{v2['id']}", headers=auth).json()["is_current"] is False
    # a new generation after restoring is v3 and current
    v3 = gen(client, auth, item, hook="Third hook here.")
    assert v3["version"] == 3 and v3["is_current"] is True
    assert client.post(f"{V1}/scripts/{v1['id']}/restore", headers=auth).json()["version"] == 1
    assert client.post(f"{V1}/scripts/nope/restore", headers=auth).status_code == 404


def test_no_script_errors(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    res = client.get(f"{V1}/content/{item}/script", headers=auth)
    assert res.status_code == 409 and res.json()["error"]["code"] == "NO_SCRIPT"
    assert client.get(f"{V1}/content/nope/script", headers=auth).status_code == 404
    assert client.post(f"{V1}/content/nope/hooks", headers=auth).status_code == 404
    only_hooks = client.post(f"{V1}/content/{item}/hooks", headers=auth).json()["script_id"]
    meta = client.post(f"{V1}/scripts/{only_hooks}/meta", headers=auth)
    assert meta.status_code == 409 and meta.json()["error"]["code"] == "NO_SCRIPT"
    approve = client.post(f"{V1}/scripts/{only_hooks}/approve", headers=auth)
    assert approve.status_code == 409 and approve.json()["error"]["code"] == "NO_SCRIPT"


def test_user_edits_flag_provenance_and_resync_beats(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    script = gen(client, auth, item)
    before = beats_of(script["id"])
    scenes = [
        {"title": s["title"], "intent": s["intent"], "text": s["text"], "beats": s["beats"]}
        for s in script["scenes"]
    ]
    scenes[1]["text"] = "I rewrote this scene myself. It has two beats now. And a third one here."
    scenes[1]["beats"] = None
    res = client.patch(
        f"{V1}/scripts/{script['id']}",
        json={"scenes": scenes, "selected_hook": "My own hook."},
        headers=auth,
    )
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["edited_by_user"]["scenes"] == [1] and out["edited_by_user"]["selected_hook"] is True
    assert out["edited_by_user"]["body_md"] is True  # rebuilt from the edited scenes
    assert (
        out["scenes"][1]["provenance"]["source"] == "user"
        and out["scenes"][1]["edited_by_user"] is True
    )
    assert out["scenes"][0]["provenance"]["source"] == "mock"  # untouched scenes keep theirs
    assert out["provenance_by_part"]["selected_hook"]["source"] == "user"
    assert out["provenance"]["source"] == "mock"  # weakest of the parts
    assert out["scenes"][1]["beats"][0]["text"].startswith("I rewrote this scene myself.")
    assert out["scenes"][1]["text"].count("rewrote") == 1
    after = beats_of(script["id"])
    assert after[0].id == before[0].id  # unchanged beat rows survive (their matches too)
    new_scene = [b for b in after if b.scene_idx == 1]
    assert [b.text for b in new_scene] == [b["text"] for b in out["scenes"][1]["beats"]]
    assert all(b.embedding for b in after)

    # editing every part makes the whole script user-written
    all_scenes = [{"title": s["title"], "text": s["text"] + " Edited."} for s in out["scenes"]]
    final = client.patch(
        f"{V1}/scripts/{script['id']}",
        json={
            "scenes": all_scenes,
            "meta": {"titles": ["Mine"], "description": "d"},
            "body_md": "# mine",
        },
        headers=auth,
    ).json()
    assert final["edited_by_user"]["meta"] is True and final["meta"]["titles"] == ["Mine"]
    assert final["provenance"]["source"] == "user"
    assert (
        client.patch(f"{V1}/scripts/{script['id']}", json={"nope": 1}, headers=auth).status_code
        == 422
    )


def test_unchanged_patch_flags_nothing_and_reorder_keeps_provenance(
    client: TestClient, auth: Hdr
) -> None:
    item = new_item(client, auth)
    script = gen(client, auth, item)
    same = [{"title": s["title"], "text": s["text"], "beats": s["beats"]} for s in script["scenes"]]
    out = client.patch(f"{V1}/scripts/{script['id']}", json={"scenes": same}, headers=auth).json()
    assert out["edited_by_user"] == {
        "body_md": False,
        "selected_hook": False,
        "meta": False,
        "scenes": [],
    }
    swapped = [same[0], same[2], same[1], *same[3:]]
    moved = client.patch(
        f"{V1}/scripts/{script['id']}", json={"scenes": swapped}, headers=auth
    ).json()
    assert [s["title"] for s in moved["scenes"][:3]] == [
        same[0]["title"],
        same[2]["title"],
        same[1]["title"],
    ]
    assert moved["edited_by_user"]["scenes"] == []  # same text: still the model's words


def test_regenerate_and_tighten_scenes(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    script = gen(client, auth, item)
    sid = script["id"]
    old = script["scenes"][2]
    res = client.post(
        f"{V1}/scripts/{sid}/scenes/2/regenerate", json={"instruction": "funnier"}, headers=auth
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["provenance"]["source"] == "mock" and body["scene"]["idx"] == 2
    assert body["scene"]["title"] == old["title"] and body["scene"]["text"] != old["text"]
    assert body["script"]["scenes"][2]["provenance"]["source"] == "mock"
    assert [b.text for b in beats_of(sid) if b.scene_idx == 2] == [
        b["text"] for b in body["scene"]["beats"]
    ]

    long_scene = body["script"]["scenes"][2]
    tight = client.post(
        f"{V1}/scripts/{sid}/scenes/2/tighten", json={"target_ratio": 0.5}, headers=auth
    )
    assert tight.status_code == 200, tight.text
    t = tight.json()
    assert t["words_after"] <= t["words_before"]
    assert t["words_before"] == len(long_scene["text"].split())

    # the opening scene keeps the chosen hook verbatim through both tools
    hook = script["selected_hook"]
    opening = client.post(f"{V1}/scripts/{sid}/scenes/0/regenerate", headers=auth).json()
    assert opening["scene"]["text"].startswith(hook)
    tightened = client.post(f"{V1}/scripts/{sid}/scenes/0/tighten", headers=auth).json()
    assert tightened["scene"]["text"].startswith(hook)

    assert client.post(f"{V1}/scripts/{sid}/scenes/99/regenerate", headers=auth).status_code == 404
    assert (
        client.post(
            f"{V1}/scripts/{sid}/scenes/0/tighten", json={"target_ratio": 2}, headers=auth
        ).status_code
        == 422
    )
    # a user edit afterwards overrides the scene's provenance
    scenes = [{"title": s["title"], "text": s["text"]} for s in tightened["script"]["scenes"]]
    scenes[2]["text"] = "Now it is mine."
    edited = client.patch(f"{V1}/scripts/{sid}", json={"scenes": scenes}, headers=auth).json()
    assert edited["scenes"][2]["provenance"]["source"] == "user"


def test_script_meta_is_generated_and_badged(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    script = gen(client, auth, item)
    res = client.post(f"{V1}/scripts/{script['id']}/meta", headers=auth)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["provenance"]["source"] == "mock"
    assert len(body["meta"]["titles"]) == 3 and body["meta"]["supporting"]["pinned_comment"]
    stored = client.get(f"{V1}/scripts/{script['id']}", headers=auth).json()
    assert stored["meta"]["titles"] == body["meta"]["titles"]
    assert stored["provenance_by_part"]["meta"]["source"] == "mock"


def test_approve_moves_to_shoot_and_fires_the_twin_event(client: TestClient, auth: Hdr) -> None:
    from app.services import twin_events

    events: list[dict[str, Any]] = []
    twin_events.register("script_approved", lambda e, w, p: events.append(p))
    try:
        item = new_item(client, auth)
        old = gen(client, auth, item)
        current = gen(client, auth, item, hook="Second take here.")
        stale = client.post(f"{V1}/scripts/{old['id']}/approve", headers=auth)
        assert stale.status_code == 409  # only the current version
        res = client.post(f"{V1}/scripts/{current['id']}/approve", headers=auth)
        assert res.status_code == 200 and res.json()["approved"] is True
        card = client.get(f"{V1}/content/{item}", headers=auth).json()
        assert card["stage"] == "shoot" and card["progress"]["script_approved"] is True
        assert (
            len(events) == 1
            and events[0]["script_id"] == current["id"]
            and events[0]["version"] == 2
        )
        again = client.post(f"{V1}/scripts/{current['id']}/approve", headers=auth)
        assert again.status_code == 200 and len(events) == 1  # idempotent
        versions = client.get(f"{V1}/content/{item}/scripts", headers=auth).json()
        assert versions[0]["approved"] is True and versions[1]["approved"] is False
    finally:
        twin_events.clear()


def test_twin_banner_flag_follows_the_style_revision(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    item = new_item(client, auth)
    gen(client, auth, item)
    assert client.get(f"{V1}/content/{item}/script", headers=auth).json()["style_applied"] is False
    with session_scope() as db:
        profile = db.get(CreatorProfile, workspace_id)
        assert profile is not None
        profile.style_profile_rev = 2
    assert client.get(f"{V1}/content/{item}/script", headers=auth).json()["style_applied"] is True


def test_llm_not_configured_and_busy_surface_cleanly(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = new_item(client, auth)
    wipe_provider_keys(monkeypatch, allow_mock=False)
    for path, body in (
        (f"/content/{item}/hooks", {}),
        (f"/content/{item}/script/generate", {"hook": "Stop editing slowly."}),
        (f"/content/{item}/director/plan", {}),
    ):
        res = client.post(f"{V1}{path}", json=body, headers=auth)
        assert res.status_code == 503, path
        assert res.json()["error"]["code"] == "LLM_NOT_CONFIGURED"
    # nothing was written
    assert client.get(f"{V1}/content/{item}/scripts", headers=auth).json() == []

    def failing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "down"})

    gateway = gemini_gateway(failing)
    gateway.sleep = lambda _: None
    install_gateway(monkeypatch, gateway)
    res = client.post(f"{V1}/content/{item}/hooks", json={}, headers=auth)
    assert res.status_code == 503 and res.json()["error"]["code"] == "LLM_BUSY"
    assert "retry_after" in json.dumps(res.json()) or res.headers.get("retry-after")
