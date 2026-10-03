# CreatorAi: Build Plan (final, single creator)

> **Local-first override:** infrastructure in this plan (Docker, Supabase/Postgres, Redis/RQ) is replaced by a zero-dependency local stack — see [`docs/LOCAL_FIRST.md`](docs/LOCAL_FIRST.md). Where they conflict, LOCAL_FIRST wins. §7.4 (token budget) is a planning estimate only and is intentionally not built. UI details live in [`docs/UI_SPEC.md`](docs/UI_SPEC.md).

> **How to use this file:** it is the map for coding. Schema, folder layout, API, JSON contracts, pipelines and thresholds here are the fixed reference. If code and plan disagree, fix the plan in the same commit.
> External free-tier limits were checked in October 2026 and change often; items that must be re-checked on day 1 are listed in section 18.

---

## 0. Locked decisions

| Topic | Decision |
|---|---|
| Users | **One creator per workspace.** Teams/RBAC are deferred. `workspace_id` stays on every table so they can return without a rewrite |
| Publishing | **YouTube only** (Data API). Reels and TikTok are **download exports** with their own presets |
| Hosting for the demo | Everything runs **locally via docker-compose** (optional tunnel). FFmpeg on free cloud hosts is unreliable |
| Auth | Supabase Auth (email + password or Google). Backend verifies the token |
| Database | Supabase Postgres + `pgvector`, accessed with SQLAlchemy 2 (async). **No media in Supabase** (50 MB file cap, 1 GB total on the free plan) |
| Media storage | Local disk behind a `StorageBackend` interface (S3/R2/MinIO implementation optional) |
| Queue | Redis + RQ, three queues: `media`, `llm`, `io` |
| LLMs | Gemini Flash (primary), Groq chat model (fallback). All calls go through one **LLM Gateway** |
| Transcription | Groq Whisper (`whisper-large-v3-turbo`), `faster-whisper` as offline fallback |
| Local models | Sentence-Transformers embedder (384-d) and OpenCV Haar face detector. **No model training** |
| Units and ids | Time is **seconds (float)** everywhere. Ids are UUID. Timestamps are `timestamptz` (UTC) |
| Rendering rule | A render includes every layer whose status is **not `rejected`** (`suggested` and `accepted` both render). "Accept all" is a convenience, not a requirement |
| LLM endpoints | Synchronous (30 s timeout, `503 LLM_BUSY` with `retry_after` if the gateway queue is full). Heavy work (media, matching, clips, renders, uploads) runs as **jobs** with SSE progress |
| Stages | `idea → script → shoot → edit → review → published` (the Director plan lives inside `idea`) |

---

## 1. Feature → module map

| # | Feature | Backend module(s) | Frontend page / component | Key tables | External |
|---|---|---|---|---|---|
| 1 | Centralized asset management | `assets`, `uploads`, `storage`, `workers/ingest` | `/library`, `AssetGrid`, `UploadDialog` | `assets`, `uploads`, `asset_shots` | FFmpeg, Gemini (captions) |
| 2 | Script and hook generation | `scripts`, `llm` | `/projects/[id]/script` | `scripts`, `script_beats` | Gemini / Groq |
| 3 | Semantic search | `search` | `/library` search bar, `SearchResults` | `asset_segments`, `asset_shots` | MiniLM, pgvector |
| 4 | Script-to-video understanding | `matching`, `ml/alignment` | `/projects/[id]/match` | `beat_matches`, `script_beats` | MiniLM |
| 5 | AI Director | `director` | `/projects/[id]/plan`, `ReviewReport` | `director_outputs` | Gemini / Groq |
| 6 | Smart clip generation | `clips`, `ml/scoring`, `ml/silence` | `/projects/[id]/clips` | `clips` | Gemini (rerank + copy) |
| 7 | Editable timeline | `edits`, `media/render_graph` | `/editor/[clipId]` | `edits`, `edit_revisions` | FFmpeg |
| 8 | Long-to-short repurposing | `renders`, `media/presets` | `RenderDialog`, `/projects/[id]/export` | `renders` | FFmpeg, OpenCV |
| 9 | Creative Digital Twin | `twin` | `/twin`, `TwinDrawer` | `creator_profiles.style_profile`, `twin_memories`, `twin_messages` | Gemini / Groq, MiniLM |
| 10 | Monetization and sponsorship | `sponsors` | `/projects/[id]/sponsors` | `sponsor_briefs`, `sponsor_slots` | Gemini / Groq |
| 11 | Workflow and publishing | `content`, `publish`, `youtube`, `jobs` | `/board`, `/projects/[id]/publish` | `content_items`, `publish_jobs`, `jobs` | YouTube Data API |
| 12 | Creator intelligence | `insights`, `youtube` | `/insights` | `yt_videos`, `yt_metrics_daily`, `insight_snapshots` | YouTube Analytics API, pandas |

---

## 2. External services and limits (checked October 2026)

| Service | Used for | Free-tier facts that shape the design |
|---|---|---|
| **Gemini API** | Scripts, plans, reviews, keyframe captions, copy, chat | Free tier is Flash/Flash-Lite only. Limits are **per project**, shown in AI Studio (not published as fixed numbers). Reports range from roughly 10–15 requests/min and 500–1,500/day. Images with both sides ≤ 384 px cost **258 tokens**. Video costs about 263–300 tokens/second, so **never upload whole videos** |
| **Groq** (not xAI Grok) | Whisper ASR, fast text fallback | Chat models: 30 req/min, 1,000 req/day, **8,000 tokens/min**, 200,000 tokens/day, per **organization**. Whisper: 20 req/min, 2,000 req/day, 7,200 audio s/hour, 28,800 audio s/day, **25 MB max upload** |
| **Supabase** | Auth, Postgres, pgvector | 500 MB database, 1 GB file storage, **50 MB max file**, free projects pause after a week of inactivity, 2 active projects |
| **YouTube Data + Analytics APIs** | Upload, schedule, metrics | OAuth 2.0. Scopes in section 12. Daily quota is limited; uploads are expensive in quota units. Unaudited API projects may have uploads forced to private. OAuth apps in "Testing" status have short-lived refresh tokens |
| **FFmpeg / PySceneDetect / OpenCV** | All media work | Free libraries, local |

**Not used:** xAI Grok (no reliable free API), Cloudinary (100 MB video cap on free), WhisperX (not needed).

---

## 3. Architecture

### 3.1 Component diagram

```
┌──────────────────────────── Browser (Next.js) ────────────────────────────┐
│ Board · Library · Project tabs · Timeline editor · Insights · Twin drawer  │
└───────────────┬───────────────────────────────┬────────────────────────────┘
                │ REST (JWT)                    │ SSE /jobs/{id}/events
                ▼                               ▲
┌──────────────────────────── FastAPI (api) ─────────────────────────────────┐
│ routers → services → repositories (SQLAlchemy)     LLM Gateway (sync calls) │
│ signed media URLs · upload chunk receiver · YouTube OAuth · job enqueue     │
└───────┬────────────────────────┬──────────────────────────┬────────────────┘
        │                        │                          │
        ▼                        ▼                          ▼
 Supabase Postgres        Redis (RQ queues,           Local disk (StorageBackend)
 + pgvector               rate-limit buckets,         data/media/{workspace}/{asset}/...
 + Supabase Auth          job pub/sub, cache)         data/renders/{render}.mp4
                                 │
          ┌──────────────────────┼───────────────────────┐
          ▼                      ▼                       ▼
   worker-media (RQ)       worker-llm (RQ)          worker-io (RQ)
   ffmpeg, scenes,         clip rerank/copy,        YouTube upload,
   ASR calls, embed,       review, twin update,     analytics sync
   match, render           insights
                                 ▲
                         scheduler (APScheduler): nightly analytics sync
```

### 3.2 Processes (docker-compose services)

| Service | Command | Notes |
|---|---|---|
| `web` | `next dev` / `next start` | Port 3000 |
| `api` | `uvicorn app.main:app --reload` | Port 8000 |
| `worker-media` | `rq worker media --with-scheduler` | Concurrency 1 (CPU/ffmpeg heavy). Run 2 processes if the machine has cores to spare |
| `worker-llm` | `rq worker llm` | Concurrency 2 |
| `worker-io` | `rq worker io` | Concurrency 1 |
| `scheduler` | `python -m app.workers.scheduler` | Daily analytics sync at 03:00 local |
| `redis` | `redis:7` | Port 6379 |

### 3.3 Job system

- Every long operation creates a row in `jobs` (status, progress 0–100, stage text, result jsonb) and enqueues an RQ task with the same `job_id`.
- Workers publish JSON events to Redis channel `job:{job_id}`. The API's `GET /jobs/{id}/events` streams them as SSE and sends a final `done` event.
- Retry policy: `Retry(max=2, interval=[10, 30])`. Stage checkpoints are stored in `assets.analysis.stages_done`, so a retry resumes instead of restarting.
- Cancel: `POST /jobs/{id}/cancel` sets Redis key `job:{id}:cancel`; workers check it between stages.
- Every stage is **idempotent** and keyed by `(asset_id, stage)`. Duplicate uploads are detected by `sha256` and reuse the existing asset's analysis.

