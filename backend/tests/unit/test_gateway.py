"""Gateway behaviour per Plan.md section 7.1 using scripted fake providers."""

from __future__ import annotations

import json
from collections.abc import Callable

import pytest
from pydantic import BaseModel
from sqlalchemy import func, select

from app.config import get_settings
from app.db import session_scope
from app.errors import AppError
from app.llm.gateway import Gateway
from app.llm.providers.base import LLMRequest, LLMResult, Provider, ProviderError
from app.llm.providers.mock import MockProvider
from app.llm.schemas import HooksOutput
from app.models import LlmCache, LlmUsage

VALID = json.dumps({"hooks": [{"text": "Hi there", "type": "question", "why": "x"}]})
VARS = {"topic": "editing", "count": 1, "tone": "witty", "platform": "shorts"}


class Fake(Provider):
    def __init__(self, name: str, script: list[object], configured: bool = True) -> None:
        self.name = name
        self.script = list(script)
        self._configured = configured
        self.calls: list[LLMRequest] = []

    def configured(self) -> bool:
        return self._configured

    def model_for(self, tier: str) -> str:
        return f"{self.name}-{tier}"

    def generate(self, request: LLMRequest) -> LLMResult:
        self.calls.append(request)
        step = self.script.pop(0) if self.script else VALID
        if isinstance(step, Exception):
            raise step
        assert isinstance(step, str)
        return LLMResult(step, 100, 20, request.model)


def gw(
    gemini: Fake | None = None,
    groq: Fake | None = None,
    *,
    mock: bool = True,
    sleeps: list[float] | None = None,
    clock: Callable[[], float] | None = None,
    **overrides: object,
) -> Gateway:
    settings = get_settings().model_copy(update={"llm_allow_mock": mock, **overrides})
    providers: dict[str, Provider] = {
        "gemini": gemini or Fake("gemini", [], configured=False),
        "groq": groq or Fake("groq", [], configured=False),
        "mock": MockProvider(),
    }
    kwargs: dict[str, object] = {"sleep": (sleeps if sleeps is not None else []).append}
    if clock:
        kwargs["clock"] = clock
    return Gateway(settings=settings, providers=providers, **kwargs)  # type: ignore[arg-type]


def run(g: Gateway, **kw: object) -> HooksOutput:
    return g.run("script.hooks", VARS, HooksOutput, None, **kw)  # type: ignore[arg-type]


def usage_rows() -> list[LlmUsage]:
    with session_scope() as db:
        return list(db.scalars(select(LlmUsage).order_by(LlmUsage.id)))


def test_primary_success_logs_usage_and_caches() -> None:
    gemini = Fake("gemini", [VALID])
    g = gw(gemini)
    assert run(g).hooks[0].text == "Hi there"
    assert gemini.calls[0].model == "gemini-lite"  # script.hooks routes to the lite tier first
    rows = usage_rows()
    assert [(r.provider, r.status, r.cache_hit, r.tokens_in) for r in rows] == [
        ("gemini", "ok", False, 100)
    ]
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(LlmCache)) == 1


def test_cache_hit_skips_provider_and_logs_cache_hit() -> None:
    gemini = Fake("gemini", [VALID, VALID])
    g = gw(gemini)
    first, second = run(g), run(g)
    assert first == second and len(gemini.calls) == 1
    assert [r.cache_hit for r in usage_rows()] == [False, True]
    g.cache.clear_memory()  # falls back to the llm_cache table
    assert run(g) == first and len(gemini.calls) == 1
    run(g, cache=False)
    assert len(gemini.calls) == 2


def test_cache_key_depends_on_prompt() -> None:
    gemini = Fake("gemini", [])
    g = gw(gemini)
    run(g)
    g.run("script.hooks", {**VARS, "topic": "cooking"}, HooksOutput, None)
    assert len(gemini.calls) == 2


def test_mock_responses_are_not_cached() -> None:
    g = gw()
    run(g)
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(LlmCache)) == 0
    assert [r.provider for r in usage_rows()] == ["mock"]


def test_repair_retry_then_success() -> None:
    gemini = Fake("gemini", ["not json at all", VALID])
    assert run(gw(gemini)).hooks
    assert len(gemini.calls) == 2
    assert "Previous output was invalid" in gemini.calls[1].prompt
    assert gemini.calls[1].prompt.startswith(gemini.calls[0].prompt)
    assert [r.status for r in usage_rows()] == ["invalid", "ok"]


def test_code_fenced_json_is_accepted() -> None:
    assert run(gw(Fake("gemini", [f"```json\n{VALID}\n```"]))).hooks


