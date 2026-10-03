"""``LocalStorage``: files under ``DATA_DIR`` with path-traversal protection."""

from __future__ import annotations

import shutil
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from app.config import get_settings
from app.errors import AppError
from app.security import sign_media
from app.storage.base import StorageBackend


class LocalStorage(StorageBackend):
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        """Map a relative key to an absolute path, rejecting anything that escapes the root."""
        if not key or "\x00" in key or "\\" in key:
            raise AppError("VALIDATION_ERROR", "Invalid storage key")
        pure = PurePosixPath(key)
        if pure.is_absolute() or ".." in pure.parts:
            raise AppError("VALIDATION_ERROR", "Invalid storage key")
        path = (self.root / pure).resolve()
        if path != self.root and not path.is_relative_to(self.root):
            raise AppError("VALIDATION_ERROR", "Invalid storage key")
        return path

    def put_file(self, key: str, source: Path | BinaryIO) -> int:
        dest = self._resolve(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        if isinstance(source, Path):
            shutil.copyfile(source, tmp)
        else:
            with tmp.open("wb") as out:
                shutil.copyfileobj(source, out)
        tmp.replace(dest)
        return dest.stat().st_size

    def open(self, key: str) -> BinaryIO:
        return self._resolve(key).open("rb")

    def path_for(self, key: str) -> Path:
        return self._resolve(key)

    def exists(self, key: str) -> bool:
        return self._resolve(key).is_file()

    def size(self, key: str) -> int:
        return self._resolve(key).stat().st_size

    def delete_prefix(self, prefix: str) -> int:
        target = self._resolve(prefix.rstrip("/"))
        if target == self.root:
            raise AppError("VALIDATION_ERROR", "Refusing to delete the storage root")
        if target.is_file():
            target.unlink()
            return 1
        if target.is_dir():
            count = sum(1 for p in target.rglob("*") if p.is_file())
            shutil.rmtree(target)
            return count
        return 0

    def url(self, key: str, ttl: int | None = None) -> str:
        return sign_media(key, ttl)


_storage: LocalStorage | None = None


def get_storage() -> LocalStorage:
    """Process-wide storage rooted at the configured ``DATA_DIR``."""
    global _storage
    root = get_settings().data_dir
    if _storage is None or _storage.root != root.resolve():
        _storage = LocalStorage(root)
    return _storage
