"""YouTube connection and publishing against a fake Google (httpx.MockTransport)."""

from __future__ import annotations

import io
import json
import re
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import session_scope
from app.integrations import youtube as yt
from app.models import Asset, Clip, ContentItem, PublishJob, Render, YtMetricDaily, YtVideo
from app.services import youtube_service
from app.storage.local import get_storage
from tests.helpers import V1, Hdr, seed_demo_asset

VIDEO_BYTES = b"\x00\x00\x00\x18ftypmp42" + b"x" * 700_000


class FakeGoogle:
    def __init__(self) -> None:
        self.uploaded = bytearray()
        self.metadata: dict[str, Any] = {}
        self.refreshes = 0
        self.revoked: list[str] = []
        self.fail_refresh = False
        self.views = 1234

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.startswith(yt.TOKEN_URL):
            form = parse_qs(request.content.decode())
            if form["grant_type"] == ["authorization_code"]:
                assert form["code"] == ["good-code"]
                return httpx.Response(
                    200,
                    json={
                        "access_token": "at-1",
                        "refresh_token": "rt-1",
                        "expires_in": 3600,
                        "scope": " ".join(yt.SCOPES),
                    },
                )
            self.refreshes += 1
            if self.fail_refresh:
                return httpx.Response(
                    400,
                    json={
                        "error": "invalid_grant",
                        "error_description": "Token has been expired or revoked.",
                    },
                )
            assert form["refresh_token"] == ["rt-1"]
            return httpx.Response(
                200, json={"access_token": f"at-r{self.refreshes}", "expires_in": 3600}
            )
        if url.startswith(yt.REVOKE_URL):
            self.revoked.append(parse_qs(request.content.decode())["token"][0])
            return httpx.Response(200)
        if url.startswith(f"{yt.API}/channels"):
            return httpx.Response(
                200, json={"items": [{"id": "UC123", "snippet": {"title": "My Channel"}}]}
            )
        if url.startswith(yt.UPLOAD_URL) and request.method == "POST":
            self.metadata = json.loads(request.content)
            return httpx.Response(200, headers={"location": "https://upload.example/session/1"})
        if url.startswith("https://upload.example/session/1"):
            rng = request.headers["content-range"]
            m = re.match(r"bytes (\d+)-(\d+)/(\d+)", rng)
            assert m, rng
            start, end, total = map(int, m.groups())
            assert start == len(self.uploaded)
            self.uploaded += request.content
            if end + 1 < total:
                return httpx.Response(308, headers={"range": f"bytes=0-{end}"})
            return httpx.Response(
                200, json={"id": "vid123", "status": {"uploadStatus": "uploaded"}}
            )
        if url.startswith(f"{yt.API}/videos"):
            ids = request.url.params["id"].split(",")
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": i,
                            "snippet": {
                                "title": "Live title",
                                "publishedAt": "2026-10-01T10:00:00Z",
                            },
                            "statistics": {
                                "viewCount": str(self.views),
                                "likeCount": "56",
                                "commentCount": "7",
                            },
                            "contentDetails": {"duration": "PT45S"},
                            "status": {"privacyStatus": "public"},
                        }
                        for i in ids
                    ]
                },
            )
        return httpx.Response(404, json={"error": {"message": f"unexpected {url}"}})


@pytest.fixture
def google(monkeypatch: pytest.MonkeyPatch) -> FakeGoogle:
    fake = FakeGoogle()
    transport = httpx.MockTransport(fake)
    monkeypatch.setattr(
        yt, "_client", lambda http, timeout=30.0: http or httpx.Client(transport=transport)
    )
    monkeypatch.setattr(yt, "CHUNK", 256 * 1024)
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "cid.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "google_client_secret", "secret")
    youtube_service.reset_tokens()
    yield fake
    youtube_service.reset_tokens()