**Job types and progress map**

| Job type | Queue | Stages (cumulative progress) |
|---|---|---|
| `asset.process` | media | probe 5 → audio 15 → proxy 30 → silence+energy 38 → transcribe 60 → segments 66 → shots 72 → keyframes 78 → caption 88 → embed 97 → finalize 100 |
| `project.match` | media | load 10 → embed spans 40 → align 80 → save 100 |
| `clips.generate` | media then llm | candidates 30 → score 50 → rerank+copy (llm) 85 → timelines 100 |
| `render.run` | media | build graph 10 → ffmpeg 95 → thumbnail 100 |
| `publish.upload` | io | token 5 → upload 90 → processing 100 |
| `analytics.sync` | io | channel 10 → videos 40 → daily 80 → retention 100 |
| `twin.update` | llm | collect 30 → compute stats 60 → style extract 90 → save 100 |

**Automatic chaining:** `asset.process` finishes → if the content item has a current script and all its assets are `ready`, enqueue `project.match` automatically. Everything else is user-triggered.

### 3.4 Storage layout and media access

```
data/media/{workspace_id}/{asset_id}/
   original.<ext>
   proxy.mp4                 480p H.264, keyframe every 2 s, +faststart
   thumb.jpg                 poster frame at 1 s
   audio/full.mp3            16 kHz mono, 48 kbps
   audio/chunk_000.mp3 ...   ASR chunks
   keyframes/shot_000.jpg    ≤ 384 px both sides
data/renders/{render_id}.mp4
data/renders/{render_id}.jpg
data/tmp/                     chunk uploads, working files (cleaned nightly)
```

- Browser never receives a file path. The API issues **signed URLs**: `/media/{key}?exp={unix}&sig={hmac_sha256(key|exp, MEDIA_SIGNING_SECRET)}`, TTL 1 hour. The media route supports **HTTP Range** requests so video seeking works (use `StaticFiles`/`FileResponse` on a recent Starlette, otherwise implement Range manually).
- Preview always uses `proxy.mp4`. Final renders use `original.<ext>`.

---

## 4. Repository layout

```
creatorai/
├── docker-compose.yml
├── .env.example
├── README.md
├── Plan.md
├── Makefile                      # make dev, make migrate, make seed, make test
├── backend/
│   ├── pyproject.toml            # or requirements.txt
│   ├── Dockerfile                # python:3.12-slim + ffmpeg (with libass) + fonts
│   ├── migrations/
│   │   └── 001_init.sql          # the schema in section 5 (applied with psql)
│   ├── assets/
│   │   ├── fonts/                # Montserrat-Bold.ttf, Inter-Regular.ttf (OFL licensed)
│   │   └── domains/              # director domain templates: education.json, technology.json, ...
│   ├── scripts/
│   │   ├── migrate.py            # runs migrations/*.sql in order
│   │   ├── seed_demo.py          # seed profile, board cards, fake yt_videos + metrics, twin memories
│   │   └── precompute_hero.py    # runs the full pipeline on the hero project and warms the LLM cache
│   ├── app/
│   │   ├── main.py               # FastAPI app, CORS, router mounting, exception handlers
│   │   ├── config.py             # pydantic-settings: every env var and tunable (section 13)
│   │   ├── deps.py               # get_db, get_ctx (user + workspace), pagination
│   │   ├── db.py                 # async engine, session factory
│   │   ├── security.py           # Supabase JWT verify, signed media URLs, Fernet token crypto
│   │   ├── errors.py             # AppError(code, status, message), error handlers
│   │   ├── logging.py
│   │   ├── api/v1/
│   │   │   ├── __init__.py       # builds the /api/v1 router
│   │   │   ├── me.py             # /me, /onboarding, /profile
│   │   │   ├── content.py        # board + content items
│   │   │   ├── director.py
│   │   │   ├── scripts.py
│   │   │   ├── uploads.py
│   │   │   ├── assets.py
│   │   │   ├── search.py
│   │   │   ├── matching.py
│   │   │   ├── clips.py
│   │   │   ├── edits.py
│   │   │   ├── renders.py
│   │   │   ├── sponsors.py
│   │   │   ├── publish.py
│   │   │   ├── youtube.py
│   │   │   ├── insights.py
│   │   │   ├── twin.py
│   │   │   ├── jobs.py           # job status, SSE, cancel
│   │   │   └── media.py          # signed media route (Range support)
│   │   ├── models/               # SQLAlchemy models, one file per table group, mirror section 5
│   │   ├── schemas/              # Pydantic request/response models, one file per router
│   │   ├── repositories/         # thin query layer; EVERY query filters by workspace_id
│   │   ├── services/
│   │   │   ├── director_service.py
│   │   │   ├── script_service.py
│   │   │   ├── asset_service.py
│   │   │   ├── search_service.py
│   │   │   ├── match_service.py
│   │   │   ├── clip_service.py
│   │   │   ├── timeline_service.py   # timeline validation + deterministic ops
│   │   │   ├── render_service.py
│   │   │   ├── sponsor_service.py
│   │   │   ├── publish_service.py
│   │   │   ├── youtube_service.py
│   │   │   ├── insights_service.py
│   │   │   └── twin_service.py
│   │   ├── llm/
│   │   │   ├── gateway.py        # route, rate-limit, cache, validate, fallback
│   │   │   ├── providers/{base.py, gemini.py, groq.py}
│   │   │   ├── ratelimit.py      # Redis sliding-window limiter shared by all processes
│   │   │   ├── cache.py          # llm_cache table + in-memory LRU
│   │   │   ├── context.py        # build_creator_context(profile, style_profile, memories)
│   │   │   ├── tasks.py          # TASK_ROUTES: task → provider chain, max tokens
│   │   │   ├── schemas.py        # Pydantic output models for every task (section 7)
│   │   │   └── prompts/          # one .md file per task, with {placeholders}
│   │   ├── ml/
│   │   │   ├── embedder.py       # singleton SentenceTransformer, batch encode, L2-normalized
│   │   │   ├── segments.py       # words → sentence-aligned segments
│   │   │   ├── alignment.py      # monotonic DP beat↔span alignment
│   │   │   ├── scoring.py        # clip candidate features + weighted score + NMS
│   │   │   ├── hooks.py          # hook signals (regex heuristics) and hook-type classifier
│   │   │   ├── silence.py        # parse ffmpeg silencedetect, merge, pause cuts
│   │   │   ├── shots.py          # PySceneDetect wrapper
│   │   │   ├── faces.py          # OpenCV Haar face detection → crop_x per segment
│   │   │   ├── energy.py         # RMS energy curve from PCM
│   │   │   └── sponsor_slots.py  # topic-shift + pause slot detection
│   │   ├── media/
│   │   │   ├── ffmpeg.py         # run(), probe(), progress parsing, command builders
│   │   │   ├── audio.py          # extract, split at silences, chunk offsets
│   │   │   ├── keyframes.py
│   │   │   ├── captions_ass.py   # timeline captions → .ass (3 styles)
│   │   │   ├── cards.py          # Pillow sponsor/lower-third PNG cards
│   │   │   ├── render_graph.py   # timeline JSON → ffmpeg filter_complex
│   │   │   └── presets.py        # render presets (section 8.9)
│   │   ├── storage/{base.py, local.py, s3.py}
│   │   ├── integrations/
│   │   │   ├── supabase_auth.py
│   │   │   ├── youtube_oauth.py
│   │   │   ├── youtube_upload.py
│   │   │   └── youtube_analytics.py
│   │   └── workers/
│   │       ├── queues.py         # RQ queues, enqueue helpers, job row creation
│   │       ├── events.py         # publish progress events to Redis
│   │       ├── scheduler.py
│   │       └── tasks/{asset_process.py, project_match.py, clips_generate.py,
│   │                  render_run.py, publish_upload.py, analytics_sync.py, twin_update.py}
│   └── tests/
│       ├── unit/{test_segments.py, test_alignment.py, test_scoring.py, test_silence.py,
│       │         test_render_graph.py, test_timeline_ops.py, test_gateway.py, test_hooks.py}
│       ├── integration/{test_pipeline_small.py, test_api_smoke.py}
│       └── fixtures/{hero_30s.mp4, hero_30s.words.json, sample_script.json}
└── frontend/
    ├── package.json
    ├── next.config.mjs
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── .env.local.example
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── (auth)/login/page.tsx
        │   ├── (auth)/onboarding/page.tsx
        │   └── (app)/
        │       ├── layout.tsx                    # sidebar + topbar + TwinDrawer + JobToasts
        │       ├── board/page.tsx
        │       ├── library/page.tsx
        │       ├── projects/[id]/layout.tsx      # project header + tabs
        │       ├── projects/[id]/plan/page.tsx
        │       ├── projects/[id]/script/page.tsx
        │       ├── projects/[id]/footage/page.tsx
        │       ├── projects/[id]/match/page.tsx
        │       ├── projects/[id]/clips/page.tsx
        │       ├── projects/[id]/sponsors/page.tsx
        │       ├── projects/[id]/publish/page.tsx
        │       ├── editor/[clipId]/page.tsx
        │       ├── insights/page.tsx
        │       ├── twin/page.tsx
        │       └── settings/page.tsx
        ├── components/
        │   ├── ui/                 # shadcn/ui primitives
        │   ├── board/{KanbanBoard.tsx, ContentCard.tsx, NewContentDialog.tsx}
        │   ├── plan/{DirectorForm.tsx, PlanView.tsx, ShotList.tsx, ReviewReport.tsx}
        │   ├── script/{HookPicker.tsx, ScriptEditor.tsx, SceneList.tsx, MetaPanel.tsx}
        │   ├── library/{AssetGrid.tsx, AssetCard.tsx, UploadDialog.tsx, AssetDetail.tsx, SearchBar.tsx, SearchResults.tsx}
        │   ├── match/{ScriptFootageView.tsx, BeatRow.tsx, MissingScenes.tsx}
        │   ├── clips/{ClipList.tsx, ClipCard.tsx, RenderDialog.tsx}
        │   ├── timeline/{TimelineEditor.tsx, PreviewPlayer.tsx, Ruler.tsx, Track.tsx,
        │   │             VideoItemView.tsx, CaptionItemView.tsx, OverlayItemView.tsx,
        │   │             Inspector.tsx, Toolbar.tsx, LayerBadge.tsx}
        │   ├── sponsors/{BriefForm.tsx, SlotCard.tsx}
        │   ├── publish/{PublishForm.tsx, PublishStatus.tsx}
        │   ├── insights/{KpiRow.tsx, PerformanceTable.tsx, HookChart.tsx, LengthChart.tsx, NextIdeas.tsx}
        │   ├── twin/{TwinChat.tsx, StyleProfileCard.tsx, ActionButtons.tsx}
        │   └── common/{JobProgress.tsx, JobToasts.tsx, EmptyState.tsx, ConfirmDialog.tsx}
        ├── lib/
        │   ├── api/{client.ts, schema.d.ts (generated), hooks.ts}
        │   ├── sse.ts
        │   ├── supabase.ts          # auth only
        │   ├── time.ts              # formatTimecode, parseTimecode
        │   └── timeline/{types.ts, ops.ts, history.ts, playback.ts, captions.ts}
        ├── stores/{timelineStore.ts, uiStore.ts, jobsStore.ts}
        └── styles/globals.css
```

