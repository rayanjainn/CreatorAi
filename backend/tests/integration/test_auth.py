from __future__ import annotations

import time

import jwt
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.db import session_scope
from app.models import TwinMemory


def test_health_is_public_and_reports_features(client: TestClient) -> None:
    body = client.get("/api/v1/health").json()
    assert body["status"] == "ok" and body["version"]
    feats = body["features"]
    assert feats["llm"]["data_mode"] == "mock" and body["data_mode"] == "mock"
    assert feats["llm"]["providers"]["gemini"] == {"configured": False, "healthy": False}
    assert feats["llm"]["order"] == ["gemini", "groq", "ollama"] and feats["llm"]["mock"] is True
    assert feats["embedder"]["backend"] == "hashing" and feats["embedder"]["real"] is False
    assert feats["embedder"]["backend"] == "hashing"
    assert isinstance(feats["ffmpeg"]["present"], bool)
    assert feats["asr"]["sidecar"] is True


def test_signup_login_me_flow(client: TestClient) -> None:
    res = client.post(
        "/api/v1/auth/signup",
        json={"email": "Ada@Example.com", "password": "correct horse", "display_name": "Ada"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["email"] == "ada@example.com"
    assert body["profile"]["onboarding_done"] is False
    assert body["profile"]["display_name"] == "Ada"
    token = body["access_token"]

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["workspace_id"] == body["workspace_id"]

    login = client.post(
        "/api/v1/auth/login", json={"email": "ADA@example.com", "password": "correct horse"}
    )
    assert login.status_code == 200 and login.json()["workspace_id"] == body["workspace_id"]

    bad = client.post(
        "/api/v1/auth/login", json={"email": "ada@example.com", "password": "nope nope"}
    )
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_signup_closed_after_first_user_unless_multi(
    client: TestClient, auth: dict[str, str]
) -> None:
    second = {"email": "other@example.com", "password": "password123"}
    res = client.post("/api/v1/auth/signup", json=second)
    assert res.status_code == 403 and res.json()["error"]["code"] == "SIGNUP_CLOSED"
    settings = get_settings()
    settings.auth_allow_multi = True
    try:
        assert client.post("/api/v1/auth/signup", json=second).status_code == 201
        dup = client.post("/api/v1/auth/signup", json=second)
        assert dup.status_code == 409 and dup.json()["error"]["code"] == "EMAIL_TAKEN"
    finally:
        settings.auth_allow_multi = False


def test_signup_validation_error_shape(client: TestClient) -> None:
    res = client.post("/api/v1/auth/signup", json={"email": "nope", "password": "short"})
    assert res.status_code == 422
    err = res.json()["error"]
    assert err["code"] == "VALIDATION_ERROR" and err["details"]["errors"]


def test_jwt_guard(client: TestClient, auth: dict[str, str]) -> None:
    assert client.get("/api/v1/me").status_code == 401
    assert client.get("/api/v1/me").json()["error"]["code"] == "UNAUTHORIZED"
    assert client.get("/api/v1/me", headers={"Authorization": "Bearer junk"}).status_code == 401
    assert client.get("/api/v1/me", headers=auth).status_code == 200
    forged = jwt.encode(
        {"sub": "x", "ws": "y", "exp": int(time.time()) + 60}, "k" * 40, algorithm="HS256"
    )
    assert (
        client.get("/api/v1/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    )
    token = auth["Authorization"].split()[1]
    assert client.get(f"/api/v1/me?access_token={token}").status_code == 200  # SSE-style GET


def test_token_for_deleted_user_is_rejected(client: TestClient, auth: dict[str, str]) -> None:
    from app.db import session_scope
    from app.models import User

    with session_scope() as db:
        db.query(User).delete()
    assert client.get("/api/v1/me", headers=auth).status_code == 401


def test_profile_get_put(client: TestClient, auth: dict[str, str]) -> None:
    res = client.put(
        "/api/v1/profile",
        headers=auth,
        json={"display_name": "Nova", "domain": "business", "audience": "founders"},
    )
    assert res.status_code == 200
    got = client.get("/api/v1/profile", headers=auth).json()
    assert got["display_name"] == "Nova" and got["domain"] == "business" and got["tone"]
    assert client.put("/api/v1/profile", headers=auth, json={"domain": "bogus"}).status_code == 422


def test_onboarding_stores_sample_scripts_as_memories(
    client: TestClient, auth: dict[str, str], workspace_id: str
) -> None:
    res = client.post(
        "/api/v1/onboarding",
        headers=auth,
        json={
            "display_name": "Nova",
            "domain": "technology",
            "audience": "builders",
            "tone": "direct, witty",
            "caption_style": "karaoke",
            "preferred_aspect": "9:16",
            "sample_scripts": ["Ship it. Then fix it.", "  ", "Stop planning and start recording."],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["memories_created"] == 2 and body["profile"]["onboarding_done"] is True
    style = body["profile"]["style_profile"]
    assert style["captions"]["style"] == "karaoke" and "direct" in style["tone_descriptors"]
    with session_scope() as db:
        rows = list(db.scalars(select(TwinMemory).where(TwinMemory.workspace_id == workspace_id)))
    assert len(rows) == 2 and all(
        r.kind == "approved_script" and len(r.embedding) == 384 * 4 for r in rows
    )


def test_error_shapes(client: TestClient, auth: dict[str, str]) -> None:
    res = client.get("/api/v1/does-not-exist", headers=auth)
    assert res.status_code == 404 and res.json()["error"]["code"] == "NOT_FOUND"
    assert client.delete("/api/v1/health").json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_db_dependency_commits_before_response_is_sent() -> None:
    """A write must be visible to the next request even if the client is fast (real servers)."""
    from app.deps import DbDep

    assert DbDep.__metadata__[0].scope == "function"  # type: ignore[attr-defined]
