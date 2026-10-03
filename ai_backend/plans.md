# plans.md — AI Video Platform Backend (MVP)

Source of truth for scope: `context.md`. This file is the build plan for coding sub-agents.
Milestone: **Plan → Research → Script → Upload → Process → Index → AI Edit → Timeline → Render**, driven end to end through the API.

---

## 0. How we work (read before any phase)

### Operating rules (the practices this plan is built on)

| Practice | How it applies here |
|---|---|
| **Tracer bullets / vertical slices** (Pragmatic Programmer) | Every phase ships a thin end-to-end slice (route → service → DB → test), never a horizontal layer. Phase 0 wires the whole skeleton with stubs first. |
| **Deep modules, small interfaces** (Ousterhout) | Each module exposes one small `service.js` API. Other modules import only that. Agents can rewrite internals freely. |
| **TDD, one test at a time** (Beck) | Red → green → refactor. Write one failing test, make it pass, repeat. Never write all tests then all code. |
| **Tests at the seam, not the internals** | Tests hit HTTP (supertest) or `service.js`. No tests of private helpers, so refactors don't break the gate. |
| **Backpressure / feedback loops** (Huntley) | The agent's only definition of done is `npm run gate -- <N>` exiting 0. Lint + schema validation + tests replace the type checker we don't have. |
| **Small tasks, fresh context** (Anthropic context-engineering guidance) | One sub-agent = one task from this file = one fresh context. No agent carries more than one task. |
| **Fakes at the boundary** | Every external system (LLM, Cloudinary, transcription, search) sits behind an adapter with a deterministic fake. Gates never call the network. |
| **Builder ≠ verifier** | The orchestrator runs the gate itself. A sub-agent's "tests pass" claim is never accepted as evidence. |
| **Progress on disk, not in context** (Ralph loop) | Agents append to `progress.md` after each task: what was done, what was learned, what is next. |
| **HITL vs AFK** | Tasks marked **HITL** need a human (keys, decisions). Everything else is AFK. |

### The gate (non-negotiable)

```
npm run gate -- N      # lint + all tests in tests/phase0 … tests/phaseN
```

1. A phase is done only when the gate for that phase exits 0, **run by the orchestrator**.
2. Gates are **cumulative**: phase N re-runs every earlier phase's tests. A regression blocks advancement.
3. Agents may not delete, `.skip`, `.only`, or weaken an existing test, or loosen a Zod schema, to get green. If a test is wrong, stop and report.
4. Three failed fix attempts on the same failure → stop, write the failure to `progress.md`, escalate to a human.
5. On green: `git commit -m "phase N: <task>"`. One commit per task, so a bad task can be reverted alone.
6. Each phase also has a **live smoke** (real keys, run once by a human, not part of the gate, because LLM output is non-deterministic).

### Sub-agent dispatch template

```
You are implementing task <P#.T#> from plans.md. Read: AGENTS.md, plans.md §0 and
§Phase <#>, progress.md. Touch only the files listed under "Owns". Work TDD: one
failing test → pass → next. Done = `npm run gate -- <#>` exits 0. Do not skip or
edit tests from other tasks. Append a 5-line entry to progress.md. If blocked
after 3 attempts, stop and report the exact failing output.
```

### Stack (locked)

- Node 20+, Express, **plain JavaScript (ESM)**, no TypeScript.
- **Zod** on every request body, every agent output, and the Timeline JSON. This is our type system.
- PostgreSQL (the local instance on `localhost:5432`, **no Docker**) + **pgvector**. Plain SQL migrations, `pg` driver, no ORM. Two databases: `aivideo` and `aivideo_test`.
- AI providers (all free tier, all behind adapters): **Gemini** for agents, vision and embeddings; **Groq** for transcription and as LLM fallback; **Tavily** for web search. See "Providers".
- Queue: **pg-boss** (runs on the same Postgres, so no Redis to install).
- Storage: **Cloudinary**, direct signed uploads from the client.
- Render: **FFmpeg** via `child_process.spawn` (no wrapper library).
- Tests: **Vitest + supertest** against a real Postgres test database. ESLint for lint.
- Auth: email/password, bcrypt, JWT.

### Repo layout (created in Phase 0, then frozen)

```
src/
  app.js  server.js  worker.js
  config/env.js                 # Zod-validated env, fails fast
  db/        pool.js  migrate.js  migrations/NNN_name.sql
  queue/     boss.js  jobs.js   # job-name constants + payload schemas
  adapters/  llm/ embeddings/ transcription/ storage/ search/ ffmpeg/
             each: index.js (picks real|fake from env)  real.js  fake.js
  modules/   auth/ projects/ media/ search/ timeline/ render/ mcp/
             agents/{director,research,script,editing,twin}/
             each: routes.js  service.js  repo.js  schemas.js
  workers/   transcription.js scenes.js faces.js analysis.js embeddings.js moments.js render.js
