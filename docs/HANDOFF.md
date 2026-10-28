# Handoff: project state for the next engineer (or agent)

Read this first, then [RUNBOOK.md](RUNBOOK.md) to run it and [TODO.md](TODO.md) for what to build next.
Snapshot: `main` after the monetization, YouTube publishing, Twin actions, account security and landing clean-up merges
(October 2026). Everything below was checked against the code on that snapshot.

## 1. What CreatorAi is, in one paragraph

A single-creator, local-first video workflow tool: idea board, AI script/plan, footage library with automatic
analysis and semantic search, script-to-footage matching, smart clips, an editable timeline and rendering. It is a
FastAPI + SQLite backend and a Next.js frontend. [Plan.md](../Plan.md) is the product plan and the binding reference
for schema, JSON contracts and algorithms; [LOCAL_FIRST.md](LOCAL_FIRST.md) overrides it for infrastructure.

## 2. What is built

Status key: **done** = implemented and tested; **partial** = works with stated limits.

| Module | Where | Status | Tests |
|---|---|---|---|
| Core: config, SQLite + migrations, errors, auth (scrypt + JWT), signed media, storage, logging | `backend/app/{config,db,errors,security,deps,main}.py`, `storage/`, `migrations/` | done | `test_config`, `test_security`, `test_migrations`, `test_storage`, `test_auth` |
| Job runner (3 thread pools), SSE pub/sub, retries, cancel, nightly scheduler | `backend/app/workers/`, `api/v1/jobs.py` | done | `test_jobs`, `test_pubsub` |
| LLM gateway: Gemini, Groq, Ollama, opt-in mock; cache, rate limits, circuit breaker, repair retry, prompts, provenance | `backend/app/llm/`, `api/v1/llm.py` | done (real providers tested against recorded HTTP only, see section 7) | `test_gateway`, `test_providers_http`, `test_llm_tasks`, `test_ratelimit`, `test_routing_and_provenance` |
| Uploads (resumable, chunked, dedupe) and assets | `api/v1/{uploads,assets}.py`, `services/{uploads,assets}.py` | done | `test_uploads`, `test_asset_pipeline`, `test_media` |
| Ingest pipeline (probe, audio, proxy, silence, ASR, segments, shots, keyframes, captions, embed) | `services/ingest/`, `ml/{asr,segments,shots,silence,energy,transcripts}`, `media/`, `workers/tasks/asset_process.py` | done (per-chunk ASR checkpointing is not implemented) | `test_asset_pipeline`, `test_asr`, `test_transcripts`, `test_segments`, `test_silence_energy_shots`, `test_ffmpeg`, `test_ingest_units` |
| Embeddings and hybrid search (vectors + FTS5, RRF) | `ml/{embedder,vectors}.py`, `services/search_service.py`, `api/v1/search.py` | done (hashing fallback when the model is missing) | `test_embedder`, `test_vectors`, `test_search_units`, `test_search` |
| Content board, ideas, activity | `api/v1/{content,ideas,activity}.py`, `services/{content_service,activity}.py` | done | `test_content_board` |
| Scripts, hooks, meta, versions, approval | `api/v1/scripts.py`, `services/script_service.py`, `ml/hooks.py` | done | `test_scripts_flow`, `test_script_units`, `test_hooks` |
| AI Director plan + deterministic review | `api/v1/director.py`, `services/director_service.py`, `ml/review_metrics.py` | done | `test_director_flow`, `test_director_units`, `test_review_metrics` |
| Script-to-footage matching (DP alignment) | `api/v1/matching.py`, `services/match_service.py`, `ml/alignment.py`, `workers/tasks/project_match.py` | done (thresholds tuned on demo footage only) | `test_alignment` (incl. brute-force cross-check), `test_matching_flow` |
| Smart clips (window scoring, face reframe, rerank copy) | `api/v1/clips.py`, `services/clip_service.py`, `ml/{scoring,faces}.py`, `workers/tasks/clips_generate.py` | done | `test_scoring`, `test_clips_flow` |
| Timeline model, ops, edit API with optimistic concurrency and revisions | `schemas/timeline.py`, `services/{timeline_service,edit_service}.py`, `api/v1/edits.py` | done | `test_timeline` (49 incl. property tests), `test_timeline_golden`, `test_edits_flow` |
| Render/export (presets, ASS captions, cards, ffmpeg graph) | `media/{render_graph,presets,captions_ass,cards,fonts}.py`, `services/render_service.py`, `api/v1/renders.py`, `workers/tasks/render_run.py` | done | `test_media_planning`, `test_render_media`, `test_renders_flow` |
| Demo seed and synthetic footage | `backend/scripts/{seed_demo,demo_data,make_demo_media}.py` | done | `test_seed_demo` |
| Twin events and learning | `services/twin_events.py`, `services/twin.py` | done: `script_approved` and `clip_accepted` become memories, `layer_rejected` becomes preferences; chat actions apply as revisions | `test_twin_events`, `test_twin` |
| Dev tooling: `make doctor`, `make reset-password`, dev/e2e runners | `scripts/`, `backend/scripts/reset_password.py` | done | `test_reset_password` |
| Frontend shell, auth, onboarding, board, dashboard, settings, jobs | `frontend/src/app/{(public),(flow),(app)}`, `components/{shell,board,auth,onboarding,provenance}` | done | `e2e/app.spec.ts` |
| Asset library, search, upload dialog, asset drawer | `components/{library,media}`, `lib/upload.ts` | done | `e2e/library.spec.ts` |
| Project pages: plan, script, footage, match, clips (+renders), AI hubs | `app/(app)/projects/[id]/*`, `components/{plan,script,match,clips,hubs,projects}` | done | `e2e/projects.spec.ts`, `e2e/mock/generation.spec.ts` |
| Timeline editor | `app/(app)/editor/[clipId]`, `components/editor`, `lib/timeline`, `lib/editor`, `stores/editor.ts` | done for Edit and Preview modes | vitest (golden, 150 randomized sequences, engine, merge) + `e2e/editor.spec.ts` |
| Landing page (marketing) | `components/landing`, `app/(public)/page.tsx` | done: own renders only, no third-party media | none |
| Monetization: deals, rate estimate, pitch, brand lookup; sponsor briefs, slots, accept into a clip, link the recording | `api/v1/{monetization,sponsors}.py`, `services/{monetization,sponsor_service}.py`, `ml/sponsor_slots.py`, `/monetization`, project Sponsors tab | done | `test_monetization`, `test_sponsor_slots`, `e2e/monetization.spec.ts`, `e2e/sponsor-link.spec.ts` |
| YouTube connection, publishing, stats sync | `api/v1/{youtube,publish}.py`, `integrations/youtube.py`, `services/{youtube,publish}_service.py`, jobs `publish.upload`, `analytics.sync` | done against a fake Google; unverified on a live channel | `test_youtube_publish`, `e2e/publish.spec.ts` |
| Account security and data: password change, sign out everywhere, login throttling, export, wipe | `services/account_admin.py`, migration `010` | done | `test_account_security`, `e2e/account.spec.ts` |
| AI usage report, ASR chunk checkpoints | `services/usage.py`, `services/ingest/transcribe.py` (`ChunkStore`) | done | `test_content_board` (usage), `test_ingest_units` |

