"""``make reset-password``: sets the single user's password from the CLI."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.helpers import V1


@pytest.fixture(scope="module")
def reset_module() -> Any:
    path = Path(__file__).resolve().parents[2] / "scripts" / "reset_password.py"
    spec = importlib.util.spec_from_file_location("reset_password", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _login(client: TestClient, email: str, password: str) -> int:
    return client.post(f"{V1}/auth/login", json={"email": email, "password": password}).status_code


def test_reset_password_changes_the_only_users_password(
    reset_module: Any, client: TestClient, capsys: Any
) -> None:
    email = "owner@example.com"
    assert (
        client.post(
            f"{V1}/auth/signup", json={"email": email, "password": "old-password-1"}
        ).status_code
        == 201
    )

    assert reset_module.main(["--password", "new-password-2"]) == 0
    assert email in capsys.readouterr().out
    assert _login(client, email, "old-password-1") == 401
    assert _login(client, email, "new-password-2") == 200


def test_reset_password_errors_are_friendly(
    reset_module: Any, client: TestClient, capsys: Any
) -> None:
    assert reset_module.main(["--password", "whatever-123"]) == 1  # no user yet
    assert "no user" in capsys.readouterr().err.lower()

    client.post(f"{V1}/auth/signup", json={"email": "a@example.com", "password": "password-123"})
    assert reset_module.main(["--email", "nobody@example.com", "--password", "whatever-123"]) == 1
    assert "a@example.com" in capsys.readouterr().err
    assert reset_module.main(["--password", "short"]) == 1  # too short
    assert "password" in capsys.readouterr().err.lower()
