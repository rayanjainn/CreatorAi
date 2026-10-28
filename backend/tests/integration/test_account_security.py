"""Password change, signing out everywhere, login throttling, data export and wipe."""

from __future__ import annotations

import io
from typing import Any

from fastapi.testclient import TestClient

from app.db import session_scope
from app.models import Asset, ContentItem
from app.storage.local import get_storage
from tests.helpers import V1, Hdr

EMAIL, PASSWORD = "creator@example.com", "password123"


def login(client: TestClient, password: str = PASSWORD) -> Any:
    return client.post(f"{V1}/auth/login", json={"email": EMAIL, "password": password})


def test_changing_the_password_signs_out_other_sessions(client: TestClient, auth: Hdr) -> None:
    other = {"Authorization": f"Bearer {login(client).json()['access_token']}"}
    bad = client.post(
        f"{V1}/auth/password",
        json={"current_password": "nope-nope", "new_password": "brand-new-pass"},
        headers=auth,
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_CREDENTIALS"
    res = client.post(
        f"{V1}/auth/password",
        json={"current_password": PASSWORD, "new_password": "brand-new-pass"},
        headers=auth,
    )
    assert res.status_code == 200, res.text
    fresh = {"Authorization": f"Bearer {res.json()['access_token']}"}
    assert client.get(f"{V1}/me", headers=fresh).status_code == 200
    assert client.get(f"{V1}/me", headers=other).status_code == 401  # signed out
    assert client.get(f"{V1}/me", headers=auth).status_code == 401
    assert login(client).status_code == 401
    assert login(client, "brand-new-pass").status_code == 200


def test_sign_out_everywhere_keeps_only_the_returned_token(client: TestClient, auth: Hdr) -> None:
    res = client.post(f"{V1}/auth/sign-out-everywhere", headers=auth)
    assert res.status_code == 200
    assert client.get(f"{V1}/me", headers=auth).status_code == 401
    assert (
        client.get(
            f"{V1}/me", headers={"Authorization": f"Bearer {res.json()['access_token']}"}
        ).status_code
        == 200
    )


def test_repeated_wrong_passwords_are_throttled(client: TestClient, auth: Hdr) -> None:
    for _ in range(5):
        assert login(client, "wrong-password").status_code == 401
    blocked = login(client, "wrong-password")
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "TOO_MANY_ATTEMPTS"
    assert int(blocked.headers["retry-after"]) > 0
    assert login(client).status_code == 429  # even the right one waits: the window is per address


def test_export_contains_the_work_and_no_secrets(client: TestClient, auth: Hdr) -> None:
    client.post(f"{V1}/content", json={"title": "My video idea"}, headers=auth)
    client.post(f"{V1}/monetization/deals", json={"brand": "Acme", "fee": 500}, headers=auth)
    res = client.get(f"{V1}/workspace/export", headers=auth)
    assert res.status_code == 200 and "attachment" in res.headers["content-disposition"]
    body = res.json()
    assert body["format"] == "creatorai-export"
    assert [p["title"] for p in body["projects"]] == ["My video idea"]
    assert body["brand_deals"][0]["brand"] == "Acme"
    assert "password" not in res.text and "refresh_token" not in res.text


def test_wipe_needs_the_word_and_removes_projects_and_files(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    item = client.post(f"{V1}/content", json={"title": "Doomed"}, headers=auth).json()["id"]
    key = f"media/{workspace_id}/a1/original.mp4"  # a file only this workspace owns
    get_storage().put_file(key, io.BytesIO(b"bytes"))
    with session_scope() as db:
        db.add(
            Asset(
                workspace_id=workspace_id,
                content_item_id=item,
                kind="video",
                filename="a.mp4",
                storage_key=key,
                mime="video/mp4",
                size_bytes=5,
                sha256="x" * 64,
                status="ready",
            )
        )
    assert (
        client.post(f"{V1}/workspace/wipe", json={"confirm": "delete"}, headers=auth).status_code
        == 409
    )
    res = client.post(f"{V1}/workspace/wipe", json={"confirm": "DELETE"}, headers=auth)
    assert res.status_code == 200, res.text
    assert res.json()["content_items"] == 1 and res.json()["assets"] == 1
    with session_scope() as db:
        assert db.query(ContentItem).count() == 0 and db.query(Asset).count() == 0
    assert not get_storage().exists(key)
    assert client.get(f"{V1}/me", headers=auth).status_code == 200  # the account stays
