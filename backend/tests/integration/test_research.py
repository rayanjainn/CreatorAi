"""Research agent: needs a search key, cites only URLs the search returned."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.services import research
from tests.helpers import V1, Hdr

RESULTS = [
    {
        "title": "Pacing guide",
        "url": "https://example.com/pacing",
        "snippet": "Cut every 3 seconds.",
    },
    {
        "title": "Hooks study",
        "url": "https://example.org/hooks/",
        "snippet": "Hooks decide retention.",
    },
]


def test_restrict_sources_drops_invented_urls() -> None:
    doc = {
        "summary": "s",
        "key_points": ["k"],
        "trends": [],
        "sources": [
            {"title": "ok", "url": "https://example.org/hooks"},
            {"title": "made up", "url": "https://nowhere.test/x"},
            {"title": "dup", "url": "https://example.org/hooks/"},
        ],
    }
    out = research.restrict_sources(doc, RESULTS)
    assert [s["url"] for s in out["sources"]] == ["https://example.org/hooks/"]


def test_without_a_search_key_it_says_so(client: TestClient, auth: Hdr) -> None:
    res = client.post(f"{V1}/research", json={"topic": "video pacing"}, headers=auth)
    assert res.status_code == 503 and res.json()["error"]["code"] == "SEARCH_NOT_CONFIGURED"


def test_brief_is_stored_with_cited_sources(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.integrations.websearch.get_search", lambda: lambda q, limit=8: RESULTS)
    res = client.post(f"{V1}/research", json={"topic": "video pacing"}, headers=auth)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["provenance"]["source"] in ("ai", "mock")
    assert {s["url"] for s in body["doc"]["sources"]} <= {r["url"] for r in RESULTS}
    assert len(client.get(f"{V1}/research", headers=auth).json()) == 1
