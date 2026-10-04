# ruff: noqa: E501
"""Web search for the research agent: Tavily or Serper, chosen by ``SEARCH_PROVIDER``.

Plain ``httpx``. Without a key the call fails with ``SEARCH_NOT_CONFIGURED`` and nothing is invented.
"""

from __future__ import annotations

import re
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.errors import AppError

TIMEOUT = httpx.Timeout(20.0, connect=8.0)


def search(query: str, limit: int = 8, settings: Settings | None = None) -> list[dict[str, str]]:
    s = settings or get_settings()
    if not s.search_configured:
        raise AppError(
            "SEARCH_NOT_CONFIGURED",
            "Research needs a web search key. Add TAVILY_API_KEY (or SERPER_API_KEY with "
            "SEARCH_PROVIDER=serper) to .env and restart the API. Both have free tiers.",
            status=503,
        )
    try:
        if s.search_provider == "serper":
            res = httpx.post(
                "https://google.serper.dev/search",
                headers={"x-api-key": s.serper_api_key},
                json={"q": query, "num": limit},
                timeout=TIMEOUT,
            )
            res.raise_for_status()
            raw = [
                {"title": r.get("title"), "url": r.get("link"), "snippet": r.get("snippet", "")}
                for r in res.json().get("organic", [])
            ]
        else:
            res = httpx.post(
                "https://api.tavily.com/search",
                headers={"authorization": f"Bearer {s.tavily_api_key}"},
                json={"query": query, "max_results": limit, "search_depth": "basic"},
                timeout=TIMEOUT,
            )
            res.raise_for_status()
            raw = [
                {"title": r.get("title"), "url": r.get("url"), "snippet": r.get("content", "")}
                for r in res.json().get("results", [])
            ]
    except httpx.HTTPError as exc:
        raise AppError(
            "SEARCH_FAILED", f"The web search failed ({exc.__class__.__name__}).", status=502
        ) from exc
    return _clean(raw)[:limit]


_YT_ID = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def youtube_id(url: str) -> str | None:
    """The 11-character video id of a YouTube watch/shorts/embed/youtu.be link, else ``None``."""
    m = _YT_ID.search(url or "")
    return m.group(1) if m else None


def _clock(text: str | None) -> float | None:
    """``"10:30"`` / ``"1:02:03"`` -> seconds."""
    parts = (text or "").strip().split(":")
    if not parts or not all(p.isdigit() for p in parts):
        return None
    sec = 0.0
    for p in parts:
        sec = sec * 60 + int(p)
    return sec


def search_videos(
    query: str, limit: int = 10, settings: Settings | None = None
) -> list[dict[str, Any]]:
    """YouTube videos about ``query``: ``[{video_id, url, title, snippet, channel, duration_sec,
    published}]``. Serper uses its video vertical; Tavily is restricted to youtube.com."""
    s = settings or get_settings()
    if not s.search_configured:
        raise AppError(
            "SEARCH_NOT_CONFIGURED",
            "Finding videos needs a web search key. Add SERPER_API_KEY (with SEARCH_PROVIDER=serper) "
            "or TAVILY_API_KEY to .env and restart the API, or paste a YouTube link instead.",
            status=503,
        )
    try:
        if s.search_provider == "serper":
            res = httpx.post(
                "https://google.serper.dev/videos",
                headers={"x-api-key": s.serper_api_key},
                json={"q": query, "num": min(limit * 2, 20)},
                timeout=TIMEOUT,
            )
            res.raise_for_status()
            raw = [
                {
                    "url": r.get("link"),
                    "title": r.get("title"),
                    "snippet": r.get("snippet", ""),
                    "channel": r.get("channel"),
                    "duration_sec": _clock(r.get("duration")),
                    "published": r.get("date"),
                }
                for r in res.json().get("videos", [])
            ]
        else:
            res = httpx.post(
                "https://api.tavily.com/search",
                headers={"authorization": f"Bearer {s.tavily_api_key}"},
                json={
                    "query": query,
                    "max_results": min(limit * 2, 20),
                    "search_depth": "basic",
                    "include_domains": ["youtube.com", "youtu.be"],
                },
                timeout=TIMEOUT,
            )
            res.raise_for_status()
            raw = [
                {"url": r.get("url"), "title": r.get("title"), "snippet": r.get("content", "")}
                for r in res.json().get("results", [])
            ]
    except httpx.HTTPError as exc:
        raise AppError(
            "SEARCH_FAILED", f"The web search failed ({exc.__class__.__name__}).", status=502
        ) from exc
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in raw:
        vid = youtube_id(str(r.get("url") or ""))
        title = str(r.get("title") or "").strip()
        if not vid or not title or vid in seen:
            continue  # only YouTube videos can be imported; drop channels, playlists, other sites
        seen.add(vid)
        out.append(
            {
                "video_id": vid,
                "url": f"https://www.youtube.com/watch?v={vid}",
                "title": title,
                "snippet": str(r.get("snippet") or "")[:300],
                "channel": r.get("channel") or None,
                "duration_sec": r.get("duration_sec"),
                "published": r.get("published") or None,
            }
        )
    return out[:limit]


def get_video_search():  # type: ignore[no-untyped-def]
    """Factory (patched in tests)."""
    return search_videos


def _clean(raw: list[dict[str, Any]]) -> list[dict[str, str]]:
    out = []
    for r in raw:
        url, title = str(r.get("url") or ""), str(r.get("title") or "")
        if url.startswith(("http://", "https://")) and title:
            out.append({"title": title, "url": url, "snippet": str(r.get("snippet") or "")[:500]})
    return out


def get_search():  # type: ignore[no-untyped-def]
    """Factory (patched in tests)."""
    return search
