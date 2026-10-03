"""SQLite engine, session factory and the SQL migration runner."""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import MIGRATIONS_DIR, get_settings

_lock = threading.Lock()
_engine: Engine | None = None
_factory: sessionmaker[Session] | None = None


def _on_connect(dbapi_conn: sqlite3.Connection, _record: object) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=30000")
    cur.close()


def get_engine() -> Engine:
    """Return the process-wide engine, creating it (and the data dir) on first use."""
    global _engine, _factory
    with _lock:
        if _engine is None:
            settings = get_settings()
            settings.data_dir.mkdir(parents=True, exist_ok=True)
            _engine = create_engine(
                settings.database_url,
                connect_args={"check_same_thread": False, "timeout": 30},
                pool_pre_ping=False,
            )
            event.listen(_engine, "connect", _on_connect)
            _factory = sessionmaker(_engine, expire_on_commit=False, autoflush=False)
        return _engine


def get_session_factory() -> sessionmaker[Session]:
    """Thread-safe factory: every call to the factory yields an independent session."""
    get_engine()
    assert _factory is not None
    return _factory


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for non-request code (jobs, scripts): commit or roll back."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def dispose_engine() -> None:
    """Close the engine so the next call rebuilds it from current settings (tests, reset)."""
    global _engine, _factory
    with _lock:
        if _engine is not None:
            _engine.dispose()
        _engine = None
        _factory = None


def migrate(db_path: Path | None = None, migrations_dir: Path | None = None) -> list[str]:
    """Apply pending ``migrations/*.sql`` in name order; return the names applied."""
    path = db_path or get_settings().db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    directory = migrations_dir or MIGRATIONS_DIR
    conn = sqlite3.connect(path, timeout=30, isolation_level=None)
    applied: list[str] = []
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "create table if not exists schema_migrations ("
            "name text primary key, "
            "applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')))"
        )
        done = {row[0] for row in conn.execute("select name from schema_migrations")}
        for sql_file in sorted(directory.glob("*.sql")):
            if sql_file.name in done:
                continue
            script = (
                "BEGIN;\n"
                + sql_file.read_text(encoding="utf-8")
                + "\ninsert into schema_migrations(name) values ('"
                + sql_file.name.replace("'", "''")
                + "');\nCOMMIT;"
            )
            try:
                conn.executescript(script)
            except Exception:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise
            applied.append(sql_file.name)
    finally:
        conn.close()
    return applied