## 3. What is NOT built

All routers listed in `api/v1/__init__.py` exist. `sponsors` and `monetization` (migration `009`), `publish` and `youtube`
are built; the YouTube client was verified against a recorded fake of Google, not a live channel. Built since the first handoff: teams and RBAC (`team`, `comments`),
`insights`, `twin`, `research`, calendar scheduling (`content_items.scheduled_for`) and styled text overlays.

| Feature | Plan section | State |
|---|---|---|
| Editor Audio, Color, Structure modes | UI spec | not present (no backend) |
| Password reset by email, Google sign-in | 0 | deferred by decision |
| Plan 7.4 token budget | 7.4 | intentionally not built |
| S3/R2 storage, Redis/Postgres | 3 | deferred; interfaces exist for storage |

Full, prioritised list with acceptance criteria: [TODO.md](TODO.md).

## 4. Key decisions and why

1. **Local-first overrides Plan.md** ([LOCAL_FIRST.md](LOCAL_FIRST.md)). Goal: clone and run with no Docker, Redis,
   Postgres or accounts. Cost: single machine, single writer.
2. **SQLite (WAL) + numpy vectors + FTS5** instead of Postgres + pgvector. One file to back up; brute-force cosine is
   fine at one creator's scale (`ml/vectors.py` isolates it). SQL migrations are the schema source of truth; models
   mirror them and `create_all` is never used.