def test_invalid_twice_falls_back_to_next_provider() -> None:
    bad = json.dumps({"hooks": []})  # violates min_length
    gemini, groq = Fake("gemini", [bad, bad]), Fake("groq", [VALID])
    assert run(gw(gemini, groq)).hooks
    assert len(gemini.calls) == 2 and len(groq.calls) == 1


def test_fallback_chain_ends_in_mock() -> None:
    gemini = Fake("gemini", [ProviderError("down", status=500, retryable=True)] * 3)
    groq = Fake("groq", [ProviderError("bad key", status=401)])
    sleeps: list[float] = []
    out = run(gw(gemini, groq, sleeps=sleeps))
    assert out.hooks and len(gemini.calls) == 3 and len(groq.calls) == 1
    assert sleeps == [1.0, 2.0]  # exponential backoff 1s, 2s between the 3 tries
    assert [r.provider for r in usage_rows()][-1] == "mock"


def test_retry_after_header_is_honoured() -> None:
    gemini = Fake(
        "gemini", [ProviderError("slow down", status=429, retry_after=7, retryable=True), VALID]
    )
    sleeps: list[float] = []
    run(gw(gemini, sleeps=sleeps))
    assert sleeps == [7.0]


def test_circuit_breaker_opens_after_three_failures_for_60s() -> None:
    now = [0.0]
    gemini = Fake("gemini", [ProviderError("x", status=503, retryable=True)] * 3 + [VALID])
    g = gw(gemini, clock=lambda: now[0])
    run(g)  # 3 failures open the circuit, mock serves the request
    assert len(gemini.calls) == 3 and g._circuit_remaining("gemini") == pytest.approx(60)
    run(g, cache=False)  # circuit open: gemini is not even called
    assert len(gemini.calls) == 3
    now[0] = 61.0
    run(g, cache=False)  # circuit closed again
    assert len(gemini.calls) == 4
    assert g.status()["providers"]["gemini"]["circuit_open_sec"] == 0


def test_llm_busy_with_retry_after_when_all_fail_and_no_mock() -> None:
    gemini = Fake("gemini", [ProviderError("x", status=503, retryable=True)] * 3)
    with pytest.raises(AppError) as exc:
        run(gw(gemini, mock=False))
    err = exc.value
    assert err.code == "LLM_BUSY" and err.status == 503
    assert err.details["retry_after"] >= 1 and "Retry-After" in err.headers


def test_not_configured_when_nothing_available() -> None:
    with pytest.raises(AppError) as exc:
        run(gw(mock=False))
    assert exc.value.code == "LLM_NOT_CONFIGURED"


def test_rate_limit_exhaustion_falls_through_then_busy() -> None:
    now = [0.0]

    def sleep(seconds: float) -> None:
        now[0] += seconds

    gemini = Fake("gemini", [VALID, VALID])
    g = gw(gemini, mock=False, gemini_rpm=1, llm_queue_wait_sec=1.0, clock=lambda: now[0])
    g.limiter = type(g.limiter)(clock=lambda: now[0], sleep=sleep)
    run(g, cache=False)
    with pytest.raises(AppError) as exc:
        run(g, cache=False)  # second call within the minute cannot get a slot within 1s
    assert exc.value.code == "LLM_BUSY" and exc.value.details["retry_after"] >= 50
    assert len(gemini.calls) == 1


def test_groq_skipped_when_estimate_too_large() -> None:
    groq = Fake("groq", [VALID])
    g = gw(None, groq, groq_max_input_tokens=5)
    run(g)
    assert groq.calls == [] and usage_rows()[-1].provider == "mock"


def test_images_only_go_to_vision_providers() -> None:
    class NoVision(Fake):
        supports_images = False

    groq = NoVision("groq", [VALID])
    gemini = Fake("gemini", [])
    gemini.supports_images = True
    g = gw(gemini, groq)
    g.run("script.hooks", VARS, HooksOutput, None, images=[b"\xff\xd8img"], cache=False)
    assert groq.calls == [] and gemini.calls[0].images == [b"\xff\xd8img"]


def test_status_reports_providers_and_usage() -> None:
    g = gw(Fake("gemini", [VALID]))
    run(g)
    run(g)
    status = g.status()
    assert status["providers"]["gemini"]["configured"] is True
    assert status["providers"]["gemini"]["usage_today"]["calls"] == 2
    assert status["providers"]["groq"]["configured"] is False
    assert status["cache_hits_today"] == 1 and status["allow_mock"] is True


def test_schema_models_are_pydantic() -> None:
    assert issubclass(HooksOutput, BaseModel)
