"""LLM Gateway (Plan.md section 7.1): one synchronous entry point for every model call.

``run_with_meta`` builds the prompt, checks the cache, walks the provider chain with rate limiting,
JSON validation + one repair retry, backoff and circuit breakers, then caches and logs usage.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select

from app.config import REAL_PROVIDERS, Settings, get_settings
from app.db import session_scope
from app.errors import AppError, llm_busy
from app.llm.cache import CachedResponse, LlmResponseCache, cache_key, schema_version
from app.llm.context import build_creator_context
from app.llm.providers import build_providers
from app.llm.providers.base import (
    LLMRequest,
    LLMResult,
    Provider,
    ProviderError,
    estimate_tokens,
)
from app.llm.providers.mock import MockProvider
from app.llm.ratelimit import SlidingWindowLimiter
from app.llm.render import render_prompt
from app.llm.tasks import Target, chain_for, route_for
from app.llm.types import LLMMeta
from app.models import LlmUsage

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

MAX_HTTP_TRIES = 3
MAX_RETRY_AFTER_SEC = 30.0
REPAIR_SUFFIX = (
    "\n\nReturn only valid JSON matching the schema. Previous output was invalid: {error}"
)


@dataclass
class _Circuit:
    failures: int = 0
    open_until: float = 0.0


@dataclass
class _Attempt:
    """Result of trying one provider: a validated model, or why it was skipped."""

    value: BaseModel | None = None
    result: LLMResult | None = None
    retry_after: float = 0.0
    error: str = ""
    latency_ms: int = 0


@dataclass
class Gateway:
    settings: Settings = field(default_factory=get_settings)
    providers: dict[str, Provider] = field(default_factory=dict)
    limiter: SlidingWindowLimiter = field(default_factory=SlidingWindowLimiter)
    cache: LlmResponseCache = field(default_factory=LlmResponseCache)
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic

    def __post_init__(self) -> None:
        if not self.providers:
            self.providers = build_providers(self.settings)
        self._circuits: dict[str, _Circuit] = {}
        self._lock = threading.Lock()

    # ── public ───────────────────────────────────────────────────────────────────────────────
    def run(
        self,
        task: str,
        variables: dict[str, Any],
        schema: type[T],
        workspace_id: str | None,
        images: list[bytes] | None = None,
        cache: bool = True,
    ) -> T:
        """Like :meth:`run_with_meta` but returns only the output."""
        return self.run_with_meta(task, variables, schema, workspace_id, images, cache)[0]

    def run_with_meta(
        self,
        task: str,
        variables: dict[str, Any],
        schema: type[T],
        workspace_id: str | None,
        images: list[bytes] | None = None,
        cache: bool = True,
    ) -> tuple[T, LLMMeta]:
        """Run ``task``; returns ``(validated schema instance, LLMMeta)`` or raises.

        Raises ``LLM_NOT_CONFIGURED`` when no real provider is set up (and mock is off) and
        ``LLM_BUSY`` when every configured provider failed. It never falls back to mock unless
        ``LLM_ALLOW_MOCK=true``.
        """
        route = route_for(task, self.settings)
        images = images or []
        query = str(
            variables.get("topic") or variables.get("idea") or variables.get("message") or ""
        )
        context = build_creator_context(workspace_id, query)
        prompt = render_prompt(
            task,
            {
                **variables,
                "creator_context": context,
                "schema": json.dumps(schema.model_json_schema(), separators=(",", ":")),
            },
        )
        key = cache_key(
            task,
            schema_version(schema),
            prompt,
            [hashlib.sha256(img).hexdigest() for img in images],
        )
        use_cache = cache and self.settings.llm_cache_enabled
        if use_cache:
            hit = self._cache_lookup(key, schema)
            if hit is not None:
                self._log_usage(workspace_id, task, hit.provider, hit.model, 0, 0, 0, True, "ok")
                meta = LLMMeta(hit.provider, hit.model, is_mock=False, cache_hit=True)
                return schema.model_validate(hit.response), meta

        est_tokens = estimate_tokens(prompt) + route.max_tokens // 2
        retry_after = 1.0
        for target in chain_for(task, self.settings):
            provider = self.providers.get(target.provider)
            if provider is None or not provider.configured():
                continue
            if images and not provider.supports_images:
                continue
            if provider.name == "groq" and est_tokens > self.settings.groq_max_input_tokens:
                continue
            wait = self._circuit_remaining(provider.name)
            if wait > 0:
                retry_after = max(retry_after, wait)
                continue
            tier = "vision" if images and provider.name == "ollama" else target.tier
            request = LLMRequest(
                task=task,
                prompt=prompt,
                schema_json=schema.model_json_schema(),
                max_tokens=route.max_tokens,
                model=provider.model_for(tier),
                images=images,
                variables=variables,
            )
            attempt = self._try_provider(
                provider, target, request, schema, est_tokens, workspace_id
            )
            if attempt.value is not None and attempt.result is not None:
                if use_cache and provider.name != "mock":
                    self.cache.put(
                        key,
                        task,
                        CachedResponse(
                            attempt.value.model_dump(mode="json"),
                            provider.name,
                            attempt.result.model,
                            attempt.result.tokens_in,
                            attempt.result.tokens_out,
                        ),
                    )
                meta = LLMMeta(
                    provider.name,
                    attempt.result.model,
                    is_mock=provider.name == "mock",
                    cache_hit=False,
                    latency_ms=attempt.latency_ms,
                )
                return attempt.value, meta  # type: ignore[return-value]
            retry_after = max(retry_after, attempt.retry_after)
        if not any(
            (p := self.providers.get(t.provider)) and p.configured()
            for t in chain_for(task, self.settings)
        ):
            raise not_configured(self.settings)
        raise llm_busy(retry_after)

    def data_mode(self) -> str:
        """``real`` (>=1 real provider configured), ``mock`` (mock only) or ``unconfigured``."""
        if any(self.providers[n].configured() for n in REAL_PROVIDERS if n in self.providers):
            return "real"
        return "mock" if self.settings.llm_allow_mock else "unconfigured"

    def provider_flags(self) -> dict[str, dict[str, bool]]:
        """Per real provider: ``configured`` and ``healthy`` (configured with a closed circuit)."""
        return {
            name: {
                "configured": (cfg := self.providers[name].configured()),
                "healthy": cfg and self._circuit_remaining(name) <= 0,
            }
            for name in REAL_PROVIDERS
            if name in self.providers
        }

    def test_providers(self) -> dict[str, dict[str, Any]]:
        """One tiny real round-trip per configured provider (``POST /llm/test``)."""
        results: dict[str, dict[str, Any]] = {}
        for name in self.settings.provider_order:
            provider = self.providers.get(name)
            if provider is None or not provider.configured():
                results[name] = {"configured": False, "ok": False, "latency_ms": None,
                                 "model": None, "error": "not configured"}  # fmt: skip
                continue
            model = provider.model_for("lite" if name == "gemini" else "main")
            request = LLMRequest(
                task="llm.test",
                prompt='Reply with exactly this JSON object: {"ok": true}',
                schema_json={"type": "object", "properties": {"ok": {"type": "boolean"}}},
                max_tokens=32,
                model=model,
            )
            started = self.clock()
            try:
                provider.generate(request)
                error = ""
            except ProviderError as exc:
                error = self._redact(str(exc))
            except Exception as exc:  # never let one provider break the report
                error = self._redact(f"{type(exc).__name__}: {exc}")
            results[name] = {
                "configured": True,
                "ok": not error,
                "latency_ms": int((self.clock() - started) * 1000),
                "model": model,
                "error": error or None,
            }
        if self.settings.llm_allow_mock:
            results["mock"] = {"configured": True, "ok": True, "latency_ms": 0,
                               "model": MockProvider.MODEL, "error": None}  # fmt: skip
        return results

    def _redact(self, text: str) -> str:
        s = self.settings
        for secret in (s.gemini_api_key, s.groq_api_key, s.ollama_api_key):
            if secret:
                text = text.replace(secret, "***")
        return text

    def status(self) -> dict[str, Any]:
        """Providers configured, circuit state and today's usage counts."""
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        with session_scope() as db:
            rows = db.execute(
                select(LlmUsage.provider, func.count(), func.sum(LlmUsage.cache_hit))
                .where(LlmUsage.created_at >= today)
                .group_by(LlmUsage.provider)
            ).all()
        usage = {p: {"calls": int(n), "cache_hits": int(h or 0)} for p, n, h in rows}
        return {
            "providers": {
                name: {
                    "configured": prov.configured(),
                    "healthy": prov.configured() and self._circuit_remaining(name) <= 0,
                    "circuit_open_sec": round(self._circuit_remaining(name), 1),
                    "usage_today": usage.get(name, {"calls": 0, "cache_hits": 0}),
                }
                for name, prov in self.providers.items()
            },
            "cache_hits_today": sum(u["cache_hits"] for u in usage.values()),
            "allow_mock": self.settings.llm_allow_mock,
            "data_mode": self.data_mode(),
            "provider_order": list(self.settings.provider_order),
            "models": {
                "gemini_main": self.settings.gemini_model_main,
                "gemini_lite": self.settings.gemini_model_lite,
                "groq_chat": self.settings.groq_chat_model,
                "ollama": self.settings.ollama_model,
                "ollama_vision": self.settings.ollama_vision_model,
            },
        }

    # ── internals ────────────────────────────────────────────────────────────────────────────
    def _cache_lookup(self, key: str, schema: type[BaseModel]) -> CachedResponse | None:
        hit = self.cache.get(key)
        if hit is None:
            return None
        try:
            schema.model_validate(hit.response)
        except ValidationError:
            return None
        return hit

    def _circuit_remaining(self, provider: str) -> float:
        with self._lock:
            circuit = self._circuits.get(provider)
            return max(0.0, circuit.open_until - self.clock()) if circuit else 0.0

    def _record_failure(self, provider: str) -> bool:
        """Count a failure; returns True when the circuit just opened."""
        with self._lock:
            circuit = self._circuits.setdefault(provider, _Circuit())
            circuit.failures += 1
            if circuit.failures >= self.settings.llm_circuit_failures:
                circuit.failures = 0
                circuit.open_until = self.clock() + self.settings.llm_circuit_open_sec
                log.warning("llm circuit opened for %s", provider)
                return True
            return False

    def _record_success(self, provider: str) -> None:
        with self._lock:
            self._circuits[provider] = _Circuit()

    def _acquire_slot(self, provider: Provider, est_tokens: int) -> float:
        """Take rate-limit slots; returns 0 on success or the seconds until a slot opens."""
        s = self.settings
        timeout = s.llm_queue_wait_sec
        if provider.name == "gemini":
            ok = self.limiter.acquire("gemini:rpm", s.gemini_rpm, timeout=timeout)
            return 0.0 if ok else self.limiter.retry_after("gemini:rpm", s.gemini_rpm)
        if provider.name == "ollama":
            ok = self.limiter.acquire("ollama:rpm", s.ollama_rpm, timeout=timeout)
            return 0.0 if ok else self.limiter.retry_after("ollama:rpm", s.ollama_rpm)
        if provider.name == "groq":
            if not self.limiter.acquire("groq:rpm", s.groq_rpm, timeout=timeout):
                return self.limiter.retry_after("groq:rpm", s.groq_rpm)
            if not self.limiter.acquire("groq:tpm", s.groq_tpm, cost=est_tokens, timeout=timeout):
                return self.limiter.retry_after("groq:tpm", s.groq_tpm, cost=est_tokens)
        return 0.0

    def _try_provider(
        self,
        provider: Provider,
        target: Target,
        request: LLMRequest,
        schema: type[T],
        est_tokens: int,
        workspace_id: str | None,
    ) -> _Attempt:
        if provider.name != "mock":
            wait = self._acquire_slot(provider, est_tokens)
            if wait > 0:
                return _Attempt(retry_after=wait, error="rate limited")
        outcome = self._call_with_backoff(provider, request, workspace_id)
        if outcome.result is None:
            return outcome
        parsed, error = _parse(outcome.result.text, schema)
        if parsed is None:
            self._log_usage(
                workspace_id, request.task, provider.name, request.model, 0, 0, 0, False, "invalid"
            )
            repair = replace(request, prompt=request.prompt + REPAIR_SUFFIX.format(error=error))
            retry = self._call_with_backoff(provider, repair, workspace_id)
            if retry.result is None:
                return retry
            outcome = retry
            parsed, error = _parse(outcome.result.text, schema)  # type: ignore[union-attr]
            if parsed is None:
                self._log_usage(
                    workspace_id,
                    request.task,
                    provider.name,
                    request.model,
                    0,
                    0,
                    0,
                    False,
                    "invalid",
                )
                return _Attempt(error=f"invalid output: {error}")
        assert outcome.result is not None
        self._record_success(provider.name)
        self._log_usage(
            workspace_id, request.task, provider.name, outcome.result.model,
            outcome.result.tokens_in, outcome.result.tokens_out, outcome.latency_ms, False, "ok",
        )  # fmt: skip
        return _Attempt(value=parsed, result=outcome.result)

    def _call_with_backoff(
        self, provider: Provider, request: LLMRequest, workspace_id: str | None
    ) -> _Attempt:
        last_error = ""
        delay = 0.0
        for attempt in range(MAX_HTTP_TRIES):
            started = self.clock()
            try:
                result = provider.generate(request)
            except ProviderError as exc:
                last_error = str(exc)
                self._log_usage(
                    workspace_id,
                    request.task,
                    provider.name,
                    request.model,
                    0,
                    0,
                    0,
                    False,
                    "error",
                )
                opened = self._record_failure(provider.name)
                if not exc.retryable:
                    return _Attempt(error=last_error)
                delay = min(
                    exc.retry_after
                    if exc.retry_after is not None
                    else self.settings.llm_backoff_base_sec * 2**attempt,
                    MAX_RETRY_AFTER_SEC,
                )
                if opened or attempt == MAX_HTTP_TRIES - 1:
                    break
                self.sleep(delay)
                continue
            return _Attempt(result=result, latency_ms=int((self.clock() - started) * 1000))
        return _Attempt(
            error=last_error, retry_after=max(delay, self._circuit_remaining(provider.name))
        )

    def _log_usage(
        self,
        workspace_id: str | None,
        task: str,
        provider: str,
        model: str,
        tokens_in: int,
        tokens_out: int,
        latency_ms: int,
        cache_hit: bool,
        status: str,
    ) -> None:
        try:
            with session_scope() as db:
                db.add(
                    LlmUsage(
                        workspace_id=workspace_id,
                        task=task,
                        provider=provider,
                        model=model,
                        tokens_in=tokens_in,
                        tokens_out=tokens_out,
                        latency_ms=latency_ms,
                        cache_hit=cache_hit,
                        status=status,
                    )
                )
        except Exception:
            log.exception("failed to record llm usage")


