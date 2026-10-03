"""Edit API: signed assets, optimistic saves, revisions, server-side ops, layer activity."""

from __future__ import annotations

import copy
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.models import ActivityLog, Asset, Edit, EditRevision
from app.schemas.timeline import Timeline
from app.services import timeline_service as ts
from tests.helpers import V1, Hdr
from tests.integration.test_clips_flow import clips_of, generate, ready_item


@pytest.fixture
def clip(client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str) -> dict[str, Any]:
    item, asset_id = ready_item(client, auth, demo_media)
    with session_scope() as db:
        db.add(
            Asset(
                workspace_id=workspace_id,
                kind="audio",
                filename="calm.mp3",
                mime="audio/mpeg",
                storage_key="media/x/calm.mp3",
                size_bytes=1,
                sha256="m" * 64,
                duration_sec=120.0,
                status="ready",
                tags=["music"],
            )
        )
    generate(client, auth, item, count=1)
    top = clips_of(client, auth, item)[0]
    return {**top, "asset_id": asset_id, "item": item}


def edit_url(clip: dict[str, Any], tail: str = "") -> str:
    return f"{V1}/clips/{clip['id']}/edit{tail}"


def load(client: TestClient, auth: Hdr, clip: dict[str, Any]) -> dict[str, Any]:
    res = client.get(edit_url(clip), headers=auth)
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


def activity(client: TestClient, auth: Hdr, action: str) -> list[dict[str, Any]]:
    res = client.get(f"{V1}/activity", params={"action": action}, headers=auth)
    items: list[dict[str, Any]] = res.json()["items"]
    return items


def test_get_edit_returns_timeline_assets_and_waveform(
    client: TestClient, auth: Hdr, clip: dict[str, Any]
) -> None:
    body = load(client, auth, clip)
    assert (
        body["revision"] == 1
        and body["violations"] == []
        and body["provenance"]["source"] == "mock"
    )
    timeline = Timeline.model_validate(body["timeline"])
    assert timeline.version == 1 and timeline.fps == 30 and timeline.tracks.video
    info = body["assets"][clip["asset_id"]]
    assert info["proxy_url"].startswith("/media/") and info["filename"] == "hero_demo.mp4"
    assert info["energy"] and info["energy_window_sec"] == 0.5 and info["duration_sec"] > 30
    assert info["words"] and {"word", "start", "end"} <= set(info["words"][0])
    music = body["assets"][timeline.tracks.audio[0].asset_id]
    assert music["kind"] == "audio" and music["audio_url"].startswith("/media/")
    used = [(v.src_in, v.src_out) for v in timeline.tracks.video]
    assert all(any(a <= w["start"] < b for a, b in used) for w in info["words"])
    assert client.get(f"{V1}/clips/nope/edit", headers=auth).status_code == 404
    assert client.get(edit_url(clip)).status_code == 401


