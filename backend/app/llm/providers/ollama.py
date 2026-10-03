"""Ollama over REST (``POST /api/chat``): Ollama Cloud or a local server. No SDK dependency.

Cloud: ``OLLAMA_BASE_URL=https://ollama.com`` plus ``Authorization: Bearer OLLAMA_API_KEY``.
Local: ``OLLAMA_BASE_URL=http://localhost:11434`` and no key. Structured outputs use the ``format``
field set to the Pydantic JSON schema. Vision requests attach base64 images to the user message and
use ``OLLAMA_VISION_MODEL``.
"""

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
    json_body,
)

SYSTEM = "You are CreatorAi. Reply with a single valid JSON object only."


class OllamaProvider(Provider):
    name = "ollama"

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self._settings = settings
        self._client = client

    @property
    def supports_images(self) -> bool:  # type: ignore[override]
        return bool(self._settings.ollama_vision_model.strip())

    def configured(self) -> bool:
        """Cloud needs a key; a non-default base URL (local server) needs none."""
        return bool(self._settings.ollama_api_key) or self._settings.ollama_is_local

    def model_for(self, tier: str) -> str:
        if tier == "vision":
            return self._settings.ollama_vision_model
        return self._settings.ollama_model

    def _post(self, body: dict[str, Any]) -> httpx.Response:
        url = f"{self._settings.ollama_base_url.rstrip('/')}/api/chat"
        headers = (
            {"Authorization": f"Bearer {self._settings.ollama_api_key}"}
            if self._settings.ollama_api_key
            else {}
        )
        timeout = self._settings.llm_timeout_sec
        try:
            if self._client is not None:
                return self._client.post(url, json=body, headers=headers, timeout=timeout)
            return httpx.post(url, json=body, headers=headers, timeout=timeout)
        except httpx.HTTPError as exc:
            raise ProviderError(f"ollama network error: {exc}", retryable=True) from exc

    def generate(self, request: LLMRequest) -> LLMResult:
        user: dict[str, Any] = {"role": "user", "content": request.prompt}
        if request.images:
            user["images"] = [base64.b64encode(img).decode() for img in request.images]
        body: dict[str, Any] = {
            "model": request.model,
            "messages": [{"role": "system", "content": SYSTEM}, user],
            "stream": False,
            "format": request.schema_json,
            # Reasoning models (gpt-oss) spend part of the budget on hidden thinking tokens.
            "options": {"num_predict": request.max_tokens * 2, "temperature": 0.6},
        }
        response = self._post(body)
        if response.status_code == 400:  # schema rejected: fall back to plain JSON mode
            response = self._post({**body, "format": "json"})
        if response.status_code != 200:
            raise http_error("ollama", response)
        data = json_body("ollama", response)
        try:
            text = data["message"]["content"]
        except (KeyError, TypeError) as exc:
            raise ProviderError("ollama returned no message content") from exc
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("ollama returned an empty message")
        return LLMResult(
            text=text,
            tokens_in=int(data.get("prompt_eval_count") or 0),
            tokens_out=int(data.get("eval_count") or 0),
            model=request.model,
        )
