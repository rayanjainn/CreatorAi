"""Search over processed demo footage: hybrid ranking, filters, cache, stale vectors, hooks."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.models import Asset, ContentItem, Job, Script
from app.services import search_service
from app.workers.runner import register_job
from tests.helpers import V1, Hdr, get_asset, upload_file


def process(client: TestClient, auth: Hdr, media: Any) -> dict[str, Any]:
    body = upload_file(client, auth, media.video, sidecar=media.sidecar)
    asset = get_asset(client, auth, body["asset"]["id"])
    assert asset["status"] == "ready"
    return asset


@pytest.fixture
def indexed(client: TestClient, auth: Hdr, demo_media: Any) -> dict[str, Any]:
    return process(client, auth, demo_media)


@pytest.fixture
def quick(client: TestClient, auth: Hdr, tiny_media: Any) -> dict[str, Any]:
    return process(client, auth, tiny_media)


def search(client: TestClient, auth: Hdr, q: str, **params: Any) -> dict[str, Any]:
    res = client.get(f"{V1}/search", params={"q": q, **params}, headers=auth)
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


def test_requires_auth_and_query(client: TestClient, auth: Hdr) -> None:
    assert client.get(f"{V1}/search", params={"q": "x"}).status_code == 401
    assert client.get(f"{V1}/search", headers=auth).status_code == 422
    assert (
        client.get(f"{V1}/search", params={"q": "x", "kind": "nope"}, headers=auth).status_code
        == 422
    )
    empty = search(client, auth, "anything at all")
    assert empty["results"] == [] and empty["provenance"]["source"] == "heuristic"


def test_hybrid_search_finds_the_right_moment(
    client: TestClient, auth: Hdr, indexed: dict[str, Any]
) -> None:
    body = search(client, auth, "how do I trim the dead air and cut long pauses")
    assert body["provenance"]["source"] == "heuristic"  # hashing embedder in tests
    assert body["provenance"]["provider"] == "hashing" and body["embedder"]["backend"] == "hashing"
    top = body["results"][0]
    assert top["asset_id"] == indexed["id"] and top["filename"] == "hero_demo.mp4"
    assert top["kind"] == "speech" and "dead air" in top["snippet"]
    # the matching segment is 14.65-18.92 s; neighbours within 8 s are merged into the range
    assert top["start_sec"] == pytest.approx(14.65, abs=0.1) and top["end_sec"] >= 18.9
    assert top["score"] > 0
    assert top["asset_kind"] == "video" and top["similarity"] is not None
    assert client.get(top["thumb_url"]).status_code == 200  # signed keyframe URL
    assert any("heuristic" in w for w in body["warnings"])

    export = search(client, auth, "export a vertical version for shorts")["results"][0]
    assert "vertical version" in export["snippet"] and export["start_sec"] > top["start_sec"]


def test_filters_and_lexical_match(client: TestClient, auth: Hdr, indexed: dict[str, Any]) -> None:
    top = search(client, auth, "youtube")["results"][0]
    assert "youtube" in top["snippet"].lower() and top["score"] > 0
    speech = search(client, auth, "color correction rough cut", kind="speech")["results"]
    assert speech and all(r["kind"] == "speech" for r in speech)
    visual = search(client, auth, "color correction rough cut", kind="visual")["results"]
    assert visual and all(
        r["kind"] == "visual" for r in visual
    )  # mock captions echo the transcript
    assert search(client, auth, "color correction", asset_kind="image")["results"] == []
    assert search(client, auth, "color correction", asset_kind="video")["results"]


def test_content_item_filter_and_limit(
    client: TestClient, auth: Hdr, workspace_id: str, demo_media: Any
) -> None:
    with session_scope() as db:
        item = ContentItem(workspace_id=workspace_id, title="Editing video")
        db.add(item)
        db.flush()
        item_id = item.id
    body = upload_file(
        client, auth, demo_media.video, sidecar=demo_media.sidecar, content_item_id=item_id
    )
    assert body["asset"]["content_item_id"] == item_id
    assert search(client, auth, "editing workflow", content_item_id=item_id)["results"]
    assert search(client, auth, "editing workflow", content_item_id="other")["results"] == []
    assert len(search(client, auth, "editing workflow", limit=1)["results"]) == 1


def test_index_is_cached_and_invalidated_on_writes(
    client: TestClient, auth: Hdr, quick: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    builds: list[int] = []
    original = search_service.build_index

    def counting(*args: Any, **kwargs: Any) -> Any:
        builds.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(search_service, "build_index", counting)
    search_service.invalidate()
    search(client, auth, "editing workflow")
    search(client, auth, "import everything")
    assert len(builds) == 1  # second query served from the cached matrices
    client.patch(f"{V1}/assets/{quick['id']}", json={"tags": ["x"]}, headers=auth)
    search(client, auth, "editing workflow")
    assert len(builds) == 2  # metadata write invalidated the cache
    client.delete(f"{V1}/assets/{quick['id']}", headers=auth)
    assert search(client, auth, "editing workflow")["results"] == []


def test_stale_embedder_assets_match_by_keyword_until_reindex(
    client: TestClient, auth: Hdr, quick: dict[str, Any]
) -> None:
    with session_scope() as db:
        row = db.get(Asset, quick["id"])
        assert row is not None
        data = dict(row.analysis)
        data["embedder"] = {**data["embedder"], "backend": "fastembed", "model": "other-model"}
        row.analysis = data
    search_service.invalidate()
    body = search(client, auth, "editing workflow")
    assert body["results"] and body["results"][0]["similarity"] is None  # lexical hit only
    assert any("POST /search/reindex" in w for w in body["warnings"])

    res = client.post(f"{V1}/search/reindex", headers=auth)
    assert res.status_code == 202 and res.json()["queued"] == 1
    fresh = search(client, auth, "editing workflow")
    assert fresh["results"][0]["similarity"] is not None
    assert not any("reindex" in w for w in fresh["warnings"])
    assert client.post(f"{V1}/search/reindex", headers=auth).json()["queued"] == 0  # nothing stale
    forced = client.post(f"{V1}/search/reindex", json={"force": True}, headers=auth).json()
    assert forced["queued"] == 1 and forced["provenance"]["source"] == "heuristic"
    assert get_asset(client, auth, quick["id"])["status"] == "ready"


def test_after_ready_chains_project_match_only_when_registered(
    client: TestClient, auth: Hdr, workspace_id: str, tmp_path: Any
) -> None:
    with session_scope() as db:
        item = ContentItem(workspace_id=workspace_id, title="Chained")
        db.add(item)
        db.flush()
        item_id = item.id
    note = tmp_path / "a.txt"
    note.write_text("first")
    upload_file(client, auth, note, content_item_id=item_id)  # no handler registered: no-op

    runs: list[str | None] = []
    register_job("project.match", lambda ctx: runs.append(ctx.entity_id) or {})
    note2 = tmp_path / "b.txt"
    note2.write_text("second")
    upload_file(client, auth, note2, content_item_id=item_id)
    assert runs == []  # no current script yet

    with session_scope() as db:
        db.add(Script(workspace_id=workspace_id, content_item_id=item_id, is_current=True))
    note3 = tmp_path / "c.txt"
    note3.write_text("third")
    upload_file(client, auth, note3, content_item_id=item_id)
    assert runs == [item_id]
    with session_scope() as db:
        jobs = db.query(Job).filter(Job.type == "project.match").all()
        assert len(jobs) == 1 and jobs[0].entity_type == "content_item"