3. **In-process job runner** (thread pools `media` 1, `llm` 2, `io` 1) with the `jobs` table as truth and an
   in-memory pub/sub for SSE. Jobs left running at boot are marked failed (retryable). It cannot survive multiple API
   processes; the Redis/RQ path is in TODO.
4. **Provenance contract**: every response that contains generated content carries `provenance {source, provider,
   model}` and the UI badges it. Rationale: the owner's rule that nothing fake may look real.
5. **No silent mock.** Without a provider the gateway raises `LLM_NOT_CONFIGURED`; the mock provider exists only
   behind `LLM_ALLOW_MOCK=true`, is never cached, prefixes text with `[MOCK]` and turns the UI banner red. Tests set
   the flag explicitly; the config default is false.
6. **Everything not AI is labelled** (`heuristic` for the hashing embedder, rule-based scores, fallback clip copy;
   `demo` for seeded data; `user` for human edits). Mixed results report the weakest source.
7. **Optimistic concurrency on edits**: `edits.revision` with compare-and-swap on `base_revision`, `409
   REVISION_CONFLICT`, linear `edit_revisions`. The future Twin applies actions through the same ops endpoint, so
   agent and user can never silently overwrite each other.
8. **Deterministic review scores** (`ml/review_metrics.py`) so Director review numbers are reproducible and not an
   LLM's opinion; the LLM only writes wording. They are badged Heuristic.
9. **Timeline logic lives twice** (Python service, TypeScript mirror) with a **golden file** generated from Python
   and replayed in vitest plus randomized property tests, so the two cannot drift.
10. **LLM calls happen before write transactions** (SQLite has one writer; the gateway logs usage in its own
    session). Handlers read, call, then write.
11. **Media is never exposed by path**: signed, expiring `/media/{key}?exp=&sig=` URLs with Range support.
12. **OpenCV pinned `<5`** and **scenedetect `<0.7`**: OpenCV 5 dropped `CascadeClassifier` and Haar files (face
    reframing), and scenedetect 0.7 hard-requires `opencv-python` which installs OpenCV 5 over the headless 4.x
    build. `make setup` repairs an environment hit by this.
13. **The embedding model cache lives in `data/models/fastembed`** (fastembed's default is the OS temp directory,
    which is purged).
14. **Sync everywhere on the backend** (no async), simple threading model.

## 5. Contracts never to break

- **Provenance**: `{source: ai|mock|heuristic|demo|user, provider, model}` on generated payloads; seeded rows are
  always `demo`; weakest wins (`schemas/common.py`, `Provenance`, `weakest`). Helpers: `meta.provenance`,
  `Provenance.heuristic/demo/user`. The UI must show a badge for anything not `ai`/`user`.
- **Timeline invariants** (Plan section 6.1, checked by `timeline_service.validate()` on every save and mirrored in
  `frontend/src/lib/timeline/validate.ts`): (1) video items sorted by `tl_start`, gapless and non-overlapping
  (rejected items are skipped); (2) `0 <= src_in < src_out <= asset.duration`; (3) captions and overlays satisfy
  `0 <= tl_start < tl_end <= duration`; (4) ids unique; (5) `duration` equals the recomputed value. Items are strict
  (unknown fields rejected). **Golden file**: `frontend/src/lib/timeline/golden.json`; regenerate with
  `dump_timeline_golden.py` (RUNBOOK section 8); a backend test fails when it is stale and vitest replays it.
- **Error shape**: `{ "error": { "code", "message", "details" } }` with stable codes in `errors.ERROR_CODES`. The
  frontend maps several codes to specific UI.
- **Signed media URLs**: relative `/media/{key}?exp=&sig=`; never return storage paths; the browser prefixes the API
  origin (`mediaUrl()` / `withAccessToken()` in the frontend).
- **Workspace scoping**: every repository query takes `workspace_id` first; routers never touch SQL; services never
  import FastAPI.
- **Migrations are append-only**; update the model in the same commit.
- **Rendering rule**: a render includes every layer whose status is not `rejected`.
- **Auth**: bearer JWT; `GET` may use `?access_token=` (EventSource, `<video>`). Public endpoints: health, signup,
  login and `GET /youtube/oauth/callback` (Google redirects the browser there; a signed, 15 minute `state` names the workspace).

