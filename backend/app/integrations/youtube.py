"""Google OAuth and the YouTube Data API v3: the few calls CreatorAi needs.

* ``auth_url`` / ``exchange_code`` / ``refresh`` — OAuth 2.0 for a web app (offline access, so a
  refresh token comes back on first consent).
* ``channel`` — the connected channel's id and title.
* ``upload`` — a resumable upload (``uploadType=resumable``): one POST with the metadata, then
  the file in chunks with ``Content-Range``; ``308`` means "send the rest", ``200/201`` returns
  the video resource.
* ``video_stats`` — public counters (views, likes, comments) for up to 50 ids per call.

Every function takes an optional ``httpx.Client`` so tests run against ``httpx.MockTransport``.
"""

from __future__ import annotations

import contextlib
import json
import time
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings
from app.errors import AppError

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API = "https://www.googleapis.com/youtube/v3"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
SCOPES = (
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
)
CHUNK = 8 * 1024 * 1024  # a multiple of 256 KiB, as the resumable protocol requires
MAX_RESUMES = 20


def _client(http: httpx.Client | None, timeout: float = 30.0) -> httpx.Client:
    return http or httpx.Client(timeout=httpx.Timeout(timeout, connect=10.0))


def _fail(res: httpx.Response, what: str) -> AppError:
    """A readable error from a Google error body (``{"error": {"message": ...}}`` or OAuth's)."""
    try:
        body = res.json()
    except ValueError:
        body = {}
    err = body.get("error")
    if isinstance(err, dict):
        message = err.get("message") or str(err.get("status") or "")
        reason = ((err.get("errors") or [{}])[0] or {}).get("reason", "")
    else:
        message = body.get("error_description") or str(err or "")
        reason = str(err or "")
    if res.status_code == 403 and reason in ("quotaExceeded", "uploadLimitExceeded"):
        return AppError(
            "QUOTA_EXCEEDED",
            "YouTube's daily upload quota is used up. Try again tomorrow.",
            details={"reason": reason},
        )
    if reason == "invalid_grant":
        return AppError(
            "NO_YOUTUBE_CONNECTION",
            "YouTube access was revoked or expired. Connect the channel again in Settings.",
            details={"reason": reason},
            retryable=False,
        )
    return AppError(
        "YOUTUBE_FAILED",
        f"YouTube could not {what}: {message or res.reason_phrase}"[:400],
        status=502,
        details={"status": res.status_code, "reason": reason},
    )


def auth_url(state: str) -> str:
    s = get_settings()
    params = {
        "client_id": s.google_client_id,
        "redirect_uri": s.google_redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",  # always return a refresh token
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str, http: httpx.Client | None = None) -> dict[str, Any]:
    s = get_settings()
    client = _client(http)
    res = client.post(
        TOKEN_URL,
        data={
            "code": code,
            "client_id": s.google_client_id,
            "client_secret": s.google_client_secret,
            "redirect_uri": s.google_redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    if res.status_code != 200:
        raise _fail(res, "finish connecting")
    out: dict[str, Any] = res.json()
    return out


def refresh(refresh_token: str, http: httpx.Client | None = None) -> tuple[str, float]:
    """``(access_token, expires_at_epoch)`` from a refresh token."""
    s = get_settings()
    res = _client(http).post(
        TOKEN_URL,
        data={
            "refresh_token": refresh_token,
            "client_id": s.google_client_id,
            "client_secret": s.google_client_secret,
            "grant_type": "refresh_token",
        },
    )
    if res.status_code != 200:
        raise _fail(res, "refresh access")
    body = res.json()
    return str(body["access_token"]), time.time() + float(body.get("expires_in", 3600)) - 60


def revoke(token: str, http: httpx.Client | None = None) -> None:
    # best effort: the local connection is removed either way
    with contextlib.suppress(httpx.HTTPError):
        _client(http).post(REVOKE_URL, data={"token": token})


def channel(access_token: str, http: httpx.Client | None = None) -> dict[str, str]:
    res = _client(http).get(
        f"{API}/channels",
        params={"part": "snippet", "mine": "true"},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if res.status_code != 200:
        raise _fail(res, "read your channel")
    items = res.json().get("items") or []
    if not items:
        raise AppError(
            "YOUTUBE_FAILED",
            "This Google account has no YouTube channel. Create one on YouTube first.",
            status=409,
        )
    return {"id": items[0]["id"], "title": items[0]["snippet"].get("title", "")}


def upload(
    access_token: str,
    path: Path,
    metadata: dict[str, Any],
    *,
    http: httpx.Client | None = None,
    on_progress: Callable[[int, int], None] | None = None,
    chunk: int = CHUNK,
) -> dict[str, Any]:
    """Resumable upload of ``path``; returns the created video resource."""
    size = path.stat().st_size
    client = _client(http, timeout=120.0)
    auth = {"Authorization": f"Bearer {access_token}"}
    start = client.post(
        UPLOAD_URL,
        params={"uploadType": "resumable", "part": "snippet,status"},
        headers={
            **auth,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": str(size),
        },
        content=json.dumps(metadata).encode(),
    )
    if start.status_code != 200 or "location" not in start.headers:
        raise _fail(start, "start the upload")
    session = start.headers["location"]
    sent = 0
    resumes = 0
    with path.open("rb") as fh:
        while True:
            fh.seek(sent)
            data = fh.read(chunk)
            end = sent + len(data) - 1
            headers = {**auth, "Content-Type": "video/mp4"}
            headers["Content-Range"] = f"bytes {sent}-{end}/{size}" if data else f"bytes */{size}"
            try:
                res = client.put(session, headers=headers, content=data)
            except httpx.TransportError:
                resumes += 1
                if resumes > MAX_RESUMES:
                    raise
                res = client.put(session, headers={**auth, "Content-Range": f"bytes */{size}"})
            if res.status_code in (200, 201):
                if on_progress:
                    on_progress(size, size)
                out: dict[str, Any] = res.json()
                return out
            if res.status_code == 308:
                rng = res.headers.get("range")  # "bytes=0-12345"
                sent = int(rng.rsplit("-", 1)[1]) + 1 if rng else 0
                if on_progress:
                    on_progress(sent, size)
                continue
            if res.status_code >= 500 and resumes < MAX_RESUMES:
                resumes += 1
                time.sleep(min(2**resumes, 30) if resumes > 1 else 0)
                continue
            raise _fail(res, "upload the video")


def video_stats(
    access_token: str, ids: Iterable[str], http: httpx.Client | None = None
) -> dict[str, dict[str, Any]]:
    """``{video_id: {views, likes, comments, title, published_at, duration}}``."""
    ids = [i for i in ids if i]
    out: dict[str, dict[str, Any]] = {}
    client = _client(http)
    for n in range(0, len(ids), 50):
        res = client.get(
            f"{API}/videos",
            params={
                "part": "statistics,snippet,contentDetails,status",
                "id": ",".join(ids[n : n + 50]),
            },
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if res.status_code != 200:
            raise _fail(res, "read video statistics")
        for item in res.json().get("items") or []:
            st = item.get("statistics") or {}
            sn = item.get("snippet") or {}
            out[item["id"]] = {
                "views": int(st.get("viewCount", 0) or 0),
                "likes": int(st.get("likeCount", 0) or 0),
                "comments": int(st.get("commentCount", 0) or 0),
                "title": sn.get("title", ""),
                "published_at": sn.get("publishedAt"),
                "duration": (item.get("contentDetails") or {}).get("duration"),
                "privacy": (item.get("status") or {}).get("privacyStatus"),
                "upload_status": (item.get("status") or {}).get("uploadStatus"),
            }
    return out
