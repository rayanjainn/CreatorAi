"""AI Director: plan, shot-list edits and export, deterministic review with an LLM voice."""

from __future__ import annotations

import csv
import io
import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.models import (
    Asset,
    AssetSegment,
    BeatMatch,
    ContentItem,
    DirectorOutput,
    Script,
    ScriptBeat,
)
from tests.helpers import V1, Hdr, gemini_gateway, install_gateway, wipe_provider_keys

SEGMENTS = [
    (1.0, 8.0, "Why do most creators waste 10 hours editing?"),
    (10.0, 40.0, "Um, you know, I basically cut everything. Actually it is like simple."),
    (45.0, 59.0, "Subscribe for more tips."),
]
SILENCES = [[8.0, 11.0], [30.0, 33.5], [40.0, 40.5]]


def new_item(client: TestClient, auth: Hdr, **extra: Any) -> str:
    res = client.post(
        f"{V1}/content", json={"title": "Editing in 10 minutes", **extra}, headers=auth
    )
    return str(res.json()["id"])


def plan(client: TestClient, auth: Hdr, item: str, **body: Any) -> dict[str, Any]:
    res = client.post(f"{V1}/content/{item}/director/plan", json=body, headers=auth)
    assert res.status_code == 200, res.text
    out: dict[str, Any] = res.json()
    return out


def add_footage(
    ws: str, item: str, *, status: str = "ready", segments: bool = True, aid: str = "a1"
) -> None:
    with session_scope() as db:
        db.add(
            Asset(
                id=aid,
                workspace_id=ws,
                content_item_id=item,
                kind="video",
                filename=f"{aid}.mp4",
                storage_key="k",
                mime="video/mp4",
                size_bytes=1,
                sha256=aid,
                status=status,
                duration_sec=60.0,
                analysis={"silences": SILENCES, "provenance": {"transcribe": {"source": "user"}}},
            )
        )
        db.flush()
        if segments:
            for i, (s, e, text) in enumerate(SEGMENTS):
                db.add(
                    AssetSegment(
                        workspace_id=ws, asset_id=aid, idx=i, start_sec=s, end_sec=e, text=text
                    )
                )


def add_script_and_matches(ws: str, item: str) -> None:
    statuses = {(0, 0): "matched", (0, 1): "weak", (1, 0): "missing", (1, 1): "confirmed"}
    with session_scope() as db:
        script = Script(workspace_id=ws, content_item_id=item, version=1, is_current=True)
        db.add(script)
        db.flush()
        for (si, bi), status in statuses.items():
            beat = ScriptBeat(
                workspace_id=ws,
                script_id=script.id,
                scene_idx=si,
                beat_idx=bi,
                text=f"beat {si}.{bi}",
            )
            db.add(beat)
            db.flush()
            db.add(
                BeatMatch(
                    workspace_id=ws, content_item_id=item, script_beat_id=beat.id, status=status
                )
            )


