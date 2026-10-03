"""Asset kind detection (video / image / audio / document) from mime type and file extension."""

from __future__ import annotations

import mimetypes
from pathlib import PurePosixPath

VIDEO_EXT = {
    ".mp4",
    ".m4v",
    ".mov",
    ".mkv",
    ".webm",
    ".avi",
    ".mpg",
    ".mpeg",
    ".wmv",
    ".flv",
    ".3gp",
}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
AUDIO_EXT = {".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".opus", ".wma", ".aiff"}
TEXT_EXT = {".txt", ".md", ".markdown"}
SIDECAR_SUFFIXES = (".words.json", ".srt", ".vtt")


def extension(filename: str) -> str:
    return PurePosixPath(filename.replace("\\", "/")).suffix.lower()


def safe_filename(filename: str) -> str:
    """Basename only, no control characters, never empty."""
    name = PurePosixPath(filename.replace("\\", "/")).name.strip()
    name = "".join(ch for ch in name if ch.isprintable())
    return name[:200] or "upload"


def guess_mime(filename: str, mime: str | None = None) -> str:
    """Trust a specific client mime type; otherwise guess from the extension."""
    if mime and mime != "application/octet-stream":
        return mime.split(";")[0].strip().lower()
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def detect_kind(filename: str, mime: str | None = None) -> str:
    """``video`` | ``image`` | ``audio`` | ``document`` (unknown = stored-only document)."""
    ext = extension(filename)
    if ext in VIDEO_EXT:
        return "video"
    if ext in IMAGE_EXT:
        return "image"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in TEXT_EXT:
        return "document"
    top = (mime or "").split("/")[0].lower()
    if top in ("video", "image", "audio"):
        return top
    return "document"


def is_text_document(filename: str, mime: str | None = None) -> bool:
    return extension(filename) in TEXT_EXT or (mime or "") in ("text/plain", "text/markdown")
