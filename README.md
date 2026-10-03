# PookieBlinder_maharashtra_round
## Quick start

```bash
make setup   # venv, dependencies, .env, migrations, model download (no Docker, no cloud accounts)
# edit .env: add at least ONE free AI key (see below), then:
make dev     # API on :8000 and web on :3000 (frontend/README.md has the web app docs)
make test    # backend test suite (uses the mock provider explicitly; no keys or network)
```

### AI keys (the app runs the real pipeline; there is no silent mock)

| Provider | Free key | `.env` |
|---|---|---|
| Gemini | Google AI Studio: https://aistudio.google.com/apikey | `GEMINI_API_KEY` |
| Groq | Groq console: https://console.groq.com/keys | `GROQ_API_KEY` |
| Ollama Cloud | https://ollama.com/settings/keys | `OLLAMA_API_KEY` (model: `OLLAMA_MODEL`, default `gpt-oss:120b`) |
| Ollama local | install Ollama, `ollama pull <model>` | `OLLAMA_BASE_URL=http://localhost:11434`, `OLLAMA_MODEL=<model>` (no key) |

One key is enough. `LLM_PROVIDER_ORDER` (default `gemini,groq,ollama`) sets who is tried first.
Check them with `POST /api/v1/llm/test` or `GET /api/v1/health` (`data_mode` is `real`, `mock` or
`unconfigured`). With no provider configured, AI endpoints return `LLM_NOT_CONFIGURED` with the env
vars to set. `LLM_ALLOW_MOCK=true` is a development-only opt-in; its output is always labelled `[MOCK]`.

Real embeddings (fastembed) and local transcription (faster-whisper) download their models once:
`make models` (embedder) or `make models-asr` (plus Whisper). `make setup` runs it and continues
with a warning if you are offline; until then embeddings use a clearly flagged heuristic fallback.

See `docs/LOCAL_FIRST.md`, `docs/ARCHITECTURE.md` and `docs/BACKEND_FOUNDATION.md`.
