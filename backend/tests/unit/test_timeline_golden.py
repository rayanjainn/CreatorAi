"""The frontend's golden file (frontend/src/lib/timeline/golden.json) must match the real timeline_service.

The vitest suite replays every case through the TypeScript mirror. This test makes sure the checked-in file is not stale:
if it fails, run ``python scripts/dump_timeline_golden.py`` from ``backend/`` and commit the result.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "dump_timeline_golden.py"


def _load():
    spec = importlib.util.spec_from_file_location("dump_timeline_golden", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_golden_file_is_current() -> None:
    mod = _load()
    assert mod.DEFAULT_OUT.exists(), "run scripts/dump_timeline_golden.py"
    assert mod.DEFAULT_OUT.read_text() == mod.render(mod.build()), (
        "frontend/src/lib/timeline/golden.json is stale: run `python scripts/dump_timeline_golden.py`"
    )


def test_golden_generation_is_deterministic() -> None:
    mod = _load()
    assert mod.render(mod.build()) == mod.render(mod.build())