## 6. How to extend

Guides with code live in [BACKEND_FOUNDATION.md](BACKEND_FOUNDATION.md) (router, repository, job, LLM task, migration,
embeddings, ASR, storage, tests) and [frontend/README.md](../frontend/README.md) (page, API hook, conventions). Checklists:

**New backend router.** (1) `api/v1/<name>.py` with `router = APIRouter(prefix=..., tags=[...])`; the name must be in
`ROUTER_MODULES` (sponsors, publish, youtube, insights, twin already are). (2) Depend on `CtxDep`/`DbDep`; put logic in
`services/`, queries in `repositories/` (workspace first). (3) Response models, so `gen-api` types them. (4) Add
error codes to `errors.ERROR_CODES`. (5) Integration test in `tests/integration`. (6) Document in `docs/API.md`.
(7) `make gen-api`, commit `openapi.json` and `schema.d.ts`.

**New job handler.** `workers/tasks/<name>.py` with `register_job("x.y", handle)`; path in `HANDLER_MODULES`
(`workers/__init__.py`); idempotent, `ctx.progress(...)`, JSON payload; test with `JOBS_INLINE=true`.

**New LLM task.** Schema in `llm/schemas.py` (+`TASK_SCHEMAS`), route in `llm/tasks.py`, prompt in
`llm/prompts/<task>.md`, mock handler + `_MARKED` fields in `providers/mock.py`, sample in
`tests/unit/test_llm_tasks.py`; return `meta.provenance` in the response.

**New migration.** `backend/migrations/00N_name.sql`, never edit applied ones, update `app/models`, run
`make migrate`; `test_migrations` checks a fresh DB.

**New frontend page.** `src/app/(app)/<route>/page.tsx`, nav entry in `components/shell/nav.ts`, four states (skeleton,
`ErrorState`, `EmptyState`, data), provenance badge for generated content, `data-testid` on key elements, replace the
`NotAvailablePage` if it exists. **New API hook:** endpoint in `openapi.json` (`make gen-api`), key in `qk`, hook in
`lib/api/hooks.ts` with `unwrap(...)`, invalidate related keys, `trackJob(job_id)` after enqueueing.

**Before every commit:** `make lint && make test`; for UI changes also `make e2e`.

## 7. Conventions

- Commits: small and descriptive, `feat(area): ...`, `fix: ...`, `docs: ...`, `test: ...`; the repo's author identity is
  `Rayan Jain <rayansjain@gmail.com>`. **No AI attribution anywhere** (no Co-Authored-By, no "Generated with" lines)
  in commits, PRs or docs.
- Tests are required for behaviour changes; the suite must be green on `main`. Docs change in the same commit as behaviour.
- Python 3.11+, type hints, ruff (lint + format, line length 100). Frontend: TypeScript strict, ESLint (currently 8
  unused-variable warnings, all in `components/landing`).
- Branch names `feat/<area>`, `docs/<topic>`. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## 8. Branch history

All nine `feat/*` branches are merged into `main` (merge commits, in this order):

| Branch | Commits | What it merged |
|---|---|---|
| `feat/backend-foundation` | 9 | config, SQLite + migrations, auth, errors, job runner + SSE, LLM gateway (Gemini/Groq/mock), storage, signed media, health |
| `feat/real-ai-providers` | 2 | Ollama provider, provenance contract, mock as opt-in, real embeddings (fastembed) and ASR (Groq, faster-whisper), `/llm/test` |
| `feat/assets-ingest-search` | 8 | resumable uploads, ingest pipeline and stages, transcription chain, sidecars, keyframe captions, hybrid search |
| `feat/content-scripts-director` | 7 | board, ideas, scripts, hooks, AI Director plan/review, twin approval event registry |
| `feat/matching-clips-timeline` | 8 | DP alignment, matching, clips, timeline model and ops, edit API with revisions |
| `feat/render-export-seed` | 4 | render pipeline and presets, ASS captions, demo seed with the hero project |
| `feat/frontend-shell-auth-board` | 6 | rebuilt frontend shell, typed API client, auth, onboarding, board, settings, jobs, e2e harness |
| `feat/frontend-library-projects` | 5 | asset library, search, upload engine, project pages, AI hubs |
| `feat/frontend-timeline-editor` | 6 | timeline library with golden tests, editor UI, playback engine, autosave, history |

