"""Shared fixtures: one temp DATA_DIR for the whole session, a clean DB for every test."""

from __future__ import annotations

import os
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

_TMP = tempfile.mkdtemp(prefix="creatorai-tests-")
os.environ.update(
    {
        "DATA_DIR": _TMP,
        "APP_ENV": "test",
        "JOBS_INLINE": "true",
        "JOB_MAX_RETRIES": "0",
        "JOB_RETRY_BACKOFF": "0,0",
        "EMBED_BACKEND": "hashing",
        "RENDER_X264_PRESET": "ultrafast",
        "GEMINI_API_KEY": "",
        "GROQ_API_KEY": "",
        "OLLAMA_API_KEY": "",
        "GOOGLE_CLIENT_ID": "",
        "GOOGLE_CLIENT_SECRET": "",
        "TAVILY_API_KEY": "",
        "SERPER_API_KEY": "",
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
from app.workers import load_handlers  # noqa: E402
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
def _job_handlers() -> None:
    """Register the real job handlers before each test (state cleanup empties the registry)."""
    load_handlers()


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


@pytest.fixture(scope="session")
def demo_media(tmp_path_factory: pytest.TempPathFactory) -> Any:
    """Synthetic DEMO footage (~45 s, 5 scenes, tone bursts) + words.json sidecar, generated once.

    Same generator as ``backend/scripts/make_demo_media.py`` (small 320x180 10 fps variant, no binaries
    are committed). Attributes: ``video``, ``sidecar``, ``duration``, ``words``, ``scene_cuts``.
    """
    import importlib.util

    from app.media.ffmpeg import ffmpeg_available

    if not ffmpeg_available():
        pytest.skip("ffmpeg required")
    path = Path(__file__).resolve().parents[1] / "scripts" / "make_demo_media.py"
    spec = importlib.util.spec_from_file_location("make_demo_media", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses look the module up by name
    spec.loader.exec_module(module)
    return module.generate(tmp_path_factory.mktemp("demo"), "hero_demo", 320, 180, 10)


@pytest.fixture(scope="session")
def tiny_media(tmp_path_factory: pytest.TempPathFactory) -> Any:
    """A ~6 s clip (3 colour scenes, 3 tone bursts with pauses) + words.json sidecar: fast runs.

    Same shape as ``demo_media`` (``video``, ``sidecar``, ``duration``, ``words``, ``scene_cuts``).
    """
    import json
    import subprocess
    from types import SimpleNamespace

    from app.media.ffmpeg import ffmpeg_available

    if not ffmpeg_available():
        pytest.skip("ffmpeg required")
    folder = tmp_path_factory.mktemp("tiny")
    video, sidecar = folder / "tiny.mp4", folder / "tiny.words.json"
    video_graph = (
        "color=c=0x2060c0:s=160x90:r=25:d=2[a];color=c=0xc06020:s=160x90:r=25:d=2[b];"
        "color=c=0x20a050:s=160x90:r=25:d=2[c];[a][b][c]concat=n=3:v=1:a=0[v]"
    )
    audio_graph = (
        "sine=f=300:d=1.5:r=16000[t1];anullsrc=r=16000:cl=mono,atrim=duration=0.9[s1];sine=f=380:d=1.5:r=16000[t2];"
        "anullsrc=r=16000:cl=mono,atrim=duration=0.9[s2];sine=f=340:d=1.2:r=16000[t3];"
        "[t1][s1][t2][s2][t3]concat=n=5:v=0:a=1,aresample=16000[a]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-filter_complex", f"{video_graph};{audio_graph}",
         "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", "6", str(video)],
        check=True,
    )  # fmt: skip
    words = [
        {"word": w, "start": s, "end": e}
        for w, s, e in [
            ("Welcome", 0.1, 0.5), ("to", 0.55, 0.7), ("my", 0.75, 0.9), ("editing", 0.95, 1.3),
            ("workflow.", 1.35, 1.45), ("First", 2.4, 2.8), ("import", 2.85, 3.3),
            ("everything", 3.35, 3.8), ("here.", 3.85, 3.9), ("Then", 4.8, 5.2),
            ("export", 5.25, 5.6), ("it.", 5.65, 5.9),
        ]
    ]  # fmt: skip
    sidecar.write_text(json.dumps({"provenance": "demo", "language": "en", "words": words}))
    return SimpleNamespace(
        video=video, sidecar=sidecar, duration=6.0, words=words, scene_cuts=[2.0, 4.0]
    )
