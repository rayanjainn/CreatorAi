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
│ llm.gateway.run_with_meta() ─► cache ─► rate limit ─► Gemini/Groq/Ollama  │
│ ml.embedder (fastembed MiniLM; hashing = flagged fallback) + ml.vectors   │
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
| `repositories/` | Workspace-scoped queries (`base.py` pattern) |
| `workers/` | `runner.py` (pools, registry, `enqueue`), `pubsub.py`, `events.py`, `scheduler.py` |
| `llm/` | `gateway.py`, `tasks.py` (routes), `schemas.py`, `prompts/*.md`, `providers/`, `ratelimit.py`, `cache.py`, `context.py` |
| `ml/` | `embedder.py` (auto backend), `vectors.py` (pack/unpack/top-k), `models.py` (model preload), `asr/` (providers), `transcripts.py` (sidecars), `segments.py`, `shots.py`, `silence.py`, `energy.py`, `alignment.py` (matching DP), `scoring.py` (clip windows), `faces.py` (Haar reframing), `hooks.py`, `review_metrics.py` |
| `media/` | `ffmpeg.py` (`run()` with progress + cancel, `probe()`), `audio.py` (extract, chunk planning), `frames.py` (proxy, thumb, keyframes), `kinds.py` (kind detection); render: `presets.py`, `captions_ass.py`, `cards.py`, `fonts.py`, `render_graph.py` |
| `services/` | Use-cases, plain Python, no FastAPI: `accounts.py`, `assets.py`, `uploads.py`, `search_service.py`, `hooks.py`, `ingest/` (the `asset.process` stages), plus the content, script, Director, match, clip, timeline, edit and render services described below |
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

`llm.run_with_meta(task, variables, schema, workspace_id, images=None, cache=True)` (and the thin
`llm.run`) renders `prompts/<task>.md` with the creator context, checks the cache, then walks the chain
built from `LLM_PROVIDER_ORDER` (default `gemini,groq,ollama`, see `tasks.py`) applying rate limits, JSON
validation with one repair retry, 429/5xx backoff and a 60 s circuit breaker. If every configured
provider fails it raises `LLM_BUSY` (503, `retry_after`); with none configured it raises
`LLM_NOT_CONFIGURED` (503). The `mock` provider joins the chain only when `LLM_ALLOW_MOCK=true`
(never the default, never cached, always flagged). Each result carries `LLMMeta` (provider, model,
is_mock, cache_hit, latency) which becomes the response `provenance`.

## Asset ingest pipeline

`POST /uploads/.../complete` (or `POST /assets/upload`) stores the file at
`media/{ws}/{asset}/original.<ext>`, dedupes by sha256 and enqueues `asset.process` (queue `media`).
`workers/tasks/asset_process.py` is a thin handler over `services/ingest/pipeline.py`, which runs the
stages of Plan.md 3.3 / 8.1 in order and reports the cumulative progress of the plan
(probe 5, audio 15, proxy 30, silence 38, transcribe 60, segments 66, shots 72, keyframes 78,
caption 88, embed 97, finalize 100):

```
probe -> audio -> proxy -> silence(+energy) -> transcribe -> segments -> shots -> keyframes -> caption -> embed -> finalize
```

- **Kinds**: video = all stages; audio-only skips proxy/shots/keyframes/caption; image = probe, keyframes
  (thumb + one shot), caption, embed; documents = probe (text of `.txt`/`.md` goes to `analysis.text`) and
  finalize. A video without an audio track skips the audio and ASR stages.
- **Checkpoints**: after each stage the stage name is appended to `assets.analysis.stages_done` in the same
  transaction as its output. A stage runs when it is missing; running a stage invalidates every later one.
  Retries, `POST /assets/{id}/reprocess` and "attach transcript" therefore resume instead of restarting.
  A skipped stage is recorded as a note such as `"caption: skipped (llm unavailable)"` (not as done), so a
  plain reprocess retries it. Cancel is checked between stages (and inside long loops); failure sets
  `status='failed'`, `error`, `analysis.failed_stage`, `analysis.error_code`.
- **Transcription**: sidecar (`user`/`demo`) -> Groq Whisper -> local faster-whisper -> `ASR_UNAVAILABLE`
  (not retried). Audio is cut into ~600 s chunks at silences (+-30 s), word times are re-based by the chunk
  offset, each chunk retries 429/5xx up to `ASR_MAX_TRIES` and falls through to the next provider.
- **Captions**: one `assets.caption_keyframes` call (<= 12 keyframes + nearest transcript line); the other
  shots inherit tags from the nearest captioned shot. With no LLM the asset still becomes `ready`; the
  stage is skipped with a `CAPTIONS_UNAVAILABLE` warning and no provenance (nothing is fabricated).