**Conventions**
- Python: Ruff + Black, type hints everywhere, services never import FastAPI, routers never touch SQL.
- Repositories take `workspace_id` as a required argument; there is no query without it.
- Errors: raise `AppError(code="CLIP_NOT_FOUND", status=404, message="...")`. Response shape `{ "error": { "code", "message", "details" } }`.
- Frontend: TypeScript strict, TanStack Query for server state, Zustand for timeline editing state, `openapi-typescript` generates `schema.d.ts` from the FastAPI OpenAPI (`npm run gen:api`).

---

## 5. Database schema (fixed)

Apply with `python scripts/migrate.py` (runs `migrations/*.sql` in order, tracks them in `schema_migrations`). Status-like columns use `text` + `CHECK` (not Postgres enums) so values can change without painful migrations. Embeddings are `vector(384)`, so the embedding model can change between 384-d models (for example the multilingual MiniLM) without a schema change.

```sql
-- migrations/001_init.sql
create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ───────── workspace and profile ─────────
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique,                     -- supabase auth.users.id
  name text not null default 'My Channel',
  created_at timestamptz not null default now()
);

create table creator_profiles (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  display_name text not null,
  domain text not null check (domain in ('education','technology','entertainment','lifestyle','business')),
  audience text not null default '',
  tone text not null default 'conversational',
  language text not null default 'en',               -- ASR language hint
  platforms text[] not null default '{youtube_shorts}',
  style_profile jsonb not null default '{}'::jsonb,  -- Digital Twin (section 6.2)
  style_profile_rev int not null default 0,
  approvals_since_style_update int not null default 0,
  onboarding_done boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on creator_profiles
  for each row execute function set_updated_at();

create table youtube_connections (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  channel_id text not null,
  channel_title text,
  refresh_token_enc text not null,                   -- Fernet encrypted
  scopes text[] not null,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz
);

-- ───────── board and planning ─────────
create table content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  idea_text text not null default '',
  objective text not null default '',
  domain text check (domain in ('education','technology','entertainment','lifestyle','business')),
  stage text not null default 'idea'
    check (stage in ('idea','script','shoot','edit','review','published')),
  position int not null default 0,
  target_duration_sec int,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on content_items (workspace_id, stage, position);
create trigger trg_content_updated before update on content_items
  for each row execute function set_updated_at();

create table idea_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  rationale text not null default '',
  source text not null check (source in ('insights','twin')),
  status text not null default 'suggested' check (status in ('suggested','accepted','dismissed')),
  created_at timestamptz not null default now()
);
create index on idea_suggestions (workspace_id, status);

create table director_outputs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  kind text not null check (kind in ('plan','review')),
  version int not null default 1,
  payload jsonb not null,                            -- section 6.4 / 6.5
  metrics jsonb not null default '{}'::jsonb,        -- deterministic metrics behind a review
  created_at timestamptz not null default now()
);
create index on director_outputs (content_item_id, kind, version desc);

-- ───────── scripts ─────────
create table scripts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  version int not null default 1,
  is_current boolean not null default true,
  hook_options jsonb not null default '[]'::jsonb,
  selected_hook text not null default '',
  body_md text not null default '',
  scenes jsonb not null default '[]'::jsonb,         -- section 6.6
  meta jsonb not null default '{}'::jsonb,           -- titles, description, ctas, captions
  tone text, platform text, length_sec int,
  provider text, model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index scripts_one_current on scripts (content_item_id) where is_current;
create trigger trg_scripts_updated before update on scripts
  for each row execute function set_updated_at();

create table script_beats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  script_id uuid not null references scripts(id) on delete cascade,
  scene_idx int not null,
  beat_idx int not null,
  text text not null,
  intent text not null default '',
  est_sec numeric(6,2) not null default 5,
  embedding vector(384),
  unique (script_id, scene_idx, beat_idx)
);

-- ───────── assets ─────────
create table uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_item_id uuid references content_items(id) on delete set null,
  filename text not null,
  mime text not null,
  size_bytes bigint not null,
  chunk_size int not null,
  total_chunks int not null,
  received_chunks int[] not null default '{}',
  status text not null default 'uploading' check (status in ('uploading','completed','aborted')),
  asset_id uuid,
  created_at timestamptz not null default now()
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_item_id uuid references content_items(id) on delete set null,
  kind text not null check (kind in ('video','image','audio','document')),
  filename text not null,
  storage_key text not null,                         -- relative path of the original
  proxy_key text, thumb_key text, audio_key text,
  mime text not null,
  size_bytes bigint not null,
  sha256 text not null,
  duration_sec numeric(10,3),
  width int, height int, fps numeric(6,3),
  status text not null default 'uploaded'
    check (status in ('uploaded','processing','ready','failed')),
  error text,
  description text not null default '',             -- AI generated
  tags text[] not null default '{}',
  folder text not null default '/',
  analysis jsonb not null default '{}'::jsonb,       -- stages_done, silences, energy, language, asr info
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, sha256)
);
create index on assets (workspace_id, kind, created_at desc);
create index on assets (content_item_id);
create index on assets using gin (tags);
create trigger trg_assets_updated before update on assets
  for each row execute function set_updated_at();

create table asset_segments (                         -- transcript segments (speech)
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  idx int not null,
  start_sec numeric(10,3) not null,
  end_sec numeric(10,3) not null,
  text text not null,
  words jsonb not null default '[]'::jsonb,          -- [{"w":"hello","t0":1.2,"t1":1.5}]
  embedding vector(384),
  tsv tsvector generated always as (to_tsvector('simple', text)) stored,
  unique (asset_id, idx)
);
create index asset_segments_vec on asset_segments using hnsw (embedding vector_cosine_ops);
create index asset_segments_tsv on asset_segments using gin (tsv);

create table asset_shots (                            -- visual shots with AI captions
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  idx int not null,
  start_sec numeric(10,3) not null,
  end_sec numeric(10,3) not null,
  keyframe_key text,
  caption text not null default '',
  tags text[] not null default '{}',
  embedding vector(384),
  unique (asset_id, idx)
);
create index asset_shots_vec on asset_shots using hnsw (embedding vector_cosine_ops);

-- ───────── matching ─────────
create table beat_matches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  script_beat_id uuid not null unique references script_beats(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  start_sec numeric(10,3), end_sec numeric(10,3),
  score numeric(5,4) not null default 0,
  status text not null check (status in ('matched','weak','missing','confirmed','rejected')),
  alternatives jsonb not null default '[]'::jsonb,   -- top 3 other spans
  updated_at timestamptz not null default now()
);

-- ───────── clips, edits, renders ─────────
create table clips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  source_asset_id uuid not null references assets(id) on delete cascade,
  kind text not null default 'short' check (kind in ('short','full')),
  title text not null default '',
  hook text not null default '',
  caption text not null default '',
  reason text not null default '',
  score numeric(5,4) not null default 0,
  features jsonb not null default '{}'::jsonb,
  start_sec numeric(10,3) not null,
  end_sec numeric(10,3) not null,
  status text not null default 'suggested' check (status in ('suggested','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on clips (content_item_id, status);

create table edits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  clip_id uuid not null unique references clips(id) on delete cascade,
  timeline jsonb not null,                           -- section 6.1
  revision int not null default 1,
  updated_at timestamptz not null default now()
);

create table edit_revisions (
  id uuid primary key default gen_random_uuid(),
  edit_id uuid not null references edits(id) on delete cascade,
  revision int not null,
  timeline jsonb not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (edit_id, revision)
);

create table renders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  clip_id uuid not null references clips(id) on delete cascade,
  preset text not null check (preset in ('yt_short','reels','tiktok','yt_long')),
  edit_revision int not null,
  status text not null default 'queued' check (status in ('queued','rendering','done','failed')),
  output_key text, thumb_key text,
  duration_sec numeric(10,3), size_bytes bigint,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on renders (clip_id, created_at desc);

-- ───────── sponsorship ─────────
create table sponsor_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  brand text not null,
  product text not null,
  key_points text[] not null default '{}',
  cta text not null default '',
  do_not_say text[] not null default '{}',
  duration_sec int not null default 20 check (duration_sec between 10 and 60),
  created_at timestamptz not null default now()
);

create table sponsor_slots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brief_id uuid not null references sponsor_briefs(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  at_sec numeric(10,3) not null,
  kind text not null check (kind in ('pause','topic_shift','both')),
  score numeric(5,4) not null,
  rationale text not null default '',
  integration_script text not null default '',
  status text not null default 'suggested' check (status in ('suggested','accepted','rejected')),
  created_at timestamptz not null default now()
);

-- ───────── publishing and analytics ─────────
create table publish_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  render_id uuid not null references renders(id) on delete restrict,
  platform text not null default 'youtube' check (platform = 'youtube'),
  title text not null,
  description text not null default '',
  tags text[] not null default '{}',
  visibility text not null default 'private' check (visibility in ('private','unlisted','public')),
  scheduled_at timestamptz,
  status text not null default 'queued'
    check (status in ('queued','uploading','processing','scheduled','published','failed')),
  youtube_video_id text,
  error text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table yt_videos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  youtube_video_id text not null,
  content_item_id uuid references content_items(id) on delete set null,
  title text not null,
  published_at timestamptz,
  duration_sec int,
  format text not null default 'short' check (format in ('short','long')),
  hook_text text not null default '',
  hook_type text not null default 'other'
    check (hook_type in ('question','number','bold_claim','story','other')),
  topic text not null default '',
  retention jsonb,                                   -- [{"ratio":0.0,"watch":1.0}, ...]
  is_seed boolean not null default false,
  unique (workspace_id, youtube_video_id)
);

create table yt_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  yt_video_id uuid not null references yt_videos(id) on delete cascade,
  day date not null,
  views int not null default 0,
  watch_time_min numeric(12,2) not null default 0,
  avg_view_duration_sec numeric(8,2) not null default 0,
  avg_view_pct numeric(5,2) not null default 0,
  likes int not null default 0,
  comments int not null default 0,
  subscribers_gained int not null default 0,
  unique (yt_video_id, day)
);

create table insight_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('summary','next_ideas')),
  range_days int not null default 90,
  payload jsonb not null,                            -- section 6.9
  created_at timestamptz not null default now()
);

-- ───────── digital twin ─────────
create table twin_memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('approved_script','approved_clip','preference','feedback')),
  text text not null,
  source_id uuid,
  embedding vector(384),
  created_at timestamptz not null default now()
);
create index twin_memories_vec on twin_memories using hnsw (embedding vector_cosine_ops);

create table twin_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  actions jsonb not null default '[]'::jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on twin_messages (workspace_id, created_at desc);

-- ───────── jobs, llm, activity ─────────
create table jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null,
  entity_type text not null,
  entity_id uuid,
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','canceled')),
  progress int not null default 0 check (progress between 0 and 100),
  stage text not null default '',
  error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index on jobs (workspace_id, status, created_at desc);
create index on jobs (entity_type, entity_id);

create table llm_cache (
  key text primary key,
  task text not null,
  provider text not null,
  model text not null,
  response jsonb not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  created_at timestamptz not null default now()
);

create table llm_usage (
  id bigserial primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  task text not null,
  provider text not null,
  model text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  latency_ms int not null default 0,
  cache_hit boolean not null default false,
  status text not null default 'ok',
  created_at timestamptz not null default now()
);
create index on llm_usage (workspace_id, created_at desc);

create table activity_log (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  action text not null,         -- stage_moved, clip_accepted, layer_rejected, render_done, published, ...
  entity_type text not null,
  entity_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on activity_log (workspace_id, created_at desc);
```

