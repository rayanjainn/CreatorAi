"""clips.generate end to end on generated demo footage (hashing embedder, mock or no LLM)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.models import ActivityLog, Asset, Clip, Edit, EditRevision, Job
from app.schemas.timeline import Timeline
from app.services import timeline_service as ts
from app.services import twin_events
from tests.helpers import V1, Hdr, make_item_with_script, seed_demo_asset, wipe_provider_keys


def ready_item(
    client: TestClient, auth: Hdr, media: Any, workspace_id: str, script: bool = True
) -> tuple[str, str]:
    if script:
        item, _ = make_item_with_script(client, auth)
    else:
        item = client.post(f"{V1}/content", json={"title": "Raw"}, headers=auth).json()["id"]
    return str(item), seed_demo_asset(client, auth, media, str(item), workspace_id)


def generate(client: TestClient, auth: Hdr, item: str, **body: Any) -> dict[str, Any]:
    res = client.post(f"{V1}/content/{item}/clips/generate", json=body, headers=auth)
    assert res.status_code == 202, res.text
    job = client.get(f"{V1}/jobs/{res.json()['job_id']}", headers=auth).json()
    assert job["status"] == "succeeded", job
    result: dict[str, Any] = job["result"]
    return result


def clips_of(client: TestClient, auth: Hdr, item: str, **params: Any) -> list[dict[str, Any]]:
    res = client.get(f"{V1}/content/{item}/clips", params=params, headers=auth)
    assert res.status_code == 200, res.text
    body: list[dict[str, Any]] = res.json()
    return body


def stored_timeline(clip_id: str) -> Timeline:
    with session_scope() as db:
        edit = db.query(Edit).filter(Edit.clip_id == clip_id).one()
        return Timeline.model_validate(edit.timeline)


def test_generate_requires_processed_video(client: TestClient, auth: Hdr) -> None:
    item = client.post(f"{V1}/content", json={"title": "x"}, headers=auth).json()["id"]
    res = client.post(f"{V1}/content/{item}/clips/generate", headers=auth)
    assert res.status_code == 409 and res.json()["error"]["code"] == "ASSET_NOT_READY"
    assert client.post(f"{V1}/content/nope/clips/generate", headers=auth).status_code == 404
    assert client.get(f"{V1}/content/nope/clips", headers=auth).status_code == 404
    bad = client.post(f"{V1}/content/{item}/clips/generate", json={"count": 99}, headers=auth)
    assert bad.status_code == 422


def test_list_all_clips_across_items_with_filters(
    client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str
) -> None:
    item, _ = ready_item(client, auth, demo_media, workspace_id)
    generate(client, auth, item, count=2, include_full_cut=True)
    own = clips_of(client, auth, item)
    empty = client.post(f"{V1}/content", json={"title": "No clips"}, headers=auth).json()["id"]

    res = client.get(f"{V1}/clips", headers=auth)
    assert res.status_code == 200, res.text
    everything = res.json()
    assert {c["id"] for c in everything} == {c["id"] for c in own}
    assert [c["score"] for c in everything] == sorted(
        (c["score"] for c in everything), reverse=True
    )
    assert all(c["content_item_id"] == item and c["preview"]["url"] for c in everything)

    assert client.get(f"{V1}/clips", params={"content_item_id": empty}, headers=auth).json() == []
    full = client.get(f"{V1}/clips", params={"kind": "full"}, headers=auth).json()
    assert [c["kind"] for c in full] == ["full"]
    assert client.get(f"{V1}/clips", params={"status": "accepted"}, headers=auth).json() == []
    assert len(client.get(f"{V1}/clips", params={"limit": 1}, headers=auth).json()) == 1
    assert client.get(f"{V1}/clips", params={"status": "bogus"}, headers=auth).status_code == 422
    assert client.get(f"{V1}/clips").status_code == 401


def test_full_pipeline_with_mock_llm_edits_and_music(
    client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str
) -> None:
    item, asset_id = ready_item(client, auth, demo_media, workspace_id)
    with session_scope() as db:  # a library track tagged "music" (the file itself is not needed)
        db.add(
            Asset(
                workspace_id=workspace_id,
                kind="audio",
                filename="calm.mp3",
                mime="audio/mpeg",
                storage_key="x",
                size_bytes=1,
                sha256="m" * 64,
                duration_sec=120.0,
                status="ready",
                tags=["Music", "calm"],
            )
        )
        db.flush()
        music_id = db.query(Asset).filter(Asset.kind == "audio").one().id
    result = generate(client, auth, item, count=2, include_full_cut=True)
    assert result["asset_id"] == asset_id and result["full_cut"] is True and result["kept"] >= 1
    clips = clips_of(client, auth, item)
    shorts = [c for c in clips if c["kind"] == "short"]
    full = [c for c in clips if c["kind"] == "full"]
    assert 1 <= len(shorts) <= 2 and len(full) == 1 and clips[-1]["kind"] == "full"

    top = shorts[0]
    assert top["status"] == "suggested" and top["edit_revision"] == 1 and top["rank"] == 1
    assert top["title"].startswith("[MOCK]") and top["hook"] and top["caption"]
    assert top["provenance"]["source"] == "mock"
    assert top["provenance_by_part"]["scores"]["source"] == "heuristic"
    assert top["provenance_by_part"]["title"]["source"] == "mock"
    assert (
        top["preview"]["url"].startswith("/media/")
        and top["preview"]["end_sec"] > top["preview"]["start_sec"]
    )
    feats = top["features"]
    assert set(feats["raw"]) == {
        "beat_similarity",
        "hook_signals",
        "speech_rate",
        "audio_energy",
        "emphasis",
        "visual_change",
    }
    assert sum(feats["weights"].values()) == pytest.approx(1.0, abs=1e-3) and 0 <= top["score"] <= 1
    assert feats["weights"]["beat_similarity"] == pytest.approx(0.30)  # the item has a script
    assert top["thumbnail_url"]

    # timeline: validated, gapless, AI layers, captions, music, crop_x
    tl = stored_timeline(top["id"])
    assert ts.validate(tl, {asset_id: demo_media.duration, music_id: 120.0}) == []
    assert tl.aspect == "9:16" and tl.caption_style == "bold_center" and tl.tracks.captions
    assert all(
        v.source == "ai" and v.status == "suggested" and 0 <= v.crop_x <= 1 for v in tl.tracks.video
    )
    assert tl.duration <= top["end_sec"] - top["start_sec"] + 1e-6
    cuts = [v for v in tl.tracks.video if v.reason == "pause removed"]
    assert len(tl.tracks.video) == 1 + len(cuts)
    music = tl.tracks.audio[0]
    assert (music.kind, music.asset_id, music.gain_db, music.status, music.source) == (
        "music",
        music_id,
        -18.0,
        "suggested",
        "ai",
    )
    assert all(c.words for c in tl.tracks.captions) and tl.tracks.captions[0].source == "ai"

    full_tl = stored_timeline(full[0]["id"])
    assert full_tl.aspect == "16:9" and full_tl.caption_style == "minimal_bottom"
    assert (full_tl.width, full_tl.height) == (1920, 1080)
    assert full[0]["start_sec"] == 0 and full_tl.duration < demo_media.duration  # pauses removed
    assert full[0]["provenance"]["source"] == "heuristic"
    with session_scope() as db:
        assert db.query(EditRevision).count() == db.query(Edit).count() == len(clips)
        assert {r.revision for r in db.query(EditRevision)} == {1}
        assert db.query(ActivityLog).filter(ActivityLog.action == "clips_generated").count() == 1

    # copy edits become user provenance
    edited = client.patch(
        f"{V1}/clips/{top['id']}", json={"title": "My own title"}, headers=auth
    ).json()
    assert (
        edited["title"] == "My own title"
        and edited["provenance_by_part"]["title"]["source"] == "user"
    )
    assert (
        edited["provenance_by_part"]["hook"]["source"] == "mock"
        and edited["provenance"]["source"] == "mock"
    )
    assert (
        client.patch(f"{V1}/clips/{top['id']}", json={"bogus": 1}, headers=auth).status_code == 422
    )
    assert client.get(f"{V1}/clips/{top['id']}", headers=auth).json()["title"] == "My own title"
    assert client.get(f"{V1}/clips/nope", headers=auth).status_code == 404
    assert [c["id"] for c in clips_of(client, auth, item, kind="full")] == [full[0]["id"]]


def test_without_llm_falls_back_to_deterministic_copy_and_flags_it(
    client: TestClient,
    auth: Hdr,
    demo_media: Any,
    workspace_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item, _ = ready_item(client, auth, demo_media, workspace_id, script=False)
    wipe_provider_keys(monkeypatch, allow_mock=False)
    result = generate(client, auth, item)
    assert any(w.startswith("COPY_FALLBACK: LLM_NOT_CONFIGURED") for w in result["warnings"])
    clips = clips_of(client, auth, item)
    assert clips and all(c["kind"] == "short" for c in clips)
    for clip in clips:
        words = clip["caption"].split()
        assert clip["title"] == " ".join(clip["caption"].split()[:8])
        assert clip["caption"] and len(clip["caption"]) <= 150 and words
        assert clip["provenance"]["source"] == "heuristic"
        assert any(w.startswith("COPY_FALLBACK") for w in clip["warnings"])
        assert (
            clip["features"]["weights"].get("beat_similarity") is None
        )  # no script: redistributed
        assert sum(clip["features"]["weights"].values()) == pytest.approx(1.0, abs=1e-3)


def test_regenerating_replaces_untouched_suggestions_and_skips_decided_windows(
    client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str
) -> None:
    item, _ = ready_item(client, auth, demo_media, workspace_id)
    generate(client, auth, item, count=2)
    first = clips_of(client, auth, item)
    keep, drop = first[0], first[-1]
    assert client.post(f"{V1}/clips/{keep['id']}/accept", headers=auth).status_code == 200
    if drop["id"] != keep["id"]:
        client.post(f"{V1}/clips/{drop['id']}/reject", headers=auth)
    generate(client, auth, item, count=2)
    second = clips_of(client, auth, item)
    ids = {c["id"] for c in second}
    assert keep["id"] in ids  # accepted clips are never deleted
    # nothing new overlaps an accepted/rejected window by IoU >= 0.3
    decided = [c for c in second if c["status"] != "suggested"]
    for clip in second:
        if clip["status"] == "suggested":
            for d in decided:
                inter = min(clip["end_sec"], d["end_sec"]) - max(clip["start_sec"], d["start_sec"])
                union = max(clip["end_sec"], d["end_sec"]) - min(clip["start_sec"], d["start_sec"])
                assert inter <= 0 or inter / union < 0.3


def test_accept_emits_twin_event_after_commit_and_logs_activity(
    client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str
) -> None:
    item, _ = ready_item(client, auth, demo_media, workspace_id)
    generate(client, auth, item, count=1)
    clip = clips_of(client, auth, item)[0]
    seen: list[tuple[str, str, dict[str, Any]]] = []

    def listener(event: str, ws: str, payload: dict[str, Any]) -> None:
        with session_scope() as db:  # a listener may open its own session and write
            db.add(ActivityLog(workspace_id=ws, action="listener_ran", entity_type="clip", meta={}))
        seen.append((event, ws, payload))

    twin_events.register("clip_accepted", listener)
    try:
        res = client.post(f"{V1}/clips/{clip['id']}/accept", headers=auth)
        assert res.status_code == 200 and res.json()["status"] == "accepted"
        again = client.post(f"{V1}/clips/{clip['id']}/accept", headers=auth)
        assert again.status_code == 200
    finally:
        twin_events.clear()
    assert seen == [
        ("clip_accepted", workspace_id, {"clip_id": clip["id"], "content_item_id": item})
    ]
    activity = client.get(f"{V1}/activity", params={"action": "clip_accepted"}, headers=auth).json()
    assert activity["total"] == 1
    rejected = client.post(f"{V1}/clips/{clip['id']}/reject", headers=auth).json()
    assert rejected["status"] == "rejected"
    with session_scope() as db:
        assert db.query(Clip).filter(Clip.status == "rejected").count() == 1
        assert db.query(Job).filter(Job.type == "clips.generate").count() == 1
