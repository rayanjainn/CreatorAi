"""YouTube downloads with yt-dlp: probe a link, download it as MP4, and read its caption tracks.

Only YouTube video links are accepted (``websearch.youtube_id``), so the downloader is never pointed
at an arbitrary host. Errors become ``AppError`` codes the UI can explain (``YT_UNAVAILABLE``,
``YT_LOGIN_REQUIRED``, ``YT_TOO_LONG``, ``YT_DOWNLOAD_FAILED``). yt-dlp itself is imported lazily so
the API still boots when it is missing (``available()`` is then false).
"""

from __future__ import annotations

import json
import logging
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.config import Settings, get_settings
from app.errors import AppError
from app.integrations.websearch import youtube_id

log = logging.getLogger(__name__)

ProgressFn = Callable[[float, str], None]  # (fraction 0..1, message)


@dataclass
class VideoInfo:
    video_id: str
    url: str
    title: str
    channel: str | None
    duration_sec: float | None
    language: str | None
    has_subtitles: bool
    has_auto_captions: bool


@dataclass
class Downloaded:
    path: Path
    info: VideoInfo
    captions: dict[str, Any] | None = None  # words.json sidecar, when a caption track was fetched
    caption_kind: str | None = None  # "subtitles" (uploader-written) or "auto" (YouTube's ASR)


def available() -> bool:
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return False
    return True


def canonical_url(url: str) -> str:
    vid = youtube_id(url)
    if vid is None:
        raise AppError(
            "VALIDATION_ERROR",
            "That is not a YouTube video link. Use a youtube.com/watch, youtu.be or /shorts/ link.",
        )
    return f"https://www.youtube.com/watch?v={vid}"


def _base_opts(settings: Settings) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "noprogress": True,
        "socket_timeout": 30,
        "retries": 3,
    }
    if settings.yt_import_cookies_file:
        opts["cookiefile"] = settings.yt_import_cookies_file
    ffmpeg = shutil.which(settings.ffmpeg_bin)
    if ffmpeg:
        opts["ffmpeg_location"] = str(Path(ffmpeg).parent)
    return opts


def _error(exc: Exception) -> AppError:
    text = str(exc)
    low = text.lower()
    if any(k in low for k in ("sign in", "login", "age", "members-only", "cookies")):
        return AppError(
            "YT_LOGIN_REQUIRED",
            "YouTube only shows this video to signed-in viewers (age limit, members-only or a bot "
            "check). Pick another video, or set YT_IMPORT_COOKIES_FILE to a cookies.txt export.",
            status=422,
            details={"reason": text[-300:]},
        )
    if any(k in low for k in ("private video", "unavailable", "removed", "not available", "404")):
        return AppError(
            "YT_UNAVAILABLE",
            "This video is private, removed or blocked in this country.",
            status=422,
            details={"reason": text[-300:]},
        )
    return AppError(
        "YT_DOWNLOAD_FAILED",
        "The download from YouTube failed. Try again, or update yt-dlp "
        "(pip install -U yt-dlp) if it keeps happening.",
        status=502,
        details={"reason": text[-300:]},
    )


def _info(raw: dict[str, Any], url: str) -> VideoInfo:
    return VideoInfo(
        video_id=str(raw.get("id") or youtube_id(url) or ""),
        url=url,
        title=str(raw.get("title") or "YouTube video").strip(),
        channel=raw.get("channel") or raw.get("uploader"),
        duration_sec=float(raw["duration"]) if raw.get("duration") else None,
        language=raw.get("language"),
        has_subtitles=bool(raw.get("subtitles")),
        has_auto_captions=bool(raw.get("automatic_captions")),
    )


def probe(url: str, settings: Settings | None = None) -> VideoInfo:
    """Metadata only (title, channel, duration, caption availability). A few seconds."""
    import yt_dlp

    s = settings or get_settings()
    url = canonical_url(url)
    try:
        with yt_dlp.YoutubeDL({**_base_opts(s), "skip_download": True}) as ydl:
            raw = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as exc:
        raise _error(exc) from exc
    if raw is None or raw.get("_type") == "playlist":
        raise AppError("VALIDATION_ERROR", "That link is a playlist; paste a single video.")
    if raw.get("is_live") or raw.get("live_status") in ("is_live", "is_upcoming"):
        raise AppError("YT_UNAVAILABLE", "Live streams cannot be imported.", status=422)
    info = _info(raw, url)
    check_length(info, s)
    return info


def check_length(info: VideoInfo, settings: Settings) -> None:
    if info.duration_sec and info.duration_sec > settings.yt_import_max_sec:
        raise AppError(
            "YT_TOO_LONG",
            f"This video is {int(info.duration_sec // 60)} min long; the import limit is "
            f"{settings.yt_import_max_sec // 60} min (YT_IMPORT_MAX_SEC).",
            status=422,
            details={"duration_sec": info.duration_sec, "max_sec": settings.yt_import_max_sec},
        )


def _caption_langs(language: str | None) -> list[str]:
    lang = (language or "en").split("-")[0]
    return [lang, f"{lang}-orig", f"{lang}.*", "en", "en.*"]