- **Embeddings**: segments and `caption + ". " + tags` of shots; `analysis.embedder` records backend and
  model, and a changed backend re-embeds on the next reprocess (`POST /search/reindex` for the library).
- **Provenance per stage** lives in `analysis.provenance` (`transcribe`, `caption`, `embed`, `shots`);
  the asset-level `provenance` is the weakest of transcribe/caption/embed.
- **Finalize** sets `ready` and calls `services.hooks.run_after_asset_ready`. The default hook enqueues
  `project.match` when the content item has a current script and all its assets are ready, but only if that
  job type is registered. Other features subscribe with `hooks.register_after_asset_ready(fn)`.

Search (`services/search_service.py`) caches per-workspace numpy matrices of segment and shot embeddings
(invalidated by `search_service.invalidate(ws)` on every write), fuses vector and FTS5 ranks with RRF
(k = 60) and merges hits within 8 s. See `docs/API.md`.

## Content workflow (board, scripts, Director)

```
idea ──► script ──► shoot ──► edit ──► review ──► published        (board columns, content_items.stage)
 │         │          ▲
 │         │          └─ approve: POST /scripts/{id}/approve  or  move to shoot  ──► twin_events.emit
 │         └─ hooks (script.hooks) ► generate (script.generate) ► scene tools / PATCH ► meta (script.meta)
 └─ Director plan (director.plan) ─ structure feeds script.generate; Director review (director.review) needs footage
```

* `services/content_service.py` owns ordering (`move_item` renumbers both columns 0..n-1 inside the request
  transaction), stage rules, cascade delete and idea suggestions. `services/activity.py` appends
  `activity_log` rows.
* `services/script_service.py` owns versions (`scripts.is_current`, a partial unique index), the hook rule,
  `script_beats` sync with embeddings, per-part provenance and the scene tools. Pure helpers
  (`split_beats`, `normalize_scenes`, `ensure_hook`, `word_count_check`) are unit-tested.
* `services/director_service.py` loads the domain template, post-processes plans (`fix_durations`,
  `fit_shot_list`), exports CSV/Markdown and builds reviews. `ml/review_metrics.py` is the pure Plan 8.7
  implementation; `ml/hooks.py` is Plan 8.6.
* **LLM before writes**: every handler reads, calls the gateway, then writes, so the request transaction never
  holds SQLite's writer lock while the gateway logs its own usage row.
* **Twin approval events**: `services/twin_events.py` is a tiny registry. The workflow *emits*
  `script_approved` (payload `{content_item_id, script_id, version, title}`) when an item moves to `shoot`; the
  Twin feature *registers* a listener (`twin_events.register("script_approved", fn)`, signature
  `fn(event, workspace_id, payload)`). Delivery happens **after the request's commit** (so a listener may open
  its own session and write) and a failing listener is logged, never raised. Nothing is registered by default.
  The Twin agent should call `register` from its own module's import / startup code and count the approval
  (Plan 8.11); `GET /activity?action=script_approved` shows the history.
* New LLM tasks: `content.ideas`, `script.regenerate_scene`, `script.tighten` (see `llm/tasks.py`).

## Matching, clips and timelines

**Script-to-footage matching (`ml/alignment.py`, `services/match_service.py`).** Beats are ordered, transcript
spans (1-4 consecutive segments of one asset, <= 45 s; 1-3 when there would be more than 3000) sit on one
global timeline (asset offset = sum of earlier durations). With `S = cosine(beat, span)` and
`g = S - MATCH_WEAK`, the DP finds the path of `(beat, span)` pairs with increasing beats and compatible
spans (`end[prev] <= start[next] + 1 s`) that maximises the summed gain; only `g > 0` pairs take part and
beats can be skipped. Spans are sorted by end, so for beat `i`
`f[i][j] = g[i][j] + max(0, prefixmax(G)[cutoff[j]])` is one vectorised numpy pass (`G[k]` = best `f` of
earlier beats on span `k`, `cutoff[j]` found with `searchsorted`), with back-pointers for the path:
O(beats x spans). A span never follows itself (tolerance capped at half its length). Statuses follow Plan 8.5
(matched / weak, off-path beats: weak + `out_of_order` if their best span >= `MATCH_OK`, else missing). The
cross-check against an exhaustive search lives in `tests/unit/test_alignment.py`.

