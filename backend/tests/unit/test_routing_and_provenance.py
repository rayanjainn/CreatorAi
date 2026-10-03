"""Provider-order routing, no-silent-mock policy, run_with_meta provenance and mock markers."""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.config import get_settings
from app.errors import AppError
from app.llm.gateway import Gateway
from app.llm.providers.base import ProviderError
from app.llm.providers.mock import MOCK_MARK, MockProvider
from app.llm.schemas import TASK_SCHEMAS, HooksOutput
from app.llm.tasks import TASK_SPECS, Target, chain_for
from app.llm.types import LLMMeta
from app.schemas.common import Provenance, attach_provenance
from tests.unit.test_gateway import VALID, VARS, Fake
from tests.unit.test_llm_tasks import SAMPLES


def settings(**kw: Any) -> Any:
    return get_settings().model_copy(update=kw)


def build(
    *, gemini: Fake | None = None, groq: Fake | None = None, ollama: Fake | None = None, **kw: Any
) -> Gateway:
    providers: dict[str, Any] = {
        "gemini": gemini or Fake("gemini", [], configured=False),
        "groq": groq or Fake("groq", [], configured=False),
        "ollama": ollama or Fake("ollama", [], configured=False),
        "mock": MockProvider(),
    }
    return Gateway(settings=settings(**kw), providers=providers, sleep=lambda _: None)


def hooks(g: Gateway, **kw: Any) -> tuple[HooksOutput, LLMMeta]:
    return g.run_with_meta("script.hooks", VARS, HooksOutput, None, **kw)


# ── routing ──────────────────────────────────────────────────────────────────────────────────
def test_default_order_keeps_gemini_tiers() -> None:
    s = settings(llm_provider_order="gemini,groq,ollama", llm_allow_mock=False)
    assert chain_for("script.hooks", s) == (
        Target("gemini", "lite"),
        Target("groq", "chat"),
        Target("ollama", "main"),
        Target("gemini", "main"),  # Plan 7.1: hooks may fall back to Gemini main last
    )
    assert chain_for("director.plan", s)[0] == Target("gemini", "main")


def test_order_env_reorders_the_chain() -> None:
    s = settings(llm_provider_order="ollama,gemini", llm_allow_mock=False)
    assert [t.provider for t in chain_for("twin.chat", s)] == ["ollama", "gemini"]
    s = settings(llm_provider_order="groq", llm_allow_mock=False)
    assert chain_for("twin.chat", s) == (Target("groq", "chat"),)


def test_vision_tasks_skip_groq_and_use_ollama_vision_tier() -> None:
    s = settings(llm_provider_order="groq,ollama,gemini", llm_allow_mock=False)
    chain = chain_for("assets.caption_keyframes", s)
    assert [t.provider for t in chain] == ["ollama", "gemini", "gemini"]
    assert chain[0].tier == "vision"


def test_mock_is_last_only_when_allowed() -> None:
    assert chain_for("twin.chat", settings(llm_allow_mock=True))[-1].provider == "mock"
    assert all(t.provider != "mock" for t in chain_for("twin.chat", settings(llm_allow_mock=False)))


def test_every_task_keeps_its_token_budget() -> None:
    assert TASK_SPECS["script.generate"].max_tokens == 2500
    assert TASK_SPECS["match.disambiguate"].max_tokens == 300


def test_gateway_follows_provider_order_and_skips_unconfigured() -> None:
    ollama, gemini = Fake("ollama", [VALID]), Fake("gemini", [VALID])
    g = build(gemini=gemini, ollama=ollama, llm_provider_order="ollama,groq,gemini")
    out, meta = hooks(g)
    assert out.hooks and meta.provider == "ollama" and gemini.calls == []
    assert ollama.calls[0].model == "ollama-main"


def test_vision_request_goes_to_ollama_vision_model() -> None:
    ollama = Fake("ollama", [VALID])
    ollama.supports_images = True
    groq = Fake("groq", [VALID])
    g = build(groq=groq, ollama=ollama, llm_provider_order="groq,ollama")
    g.run_with_meta("script.hooks", VARS, HooksOutput, None, images=[b"x"], cache=False)
    assert groq.calls == [] and ollama.calls[0].model == "ollama-vision"


def test_groq_still_skipped_over_token_cap_then_next_provider() -> None:
    groq, ollama = Fake("groq", [VALID]), Fake("ollama", [VALID])
    g = build(groq=groq, ollama=ollama, llm_provider_order="groq,ollama", groq_max_input_tokens=5)
    _, meta = hooks(g)
    assert groq.calls == [] and meta.provider == "ollama"


# ── mock policy ──────────────────────────────────────────────────────────────────────────────
def test_not_configured_without_mock_lists_env_vars() -> None:
    with pytest.raises(AppError) as exc:
        hooks(build(llm_allow_mock=False))
    err = exc.value
    assert err.code == "LLM_NOT_CONFIGURED" and err.status == 503
    for name in ("GEMINI_API_KEY", "GROQ_API_KEY", "OLLAMA_API_KEY", "OLLAMA_BASE_URL"):
        assert name in err.message


def test_all_real_providers_failing_never_falls_back_to_mock() -> None:
    boom = [ProviderError("down", status=503, retryable=True)] * 3
    g = build(gemini=Fake("gemini", boom), ollama=Fake("ollama", boom), llm_allow_mock=False)
    with pytest.raises(AppError) as exc:
        hooks(g)
    assert exc.value.code == "LLM_BUSY"


