"""Gemini over REST (``generateContent``) in JSON mode. No SDK dependency."""

from __future__ import annotations

import base64
from typing import Any

import httpx

from app.config import Settings
from app.llm.providers.base import (
    LLMRequest,
    LLMResult,
    Provider,
    ProviderError,
    http_error,
)

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
_UNSUPPORTED_KEYS = {"title", "default", "additionalProperties", "$defs", "examples"}


def to_gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Inline ``$ref``s and drop JSON-schema keys Gemini's ``responseSchema`` rejects."""
    defs = schema.get("$defs", {})

    def convert(node: Any) -> Any:
        if isinstance(node, list):
            return [convert(n) for n in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            return convert(defs[node["$ref"].rsplit("/", 1)[-1]])
        if "anyOf" in node:
            options = [o for o in node["anyOf"] if o.get("type") != "null"]
            merged = convert(options[0]) if len(options) == 1 else {"type": "string"}
            return {**merged, "nullable": True}
        out = {k: convert(v) for k, v in node.items() if k not in _UNSUPPORTED_KEYS}
        if "properties" in out:
            out["properties"] = {k: convert(v) for k, v in node["properties"].items()}
        return out

    return convert({k: v for k, v in schema.items() if k != "$defs"})  # type: ignore[no-any-return]


class GeminiProvider(Provider):
    name = "gemini"
    supports_images = True

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self._settings = settings
        self._client = client

    def configured(self) -> bool:
        return bool(self._settings.gemini_api_key)

    def model_for(self, tier: str) -> str:
        return (
            self._settings.gemini_model_lite if tier == "lite" else self._settings.gemini_model_main
        )

    def _post(self, model: str, body: dict[str, Any]) -> httpx.Response:
        url = f"{BASE_URL}/models/{model}:generateContent"
        headers = {"x-goog-api-key": self._settings.gemini_api_key}
        timeout = self._settings.llm_timeout_sec
        try:
            if self._client is not None:
                return self._client.post(url, json=body, headers=headers, timeout=timeout)
            return httpx.post(url, json=body, headers=headers, timeout=timeout)
        except httpx.HTTPError as exc:
            raise ProviderError(f"gemini network error: {exc}", retryable=True) from exc

    def generate(self, request: LLMRequest) -> LLMResult:
        parts: list[dict[str, Any]] = [{"text": request.prompt}]
        parts += [
            {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(img).decode()}}
            for img in request.images
        ]
        config: dict[str, Any] = {
            "responseMimeType": "application/json",
            "maxOutputTokens": request.max_tokens,
            "temperature": 0.7,
        }
        body = {"contents": [{"role": "user", "parts": parts}], "generationConfig": config}
        response = self._post(request.model, {**body, "generationConfig": {
            **config, "responseSchema": to_gemini_schema(request.schema_json)}})  # fmt: skip
        if (
            response.status_code == 400
        ):  # schema subset rejected: the prompt still carries the schema
            response = self._post(request.model, body)
        if response.status_code != 200:
            raise http_error("gemini", response)
        data = response.json()
        try:
            text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("gemini returned no candidates", retryable=False) from exc
        usage = data.get("usageMetadata", {})
        return LLMResult(
            text=text,
            tokens_in=int(usage.get("promptTokenCount", 0)),
            tokens_out=int(usage.get("candidatesTokenCount", 0)),
            model=request.model,
        )