def connect(client: TestClient, auth: Hdr) -> None:
    start = client.post(f"{V1}/youtube/oauth/start", headers=auth)
    assert start.status_code == 200, start.text
    state = parse_qs(urlparse(start.json()["url"]).query)["state"][0]
    res = client.get(
        f"{V1}/youtube/oauth/callback",
        params={"code": "good-code", "state": state},
        follow_redirects=False,
    )
    assert res.status_code == 303 and "youtube=connected" in res.headers["location"]


def make_render(
    client: TestClient, auth: Hdr, media: Any, ws: str, preset: str = "yt_short"
) -> tuple[str, str]:
    item = client.post(f"{V1}/content", json={"title": "Publish me"}, headers=auth).json()["id"]
    with session_scope() as db:
        existing = db.query(Asset).filter(Asset.workspace_id == ws).first()
        asset_id = existing.id if existing else None
    asset_id = asset_id or seed_demo_asset(client, auth, media, item, ws)
    key = f"renders/{ws}/test-{preset}.mp4"
    get_storage().put_file(key, io.BytesIO(VIDEO_BYTES))
    with session_scope() as db:
        clip = Clip(
            workspace_id=ws,
            content_item_id=item,
            source_asset_id=asset_id,
            title="Clip",
            start_sec=0,
            end_sec=20,
            status="accepted",
        )
        db.add(clip)
        db.flush()
        render = Render(
            workspace_id=ws,
            clip_id=clip.id,
            preset=preset,
            edit_revision=1,
            status="done",
            output_key=key,
            duration_sec=20.0,
            size_bytes=len(VIDEO_BYTES),
        )
        db.add(render)
        db.flush()
        return item, render.id


def test_not_configured_says_what_to_add(client: TestClient, auth: Hdr) -> None:
    body = client.get(f"{V1}/youtube/status", headers=auth).json()
    assert body["configured"] is False and body["connected"] is False
    res = client.post(f"{V1}/youtube/oauth/start", headers=auth)
    assert res.status_code == 503 and res.json()["error"]["code"] == "YOUTUBE_NOT_CONFIGURED"
    assert "GOOGLE_CLIENT_ID" in res.json()["error"]["details"]["env"]


def test_connect_status_and_disconnect(client: TestClient, auth: Hdr, google: FakeGoogle) -> None:
    start = client.post(f"{V1}/youtube/oauth/start", headers=auth).json()["url"]
    q = parse_qs(urlparse(start).query)
    assert q["client_id"] == ["cid.apps.googleusercontent.com"] and q["access_type"] == ["offline"]
    assert "youtube.upload" in q["scope"][0]
    bad = client.get(
        f"{V1}/youtube/oauth/callback",
        params={"code": "good-code", "state": "x.y.1.z"},
        follow_redirects=False,
    )
    assert bad.status_code == 303 and "youtube=error" in bad.headers["location"]
    denied = client.get(
        f"{V1}/youtube/oauth/callback", params={"error": "access_denied"}, follow_redirects=False
    )
    assert "youtube=denied" in denied.headers["location"]
    connect(client, auth)
    st = client.get(f"{V1}/youtube/status", headers=auth).json()
    assert st["connected"] and st["channel_title"] == "My Channel" and st["channel_id"] == "UC123"
    assert client.delete(f"{V1}/youtube/connection", headers=auth).status_code == 204
    assert google.revoked == ["rt-1"]
    assert client.get(f"{V1}/youtube/status", headers=auth).json()["connected"] is False