def download(
    url: str,
    dest_dir: Path,
    *,
    want_captions: bool,
    language: str | None = None,
    on_progress: ProgressFn | None = None,
    settings: Settings | None = None,
) -> Downloaded:
    """Download ``url`` as ``dest_dir/video.mp4`` (H.264/AAC preferred, height capped).

    ``on_progress`` may raise (job cancellation) and the download stops. With ``want_captions`` the
    uploader's subtitles, else YouTube's automatic captions, are fetched as json3 and converted to a
    ``words.json`` sidecar.
    """
    import yt_dlp

    s = settings or get_settings()
    url = canonical_url(url)
    dest_dir.mkdir(parents=True, exist_ok=True)
    h = s.yt_import_max_height

    def hook(d: dict[str, Any]) -> None:
        if on_progress is None:
            return
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            frac = (done / total) if total else 0.0
            speed = d.get("speed") or 0
            msg = f"{done / 1e6:.1f} / {total / 1e6:.1f} MB" if total else f"{done / 1e6:.1f} MB"
            if speed:
                msg += f" at {speed / 1e6:.1f} MB/s"
            on_progress(min(frac, 1.0), msg)
        elif d.get("status") == "finished":
            on_progress(1.0, "merging audio and video")

    opts = {
        **_base_opts(s),
        # prefer H.264 + AAC in MP4 (plays in every browser, no re-encode), then anything <= h
        "format": (
            f"bv*[height<={h}][vcodec^=avc1]+ba[ext=m4a]/b[height<={h}][ext=mp4]/"
            f"bv*[height<={h}]+ba/b[height<={h}]/b"
        ),
        "merge_output_format": "mp4",
        "outtmpl": {"default": str(dest_dir / "video.%(ext)s")},
        "progress_hooks": [hook],
        "max_filesize": s.max_upload_bytes,
    }
    if want_captions:
        opts.update(
            {
                "writesubtitles": True,
                "writeautomaticsub": True,
                "subtitlesformat": "json3",
                "subtitleslangs": _caption_langs(language),
            }
        )
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            raw = ydl.extract_info(url, download=True)
    except yt_dlp.utils.DownloadError as exc:
        raise _error(exc) from exc
    if raw is None:
        raise AppError("YT_DOWNLOAD_FAILED", "yt-dlp returned nothing for this link.", status=502)
    info = _info(raw, url)
    check_length(info, s)
    path = dest_dir / "video.mp4"
    if not path.exists():
        found = sorted(p for p in dest_dir.glob("video.*") if p.suffix not in (".json3", ".part"))
        if not found:
            raise AppError("YT_DOWNLOAD_FAILED", "The download produced no video file.", status=502)
        path = found[0]
    out = Downloaded(path=path, info=info)
    if want_captions:
        out.captions, out.caption_kind = _pick_captions(raw, dest_dir)
    return out


def _pick_captions(raw: dict[str, Any], dest_dir: Path) -> tuple[dict[str, Any] | None, str | None]:
    """The downloaded json3 track as a words.json sidecar: uploader subtitles before auto ones."""
    requested = raw.get("requested_subtitles") or {}
    manual = set((raw.get("subtitles") or {}).keys())
    ordered = sorted(requested.items(), key=lambda kv: (kv[0] not in manual, kv[0]))
    for lang, sub in ordered:
        path = Path(sub.get("filepath") or "")
        if not path.is_file():
            continue
        try:
            words = json3_words(json.loads(path.read_text(encoding="utf-8")))
        except (ValueError, OSError):
            log.warning("unreadable caption track %s", path)
            continue
        if words:
            kind = "subtitles" if lang in manual else "auto"
            return {"language": lang.split("-")[0], "words": words}, kind
    return None, None


def json3_words(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """YouTube json3 captions -> ``[{word, start, end}]`` in seconds, sorted, non-overlapping.

    Automatic captions carry one seg per word with its own offset; uploader subtitles carry a whole
    line per event, whose words are spread evenly over the event.
    """
    pieces: list[tuple[float, float, str]] = []
    for ev in doc.get("events") or []:
        segs = [g for g in ev.get("segs") or [] if str(g.get("utf8", "")).strip()]
        if not segs or "tStartMs" not in ev:
            continue
        t0 = float(ev["tStartMs"]) / 1000.0
        t1 = t0 + float(ev.get("dDurationMs") or 0) / 1000.0
        starts = [t0 + float(g.get("tOffsetMs") or 0) / 1000.0 for g in segs]
        for i, g in enumerate(segs):
            s = starts[i]
            e = starts[i + 1] if i + 1 < len(starts) else max(t1, s + 0.2)
            tokens = str(g["utf8"]).replace("\n", " ").split()
            if not tokens:
                continue
            step = max(e - s, 0.05) / len(tokens)
            for k, tok in enumerate(tokens):
                pieces.append((s + k * step, s + (k + 1) * step, tok))
    pieces.sort(key=lambda p: p[0])
    words: list[dict[str, Any]] = []
    for i, (s, e, tok) in enumerate(pieces):
        nxt = pieces[i + 1][0] if i + 1 < len(pieces) else e
        end = max(min(e, nxt), s + 0.01)
        words.append({"word": tok, "start": round(s, 3), "end": round(end, 3)})
    return words
