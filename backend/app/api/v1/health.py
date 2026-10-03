"""Unauthenticated health and feature flags."""

from __future__ import annotations

import importlib.util
import sys
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter
from sqlalchemy import func, select, text

from app import __version__
from app.config import get_settings
from app.db import session_scope
from app.llm.gateway import get_gateway
from app.media.caption_support import caption_features
from app.media.ffmpeg import ffmpeg_available, ffmpeg_version
from app.ml.embedder import embedder_info
from app.models import User

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, Any]:
    settings = get_settings()
    gateway = get_gateway()
    with session_scope() as db:
        db.execute(text("select 1"))
        users = db.scalar(select(func.count()).select_from(User)) or 0
    return {
        "status": "ok",
        "version": __version__,
        "time": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "python": ".".join(map(str, sys.version_info[:3])),
        "auth_mode": settings.auth_mode,
        # Same rule as POST /auth/signup; lets the sign-in page hide "create account".
        "signup_open": users == 0 or settings.auth_allow_multi,
        "data_mode": gateway.data_mode(),
        "features": {
            "llm": {
                "data_mode": gateway.data_mode(),
                "order": list(settings.provider_order),
                "providers": gateway.provider_flags(),
                "mock": settings.llm_allow_mock,
            },
            "asr": {
                "sidecar": True,
                "groq": bool(settings.groq_api_key) and settings.asr_provider in ("auto", "groq"),
                "faster_whisper": importlib.util.find_spec("faster_whisper") is not None,
            },
            "embedder": embedder_info(),
            "ffmpeg": {"present": ffmpeg_available(), "version": ffmpeg_version()},
            "captions": caption_features(),
            "youtube": {"configured": settings.google_configured},
        },
    }
