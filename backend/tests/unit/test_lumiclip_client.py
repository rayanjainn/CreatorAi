"""LumiClip and Cloudinary clients against fake HTTP (no network, no keys)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.errors import AppError
from app.integrations.cloudinary import CHUNK_THRESHOLD, CloudinaryClient, sign
from app.integrations.lumiclip import LumiclipClient, categorize_error, parse_project


def cfg(tmp_path: Path, **kw: Any) -> Settings:
    return Settings(DATA_DIR=str(tmp_path), _env_file=None, **kw)  # type: ignore[call-arg]


def client(tmp_path: Path, handler: Any, **kw: Any) -> LumiclipClient:
    http = httpx.Client(transport=httpx.MockTransport(handler))
    return LumiclipClient(cfg(tmp_path, LUMICLIP_API_KEY="lk_test", **kw), http)


def test_not_configured_is_an_actionable_503(tmp_path: Path) -> None:
    c = LumiclipClient(
        cfg(tmp_path), httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    )
    with pytest.raises(AppError) as err:
        c.generate("https://youtu.be/x")
    assert err.value.code == "LUMICLIP_NOT_CONFIGURED" and err.value.status == 503
    assert "LUMICLIP_API_KEY" in err.value.message


def test_generate_sends_only_what_was_set_with_the_bearer_key(tmp_path: Path) -> None:
    seen: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(
            url=str(req.url), auth=req.headers["authorization"], body=json.loads(req.content)
        )
        return httpx.Response(
            200, json={"project_id": "p-1", "status": "processing", "estimated_minutes": 3}
        )

    p = client(tmp_path, handler).generate(
        "https://youtu.be/abc",
        aspect_ratio="16:9",
        start_time=10,
        end_time=70,
        language="auto",
        subtitle_style="punch",
    )
    assert seen["url"] == "https://api.lumiclip.ai/api/v1/clips/generate"
    assert seen["auth"] == "Bearer lk_test"
    assert seen["body"] == {
        "url": "https://youtu.be/abc",
        "aspect_ratio": "16:9",
        "start_time": 10,
        "end_time": 70,
        "subtitle_style": "punch",  # language "auto" is not sent
    }
    assert p.id == "p-1" and p.status == "processing" and p.active


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "LUMICLIP_AUTH"),
        (402, "QUOTA_EXCEEDED"),
        (429, "QUOTA_EXCEEDED"),
        (500, "LUMICLIP_FAILED"),
    ],
)
def test_http_errors_map_to_our_codes(tmp_path: Path, status: int, code: str) -> None:
    c = client(tmp_path, lambda r: httpx.Response(status, json={"error": "nope"}))
    with pytest.raises(AppError) as err:
        c.get_project("p-1")
    assert err.value.code == code


def test_network_failure_is_unreachable(tmp_path: Path) -> None:
    def boom(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    with pytest.raises(AppError) as err:
        client(tmp_path, boom).get_project("p-1")
    assert err.value.code == "LUMICLIP_UNREACHABLE"


def test_parse_project_normalises_clips_and_scores() -> None:
    p = parse_project(
        {
            "id": "p-1",
            "status": "completed",
            "step": "done",
            "expected_clips": 2,
            "duration": 420,
            "clips": [
                {
                    "id": "c1",
                    "title": "Hook",
                    "duration": 38.5,
                    "score": 98,
                    "reason": "peak",
                    "clip_status": "completed",
                    "download_url": "https://cdn/x.mp4",
                    "thumbnail_url": "https://cdn/x.jpg",
                    "quality": "1080p",
                },
                {"id": "c2", "score": 0.5},
                {"title": "no id: dropped"},
            ],
        }
    )
    assert [c.id for c in p.clips] == ["c1", "c2"]
    assert p.clips[0].score == pytest.approx(0.98)  # 0-100 scores become 0-1
    assert p.clips[1].title == "Untitled clip" and p.status == "completed" and not p.active


@pytest.mark.parametrize(
    ("message", "category"),
    [
        ("This video requires authentication and cannot be processed.", "source_auth"),
        ("Sign in to confirm you're not a bot", "source_auth"),
        ("Video unavailable in your region", "source_unavailable"),
        ("Invalid API key", "api_auth"),
        ("You are out of credits", "quota"),
        ("Something odd happened", "unknown"),
    ],
)
def test_error_categories_only_match_clear_phrases(message: str, category: str) -> None:
    assert categorize_error(message, "", "failed") == category
    p = parse_project({"id": "x", "status": "failed", "error": message})
    assert p.status == "failed" and p.error_category == category


def test_failed_project_without_message_is_unknown_not_auth() -> None:
    p = parse_project({"id": "x", "status": "failed"})
    assert p.status == "failed" and p.error_category == "unknown"


# ── Cloudinary ───────────────────────────────────────────────────────────────────────────────
def test_cloudinary_signature_matches_the_documented_algorithm() -> None:
    params = {"timestamp": 1315060510, "folder": "creatorai/ws", "api_key": "ignored-by-caller"}
    expected = hashlib.sha1(
        b"api_key=ignored-by-caller&folder=creatorai/ws&timestamp=1315060510SECRET"
    ).hexdigest()
    assert sign(params, "SECRET") == expected


def cloud(tmp_path: Path, handler: Any) -> CloudinaryClient:
    s = cfg(
        tmp_path, CLOUDINARY_CLOUD_NAME="demo", CLOUDINARY_API_KEY="k", CLOUDINARY_API_SECRET="s"
    )
    return CloudinaryClient(s, httpx.Client(transport=httpx.MockTransport(handler)))


def test_cloudinary_not_configured_explains_the_alternative(tmp_path: Path) -> None:
    c = CloudinaryClient(
        cfg(tmp_path), httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    )
    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")
    with pytest.raises(AppError) as err:
        c.upload_video(f, folder="a")
    assert err.value.code == "CLOUDINARY_NOT_CONFIGURED" and "public video URL" in err.value.message


def test_cloudinary_small_file_is_one_signed_request(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(
            200, json={"secure_url": "https://res.cloudinary.com/demo/video/upload/v1/a.mp4"}
        )

    f = tmp_path / "v.mp4"
    f.write_bytes(b"0" * 1000)
    out = cloud(tmp_path, handler).upload_video(f, folder="creatorai/ws")
    assert out["secure_url"].endswith("a.mp4") and len(seen) == 1
    assert str(seen[0].url) == "https://api.cloudinary.com/v1_1/demo/video/upload"
    body = seen[0].content
    for needle in (
        b'name="api_key"',
        b'name="signature"',
        b'name="timestamp"',
        b'name="folder"',
        b"creatorai/ws",
    ):
        assert needle in body
    assert "x-unique-upload-id" not in seen[0].headers and "content-range" not in seen[0].headers


def test_cloudinary_large_file_is_chunked_with_content_range(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.integrations.cloudinary as mod

    monkeypatch.setattr(mod, "CHUNK_THRESHOLD", 100)
    monkeypatch.setattr(mod, "CHUNK", 40)
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(
            200, json={"secure_url": "https://x/y.mp4"} if len(seen) == 3 else {"done": False}
        )

    f = tmp_path / "big.mp4"
    f.write_bytes(b"1" * 100 + b"2" * 20)  # 120 bytes -> chunks of 40
    assert CHUNK_THRESHOLD > 100  # the real threshold is far above the patched one
    out = cloud(tmp_path, handler).upload_video(f, folder="a")
    assert out["secure_url"] == "https://x/y.mp4"
    assert [r.headers["content-range"] for r in seen] == [
        "bytes 0-39/120",
        "bytes 40-79/120",
        "bytes 80-119/120",
    ]
    assert (
        len({r.headers["x-unique-upload-id"] for r in seen}) == 1
    )  # one upload id across the chunks


def test_cloudinary_error_message_is_surfaced(tmp_path: Path) -> None:
    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")
    c = cloud(
        tmp_path, lambda r: httpx.Response(401, json={"error": {"message": "Invalid Signature"}})
    )
    with pytest.raises(AppError) as err:
        c.upload_video(f, folder="a")
    assert err.value.code == "CLOUDINARY_FAILED" and "Invalid Signature" in err.value.message
