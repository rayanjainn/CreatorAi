# ruff: noqa: E501
"""Web search for the research agent: Tavily or Serper, chosen by ``SEARCH_PROVIDER``.

Plain ``httpx``. Without a key the call fails with ``SEARCH_NOT_CONFIGURED`` and nothing is invented.
"""

from __future__ import annotations

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
