"""YouTube import end to end: probe, download, the real ingest pipeline, then real Smart Clips.

Only the network boundary is replaced: ``ytdlp.probe`` / ``ytdlp.download`` hand back the generated
demo footage instead of talking to YouTube, and Groq Whisper answers through ``httpx.MockTransport``
(the same pattern as ``test_asset_pipeline``). Everything after the download is the production code.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.errors import AppError
from app.integrations import ytdlp
from app.models import Asset, ContentItem, Job, YtImport
from app.services import yt_import
from app.services.ingest import transcribe as transcribe_mod
from tests.helpers import V1, Hdr

URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"


def fake_youtube(
    monkeypatch: pytest.MonkeyPatch,
    media: Any,
    *,
    duration: float | None = None,
    captions: bool = True,
) -> dict[str, Any]:
    calls: dict[str, Any] = {"download": []}

    def info(url: str) -> ytdlp.VideoInfo:
        vid = ytdlp.canonical_url(url).rsplit("=", 1)[1]
        return ytdlp.VideoInfo(vid, ytdlp.canonical_url(url), "How I edit a video", "Demo channel",
                               duration or media.duration, "en", False, True)  # fmt: skip

    def probe(url: str, settings: Any = None) -> ytdlp.VideoInfo:
        found = info(url)
        from app.config import get_settings

        ytdlp.check_length(found, get_settings())
        return found

    def download(url: str, dest_dir: Path, *, want_captions: bool, language: str | None = None,
                 on_progress: Any = None, settings: Any = None) -> ytdlp.Downloaded:  # fmt: skip
        calls["download"].append({"url": url, "want_captions": want_captions})
        dest_dir.mkdir(parents=True, exist_ok=True)
        if on_progress:
            on_progress(0.5, "half way")
            on_progress(1.0, "merging audio and video")
        path = dest_dir / "video.mp4"
        shutil.copyfile(media.video, path)
        out = ytdlp.Downloaded(path=path, info=info(url))
        if want_captions and captions:
            out.captions = {"language": "en", "words": media.words}
            out.caption_kind = "auto"
        return out

    monkeypatch.setattr(ytdlp, "probe", probe)
    monkeypatch.setattr(ytdlp, "download", download)
    return calls


def fake_whisper(
    monkeypatch: pytest.MonkeyPatch, words: list[dict[str, Any]]
) -> list[httpx.Request]:
    from app.config import Settings
    from app.ml.asr import GroqASR

    seen: list[httpx.Request] = []

    def groq(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={"language": "en", "duration": 45.0, "text": "x", "segments": [], "words": words},
        )

    provider = GroqASR(
        Settings(GROQ_API_KEY="gk", _env_file=None),  # type: ignore[call-arg]
        httpx.Client(transport=httpx.MockTransport(groq)),
    )
    monkeypatch.setattr(transcribe_mod, "get_asr_chain", lambda: [provider])
    monkeypatch.setattr(yt_import, "get_asr_chain", lambda: [provider])
    return seen


def no_asr(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(transcribe_mod, "get_asr_chain", lambda: [])
    monkeypatch.setattr(yt_import, "get_asr_chain", lambda: [])


def start(client: TestClient, auth: Hdr, **body: Any) -> dict[str, Any]:
    res = client.post(f"{V1}/yt-import", json={"url": URL, **body}, headers=auth)
    assert res.status_code == 201, res.text
    out: dict[str, Any] = res.json()
    return out


def test_status_reports_what_is_available(client: TestClient, auth: Hdr) -> None:
    body = client.get(f"{V1}/yt-import/status", headers=auth).json()
    assert body["available"] is True and body["search_configured"] is False
    assert body["max_duration_sec"] == 1800


def test_import_transcribes_with_whisper_and_cuts_clips(
    client: TestClient, auth: Hdr, demo_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = fake_youtube(monkeypatch, demo_media)
    seen = fake_whisper(monkeypatch, demo_media.words)
    out = start(client, auth, topic="editing workflow", clip_count=2)
    # jobs run inline in tests: download -> asset.process -> clips.generate all finished already
    assert out["status"] == "done", out
    assert out["progress"] == 100 and out["error"] is None
    assert calls["download"] == [{"url": URL, "want_captions": False}]  # ASR exists: no captions
    assert len(seen) == 1 and out["transcript_source"] == "asr"
    assert out["title"] == "How I edit a video" and out["channel"] == "Demo channel"
    assert out["topic"] == "editing workflow" and out["thumbnail_url"].startswith("/media/")
    assert 1 <= out["clips_count"] <= 2

    item = client.get(f"{V1}/content/{out['content_item_id']}", headers=auth).json()
    assert item["title"] == "How I edit a video" and item["stage"] == "edit"
    assert URL in item["idea_text"]

    asset = client.get(f"{V1}/assets/{out['asset_id']}", headers=auth).json()
    assert asset["status"] == "ready" and asset["filename"].endswith("(youtube).mp4")
    assert asset["content_item_id"] == out["content_item_id"]
    assert asset["provenance_by_stage"]["transcribe"]["provider"] == "groq"
    assert asset["segments"] and asset["shots"]  # indexed and embedded like any upload

    clips = client.get(f"{V1}/content/{out['content_item_id']}/clips", headers=auth).json()
    shorts = [c for c in clips if c["kind"] == "short"]
    assert shorts and all(c["source_asset_id"] == out["asset_id"] for c in shorts)
    edit = client.get(f"{V1}/clips/{shorts[0]['id']}/edit", headers=auth).json()
    assert edit["timeline"]["aspect"] == "9:16"  # reel-shaped

    hits = client.get(f"{V1}/search", params={"q": "trim the dead air"}, headers=auth).json()
    assert any(h["asset_id"] == out["asset_id"] for h in hits["results"])

    listed = client.get(f"{V1}/yt-import", headers=auth).json()
    assert [r["id"] for r in listed] == [out["id"]]
    with session_scope() as db:
        job = db.query(Job).filter(Job.type == "youtube.import").one()
        assert job.status == "succeeded" and job.result["asset_id"] == out["asset_id"]


def test_without_asr_the_youtube_captions_are_used_and_labelled(
    client: TestClient, auth: Hdr, demo_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = fake_youtube(monkeypatch, demo_media)
    no_asr(monkeypatch)
    out = start(client, auth, auto_clips=False)
    assert calls["download"][0]["want_captions"] is True
    assert out["status"] == "done" and out["clips_count"] == 0 and out["clips_job_id"] is None
    assert out["transcript_source"] == "youtube_captions"
    tr = client.get(f"{V1}/assets/{out['asset_id']}/transcript", headers=auth).json()
    assert tr["provenance"] == {"source": "ai", "provider": "youtube", "model": "auto-captions"}
    assert tr["segments"]


def test_without_asr_or_captions_it_fails_honestly(
    client: TestClient, auth: Hdr, demo_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_youtube(monkeypatch, demo_media, captions=False)
    no_asr(monkeypatch)
    out = start(client, auth)
    assert out["status"] == "failed" and out["error_code"] == "ASR_UNAVAILABLE"
    assert out["transcript_source"] is None


def test_bad_links_and_long_videos_are_refused_before_anything_is_created(
    client: TestClient, auth: Hdr, tiny_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    res = client.post(f"{V1}/yt-import", json={"url": "https://vimeo.com/123456"}, headers=auth)
    assert res.status_code == 422 and res.json()["error"]["code"] == "VALIDATION_ERROR"
    fake_youtube(monkeypatch, tiny_media, duration=4000)
    res = client.post(f"{V1}/yt-import", json={"url": URL}, headers=auth)
    assert res.status_code == 422 and res.json()["error"]["code"] == "YT_TOO_LONG"
    with session_scope() as db:
        assert db.query(YtImport).count() == 0 and db.query(ContentItem).count() == 0


def test_a_failed_download_is_reported_and_not_retried(
    client: TestClient, auth: Hdr, tiny_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    fake_youtube(monkeypatch, tiny_media)
    attempts: list[int] = []

    def gone(*a: Any, **kw: Any) -> ytdlp.Downloaded:
        attempts.append(1)
        raise AppError("YT_UNAVAILABLE", "This video is private, removed or blocked.", status=422)

    monkeypatch.setattr(ytdlp, "download", gone)
    monkeypatch.setattr(get_settings(), "job_max_retries", 2)
    out = start(client, auth)
    assert out["status"] == "failed" and out["error_code"] == "YT_UNAVAILABLE"
    assert len(attempts) == 1  # unavailable videos are not retried
    # the import can be removed; the project it created stays
    assert client.delete(f"{V1}/yt-import/{out['id']}", headers=auth).status_code == 204
    assert client.get(f"{V1}/content/{out['content_item_id']}", headers=auth).status_code == 200


def test_into_an_existing_project_and_a_repeat_import_reuses_the_video(
    client: TestClient, auth: Hdr, tiny_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_youtube(monkeypatch, tiny_media)
    no_asr(monkeypatch)  # captions path keeps this fast
    item = client.post(f"{V1}/content", json={"title": "Mine"}, headers=auth).json()["id"]
    first = start(client, auth, content_item_id=item)
    assert first["content_item_id"] == item and first["status"] == "done", first
    again = start(client, auth, content_item_id=item)
    assert again["asset_id"] == first["asset_id"] and again["status"] == "done"
    with session_scope() as db:
        assert db.query(Asset).count() == 1
    missing = client.post(
        f"{V1}/yt-import", json={"url": URL, "content_item_id": "nope"}, headers=auth
    )
    assert missing.status_code == 404


def test_search_needs_a_key_then_returns_videos(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    res = client.get(f"{V1}/yt-import/search", params={"q": "video editing"}, headers=auth)
    assert res.status_code == 503 and res.json()["error"]["code"] == "SEARCH_NOT_CONFIGURED"
    found = [{"video_id": "jNQXAC9IVRw", "url": URL, "title": "Zoo", "snippet": "",
              "channel": "jawed", "duration_sec": 19.0, "published": None}]  # fmt: skip
    monkeypatch.setattr(
        "app.integrations.websearch.get_video_search", lambda: lambda q, limit=10: found
    )
    body = client.get(f"{V1}/yt-import/search", params={"q": "zoo"}, headers=auth).json()
    assert body["results"] == found and body["query"] == "zoo"
    bad = client.get(f"{V1}/yt-import/thumbnail/..%2Fetc", headers=auth)
    assert bad.status_code in (404, 422)


def test_imports_are_workspace_scoped(
    client: TestClient, auth: Hdr, tiny_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    fake_youtube(monkeypatch, tiny_media)
    no_asr(monkeypatch)
    out = start(client, auth, auto_clips=False)
    monkeypatch.setattr(get_settings(), "auth_allow_multi", True)
    other = client.post(
        f"{V1}/auth/signup", json={"email": "other@example.com", "password": "password123"}
    ).json()
    hdr = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get(f"{V1}/yt-import/{out['id']}", headers=hdr).status_code == 404
    assert client.get(f"{V1}/yt-import", headers=hdr).json() == []