tests/       phase0/ … phase8/   fixtures/   helpers/
AGENTS.md  plans.md  progress.md  .env.example  scripts/preflight.js
```

Parallel-safety rules: Phase 0 mounts **every** module router as a 501 stub and reserves migration numbers per phase (P1 = 010–019, P2 = 020–029, …). After that, no task edits `app.js` or another module's folder.

### Dependency graph and parallel tracks

```
P0 ─► P1 ─┬─► Track A: P2 Media ─► P3 Process+Index ─┐
          ├─► Track B: P4 Director/Research/Script   ├─► P6 Moments+Editing Agent ─┐
          └─► Track C: P5 Timeline ──────────────────┤                              ├─► P8 E2E + MCP
                                    P2 + P5 ─────────┴─► P7 Render ─────────────────┘
```

After P1, run three sub-agents at once (A, B, C). P6 and P7 also run in parallel.

### Providers (decided)

Model IDs live in `.env`, never in code, because free-tier model lists change.

| Job | Provider and model | Env var | Notes |
|---|---|---|---|
| Agents (Director, Research, Script, Editing, moments) | Gemini Flash, e.g. `gemini-3.5-flash` | `GEMINI_API_KEY`, `LLM_MODEL` | JSON-mode output, validated by Zod |
| Keyframe captions / video analysis | Gemini Flash (image input), a Flash-Lite model if quota is tight | `VISION_MODEL` | One call per keyframe, batched |
| LLM fallback on 429 / 5xx | Groq `openai/gpt-oss-120b` | `GROQ_API_KEY`, `LLM_FALLBACK_MODEL` | Free plan: 30 req/min, 8K tokens/min, 200K tokens/day, so fallback only |
| Transcription | Groq `whisper-large-v3-turbo` | `STT_MODEL` | Free plan: 20 req/min, 7,200 audio-seconds/hour, 28,800/day. Send mono 16 kHz audio, chunk long files |
| Embeddings | Gemini `gemini-embedding-2` at **768 dims** (text + image); fall back to `gemini-embedding-001` (text only) | `EMBED_MODEL`, `EMBED_DIM=768` | 768 keeps the HNSW index valid and storage small |
| Web search (Research Agent) | Tavily | `TAVILY_API_KEY` | 1,000 free credits/month, 1 credit per basic search, no card |

Rules for every real LLM adapter: one shared rate limiter, exponential backoff on 429, then switch to the fallback provider. LLM queue concurrency = 1 on free tiers.

To verify at P0.T8 (HITL): the exact free-tier limits for the Gemini key (shown in AI Studio, not in the docs) and that the embedding model is callable on the free tier.

### Vector storage

`scripts/preflight.js` runs `SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`.
- Present → `VECTOR_BACKEND=pgvector`: `vector(768)` columns, HNSW cosine index.
- Absent (common on a stock Windows Postgres) → install pgvector for Windows, or set `VECTOR_BACKEND=array`: `float8[]` columns and a SQL cosine function. Fine at MVP scale (thousands of rows).

Only `modules/search/repo.js` knows which backend is active.

### MVP cut line

**In:** everything in P0–P8 core. **Simplified:** visual embeddings = image embedding of each keyframe if `gemini-embedding-2` works on the free key, otherwise a text embedding of the keyframe's caption; face detection = Cloudinary face coordinates on keyframes; no captions burn-in. **Stretch (only after P8 gate is green):** Creator Twin, MCP gateway beyond 3 tools, caption burn-in, transitions, real-time co-editing.

---

## Phase 0 — Skeleton and test harness (tracer bullet)

**Goal:** an empty system where every layer exists and one request crosses all of them.
**Depends on:** nothing. **Parallel:** no, single agent.

Tasks
- **P0.T1** `package.json`, ESLint, Vitest, `npm run gate`, `.env.example`, `config/env.js`, `scripts/preflight.js` (checks Postgres on 5432, creates `aivideo` and `aivideo_test` if missing, detects pgvector, checks `ffmpeg`/`ffprobe` on PATH).
- **P0.T2** `db/pool.js`, `migrate.js`, migration `001` (`schema_migrations`, and `CREATE EXTENSION vector` only when `VECTOR_BACKEND=pgvector`). Test helper that migrates and truncates a `*_test` database.
- **P0.T3** `app.js` with JSON error handler, request-id, `validate(schema)` middleware, `GET /health` (checks DB). All module routers mounted as 501 stubs.
- **P0.T4** pg-boss wiring, `worker.js`, one `noop` job. Queue helper for tests: `drainQueue()` runs pending jobs inline.
- **P0.T5** All six adapters with `fake.js` implemented and `real.js` throwing "not implemented". `ADAPTERS=fake` in test env.
- **P0.T6** `tests/fixtures/make-fixture.js`: generates a 20-second test video with FFmpeg (`testsrc` + `sine`, two hard scene cuts) so no binary is committed.
- **P0.T7** `AGENTS.md` (≤ 60 lines: commands, layout, rules from §0), empty `progress.md`.
- **P0.T8 (HITL)** Create keys (Google AI Studio, Groq console, Tavily, Cloudinary), put them in `.env`, run `node scripts/preflight.js`, install FFmpeg if missing, decide `VECTOR_BACKEND` from the preflight result, note the Gemini free-tier limits shown in AI Studio.

Gate — `tests/phase0`
- `GET /health` → 200 with `{db:"ok"}`; DB down → 503.
- Unknown route → 404 JSON; thrown error → 500 JSON with request id; invalid body → 400 with Zod issues.
- Migrations run twice without error (idempotent).
- `noop` job enqueued → processed by `drainQueue()` → completion recorded.
- Each fake adapter returns schema-valid output; missing required env → process refuses to start.
- Fixture generator produces a file `ffprobe` reads as ~20 s with audio and video streams.
- Preflight exits non-zero with a clear message when Postgres, a database, or FFmpeg is missing.
- A vector round-trip (insert 3 vectors, nearest-neighbour query returns the right one) passes on the active `VECTOR_BACKEND`.

---

## Phase 1 — Auth, projects, project-level RBAC

**Goal:** users, projects, members with roles; every later route is protected by one middleware.
**Depends on:** P0.

Data: `users`, `projects`, `project_members(project_id, user_id, role)`.
Roles: `owner` > `editor` > `viewer`. Owner manages members and deletes; editor writes content, runs agents, edits timelines, renders; viewer reads.

API
- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `POST /projects`, `GET /projects`, `GET /projects/:id`, `PATCH`, `DELETE`
- `POST /projects/:id/members`, `PATCH /projects/:id/members/:userId`, `DELETE …`

Tasks
- **P1.T1** auth module + `requireAuth`.
- **P1.T2** projects CRUD; creator becomes `owner`.
- **P1.T3** `requireRole(minRole)` middleware reading `:projectId`; members endpoints.

Gate — `tests/phase1`
- Register/login happy path; duplicate email → 409; wrong password → 401; missing/expired/garbage token → 401.
- Password stored hashed, never returned.
- **Role matrix test**: table-driven, every route × {owner, editor, viewer, non-member, anonymous} → expected status. Non-member gets 404 (no existence leak).
- Cannot remove or demote the last owner. Editor cannot add members.
- `GET /projects` lists only projects the caller belongs to.

Live smoke: none needed.

---

## Phase 2 — Media ingest (Track A)

**Goal:** footage reaches Cloudinary and is registered; originals and derived assets are kept apart.
**Depends on:** P1.

Data: `assets(id, project_id, kind: original|proxy|keyframe|audio|render, parent_asset_id, cloudinary_public_id, url, duration_ms, width, height, status: pending|uploaded|processing|indexed|failed, meta jsonb)`.
Cloudinary folders: `proj/<id>/originals/` and `proj/<id>/derived/`.

API
- `POST /projects/:projectId/media/sign` → signed upload params (client uploads directly to Cloudinary)
- `POST /projects/:projectId/media` → register after upload (verifies with Cloudinary, stores metadata, enqueues `media.process`)
- `GET /projects/:projectId/media`, `GET …/media/:assetId`, `DELETE`
- `POST /webhooks/cloudinary` (signature-verified, optional path to the same register logic)

Tasks
- **P2.T1** `adapters/storage` real + fake (sign, getResource, proxyUrl, uploadFile, destroy).
- **P2.T2** media module routes + repo.
- **P2.T3** register flow → enqueue `media.process`; webhook.

Gate — `tests/phase2`
- Sign returns params restricted to the project's `originals/` folder; viewer → 403.
- Register stores duration/dimensions from the storage adapter, status `uploaded`, exactly one `media.process` job enqueued; registering twice is idempotent.
- Register with a `public_id` outside the project's folder → 400.
- Webhook with bad signature → 401.
- Delete removes derived children and calls storage destroy; viewer cannot delete.
- Listing is project-scoped (no cross-project leak).

Live smoke: upload the fixture video to real Cloudinary through sign → register.

---

## Phase 3 — Processing workers and index (Track A)

**Goal:** an uploaded video becomes a searchable index.
**Depends on:** P2.

Data
- `transcript_segments(asset_id, start_ms, end_ms, text, speaker, embedding vector)`
- `scenes(asset_id, idx, start_ms, end_ms, keyframe_asset_id, caption, embedding vector)`
- `faces(asset_id, scene_id, at_ms, bbox jsonb)`
- `asset_analysis(asset_id, summary, topics jsonb)`
- `processing_jobs(asset_id, step, status, error, attempts)`

Pipeline: `media.process` fans out → `transcription` ∥ `scenes` → (`faces`, `analysis`) → `embeddings` → mark asset `indexed`.

| Worker | MVP implementation |
|---|---|
| Transcription | Groq Whisper via the transcription adapter: Cloudinary audio-only URL (mono, 16 kHz) → chunk if long → segments with timestamps, offsets re-based per chunk |
| Scene detection | FFmpeg `select='gt(scene,0.35)'` + `showinfo` on the low-res proxy → cut times; one keyframe per scene uploaded to `derived/` |
| Face detection | Cloudinary face coordinates for each keyframe |
| Video analysis | Gemini Flash captions each keyframe; one summary + topics per asset |
| Embeddings | Gemini embeddings (768-dim): text for transcript segments; image for keyframes, or caption text if image embedding is unavailable |

API
- `GET /projects/:projectId/media/:assetId/index` (transcript, scenes, faces, analysis, per-step status)
- `POST /projects/:projectId/search` `{query, kinds?, assetIds?, limit}` → ranked hits with `asset_id`, `start_ms`, `end_ms`
- `POST /projects/:projectId/media/:assetId/reprocess`

Tasks (T1–T4 can be split across two agents: T1+T4, T2+T3)
- **P3.T1** orchestration job + `processing_jobs` state machine + transcription worker.
- **P3.T2** scenes + keyframes worker (real FFmpeg on the fixture).
- **P3.T3** faces + analysis workers.
- **P3.T4** embeddings worker + search endpoint (pgvector cosine, HNSW index).
- **P3.T5** index/status/reprocess endpoints.

Gate — `tests/phase3`
- Register fixture → `drainQueue()` → asset `indexed`; every step recorded `done`.
- Scene worker (real FFmpeg, fixture) finds the 2 known cuts within ±500 ms; scenes are contiguous and cover the full duration with no overlap.
- Transcript segments ordered, non-overlapping, within asset duration.
- Every segment and scene has a non-null embedding of the configured dimension.
- Search: seeded fake embeddings → the expected segment ranks first; results never include another project's assets; viewer can search.
- One step failing (fake throws) → asset `failed`, error stored, other assets unaffected; `reprocess` recovers; rerun does not duplicate rows.
- Retry policy: a transient failure succeeds on the second attempt.
- Chunked transcription: a fake returning two chunks yields one continuous, correctly offset segment list.

Live smoke: process a real 2–3 minute talking-head clip; read the transcript and scene list by eye; run three searches.

---

## Phase 4 — Director, Research, Script agents (Track B)

**Goal:** Plan → Research → Script as chained, stored, schema-valid artifacts.
**Depends on:** P1 only.

Shared runner `modules/agents/run.js`: `runAgent({name, input, outputSchema, tools})` → builds prompt, calls `adapters/llm` for JSON, validates with Zod, retries once with the validation error on failure, stores an `agent_runs` row (input, output, status, tokens, ms).

Data: `agent_runs`, `content_plans`, `research_briefs`, `scripts` (each: `project_id`, `created_by`, `doc jsonb`, link to its upstream artifact).

| Agent | Input | Output (Zod) |
|---|---|---|
| Director | niche, audience, goals, cadence, horizon | `ideas[] {title, angle, format, hook}`, `schedule[] {date, ideaIdx}` |
| Research | idea or topic | `brief {summary, keyPoints[], trends[], sources[] {title, url}}` |
| Script | idea + brief | `hooks[]`, `script[] {section, text, estSeconds}`, `cta`, `shots[]`, `broll[]` |

API (all under `/projects/:projectId`)
- `POST /agents/director/plan`, `POST /agents/research`, `POST /agents/script`
- `GET /plans`, `GET /briefs`, `GET /scripts` (+ `/:id`), `PATCH /scripts/:id` for human edits
- Agent calls run as queued jobs: respond `202 {runId}`; `GET /agents/runs/:runId` to poll.

Tasks: **P4.T1** runner + `agent_runs` + real LLM adapter (Gemini primary, Groq fallback, shared rate limiter). **P4.T2** Director. **P4.T3** Research (+ Tavily search adapter; the agent may only cite URLs Tavily returned). **P4.T4** Script.

Gate — `tests/phase4`
- Each agent: fake LLM returns valid JSON → 202 → drain → run `succeeded`, artifact stored and retrievable.
- Fake returns invalid JSON once then valid → run succeeds with `attempts = 2`. Invalid twice → run `failed`, no artifact row, error visible on the run.
- Chain test: plan → research on `ideas[0]` → script from that brief; foreign keys link all three.
- Research output: every `sources[].url` came from the search adapter's results (no invented URLs).
- Viewer can read artifacts but gets 403 on running agents. Cross-project artifact id → 404.
- LLM adapter timeout → run `failed`, API stays responsive.
- Provider fallback (HTTP mocked): primary returns 429 → backoff → fallback provider is called and the run succeeds; both providers failing → run `failed` with both errors recorded.

Live smoke: run the chain once on a real niche; a human reads the script.

---

## Phase 5 — Timeline service (Track C)

**Goal:** versioned Timeline JSON as the single source of truth, safe for several editors.
**Depends on:** P1 only (asset existence checks are behind `media/service.js`).

Timeline JSON v1 (Zod schema in `modules/timeline/schemas.js`, the only definition anywhere)

```json
{
  "schemaVersion": 1,
  "output": { "width": 1080, "height": 1920, "fps": 30 },
  "tracks": [
    { "id": "v1", "type": "video",
      "clips": [ { "id": "c1", "assetId": "…", "sourceInMs": 12000, "sourceOutMs": 19500,
                   "startMs": 0, "volume": 1, "label": "hook" } ] },
    { "id": "cap", "type": "caption",
      "clips": [ { "id": "t1", "startMs": 0, "endMs": 2400, "text": "…" } ] }
  ]
}
```

Data
- `timelines(id, project_id, title, source_asset_id, head_version)`
- `timeline_versions(timeline_id, version, parent_version, author_type: ai|human, author_id, agent_run_id, summary, doc jsonb, created_at)` — **append-only, immutable**.

Rules: every save creates a new version. Client sends `baseVersion`; if it is not the current head → **409** with the current head (optimistic concurrency for multi-editor). Semantic validation beyond shape: clips on one track don't overlap, `sourceOut > sourceIn`, source range inside the asset's duration, assets belong to the same project.

API (under `/projects/:projectId`)
- `POST /timelines`, `GET /timelines`, `GET /timelines/:id` (head)
- `GET /timelines/:id/versions`, `GET /timelines/:id/versions/:v`
- `POST /timelines/:id/versions` `{baseVersion, doc, summary}`
- `POST /timelines/:id/revert` `{toVersion}` (creates a new version copying the old doc)
- `GET /timelines/:id/diff?from=&to=` (clips added/removed/changed)

Tasks: **P5.T1** schema + semantic validator (pure functions, heavily tested). **P5.T2** repo + versioning + 409. **P5.T3** routes, revert, diff.

Gate — `tests/phase5`
- Validator table test: ≥ 12 invalid docs (overlap, negative times, out-of-range source, unknown asset, foreign-project asset, bad schemaVersion, …) each rejected with a specific path; valid docs accepted.
- v1 (ai) → v2 (human) → v3 (ai): versions sequential, `parent_version` chain correct, authors recorded.
- Stale `baseVersion` → 409 and no row written. **Concurrency test:** two parallel saves on the same base → exactly one 201 and one 409.
- Old versions are byte-identical after later saves (immutability). No UPDATE/DELETE route exists for versions.
- Revert creates a new version whose doc equals the target. Diff reports the right clip ids.
- Viewer reads, cannot write. Editor writes. Cross-project → 404.

Live smoke: none needed.

---

## Phase 6 — Moments and Editing Agent

**Goal:** Long video → several independent reel timelines.
**Depends on:** P3 + P5. **Parallel with:** P7.

Pipeline: `Transcript + Scenes → Semantic Moments → Scoring → Candidate Clips → Editing Agent → Timeline(s)`

- **Moments worker**: window the transcript, snap window edges to sentence and scene boundaries, LLM labels each window `{title, hookLine, summary}`.
- **Scoring**: `score = w1·hook + w2·selfContained + w3·energy + w4·topicMatch`, sub-scores 0–1 from the LLM, weights in config, stored for explainability.
- **Candidates**: top-K by score, 15–60 s, non-overlapping (greedy).
- **Editing Agent**: per candidate, LLM receives the transcript slice + scene list + optional script, returns **cut decisions** `{keep:[{startMs,endMs}], captions?}`; **deterministic code** converts them into Timeline JSON and saves through `timeline/service.js` as an `ai` version. The LLM never writes Timeline JSON directly.
- **Revision**: `{timelineId, instruction}` → agent gets the current head + instruction → new `ai` version on top of human edits.

Data: `moments(asset_id, start_ms, end_ms, title, hook_line, scores jsonb, score, status)`.

API (under `/projects/:projectId`)
- `POST /media/:assetId/moments` (202), `GET /media/:assetId/moments`
- `POST /agents/editing/reels` `{assetId, count, targetSeconds, scriptId?}` → 202 → N timelines
- `POST /agents/editing/revise` `{timelineId, instruction}` → 202 → new version

Tasks: **P6.T1** moments + scoring + candidate selection (pure selection logic unit-tested). **P6.T2** cut-decisions → timeline builder (pure). **P6.T3** editing agent reels + revise endpoints.

Gate — `tests/phase6`
- Indexed fixture → moments generated; all boundaries inside asset duration and aligned to segment/scene edges; scores in [0, 1].
- Candidate selection: given seeded scores, returns the expected top-K, none overlapping, all within the duration limits.
- `reels` with `count: 3` → exactly 3 timelines, each v1 `author_type = ai`, each passes the P5 validator, each only references the source asset, each within ±20 % of `targetSeconds`.
- Builder property test: for random valid cut decisions, output is always a valid timeline with contiguous `startMs`.
- LLM returns cuts outside the asset → clamped or rejected, never a broken timeline.
- **v1 AI → v2 human edit → revise → v3 AI**: v3's parent is v2, and v3 preserves a human-added clip the instruction did not mention.
- Revise against a head that moved during the run → run fails cleanly with a conflict, no orphan version.
- Asset not `indexed` → 409. Viewer → 403.

Live smoke: real 5–10 minute video → 3 reels; a human judges whether the cuts land on sentence boundaries.

---

## Phase 7 — Render service

**Goal:** Timeline version + assets → final MP4 in Cloudinary.
**Depends on:** P2 + P5. **Parallel with:** P6.

- `renders(id, timeline_id, version, kind: preview|final, status: queued|rendering|done|failed, progress, output_asset_id, error)`
- Render is pinned to a **specific version**; later edits don't change an in-flight render.
- Worker: resolve clips → input URLs (preview uses the Cloudinary low-res proxy URL, final uses the original) → one FFmpeg `filter_complex` (trim, setpts, scale + crop to output size, concat, audio concat) → temp file → upload to `derived/renders/` → asset row `kind = render`.
- Preview: 480-wide, fast preset. Final: full output size.
- Progress parsed from FFmpeg `-progress pipe:1`.
- `buildFfmpegArgs(timeline, inputs)` is a pure function, so it is tested without running FFmpeg.

API (under `/projects/:projectId`)
- `POST /timelines/:id/render` `{version?, kind}` → 202 `{renderId}`
- `GET /renders/:id`, `GET /timelines/:id/renders`

Tasks: **P7.T1** args builder (pure) + snapshot tests. **P7.T2** render worker with real FFmpeg on the fixture. **P7.T3** routes, progress, failure handling, temp cleanup.

Gate — `tests/phase7`
- Args builder snapshots: 1 clip, 3 clips, clips from 2 assets, preview vs final.
- **Real render** of a 2-clip timeline from the fixture: output exists; `ffprobe` duration = sum of clip durations ±150 ms; resolution equals `output`; has audio and video streams.
- Preview is lower resolution than final for the same timeline.
- Render of version 1 after version 2 exists still uses version 1's doc.
- FFmpeg failure (bad input) → render `failed` with stderr tail stored; temp files removed; worker survives and runs the next job.
- Same `{timeline, version, kind}` requested twice while done → returns the existing render (idempotent).
- Viewer cannot start a render but can read status.

Live smoke: render one Phase-6 reel at final quality, download from Cloudinary, watch it.

---

## Phase 8 — End-to-end milestone, MCP gateway, hardening

**Goal:** the whole milestone passes as one test and is demo-ready.
**Depends on:** P4 + P6 + P7.

Tasks
- **P8.T1** `tests/phase8/e2e.test.js` — the single test that defines the MVP (below).
- **P8.T2** MCP gateway: `@modelcontextprotocol/sdk` server exposing a thin tool layer over existing services — `search_footage`, `get_timeline`, `propose_timeline_edit`, `start_render`. Same JWT + RBAC as HTTP; zero business logic of its own.
- **P8.T3** Hardening: rate limit on agent endpoints, upload size/type limits, structured logs with request id and run id, `GET /projects/:id/activity`, seed script, `README` with a curl walkthrough and Postman/HTTP file for the demo.
- **P8.T4 (stretch)** Creator Twin: `creator_profiles(project_id, doc)` built from indexed transcripts and human timeline edits (pace, average clip length, hook style, vocabulary); injected into Script and Editing prompts. Gate: profile is built, schema-valid, and present in the prompt the fake LLM receives.

Gate — `tests/phase8`
- **E2E (fakes for network, real DB/queue/FFmpeg):** register → project → add editor → director plan → research → script → sign + register fixture → drain → `indexed` → search hit → reels ×2 → editor saves a human version → revise → render preview → `done` with a playable output. One test, no manual steps.
- RBAC sweep: every route registered in `app.js` appears in the role matrix; a route with no matrix entry fails the test.
- MCP: each tool callable; a viewer token cannot call `propose_timeline_edit` or `start_render`.
- No 501 stubs remain. Full gate `npm run gate -- 8` green from a clean database.

Live smoke (the demo rehearsal, HITL): run the E2E script against real providers with a real video, twice in a row.

---

## Execution order for the orchestrator

1. P0 with one agent. Human creates the four API keys and runs preflight (P0.T8) while it runs. Gate 0.
2. P1 with one agent. Gate 1.
3. Launch three agents in parallel: Track A (P2), Track B (P4), Track C (P5). Gate each on merge; cumulative gate after all three land.
4. Track A continues to P3. Gate 3.
5. Launch P6 and P7 in parallel. Gate 6 and 7.
6. P8. Gate 8. Then live smoke, then stretch.

If time runs short, cut in this order: Creator Twin → MCP gateway → faces worker → Research web search (LLM-only) → diff endpoint. Never cut: RBAC matrix, timeline versioning, the E2E test.