# ── plan ──────────────────────────────────────────────────────────────────────────────────────
def test_plan_defaults_persist_and_validate(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth, target_duration_sec=60)
    out = plan(client, auth, item, objective="Teach beginners", audience="new creators")
    assert out["version"] == 1 and out["provenance"] == {
        "source": "mock",
        "provider": "mock",
        "model": "mock-v1",
    }
    p = out["plan"]
    assert p["domain"] == "technology"  # the profile's domain
    assert p["objective"] == "Teach beginners" and p["audience"] == "new creators"
    total = sum(s["duration_sec"] for s in p["structure"])
    assert 54 <= total <= 66  # within 10 % of the 60 s target
    assert [s["scene"] for s in p["shot_list"]] == list(range(1, len(p["structure"]) + 1))
    assert out["inputs"] == {
        "platform": "youtube_shorts",
        "target_duration_sec": 60,
        "domain": "technology",
    }
    assert (
        len(out["shot_provenance"]) == len(p["shot_list"])
        and out["shot_provenance"][0]["source"] == "mock"
    )
    assert p["angle"].startswith("[MOCK]")

    # persisted with the payload (provenance in payload.meta) and the item adopted the inputs
    with session_scope() as db:
        row = db.query(DirectorOutput).filter_by(content_item_id=item, kind="plan").one()
        meta = row.payload["meta"]
        assert (
            meta["provenance"]["provider"] == "mock" and meta["inputs"]["target_duration_sec"] == 60
        )
        stored = db.get(ContentItem, item)
        assert (
            stored is not None
            and stored.objective == "Teach beginners"
            and stored.domain == "technology"
        )

    again = plan(client, auth, item, domain="education", target_duration_sec=30, platform="shorts")
    assert again["version"] == 2 and again["plan"]["domain"] == "education"
    assert round(sum(s["duration_sec"] for s in again["plan"]["structure"])) == 30
    latest = client.get(f"{V1}/content/{item}/director/plan", headers=auth).json()
    assert latest["version"] == 2
    first = client.get(
        f"{V1}/content/{item}/director/plan", params={"version": 1}, headers=auth
    ).json()
    assert first["id"] == out["id"]
    versions = client.get(f"{V1}/content/{item}/director/plan/versions", headers=auth).json()
    assert [v["version"] for v in versions] == [2, 1] and versions[0]["scenes"] == len(
        again["plan"]["structure"]
    )
    assert (
        client.get(
            f"{V1}/content/{item}/director/plan", params={"version": 9}, headers=auth
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"{V1}/content/{item}/director/plan", json={"domain": "cooking"}, headers=auth
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{V1}/content/{item}/director/plan", json={"target_duration_sec": 1}, headers=auth
        ).status_code
        == 422
    )
    assert client.post(f"{V1}/content/nope/director/plan", json={}, headers=auth).status_code == 404


def test_no_plan_is_a_clean_409(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    for method, path in (("get", "plan"), ("get", "plan/export?format=md"), ("patch", "plan")):
        res = client.request(
            method,
            f"{V1}/content/{item}/director/{path}",
            json={"shot_list": [{"scene": 1, "shot_type": "a", "framing": "b"}]}
            if method == "patch"
            else None,
            headers=auth,
        )
        assert res.status_code == 409 and res.json()["error"]["code"] == "NO_PLAN", path
    assert client.get(f"{V1}/content/{item}/director/plan/versions", headers=auth).json() == []


def plan_reply(structure_seconds: list[float], shots: int) -> Any:
    def reply(request: httpx.Request) -> httpx.Response:
        payload = {
            "domain": "technology", "objective": "o", "audience": "a", "angle": "A real angle",
            "structure": [
                {"section": n, "goal": "g", "duration_sec": d, "notes": ""}
                for n, d in zip(["Hook", "Setup", "Step by step", "Proof", "CTA"], structure_seconds, strict=False)
            ],
            "storytelling": ["x"],
            "shot_list": [
                {"scene": i + 1, "shot_type": "wide", "framing": "f", "b_roll": "", "note": "n"} for i in range(shots)
            ],
            "hook_ideas": ["h"], "cta": "c", "risks": ["r"],
        }  # fmt: skip
        return httpx.Response(
            200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}
        )

    return reply


