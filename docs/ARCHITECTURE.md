# Architecture (local-first)

CreatorAi runs as **two processes** on one machine: a FastAPI API on :8000 and the Next.js web app on
:3000. Everything else (database, queue, vectors, media) lives inside the API process or under `data/`.
`docs/LOCAL_FIRST.md` lists what replaced Postgres, Redis, Supabase and Docker.

```
┌──────────────────────── Browser (Next.js :3000) ────────────────────────┐
│  REST + Bearer JWT          SSE /jobs/{id}/events        <video> /media  │
└──────────┬───────────────────────────┬──────────────────────────┬───────┘
           ▼                           ▲                          ▲
┌───────────────────────── FastAPI process (:8000) ───────────────┴───────┐
│ api/v1 routers ──► services ──► repositories ──► SQLite (WAL)             │
│   (no SQL)        (no FastAPI)   (workspace_id)   data/creatorai.db       │
│                                                                           │
│ enqueue() ──► JobRunner ── ThreadPool media(1) / llm(2) / io(1)           │
│                  │  jobs table = source of truth      │ handlers          │
│                  └─► PubSub (in-memory, last-event replay) ─► SSE         │
│                                                                           │
│ llm.gateway.run() ─► cache ─► rate limit ─► Gemini / Groq ─► mock         │
│ ml.embedder (MiniLM or hashing) + ml.vectors (numpy cosine over BLOBs)    │
│ media.ffmpeg (run/probe)   storage.LocalStorage   /media Range route      │
│ workers.scheduler (nightly Timer, callbacks registered by modules)        │
└───────────────────────────────────────────────────────────────────────────┘
             data/  creatorai.db  media/{workspace}/{asset}/…  renders/  tmp/  .secret
```

## Module map (`backend/app`)

| Module | Responsibility |
|---|---|
| `config.py` | `Settings` (pydantic-settings) loading `<repo>/.env`; every tunable; auto-persisted `APP_SECRET` in `data/.secret` |
| `db.py` | SQLite engine (WAL, `foreign_keys=ON`, `busy_timeout`), `get_session_factory()`, `session_scope()`, `migrate()` |
| `models/` | SQLAlchemy models mirroring `migrations/001_init.sql` one-to-one (never `create_all`) |
| `errors.py` | `AppError(code, message, status, details)`, handlers producing `{error:{code,message,details}}` |
| `deps.py` | `DbDep`, `CtxDep` (`Ctx(user_id, workspace_id)`), `PageDep` |
| `security.py` | scrypt passwords, HS256 JWT, signed media URLs, Fernet token crypto |
| `api/v1/` | HTTP layer. `__init__.py` lists router modules; `media.py` is mounted at `/media` |
| `services/` | Use-cases, plain Python (`accounts.py` today) |
| `repositories/` | Workspace-scoped queries (`base.py` pattern) |
| `workers/` | `runner.py` (pools, registry, `enqueue`), `pubsub.py`, `events.py`, `scheduler.py` |
| `llm/` | `gateway.py`, `tasks.py` (routes), `schemas.py`, `prompts/*.md`, `providers/`, `ratelimit.py`, `cache.py`, `context.py` |
| `ml/` | `embedder.py` (auto backend), `vectors.py` (pack/unpack/top-k) |
| `media/ffmpeg.py` | `run()` with progress/timeout, `probe()`, availability check |
| `storage/` | `StorageBackend` interface and `LocalStorage` rooted at `DATA_DIR` |

## Request flow

1. Browser calls `/api/v1/...` with `Authorization: Bearer <jwt>` (GET requests may use `?access_token=`
   because `EventSource` cannot set headers).
2. `get_ctx` verifies the JWT, confirms the user and workspace exist and yields `Ctx`.
3. The router calls a service; the service uses repositories (`workspace_id` is always the first argument).
4. `DbDep` commits when the handler returns and **before the response is sent** (`scope="function"`).
5. `AppError` (or validation / HTTP errors) become `{ "error": { "code", "message", "details" } }`.

## Job flow

1. A router or job calls `enqueue("asset.process", "asset", asset_id, {...}, workspace_id=...)`.
2. The runner inserts a `jobs` row (`queued`, payload stored for retries), publishes the first event and
   submits the handler to the pool for its queue (`media`, `llm` or `io`).
3. The handler gets a `JobContext`. `ctx.progress(pct, stage, msg)` writes the row, publishes the event
   and acts as a cancellation checkpoint (`JobCanceled`).
4. Failure: re-queued after `JOB_RETRY_BACKOFF` seconds up to `JOB_MAX_RETRIES` (2), then `failed`.
5. `GET /jobs/{id}/events` replays the latest event, streams updates (keepalive every 15 s) and ends with
   `event: done`. On boot, jobs left `queued`/`running` become `failed` ("interrupted by restart") and can
   be retried with `POST /jobs/{id}/retry`.
6. `JOBS_INLINE=true` runs jobs synchronously on the calling thread (used by tests).

## LLM flow

`llm.run(task, variables, schema, workspace_id, images=None, cache=True)` renders `prompts/<task>.md`
with the creator context, checks the cache (mock answers are never cached), then walks the chain
(`Gemini -> Groq -> mock` per `tasks.py`) applying rate limits, JSON validation with one repair retry,
429/5xx backoff and a 60 s circuit breaker. If everything fails it raises `LLM_BUSY` (503, `retry_after`).
Without any key the deterministic `mock` provider answers, so the product works offline.

## Data layout

```
data/
  creatorai.db            SQLite (+ -wal/-shm)
  .secret                 generated APP_SECRET (chmod 600)
  media/{workspace_id}/{asset_id}/original.<ext>, proxy.mp4, thumb.jpg, audio/, keyframes/
  renders/{render_id}.mp4 / .jpg
  tmp/                    uploads in progress, scratch files
```

Storage keys are relative (`media/{workspace}/{asset}/proxy.mp4`). The browser never sees paths; the API
returns `sign_media(key)` URLs of the form `/media/{key}?exp=&sig=` (HMAC-SHA256, 1 h) which the media
route serves with full HTTP Range support.

## Database notes

- Schema lives in `backend/migrations/*.sql` (SQLite dialect) and is applied at startup by `app.db.migrate()`
  or manually with `make migrate`. Deviations from Plan.md section 5: `jobs.payload` and `jobs.attempts`
  columns (needed for retries); `users` table and `workspaces.owner_id -> users(id)`.
- Embeddings are little-endian float32 BLOBs; search is brute-force cosine in numpy (`ml/vectors.py`).
- `asset_segments_fts` is an external-content FTS5 table kept in sync by triggers. After a `VACUUM`, run
  `insert into asset_segments_fts(asset_segments_fts) values('rebuild');`.
