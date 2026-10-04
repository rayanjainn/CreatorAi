"""Application settings: every env var and tunable lives here (Plan.md section 13)."""

from __future__ import annotations

import contextlib
import os
import secrets
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
MIGRATIONS_DIR = BACKEND_ROOT / "migrations"

EmbedBackend = Literal["auto", "sentence-transformers", "fastembed", "hashing"]
CaptionRenderer = Literal["auto", "libass", "pillow"]
OLLAMA_CLOUD_URL = "https://ollama.com"
REAL_PROVIDERS = ("gemini", "groq", "ollama")


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

    # --- Optional cloud clipper (LumiClip) and its media host (Cloudinary) ----------------------
    # Keys live only on the server; the browser never sees them.
    lumiclip_api_key: str = ""
    lumiclip_base_url: str = "https://api.lumiclip.ai"
    # Tests against a local fake (scripts/fake_lumiclip.py) only: allow loopback clip downloads.
    lumiclip_allow_private_downloads: bool = False
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""

    # --- Uploads and ingest ----------------------------------------------------------------
    max_upload_bytes: int = 8 * 1024**3
    upload_chunk_size: int = 8 * 1024 * 1024
    min_free_disk_mb: int = 200  # kept free on top of 2x the upload size
    upload_stale_hours: int = 24
    keyframe_extract_max: int = 48
    asr_max_tries: int = 3

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
    # Ollama Cloud (https://ollama.com, needs OLLAMA_API_KEY) or a local server
    # (OLLAMA_BASE_URL=http://localhost:11434, no key). Model ids are user-adjustable.
    ollama_api_key: str = ""
    ollama_base_url: str = OLLAMA_CLOUD_URL
    ollama_model: str = "gpt-oss:120b"
    ollama_vision_model: str = "qwen3-vl:235b"
    llm_provider_order: str = "gemini,groq,ollama"
    # Mock is an explicit dev/test opt-in. It is never the default and never a silent fallback.
    llm_allow_mock: bool = False
    llm_cache_enabled: bool = True
    llm_timeout_sec: float = 30.0
    llm_queue_wait_sec: float = 25.0
    llm_backoff_base_sec: float = 1.0
    llm_circuit_open_sec: float = 60.0
    llm_circuit_failures: int = 3
    gemini_rpm: int = 8
    groq_rpm: int = 20
    ollama_rpm: int = 30
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
    caption_renderer: CaptionRenderer = "auto"
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"

    @property
    def lumiclip_configured(self) -> bool:
        return bool(self.lumiclip_api_key)

    @property
    def cloudinary_configured(self) -> bool:
        return bool(
            self.cloudinary_cloud_name and self.cloudinary_api_key and self.cloudinary_api_secret
        )

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

    @field_validator("llm_provider_order")
    @classmethod
    def _check_order(cls, value: str) -> str:
        names = [n.strip().lower() for n in value.split(",") if n.strip()]
        unknown = [n for n in names if n not in REAL_PROVIDERS]
        if unknown:
            raise ValueError(
                f"LLM_PROVIDER_ORDER has unknown provider(s) {unknown}; use {list(REAL_PROVIDERS)}"
            )
        return ",".join(dict.fromkeys(names)) or ",".join(REAL_PROVIDERS)

    @property
    def provider_order(self) -> tuple[str, ...]:
        """Real LLM providers in routing order (``LLM_PROVIDER_ORDER``)."""
        return tuple(n for n in self.llm_provider_order.split(",") if n)

    @property
    def ollama_is_local(self) -> bool:
        """True when ``OLLAMA_BASE_URL`` points somewhere other than Ollama Cloud."""
        return self.ollama_base_url.strip().rstrip("/").lower() != OLLAMA_CLOUD_URL

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
    def fastembed_cache_dir(self) -> Path:
        """Where the ONNX embedding model lives (fastembed would default to the OS temp dir,
        which is purged on reboot). ``FASTEMBED_CACHE_PATH`` overrides it."""
        override = os.environ.get("FASTEMBED_CACHE_PATH")
        return Path(override) if override else self.data_dir / "models" / "fastembed"

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