**Clip scoring (`ml/scoring.py`, `services/clip_service.py`).** Windows start after a sentence end and close at
the first segment boundary >= 20 s (<= 45 s). Six features (beat similarity, hook signals, speech rate, mean
energy, VADER emphasis, shots per 10 s) are min-max normalised across the asset's windows and combined with
0.30/0.20/0.15/0.15/0.10/0.10; unavailable features drop out and the rest are renormalised. NMS (IoU < 0.3)
keeps 8, one `clips.rerank_copy` call picks and words the best 4 (deterministic fallback copy on any LLM
failure). Heavy per-clip work (pause removal, `ml/faces.py` Haar sampling at 1 fps on the proxy, captions) runs
*before* the write transaction because `ctx.progress` writes through its own session and SQLite allows one
writer.

**Timeline operations (`schemas/timeline.py`, `services/timeline_service.py`).** The timeline is a pure
Pydantic value; every op takes one and returns a new one. The video track is re-laid out gapless after each op
(rejected items take no time). Captions and overlays are timeline-positioned, so ops that move video retime
them through *source time*: a caption is anchored to the source range under its start and re-placed wherever
that range lives afterwards (parts whose footage is gone are dropped or clipped; split changes nothing).
`validate()` returns every broken invariant of Plan 6.1 with a code and path; the property tests apply random
op sequences and re-validate after each step.

**Concurrency model for edits (`services/edit_service.py`).** `edits.revision` is the stored version. Writes
(PUT, ops, restore) send `base_revision` and are one SQL compare-and-swap (`UPDATE ... WHERE revision = base`);
losers get `409 REVISION_CONFLICT` with `details.current_revision`, reload and re-apply. History is linear
(`edit_revisions`, one row per revision; restore appends). The Twin applies actions through the same ops
endpoint, so an agent edit and a user edit can never silently overwrite each other.

Deviations from Plan.md made here: `beat_matches.provenance` (migration 003); `shared_span` flag next to
`out_of_order`; clip generation lowers the 20 s minimum for very short footage (flagged); the OpenCV pin is
`<5` because OpenCV 5 ships neither `CascadeClassifier` nor the Haar XML files.

## Rendering (`media/render_graph.py`, `services/render_service.py`, job `render.run`)

**Pipeline.** `POST /clips/{id}/renders` validates (preset cap, assets ready), inserts a `renders` row
(`edit_revision`, `caption_style`, `job_id`; migration 004) and enqueues `render.run` on the media pool. The job
reads the stored `edit_revisions` snapshot, probes the ORIGINAL files, copies the timeline for the preset
(`retarget_timeline`), builds the graph (progress 10), runs ffmpeg with `-progress pipe:1` in a temp work
directory (`data/tmp/renders/{id}`, removed afterwards; progress 10..95), grabs a poster frame (1 s) and stores
`renders/{id}.mp4` + `.jpg` via the StorageBackend (100). Cancel: `ffmpeg.run(should_cancel=...)` polls the job's
cancel flag every 200 ms and kills the process.

**Graph (`build_plan`, pure strings, unit-tested).** Per non-rejected video item: input seeked to
`src_in - 1 s` (keyframe margin, then an exact `trim`), `setpts`, for 9:16 a face-centred
`crop=w=ih*9/16:...x='max(0,min(iw-out_w,crop_x*iw-out_w/2))'` when the source is wider, `scale=...:increase`,
`crop=W:H`, `setsar=1`, `fps=30`, `format=yuv420p`; audio `atrim`, `aresample=48000` to stereo fltp (or
`anullsrc` when the file has no audio). A sponsor placeholder is `color=c=#111111` plus a Pillow card PNG with
silent audio. Joining: one `concat` when every transition is a cut; otherwise a left fold where a fade/dissolve is
`xfade` + `acrossfade` with `offset = running - d` (`running += dur - d`) and a cut is a two-input `concat`
followed by `fps=30` (concat leaves a 1/1000000 timebase that `xfade` rejects). `d` is clamped to half of both
neighbours. Overlays are card PNGs with `overlay=enable='between(t,s,e)'`, captions the `subtitles` filter on an
ASS file in the work dir with `fontsdir=fonts` (relative, so no path escaping), music/sfx/voiceover are
`atrim, volume, adelay, apad` into one `amix`.

* **Transitions shift time.** Clips overlap during a fade, so everything after one plays earlier than its timeline
  time. `RenderPlan.time_map` converts timeline to output seconds and is applied to captions, overlays and audio
  items; the output is `timeline.duration - sum(overlaps)` long.
* **amix without `normalize`.** FFmpeg < 7 has no `normalize=0`; `amix_supports_normalize()` inspects
  `ffmpeg -h filter=amix`. Without it the graph appends `volume=<inputs>` after the mix, which equals
  `normalize=0` because every stream is padded (`apad`) so no input ends early and rescales the others. (The
  plan suggested boosting the voice instead, which would attenuate music; this keeps all levels as specified.)

