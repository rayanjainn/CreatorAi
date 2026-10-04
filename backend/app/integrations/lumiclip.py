"""Client for the LumiClip cloud clipper.

Endpoints used: ``POST /api/v1/clips/generate`` and ``GET /api/v1/projects/{id}``.

LumiClip downloads a public video URL, transcribes it and returns ready-made short clips. The key is
a server setting (``LUMICLIP_API_KEY``); the browser only ever talks to our own API. Errors are
mapped to our error shape so the UI can say what to do (bad key, out of credits, source video needs
a login, ...).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.errors import AppError

TIMEOUT = httpx.Timeout(30.0, connect=10.0)
ACTIVE_STATUSES = {"processing", "queued", "pending", "running", "started", "downloading"}
DONE_STATUSES = {"completed", "complete", "done", "succeeded", "success"}
FAILED_STATUSES = {"failed", "error", "cancelled", "canceled"}


@dataclass
class RemoteClip:
    id: str
    title: str
    duration: float
    score: float
    reason: str
    status: str
    download_url: str | None
    thumbnail_url: str | None
    quality: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "duration": self.duration,
            "score": self.score,
            "reason": self.reason,
            "status": self.status,
            "download_url": self.download_url,
            "thumbnail_url": self.thumbnail_url,
            "quality": self.quality,
        }


@dataclass
class RemoteProject:
    id: str
    status: str
    step: str = ""
    message: str | None = None
    error: str | None = None
    error_category: str | None = None
    expected_clips: int | None = None
    duration: float | None = None
    estimated_minutes: float | None = None
    clips: list[RemoteClip] = field(default_factory=list)

    @property
    def active(self) -> bool:
        return self.status in ACTIVE_STATUSES or (
            self.status not in DONE_STATUSES | FAILED_STATUSES and not self.error
        )


def categorize_error(message: str, code: str = "", status: str = "") -> str:
    """Why a project failed, from the provider's wording.

    Only clear phrases match; anything else is ``unknown`` (never a misleading auth error).
    """
    text = f"{message} {code}".lower()
    if not (message or code or status.lower() in FAILED_STATUSES):
        return "unknown"
    if any(
        k in text
        for k in (
            "requires authentication",
            "sign in to confirm",
            "sign in to watch",
            "login required",
            "age restricted",
            "age-restricted",
            "members only",
            "private video",
            "authentication and cannot",
        )
    ) or ("authentication" in text and ("video" in text or "source" in text)):
        return "source_auth"
    if any(
        k in text
        for k in (
            "download failed",
            "unavailable",
            "video not found",
            "unreachable",
            "deleted",
            "geo",
            "region",
        )
    ):
        return "source_unavailable"
    if any(k in text for k in ("unauthorized", "invalid key", "invalid api")) or code == "401":
        return "api_auth"
    if any(k in text for k in ("quota", "rate limit", "credit", "429")):
        return "quota"
    return "unknown"


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_project(data: dict[str, Any], fallback_id: str = "") -> RemoteProject:
    status = str(data.get("status") or "processing").lower()
    raw_error = str(data.get("error") or data.get("reason") or "")
    if not raw_error and status in FAILED_STATUSES:
        raw_error = str(data.get("message") or "")
    code = str(data.get("error_code") or data.get("code") or "")
    clips: list[RemoteClip] = []
    for c in data.get("clips") or []:
        if not isinstance(c, dict) or not c.get("id"):
            continue
        score = _num(c.get("score"), 0.0)
        clips.append(
            RemoteClip(
                id=str(c["id"]),
                title=str(c.get("title") or "Untitled clip"),
                duration=_num(c.get("duration")),
                score=score / 100 if score > 1 else score,
                reason=str(c.get("reason") or ""),
                status=str(c.get("clip_status") or c.get("status") or "completed").lower(),
                download_url=c.get("download_url") or None,
                thumbnail_url=c.get("thumbnail_url") or None,
                quality=c.get("quality") or None,
            )
        )
    failed = status in FAILED_STATUSES or bool(raw_error and status not in DONE_STATUSES)
    return RemoteProject(
        id=str(data.get("id") or data.get("project_id") or fallback_id),
        status="failed" if failed else status,
        step=str(data.get("step") or data.get("pipeline_step") or ""),
        message=(str(data["message"]) if data.get("message") else None),
        error=raw_error or None,
        error_category=categorize_error(raw_error, code, status) if failed else None,
        expected_clips=int(data["expected_clips"]) if data.get("expected_clips") else None,
        duration=_num(data.get("duration")) or None,
        estimated_minutes=_num(data.get("estimated_minutes")) or None,
        clips=clips,
    )


class LumiclipClient:
    def __init__(self, settings: Settings | None = None, http: httpx.Client | None = None) -> None:
        self._settings = settings or get_settings()
        self._http = http or httpx.Client(timeout=TIMEOUT)

    def _call(self, method: str, path: str, **kw: Any) -> dict[str, Any]:
        s = self._settings
        if not s.lumiclip_configured:
            raise AppError(
                "LUMICLIP_NOT_CONFIGURED",
                "LumiClip is not set up. Add LUMICLIP_API_KEY to .env and restart the API.",
                status=503,
            )
        url = f"{s.lumiclip_base_url.rstrip('/')}/api/v1/{path.lstrip('/')}"
        try:
            res = self._http.request(
                method, url, headers={"Authorization": f"Bearer {s.lumiclip_api_key}"}, **kw
            )
        except httpx.HTTPError as exc:
            raise AppError(
                "LUMICLIP_UNREACHABLE",
                f"Could not reach LumiClip ({exc.__class__.__name__}).",
                status=502,
            ) from exc
        if res.status_code == 401:
            raise AppError(
                "LUMICLIP_AUTH",
                "LumiClip rejected the API key. Check LUMICLIP_API_KEY.",
                status=502,
            )
        if res.status_code in (402, 429):
            raise AppError(
                "QUOTA_EXCEEDED",
                "LumiClip is out of credits or rate-limited. "
                "Wait a moment, or check your LumiClip plan.",
                status=429,
                details={"provider": "lumiclip", "http_status": res.status_code},
            )
        try:
            body = res.json()
        except ValueError:
            body = {"raw": res.text[:300]}
        if res.status_code >= 400:
            detail = body.get("error") or body.get("message") if isinstance(body, dict) else None
            raise AppError(
                "LUMICLIP_FAILED",
                f"LumiClip refused the request ({res.status_code}): {detail or 'no details'}",
                status=502,
                details={"http_status": res.status_code},
            )
        return body if isinstance(body, dict) else {"data": body}

    def generate(
        self,
        url: str,
        *,
        aspect_ratio: str = "9:16",
        start_time: float | None = None,
        end_time: float | None = None,
        language: str | None = None,
        subtitle_style: str | None = None,
    ) -> RemoteProject:
        payload: dict[str, Any] = {"url": url, "aspect_ratio": aspect_ratio}
        if start_time:
            payload["start_time"] = start_time
        if end_time:
            payload["end_time"] = end_time
        if language and language != "auto":
            payload["language"] = language
        if subtitle_style:
            payload["subtitle_style"] = subtitle_style
        data = self._call("POST", "clips/generate", json=payload)
        project = parse_project(data, str(data.get("project_id") or data.get("id") or ""))
        if not project.id:
            raise AppError("LUMICLIP_FAILED", "LumiClip did not return a project id.", status=502)
        return project

    def get_project(self, remote_id: str) -> RemoteProject:
        return parse_project(self._call("GET", f"projects/{remote_id}"), remote_id)

    def export_clip(self, clip_id: str, quality: str = "1080p") -> dict[str, Any]:
        return self._call("POST", f"clips/{clip_id}/export", json={"quality": quality})


def get_lumiclip_client() -> LumiclipClient:
    """Factory (patched in tests)."""
    return LumiclipClient()