The branches still exist locally and on the remote for reference; they are fully merged and can be deleted.

Later branches, each merged into `main` with a merge commit after the backend suite, the frontend checks and the e2e suite
passed:

| Branch | What it merged |
|---|---|
| `fix/restore-green-build` | failing tests, type and lint errors from the previous push; the simulated monetization screen removed; routers mounted twice; yt-dlp safety; deterministic e2e |
| `feat/monetization` | brand-deal pipeline, rate estimate, pitch emails, brand lookup, sponsor slots and accept into a clip |
| `feat/youtube-publishing` | OAuth, resumable upload, scheduling, stats sync, Insights performance |
| `feat/twin-actions` | Twin trim and hook actions applied; preferences learned from rejected AI layers |
| `chore/landing-assets` | third-party videos and hotlinked images removed; WebP renders; landing lint clean |
| `fix/publish-form-layout` | publish form layout |
| `feat/account-security` | password change, sign out everywhere, login throttling, export, wipe; Content-Disposition over CORS |
| `feat/usage-and-asr-checkpoints` | AI usage report; per-chunk transcription checkpoints |
| `feat/link-sponsor-footage` | link a recorded sponsor segment to its placeholder in the editor |
| `fix/api-polish` | empty `OLLAMA_BASE_URL`, README clone path |

**Git history still contains the removed third-party promo videos** (about 22 MB). Purging them needs a history rewrite
(`git filter-repo`) and a force push of `main`; it was not done because it changes every commit id.

**Teammate `frontend` branch (origin/frontend).** A teammate (Vansh Jain) pushed a Next.js app under the directory
`build-creator-ai-app 2/` (commits `046e2e0`, `2886fb7`). On `main` that app was **moved to `frontend/`** (`1c17c9a`)
and then rebuilt on top by `feat/frontend-shell-auth-board`. **Warning: any new push to `origin/frontend` that still
uses the old path `build-creator-ai-app 2/` will conflict with `main` or recreate a stale second app.** Tell the
teammate to rebase onto `main` and work in `frontend/`. The landing page, 3D/GSAP visuals and promo assets in
`frontend/` came from that branch.

## 9. Test inventory

| Suite | Command | Count | Runtime (this sandbox) |
|---|---|---|---|
| Backend unit + integration (pytest) | `make test` (first half) | 754 collected, 1 skipped | ~95 s |
| Frontend unit (vitest) | `cd frontend && npm test` | 336 tests in 10 files | ~2 s |
| Frontend typecheck + eslint | `make test` / `make lint` | 0 errors, 0 warnings | ~15 s |
| Playwright e2e | `make e2e` | 68 tests in 13 files (two projects: `keyless` and `mock`); runs with the hashing embedder and no ASR so the result does not depend on cached models | about 4 minutes (builds the app) |
| ruff | `make lint` | clean | ~1 s |

Backend tests never touch the network and need no keys (hashing embedder, mock enabled explicitly; real providers
via `httpx.MockTransport`; binary fixtures generated on the fly). The e2e suite runs on a throwaway seeded data dir
with no keys, plus a second project with mock on.

## 10. Environment constraints discovered (read before trusting any "works")

- **The build sandbox could not reach Groq, Ollama or Hugging Face.** The real Groq/Ollama/Gemini providers were tested
  only against recorded HTTP shapes. Real round trips, real Whisper word timestamps, structured output behaviour and
  rate-limit behaviour are **unverified**.
- **Gemini model ids** (`gemini-2.5-flash`, `gemini-2.5-flash-lite`) and the Groq/Ollama defaults
  (`llama-3.3-70b-versatile`, `gpt-oss:120b`, `qwen3-vl:235b`) are unverified against live free tiers; free-tier model
  lists change. They are env-configurable.
- **The embedding model was never downloaded in the sandbox**, so all matching/clip behaviour and the seeded hero
  numbers (for example 75% coverage) were produced with the **hashing embedder**. Thresholds `MATCH_OK/WEAK_ST` (0.45 / 0.30)
  are Plan defaults, not tuned; `MATCH_*_HASHING` were tuned on synthetic demo footage only.
