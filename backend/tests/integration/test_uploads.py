"""Chunked and one-shot uploads: resume, idempotency, dedupe, limits and the asset endpoints."""

from __future__ import annotations

import hashlib
import os
from collections import namedtuple
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.services import uploads as upload_service

pytestmark = pytest.mark.usefixtures("no_processing")
V1 = "/api/v1"
Hdr = dict[str, str]


@pytest.fixture(autouse=True)
def small_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "upload_chunk_size", 10)


def init(client: TestClient, auth: Hdr, data: bytes, name: str = "notes.txt", **kw: Any) -> Any:
    res = client.post(
        f"{V1}/uploads",
        json={"filename": name, "mime": "", "size_bytes": len(data), **kw},
        headers=auth,
    )
    assert res.status_code == 201, res.text
    return res.json()


def send(client: TestClient, auth: Hdr, up: Any, data: bytes, indexes: list[int]) -> None:
    size = up["chunk_size"]
    for i in indexes:
        res = client.put(
            f"{V1}/uploads/{up['id']}/chunks/{i}",
            content=data[i * size : (i + 1) * size],
            headers=auth,
        )
        assert res.status_code == 200, res.text


def upload_all(client: TestClient, auth: Hdr, data: bytes, name: str = "notes.txt") -> Any:
    up = init(client, auth, data, name)
    send(client, auth, up, data, list(range(up["total_chunks"])))
    res = client.post(f"{V1}/uploads/{up['id']}/complete", headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


def test_requires_auth(client: TestClient) -> None:
    assert client.post(f"{V1}/uploads", json={}).status_code == 401
    assert client.get(f"{V1}/assets").status_code == 401


def test_chunked_upload_end_to_end(client: TestClient, auth: Hdr, workspace_id: str) -> None:
    data = b"hello creator, this is a tiny text document!"
    up = init(client, auth, data)
    assert up["chunk_size"] == 10 and up["total_chunks"] == 5 and up["received_chunks"] == []
    send(client, auth, up, data, [0, 2])  # out of order and partial
    status = client.get(f"{V1}/uploads/{up['id']}", headers=auth).json()
    assert status["received_chunks"] == [0, 2] and status["status"] == "uploading"
    send(client, auth, up, data, [1, 3, 4])
    done = client.post(f"{V1}/uploads/{up['id']}/complete", headers=auth).json()
    asset = done["asset"]
    assert done["duplicate"] is False and done["upload"]["status"] == "completed"
    assert asset["sha256"] == hashlib.sha256(data).hexdigest()
    assert asset["kind"] == "document" and asset["status"] == "uploaded"
    assert asset["provenance"]["source"] == "user"
    stored = get_settings().data_dir / "media" / workspace_id / asset["id"] / "original.txt"
    assert stored.read_bytes() == data
    assert not upload_service.upload_dir(workspace_id, up["id"]).exists()  # chunks cleaned up
    again = client.post(f"{V1}/uploads/{up['id']}/complete", headers=auth).json()
    assert again["asset"]["id"] == asset["id"]  # complete is idempotent


def test_chunk_resend_is_idempotent_and_validates(client: TestClient, auth: Hdr) -> None:
    data = b"0123456789abcdefghij!"  # 21 bytes: chunks of 10, 10, 1
    up = init(client, auth, data)
    assert up["total_chunks"] == 3
    send(client, auth, up, data, [0, 0, 0])
    assert client.get(f"{V1}/uploads/{up['id']}", headers=auth).json()["received_chunks"] == [0]
    url = f"{V1}/uploads/{up['id']}/chunks"
    assert client.put(f"{url}/1", content=b"short", headers=auth).status_code == 422
    assert client.put(f"{url}/2", content=b"toolong", headers=auth).status_code == 422
    assert client.put(f"{url}/9", content=b"x", headers=auth).status_code == 422
    big = client.put(f"{url}/0", content=b"x" * 11, headers=auth)
    assert big.status_code == 422 and big.json()["error"]["code"] == "VALIDATION_ERROR"
    send(client, auth, up, data, [1, 2])
    assert client.post(f"{V1}/uploads/{up['id']}/complete", headers=auth).status_code == 200


def test_complete_with_missing_chunks_lists_them(client: TestClient, auth: Hdr) -> None:
    data = b"x" * 25
    up = init(client, auth, data)
    send(client, auth, up, data, [0])
    res = client.post(f"{V1}/uploads/{up['id']}/complete", headers=auth)
    assert res.status_code == 409
    err = res.json()["error"]
    assert err["code"] == "UPLOAD_INCOMPLETE" and err["details"]["missing"] == [1, 2]


def test_resume_after_deleted_chunk_file(client: TestClient, auth: Hdr, workspace_id: str) -> None:
    data = b"y" * 30
    up = init(client, auth, data)
    send(client, auth, up, data, [0, 1, 2])
    os.remove(upload_service.chunk_path(workspace_id, up["id"], 1))  # simulate a lost chunk
    assert client.get(f"{V1}/uploads/{up['id']}", headers=auth).json()["received_chunks"] == [0, 2]
    send(client, auth, up, data, [1])
    assert client.post(f"{V1}/uploads/{up['id']}/complete", headers=auth).status_code == 200


def test_duplicate_upload_reuses_asset(client: TestClient, auth: Hdr) -> None:
    data = b"same bytes uploaded twice"
    first = upload_all(client, auth, data, "a.txt")
    second = upload_all(client, auth, data, "b.txt")
    assert first["duplicate"] is False and second["duplicate"] is True
    assert second["asset"]["id"] == first["asset"]["id"] and second["job_id"] is None
    assert client.get(f"{V1}/assets", headers=auth).json()["total"] == 1


def test_abort_removes_chunks_and_closes_upload(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    data = b"z" * 20
    up = init(client, auth, data)
    send(client, auth, up, data, [0])
    res = client.post(f"{V1}/uploads/{up['id']}/abort", headers=auth)
    assert res.json()["status"] == "aborted"
    assert not upload_service.upload_dir(workspace_id, up["id"]).exists()
    assert (
        client.put(f"{V1}/uploads/{up['id']}/chunks/1", content=b"z" * 10, headers=auth).status_code
        == 409
    )
    assert client.post(f"{V1}/uploads/{up['id']}/complete", headers=auth).status_code == 409


def test_size_limit_and_disk_space(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "max_upload_bytes", 100)
    res = client.post(
        f"{V1}/uploads", json={"filename": "big.mp4", "mime": "", "size_bytes": 101}, headers=auth
    )
    assert res.status_code == 413 and res.json()["error"]["code"] == "UPLOAD_TOO_LARGE"
    monkeypatch.setattr(settings, "max_upload_bytes", 10**9)
    Usage = namedtuple("Usage", "total used free")
    monkeypatch.setattr(upload_service.shutil, "disk_usage", lambda _p: Usage(10**9, 10**9 - 5, 5))
    res = client.post(
        f"{V1}/uploads", json={"filename": "big.mp4", "mime": "", "size_bytes": 50}, headers=auth
    )
    assert res.status_code == 507 and res.json()["error"]["code"] == "INSUFFICIENT_STORAGE"


def test_init_rejects_unknown_content_item(client: TestClient, auth: Hdr) -> None:
    res = client.post(
        f"{V1}/uploads",
        json={"filename": "a.txt", "mime": "", "size_bytes": 5, "content_item_id": "nope"},
        headers=auth,
    )
    assert res.status_code == 404


def test_one_shot_upload_with_sidecar_and_validation(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    srt = b"1\n00:00:00,000 --> 00:00:02,000\nHello there friend\n"
    res = client.post(
        f"{V1}/assets/upload",
        files={
            "file": ("clip.mp4", b"not really a video", "video/mp4"),
            "sidecar": ("clip.srt", srt, "application/x-subrip"),
        },
        headers=auth,
    )
    assert res.status_code == 201, res.text
    asset = res.json()["asset"]
    assert asset["kind"] == "video" and asset["mime"] == "video/mp4"
    detail = client.get(f"{V1}/assets/{asset['id']}", headers=auth).json()
    assert detail["analysis"]["sidecar"]["format"] == "srt"
    assert detail["analysis"]["sidecar"]["source"] == "user"
    assert detail["urls"]["original"].startswith("/media/media/")
    bad = client.post(
        f"{V1}/assets/upload",
        files={
            "file": ("other.mp4", b"another", "video/mp4"),
            "sidecar": ("x.srt", b"garbage", "text/plain"),
        },
        headers=auth,
    )
    assert bad.status_code == 422
    leftovers = list((get_settings().tmp_dir / "uploads" / workspace_id).glob("*.bin"))
    assert leftovers == []  # nothing left behind by the rejected upload
    assert client.get(f"{V1}/assets", headers=auth).json()["total"] == 1


def test_list_filters_sort_and_pagination(client: TestClient, auth: Hdr) -> None:
    for name, body in [("b.txt", b"bbb"), ("a.mp4", b"aaaa"), ("c.png", b"cc")]:
        client.post(f"{V1}/assets/upload", files={"file": (name, body)}, headers=auth)
    listing = client.get(f"{V1}/assets", params={"sort": "filename"}, headers=auth).json()
    assert [a["filename"] for a in listing["items"]] == ["a.mp4", "b.txt", "c.png"]
    assert client.get(f"{V1}/assets", params={"kind": "image"}, headers=auth).json()["total"] == 1
    assert client.get(f"{V1}/assets", params={"q": "B.T"}, headers=auth).json()["total"] == 1
    assert (
        client.get(f"{V1}/assets", params={"sort": "-size"}, headers=auth).json()["items"][0][
            "filename"
        ]
        == "a.mp4"
    )
    page = client.get(f"{V1}/assets", params={"limit": 2, "offset": 2}, headers=auth).json()
    assert page["total"] == 3 and len(page["items"]) == 1
    assert client.get(f"{V1}/assets", params={"kind": "bogus"}, headers=auth).status_code == 422


def test_patch_tags_description_and_tag_filter(client: TestClient, auth: Hdr) -> None:
    asset = client.post(
        f"{V1}/assets/upload", files={"file": ("n.txt", b"hello")}, headers=auth
    ).json()["asset"]
    res = client.patch(
        f"{V1}/assets/{asset['id']}",
        json={
            "tags": ["Intro", " intro ", "b-roll"],
            "folder": "shoots/day1",
            "description": " My note ",
        },
        headers=auth,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["tags"] == ["Intro", "b-roll"] and body["folder"] == "/shoots/day1"
    assert (
        body["description"] == "My note"
        and body["provenance_by_stage"]["description"]["source"] == "user"
    )
    assert client.get(f"{V1}/assets", params={"tag": "B-ROLL"}, headers=auth).json()["total"] == 1
    assert client.get(f"{V1}/assets", params={"tag": "nope"}, headers=auth).json()["total"] == 0


def test_delete_removes_row_and_files(client: TestClient, auth: Hdr, workspace_id: str) -> None:
    asset = client.post(
        f"{V1}/assets/upload", files={"file": ("n.txt", b"bye")}, headers=auth
    ).json()["asset"]
    folder: Path = get_settings().data_dir / "media" / workspace_id / asset["id"]
    assert folder.is_dir()
    assert client.delete(f"{V1}/assets/{asset['id']}", headers=auth).status_code == 204
    assert not folder.exists()
    assert client.get(f"{V1}/assets/{asset['id']}", headers=auth).status_code == 404
    assert client.delete(f"{V1}/assets/{asset['id']}", headers=auth).status_code == 404


def test_purge_stale_uploads(client: TestClient, auth: Hdr, workspace_id: str) -> None:
    from datetime import UTC, datetime, timedelta

    from app.db import session_scope

    up = init(client, auth, b"x" * 20)
    send(client, auth, up, b"x" * 20, [0])
    with session_scope() as db:
        n = upload_service.purge_stale_uploads(db, now=datetime.now(UTC) + timedelta(hours=48))
    assert n == 1
    assert client.get(f"{V1}/uploads/{up['id']}", headers=auth).json()["status"] == "aborted"
    assert not upload_service.upload_dir(workspace_id, up["id"]).exists()


def test_transcript_endpoints_without_pipeline(client: TestClient, auth: Hdr) -> None:
    asset = client.post(
        f"{V1}/assets/upload", files={"file": ("v.mp4", b"vid")}, headers=auth
    ).json()["asset"]
    assert client.get(f"{V1}/assets/{asset['id']}/transcript", headers=auth).status_code == 404
    words = '{"language":"en","words":[{"word":"Hi","start":0.1,"end":0.4}]}'
    res = client.put(f"{V1}/assets/{asset['id']}/transcript", content=words, headers=auth)
    assert res.status_code == 202 and res.json()["job_id"] is None
    detail = client.get(f"{V1}/assets/{asset['id']}", headers=auth).json()
    assert detail["analysis"]["sidecar"]["format"] == "words.json"
    assert (
        client.put(
            f"{V1}/assets/{asset['id']}/transcript", content="garbage", headers=auth
        ).status_code
        == 422
    )
    doc = client.post(
        f"{V1}/assets/upload", files={"file": ("d.txt", b"text")}, headers=auth
    ).json()["asset"]
    assert (
        client.put(f"{V1}/assets/{doc['id']}/transcript", content=words, headers=auth).status_code
        == 409
    )
