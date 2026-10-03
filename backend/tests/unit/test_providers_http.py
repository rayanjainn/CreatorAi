"""Real HTTP providers against recorded/fake transports (never the network)."""

from __future__ import annotations

import base64
import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.llm.providers.base import LLMRequest, ProviderError
from app.llm.providers.gemini import GeminiProvider
from app.llm.providers.groq import GroqProvider
from app.llm.providers.ollama import OllamaProvider
from app.llm.schemas import HooksOutput

SCHEMA = HooksOutput.model_json_schema()
HOOKS = json.dumps({"hooks": [{"text": "Hi", "type": "question", "why": "x"}]})


def settings(tmp_path: Any, **kw: Any) -> Settings:
    return Settings(DATA_DIR=str(tmp_path), _env_file=None, **kw)  # type: ignore[call-arg]


def client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def req(model: str = "m", images: list[bytes] | None = None) -> LLMRequest:
    return LLMRequest("script.hooks", "prompt", SCHEMA, 100, model, images=images or [])


# ── Ollama ───────────────────────────────────────────────────────────────────────────────────
def ollama_ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "model": "gpt-oss:120b",
            "message": {"role": "assistant", "content": HOOKS},
            "prompt_eval_count": 12,
            "eval_count": 7,
        },
    )


def test_ollama_cloud_request_shape_and_structured_output(tmp_path: Any) -> None:
    seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return ollama_ok(r)

    p = OllamaProvider(settings(tmp_path, OLLAMA_API_KEY="k-secret"), client(handler))
    assert p.configured() and p.model_for("main") == "gpt-oss:120b"
    result = p.generate(req("gpt-oss:120b"))
    r = seen[0]
    assert str(r.url) == "https://ollama.com/api/chat"
    assert r.headers["authorization"] == "Bearer k-secret"
    body = json.loads(r.content)
    assert body["stream"] is False and body["model"] == "gpt-oss:120b"
    assert body["format"] == SCHEMA  # structured outputs: the Pydantic JSON schema
    assert body["options"]["num_predict"] >= 100 and "temperature" in body["options"]
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    assert (result.text, result.tokens_in, result.tokens_out) == (HOOKS, 12, 7)


def test_ollama_local_needs_no_key_and_sends_no_auth(tmp_path: Any) -> None:
    seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return ollama_ok(r)

    p = OllamaProvider(
        settings(tmp_path, OLLAMA_BASE_URL="http://localhost:11434/"), client(handler)
    )
    assert p.configured()
    p.generate(req())
    assert str(seen[0].url) == "http://localhost:11434/api/chat"
    assert "authorization" not in seen[0].headers


def test_ollama_cloud_without_key_is_not_configured(tmp_path: Any) -> None:
    assert not OllamaProvider(settings(tmp_path)).configured()


def test_ollama_vision_images_are_base64_and_model_is_vision(tmp_path: Any) -> None:
    seen: list[dict[str, Any]] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(json.loads(r.content))
        return ollama_ok(r)

    p = OllamaProvider(
        settings(tmp_path, OLLAMA_API_KEY="k", OLLAMA_VISION_MODEL="vlm:1"), client(handler)
    )
    assert p.supports_images and p.model_for("vision") == "vlm:1"
    p.generate(req("vlm:1", images=[b"\xff\xd8abc"]))
    assert seen[0]["messages"][1]["images"] == [base64.b64encode(b"\xff\xd8abc").decode()]
    no_vision = OllamaProvider(settings(tmp_path, OLLAMA_API_KEY="k", OLLAMA_VISION_MODEL=""))
    assert not no_vision.supports_images


def test_ollama_schema_rejected_falls_back_to_json_mode(tmp_path: Any) -> None:
    formats: list[Any] = []

    def handler(r: httpx.Request) -> httpx.Response:
        fmt = json.loads(r.content)["format"]
        formats.append(fmt)
        return httpx.Response(400, text="bad format") if fmt != "json" else ollama_ok(r)

    p = OllamaProvider(settings(tmp_path, OLLAMA_API_KEY="k"), client(handler))
    assert p.generate(req()).text == HOOKS
    assert formats[0] == SCHEMA and formats[1] == "json"


