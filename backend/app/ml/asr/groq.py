"""Groq Whisper over REST: ``POST /openai/v1/audio/transcriptions`` (multipart, verbose_json)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from app.config import Settings
from app.ml.asr.base import (
    ASRError,
    ASRProvider,
    Segment,
    Transcript,
    Word,
    interpolate_words,
)

URL = "https://api.groq.com/openai/v1/audio/transcriptions"
TIMEOUT_SEC = 120.0


class GroqASR(ASRProvider):
    name = "groq"

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self._settings = settings
        self._client = client

    def configured(self) -> bool:
        return bool(self._settings.groq_api_key)

    @property
    def model(self) -> str:
        return self._settings.groq_whisper_model

    def transcribe(
        self, audio_path: Path, *, language: str | None = None, offset_sec: float = 0.0
    ) -> Transcript:
        # httpx multipart: a list value repeats the field (timestamp_granularities[]=word&...).
        data: dict[str, str | list[str]] = {
            "model": self.model,
            "response_format": "verbose_json",
            "timestamp_granularities[]": ["word", "segment"],
            "temperature": "0",
        }
        language = language if language is not None else self._settings.asr_language
        if language and language != "auto":
            data["language"] = language
        headers = {"Authorization": f"Bearer {self._settings.groq_api_key}"}
        try:
            with audio_path.open("rb") as fh:
                files = {"file": (audio_path.name, fh, "application/octet-stream")}
                if self._client is not None:
                    response = self._client.post(
                        URL, data=data, files=files, headers=headers, timeout=TIMEOUT_SEC
                    )
                else:
                    response = httpx.post(
                        URL, data=data, files=files, headers=headers, timeout=TIMEOUT_SEC
                    )
        except httpx.HTTPError as exc:
            raise ASRError(f"groq whisper network error: {exc}", retryable=True) from exc
        if response.status_code != 200:
            raise _http_error(response)
        try:
            body = response.json()
        except ValueError as exc:
            raise ASRError("groq whisper returned a non-JSON body") from exc
        return parse_verbose_json(body, self.model, offset_sec)


def parse_verbose_json(body: dict[str, Any], model: str, offset: float = 0.0) -> Transcript:
    """Turn a ``verbose_json`` response into a :class:`Transcript`, applying ``offset``."""
    segments = [
        Segment(str(s.get("text", "")), float(s["start"]) + offset, float(s["end"]) + offset)
        for s in body.get("segments") or []
    ]
    words = [
        Word(str(w["word"]), float(w["start"]) + offset, float(w["end"]) + offset)
        for w in body.get("words") or []
    ]
    estimated = False
    if not words and segments:
        words, estimated = interpolate_words(segments), True
    if not segments and body.get("text"):
        end = float(body.get("duration") or 0.0) + offset
        segments = [Segment(str(body["text"]).strip(), offset, end)]
    return Transcript(
        provider="groq",
        model=model,
        language=body.get("language"),
        words=words,
        segments=segments,
        duration=float(body.get("duration") or 0.0),
        words_estimated=estimated,
    )


def _http_error(response: httpx.Response) -> ASRError:
    retry_after: float | None = None
    try:
        retry_after = float(response.headers.get("retry-after", ""))
    except ValueError:
        retry_after = None
    return ASRError(
        f"groq whisper HTTP {response.status_code}: {response.text[:200]}",
        status=response.status_code,
        retry_after=retry_after,
        retryable=response.status_code == 429 or response.status_code >= 500,
    )