def test_mock_serves_only_when_explicitly_enabled_and_is_flagged() -> None:
    boom = [ProviderError("down", status=503, retryable=True)] * 3
    g = build(gemini=Fake("gemini", boom), llm_allow_mock=True)
    out, meta = hooks(g)
    assert meta.is_mock and meta.provider == "mock" and meta.provenance.source == "mock"
    assert all(h.text.startswith(MOCK_MARK) for h in out.hooks)


# ── provenance / meta ────────────────────────────────────────────────────────────────────────
def test_run_with_meta_reports_provider_model_latency_and_cache_hit() -> None:
    gemini = Fake("gemini", [VALID])
    g = build(gemini=gemini)
    out, meta = hooks(g)
    assert (meta.provider, meta.model) == ("gemini", "gemini-lite")
    assert not meta.is_mock and not meta.cache_hit and meta.latency_ms >= 0
    assert meta.provenance == Provenance(source="ai", provider="gemini", model="gemini-lite")
    out2, meta2 = hooks(g)
    assert (
        out2 == out
        and meta2.cache_hit
        and (meta2.provider, meta2.model) == ("gemini", "gemini-lite")
    )
    assert g.run("script.hooks", VARS, HooksOutput, None) == out  # run() is a thin wrapper


def test_provenance_helpers() -> None:
    assert Provenance.demo().model_dump() == {"source": "demo", "provider": None, "model": None}
    assert Provenance.user().source == "user"
    assert Provenance.heuristic("hashing", "hashing-384").source == "heuristic"
    assert attach_provenance({"a": 1}, Provenance.demo()) == {
        "a": 1,
        "provenance": {"source": "demo", "provider": None, "model": None},
    }
    with pytest.raises(ValueError):
        Provenance(source="openai")  # type: ignore[arg-type]


@pytest.mark.parametrize("task", sorted(TASK_SCHEMAS))
def test_mock_output_is_self_evidently_mock(task: str) -> None:
    if task == "match.disambiguate":
        pytest.skip("numeric/id output only; provenance carries the flag")
    out, meta = Gateway(settings=settings(llm_allow_mock=True)).run_with_meta(
        task, SAMPLES[task], TASK_SCHEMAS[task], None
    )
    assert meta.is_mock
    assert MOCK_MARK in json.dumps(out.model_dump(mode="json")), task


def test_mock_markers_respect_word_limits() -> None:
    g = Gateway(settings=settings(llm_allow_mock=True))
    out, _ = g.run_with_meta(
        "clips.rerank_copy", SAMPLES["clips.rerank_copy"], TASK_SCHEMAS["clips.rerank_copy"], None
    )
    for c in out.clips:  # type: ignore[attr-defined]
        assert c.title.startswith(MOCK_MARK) and len(c.title) <= 70
        assert c.hook.startswith(MOCK_MARK) and len(c.hook.split()) <= 15
    hooks_out, _ = g.run_with_meta("script.hooks", SAMPLES["script.hooks"], HooksOutput, None)
    assert all(len(h.text.split()) <= 18 for h in hooks_out.hooks)


# ── status / test endpoint ───────────────────────────────────────────────────────────────────
def test_data_mode_values() -> None:
    assert build(llm_allow_mock=False).data_mode() == "unconfigured"
    assert build(llm_allow_mock=True).data_mode() == "mock"
    assert build(gemini=Fake("gemini", []), llm_allow_mock=True).data_mode() == "real"
    assert build(ollama=Fake("ollama", []), llm_allow_mock=False).data_mode() == "real"


def test_status_exposes_flags_order_and_ollama_models() -> None:
    status = build(ollama=Fake("ollama", []), llm_allow_mock=False).status()
    assert status["data_mode"] == "real" and status["provider_order"] == [
        "gemini",
        "groq",
        "ollama",
    ]
    assert status["providers"]["ollama"]["healthy"] is True
    assert status["providers"]["gemini"]["healthy"] is False
    assert status["models"]["ollama"] == "gpt-oss:120b"


def test_provider_test_roundtrip_reports_ok_latency_error_and_redacts_keys() -> None:
    secret = "SUPER-SECRET-KEY"
    ok = Fake("gemini", ['{"ok": true}'])
    bad = Fake("groq", [ProviderError(f"groq HTTP 401: invalid key {secret}", status=401)])
    g = build(gemini=ok, groq=bad, llm_allow_mock=False, groq_api_key=secret)
    res = g.test_providers()
    assert res["gemini"]["ok"] is True and res["gemini"]["latency_ms"] >= 0
    assert (
        res["groq"]["ok"] is False
        and secret not in json.dumps(res)
        and "***" in res["groq"]["error"]
    )
    assert res["ollama"] == {"configured": False, "ok": False, "latency_ms": None,
                             "model": None, "error": "not configured"}  # fmt: skip
    assert "mock" not in res
    assert "mock" in build(llm_allow_mock=True).test_providers()


def test_llm_status_and_test_endpoints(client: Any, auth: dict[str, str]) -> None:
    status = client.get("/api/v1/llm/status", headers=auth).json()
    assert status["data_mode"] == "mock" and "ollama" in status["providers"]
    res = client.post("/api/v1/llm/test", headers=auth)
    assert res.status_code == 200 and res.json()["results"]["mock"]["ok"] is True
    assert client.post("/api/v1/llm/test").status_code == 401
