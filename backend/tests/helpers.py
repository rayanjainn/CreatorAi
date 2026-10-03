"""Shared test helpers for ingest/search tests (no network, stubbed LLM)."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.llm import gateway as gateway_module
from app.llm.gateway import Gateway
from app.llm.providers.gemini import GeminiProvider
from app.llm.providers.mock import MockProvider

V1 = "/api/v1"
Hdr = dict[str, str]


def upload_file(
    client: TestClient,
    auth: Hdr,
    path: Path,
    *,
    sidecar: Path | None = None,
    content_item_id: str | None = None,
    mime: str | None = None,
) -> dict[str, Any]:
    """One-shot multipart upload of ``path`` (+ optional sidecar); returns the JSON body."""
    files: dict[str, Any] = {
        "file": (path.name, path.read_bytes(), mime or "application/octet-stream")
    }
    if sidecar is not None:
        files["sidecar"] = (sidecar.name, sidecar.read_bytes(), "application/json")
    data = {"content_item_id": content_item_id} if content_item_id else None
    res = client.post(f"{V1}/assets/upload", files=files, data=data, headers=auth)
    assert res.status_code == 201, res.text
    body: dict[str, Any] = res.json()
    return body


def get_asset(client: TestClient, auth: Hdr, asset_id: str, **params: Any) -> dict[str, Any]:
    res = client.get(f"{V1}/assets/{asset_id}", params=params, headers=auth)
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


def gemini_gateway(handler: Callable[[httpx.Request], httpx.Response]) -> Gateway:
    """A Gateway whose Gemini provider talks to ``handler`` (an httpx MockTransport)."""
    settings = Settings(GEMINI_API_KEY="test-key", LLM_ALLOW_MOCK=False, _env_file=None)  # type: ignore[call-arg]
    client = httpx.Client(transport=httpx.MockTransport(handler))
    providers = {"gemini": GeminiProvider(settings, client), "mock": MockProvider()}
    return Gateway(settings=settings, providers=providers)


def install_gateway(monkeypatch: Any, gateway: Gateway) -> None:
    monkeypatch.setattr(gateway_module, "_gateway", gateway)


def gemini_caption_reply(request: httpx.Request) -> httpx.Response:
    """A valid Gemini ``generateContent`` reply for ``assets.caption_keyframes``."""
    body = json.loads(request.content)
    prompt = body["contents"][0]["parts"][0]["text"]
    shot_ids = re.findall(r'"id":\s*"(shot_\d+)"', prompt)
    payload = {
        "shots": [
            {"id": sid, "caption": f"Editing desk scene {n}", "tags": ["desk", "editing", "screen"]}
            for n, sid in enumerate(shot_ids)
        ],
        "description": "A creator explains a video editing workflow.",
        "tags": ["editing", "workflow", "tutorial"],
    }
    return httpx.Response(
        200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}
    )


def wipe_provider_keys(monkeypatch: Any, *, allow_mock: bool) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "llm_allow_mock", allow_mock)
    gateway_module.reset_gateway()


# ── content item + script + footage helpers (matching, clips, edits tests) ────────────────────
DEMO_BEATS = [
    ("Intro", ["Here is how I edit a video from start to finish."]),
    ("Import", ["The first step is to import every clip into one bin."]),
    ("Trim", ["Next I trim the dead air and cut out the long pauses."]),
    ("Missing", ["Quantum chromodynamics explains hadron confinement inside neutron stars."]),
    ("Export", ["Finally I export a vertical version for shorts and a wide version for youtube."]),
]


def make_item_with_script(
    client: TestClient,
    auth: Hdr,
    scenes: list[tuple[str, list[str]]] | None = None,
    title: str = "Editing workflow",
) -> tuple[str, dict[str, Any]]:
    """A content item whose current script has the given ``(title, [beat text])`` scenes."""
    item = client.post(
        f"{V1}/content", json={"title": title, "target_duration_sec": 45}, headers=auth
    ).json()["id"]
    hooks = client.post(f"{V1}/content/{item}/hooks", headers=auth).json()
    payload = [
        {"title": name, "text": " ".join(beats), "beats": [{"text": t} for t in beats]}
        for name, beats in (scenes or DEMO_BEATS)
    ]
    res = client.patch(f"{V1}/scripts/{hooks['script_id']}", json={"scenes": payload}, headers=auth)
    assert res.status_code == 200, res.text
    return str(item), res.json()