**Notes**
- **Connection:** use the Supabase **pooler** connection string with `asyncpg`. In transaction pooling mode set `statement_cache_size=0` on the asyncpg connection.
- **Row Level Security:** the browser never queries the database directly (it only uses Supabase Auth), and the backend connects with its own role, so scoping is enforced in the repository layer (`workspace_id` is mandatory). If you later let the browser call Supabase directly, add RLS policies first.
- **Models:** SQLAlchemy models mirror this file one-to-one (`pgvector.sqlalchemy.Vector(384)` for embeddings). Never let SQLAlchemy create tables; SQL migrations are the source of truth.

---

## 6. JSON contracts (fixed)

All times are seconds. Backend validates every one of these with Pydantic; the frontend uses the generated types.

### 6.1 Timeline (`edits.timeline`)

```ts
type Provenance = {
  source: 'ai' | 'user';
  status: 'suggested' | 'accepted' | 'rejected';   // renders unless 'rejected'
  reason?: string;                                  // why AI proposed it
};

type VideoItem = Provenance & {
  id: string;                    // "v_<nanoid>"
  asset_id: string;
  src_in: number; src_out: number;      // source range, src_out > src_in
  tl_start: number;                     // timeline position; video track is gapless
  crop_x: number;                       // 0..1 face-centre used for 9:16 reframing (ignored in 16:9)
  transition_in?: { type: 'cut' | 'fade' | 'dissolve'; dur: number };   // dur 0.1–0.5
  speed?: 1;                            // reserved, always 1 for now
};

type CaptionItem = Provenance & {
  id: string;                    // "c_<nanoid>"
  tl_start: number; tl_end: number;
  text: string;
  words?: { w: string; t0: number; t1: number }[];   // timeline-relative, for karaoke style
  style_override?: 'bold_center' | 'minimal_bottom' | 'karaoke';
};

type AudioItem = Provenance & {
  id: string;                    // "a_<nanoid>"
  kind: 'music' | 'sfx' | 'voiceover';
  asset_id: string;
  src_in: number; src_out: number;
  tl_start: number;
  gain_db: number;               // default -18 for music
};

type OverlayItem = Provenance & {
  id: string;                    // "o_<nanoid>"
  kind: 'sponsor_card' | 'lower_third' | 'text';
  tl_start: number; tl_end: number;
  text: string;
  asset_id?: string | null;      // sponsor video the creator recorded later
  placeholder?: boolean;         // true = render a title card until a real segment is linked
  sponsor_slot_id?: string;
};

type Timeline = {
  version: 1;
  fps: 30;
  aspect: '9:16' | '16:9';
  width: number; height: number;                    // 1080x1920 or 1920x1080
  duration: number;                                 // derived: sum of non-rejected video items
  caption_style: 'bold_center' | 'minimal_bottom' | 'karaoke';
  tracks: {
    video: VideoItem[];
    captions: CaptionItem[];
    audio: AudioItem[];          // music/sfx/voiceover; original voice comes from video items
    overlays: OverlayItem[];
  };
};
```

**Invariants** (checked in `timeline_service.validate()` on every save):
1. Video items are sorted by `tl_start`, gapless, non-overlapping; `tl_start[i+1] == tl_start[i] + (src_out - src_in)` (rejected items are skipped in this check).
2. `0 ≤ src_in < src_out ≤ asset.duration`.
3. Captions and overlays satisfy `0 ≤ tl_start < tl_end ≤ duration`.
4. Ids are unique across the timeline.
5. `duration` equals the recomputed value.