def test_optimistic_concurrency_conflict_flow(
    client: TestClient, auth: Hdr, clip: dict[str, Any]
) -> None:
    first = load(client, auth, clip)
    timeline = copy.deepcopy(first["timeline"])
    timeline["caption_style"] = "karaoke"
    saved = client.put(
        edit_url(clip),
        json={"timeline": timeline, "base_revision": 1, "note": "karaoke"},
        headers=auth,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2 and saved.json()["timeline"]["caption_style"] == "karaoke"

    stale = copy.deepcopy(first["timeline"])
    stale["caption_style"] = "minimal_bottom"
    conflict = client.put(
        edit_url(clip), json={"timeline": stale, "base_revision": 1}, headers=auth
    )
    assert conflict.status_code == 409
    error = conflict.json()["error"]
    assert error["code"] == "REVISION_CONFLICT"
    assert error["details"]["current_revision"] == 2 and error["details"]["base_revision"] == 1
    assert load(client, auth, clip)["timeline"]["caption_style"] == "karaoke"  # untouched
    with session_scope() as db:
        assert db.query(EditRevision).filter(EditRevision.revision == 3).count() == 0

    # an op against the stale revision conflicts too; after reloading it applies
    op = {"op": "set_caption_style", "params": {"style": "bold_center"}, "base_revision": 1}
    assert client.post(edit_url(clip, "/ops"), json=op, headers=auth).status_code == 409
    ok = client.post(edit_url(clip, "/ops"), json={**op, "base_revision": 2}, headers=auth)
    assert ok.status_code == 200 and ok.json()["revision"] == 3
    # a replayed save with an already-used base is rejected as well
    again = client.put(
        edit_url(clip), json={"timeline": timeline, "base_revision": 2}, headers=auth
    )
    assert again.status_code == 409 and again.json()["error"]["details"]["current_revision"] == 3


def test_put_validates_every_invariant_with_precise_details(
    client: TestClient, auth: Hdr, clip: dict[str, Any]
) -> None:
    timeline = load(client, auth, clip)["timeline"]
    broken = copy.deepcopy(timeline)
    broken["tracks"]["video"][0]["src_out"] = 99999.0
    broken["duration"] = 3.0
    res = client.put(edit_url(clip), json={"timeline": broken, "base_revision": 1}, headers=auth)
    assert res.status_code == 422
    error = res.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    codes = {v["code"] for v in error["details"]["violations"]}
    assert {"SRC_BEYOND_ASSET", "DURATION_MISMATCH"} <= codes
    first = error["details"]["violations"][0]
    assert first["path"].startswith("tracks.video[0]") or first["path"] == "duration"
    # structural errors come back as 422 too (model validation)
    bad = copy.deepcopy(timeline)
    bad["tracks"]["video"][0]["crop_x"] = 4
    assert (
        client.put(
            edit_url(clip), json={"timeline": bad, "base_revision": 1}, headers=auth
        ).status_code
        == 422
    )
    unknown_asset = copy.deepcopy(timeline)
    unknown_asset["tracks"]["audio"].append(
        {
            "id": "a_zzz",
            "source": "user",
            "status": "accepted",
            "kind": "sfx",
            "asset_id": "nope",
            "src_in": 0,
            "src_out": 1,
            "tl_start": 0,
            "gain_db": -10,
        }
    )
    res = client.put(
        edit_url(clip), json={"timeline": unknown_asset, "base_revision": 1}, headers=auth
    )
    assert res.status_code == 422
    assert load(client, auth, clip)["revision"] == 1  # nothing was stored


def test_ops_revisions_restore_and_layer_activity(
    client: TestClient, auth: Hdr, clip: dict[str, Any]
) -> None:
    def run(op: str, params: dict[str, Any], base: int) -> dict[str, Any]:
        res = client.post(
            edit_url(clip, "/ops"),
            json={"op": op, "params": params, "base_revision": base},
            headers=auth,
        )
        assert res.status_code == 200, res.text
        body: dict[str, Any] = res.json()
        assert body["op"] == op and body["revision"] == base + 1
        assert ts.validate(Timeline.model_validate(body["timeline"])) == []
        return body

    start = load(client, auth, clip)["timeline"]
    n_video = len(start["tracks"]["video"])
    tight = run("tighten_pauses", {"keep_sec": 0.05}, 1)
    assert tight["timeline"]["duration"] <= start["duration"] + 1e-6
    split = run("split_item", {"at_tl": tight["timeline"]["duration"] / 2}, 2)
    assert len(split["timeline"]["tracks"]["video"]) >= n_video

    accepted = run("accept_all", {}, 3)
    layers = accepted["changed_layers"]
    assert {g["layer"] for g in layers} >= {"video", "captions", "audio"}
    rows = activity(client, auth, "layer_accepted")
    assert {r["meta"]["layer"] for r in rows} >= {"video", "captions", "audio"}
    assert all(r["meta"]["clip_id"] == clip["id"] and r["meta"]["revision"] == 4 for r in rows)
    assert all(r["entity_type"] == "clip" and r["entity_id"] == clip["id"] for r in rows)

    music = run("toggle_music", {"on": False}, 4)
    assert music["timeline"]["tracks"]["audio"][0]["status"] == "rejected"
    rejected = activity(client, auth, "layer_rejected")
    assert len(rejected) == 1
    meta = rejected[0]["meta"]
    assert (meta["layer"], meta["kind"], meta["count"], meta["sources"]) == (
        "audio",
        "music",
        1,
        ["ai"],
    )

    cap_id = music["timeline"]["tracks"]["captions"][0]["id"]
    run("set_status", {"item_id": cap_id, "status": "rejected"}, 5)
    assert {r["meta"]["layer"] for r in activity(client, auth, "layer_rejected")} == {
        "audio",
        "captions",
    }

    rebuilt = run("rebuild_captions", {}, 6)
    assert rebuilt["timeline"]["tracks"]["captions"]
    run(
        "set_crop_x", {"item_id": rebuilt["timeline"]["tracks"]["video"][0]["id"], "crop_x": 0.2}, 7
    )

    for op, params in [
        ("nope", {}),
        ("tighten_pauses", {"keep_sec": 9}),
        ("split_item", {"at_tl": 9999}),
        ("delete_item", {"item_id": "v_missing"}),
    ]:
        res = client.post(
            edit_url(clip, "/ops"),
            json={"op": op, "params": params, "base_revision": 8},
            headers=auth,
        )
        assert res.status_code in (404, 422), (op, res.text)
    assert load(client, auth, clip)["revision"] == 8  # failed ops stored nothing

    revisions = client.get(edit_url(clip, "/revisions"), headers=auth).json()
    assert [r["revision"] for r in revisions] == [8, 7, 6, 5, 4, 3, 2, 1]
    assert (
        revisions[-1]["note"] == "Generated by clips.generate"
        and revisions[0]["note"] == "op: set_crop_x"
    )
    assert revisions[0]["video_items"] >= 1
    old = client.get(edit_url(clip, "/revisions/1"), headers=auth)
    assert (
        old.status_code == 200
        and old.json()["timeline"]["tracks"]["video"][0]["id"] == start["tracks"]["video"][0]["id"]
    )
    assert client.get(edit_url(clip, "/revisions/99"), headers=auth).status_code == 404

    restored = client.post(edit_url(clip, "/revisions/1/restore"), headers=auth)
    assert restored.status_code == 200 and restored.json()["revision"] == 9
    assert restored.json()["timeline"] == old.json()["timeline"]
    assert len(client.get(edit_url(clip, "/revisions"), headers=auth).json()) == 9  # history kept
    stale = client.post(
        edit_url(clip, "/revisions/2/restore"), json={"base_revision": 3}, headers=auth
    )
    assert stale.status_code == 409
    with session_scope() as db:
        assert db.query(Edit).one().revision == 9
        assert db.query(ActivityLog).filter(ActivityLog.action == "layer_accepted").count() >= 3
