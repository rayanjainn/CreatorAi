from __future__ import annotations

import io
from pathlib import Path

import pytest

from app.errors import AppError
from app.storage.local import LocalStorage, get_storage


def test_put_open_exists_delete(tmp_path: Path) -> None:
    store = LocalStorage(tmp_path)
    assert store.put_file("media/w/a/original.bin", io.BytesIO(b"hello")) == 5
    assert store.exists("media/w/a/original.bin") and store.size("media/w/a/original.bin") == 5
    with store.open("media/w/a/original.bin") as fh:
        assert fh.read() == b"hello"
    src = tmp_path / "src.txt"
    src.write_text("abc")
    store.put_file("media/w/a/proxy.mp4", src)
    assert store.delete_prefix("media/w/a") == 2
    assert not store.exists("media/w/a/original.bin")
    assert store.delete_prefix("media/none") == 0


@pytest.mark.parametrize(
    "key", ["../etc/passwd", "/abs/path", "media/../../x", "a\\b", "", "media/\x00x"]
)
def test_rejects_traversal(tmp_path: Path, key: str) -> None:
    store = LocalStorage(tmp_path)
    with pytest.raises(AppError):
        store.path_for(key)


def test_symlink_escape_blocked(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("s")
    root = tmp_path / "root"
    root.mkdir()
    (root / "link").symlink_to(outside)
    with pytest.raises(AppError):
        LocalStorage(root).path_for("link/secret.txt")


def test_refuses_to_delete_root(tmp_path: Path) -> None:
    with pytest.raises(AppError):
        LocalStorage(tmp_path).delete_prefix(".")


def test_url_is_signed_and_default_root(data_dir: Path) -> None:
    store = get_storage()
    assert store.root == data_dir.resolve()
    assert "sig=" in store.url("media/x.mp4")
