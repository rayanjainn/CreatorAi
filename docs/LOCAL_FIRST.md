# Local-first decisions (override `Plan.md` where they differ)

`Plan.md` is the product/feature reference (schema shape, JSON contracts, pipelines, thresholds).
**This file overrides it for infrastructure.** Goal: a teammate clones the repo and is running in
under 5 minutes with **no Docker, no Redis, no Postgres and no cloud accounts**. The only thing
a teammate adds is **one free AI key** (Gemini, Groq or Ollama): the app runs the real AI pipeline by default
(see *Real AI by default* below).

## What changed vs Plan.md

| Plan.md | Local-first replacement | Notes |
|---|---|---|
| Docker compose, 7 processes | `make setup` + `make dev` → **2 processes** (API on :8000, web on :3000) | no containers anywhere |
| Supabase Postgres + pgvector, async SQLAlchemy | **SQLite** (WAL) file `data/creatorai.db`, **sync** SQLAlchemy 2 | SQL migrations stay the source of truth (`backend/migrations/*.sql`, SQLite dialect) |
| `uuid` columns | `TEXT` holding uuid4 strings | generated in Python (`new_id()`) |
| `jsonb` / `text[]` / `int[]` | `TEXT` holding JSON (`JSON` type in SQLAlchemy) | arrays are JSON lists |
| `timestamptz` | `TEXT` ISO-8601 UTC (`2026-10-03T12:00:00Z`) | helper `utcnow()` ; `updated_at` maintained by SQLAlchemy `onupdate` (no triggers) |
| `vector(384)` + HNSW | `BLOB` of little-endian float32 (L2-normalised) + **numpy brute-force cosine** | fine for single-creator scale; `ml/vectors.py` owns pack/unpack/top-k |
| `tsvector` + GIN | **SQLite FTS5** virtual table `asset_segments_fts` (kept in sync by SQL triggers) | |
| Redis + RQ (3 queues), Redis pub/sub, scheduler | **In-process job runner**: 3 `ThreadPoolExecutor`s (`media`=1, `llm`=2, `io`=1) + in-memory pub/sub for SSE + `threading.Event` cancel flags | `jobs` table remains source of truth. On boot, jobs left `queued/running` are marked `failed` ("interrupted by restart", retryable). Nightly sync = a lightweight `threading.Timer` loop in the API process |
| Redis rate limiter | In-process sliding-window limiter (same defaults) | |
| Supabase Auth | **Local auth**: email+password in `users` table (scrypt hash), HS256 JWT (PyJWT) | single creator; sign-up allowed only while no user exists. "Continue with Google" renders disabled (tooltip: "Not available in local mode") |
| Supabase pooler notes | n/a | |
| Gemini / Groq mandatory | **At least one real provider is required: Gemini, Groq or Ollama (cloud or local).** Chain order = `LLM_PROVIDER_ORDER` (default `gemini,groq,ollama`), unconfigured providers skipped. No OpenAI, no Anthropic. The deterministic **`mock` provider** exists only behind `LLM_ALLOW_MOCK=true` (default **false**) | with no provider and mock off, AI endpoints return `LLM_NOT_CONFIGURED` (503) naming the env vars. Mock is never a silent fallback |
| Groq Whisper mandatory | Transcription chain: **sidecar transcript** (`<file>.words.json`/`.srt`/`.vtt`, or uploaded via API) → Groq Whisper (if key) → local `faster-whisper` (core dependency; model downloaded by `make models-asr` / first use) → clear `ASR_UNAVAILABLE` failure at the `transcribe` stage. Chain: `ml.asr.get_asr_chain()` | demo/test footage ships with a sidecar so the pipeline is fully demoable offline |
| sentence-transformers mandatory | `EMBED_BACKEND=auto`: **`fastembed`** (ONNX MiniLM, core dependency, no torch) → `sentence-transformers` if installed → **hashing embedder** as a *flagged heuristic fallback only* (loud WARNING once, `embedder.real=false`, provenance `heuristic`) | all return L2-normalised 384-d float32. `make models` preloads the model (needs internet once; `make setup` runs it non-fatally). Thresholds (`MATCH_OK`, `MATCH_WEAK`) are **per-backend** in config |
| YouTube OAuth | Implemented as in plan but **optional**: needs `GOOGLE_CLIENT_ID/SECRET`. Without them `/youtube/*` returns `NO_YOUTUBE_CONNECTION` and the UI shows a "Connect YouTube" help card. Insights run on **seeded demo data** (`is_seed=true`) | refresh tokens Fernet-encrypted with `APP_SECRET`-derived key |
| §7.4 Token budget | **Not built.** It is a planning estimate only. Kept in Plan.md for reference | |