@pytest.mark.parametrize(
    ("status", "retryable"), [(429, True), (500, True), (503, True), (401, False), (404, False)]
)
def test_ollama_error_mapping(tmp_path: Any, status: int, retryable: bool) -> None:
    def handler(r: httpx.Request) -> httpx.Response:
        return httpx.Response(status, headers={"retry-after": "4"}, text="nope")

    p = OllamaProvider(settings(tmp_path, OLLAMA_API_KEY="k"), client(handler))
    with pytest.raises(ProviderError) as exc:
        p.generate(req())
    assert exc.value.status == status and exc.value.retryable is retryable
    assert exc.value.retry_after == 4.0


def test_ollama_invalid_body_and_network_errors(tmp_path: Any) -> None:
    s = settings(tmp_path, OLLAMA_API_KEY="k")
    bad = OllamaProvider(s, client(lambda r: httpx.Response(200, text="<html>")))
    with pytest.raises(ProviderError, match="non-JSON") as exc:
        bad.generate(req())
    assert not exc.value.retryable
    empty = OllamaProvider(
        s, client(lambda r: httpx.Response(200, json={"message": {"content": ""}}))
    )
    with pytest.raises(ProviderError, match="empty"):
        empty.generate(req())

    def boom(r: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with pytest.raises(ProviderError) as net:
        OllamaProvider(s, client(boom)).generate(req())
    assert net.value.retryable


# ── Groq / Gemini error mapping and invalid JSON ─────────────────────────────────────────────
def groq(tmp_path: Any, handler: Callable[[httpx.Request], httpx.Response]) -> GroqProvider:
    return GroqProvider(settings(tmp_path, GROQ_API_KEY="gk"), client(handler))


def gemini(tmp_path: Any, handler: Callable[[httpx.Request], httpx.Response]) -> GeminiProvider:
    return GeminiProvider(settings(tmp_path, GEMINI_API_KEY="ak"), client(handler))


def test_groq_request_shape_and_success(tmp_path: Any) -> None:
    seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": HOOKS}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 3},
            },
        )

    result = groq(tmp_path, handler).generate(req("llama"))
    r = seen[0]
    assert str(r.url) == "https://api.groq.com/openai/v1/chat/completions"
    assert r.headers["authorization"] == "Bearer gk"
    assert json.loads(r.content)["response_format"] == {"type": "json_object"}
    assert (result.tokens_in, result.tokens_out) == (5, 3)


@pytest.mark.parametrize(
    ("make", "status", "retryable"),
    [(groq, 429, True), (groq, 502, True), (groq, 401, False), (gemini, 429, True),
     (gemini, 500, True), (gemini, 403, False)],
)  # fmt: skip
def test_groq_gemini_error_mapping(tmp_path: Any, make: Any, status: int, retryable: bool) -> None:
    p = make(tmp_path, lambda r: httpx.Response(status, text="err"))
    with pytest.raises(ProviderError) as exc:
        p.generate(req())
    assert exc.value.status == status and exc.value.retryable is retryable


@pytest.mark.parametrize("make", [groq, gemini])
def test_groq_gemini_non_json_200_is_a_provider_error(tmp_path: Any, make: Any) -> None:
    p = make(tmp_path, lambda r: httpx.Response(200, text="not json"))
    with pytest.raises(ProviderError, match="non-JSON"):
        p.generate(req())


def test_gemini_request_shape_images_and_schema_fallback(tmp_path: Any) -> None:
    bodies: list[dict[str, Any]] = []

    def handler(r: httpx.Request) -> httpx.Response:
        assert r.headers["x-goog-api-key"] == "ak" and "key=" not in str(r.url)
        assert str(r.url).endswith("/models/gem-main:generateContent")
        body = json.loads(r.content)
        bodies.append(body)
        if "responseSchema" in body["generationConfig"]:
            return httpx.Response(400, text="schema subset")
        return httpx.Response(
            200,
            json={
                "candidates": [{"content": {"parts": [{"text": HOOKS}]}}],
                "usageMetadata": {"promptTokenCount": 9, "candidatesTokenCount": 4},
            },
        )

    result = gemini(tmp_path, handler).generate(req("gem-main", images=[b"img"]))
    assert result.text == HOOKS and result.tokens_in == 9
    parts = bodies[0]["contents"][0]["parts"]
    assert parts[1]["inline_data"]["data"] == base64.b64encode(b"img").decode()
    assert bodies[0]["generationConfig"]["responseMimeType"] == "application/json"
    assert "responseSchema" not in bodies[1]["generationConfig"]


def test_gemini_no_candidates(tmp_path: Any) -> None:
    p = gemini(tmp_path, lambda r: httpx.Response(200, json={"candidates": []}))
    with pytest.raises(ProviderError, match="no candidates"):
        p.generate(req())