### 6.2 Style profile (Digital Twin, `creator_profiles.style_profile`)

```json
{
  "tone_descriptors": ["direct", "witty", "no-fluff"],
  "vocabulary": { "favor": ["workflow", "ship it"], "avoid": ["synergy", "game-changer"] },
  "pacing": { "avg_wpm": 165, "avg_segment_sec": 3.4, "cuts_per_min": 17, "pause_keep_sec": 0.15 },
  "captions": { "style": "bold_center", "words_per_line": 3 },
  "hook_patterns": ["question", "number"],
  "visual": { "preferred_aspect": "9:16", "music": "light, low volume" },
  "dos": ["start with the result", "one idea per clip"],
  "donts": ["long intros"],
  "summary": "≤ 80 words, written in second person, injected into prompts"
}
```
Only `summary` and the top few `favor/avoid/dos/donts` are injected into prompts (cap about 300 tokens).

### 6.3 Job event (SSE payload)

```json
{ "job_id": "uuid", "type": "asset.process", "status": "running",
  "progress": 60, "stage": "transcribe", "message": "Chunk 2/3", "result": null }
```
Final event has `status` of `succeeded`, `failed` or `canceled`, `progress` 100 (or last value), and `result` (for example `{ "asset_id": "..." }`).

### 6.4 Director plan (`director_outputs.payload`, kind `plan`)

```json
{
  "domain": "technology",
  "objective": "Teach beginners my weekly editing workflow",
  "audience": "aspiring creators",
  "angle": "one-sentence unique angle",
  "structure": [
    { "section": "Hook", "goal": "Promise the outcome", "duration_sec": 8, "notes": "..." }
  ],
  "storytelling": ["Open with the result", "..."],
  "shot_list": [
    { "scene": 1, "shot_type": "close-up", "framing": "face, eye-level", "b_roll": "screen recording of timeline", "note": "..." }
  ],
  "hook_ideas": ["..."],
  "cta": "...",
  "risks": ["Too long an intro will hurt retention"]
}
```

### 6.5 Director review (kind `review`)

```json
{
  "overall_score": 78,
  "scores": { "hook": 82, "clarity": 75, "pacing": 70, "coverage": 90, "cta": 60 },
  "strengths": ["..."],
  "issues": [
    { "type": "pacing", "severity": "medium", "at_sec": 134.0, "scene_idx": 2,
      "fix": "Cut the 9 s pause before the pricing explanation" }
  ],
  "missing_scenes": [ { "scene_idx": 3, "beat_idx": 1, "text": "Show the export settings", "suggestion": "Reshoot a 10 s screen capture" } ],
  "suggestions": ["..."]
}
```
`scores` are **computed deterministically** (section 8.7); the LLM only writes `strengths`, `issues[].fix`, `suggestions` from the metrics and a few snippets.

### 6.6 Script scenes and meta (`scripts.scenes`, `scripts.meta`)

```json
{
  "scenes": [
    { "idx": 0, "title": "Hook", "intent": "grab attention", "est_sec": 8,
      "text": "full spoken text of the scene",
      "beats": [ { "idx": 0, "text": "one spoken idea, 1–2 sentences", "intent": "state the promise", "est_sec": 4 } ] }
  ]
}
```
```json
{
  "titles": ["...", "...", "..."],
  "description": "…",
  "ctas": ["Subscribe for weekly workflows", "..."],
  "captions": ["social caption 1", "social caption 2"],
  "tags": ["editing", "workflow"],
  "supporting": { "pinned_comment": "...", "thumbnail_text": ["...", "..."] }
}
```

### 6.7 Clip rerank + copy output

```json
{ "clips": [
  { "candidate_id": "c3", "keep": true, "rank": 1,
    "title": "...", "hook": "...", "caption": "...", "reason": "complete explanation with strong opener" }
] }
```

### 6.8 Twin reply and actions

```json
{
  "reply": "Tightened the pauses and switched to karaoke captions.",
  "actions": [
    { "type": "tighten_pauses", "clip_id": "uuid", "params": { "keep_sec": 0.1 } },
    { "type": "set_caption_style", "clip_id": "uuid", "params": { "style": "karaoke" } }
  ]
}
```
Allowed `type` values (validated server-side; unknown types are dropped):

| type | params | Effect |
|---|---|---|
| `tighten_pauses` | `keep_sec` 0.05–0.4 | Re-run pause removal on the clip timeline |
| `set_caption_style` | `style` | Change `caption_style` |
| `trim_clip` | `start_delta`, `end_delta` (seconds, ±10 max) | Adjust first/last video item |
| `regenerate_hooks` | `content_item_id`, optional `count` | Call the hooks task |
| `create_idea` | `title`, `rationale` | Create `idea_suggestions` row |
| `toggle_music` | `on` | Accept or reject the AI music layer |

The frontend renders actions as **Apply** buttons; applying calls `POST /twin/actions/apply`, which validates the action against the current clip state. Actions never run automatically.

### 6.9 Insights summary (`insight_snapshots.payload`, kind `summary`)

```json
{
  "range_days": 90,
  "kpis": { "videos": 24, "views": 183400, "watch_time_min": 9120, "avg_view_pct": 54.2, "subs_gained": 812 },
  "by_hook_type": [ { "hook_type": "question", "videos": 8, "avg_views": 9100, "avg_view_pct": 61.0 } ],
  "by_topic": [ { "topic": "editing", "videos": 6, "avg_views": 10200, "avg_view_pct": 58.3 } ],
  "by_length": [ { "bucket": "30-45s", "videos": 9, "avg_views": 8800, "avg_view_pct": 63.5 } ],
  "top_videos": [ { "youtube_video_id": "…", "title": "…", "views": 22100, "avg_view_pct": 66.2 } ],
  "narrative": ["3 short bullets written by the LLM from the tables above"],
  "caveats": ["Metrics for videos under 7 days old are incomplete"]
}
```

### 6.10 Error response

