"""Storage interface: callers deal in relative keys, never filesystem paths."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import BinaryIO


class StorageBackend(ABC):
    """Where media lives. Keys look like ``media/{workspace}/{asset}/proxy.mp4``."""

    @abstractmethod
    def put_file(self, key: str, source: Path | BinaryIO) -> int:
        """Store ``source`` under ``key`` (overwriting) and return the byte size."""

    @abstractmethod
    def open(self, key: str) -> BinaryIO:
        """Open ``key`` for binary reading."""

    @abstractmethod
    def path_for(self, key: str) -> Path:
        """Local filesystem path for ``key`` (for ffmpeg); remote backends must materialise it."""

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def size(self, key: str) -> int: ...

    @abstractmethod
    def delete_prefix(self, prefix: str) -> int:
        """Delete every object under ``prefix`` (or the single object); return the file count."""

    @abstractmethod
    def url(self, key: str, ttl: int | None = None) -> str:
        """Signed URL the browser can load."""
