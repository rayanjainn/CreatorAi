from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import inspect, text

from app.db import get_engine, migrate, session_scope
from app.models import Base, new_id, utcnow


def test_every_model_table_exists() -> None:
    names = set(inspect(get_engine()).get_table_names())
    expected = {t.name for t in Base.metadata.sorted_tables}
    assert expected <= names
    assert {"users", "workspaces", "schema_migrations", "asset_segments_fts"} <= names
    assert len(expected) >= 28


def test_migrate_is_idempotent_and_tracked() -> None:
    assert migrate() == []
    with session_scope() as db:
        names = db.execute(text("select name from schema_migrations order by name")).scalars()
        assert list(names)[0] == "001_init.sql"


def test_fresh_database_applies_in_order(tmp_path: Path) -> None:
    (tmp_path / "001_a.sql").write_text("create table a (id integer);")
    (tmp_path / "002_b.sql").write_text("create table b (id integer);")
    db_file = tmp_path / "x.db"
    assert migrate(db_file, tmp_path) == ["001_a.sql", "002_b.sql"]
    assert migrate(db_file, tmp_path) == []


def test_failed_migration_rolls_back(tmp_path: Path) -> None:
    (tmp_path / "001_bad.sql").write_text("create table ok (id integer); create table ok (id);")
    db_file = tmp_path / "y.db"
    with pytest.raises(sqlite3.OperationalError):
        migrate(db_file, tmp_path)
    conn = sqlite3.connect(db_file)
    assert conn.execute("select count(*) from sqlite_master where name='ok'").fetchone()[0] == 0


def _seed_workspace(db) -> str:  # type: ignore[no-untyped-def]
    uid, wid = new_id(), new_id()
    db.execute(
        text("insert into users(id,email,password_hash) values(:i,:e,'x')"),
        {"i": uid, "e": f"{uid}@x.io"},
    )
    db.execute(text("insert into workspaces(id,owner_id) values(:i,:o)"), {"i": wid, "o": uid})
    return wid


def test_fts_sync_and_cascade() -> None:
    with session_scope() as db:
        wid = _seed_workspace(db)
        aid = new_id()
        db.execute(
            text(
                "insert into assets(id,workspace_id,kind,filename,storage_key,mime,size_bytes,sha256)"
                " values(:a,:w,'video','f.mp4','k','video/mp4',1,'h')"
            ),
            {"a": aid, "w": wid},
        )
        db.execute(
            text(
                "insert into asset_segments(id,workspace_id,asset_id,idx,start_sec,end_sec,text)"
                " values(:i,:w,:a,0,0,2,'the quick brown fox')"
            ),
            {"i": new_id(), "w": wid, "a": aid},
        )
        q = "select count(*) from asset_segments_fts where asset_segments_fts match :q"
        assert db.scalar(text(q), {"q": "fox"}) == 1
        db.execute(text("update asset_segments set text='lazy dog' where asset_id=:a"), {"a": aid})
        assert db.scalar(text(q), {"q": "fox"}) == 0
        assert db.scalar(text(q), {"q": "lazy"}) == 1
        db.execute(text("delete from assets where id=:a"), {"a": aid})  # cascades to segments
        assert db.scalar(text(q), {"q": "lazy"}) == 0


def test_check_constraints_and_foreign_keys_enforced() -> None:
    with session_scope() as db:
        wid = _seed_workspace(db)
        with pytest.raises(Exception, match=r"CHECK|constraint"):
            db.execute(
                text(
                    "insert into content_items(id,workspace_id,title,stage) values(:i,:w,'t','bogus')"
                ),
                {"i": new_id(), "w": wid},
            )
        db.rollback()
    with session_scope() as db, pytest.raises(Exception, match="FOREIGN KEY"):
        db.execute(
            text("insert into content_items(id,workspace_id,title) values(:i,'missing','t')"),
            {"i": new_id()},
        )


def test_utcnow_format() -> None:
    assert len(utcnow()) == 20 and utcnow().endswith("Z")
