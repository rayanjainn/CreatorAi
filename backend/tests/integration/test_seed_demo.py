"""``make seed`` end to end: real pipeline on generated footage, no LLM, everything labelled demo."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.models import Asset, Clip, ContentItem, IdeaSuggestion, Render, TwinMemory, YtVideo
from tests.helpers import V1


@pytest.fixture(scope="module")
def seed_module() -> Any:
    path = Path(__file__).resolve().parents[2] / "scripts" / "seed_demo.py"
    spec = importlib.util.spec_from_file_location("seed_demo", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_seed_is_idempotent_labelled_demo_and_resettable(
    seed_module: Any, demo_media: Any, client: TestClient, data_dir: Path, capsys: Any
) -> None:
    demo_dir = str(demo_media.video.parent)
    assert seed_module.main(["--render", "--demo-dir", demo_dir]) == 0
    out = capsys.readouterr().out
    assert "created demo user demo@creatorai.local" in out and "NOT" not in out

    # login as the demo user and read the board over the API
    login = client.post(
        f"{V1}/auth/login", json={"email": "demo@creatorai.local", "password": "demo1234"}
    )
    assert login.status_code == 200, login.text
    auth = {"Authorization": f"Bearer {login.json()['access_token']}"}
    board = client.get(f"{V1}/content/board", headers=auth).json()
    assert [c["count"] for c in board["columns"]] == [3, 2, 1, 1, 1, 1]
    titles = [card["title"] for col in board["columns"] for card in col["cards"]]
    assert len(titles) == 9 and all(t.startswith("[DEMO] ") for t in titles)
    me = client.get(f"{V1}/me", headers=auth).json()
    assert me["profile"]["onboarding_done"] and me["profile"]["style_profile"]["summary"]

    with session_scope() as db:
        assert db.query(YtVideo).filter(YtVideo.is_seed.is_(True)).count() == 24
        assert db.query(YtVideo).filter(YtVideo.is_seed.is_(False)).count() == 0
        ideas = db.query(IdeaSuggestion).all()
        assert len(ideas) == 6 and all(i.provenance["source"] == "demo" for i in ideas)
        memories = db.query(TwinMemory).all()
        assert len(memories) == 10 and all(m.embedding for m in memories)
        assert all(m.source_id == "demo:seed" and m.text.startswith("[DEMO]") for m in memories)
        hero = db.query(ContentItem).filter(ContentItem.stage == "edit").one()
        asset = db.query(Asset).filter(Asset.content_item_id == hero.id).one()
        assert asset.status == "ready"
        assert asset.analysis["sidecar"]["source"] == "demo"
        clips = db.query(Clip).filter(Clip.content_item_id == hero.id).all()
        assert clips and all(c.title.startswith("[DEMO] ") for c in clips)
        assert all(c.features["provenance"]["source"] == "heuristic" for c in clips)  # no LLM
        render = db.query(Render).one()
        assert render.status == "done" and render.preset == "yt_short"
        render_file = data_dir / render.output_key
        assert render_file.is_file()
        hero_id = hero.id

    script = client.get(f"{V1}/content/{hero_id}/script", headers=auth).json()
    assert script["provenance"]["source"] == "demo" and script["provider"] == "demo"
    plan = client.get(f"{V1}/content/{hero_id}/director/plan", headers=auth).json()
    assert plan["provenance"]["source"] == "demo"
    match = client.get(f"{V1}/content/{hero_id}/match", headers=auth).json()
    assert match["ran"] and match["missing_scenes"]  # the "Sound" scene is not in the footage
    statuses = {b["status"] for b in match["beats"]}
    assert "matched" in statuses and len(statuses) > 1  # real matches plus honest gaps

    # second run leaves everything alone
    assert seed_module.main(["--demo-dir", demo_dir]) == 0
    assert "already present" in capsys.readouterr().out
    with session_scope() as db:
        assert db.query(ContentItem).count() == 9

    # --reset removes only seeded rows (and the hero files), then reseeds
    with session_scope() as db:
        db.add(ContentItem(workspace_id=db.query(ContentItem).first().workspace_id, title="Mine"))
    assert seed_module.main(["--reset", "--skip-hero", "--demo-dir", demo_dir]) == 0
    with session_scope() as db:
        assert db.query(ContentItem).count() == 10  # 9 reseeded + "Mine"
        assert db.query(ContentItem).filter(ContentItem.title == "Mine").count() == 1
        assert db.query(Asset).count() == 0 and db.query(Render).count() == 0
        assert db.query(YtVideo).count() == 24 and db.query(TwinMemory).count() == 10
    assert not render_file.exists()