def test_plan_fixups_rescale_durations_and_fill_shots(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_gateway(monkeypatch, gemini_gateway(plan_reply([10, 10, 10, 10, 10], shots=2)))
    item = new_item(client, auth)
    out = plan(client, auth, item, target_duration_sec=100, domain="technology")
    assert out["provenance"]["source"] == "ai" and out["provenance"]["provider"] == "gemini"
    p = out["plan"]
    assert [s["duration_sec"] for s in p["structure"]] == [20.0] * 5  # 50 s -> 100 s, exact
    assert len(p["shot_list"]) == 5 and p["shot_list"][0]["shot_type"] == "wide"
    assert p["shot_list"][2]["shot_type"] == "screen recording"  # template shot for "Step by step"
    assert any("rescaled" in f for f in out["fixups"]) and any("fitted" in f for f in out["fixups"])


def test_plan_within_tolerance_is_left_alone(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_gateway(
        monkeypatch, gemini_gateway(plan_reply([4, 12, 20, 8, 5], shots=5))
    )  # 49 s for 50
    item = new_item(client, auth)
    out = plan(client, auth, item, target_duration_sec=50)
    assert [s["duration_sec"] for s in out["plan"]["structure"]] == [4, 12, 20, 8, 5]
    assert out["fixups"] == []


def test_shot_list_edits_mark_user_rows_and_export(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    created = plan(client, auth, item)
    shots = created["plan"]["shot_list"]
    edited = [dict(s) for s in shots]
    edited[1]["framing"] = "my own framing, with comma"
    res = client.patch(
        f"{V1}/content/{item}/director/plan", json={"shot_list": edited}, headers=auth
    )
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["edited_by_user"] == {"shot_list": [2]}
    assert [p["source"] for p in out["shot_provenance"]] == ["mock", "user", "mock", "mock", "mock"]
    assert out["provenance"]["source"] == "mock"  # weakest of the rows
    assert out["version"] == 1  # edited in place
    assert out["plan"]["shot_list"][1]["framing"] == "my own framing, with comma"

    bad = client.patch(
        f"{V1}/content/{item}/director/plan", json={"shot_list": edited[:2]}, headers=auth
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "VALIDATION_ERROR"

    csv_res = client.get(
        f"{V1}/content/{item}/director/plan/export", params={"format": "csv"}, headers=auth
    )
    assert csv_res.status_code == 200 and csv_res.headers["content-type"].startswith("text/csv")
    assert "director-plan-v1.csv" in csv_res.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(csv_res.text)))
    assert len(rows) == 5 and rows[1]["framing"] == "my own framing, with comma"
    assert [r["source"] for r in rows] == ["mock", "user", "mock", "mock", "mock"]
    assert rows[0]["section"] == "Hook" and rows[0]["scene"] == "1"

    md = client.get(
        f"{V1}/content/{item}/director/plan/export", params={"format": "md"}, headers=auth
    )
    assert md.status_code == 200 and md.headers["content-type"].startswith("text/markdown")
    assert (
        "# Director plan v1" in md.text and "## Shot list" in md.text and "Source: mock" in md.text
    )
    assert (
        client.get(
            f"{V1}/content/{item}/director/plan/export", params={"format": "pdf"}, headers=auth
        ).status_code
        == 422
    )


# ── review ────────────────────────────────────────────────────────────────────────────────────
def review(client: TestClient, auth: Hdr, item: str) -> dict[str, Any]:
    res = client.post(f"{V1}/content/{item}/director/review", headers=auth)
    assert res.status_code == 200, res.text
    out: dict[str, Any] = res.json()
    return out


def test_review_needs_ready_footage_with_a_transcript(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    item = new_item(client, auth)
    res = client.post(f"{V1}/content/{item}/director/review", headers=auth)
    assert res.status_code == 409 and res.json()["error"]["code"] == "ASSET_NOT_READY"
    add_footage(workspace_id, item, status="processing", aid="p1")
    res = client.post(f"{V1}/content/{item}/director/review", headers=auth)
    assert res.status_code == 409 and res.json()["error"]["details"]["pending_assets"] == ["p1"]
    add_footage(workspace_id, item, segments=False, aid="r1")
    res = client.post(f"{V1}/content/{item}/director/review", headers=auth)
    assert res.status_code == 409 and res.json()["error"]["details"]["reason"] == "no_transcript"
    assert client.get(f"{V1}/content/{item}/director/review", headers=auth).status_code == 404


def test_review_without_matches_leaves_coverage_unknown(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    item = new_item(client, auth)
    add_footage(workspace_id, item)
    out = review(client, auth, item)
    assert out["scores"] == {
        "hook": 82.5,
        "clarity": 40.0,
        "pacing": 28.3,
        "coverage": None,
        "cta": 100.0,
    }
    assert out["overall_score"] == 59.1  # renormalised over the four known scores
    assert out["metrics"]["coverage_known"] is False and out["metrics"]["wpm"] == 24.0
    assert {w["code"] for w in out["warnings"]} == {"NO_SCRIPT"}
    assert out["missing_scenes"] == []
    assert out["assets_used"][0]["asset_id"] == "a1"
    assert out["version"] == 1
    # the mock's issues come from the candidate set: silences and the filler window
    assert out["issues"] and all(i["fix"] for i in out["issues"])
    assert {i["at_sec"] for i in out["issues"]} <= {30.0, 8.0, 0.0}
    assert out["strengths"][0].startswith("[MOCK]")
    # provenance: scores are rule-based (user transcript), the wording is the model's
    assert out["provenance_by_part"]["scores"]["source"] == "heuristic"
    assert out["provenance_by_part"]["text"] == {
        "source": "mock",
        "provider": "mock",
        "model": "mock-v1",
    }
    assert out["provenance"]["source"] == "mock"


def test_review_with_matches_has_coverage_and_missing_scenes(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    item = new_item(client, auth)
    add_footage(workspace_id, item)
    add_script_and_matches(workspace_id, item)
    out = review(client, auth, item)
    assert out["scores"]["coverage"] == 62.5 and out["overall_score"] == 59.9
    assert out["warnings"] == []
    assert out["missing_scenes"] == [
        {
            "scene_idx": 1,
            "beat_idx": 0,
            "text": "beat 1.0",
            "suggestion": "Shoot or upload footage that shows: beat 1.0",
        }
    ]
    cands = out["metrics"]["candidates"]
    assert [c["type"] for c in cands] == ["pacing", "pacing", "coverage", "coverage", "clarity"]
    scenes = {i["scene_idx"] for i in out["issues"] if i["type"] == "coverage"}
    assert scenes <= {0, 1}
    stored = client.get(f"{V1}/content/{item}/director/review", headers=auth).json()
    assert stored["id"] == out["id"] and stored["scores"] == out["scores"]
    again = review(client, auth, item)
    assert again["version"] == 2
    versions = client.get(f"{V1}/content/{item}/director/review/versions", headers=auth).json()
    assert [v["version"] for v in versions] == [2, 1] and versions[0]["overall_score"] == 59.9
    assert (
        client.get(
            f"{V1}/content/{item}/director/review", params={"version": 1}, headers=auth
        ).json()["id"]
        == out["id"]
    )


def review_reply(request: httpx.Request) -> httpx.Response:
    payload = {
        "strengths": ["Great opening question"],
        "issues": [
            {"type": "pacing", "severity": "low", "at_sec": 99.0, "fix": "Invented timestamp"},
            {"type": "pacing", "severity": "low", "at_sec": 30.3, "fix": "Cut the 3.5 s pause"},
            {"type": "coverage", "severity": "low", "scene_idx": 7, "fix": "Invented scene"},
            {
                "type": "coverage",
                "severity": "high",
                "scene_idx": 1,
                "fix": "Reshoot the export part",
            },
        ],
        "suggestions": ["Open faster"],
        "scores": {"hook": 100, "overall": 100},  # attempts to change the scores are ignored
        "overall_score": 100,
    }
    return httpx.Response(
        200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}
    )


def test_review_snaps_issues_and_ignores_model_scores(
    client: TestClient, auth: Hdr, workspace_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_gateway(monkeypatch, gemini_gateway(review_reply))
    item = new_item(client, auth)
    add_footage(workspace_id, item)
    add_script_and_matches(workspace_id, item)
    out = review(client, auth, item)
    assert out["scores"]["hook"] == 82.5 and out["overall_score"] == 59.9
    assert [(i["type"], i["at_sec"], i["scene_idx"], i["fix"]) for i in out["issues"]] == [
        ("pacing", 30.0, None, "Cut the 3.5 s pause"),
        ("coverage", None, 1, "Reshoot the export part"),
    ]
    assert out["issues"][0]["severity"] == "medium" and out["issues"][0]["asset_id"] == "a1"
    assert out["issues"][0]["asset_sec"] == 30.0
    assert out["strengths"] == ["Great opening question"] and out["suggestions"] == ["Open faster"]
    # real wording + rule-based scores: the weakest source is reported, with the parts broken out
    assert out["provenance_by_part"]["text"]["provider"] == "gemini"
    assert out["provenance"]["source"] == "heuristic"
    with session_scope() as db:
        row = db.query(DirectorOutput).filter_by(content_item_id=item, kind="review").one()
        assert row.payload["meta"]["dropped_issues"] == 2
        assert row.metrics["words"] == 24 and row.metrics["candidates"]


def test_review_surfaces_llm_errors_without_writing(
    client: TestClient, auth: Hdr, workspace_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = new_item(client, auth)
    add_footage(workspace_id, item)
    wipe_provider_keys(monkeypatch, allow_mock=False)
    res = client.post(f"{V1}/content/{item}/director/review", headers=auth)
    assert res.status_code == 503 and res.json()["error"]["code"] == "LLM_NOT_CONFIGURED"
    assert client.get(f"{V1}/content/{item}/director/review/versions", headers=auth).json() == []
