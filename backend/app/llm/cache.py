"""Response cache: in-memory LRU in front of the ``llm_cache`` table."""

from __future__ import annotations

import hashlib
import json
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel
from sqlalchemy.dialects.sqlite import insert

from app.db import session_scope
from app.models import LlmCache

_WS = re.compile(r"\s+")


@dataclass(frozen=True)
class CachedResponse:
    response: dict[str, Any]
    provider: str
    model: str
    tokens_in: int
    tokens_out: int


def schema_version(schema: type[BaseModel]) -> str:
    """Short hash of the output schema, so changing a model invalidates its cached answers."""
    raw = json.dumps(schema.model_json_schema(), sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def cache_key(task: str, version: str, prompt: str, image_hashes: list[str]) -> str:
    normalized = _WS.sub(" ", prompt).strip()
    material = "\x1f".join([task, version, normalized, *image_hashes])
    return hashlib.sha256(material.encode()).hexdigest()


class LlmResponseCache:
    def __init__(self, max_items: int = 256) -> None:
        self._max = max_items
        self._lru: OrderedDict[str, CachedResponse] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> CachedResponse | None:
        with self._lock:
            hit = self._lru.get(key)
            if hit is not None:
                self._lru.move_to_end(key)
                return hit
        with session_scope() as db:
            row = db.get(LlmCache, key)
            if row is None:
                return None
            hit = CachedResponse(
                row.response, row.provider, row.model, row.tokens_in, row.tokens_out
            )
        self._remember(key, hit)
        return hit

    def put(self, key: str, task: str, value: CachedResponse) -> None:
        self._remember(key, value)
        stmt = (
            insert(LlmCache)
            .values(
                key=key,
                task=task,
                provider=value.provider,
                model=value.model,
                response=value.response,
                tokens_in=value.tokens_in,
                tokens_out=value.tokens_out,
            )
            .prefix_with("OR REPLACE")
        )
        with session_scope() as db:
            db.execute(stmt)

    def _remember(self, key: str, value: CachedResponse) -> None:
        with self._lock:
            self._lru[key] = value
            self._lru.move_to_end(key)
            while len(self._lru) > self._max:
                self._lru.popitem(last=False)

    def clear_memory(self) -> None:
        with self._lock:
            self._lru.clear()