def not_configured(settings: Settings) -> AppError:
    """``LLM_NOT_CONFIGURED`` (503) with the env vars to set."""
    return AppError(
        "LLM_NOT_CONFIGURED",
        "No AI provider is configured, so nothing was generated. Set at least one of: "
        "GEMINI_API_KEY (Google AI Studio), GROQ_API_KEY (console.groq.com), "
        "OLLAMA_API_KEY (ollama.com/settings/keys) or OLLAMA_BASE_URL=http://localhost:11434 "
        "for a local Ollama server, then restart the API. For offline development only, "
        "set LLM_ALLOW_MOCK=true (output is then clearly marked as mock).",
        details={
            "env": ["GEMINI_API_KEY", "GROQ_API_KEY", "OLLAMA_API_KEY", "OLLAMA_BASE_URL"],
            "allow_mock": settings.llm_allow_mock,
        },
    )


def _parse(text: str, schema: type[T]) -> tuple[T | None, str]:
    """Parse model output (tolerating code fences) into ``schema``; returns ``(value, error)``."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.removeprefix("json").strip()
    try:
        return schema.model_validate(json.loads(cleaned)), ""
    except (json.JSONDecodeError, ValidationError) as exc:
        return None, str(exc)[:500]


_gateway: Gateway | None = None
_gateway_lock = threading.Lock()


def get_gateway() -> Gateway:
    global _gateway
    with _gateway_lock:
        if _gateway is None:
            _gateway = Gateway()
        return _gateway


def reset_gateway() -> None:
    global _gateway
    with _gateway_lock:
        _gateway = None


def run(
    task: str,
    variables: dict[str, Any],
    schema: type[T],
    workspace_id: str | None,
    images: list[bytes] | None = None,
    cache: bool = True,
) -> T:
    """Shortcut for ``get_gateway().run(...)``; use ``from app.llm import gateway as llm``."""
    return get_gateway().run(task, variables, schema, workspace_id, images, cache)


def run_with_meta(
    task: str,
    variables: dict[str, Any],
    schema: type[T],
    workspace_id: str | None,
    images: list[bytes] | None = None,
    cache: bool = True,
) -> tuple[T, LLMMeta]:
    """``(output, LLMMeta)``: use ``meta.provenance`` to attach provenance to API responses."""
    return get_gateway().run_with_meta(task, variables, schema, workspace_id, images, cache)
