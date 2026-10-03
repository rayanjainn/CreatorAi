"""Groq chat completions (OpenAI-compatible REST) in JSON-object mode."""

from __future__ import annotations

import httpx

from app.config import Settings
from app.llm.providers.base import LLMRequest, LLMResult, Provider, ProviderError, http_error

URL = "https://api.groq.com/openai/v1/chat/completions"
SYSTEM = "You are CreatorAi. Reply with a single valid JSON object only."


class GroqProvider(Provider):
    name = "groq"

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self._settings = settings
        self._client = client

    def configured(self) -> bool:
        return bool(self._settings.groq_api_key)

    def model_for(self, tier: str) -> str:
        return self._settings.groq_chat_model

    def generate(self, request: LLMRequest) -> LLMResult:
        body = {
            "model": request.model,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": request.prompt},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": request.max_tokens,
            "temperature": 0.5,
        }
        headers = {"Authorization": f"Bearer {self._settings.groq_api_key}"}
        timeout = self._settings.llm_timeout_sec
        try:
            if self._client is not None:
                response = self._client.post(URL, json=body, headers=headers, timeout=timeout)
            else:
                response = httpx.post(URL, json=body, headers=headers, timeout=timeout)
        except httpx.HTTPError as exc:
            raise ProviderError(f"groq network error: {exc}", retryable=True) from exc
        if response.status_code != 200:
            raise http_error("groq", response)
        data = response.json()
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("groq returned no choices") from exc
        usage = data.get("usage", {})
        return LLMResult(
            text=text,
            tokens_in=int(usage.get("prompt_tokens", 0)),
            tokens_out=int(usage.get("completion_tokens", 0)),
            model=request.model,
        )
