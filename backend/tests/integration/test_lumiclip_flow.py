"""The LumiClip endpoints end to end with the provider and Cloudinary faked (no network, no keys)."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.integrations import cloudinary as cloud_mod
from app.integrations import lumiclip as lumi_mod
from app.integrations.cloudinary import CloudinaryClient
from app.integrations.lumiclip import LumiclipClient
from app.services import lumiclip as svc
from tests.helpers import V1, Hdr, upload_file


class FakeProvider:
    """Plays the LumiClip API: processing on the first poll, completed (2 clips) afterwards."""

    def __init__(self) -> None:
        self.polls = 0
        self.generated: list[dict[str, Any]] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if req.method == "POST" and path.endswith("/clips/generate"):
            import json

            self.generated.append(json.loads(req.content))
            return httpx.Response(
                200, json={"project_id": "lp-1", "status": "processing", "estimated_minutes": 2}
            )
        if req.method == "GET" and path.endswith("/projects/lp-1"):
            self.polls += 1
            if self.polls == 1:
                return httpx.Response(
                    200, json={"id": "lp-1", "status": "processing", "step": "transcribing"}
                )
            return httpx.Response(
                200,
                json={
                    "id": "lp-1",
                    "status": "completed",
                    "step": "done",
                    "duration": 300,
                    "clips": [
                        {
                            "id": "c1",
                            "title": "Big hook",
                            "duration": 31,
                            "score": 0.93,
                            "reason": "strong opener",
                            "clip_status": "completed",
                            "download_url": "https://cdn.example/c1.mp4",
                            "thumbnail_url": "https://cdn.example/c1.jpg",
                            "quality": "1080p",
                        },
                        {
                            "id": "c2",
                            "title": "Still cutting",
                            "duration": 20,
                            "score": 0.5,
                            "reason": "",
                            "clip_status": "processing",
                            "download_url": None,
                            "thumbnail_url": None,
                            "quality": None,
                        },
                    ],
                },
            )
        if req.method == "POST" and path.endswith("/export"):
            return httpx.Response(
                200, json={"status": "ready", "clip_id": "c1", "url": "https://cdn.example/hd.mp4"}
            )
        return httpx.Response(404, json={"error": "unexpected"})


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    s = get_settings()
    monkeypatch.setattr(s, "lumiclip_api_key", "lk_test")
    fake = FakeProvider()
    monkeypatch.setattr(
        lumi_mod,
        "get_lumiclip_client",
        lambda: LumiclipClient(s, httpx.Client(transport=httpx.MockTransport(fake))),
    )
    return fake


def test_status_reports_what_is_configured(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "lumiclip_api_key", "")
    res = client.get(f"{V1}/lumiclip/status", headers=auth).json()
    assert res["configured"] is False
    monkeypatch.setattr(s, "lumiclip_api_key", "k")
    assert client.get(f"{V1}/lumiclip/status", headers=auth).json()["configured"] is True
    assert client.get(f"{V1}/health").json()["features"]["integrations"]["lumiclip"] is True


def test_start_without_a_key_is_an_actionable_503(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "lumiclip_api_key", "")
    res = client.post(f"{V1}/lumiclip/projects", json={"url": "https://youtu.be/x"}, headers=auth)
    assert res.status_code == 503 and res.json()["error"]["code"] == "LUMICLIP_NOT_CONFIGURED"


def test_request_validation(client: TestClient, auth: Hdr, provider: FakeProvider) -> None:
    both = client.post(
        f"{V1}/lumiclip/projects", json={"url": "https://x.y/v", "asset_id": "a"}, headers=auth
    )
    none = client.post(f"{V1}/lumiclip/projects", json={}, headers=auth)
    ftp = client.post(f"{V1}/lumiclip/projects", json={"url": "ftp://x/y"}, headers=auth)
    span = client.post(
        f"{V1}/lumiclip/projects",
        json={"url": "https://x.y/v", "start_time": 50, "end_time": 10},
        headers=auth,
    )
    assert [r.status_code for r in (both, none, ftp, span)] == [422, 422, 422, 422]


def test_url_project_runs_to_completion_and_a_clip_is_saved_to_the_library(
    client: TestClient,
    auth: Hdr,
    provider: FakeProvider,
    tiny_media: Any,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    started = client.post(
        f"{V1}/lumiclip/projects",
        json={
            "url": "https://youtu.be/abc",
            "aspect_ratio": "9:16",
            "language": "en",
            "subtitle_style": "punch",
        },
        headers=auth,
    )
    assert started.status_code == 201, started.text
    p = started.json()
    assert p["remote_id"] == "lp-1" and p["status"] == "processing"
    assert p["provenance"] == {"source": "ai", "provider": "lumiclip", "model": None}
    assert provider.generated[0] == {
        "url": "https://youtu.be/abc",
        "aspect_ratio": "9:16",
        "language": "en",
        "subtitle_style": "punch",
    }

    first = client.get(f"{V1}/lumiclip/projects/{p['id']}", headers=auth).json()
    assert first["status"] == "processing" and first["step"] == "transcribing"
    done = client.get(f"{V1}/lumiclip/projects/{p['id']}", headers=auth).json()
    assert done["status"] == "completed" and [c["id"] for c in done["clips"]] == ["c1", "c2"]
    assert (
        done["clips"][0]["score"] == pytest.approx(0.93)
        and done["clips"][0]["imported_asset_id"] is None
    )
    polls = provider.polls
    client.get(f"{V1}/lumiclip/projects/{p['id']}", headers=auth)
    assert provider.polls == polls  # a finished project is final: no more provider calls

    listed = client.get(f"{V1}/lumiclip/projects", headers=auth).json()
    assert [x["id"] for x in listed] == [p["id"]]

    # the clip that is still processing cannot be saved; the finished one is downloaded into the library
    pending = client.post(
        f"{V1}/lumiclip/projects/{p['id']}/clips/c2/import", json={}, headers=auth
    )
    assert pending.status_code == 409 and pending.json()["error"]["code"] == "ASSET_NOT_READY"

    def fake_download(url: str, dest: Path, http: Any = None) -> tuple[str, int]:
        assert url == "https://cdn.example/c1.mp4"
        shutil.copyfile(tiny_media.video, dest)
        return hashlib.sha256(dest.read_bytes()).hexdigest(), dest.stat().st_size

    monkeypatch.setattr(svc, "_download", fake_download)
    saved = client.post(f"{V1}/lumiclip/projects/{p['id']}/clips/c1/import", json={}, headers=auth)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert (
        body["duplicate"] is False
        and body["project"]["clips"][0]["imported_asset_id"] == body["asset_id"]
    )
    asset = client.get(f"{V1}/assets/{body['asset_id']}", headers=auth).json()
    assert asset["status"] == "ready" and asset["analysis"]["mode"] == "light"
    assert asset["filename"].startswith("Big hook") and asset["filename"].endswith(".mp4")
    # saving again finds the same bytes
    again = client.post(
        f"{V1}/lumiclip/projects/{p['id']}/clips/c1/import", json={}, headers=auth
    ).json()
    assert again["duplicate"] is True and again["asset_id"] == body["asset_id"]

    exported = client.post(
        f"{V1}/lumiclip/projects/{p['id']}/clips/c1/export", json={"quality": "720p"}, headers=auth
    )
    assert exported.json()["url"] == "https://cdn.example/hd.mp4"
    assert client.delete(f"{V1}/lumiclip/projects/{p['id']}", headers=auth).status_code == 204
    assert client.get(f"{V1}/lumiclip/projects/{p['id']}", headers=auth).status_code == 404


def test_library_video_is_uploaded_to_cloudinary_first(
    client: TestClient,
    auth: Hdr,
    provider: FakeProvider,
    tiny_media: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    s = get_settings()
    for k, v in (
        ("cloudinary_cloud_name", "demo"),
        ("cloudinary_api_key", "k"),
        ("cloudinary_api_secret", "s"),
    ):
        monkeypatch.setattr(s, k, v)
    uploads: list[str] = []

    def cloudinary_handler(req: httpx.Request) -> httpx.Response:
        uploads.append(str(req.url))
        return httpx.Response(
            200, json={"secure_url": "https://res.cloudinary.com/demo/video/upload/v1/hero.mp4"}
        )

    monkeypatch.setattr(
        cloud_mod,
        "get_cloudinary_client",
        lambda: CloudinaryClient(
            s, httpx.Client(transport=httpx.MockTransport(cloudinary_handler))
        ),
    )
    asset = upload_file(client, auth, tiny_media.video, sidecar=tiny_media.sidecar)["asset"]
    res = client.post(f"{V1}/lumiclip/projects", json={"asset_id": asset["id"]}, headers=auth)
    assert res.status_code == 201, res.text
    assert uploads == ["https://api.cloudinary.com/v1_1/demo/video/upload"]
    assert (
        provider.generated[0]["url"] == "https://res.cloudinary.com/demo/video/upload/v1/hero.mp4"
    )
    assert res.json()["source_asset_id"] == asset["id"]


def test_library_video_without_cloudinary_says_what_to_do(
    client: TestClient,
    auth: Hdr,
    provider: FakeProvider,
    tiny_media: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    s = get_settings()
    for k in ("cloudinary_cloud_name", "cloudinary_api_key", "cloudinary_api_secret"):
        monkeypatch.setattr(s, k, "")
    asset = upload_file(client, auth, tiny_media.video, sidecar=tiny_media.sidecar)["asset"]
    res = client.post(f"{V1}/lumiclip/projects", json={"asset_id": asset["id"]}, headers=auth)
    assert res.status_code == 503 and res.json()["error"]["code"] == "CLOUDINARY_NOT_CONFIGURED"
    assert provider.generated == []  # nothing was sent to LumiClip


def test_download_refuses_private_addresses() -> None:
    from app.errors import AppError

    for url in ("http://127.0.0.1/x.mp4", "http://localhost/x.mp4", "ftp://example.com/x.mp4"):
        with pytest.raises(AppError):
            svc._check_public_host(url)


def test_another_workspace_cannot_see_the_project(
    client: TestClient, auth: Hdr, provider: FakeProvider
) -> None:
    res = client.get(f"{V1}/lumiclip/projects/not-mine", headers=auth)
    assert res.status_code == 404


def test_yt_download_with_ytdlp(
    client: TestClient, auth: Hdr, tiny_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeYtdlp:
        def __init__(self, opts: dict[str, Any]) -> None:
            self.opts = opts

        def __enter__(self) -> FakeYtdlp:
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, Any]:
            out = Path(self.opts["outtmpl"].replace("%(ext)s", "mp4"))
            shutil.copyfile(tiny_media.video, out)
            return {"title": "Sample YouTube Video", "duration": 15.0, "ext": "mp4"}

        def prepare_filename(self, info: dict[str, Any]) -> str:
            return self.opts["outtmpl"].replace("%(ext)s", "mp4")

    import yt_dlp

    monkeypatch.setattr(yt_dlp, "YoutubeDL", FakeYtdlp)
    monkeypatch.setattr(svc, "_check_public_host", lambda url: None)  # no DNS in tests

    res = client.post(
        f"{V1}/lumiclip/yt-download",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
        headers=auth,
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["title"] == "Sample YouTube Video"
    assert "dl=" in data["download_url"]
    assert data["size_bytes"] > 0
    assert data["asset_id"]


def test_yt_download_failure_is_reported_and_cleaned(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    created: list[Path] = []

    class BrokenYtdlp:
        def __init__(self, opts: dict[str, Any]) -> None:
            self.opts = opts

        def __enter__(self) -> BrokenYtdlp:
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, Any]:
            part = Path(self.opts["outtmpl"].replace("%(ext)s", "mp4.part"))
            part.write_bytes(b"partial")
            created.append(part)
            raise RuntimeError("HTTP Error 403: Forbidden")

    import yt_dlp

    monkeypatch.setattr(yt_dlp, "YoutubeDL", BrokenYtdlp)
    monkeypatch.setattr(svc, "_check_public_host", lambda url: None)
    res = client.post(
        f"{V1}/lumiclip/yt-download", json={"url": "https://video.example/watch?v=1"}, headers=auth
    )
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "DOWNLOAD_FAILED"
    assert created and not created[0].exists()
