from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.security import sign_media

KEY = "media/ws1/asset1/proxy.mp4"
PAYLOAD = bytes(range(256)) * 40  # 10240 bytes


@pytest.fixture
def media_file(data_dir: Path) -> str:
    path = data_dir / KEY
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PAYLOAD)
    return sign_media(KEY)


def test_full_file_with_mime_and_accept_ranges(client: TestClient, media_file: str) -> None:
    res = client.get(media_file)
    assert res.status_code == 200 and res.content == PAYLOAD
    assert res.headers["content-type"] == "video/mp4"
    assert res.headers["accept-ranges"] == "bytes"
    assert res.headers["content-length"] == str(len(PAYLOAD))


@pytest.mark.parametrize(
    ("header", "start", "end"),
    [
        ("bytes=0-9", 0, 9),
        ("bytes=100-199", 100, 199),
        ("bytes=10000-", 10000, 10239),
        ("bytes=-5", 10235, 10239),
        ("bytes=10200-99999", 10200, 10239),
        ("bytes=0-0", 0, 0),
    ],
)
def test_range_requests(
    client: TestClient, media_file: str, header: str, start: int, end: int
) -> None:
    res = client.get(media_file, headers={"Range": header})
    assert res.status_code == 206
    assert res.content == PAYLOAD[start : end + 1]
    assert res.headers["content-range"] == f"bytes {start}-{end}/{len(PAYLOAD)}"
    assert res.headers["content-length"] == str(end - start + 1)


@pytest.mark.parametrize(
    "header", ["bytes=10240-", "bytes=99999-100000", "bytes=-0", "bytes=50-10"]
)
def test_unsatisfiable_range_is_416(client: TestClient, media_file: str, header: str) -> None:
    res = client.get(media_file, headers={"Range": header})
    assert res.status_code == 416
    assert res.headers["content-range"] == f"bytes */{len(PAYLOAD)}"
    assert res.json()["error"]["code"] == "RANGE_NOT_SATISFIABLE"


@pytest.mark.parametrize("header", ["items=0-5", "bytes=abc", "bytes=1-2,5-6"])
def test_malformed_or_multi_range_serves_full_file(
    client: TestClient, media_file: str, header: str
) -> None:
    res = client.get(media_file, headers={"Range": header})
    assert res.status_code == 200 and len(res.content) == len(PAYLOAD)


def test_head_returns_headers_only(client: TestClient, media_file: str) -> None:
    res = client.head(media_file, headers={"Range": "bytes=0-99"})
    assert res.status_code == 206 and res.content == b""
    assert res.headers["content-range"] == f"bytes 0-99/{len(PAYLOAD)}"


def test_large_file_streams_in_chunks(client: TestClient, data_dir: Path) -> None:
    key = "media/ws1/asset1/big.bin"
    big = data_dir / key
    big.write_bytes(b"x" * 700_000 + b"END")
    res = client.get(sign_media(key), headers={"Range": "bytes=699990-"})
    assert res.status_code == 206 and res.content == b"x" * 10 + b"END"
    assert res.headers["content-type"] == "application/octet-stream"


def test_signature_checks(client: TestClient, media_file: str) -> None:
    path, _, query = media_file.partition("?")
    assert client.get(f"{path}?{query}x").status_code == 403
    assert client.get(path).status_code == 403
    other = sign_media("media/ws1/asset1/other.mp4")
    sig = other.split("sig=")[1]
    exp = other.split("exp=")[1].split("&")[0]
    assert client.get(f"{path}?exp={exp}&sig={sig}").status_code == 403
    expired = sign_media(KEY, ttl=-5)
    res = client.get(expired)
    assert res.status_code == 403 and res.json()["error"]["details"]["reason"] == "expired"


def test_missing_file_and_traversal(client: TestClient) -> None:
    assert client.get(sign_media("media/ws1/nope.mp4")).status_code == 404
    exp = int(time.time()) + 60
    from app.security import _media_sig

    evil = "media/../../etc/passwd"
    res = client.get(f"/media/{evil}?exp={exp}&sig={_media_sig(evil, exp)}")
    assert res.status_code in (400, 404, 422)
    assert b"root:" not in res.content