Everything else in Plan.md (ids, seconds as floats, status enums, JSON contracts §6, pipelines §8,
error codes §6.10, presets, render graph, sponsor/twin/insights logic) is **unchanged and binding**.

## Real AI by default (binding product rule)

- The app runs the **real** pipeline. Supported LLMs: **Gemini, Groq, Ollama** (Ollama Cloud with
  `OLLAMA_API_KEY`, or a local server with `OLLAMA_BASE_URL=http://localhost:11434`). Free keys:
  Google AI Studio (aistudio.google.com/apikey), Groq console (console.groq.com/keys),
  ollama.com/settings/keys. No OpenAI, no Anthropic API anywhere.
- **Mock is explicit opt-in** (`LLM_ALLOW_MOCK=true`, dev/test only) and is never silent: results carry
  `provenance.source="mock"`, mock text carries a `[MOCK]` marker, and `/health` + `/llm/status` report
  `data_mode` = `real` | `mock` | `unconfigured`.
- **Everything that is not a real model result is labelled**: `heuristic` (hashing embedder, rule-based
  scoring), `demo` (anything seeded: `is_seed=true` rows from `make seed`, e.g. demo YouTube metrics),
  `user` (typed by the user). Seeded data is *always* `source: "demo"`.
- Verify keys with `POST /api/v1/llm/test` (one tiny real round-trip per configured provider).

## Layout

Same as Plan.md §4 with these edits: no `Dockerfile`/`docker-compose.yml`/`workers/queues.py` redis bits;
add `backend/app/workers/runner.py` (thread pools), `backend/app/workers/pubsub.py`, `backend/app/ml/vectors.py`,
`backend/app/ml/asr/` (providers), `scripts/dev.py` (start both servers), `docs/`.

```
creatorai/
├── Makefile  .env.example  README.md  Plan.md
├── docs/            LOCAL_FIRST.md  UI_SPEC.md  ARCHITECTURE.md  API.md  HANDOFF.md  RUNBOOK.md ...
├── scripts/dev.py   # cross-platform "run everything" (used by make dev)
├── backend/         FastAPI + SQLite + workers (python 3.11+)
├── frontend/        Next.js 14 App Router + Tailwind + TanStack Query + Zustand
└── data/            (git-ignored) creatorai.db, media/, renders/, tmp/
```

## Dev experience contract (every agent must keep this true)

1. `make setup` – creates `backend/.venv`, installs backend deps, `npm ci` in frontend, copies `.env.example` → `.env`, runs migrations.
2. `make seed` – demo user `demo@creatorai.local` / `demo1234`, demo profile, board cards, seed YouTube videos + metrics, twin memories, a **hero project** with generated footage + sidecar transcript + script.
3. `make dev` – API (reload) + web together; prints URLs. Ctrl-C stops both.
4. `make test` – backend pytest + frontend typecheck/lint/tests.
5. After `make setup` (+ `make models`) the only network use is the chosen LLM provider (and optional YouTube/Groq ASR). Model downloads happen once, in `make models`.
6. Missing config (no AI key, offline model download) must produce a clear, actionable message, never a stack trace and never silently fake data.

## Conventions recap

- Python 3.11+, type hints, Ruff (lint+format). Services never import FastAPI; routers never touch SQL; **every repository query takes `workspace_id`**.
- Errors: `AppError(code, status, message, details)` → `{ "error": { code, message, details } }`.
- API base `/api/v1`; media at `/media/{key}?exp&sig` with HTTP Range.
- Frontend: TypeScript strict; types generated from OpenAPI (`npm run gen:api`, output committed).
- Commits: small, descriptive; author/committer = `Rayan Jain <rayansjain@gmail.com>`.
- Every module ships with tests; the full suite must stay green on `main`.
- Update `docs/` in the same commit as behaviour changes.
