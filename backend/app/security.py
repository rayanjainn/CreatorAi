"""Password hashing, JWTs, signed media URLs and Fernet token crypto."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

import jwt
from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings
from app.errors import AppError

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


# ── passwords ─────────────────────────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    """scrypt hash encoded as ``scrypt$n$r$p$salt$hash`` (base64url, unpadded)."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
    )
    return "$".join(
        ["scrypt", str(_SCRYPT_N), str(_SCRYPT_R), str(_SCRYPT_P), _b64(salt), _b64(digest)]
    )


def verify_password(password: str, encoded: str) -> bool:
    """Constant-time check of ``password`` against a ``hash_password`` string."""
    try:
        scheme, n, r, p, salt, expected = encoded.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=32
        )
        return hmac.compare_digest(digest, _unb64(expected))
    except (ValueError, TypeError):
        return False


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ── JWT ───────────────────────────────────────────────────────────────────────────────────────
def _derive(label: str) -> bytes:
    return hashlib.sha256(f"{label}:{get_settings().app_secret}".encode()).digest()


def issue_token(user_id: str, workspace_id: str) -> str:
    """HS256 JWT valid for ``JWT_TTL_DAYS`` (default 7) carrying the user and workspace ids."""
    now = datetime.now(UTC)
    claims = {
        "sub": user_id,
        "ws": workspace_id,
        "iat": now,
        "exp": now + timedelta(days=get_settings().jwt_ttl_days),
    }
    return jwt.encode(claims, _derive("jwt"), algorithm="HS256")


def verify_token(token: str) -> dict[str, Any]:
    """Return the JWT claims or raise ``UNAUTHORIZED``."""
    try:
        claims = jwt.decode(
            token, _derive("jwt"), algorithms=["HS256"], options={"require": ["exp", "sub"]}
        )
    except jwt.ExpiredSignatureError as exc:
        raise AppError("UNAUTHORIZED", "Session expired, please sign in again") from exc
    except jwt.InvalidTokenError as exc:
        raise AppError("UNAUTHORIZED", "Invalid authentication token") from exc
    if not claims.get("ws"):
        raise AppError("UNAUTHORIZED", "Invalid authentication token")
    return claims


# ── signed media URLs ─────────────────────────────────────────────────────────────────────────
def _media_sig(key: str, exp: int) -> str:
    secret = get_settings().media_signing_secret.encode()
    return hmac.new(secret, f"{key}|{exp}".encode(), hashlib.sha256).hexdigest()


def sign_media(key: str, ttl: int | None = None, *, download_name: str | None = None) -> str:
    """Relative signed URL ``/media/{key}?exp=&sig=`` valid for ``ttl`` seconds (default 1 h).

    With ``download_name`` the URL carries ``&dl=<name>``: the media route then answers with
    ``Content-Disposition: attachment`` (the name is cosmetic and not part of the signature).
    """
    ttl = get_settings().media_url_ttl_sec if ttl is None else ttl
    exp = int(time.time()) + ttl
    url = f"/media/{quote(key, safe='/')}?exp={exp}&sig={_media_sig(key, exp)}"
    return f"{url}&dl={quote(download_name)}" if download_name else url


def verify_media(key: str, exp: int, sig: str) -> None:
    """Raise ``FORBIDDEN`` unless ``sig`` matches ``key|exp`` and ``exp`` is in the future."""
    if not hmac.compare_digest(_media_sig(key, exp), sig):
        raise AppError("FORBIDDEN", "Invalid media signature", details={"reason": "bad_signature"})
    if exp < time.time():
        raise AppError("FORBIDDEN", "Media link expired", details={"reason": "expired"})


# ── token crypto (refresh tokens at rest) ─────────────────────────────────────────────────────
def _fernet() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(_derive("fernet")))


def encrypt_token(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise AppError("INTERNAL_ERROR", "Stored credential cannot be decrypted") from exc


# ── signed OAuth state (round-trips through Google, so it must be tamper-proof) ─────────────
def sign_state(workspace_id: str, user_id: str, ttl: int = 900) -> str:
    """``ws.user.exp.sig`` valid for ``ttl`` seconds."""
    exp = int(time.time()) + ttl
    body = f"{workspace_id}.{user_id}.{exp}"
    sig = hmac.new(_derive("oauth-state"), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def verify_state(state: str) -> tuple[str, str]:
    """``(workspace_id, user_id)`` from a state made by :func:`sign_state`, else ``FORBIDDEN``."""
    try:
        ws, user, exp, sig = state.split(".")
        expected = hmac.new(
            _derive("oauth-state"), f"{ws}.{user}.{exp}".encode(), hashlib.sha256
        ).hexdigest()
        ok = hmac.compare_digest(expected, sig) and int(exp) >= time.time()
    except ValueError:
        ok = False
    if not ok:
        raise AppError("FORBIDDEN", "The connection link expired. Start again from Settings.")
    return ws, user