```json
{ "error": { "code": "CLIP_NOT_FOUND", "message": "Clip not found", "details": {} } }
```
Common codes: `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `LLM_BUSY` (503, `retry_after`), `LLM_INVALID_OUTPUT`, `ASSET_NOT_READY`, `NO_SCRIPT`, `NO_YOUTUBE_CONNECTION`, `REVISION_CONFLICT` (409), `QUOTA_EXCEEDED`.

---

## 7. LLM layer

### 7.1 Gateway contract

```python
result = await llm.run(
    task="clips.rerank_copy",          # key into TASK_ROUTES
    variables={...},                   # fills prompts/<task>.md
    schema=ClipRerankOutput,           # Pydantic model; JSON mode + validation
    workspace_id=ctx.workspace_id,
    images=None,                       # list[bytes] for vision tasks
    cache=True,
)
```

**Routing table (`llm/tasks.py`)**

| Task | Primary | Fallback chain | Max out tokens | Input budget |
|---|---|---|---|---|
| `director.plan` | Gemini main | Groq | 1500 | ≤ 1.5K |
| `director.review` | Gemini main | Groq | 1200 | ≤ 2.5K (metrics + snippets) |
| `script.hooks` | Gemini lite | Groq → Gemini main | 600 | ≤ 1K |
| `script.generate` | Gemini main | Groq | 2500 | ≤ 2.5K |
| `script.meta` | Gemini lite | Groq | 900 | ≤ 1.5K |
| `assets.caption_keyframes` | Gemini main (vision) | Gemini lite | 1200 | ≤ 12 images + 400 text tokens |
| `match.disambiguate` | Groq | Gemini lite | 300 | ≤ 1.5K |
| `clips.rerank_copy` | Gemini main | Groq | 1500 | ≤ 2.5K |
| `sponsors.integration` | Gemini main | Groq | 600 | ≤ 1.5K |
| `twin.chat` | Gemini main | Groq | 700 | ≤ 2K |
| `twin.style_extract` | Gemini lite | Groq | 600 | ≤ 2.5K |
| `insights.narrate_ideas` | Gemini main | Groq | 1000 | ≤ 2K |

Model ids come from env (`GEMINI_MODEL_MAIN`, `GEMINI_MODEL_LITE`, `GROQ_CHAT_MODEL`), never hard-coded. Free-tier model lists change; copy the exact ids from AI Studio and the Groq console on day 1.

**Gateway behaviour (in order)**
1. Build prompt from `prompts/<task>.md` + `build_creator_context()`.
2. Cache lookup: key = `sha256(task + schema_version + normalized_prompt + image_hashes)`. Hit → return, log `cache_hit=true`.
3. Pick the first provider in the chain whose circuit is closed and whose estimated tokens fit (Groq is skipped if the estimate, `len(text)/4`, exceeds 6,000).
4. **Rate limit** via Redis sliding window shared by all processes: keys `rl:gemini:rpm`, `rl:groq:rpm`, `rl:groq:tpm`. Defaults: Gemini 8 req/min, Groq 20 req/min and 6,000 tokens/min (conservative under the limits). If no slot opens within 25 s, raise `LLM_BUSY`.
5. Call provider in JSON mode (Gemini: `response_mime_type="application/json"` with the Pydantic class as `response_schema`; Groq: JSON object mode plus the schema printed in the prompt).
6. Validate with Pydantic. On failure, **one repair retry** ("Return only valid JSON matching the schema. Previous output was invalid: {error}"). Still invalid → next provider.
7. HTTP 429 or 5xx → exponential backoff (1 s, 2 s, 4 s, max 3 tries), honouring `Retry-After`. Three consecutive failures open the provider's **circuit for 60 s**.
8. All providers exhausted → raise `LLM_BUSY`; endpoints return 503, jobs mark the stage failed with a retryable error.
9. On success write cache + `llm_usage`.

### 7.2 Creator context block (prepended to every creative task)

```
CREATOR: {display_name} | DOMAIN: {domain} | AUDIENCE: {audience} | TONE: {tone}
STYLE: {style_profile.summary}
FAVOR: {vocab.favor[:5]} AVOID: {vocab.avoid[:5]}
SIMILAR PAST WORK (top 3 by similarity): {memory snippets, 60 words each}
```
Total cap ≈ 350 tokens. Retrieval of past work uses `twin_memories` with MiniLM cosine (top 3).

### 7.3 Prompt templates (stored in `app/llm/prompts/*.md`)

All prompts begin with: *"You are CreatorAi, an assistant for a solo video creator. Output ONLY JSON matching the schema. No markdown, no commentary."* followed by `{creator_context}`.

| Task | Task-specific instructions (summary) |
|---|---|
| `director.plan` | Inputs: idea, objective, platform, target duration, domain template (structure archetypes, hook styles, pacing norms). Produce the section 6.4 JSON. Shot list must have one entry per planned scene. Keep `structure[].duration_sec` summing to the target duration ±10% |
| `director.review` | Inputs: computed scores and metrics, up to 5 snippets (weakest hook, longest pause region, lowest-coverage beats), missing beats. Produce strengths, `issues[].fix`, `suggestions`. **Do not change the scores.** Each issue must cite `at_sec` or `scene_idx` taken from the inputs |
| `script.hooks` | Produce N hooks (default 5), each ≤ 18 words, covering varied hook types (question, number, bold claim, story, contrast). Return `[{"text","type","why"}]` |
| `script.generate` | Inputs: topic, chosen hook, tone, platform, length_sec, Director plan structure (if present). Produce `body_md`, `scenes[].beats[]` (each beat 1–2 sentences, spoken style) and `meta`. Total spoken words ≈ `length_sec × 2.5`. First scene must start with the chosen hook verbatim |
| `script.meta` | Inputs: final script text. Produce 3 titles (≤ 70 chars), a description (first 2 lines contain the keyword and the hook), 2 CTAs, 2 captions, tags (≤ 10), pinned comment, 2 thumbnail text options |
| `assets.caption_keyframes` | Inputs: N images labelled `shot_0 … shot_N` plus the transcript line spoken near each. Return per shot: caption (≤ 20 words), 3–6 tags (people, objects, setting, action), plus one asset-level `description` (≤ 40 words) and up to 8 asset-level tags |
| `match.disambiguate` | Inputs: one beat text and two or three candidate transcript spans. Return the best candidate id and a confidence 0–1 |
| `clips.rerank_copy` | Inputs: up to 8 candidates `{id, start, end, text, features}` and the Director plan objective. Pick the best 4 (complete thought, strong first sentence, no dangling context). Return section 6.7 JSON. Titles ≤ 70 chars, hooks ≤ 15 words, captions ≤ 150 chars with up to 3 hashtags |
| `sponsors.integration` | Inputs: brief, 100 words of transcript before and after the slot, creator context. Write a natural `duration_sec` read in the creator's voice that bridges from the preceding sentence, mentions the key points, ends with the CTA, and never uses `do_not_say` phrases. Also return a 6-word lower-third text and a one-line transition-back sentence |
| `twin.chat` | Inputs: user message, scope context (content item summary, clip summary: duration, caption style, pause stats), style profile, retrieved memories, allowed action types. Return section 6.8 JSON. Only propose actions that match the allowed types and ids provided |
| `twin.style_extract` | Inputs: last 5 approved scripts (trimmed to 200 words each) and the current style summary. Return updated `tone_descriptors`, `vocabulary`, `dos`, `donts`, `summary` |
| `insights.narrate_ideas` | Inputs: the aggregated tables from section 6.9 (top 3 rows each) and the top 5 existing titles. Return `narrative[]` (3 bullets), `caveats[]`, and 5 `ideas[{title, rationale}]` that follow winning hook types, topics and lengths and are not duplicates of existing titles |

### 7.4 Token budget (one hero project, estimates not measurements)

| Call | Provider | In / out tokens |
|---|---|---|
| Director plan | Gemini | 1.5K / 1.2K |
| Hooks | Gemini lite | 0.8K / 0.5K |
| Script generate | Gemini | 2.2K / 2.0K |
| Script meta | Gemini lite | 1.2K / 0.8K |
| Keyframe captions (12 frames × 258 tokens + text, 1 call) | Gemini | 3.6K / 1.2K |
| Match disambiguation (0–3 calls) | Groq | 1.2K / 0.2K each |
| Director review | Gemini | 2.0K / 1.0K |
| Clip rerank + copy | Gemini | 2.2K / 1.3K |
| Sponsor integration (up to 3 slots, 1 call each) | Gemini | 1.2K / 0.5K each |
| Twin chat (per message) | Gemini | 1.8K / 0.5K |
| Twin style extract (every 5 approvals) | Gemini lite | 2.2K / 0.5K |
| Insights narrate + ideas | Gemini | 1.8K / 1.0K |
| **Total for the full demo path** | | **about 14–18 calls, 45–60K tokens** |

Never send a whole video to Gemini (a 10-minute video is about 160–180K tokens). Never send a whole transcript either: send snippets chosen by embeddings and the scorer.

---

## 8. Pipelines and algorithms (exact behaviour)

All thresholds below live in `config.py` (section 13) so they can be tuned without code changes.

### 8.1 `asset.process` (video, audio, image, document)

| Stage | What happens |
|---|---|
| probe | `ffprobe -v error -print_format json -show_format -show_streams <file>` → duration, width, height, fps (from `avg_frame_rate`), `has_audio`. Save to `assets` |
| audio (video/audio) | `ffmpeg -i original -vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 48k audio/full.mp3` |
| proxy (video) | `ffmpeg -i original -vf scale=-2:480 -c:v libx264 -preset veryfast -crf 28 -force_key_frames "expr:gte(t,n_forced*2)" -c:a aac -b:a 96k -movflags +faststart proxy.mp4`; poster `thumb.jpg` at 1 s |
| silence + energy | Decode `full.mp3` to 16 kHz mono PCM. Energy = RMS in dB per 0.5 s window (numpy). Silences: `ffmpeg -i audio/full.mp3 -af silencedetect=noise=-35dB:d=0.6 -f null -`, parse `silence_start/silence_end` from stderr. Store in `assets.analysis` as `{"silences": [[s,e],...], "energy": [dB per 0.5 s]}` |
| transcribe | Section 8.2 |
| segments | Section 8.3 |
| shots (video) | PySceneDetect `detect(path, ContentDetector(threshold=27, min_scene_len=15))`. If fewer than 3 shots (talking head), use fixed 20 s shots |
| keyframes (video) | One frame at each shot midpoint (max 12 captioned shots, evenly spaced; other shots inherit tags from the nearest captioned shot). `ffmpeg -ss <t> -i original -frames:v 1 -vf "scale='if(gt(iw,ih),384,-2)':'if(gt(iw,ih),-2,384)'" -q:v 3 keyframes/shot_NNN.jpg` so both sides are ≤ 384 px (258 tokens each) |
| caption | **One** `assets.caption_keyframes` call (images + nearest transcript line each). Fills `asset_shots.caption/tags`, `assets.description`, `assets.tags`. Images (kind `image`) are captioned in batches of 12 in the same way |
| embed | Embed segment texts, and shot `caption + ". " + tags`. Save vectors |
| finalize | `assets.status='ready'`; if the content item has a current script and all its assets are ready, enqueue `project.match` |

- **Audio-only assets** skip proxy/shots/keyframes. **Images** skip audio/ASR/shots. **Documents** (`.txt`, `.md`) get their text stored in `analysis.text`; other document types are stored only.
- On failure at any stage set `assets.status='failed'` with `error`; `POST /assets/{id}/reprocess` resumes from the first stage missing in `analysis.stages_done`.

### 8.2 Transcription (Groq Whisper, fallback faster-whisper)

1. If duration ≤ 600 s: one chunk. Otherwise choose split points near multiples of 600 s: pick the silence interval whose midpoint is within ±30 s of the target (nearest wins); if none, split exactly at the target. Cut with `ffmpeg -ss a -to b -i audio/full.mp3 -c copy audio/chunk_NNN.mp3`. Each chunk must be **< 25 MB** (at 48 kbps, a 10-minute chunk is about 3.6 MB).
2. Call Groq `whisper-large-v3-turbo`: `response_format="verbose_json"`, `timestamp_granularities=["word","segment"]`, `temperature=0`, `language` from the profile (omit when `auto`). Calls run sequentially per asset to stay under 20 requests/minute.
3. Add each chunk's start offset to all word and segment times.
4. If the response contains no word-level timestamps (verify on day 1), derive words from each segment by splitting on whitespace and interpolating times proportionally to character length.
5. If Groq returns 429/5xx three times or the daily audio allowance is exhausted, fall back to local `faster-whisper` (`small`, `compute_type="int8"`, `word_timestamps=True`, `vad_filter=True`).
6. Store the language and provider in `assets.analysis.asr`.

### 8.3 Segmenting (`ml/segments.py`)

`segments_from_words(words, min_len=4.0, max_len=20.0)`: accumulate words; close the segment when (a) the word ends with `.`, `?` or `!` and length ≥ `min_len`, or (b) length ≥ `max_len`, or (c) the gap to the next word is ≥ 1.2 s and length ≥ 2 s. Then merge any segment shorter than 2 s into its neighbour. Output `{idx, start, end, text, words}`.

### 8.4 Embeddings and search

- Model: `EMBED_MODEL` (default `sentence-transformers/all-MiniLM-L6-v2`; use `paraphrase-multilingual-MiniLM-L12-v2` for Hindi/Hinglish; both are 384-d). Load once per process, L2-normalize, batch size 64, CPU.
- Search (`GET /search`) is **hybrid with Reciprocal Rank Fusion (k = 60)**:
  - Vector: top 30 from `asset_segments` and top 30 from `asset_shots` by `embedding <=> :q` (cosine distance).
  - Lexical: top 30 from `asset_segments` by `tsv @@ plainto_tsquery('simple', :q)` ranked with `ts_rank`.
  - Fuse ranks, merge hits from the same asset within 8 s, return the top `limit` with `{asset_id, filename, start_sec, end_sec, kind: 'speech'|'visual', snippet, thumb_url, score}`. Filters: `content_item_id`, `kind`.
  - Latency target: under 300 ms for a 10-minute asset.

### 8.5 Script-to-video matching (`project.match`)

1. **Inputs:** current script beats (with embeddings) in order; all `asset_segments` of the content item's ready video/audio assets, ordered by asset upload time then start. Assign each asset a global offset (sum of earlier asset durations) used only for ordering.
2. **Spans:** for every start segment, build spans of 1–4 consecutive segments (same asset) while total duration ≤ 45 s. If more than 3,000 spans, limit to 1–3 segments. Embed all span texts (batch).
3. **Similarity matrix** `S[beat][span]` = cosine.
4. **Monotonic alignment (DP).** Let θ = `MATCH_WEAK` (0.30) and gain `g = S − θ`. Sort spans by global end. For beat `i` and span `j`: `f[i][j] = g[i][j] + max(0, best_prev(j))`, where `best_prev(j)` is the maximum of `G[k]` over spans `k` with `end[k] ≤ start[j] + 1.0 s` (tolerance), and `G[k] = max over previous beats i' < i of f[i'][k]` (so beats can be skipped). Use a prefix-max over spans sorted by end and a precomputed cutoff index per span so each beat is one vectorised numpy pass: **O(beats × spans)**. Backtrack from the best final state. Beats not on the path are unmatched.
5. **Status:** matched span with `S ≥ MATCH_OK` (0.45) → `matched`; `θ ≤ S < 0.45` → `weak`. For an unmatched beat, take its best span ignoring order: if `S ≥ 0.45` → `weak` and mark `alternatives[0].out_of_order = true` (retakes or reordered footage); else `missing`. Store the top 3 alternative spans per beat.
6. **Ambiguity:** if the best two spans for a beat are both ≥ 0.45 and differ by < 0.03, call `match.disambiguate` (at most 3 beats per run, earliest first).
7. **Save** to `beat_matches` (upsert by `script_beat_id`, preserving rows with status `confirmed` or `rejected` set by the user).
8. **Missing scene** = a scene whose beats are all `missing`; a **weak scene** has any `weak` beat. Both show in the UI.

The thresholds (0.45 / 0.30) are starting points for MiniLM cosine scores; tune them on the hero footage and write the final values into `config.py`.

### 8.6 Hook signals (`ml/hooks.py`)

`hook_signals(text)` = average of four booleans on the **first sentence**: ends with `?` or starts with `why|how|what|did|do|are|is|can`; contains a digit or number word; contains a power word (`never, nobody, secret, mistake, stop, truth, biggest, worst, best, only, how i`); length between 6 and 22 words. Returns 0–1.

`classify_hook(text)` (for `yt_videos.hook_type`), first match wins: `question` → `number` → `story` (starts with `i `, `my `, `when i`, `last year`) → `bold_claim` (power words) → `other`.

### 8.7 Director review metrics (deterministic)

Computed from the asset transcript, silences and matches before the LLM is called:

| Metric | Formula |
|---|---|
| `coverage` | `100 × (matched + confirmed + 0.5 × weak) / total beats` |
| `hook` | `100 × (0.7 × hook_signals(first 15 s) + 0.3 × (first speech starts ≤ 2 s ? 1 : 0.6))` |
| `pacing` | `100 × (0.5 × (1 − min(1, abs(wpm − 160)/80)) + 0.5 × (1 − min(1, pause_ratio/0.25)))` where `pause_ratio` = total silence ≥ 0.6 s ÷ duration |
| `clarity` | `100 × (0.6 × (1 − min(1, fillers_per_100_words/8)) + 0.4 × (1 − min(1, max(0, avg_sentence_words − 18)/18)))`, fillers = `um, uh, you know, like, basically, actually, so` |
| `cta` | 100 if a CTA phrase (`subscribe, follow, comment, link in, check out, sign up, download, share`) appears in the final 20% of the transcript, else 40 |
| `overall` | `0.25 hook + 0.20 clarity + 0.20 pacing + 0.25 coverage + 0.10 cta` |

Candidate issues are also computed in code: the top 3 silences ≥ 2.5 s (`at_sec`), the 3 lowest-coverage scenes, hook < 60, CTA missing, and filler-dense windows. The LLM turns these into `fix` text only.

### 8.8 Clip generation (`clips.generate`)

1. **Source asset:** `asset_id` from the request, else the longest ready video asset of the content item.
2. **Candidate windows:** start only at segments whose previous segment ended a sentence. Extend through consecutive segments until duration ≥ `CLIP_MIN` (20 s); the first boundary at or after 20 s and ≤ `CLIP_MAX` (45 s) closes the window. Windows that cannot close within 45 s are dropped.
3. **Features** (min-max normalised across windows of the asset):
   - `beat_similarity`: max cosine between the window embedding and any script beat (0 and weights redistributed if no script)
   - `hook_signals` of the first sentence
   - `speech_rate`: `1 − min(1, abs(words/sec − 2.7)/1.5)`
   - `audio_energy`: mean energy (dB) in the window
   - `emphasis`: mean absolute VADER compound over the window's sentences
   - `visual_change`: `min(1, shots_in_window / (duration/10))`
4. **Score** = `0.30 beat + 0.20 hook + 0.15 rate + 0.15 energy + 0.10 emphasis + 0.10 visual`.
5. **Non-max suppression:** sort by score, keep a window only if its IoU with every kept window is < 0.3. Keep the top 8.
6. **LLM rerank + copy** (one call). Keep 4. If the call fails, keep the top 4 by score and generate fallback copy from the first sentence (title = first 8 words, hook = first sentence, caption = first 150 characters).
7. **Pause removal:** for each silence ≥ `SILENCE_MIN_SEC` inside a clip, drop the silence but leave `PAUSE_KEEP_SEC` (0.15 s: half before, half after). Trim leading and trailing silence of the clip. Each remaining range becomes a `VideoItem` (`source: "ai"`, `reason: "pause removed"` on the item after a cut).
8. **Reframe:** for each video item sample the proxy once per second, run OpenCV Haar (`haarcascade_frontalface_default.xml`, `scaleFactor=1.1`, `minNeighbors=5`, `minSize=proxy_height/10`), take the largest face centre, and use the **median x (0–1)** as `crop_x`; `0.5` if no face is found. `crop_x` is always computed so a timeline can be rendered at any aspect.
9. **Captions:** build from word timestamps (section 8.9). **Music:** only if the library contains an audio asset tagged `music`; add one `AudioItem` (`-18 dB`, `source: "ai"`, `status: "suggested"`).
10. Create `clips` rows, one `edits` row each (`revision = 1`) and `edit_revisions` revision 1. Optional `include_full_cut=true` also creates one `kind='full'` clip (all speech, pauses removed, 16:9, `minimal_bottom` captions).
11. Default `caption_style` comes from `style_profile.captions.style`, else `bold_center`.

### 8.9 Captions, presets and rendering

**Caption building** (`lib/timeline/captions.ts` on the client and `media/captions_ass.py` on the server share these rules): for each non-rejected video item, take the transcript words within `[src_in, src_out]`, map time with `t_tl = tl_start + (t − src_in)`, group into lines (`bold_center`/`karaoke`: 3 words, `minimal_bottom`: up to 7 words, max 2 s per line), set `tl_start/tl_end` from the first and last word (extend the end up to the next line's start minus 0.02 s or +0.3 s), clamp to the item.

**Presets** (`media/presets.py`; duration caps are conservative defaults, confirm each platform's current limits)

| Preset | Aspect | Resolution | Max duration | Default caption style | Use |
|---|---|---|---|---|---|
| `yt_short` | 9:16 | 1080×1920 | 60 s | `bold_center` | Publishable to YouTube |
| `reels` | 9:16 | 1080×1920 | 90 s | `bold_center` | Download only |
| `tiktok` | 9:16 | 1080×1920 | 60 s | `karaoke` | Download only |
| `yt_long` | 16:9 | 1920×1080 | none | `minimal_bottom` | Publishable to YouTube |

A render request is `{preset, caption_style?}`; the render copies the timeline, sets aspect/size from the preset and applies the chosen caption style (items with `style_override` keep theirs). If the timeline duration exceeds the preset cap the API returns `422 DURATION_EXCEEDS_PRESET` with the cap and suggests trimming.

**ASS captions** (`captions_ass.py`): `PlayResX/Y` = output size; font sizes scale with output height (base values for 1920 px height).

| Style | Font | Size | Alignment | Notes |
|---|---|---|---|---|
| `bold_center` | Montserrat Bold | 84 | 5 (middle centre) | uppercase, white, black outline 6 |
| `minimal_bottom` | Inter Regular | 52 | 2 (bottom centre), MarginV 160 (9:16) / 60 (16:9) | semi-transparent box (`BorderStyle=3`) |
| `karaoke` | Montserrat Bold | 80 | 2, MarginV 420 | `{\kf}` per word, highlight yellow, base white |

For 16:9 output multiply sizes by 0.6.

**Render graph** (`render_graph.py`), all non-rejected items, run with `cwd` = a temp directory (avoids path escaping in filters):

```
for each video item i (sorted by tl_start):
  [src:v] trim=start=src_in:end=src_out, setpts=PTS-STARTPTS,
          (9:16 target and source wider than 9:16:)
            crop=w=ih*9/16:h=ih:x='max(0,min(iw-out_w,{crop_x}*iw-out_w/2))':y=0,
          scale=W:H:force_original_aspect_ratio=increase, crop=W:H, setsar=1, fps=30   → [v_i]
  [src:a] atrim=start=src_in:end=src_out, asetpts=PTS-STARTPTS, aresample=48000        → [a_i]
  (source without audio: anullsrc of the item duration)
  (sponsor placeholder: color=c=#111111:s=WxH:r=30:d=dur + overlay of a Pillow card PNG,
   and anullsrc for audio)
join:  concat=n=N:v=1:a=1                       (all transitions = cut)
   or  xfade/acrossfade chain with offset_k = (running_duration − d_k),
       running_duration += dur_k − d_k          (when any transition_in has dur > 0)
overlays: for each lower_third/text → PNG from cards.py, overlay=enable='between(t,s,e)'
captions: subtitles=captions.ass:fontsdir=<repo>/assets/fonts
music/sfx/voiceover: atrim, asetpts, volume={gain_db}dB, adelay={ms}|{ms}, then
          amix=inputs=K:duration=first:normalize=0   (FFmpeg 7+; on older builds drop
          normalize=0 and raise the voice stream volume to compensate)
encode: -c:v libx264 -preset {RENDER_X264_PRESET} -crf 20 -pix_fmt yuv420p -r 30
        -c:a aac -b:a 160k -ar 48000 -movflags +faststart
progress: -progress pipe:1 (parse out_time_ms / (duration × 1e6))
```

Renders read the **original** file. Output goes to `data/renders/{id}.mp4` with a poster frame at 1 s. For the demo set `RENDER_X264_PRESET=veryfast`.

### 8.10 Sponsor slot detection (`ml/sponsor_slots.py`)

1. Source: the content item's primary video asset (same selection as clips), its segments (with embeddings), silences, and the brief embedding (`brand + product + key_points`).
2. **Candidate boundaries:** every boundary between segment `i` and `i+1` with time in `[0.15 × D, 0.90 × D]` and at least 15 s from the start and 20 s from the end.
3. Per boundary:
   - `topic_shift` = `1 − cos(mean(emb[i−2..i]), mean(emb[i+1..i+3]))`, min-max normalised
   - `pause` = `min(1, gap_seconds / 1.5)` where the gap is `start[i+1] − end[i]` plus any overlapping silence
   - `relevance` = `cos(brief_emb, mean(emb[i−2..i]))`, min-max normalised
4. `score = 0.40 topic_shift + 0.30 pause + 0.30 relevance`. Take the top 3 with a minimum separation of `max(90 s, D/3)`.
5. `kind`: `both` if pause ≥ 0.6 s-equivalent (pause ≥ 0.4) and topic_shift ≥ 0.5, `topic_shift` if only the latter, otherwise `pause`.
6. **One batched LLM call** writes `integration_script`, a 6-word lower-third text and a transition-back line for all 3 slots, using 100 words of transcript around each.
7. **Accept** (`POST /sponsor-slots/{id}/accept {clip_id}`): map `at_sec` into the clip's timeline (error `SLOT_OUTSIDE_CLIP` if outside). Split the containing video item at that point, insert a `VideoItem` with `kind: "sponsor"`, `asset_id: null`, `placeholder: true`, `src_in = 0`, `src_out = brief.duration_sec`, `text = integration_script`, ripple later items and captions, add a `lower_third` overlay `"Sponsored · {brand}"`, and add caption items from the script (estimated at 2.5 words/second). When the creator later records the sponsor segment, linking an asset in the inspector sets `asset_id`, clears `placeholder` and the captions can be regenerated.
8. When publishing, if any accepted sponsor slot is in the rendered timeline, the publish form pre-appends `This video includes a paid promotion from {brand}.` to the description (editable) and shows a reminder to use YouTube's paid promotion disclosure.

### 8.11 Digital Twin updates (`twin.update`)

- **Approval events:** a clip set to `accepted`, and a successful publish. A script counts as approved when its content item moves to `shoot`.
- On each event, compute deterministic stats from the clip timeline: `avg_segment_sec`, `cuts_per_min`, words per minute, caption style, whether the AI music layer was kept. Update `style_profile.pacing/captions/visual` with an exponential moving average (α = 0.3). Write a `twin_memories` row (`approved_clip`: title + hook + first 60 words; `approved_script`: first 200 words) with its embedding. Increment `approvals_since_style_update`.
- When it reaches 5, enqueue `twin.update`, which calls `twin.style_extract` on the last 5 approved scripts and rewrites `tone_descriptors`, `vocabulary`, `dos`, `donts`, `summary`; reset the counter and bump `style_profile_rev`.
- Layer rejections are logged to `activity_log`. If the same layer type (`music`, `caption`, `transition`) was rejected in ≥ 3 of the last 5 clips, add a `preference` memory (for example "Usually rejects AI music") and an entry in `donts`.
- Retrieval for prompts: top 3 `twin_memories` by cosine to the task text.

### 8.12 Insights computation (`insights_service`, pandas)

- Load `yt_videos` joined with `yt_metrics_daily` for the range (default 90 days). Per video: `views` = sum, `avg_view_pct` = views-weighted mean, `views_per_day` = views ÷ days since publish.
- Exclude videos published less than 7 days ago from rankings and add a caveat.
- Group by `hook_type`, `topic` (empty topics show as "Uncategorized") and **length bucket** (Shorts: `<15, 15-30, 30-45, 45-60, 60+` seconds; long-form form its own bucket). Report videos, mean views and mean `avg_view_pct`. A group needs ≥ 2 videos to be ranked, otherwise it is flagged "not enough data".
- Rank score: `0.5 × z(avg_view_pct) + 0.5 × z(views_per_day)`.
- `top_videos`: top 5 by rank score.
- `insights.narrate_ideas` (one call) turns the top 3 rows of each table into 3 bullets, caveats and 5 new ideas, which are stored as `idea_suggestions` (source `insights`).
- `topic` and `hook_text` are editable per video in the Insights table; videos published through CreatorAi get them automatically (topic tag from the publish form, hook from the chosen hook).