- **H.264 playback is unverified in a decoding browser.** Playwright's Chromium cannot decode H.264, so the player's
  error path and seek target are tested, but real picture/audio playback and the editor engine's gapless swaps were only
  unit-tested with fake media elements.
- The generated demo footage is solid colour scenes with tone bursts for speech; real footage will behave differently
  (face reframing, silence detection, shot detection, scoring).
- FFmpeg tested was 6.1.1 (amix `normalize` is handled for versions below 7).

## 11. Verify on your machine first (30 minutes)

Do these in order; each one converts an "unverified" above into a fact. Record results in the TODO tasks (g, h).

1. `make doctor`, `make setup`, `make seed`, `make dev`. Confirm Settings shows the embedder as **real** (not Heuristic).
   If not: `make models`, restart, `POST /api/v1/search/reindex {"force": true}`.
2. Add keys (at least Gemini; Groq if you want Whisper) to `.env`, restart, Settings, **"Test my keys"**: each provider
   must say works with a model and latency. Fix model ids if a provider says model not found.
3. Open the hero project and **play a clip in Chrome** (footage tab and the editor): picture, audio, seeking, gapless
   cuts, audio layers. Try Safari/Firefox if relevant.
4. **Run a real ASR upload**: upload a 1 to 3 minute talking-head clip (no sidecar). Confirm transcript words and times
   in the asset drawer, `provider` = groq or faster-whisper, captions in the editor align.
5. **Generate with AI**: Director plan, hooks, script, meta, review, clips on your footage; check provenance badges say
   AI with the right provider, and that no `[MOCK]` appears.
6. **Confirm thresholds on real footage**: run Match on a real script + real footage with the real embedder. Check how
   beats land in matched / weak / missing against your own judgement and adjust `MATCH_OK_ST` / `MATCH_WEAK_ST`
   (and `MATCH_*_HASHING` if you keep the fallback). Same for clip windows (`CLIP_*`).
7. Render a clip with each preset and watch it in a player (captions burned in, audio level, crop).
8. `make test && make lint && make e2e` on your machine.

## 12. Things to fix or replace before any public demo

- Done: the third-party promo videos, unused placeholder images and the hotlinked hero image were removed; the product renders
  are WebP (`public/landing`, ~80 KB each, `public` is now under 300 KB); the landing page has no lint warnings and no invented
  social proof.
- Root `.env` in older checkouts may ship `LLM_ALLOW_MOCK=true`; `make doctor` warns about it.

## 13. Known limitations and quirks

Consolidated in [TODO.md](TODO.md) (item j and others) and [FRONTEND_NOTES.md](FRONTEND_NOTES.md): content cards have no
provenance field (seeded cards are recognised by the `[DEMO]` prefix), duplicate OpenAPI operation ids, open-object
response types, no workspace rename endpoint, no "wipe my data" endpoint, job SSE starts after a 4 s poll, preview ignores
transitions, no per-chunk ASR checkpointing (a failed long transcription redoes finished chunks of that stage).

## 14. Where to look

| Question | File |
|---|---|
| How does X flow end to end? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| What does endpoint Y return? | [API.md](API.md), live `GET /openapi.json`, `http://localhost:8000/docs` |
| How do I add Z? | [BACKEND_FOUNDATION.md](BACKEND_FOUNDATION.md), [frontend/README.md](../frontend/README.md) |
| Why is it built this way? | [LOCAL_FIRST.md](LOCAL_FIRST.md), section 4 above, [Plan.md](../Plan.md) |
| How do I run, reset, fix it? | [RUNBOOK.md](RUNBOOK.md) |
| How do I demo it? | [DEMO_GUIDE.md](DEMO_GUIDE.md) |

## Frontend branch (Vansh's standalone app) — what was taken

`origin/frontend` holds a separate Next app (`build-creator-ai-app 2/`). Its Smart Clips Studio, LumiClip flow and Twin panel were ported into this app
(`frontend/src/components/smart-clips`, `components/twin`) with server-side keys and no invented persona. Its latest commits restyle those
screens inside the standalone app (our versions already cover the same options) and add a sponsor pitch generator and sponsor-page scraper
(`app/api/pitch-generator`, `app/api/scrape-sponsor`). Those returned hardcoded brands and contacts; they were removed and replaced by the real `/monetization` backend. The branch is recorded as merged
(`-s ours`) so history is joined without duplicating a second app in the tree.
