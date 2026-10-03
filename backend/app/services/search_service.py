"""Hybrid search over segments and shots (filled in with the search endpoint)."""

from __future__ import annotations

import threading
from typing import Any

_lock = threading.Lock()
_cache: dict[str, Any] = {}


def invalidate(workspace_id: str | None = None) -> None:
    """Drop the cached vector index of a workspace (or all). Call after any write to segments,
    shots, embeddings, asset status or asset metadata."""
    with _lock:
        if workspace_id is None:
            _cache.clear()
        else:
            _cache.pop(workspace_id, None)
