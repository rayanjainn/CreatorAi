"""The workspace's YouTube connection: OAuth, token refresh, status and the stats sync.

The refresh token is stored encrypted (``security.encrypt_token``); access tokens live only in
memory. ``sync`` reads the public counters of the videos CreatorAi published and stores one row
per video per day in ``yt_metrics_daily``, which Insights shows as real performance.
"""

from __future__ import annotations

import contextlib
import threading
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import AppError
from app.integrations import youtube as yt
from app.models import YoutubeConnection, YtMetricDaily, YtVideo, utcnow
from app.security import decrypt_token, encrypt_token, sign_state, verify_state
from app.services.activity import log_activity

_TOKENS: dict[str, tuple[str, float]] = {}  # workspace -> (access token, expires at)
_LOCK = threading.Lock()


def _require_configured() -> None:
    if not get_settings().google_configured:
        raise AppError(
            "YOUTUBE_NOT_CONFIGURED",
            "YouTube is not set up on this machine. Add a Google OAuth client to .env and restart.",
            details={"env": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]},
        )


def status(db: Session, ws: str) -> dict[str, Any]:
    s = get_settings()
    row = db.get(YoutubeConnection, ws)
    return {
        "configured": s.google_configured,
        "connected": row is not None and row.status == "active",
        "status": row.status if row else None,
        "channel_id": row.channel_id if row else None,
        "channel_title": row.channel_title if row else None,
        "connected_at": row.connected_at if row else None,
        "last_sync_at": row.last_sync_at if row else None,
        "redirect_uri": s.google_redirect_uri,
    }


def start(ws: str, user_id: str) -> dict[str, str]:
    _require_configured()
    return {"url": yt.auth_url(sign_state(ws, user_id))}


def _back(result: str, message: str = "") -> str:
    query = {"youtube": result, **({"message": message[:200]} if message else {})}
    return f"{get_settings().frontend_url.rstrip('/')}/settings?{urlencode(query)}#youtube"


def callback(
    db: Session,
    *,
    code: str | None,
    state: str | None,
    error: str | None,
    http: httpx.Client | None = None,
) -> str:
    """Finish OAuth and return where to send the browser (Settings, with the outcome)."""
    if error:
        return _back(
            "denied", "Google did not grant access." if error == "access_denied" else error
        )
    if not code or not state:
        return _back("error", "The answer from Google was incomplete.")
    try:
        ws, user_id = verify_state(state)
        _require_configured()
        tokens = yt.exchange_code(code, http)
        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            return _back("error", "Google did not return offline access. Try connecting again.")
        info = yt.channel(str(tokens["access_token"]), http)
    except AppError as exc:
        return _back("error", exc.message)
    row = db.get(YoutubeConnection, ws)
    if row is None:
        row = YoutubeConnection(
            workspace_id=ws, channel_id=info["id"], refresh_token_enc="", scopes=[]
        )
        db.add(row)
    row.channel_id, row.channel_title = info["id"], info["title"]
    row.refresh_token_enc = encrypt_token(str(refresh_token))
    row.scopes = str(tokens.get("scope", " ".join(yt.SCOPES))).split()
    row.status, row.connected_at = "active", utcnow()
    db.flush()
    with _LOCK:
        _TOKENS[ws] = (
            str(tokens["access_token"]),
            time.time() + float(tokens.get("expires_in", 3600)) - 60,
        )
    log_activity(
        db, ws, "youtube_connected", "workspace", ws, channel=info["title"], user_id=user_id
    )
    return _back("connected")


def disconnect(db: Session, ws: str, http: httpx.Client | None = None) -> None:
    row = db.get(YoutubeConnection, ws)
    if row is None:
        return
    with contextlib.suppress(AppError):
        yt.revoke(decrypt_token(row.refresh_token_enc), http)
    db.delete(row)
    db.flush()
    with _LOCK:
        _TOKENS.pop(ws, None)
    log_activity(db, ws, "youtube_disconnected", "workspace", ws)


def access_token(db: Session, ws: str, http: httpx.Client | None = None) -> str:
    """A valid access token for the workspace (refreshed when needed)."""
    _require_configured()
    with _LOCK:
        cached = _TOKENS.get(ws)
    if cached and cached[1] > time.time():
        return cached[0]
    row = db.get(YoutubeConnection, ws)
    if row is None or row.status != "active":
        raise AppError(
            "NO_YOUTUBE_CONNECTION",
            "Connect a YouTube channel in Settings first.",
            retryable=False,
        )
    try:
        token, expires = yt.refresh(decrypt_token(row.refresh_token_enc), http)
    except AppError as exc:
        if exc.code == "NO_YOUTUBE_CONNECTION":
            row.status = "revoked"
            db.commit()  # keep the state although the caller's request fails
        raise
    with _LOCK:
        _TOKENS[ws] = (token, expires)
    return token


def reset_tokens() -> None:
    with _LOCK:
        _TOKENS.clear()


def sync(db: Session, ws: str, http: httpx.Client | None = None) -> dict[str, Any]:
    """Store today's counters for every published (non-demo) video of the workspace."""
    videos = list(
        db.scalars(select(YtVideo).where(YtVideo.workspace_id == ws, YtVideo.is_seed.is_(False)))
    )
    if not videos:
        row = db.get(YoutubeConnection, ws)
        if row is not None:
            row.last_sync_at = utcnow()
        return {"videos": 0, "updated": 0}
    token = access_token(db, ws, http)
    stats = yt.video_stats(token, [v.youtube_video_id for v in videos], http)
    today = datetime.now(UTC).date().isoformat()
    updated = 0
    for v in videos:
        st = stats.get(v.youtube_video_id)
        if st is None:
            continue
        if st.get("title"):
            v.title = st["title"]
        if st.get("published_at") and not v.published_at:
            v.published_at = st["published_at"]
        metric = db.scalar(
            select(YtMetricDaily).where(
                YtMetricDaily.yt_video_id == v.id, YtMetricDaily.day == today
            )
        )
        if metric is None:
            metric = YtMetricDaily(yt_video_id=v.id, day=today)
            db.add(metric)
        metric.views, metric.likes, metric.comments = st["views"], st["likes"], st["comments"]
        updated += 1
    row = db.get(YoutubeConnection, ws)
    if row is not None:
        row.last_sync_at = utcnow()
    db.flush()
    return {"videos": len(videos), "updated": updated, "missing": len(videos) - updated}
