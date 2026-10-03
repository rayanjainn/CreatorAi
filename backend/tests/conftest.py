"""Shared fixtures: one temp DATA_DIR for the whole session, a clean DB for every test."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="creatorai-tests-")
os.environ.update(
    {
        "DATA_DIR": _TMP,
        "APP_ENV": "test",
        "JOBS_INLINE": "true",
        "JOB_MAX_RETRIES": "0",
        "JOB_RETRY_BACKOFF": "0,0",
        "EMBED_BACKEND": "hashing",
        "GEMINI_API_KEY": "",
        "GROQ_API_KEY": "",
        "OLLAMA_API_KEY": "",
        "OLLAMA_BASE_URL": "https://ollama.com",
        "LLM_PROVIDER_ORDER": "gemini,groq,ollama",
        "APP_SECRET": "",
        "MEDIA_SIGNING_SECRET": "",
        # Tests only: mock is NEVER the default (config default is false); opt in explicitly here.
        "LLM_ALLOW_MOCK": "true",
        "LOG_LEVEL": "WARNING",
    }
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings, reset_settings  # noqa: E402
from app.db import dispose_engine, get_engine, migrate  # noqa: E402
from app.llm.gateway import reset_gateway  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.workers.pubsub import pubsub  # noqa: E402
from app.workers.runner import JOB_HANDLERS, JOB_QUEUES  # noqa: E402


@pytest.fixture(scope="session")
def data_dir() -> Path:
    return Path(_TMP)


@pytest.fixture(scope="session", autouse=True)
def _migrated() -> Iterator[None]:
    reset_settings()
    migrate()
    yield
    dispose_engine()


@pytest.fixture(autouse=True)
def _clean_state() -> Iterator[None]:
    """Empty every table (not schema_migrations) and reset in-memory singletons after each test."""
    yield
    engine = get_engine()
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(text(f"delete from {table.name}"))
    pubsub.reset()
    reset_gateway()
    JOB_HANDLERS.clear()
    JOB_QUEUES.clear()
    settings = get_settings()
    settings.jobs_inline = True
    settings.job_max_retries = 0


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth(client: TestClient) -> dict[str, str]:
    """Sign up the single local user and return bearer headers."""
    res = client.post(
        "/api/v1/auth/signup", json={"email": "creator@example.com", "password": "password123"}
    )
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
def workspace_id(client: TestClient, auth: dict[str, str]) -> str:
    return str(client.get("/api/v1/me", headers=auth).json()["workspace_id"])


@pytest.fixture
def no_processing() -> Iterator[None]:
    """Run without the ``asset.process`` handler: uploads stay ``uploaded`` (junk bytes are fine)."""
    JOB_HANDLERS.pop("asset.process", None)
    JOB_QUEUES.pop("asset.process", None)
    yield
