"""Signed media route with manual HTTP Range support (mounted at ``/media``, not ``/api/v1``)."""

from __future__ import annotations

import mimetypes
import re
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.errors import AppError, not_found
from app.security import verify_media
from app.storage.local import get_storage

router = APIRouter(tags=["media"])

CHUNK = 256 * 1024
_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
_EXTRA_TYPES = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".srt": "application/x-subrip",
    ".vtt": "text/vtt",
    ".json": "application/json",
}


def guess_mime(key: str) -> str:
    suffix = "." + key.rsplit(".", 1)[-1].lower() if "." in key else ""
    return _EXTRA_TYPES.get(suffix) or mimetypes.guess_type(key)[0] or "application/octet-stream"


def parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """Parse a single ``bytes=a-b`` range into inclusive ``(start, end)``.

    Returns ``None`` when the header is absent, malformed or multi-range (serve the full file).
    Raises ``RANGE_NOT_SATISFIABLE`` (416) when the range lies outside the file.
    """
    if not header:
        return None
    match = _RANGE_RE.match(header.strip())
    if not match or (match.group(1) == "" and match.group(2) == ""):
        return None
    first, last = match.groups()
    if first == "":  # suffix range: the final N bytes
        length = int(last)
        if length == 0 or size == 0:
            raise _unsatisfiable(size)
        return max(0, size - length), size - 1
    start = int(first)
    end = int(last) if last else size - 1
    if start >= size or (last and end < start):
        raise _unsatisfiable(size)
    return start, min(end, size - 1)


def _unsatisfiable(size: int) -> AppError:
    return AppError(
        "RANGE_NOT_SATISFIABLE",
        "Requested range not satisfiable",
        headers={"Content-Range": f"bytes */{size}"},
    )


def _iter_file(key: str, start: int, end: int) -> Iterator[bytes]:
    remaining = end - start + 1
    with get_storage().open(key) as fh:
        fh.seek(start)
        while remaining > 0:
            data = fh.read(min(CHUNK, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


@router.api_route("/media/{key:path}", methods=["GET", "HEAD"])
def serve_media(
    key: str,
    request: Request,
    exp: Annotated[int, Query()],
    sig: Annotated[str, Query()],
) -> Response:
    verify_media(key, exp, sig)
    storage = get_storage()
    if not storage.exists(key):
        raise not_found("Media")
    size = storage.size(key)
    byte_range = parse_range(request.headers.get("range"), size)
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
    }
    mime = guess_mime(key)
    if byte_range is None:
        start, end, status = 0, size - 1, 200
    else:
        start, end = byte_range
        status = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    length = end - start + 1 if size else 0
    headers["Content-Length"] = str(length)
    if request.method == "HEAD":
        return Response(status_code=status, headers=headers, media_type=mime)
    return StreamingResponse(
        _iter_file(key, start, end) if size else iter(()),
        status_code=status,
        headers=headers,
        media_type=mime,
    )
