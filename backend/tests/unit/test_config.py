from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings, _load_or_create_secret, get_settings


def test_defaults_match_plan() -> None:
    s = get_settings()
    assert (s.clip_min_sec, s.clip_max_sec) == (20.0, 45.0)
    assert s.silence_min_sec == 0.6 and s.pause_keep_sec == 0.15
    assert s.render_x264_preset == "veryfast"
    assert s.gemini_rpm == 8 and s.groq_rpm == 20 and s.groq_tpm == 6000
    assert s.auth_mode == "local"


def test_match_thresholds_are_per_backend() -> None:
    s = get_settings()
    assert s.match_thresholds("sentence-transformers") == (0.45, 0.30)
    ok, weak = s.match_thresholds("hashing")
    assert 0 < weak < ok < 0.45


def test_secret_is_generated_once_and_persisted(tmp_path: Path) -> None:
    first = _load_or_create_secret(tmp_path)
    assert (tmp_path / ".secret").read_text() == first
    assert _load_or_create_secret(tmp_path) == first
    assert len(first) >= 32


def test_derived_secrets_and_paths(tmp_path: Path) -> None:
    s = Settings(DATA_DIR=str(tmp_path), APP_SECRET="s3cret", MEDIA_SIGNING_SECRET="")
    assert s.app_secret == "s3cret"
    assert s.media_signing_secret and s.media_signing_secret != s.app_secret
    assert s.db_path == tmp_path / "creatorai.db"
    assert s.database_url.startswith("sqlite:///")


def test_explicit_media_secret_wins_and_lists_parse(tmp_path: Path) -> None:
    s = Settings(
        DATA_DIR=str(tmp_path),
        MEDIA_SIGNING_SECRET="fixed",
        CORS_ORIGINS="http://a.test, http://b.test",
        JOB_RETRY_BACKOFF="5,15",
    )
    assert s.media_signing_secret == "fixed"
    assert s.cors_origin_list == ["http://a.test", "http://b.test"]
    assert s.retry_backoff_list == [5.0, 15.0]


def test_env_example_documents_every_setting_and_loads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import re

    from app.config import REPO_ROOT

    text = (REPO_ROOT / ".env.example").read_text()
    keys = set(re.findall(r"^([A-Z0-9_]+)=", text, re.MULTILINE))
    fields = {(f.alias or name).upper() for name, f in Settings.model_fields.items()}
    assert keys == fields
    for key in keys:
        monkeypatch.delenv(key, raising=False)
    example = tmp_path / ".env"
    example.write_text(text.replace("DATA_DIR=./data", f"DATA_DIR={tmp_path}"))
    loaded = Settings(_env_file=example)  # type: ignore[call-arg]
    assert loaded.gemini_api_key == "" and loaded.groq_api_key == ""
    assert loaded.cors_origin_list[0] == "http://localhost:3000" and loaded.retry_backoff_list == [
        10.0,
        30.0,
    ]
    assert loaded.llm_allow_mock is False and loaded.env == "dev"
    assert loaded.provider_order == ("gemini", "groq", "ollama")
    assert loaded.ollama_base_url == "https://ollama.com" and loaded.ollama_model == "gpt-oss:120b"


def test_mock_is_off_by_default(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("LLM_ALLOW_MOCK", raising=False)
    assert Settings(DATA_DIR=str(tmp_path), _env_file=None).llm_allow_mock is False  # type: ignore[call-arg]


def test_provider_order_parsing_and_validation(tmp_path: Path) -> None:
    s = Settings(DATA_DIR=str(tmp_path), LLM_PROVIDER_ORDER=" Ollama, groq ,ollama")
    assert s.provider_order == ("ollama", "groq")
    with pytest.raises(ValueError, match="openai"):
        Settings(DATA_DIR=str(tmp_path), LLM_PROVIDER_ORDER="gemini,openai")


@pytest.mark.parametrize(
    ("url", "local"),
    [
        ("https://ollama.com", False),
        ("https://ollama.com/", False),
        ("http://localhost:11434", True),
    ],
)
def test_ollama_local_detection(tmp_path: Path, url: str, local: bool) -> None:
    assert Settings(DATA_DIR=str(tmp_path), OLLAMA_BASE_URL=url).ollama_is_local is local
