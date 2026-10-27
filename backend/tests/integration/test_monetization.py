"""Monetization: deals pipeline, rate estimate, pitch, brand lookup, sponsor slots into a clip."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.errors import AppError
from app.services import monetization
from app.services import timeline_service as ts
from tests.helpers import V1, Hdr, seed_demo_asset, wipe_provider_keys


def deal(client: TestClient, auth: Hdr, **body: Any) -> dict[str, Any]:
    res = client.post(f"{V1}/monetization/deals", json={"brand": "Acme", **body}, headers=auth)
    assert res.status_code == 201, res.text
    out: dict[str, Any] = res.json()
    return out


# ── deals ─────────────────────────────────────────────────────────────────────────────────────
def test_deal_pipeline_and_summary(client: TestClient, auth: Hdr) -> None:
    a = deal(client, auth, website="acme.com", fee=1200, stage="pitched", due_date="2001-01-01")
    assert a["website"] == "https://acme.com" and a["overdue"] is True
    b = deal(client, auth, brand="Globex", fee=800, stage="paid")
    deal(client, auth, brand="Initech", fee=500, stage="lost")
    deal(client, auth, brand="Umbrella", fee=300, stage="contracted")

    res = client.patch(
        f"{V1}/monetization/deals/{a['id']}", json={"stage": "negotiating"}, headers=auth
    )
    assert res.status_code == 200 and res.json()["stage"] == "negotiating"
    assert (
        client.patch(
            f"{V1}/monetization/deals/{a['id']}", json={"stage": "won"}, headers=auth
        ).status_code
        == 422
    )

    s = client.get(f"{V1}/monetization/summary", headers=auth).json()
    assert s["total"] == 4 and s["currency"] == "USD"
    assert s["open_value"] == 1500.0  # negotiating 1200 + contracted 300
    assert s["booked_value"] == 300.0 and s["paid_value"] == 800.0
    assert s["average_paid_fee"] == 800.0
    assert s["win_rate"] == pytest.approx(2 / 3, abs=0.001)  # paid + contracted of 3 closed
    assert [d["brand"] for d in s["overdue"]] == ["Acme"]

    only = client.get(f"{V1}/monetization/deals", params={"stage": "paid"}, headers=auth).json()
    assert [d["id"] for d in only] == [b["id"]]
    assert client.delete(f"{V1}/monetization/deals/{b['id']}", headers=auth).status_code == 204
    assert client.delete(f"{V1}/monetization/deals/{b['id']}", headers=auth).status_code == 404
    assert (
        client.post(f"{V1}/monetization/deals", json={"brand": ""}, headers=auth).status_code == 422
    )
    assert client.get(f"{V1}/monetization/deals").status_code == 401


def test_deals_are_workspace_scoped(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "auth_allow_multi", True)
    mine = deal(client, auth)
    other = client.post(
        f"{V1}/auth/signup", json={"email": "other@example.com", "password": "another-pass-123"}
    )
    other_auth = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert client.get(f"{V1}/monetization/deals", headers=other_auth).json() == []
    res = client.patch(f"{V1}/monetization/deals/{mine['id']}", json={"fee": 1}, headers=other_auth)
    assert res.status_code == 404


def test_rate_estimate_is_a_labelled_formula(client: TestClient, auth: Hdr) -> None:
    deal(client, auth, fee=900, stage="paid")
    res = client.post(
        f"{V1}/monetization/rate",
        json={"avg_views": 20000, "cpm_low": 10, "cpm_high": 30},
        headers=auth,
    )
    body = res.json()
    assert (body["low"], body["mid"], body["high"]) == (200.0, 400.0, 600.0)
    assert body["provenance"]["source"] == "heuristic" and body["default_cpm"] is False
    assert body["history"] == {"paid_deals": 1, "average_fee": 900.0, "highest_fee": 900.0}
    default = client.post(f"{V1}/monetization/rate", json={"avg_views": 1000}, headers=auth).json()
    assert default["default_cpm"] is True and default["low"] == 20.0


def test_pitch_needs_a_model_and_uses_only_given_numbers(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    d = deal(client, auth, contact_name="Sam", fee=750, deliverables="a 60 second integration")
    wipe_provider_keys(monkeypatch, allow_mock=False)
    res = client.post(f"{V1}/monetization/deals/{d['id']}/pitch", json={}, headers=auth)
    assert res.status_code == 503 and res.json()["error"]["code"] == "LLM_NOT_CONFIGURED"
    wipe_provider_keys(monkeypatch, allow_mock=True)
    res = client.post(
        f"{V1}/monetization/deals/{d['id']}/pitch",
        json={"stats": {"avg_views": "12k"}},
        headers=auth,
    )
    assert res.status_code == 200, res.text
    pitch = res.json()["pitch"]
    assert pitch["subject"].startswith("[MOCK]") and "Hi Sam," in pitch["email"]
    assert pitch["provenance"]["source"] == "mock"
    assert "750 USD" in pitch["email"]


# ── brand lookup ──────────────────────────────────────────────────────────────────────────────
def _site(request: httpx.Request) -> httpx.Response:
    pages = {
        "/": '<html><head><title>Acme &amp; Co</title><meta name="description" content="Tools for makers">'
        '</head><body><a href="https://twitter.com/acme">x</a> logo@2x.png</body></html>',
        "/contact": '<a href="mailto:hello@acme.com">mail</a> press: press@agency.io',
        "/partnerships": "Creators: creators@acme.com",
    }
    body = pages.get(request.url.path)
    if body is None:
        return httpx.Response(404, text="nope", headers={"content-type": "text/html"})
    return httpx.Response(200, text=body, headers={"content-type": "text/html; charset=utf-8"})


def test_brand_lookup_reports_only_what_the_pages_print() -> None:
    out = monetization.brand_lookup("acme.com", transport=httpx.MockTransport(_site))
    assert out["site"] == "https://acme.com" and out["title"] == "Acme & Co"
    assert out["description"] == "Tools for makers"
    emails = [e["email"] for e in out["emails"]]
    assert emails == ["creators@acme.com", "hello@acme.com", "press@agency.io"]  # own domain first
    assert next(e for e in out["emails"] if e["email"] == "hello@acme.com")["found_on"].endswith(
        "/contact"
    )
    assert out["socials"] == {"x": "https://twitter.com/acme"}
    assert {p["status"] for p in out["pages"]} == {200, 404}


def test_brand_lookup_refuses_private_hosts_and_unreachable_sites(
    client: TestClient, auth: Hdr
) -> None:
    res = client.post(
        f"{V1}/monetization/lookup", json={"website": "http://127.0.0.1:8000"}, headers=auth
    )
    assert res.status_code == 422
    with pytest.raises(AppError) as err:
        monetization.brand_lookup(
            "down.example", transport=httpx.MockTransport(lambda r: httpx.Response(503))
        )
    assert err.value.code == "DOWNLOAD_FAILED"


# ── sponsor slots ─────────────────────────────────────────────────────────────────────────────
def _project_with_cut(client: TestClient, auth: Hdr, media: Any, ws: str) -> tuple[str, str, str]:
    item = client.post(f"{V1}/content", json={"title": "Editing workflow"}, headers=auth).json()[
        "id"
    ]
    asset_id = seed_demo_asset(client, auth, media, item, ws)
    res = client.post(
        f"{V1}/content/{item}/clips/generate",
        json={"count": 1, "include_full_cut": True},
        headers=auth,
    )
    assert res.status_code == 202, res.text
    clips = client.get(f"{V1}/content/{item}/clips", params={"kind": "full"}, headers=auth).json()
    return item, asset_id, clips[0]["id"]


def test_brief_find_slots_and_accept_into_the_full_cut(
    client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str
) -> None:
    item, asset_id, full = _project_with_cut(client, auth, demo_media, workspace_id)
    body = {
        "brand": "Acme",
        "product": "Acme Cloud",
        "key_points": ["syncs fast"],
        "cta": "Use code CREATOR.",
        "duration_sec": 12,
    }
    brief = client.post(f"{V1}/content/{item}/sponsors", json=body, headers=auth)
    assert brief.status_code == 201, brief.text
    bid = brief.json()["id"]
    assert (
        client.post(f"{V1}/content/{item}/sponsors", json={"brand": "x"}, headers=auth).status_code
        == 422
    )

    found = client.post(f"{V1}/sponsors/{bid}/find-slots", json={}, headers=auth)
    assert found.status_code == 200, found.text
    out = found.json()
    assert out["asset_id"] == asset_id and 1 <= len(out["slots"]) <= 3
    slot = out["slots"][0]
    assert (
        slot["integration_script"].startswith("[MOCK]") and slot["provenance"]["source"] == "mock"
    )
    assert 15.0 <= slot["at_sec"] <= demo_media.duration - 20.0

    edited = client.patch(
        f"{V1}/sponsor-slots/{slot['id']}",
        json={"integration_script": "My own read."},
        headers=auth,
    )
    assert edited.json()["provenance"]["source"] == "user"

    before = client.get(f"{V1}/clips/{full}/edit", headers=auth).json()
    acc = client.post(
        f"{V1}/sponsor-slots/{slot['id']}/accept", json={"clip_id": full}, headers=auth
    )
    assert acc.status_code == 200, acc.text
    assert acc.json()["revision"] == before["revision"] + 1
    after = client.get(f"{V1}/clips/{full}/edit", headers=auth).json()
    tl = ts.parse_timeline(after["timeline"])
    sponsor = [v for v in tl.tracks.video if v.kind == "sponsor"]
    assert len(sponsor) == 1 and sponsor[0].text == "My own read."
    assert after["timeline"]["duration"] == pytest.approx(
        before["timeline"]["duration"] + 12, abs=0.01
    )
    assert any(o["text"] == "Sponsored · Acme" for o in after["timeline"]["tracks"]["overlays"])
    assert after["violations"] == []
    again = client.post(
        f"{V1}/sponsor-slots/{slot['id']}/accept", json={"clip_id": full}, headers=auth
    )
    assert again.status_code == 409

    # finding again keeps the accepted slot and replaces only the suggestions
    listed = client.get(f"{V1}/content/{item}/sponsors", headers=auth).json()[0]["slots"]
    assert any(s["status"] == "accepted" for s in listed)
    client.post(f"{V1}/sponsors/{bid}/find-slots", json={}, headers=auth)
    relisted = client.get(f"{V1}/content/{item}/sponsors", headers=auth).json()[0]["slots"]
    assert sum(s["status"] == "accepted" for s in relisted) == 1

    from app.db import session_scope
    from app.services.sponsor_service import disclosure_brands

    with session_scope() as db:
        assert disclosure_brands(db, workspace_id, full) == ["Acme"]


def test_slots_without_a_model_are_found_but_not_written(
    client: TestClient,
    auth: Hdr,
    demo_media: Any,
    workspace_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = client.post(f"{V1}/content", json={"title": "Raw"}, headers=auth).json()["id"]
    seed_demo_asset(client, auth, demo_media, item, workspace_id)
    bid = client.post(
        f"{V1}/content/{item}/sponsors", json={"brand": "Acme", "product": "Cloud"}, headers=auth
    ).json()["id"]
    wipe_provider_keys(monkeypatch, allow_mock=False)
    out = client.post(f"{V1}/sponsors/{bid}/find-slots", json={}, headers=auth).json()
    assert out["slots"] and all(s["integration_script"] == "" for s in out["slots"])
    assert all(s["provenance"]["source"] == "heuristic" for s in out["slots"])
    assert any("no AI provider" in w for w in out["warnings"])


def test_slot_outside_the_clip_is_refused(
    client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str
) -> None:
    item, _, full = _project_with_cut(client, auth, demo_media, workspace_id)
    bid = client.post(
        f"{V1}/content/{item}/sponsors", json={"brand": "Acme", "product": "Cloud"}, headers=auth
    ).json()["id"]
    slot = client.post(f"{V1}/sponsors/{bid}/find-slots", json={}, headers=auth).json()["slots"][0]
    edit = client.get(f"{V1}/clips/{full}/edit", headers=auth).json()
    tl = ts.parse_timeline(edit["timeline"])
    keep = [v for v in tl.tracks.video if not (v.src_in <= slot["at_sec"] < v.src_out)]
    tl.tracks.video = keep[:1]
    tl = ts.recompute_duration(tl)
    tl.tracks.captions, tl.tracks.overlays = [], []
    put = client.put(
        f"{V1}/clips/{full}/edit",
        json={"timeline": tl.dump(), "base_revision": edit["revision"]},
        headers=auth,
    )
    assert put.status_code == 200, put.text
    res = client.post(
        f"{V1}/sponsor-slots/{slot['id']}/accept", json={"clip_id": full}, headers=auth
    )
    assert res.status_code == 422 and res.json()["error"]["code"] == "SLOT_OUTSIDE_CLIP"
