"""Creator intelligence: production counts, honest empty state, and the viewer can read it."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.helpers import V1, Hdr


def test_empty_workspace_reports_zeros_and_a_starting_nudge(client: TestClient, auth: Hdr) -> None:
    r = client.get(f"{V1}/insights/production", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pipeline"]["total"] == 0
    assert body["clips"]["accept_rate"] is None  # not enough decisions to say anything
    assert body["performance"]["available"] is False
    assert body["provenance"]["source"] == "user"
    assert [n["kind"] for n in body["nudges"]] == ["start"]
    assert len(body["activity"]) == 30


def test_counts_follow_the_board(client: TestClient, auth: Hdr) -> None:
    for t in ("One", "Two", "Three"):
        assert client.post(f"{V1}/content", json={"title": t}, headers=auth).status_code in (
            200,
            201,
        )
    body = client.get(f"{V1}/insights/production?days=30", headers=auth).json()
    assert body["pipeline"]["total"] == 3
    assert body["pipeline"]["by_stage"]["idea"] == 3
    assert sum(w["created"] for w in body["pipeline"]["weekly"]) == 3
    assert body["range_days"] == 30


def test_rejects_silly_ranges(client: TestClient, auth: Hdr) -> None:
    assert client.get(f"{V1}/insights/production?days=1", headers=auth).status_code == 422