**Captions (`media/captions_ass.py`).** Captions already live in the timeline (`rebuild_captions` rules); this
only styles them: PlayRes = output size, sizes scaled by height (x0.6 for 16:9), `bold_center` Montserrat Bold 84
uppercase / outline 6 / alignment 5, `minimal_bottom` Inter 52 with a semi-transparent `BorderStyle=3` box
(MarginV 160 or 60), `karaoke` Montserrat Bold 80, alignment 2, MarginV 420, `{\kf}` per word (yellow fill over
white; `\kf` sweeps SecondaryColour to PrimaryColour, so Primary = yellow). `media/cards.py` draws the sponsor,
lower-third and text cards with Pillow at output size.

**Fonts (`media/fonts.py`, `backend/assets/fonts`).** Montserrat-Bold.ttf and Inter-Regular.otf are vendored (SIL
OFL, licences alongside). If a file is missing the resolver falls back to a system font via fontconfig/DejaVu/
Liberation and logs one WARNING naming the file to drop in; renders still work but look different. The resolved
faces are copied into the work dir's `fonts/`.

## Data layout

```
data/
  creatorai.db            SQLite (+ -wal/-shm)
  .secret                 generated APP_SECRET (chmod 600)
  models/fastembed/       embedding model cache (FASTEMBED_CACHE_PATH overrides)
  media/{workspace_id}/{asset_id}/original.<ext>, proxy.mp4, thumb.jpg, audio/full.mp3 (+chunk_NNN.mp3),
                                  keyframes/shot_NNN.jpg, transcript.json, sidecar.(words.json|srt|vtt)
  tmp/uploads/{workspace}/{upload}/NNNNNN.part   chunks of unfinished uploads
  renders/{render_id}.mp4 / .jpg   (key renders/{id}.mp4; work files in tmp/renders/{id}, deleted after)
  demo/hero_demo.mp4 + .words.json   generated by make_demo_media for `make seed`
  tmp/                    uploads in progress, scratch files
```

Storage keys are relative (`media/{workspace}/{asset}/proxy.mp4`). The browser never sees paths; the API
returns `sign_media(key)` URLs of the form `/media/{key}?exp=&sig=` (HMAC-SHA256, 1 h) which the media
route serves with full HTTP Range support.

## Database notes

- Schema lives in `backend/migrations/*.sql` (SQLite dialect) and is applied at startup by `app.db.migrate()`
  or manually with `make migrate`. Deviations from Plan.md section 5: `jobs.payload` and `jobs.attempts`
  columns (needed for retries); `users` table and `workspaces.owner_id -> users(id)`;
  `idea_suggestions.provenance` (migration `002_idea_provenance.sql`, provenance of generated ideas);
  `renders.caption_style` and `renders.job_id` (migration `004_render_meta.sql`).
- Embeddings are little-endian float32 BLOBs; search is brute-force cosine in numpy (`ml/vectors.py`).
- `asset_segments_fts` is an external-content FTS5 table kept in sync by triggers. After a `VACUUM`, run
  `insert into asset_segments_fts(asset_segments_fts) values('rebuild');`.

## Frontend (`frontend/`)

Next.js (App Router) + TypeScript strict + TanStack Query + Zustand. Full conventions, the component
inventory and "how to add a page / hook" are in `frontend/README.md`. In short:

- **Route groups**: `(public)` landing, login, signup · `(flow)/onboarding` (auth only) · `(app)` = auth-guarded
  shell (Sidebar, Topbar with breadcrumb, global search and job indicator, DataModeBanner, TwinDrawer slot,
  JobToasts, NewContentDialog).
- **API layer** (`src/lib/api`): `schema.d.ts` is generated from the backend OpenAPI (`make gen-api`, committed);
  `client.ts` wraps `openapi-fetch` (Bearer token, `ApiError` from `{error:{code,message,details}}`, media URL
  helper); `hooks.ts` holds every query/mutation and the query keys; `error-toasts.ts` maps `LLM_BUSY`,
  `LLM_NOT_CONFIGURED`, `QUOTA_EXCEEDED`, `NO_YOUTUBE_CONNECTION`, `REVISION_CONFLICT` to toasts.
- **Jobs**: `stores/jobs.ts` + `components/shell/jobs-provider.tsx` poll `GET /jobs` and follow each active job
  over SSE (`lib/sse.ts`, `?access_token=`), driving JobToasts and the topbar indicator.
- **Honesty rules**: generated content carries a `ProvenanceBadge`; `DataModeBanner` reflects
  `GET /health` `data_mode`; features without a backend render `NotAvailablePage`, never sample data.
