from __future__ import annotations

import time

import jwt
import pytest

from app.config import get_settings
from app.errors import AppError
from app.security import (
    decrypt_token,
    encrypt_token,
    hash_password,
    issue_token,
    sign_media,
    verify_media,
    verify_password,
    verify_token,
)


def test_password_roundtrip() -> None:
    hashed = hash_password("hunter2hunter2")
    assert hashed.startswith("scrypt$") and "hunter2" not in hashed
    assert verify_password("hunter2hunter2", hashed)
    assert not verify_password("wrong", hashed)
    assert not verify_password("x", "garbage")
    assert hash_password("a") != hash_password("a")  # random salt


def test_jwt_claims_and_expiry() -> None:
    claims = verify_token(issue_token("u1", "w1"))
    assert claims["sub"] == "u1" and claims["ws"] == "w1"
    assert 6.9 * 86400 < claims["exp"] - time.time() <= 7 * 86400
    expired = jwt.encode(
        {"sub": "u", "ws": "w", "exp": int(time.time()) - 5},
        __import__("app.security", fromlist=["_derive"])._derive("jwt"),
        algorithm="HS256",
    )
    with pytest.raises(AppError) as exc:
        verify_token(expired)
    assert exc.value.code == "UNAUTHORIZED"
    with pytest.raises(AppError):
        verify_token("not.a.token")
    forged = jwt.encode(
        {"sub": "u", "ws": "w", "exp": time.time() + 99}, "o" * 40, algorithm="HS256"
    )
    with pytest.raises(AppError):
        verify_token(forged)


def test_signed_media_url() -> None:
    url = sign_media("media/w/a/proxy.mp4", ttl=60)
    path, _, query = url.partition("?")
    assert path == "/media/media/w/a/proxy.mp4"
    params = dict(p.split("=") for p in query.split("&"))
    verify_media("media/w/a/proxy.mp4", int(params["exp"]), params["sig"])
    with pytest.raises(AppError):
        verify_media("media/w/a/other.mp4", int(params["exp"]), params["sig"])
    with pytest.raises(AppError):
        verify_media("media/w/a/proxy.mp4", int(params["exp"]) + 1, params["sig"])
    expired = sign_media("k.mp4", ttl=-10)
    exp, sig = (p.split("=")[1] for p in expired.split("?")[1].split("&"))
    with pytest.raises(AppError) as exc:
        verify_media("k.mp4", int(exp), sig)
    assert exc.value.details["reason"] == "expired"
    assert get_settings().media_url_ttl_sec == 3600


def test_fernet_roundtrip() -> None:
    token = encrypt_token("refresh-token-123")
    assert "refresh" not in token
    assert decrypt_token(token) == "refresh-token-123"
    with pytest.raises(AppError):
        decrypt_token("bm90LWZlcm5ldA==")
