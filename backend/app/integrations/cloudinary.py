"""Signed uploads to Cloudinary, used to give LumiClip a public URL for a library video.

Plain ``httpx`` (no SDK). Files above ``CHUNK_THRESHOLD`` use Cloudinary's chunked upload
(``X-Unique-Upload-Id`` + ``Content-Range``) so a multi-GB video never has to fit in memory.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from pathlib import Path
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.errors import AppError

API = "https://api.cloudinary.com/v1_1"
CHUNK = 20 * 1024 * 1024
CHUNK_THRESHOLD = 90 * 1024 * 1024  # the free plan rejects single requests above 100 MB
TIMEOUT = httpx.Timeout(600.0, connect=15.0)


def sign(params: dict[str, Any], secret: str) -> str:
    """Cloudinary's request signature: sha1 of the sorted ``k=v`` pairs plus the secret."""
    body = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if v not in (None, ""))
    return hashlib.sha1((body + secret).encode()).hexdigest()  # dictated by the Cloudinary API


class CloudinaryClient:
    def __init__(self, settings: Settings | None = None, http: httpx.Client | None = None) -> None:
        self._s = settings or get_settings()
        self._http = http or httpx.Client(timeout=TIMEOUT)

    def _require(self) -> None:
        if not self._s.cloudinary_configured:
            raise AppError(
                "CLOUDINARY_NOT_CONFIGURED",
                "Uploading a library video to LumiClip needs Cloudinary. "
                "Set CLOUDINARY_CLOUD_NAME, "
                "CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in .env, "
                "or paste a public video URL instead.",
                status=503,
            )

    def upload_video(self, path: Path, *, folder: str) -> dict[str, Any]:
        """Upload ``path`` and return Cloudinary's JSON (``secure_url``, ``public_id``, ...)."""
        self._require()
        s = self._s
        timestamp = int(time.time())
        signed = {"folder": folder, "timestamp": timestamp}
        form = {
            **signed,
            "api_key": s.cloudinary_api_key,
            "signature": sign(signed, s.cloudinary_api_secret),
        }
        url = f"{API}/{s.cloudinary_cloud_name}/video/upload"
        size = path.stat().st_size
        try:
            if size <= CHUNK_THRESHOLD:
                with path.open("rb") as fh:
                    res = self._http.post(
                        url, data=form, files={"file": (path.name, fh, "application/octet-stream")}
                    )
                return self._json(res)
            upload_id = secrets.token_hex(8)
            last: dict[str, Any] = {}
            with path.open("rb") as fh:
                start = 0
                while start < size:
                    block = fh.read(CHUNK)
                    end = start + len(block) - 1
                    res = self._http.post(
                        url,
                        data=form,
                        files={"file": (path.name, block, "application/octet-stream")},
                        headers={
                            "X-Unique-Upload-Id": upload_id,
                            "Content-Range": f"bytes {start}-{end}/{size}",
                        },
                    )
                    last = self._json(res)
                    start = end + 1
            return last
        except httpx.HTTPError as exc:
            raise AppError(
                "CLOUDINARY_UNREACHABLE",
                f"Could not reach Cloudinary ({exc.__class__.__name__}).",
                status=502,
            ) from exc

    @staticmethod
    def _json(res: httpx.Response) -> dict[str, Any]:
        try:
            body = res.json()
        except ValueError:
            body = {}
        if res.status_code >= 400:
            msg = (body.get("error") or {}).get("message") if isinstance(body, dict) else None
            raise AppError(
                "CLOUDINARY_FAILED",
                f"Cloudinary refused the upload ({res.status_code}): {msg or 'no details'}",
                status=502,
            )
        return body if isinstance(body, dict) else {}


def get_cloudinary_client() -> CloudinaryClient:
    """Factory (patched in tests)."""
    return CloudinaryClient()
