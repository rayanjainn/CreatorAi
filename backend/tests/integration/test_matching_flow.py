"""project.match end to end on generated demo footage (hashing embedder, mock LLM)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.models import BeatMatch, Job, ScriptBeat
from app.services import match_service
from tests.helpers import (
    V1,
    Hdr,
    make_item_with_script,
    seed_demo_asset,
    upload_file,
    wipe_provider_keys,
)


def footage(client: TestClient, auth: Hdr, media: Any, item: str, workspace_id: str) -> str:
    """Seed processed footage and run matching (what the after-ready hook does on upload)."""
    asset_id = seed_demo_asset(client, auth, media, item, workspace_id)
    assert client.post(f"{V1}/content/{item}/match", headers=auth).status_code == 202
    return asset_id


def get_match(client: TestClient, auth: Hdr, item: str) -> dict[str, Any]:
    res = client.get(f"{V1}/content/{item}/match", headers=auth)
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


def jobs_of(item: str) -> list[Job]:
    with session_scope() as db:
        rows = db.query(Job).filter(Job.type == "project.match", Job.entity_id == item).all()
        db.expunge_all()
        return rows


def test_match_requires_script_and_ready_footage(
    client: TestClient, auth: Hdr, demo_media: Any
) -> None:
    item = client.post(f"{V1}/content", json={"title": "x"}, headers=auth).json()["id"]
    res = client.post(f"{V1}/content/{item}/match", headers=auth)
    assert res.status_code == 409 and res.json()["error"]["code"] == "NO_SCRIPT"
    item, _ = make_item_with_script(client, auth)
    res = client.post(f"{V1}/content/{item}/match", headers=auth)
    assert res.status_code == 409 and res.json()["error"]["code"] == "ASSET_NOT_READY"
    assert client.get(f"{V1}/content/{item}/match", headers=auth).json()["ran"] is False
    assert client.post(f"{V1}/content/nope/match", headers=auth).status_code == 404
    assert client.post(f"{V1}/content/{item}/match").status_code == 401


def test_hook_matches_automatically_then_user_decisions_survive_a_rerun(
    client: TestClient, auth: Hdr, demo_media: Any
) -> None:
    item, script = make_item_with_script(client, auth)
    body = upload_file(
        client, auth, demo_media.video, sidecar=demo_media.sidecar, content_item_id=item
    )
    asset = body["asset"]  # after_asset_ready -> project.match
    assert asset["status"] == "ready"
    runs = jobs_of(item)
    assert (
        len(runs) == 1
        and runs[0].status == "succeeded"
        and runs[0].payload["trigger"] == "asset_ready"
    )
    assert sum(runs[0].result["counts"].values()) == 5

    body = get_match(client, auth, item)
    assert body["ran"] and body["script_version"] == script["version"]
    assert body["provenance"]["source"] == "heuristic"
    assert body["embedder"]["backend"] == "hashing" and body["embedder"]["match_weak"] == 0.15
    beats = {b["text"][:12]: b for b in body["beats"]}
    assert len(body["beats"]) == 5
    # monotonic: matched beats appear in footage order
    spans = [
        b["start_sec"] for b in body["beats"] if b["status"] in ("matched", "weak", "confirmed")
    ]
    assert spans == sorted(spans)
    first = beats["Here is how "]
    assert first["status"] in ("matched", "weak") and first["start_sec"] < 3
    if first["out_of_order"]:  # finer beats than segments: it shares the take of beat 2
        assert first["shared_span"] is True
    assert first["asset_id"] == asset["id"] and first["thumbnail_url"].startswith("/media/")
    assert first["preview_url"].startswith("/media/") and first["timecode"].startswith("00:0")
    assert first["provenance"]["source"] == "heuristic" and first["matched_text"]
    assert 1 <= len(first["alternatives"]) <= 3 and first["alternatives"][0]["is_current"]
    trim = beats["Next I trim "]
    assert trim["status"] in ("matched", "weak") and "pauses" in trim["matched_text"]
    missing = beats["Quantum chro"]
    assert missing["status"] == "missing" and missing["asset_id"] is None
    cov = body["coverage"]
    assert (
        cov["total"] == 5
        and cov["missing"] == 1
        and cov["coverage_pct"]
        == pytest.approx(100 * (cov["matched"] + cov["confirmed"] + 0.5 * cov["weak"]) / 5, abs=0.1)
    )
    assert [s["title"] for s in body["missing_scenes"]] == ["Missing"]
    scene = body["missing_scenes"][0]
    assert "Quantum" in scene["suggestion"] and scene["provenance"]["source"] == "heuristic"
    assert scene["kind"] == "missing" and scene["beat_ids"] == [missing["script_beat_id"]]

    # user decisions: confirm one, reject another, swap the third
    a, b, c = (beats["Here is how "], beats["Next I trim "], beats["The first st"])
    confirmed = client.post(f"{V1}/beat-matches/{a['match_id']}/confirm", headers=auth).json()
    assert confirmed["status"] == "confirmed" and confirmed["provenance"]["source"] == "user"
    rejected = client.post(f"{V1}/beat-matches/{b['match_id']}/reject", headers=auth).json()
    assert rejected["status"] == "rejected"
    alt = c["alternatives"][-1]
    swapped = client.post(
        f"{V1}/beat-matches/{c['match_id']}/swap",
        json={"alternative_index": c["alternatives"][-1]["index"]},
        headers=auth,
    ).json()
    assert swapped["status"] == "confirmed" and swapped["start_sec"] == alt["start_sec"]
    assert swapped["provenance"]["source"] == "user"

    rerun = client.post(f"{V1}/content/{item}/match", headers=auth)
    assert rerun.status_code == 202
    again = get_match(client, auth, item)
    by_id = {x["script_beat_id"]: x for x in again["beats"]}
    assert by_id[a["script_beat_id"]]["status"] == "confirmed"
    assert by_id[b["script_beat_id"]]["status"] == "rejected"
    assert by_id[c["script_beat_id"]]["start_sec"] == alt["start_sec"]
    assert again["job"]["status"] == "succeeded"
    assert jobs_of(item)[-1].result["preserved"] == 3


def test_swap_custom_range_validation_and_isolation(
    client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str
) -> None:
    item, _ = make_item_with_script(client, auth)
    asset_id = footage(client, auth, demo_media, item, workspace_id)
    row = get_match(client, auth, item)["beats"][0]
    url = f"{V1}/beat-matches/{row['match_id']}/swap"
    ok = client.post(
        url, json={"asset_id": asset_id, "start_sec": 10.0, "end_sec": 14.5}, headers=auth
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert (body["start_sec"], body["end_sec"], body["status"]) == (10.0, 14.5, "confirmed")
    assert body["alternatives"][0]["start_sec"] == 10.0 and len(body["alternatives"]) <= 4
    for bad in (
        {},
        {"alternative_index": 0, "asset_id": asset_id},
        {"asset_id": asset_id, "start_sec": 5},
        {"asset_id": asset_id, "start_sec": 9, "end_sec": 3},
        {"asset_id": asset_id, "start_sec": 1, "end_sec": 9999},
        {"asset_id": "nope", "start_sec": 1, "end_sec": 3},
        {"alternative_index": 9},
    ):
        assert client.post(url, json=bad, headers=auth).status_code == 422, bad
    assert (
        client.post(
            f"{V1}/beat-matches/nope/swap", json={"alternative_index": 0}, headers=auth
        ).status_code
        == 404
    )
    unmatched = next(b for b in get_match(client, auth, item)["beats"] if b["status"] == "missing")
    assert (
        client.post(f"{V1}/beat-matches/{unmatched['match_id']}/confirm", headers=auth).status_code
        == 409
    )


def test_script_edit_does_not_auto_match_and_beats_are_reembedded_on_backend_change(
    client: TestClient,
    auth: Hdr,
    demo_media: Any,
    workspace_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item, script = make_item_with_script(client, auth)
    footage(client, auth, demo_media, item, workspace_id)
    assert len(jobs_of(item)) == 1
    edited = [{"title": "Intro", "text": "Here is how I edit a video from start to finish."}]
    assert (
        client.patch(
            f"{V1}/scripts/{script['id']}", json={"scenes": edited}, headers=auth
        ).status_code
        == 200
    )
    assert len(jobs_of(item)) == 1  # editing never enqueues matching
    # pretend the beats were embedded with another backend: the job re-embeds them first
    from app.models import Script

    with session_scope() as db:
        row = db.get(Script, script["id"])
        assert row is not None
        row.meta = {**row.meta, "beats_embedding": {"backend": "fastembed", "model": "other"}}
        for beat in db.query(ScriptBeat).filter(ScriptBeat.script_id == script["id"]):
            beat.embedding = None
    assert client.post(f"{V1}/content/{item}/match", headers=auth).status_code == 202
    result = jobs_of(item)[-1].result
    assert result["reembedded_beats"] is True
    assert any("re-embedded" in n for n in result["notes"])
    assert all(b["status"] != "unmatched" for b in get_match(client, auth, item)["beats"])


def test_ambiguity_calls_the_llm_only_when_configured(
    client: TestClient,
    auth: Hdr,
    demo_media: Any,
    workspace_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(match_service, "AMBIGUITY_MARGIN", 5.0)  # every close pair is ambiguous
    item, _ = make_item_with_script(client, auth)
    footage(client, auth, demo_media, item, workspace_id)
    result = jobs_of(item)[-1].result
    assert 1 <= result["disambiguated"] <= 3  # mock LLM is enabled in tests
    body = get_match(client, auth, item)
    assert body["provenance"]["source"] == "mock"  # weakest of embedder and the mock model
    with session_scope() as db:
        rows = db.query(BeatMatch).all()
        assert any((r.provenance or {}).get("disambiguation") for r in rows)

    wipe_provider_keys(monkeypatch, allow_mock=False)
    assert client.post(f"{V1}/content/{item}/match", headers=auth).status_code == 202
    last = jobs_of(item)[-1]
    assert last.status == "succeeded" and last.result["disambiguated"] == 0
    assert any("no LLM" in n for n in last.result["notes"])
    assert get_match(client, auth, item)["provenance"]["source"] == "heuristic"