def test_publish_uploads_in_chunks_and_marks_published(
    client: TestClient, auth: Hdr, google: FakeGoogle, demo_media: Any, workspace_id: str
) -> None:
    item, render_id = make_render(client, auth, demo_media, workspace_id)
    body = {
        "render_id": render_id,
        "title": "My video",
        "description": "Hello",
        "tags": ["edit", "#Edit", "shorts"],
        "visibility": "public",
    }
    no_conn = client.post(f"{V1}/content/{item}/publish", json=body, headers=auth)
    assert no_conn.status_code == 409 and no_conn.json()["error"]["code"] == "NO_YOUTUBE_CONNECTION"
    connect(client, auth)
    youtube_service.reset_tokens()  # force a refresh on the way
    defaults = client.get(f"{V1}/content/{item}/publish/defaults", headers=auth).json()
    assert defaults["connection"]["connected"] and defaults["renders"][0]["id"] == render_id
    assert defaults["title"] == "Publish me"

    res = client.post(f"{V1}/content/{item}/publish", json=body, headers=auth)
    assert res.status_code == 202, res.text
    job = client.get(f"{V1}/jobs/{res.json()['job_id']}", headers=auth).json()
    assert job["status"] == "succeeded", job
    assert bytes(google.uploaded) == VIDEO_BYTES  # every chunk, in order
    assert google.metadata["snippet"]["tags"] == ["edit", "shorts"]
    assert google.metadata["status"]["privacyStatus"] == "public"
    rows = client.get(f"{V1}/content/{item}/publish", headers=auth).json()
    assert rows[0]["status"] == "published" and rows[0]["url"] == "https://youtu.be/vid123"
    card = client.get(f"{V1}/content/{item}", headers=auth).json()
    assert card["stage"] == "published"

    # stats sync feeds Insights with real numbers (never the demo rows)
    sync = client.post(f"{V1}/youtube/sync", headers=auth)
    assert (
        client.get(f"{V1}/jobs/{sync.json()['job_id']}", headers=auth).json()["status"]
        == "succeeded"
    )
    perf = client.get(f"{V1}/insights/production", headers=auth).json()["performance"]
    assert perf["available"] and perf["totals"]["views"] == 1234
    assert perf["videos"][0]["title"] == "Live title"
    with session_scope() as db:
        assert (
            db.query(YtVideo).filter(YtVideo.youtube_video_id == "vid123").one().format == "short"
        )
        assert db.query(YtMetricDaily).count() == 1


def test_schedule_is_private_with_publish_at_and_download_only_presets_refused(
    client: TestClient, auth: Hdr, google: FakeGoogle, demo_media: Any, workspace_id: str
) -> None:
    connect(client, auth)
    item, render_id = make_render(client, auth, demo_media, workspace_id)
    past = client.post(
        f"{V1}/content/{item}/publish",
        json={"render_id": render_id, "title": "x", "scheduled_at": "2001-01-01T10:00:00Z"},
        headers=auth,
    )
    assert past.status_code == 422
    res = client.post(
        f"{V1}/content/{item}/publish",
        json={
            "render_id": render_id,
            "title": "Later",
            "visibility": "public",
            "scheduled_at": "2099-01-01T10:00:00+02:00",
        },
        headers=auth,
    )
    assert res.status_code == 202, res.text
    assert google.metadata["status"] == {
        "privacyStatus": "private",
        "selfDeclaredMadeForKids": False,
        "publishAt": "2099-01-01T08:00:00Z",
    }
    rows = client.get(f"{V1}/content/{item}/publish", headers=auth).json()
    assert rows[0]["status"] == "scheduled"
    with session_scope() as db:
        assert db.get(ContentItem, item).scheduled_for == "2099-01-01"  # type: ignore[union-attr]

    item2, reels = make_render(client, auth, demo_media, workspace_id, preset="reels")
    res = client.post(
        f"{V1}/content/{item2}/publish", json={"render_id": reels, "title": "x"}, headers=auth
    )
    assert res.status_code == 422 and "download-only" in res.json()["error"]["message"]


def test_revoked_access_fails_the_upload_and_can_retry(
    client: TestClient, auth: Hdr, google: FakeGoogle, demo_media: Any, workspace_id: str
) -> None:
    connect(client, auth)
    item, render_id = make_render(client, auth, demo_media, workspace_id)
    youtube_service.reset_tokens()
    google.fail_refresh = True
    res = client.post(
        f"{V1}/content/{item}/publish", json={"render_id": render_id, "title": "x"}, headers=auth
    )
    assert res.status_code == 409 and res.json()["error"]["code"] == "NO_YOUTUBE_CONNECTION"
    assert client.get(f"{V1}/youtube/status", headers=auth).json()["status"] == "revoked"
    with session_scope() as db:
        assert db.query(PublishJob).count() == 0
