"""Application settings: every env var and tunable lives here (Plan.md section 13)."""

from __future__ import annotations

import contextlib
import secrets
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
MIGRATIONS_DIR = BACKEND_ROOT / "migrations"

EmbedBackend = Literal["auto", "sentence-transformers", "fastembed", "hashing"]


class Settings(BaseSettings):
    """Typed configuration loaded from the environment and ``<repo>/.env``."""

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Runtime ---------------------------------------------------------------------------
    env: Literal["dev", "test", "prod"] = Field("dev", alias="APP_ENV")
    log_level: str = "INFO"
    data_dir: Path = REPO_ROOT / "data"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    frontend_url: str = "http://localhost:3000"

    # --- Auth ------------------------------------------------------------------------------
    auth_mode: Literal["local"] = "local"
    auth_allow_multi: bool = False
    jwt_ttl_days: int = 7
    app_secret: str = ""
    media_signing_secret: str = ""
    media_url_ttl_sec: int = 3600
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/youtube/oauth/callback"

    # --- Jobs ------------------------------------------------------------------------------
    jobs_inline: bool = False
    job_max_retries: int = 2
    job_retry_backoff: str = "10,30"
    job_pool_media: int = 1
    job_pool_llm: int = 2
    job_pool_io: int = 1

    # --- LLM -------------------------------------------------------------------------------
    gemini_api_key: str = ""
    gemini_model_main: str = "gemini-2.5-flash"
    gemini_model_lite: str = "gemini-2.5-flash-lite"
    groq_api_key: str = ""
    groq_chat_model: str = "llama-3.3-70b-versatile"
    llm_allow_mock: bool = True
    llm_cache_enabled: bool = True
    llm_timeout_sec: float = 30.0
    llm_queue_wait_sec: float = 25.0
    llm_backoff_base_sec: float = 1.0
    llm_circuit_open_sec: float = 60.0
    llm_circuit_failures: int = 3
    gemini_rpm: int = 8
    groq_rpm: int = 20
    groq_tpm: int = 6000
    groq_max_input_tokens: int = 6000

    # --- ASR -------------------------------------------------------------------------------
    asr_provider: Literal["auto", "groq", "faster-whisper", "none"] = "auto"
    groq_whisper_model: str = "whisper-large-v3-turbo"
    whisper_local_model: str = "small"
    asr_chunk_sec: float = 600.0
    asr_language: str = "auto"

    # --- Embeddings ------------------------------------------------------------------------
    embed_backend: EmbedBackend = "auto"
    embed_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    match_ok_st: float = 0.45
    match_weak_st: float = 0.30
    match_ok_hashing: float = 0.30
    match_weak_hashing: float = 0.15

    # --- Media analysis and clips ----------------------------------------------------------
    clip_min_sec: float = 20.0
    clip_max_sec: float = 45.0
    clip_top_k: int = 8
    clip_keep: int = 4
    silence_min_sec: float = 0.6
    silence_noise_db: float = -35.0
    pause_keep_sec: float = 0.15
    shot_threshold: float = 27.0
    shot_min_len_frames: int = 15
    keyframe_max_shots: int = 12
    render_x264_preset: str = "veryfast"
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"

    # --- Derived ---------------------------------------------------------------------------
    @model_validator(mode="after")
    def _finalize(self) -> Settings:
        self.data_dir = self.data_dir.expanduser()
        if not self.data_dir.is_absolute():
            self.data_dir = (REPO_ROOT / self.data_dir).resolve()
        if not self.app_secret:
            self.app_secret = _load_or_create_secret(self.data_dir)
        if not self.media_signing_secret:
            self.media_signing_secret = sha256(f"media:{self.app_secret}".encode()).hexdigest()
        return self

    @property
    def db_path(self) -> Path:
        return self.data_dir / "creatorai.db"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.db_path}"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def renders_dir(self) -> Path:
        return self.data_dir / "renders"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def retry_backoff_list(self) -> list[float]:
        return [float(x) for x in self.job_retry_backoff.split(",") if x.strip()]

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    def match_thresholds(self, backend: str) -> tuple[float, float]:
        """Return ``(MATCH_OK, MATCH_WEAK)`` for the active embedding backend."""
        if backend == "hashing":
            return self.match_ok_hashing, self.match_weak_hashing
        return self.match_ok_st, self.match_weak_st

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.media_dir, self.renders_dir, self.tmp_dir):
            path.mkdir(parents=True, exist_ok=True)


def _load_or_create_secret(data_dir: Path) -> str:
    """Persist an auto-generated secret to ``data/.secret`` so tokens survive restarts."""
    path = data_dir / ".secret"
    if path.exists():
        value = path.read_text().strip()
        if value:
            return value
    data_dir.mkdir(parents=True, exist_ok=True)
    value = secrets.token_urlsafe(48)
    path.write_text(value)
    with contextlib.suppress(OSError):
        path.chmod(0o600)
    return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings() -> Settings:
    """Drop the cached settings (tests change env vars between runs)."""
    get_settings.cache_clear()
    return get_settings()
