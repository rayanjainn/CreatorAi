# TODO: things yet to be done

Honest, prioritised list of what is missing. Context: [HANDOFF.md](HANDOFF.md) (state, contracts), [Plan.md](../Plan.md)
(the spec for each item), [FRONTEND_NOTES.md](FRONTEND_NOTES.md) (the raw list of frontend-found gaps; consolidated in
item 10 below). Sizes: **S** = under a day, **M** = 2 to 4 days, **L** = a week or more, for one engineer who knows the repo.

For every new endpoint follow the checklist in HANDOFF section 6 (tests, `docs/API.md`, `make gen-api`), and keep the
contracts in HANDOFF section 5 (provenance on anything generated, error shape, workspace scoping).

## Suggested order of work

1. **Verify what is claimed** (item 1 and 2, half a day): real keys, real embedder, real playback, tune thresholds. Everything
   else builds on these being true.
2. **CI** (item 3): run the suites on every push so regressions stop landing silently.
3. **Insights** (item 6): smallest of the missing product modules, the data (`yt_videos`, `yt_metrics_daily`) is already seeded, and it feeds idea generation.
4. **Sponsorship** (item 4): contained, reuses the timeline ops (`ripple_insert`) and the editor; the LLM task, prompt and mock already exist.
5. **Digital Twin** (item 7): events are already emitted; needs the listeners, memory store, chat and an apply endpoint.
6. **YouTube OAuth + publish** (item 5): needs Google Cloud setup and an unaudited-app caveat; build after sponsors so the
   paid-promotion disclosure has a source.
7. Then P1 polish (items 8 to 14) and P2.

Items 4 to 7 are the four Plan modules whose routers are declared but absent (`sponsors`, `publish`, `youtube`, `insights`,
`twin` in `backend/app/api/v1/__init__.py`); their tables, LLM tasks, prompts, schemas and mock handlers already exist, so
the work is the services, endpoints, jobs and pages.

---

## P0: needed for a complete product

### 1. Real-provider verification (g)
- **What:** prove the providers work with live services; fix what the recorded-HTTP tests could not catch.
- **Why:** the build sandbox could not reach Groq, Ollama or Hugging Face (HANDOFF section 10). All provider code was tested against recorded HTTP only.
- **Where:** `backend/app/llm/providers/{gemini,groq,ollama}.py`, `ml/asr/groq.py`, `ml/asr/local.py`, `config.py` defaults, `.env.example`. Plan 7.1, 8.2.
- **Backend tasks:**
  - Gemini: confirm `gemini-2.5-flash` / `-flash-lite` ids exist on the free tier; confirm structured-output (JSON schema / `responseMimeType`) works with our schemas; confirm image input for keyframe captions; update defaults.
  - Groq chat: confirm JSON mode with `llama-3.3-70b-versatile` and the token limits (`GROQ_TPM`, `GROQ_MAX_INPUT_TOKENS`).
  - Groq Whisper: confirm `verbose_json` with `timestamp_granularities[]=word` returns word times for `whisper-large-v3-turbo`; check chunk offset re-basing on a 20+ minute file; confirm the 429 handling.
  - Ollama Cloud: confirm structured output (`format` schema) with `gpt-oss:120b` and the vision model (`qwen3-vl:235b`); confirm the auth header. Also a local server with a small model.
  - fastembed: confirm the `all-MiniLM-L6-v2` download and 384-d output on macOS, Linux and WSL2.
  - Replace the recorded fixtures in `tests/unit/test_providers_http.py` with fixtures captured from real responses.
- **Frontend tasks:** none; Settings, "Test my keys" already exercises providers. Maybe show per-provider model errors more clearly.
- **Acceptance:** with real keys every AI endpoint (plan, hooks, script, meta, review, clips copy, captions, ideas) returns valid output badged AI; a 1 to 3 minute real upload transcribes with word-level times; defaults in `config.py`/`.env.example` are ids that work; findings recorded in HANDOFF section 10.
- **Size:** S to M (mostly waiting on rate limits).

### 2. Threshold tuning on real footage (h)
- **What:** tune matching and clip thresholds with the real embedder on real footage.
- **Why:** `MATCH_OK_ST=0.45`, `MATCH_WEAK_ST=0.30` are Plan defaults; hashing thresholds were tuned on synthetic demo footage. The seeded "75% coverage" came from hashing.
- **Where:** `config.py` (`MATCH_*`, `CLIP_*`), `ml/alignment.py`, `ml/scoring.py`, `ml/segments.py`. Plan 8.3, 8.5, 8.8.
- **Backend tasks:** build a small labelled set (3 to 5 real videos with scripts, hand-marked beat to time ranges); script that reports precision/recall of matched/weak/missing per threshold; choose defaults; check clip window scoring weights.
- **Frontend tasks:** none (coverage bar and badges already follow the API).
- **Acceptance:** documented thresholds with the evidence (a short table in HANDOFF); matched beats agree with hand labels on at least the agreed rate (decide, for example 80%); no regressions in `test_alignment`.
- **Size:** M.

### 3. CI (n)
- **What:** run the suites on every push and PR.
- **Why:** nothing enforces `make test`/`make lint`.
- **Where:** `.github/workflows/ci.yml` (added with the docs; unproven on GitHub because it could not be run in the sandbox), `CONTRIBUTING.md`.
- **Tasks:** confirm the workflow passes on GitHub; add dependency caching if slow; add the Playwright e2e job (it needs Chromium via `npx playwright install --with-deps chromium`, about 5 to 10 min) and decide whether it is required; protect `main` with the checks; add a nightly `pip-audit`/`npm audit`.
- **Acceptance:** a PR shows backend, frontend and lint checks; failing tests block merge.
- **Size:** S.

### 3. Sponsorship and monetization (a) — done
**Built:** `ml/sponsor_slots.py`, `services/{sponsor_service,monetization}.py`, `api/v1/{sponsors,monetization}.py`, the project Sponsors tab and `/monetization`. Left from the original list: linking a recorded asset to a sponsor placeholder from the inspector. The original plan follows for reference.

- **What:** sponsor brief, sponsor slot detection, "Accept into clip", disclosure.
- **Why:** a named product module; the project "Sponsors" tab and `/monetization` are empty "not available" pages.
- **Where:** Plan 8.10 and 6.1 (sponsor `VideoItem`), table `sponsor_briefs`/`sponsor_slots` (exist), LLM task `sponsors.integration` (schema, prompt, mock exist), `timeline_service.ripple_insert`, error `SLOT_OUTSIDE_CLIP` (exists).
- **Backend tasks:** `ml/sponsor_slots.py` (boundary candidates, topic shift, pause, relevance, top 3 with separation); `services/sponsor_service.py`; `api/v1/sponsors.py`: create/read brief for a content item, `POST .../sponsor-slots/find` (job or sync), `GET` slots, `POST /sponsor-slots/{id}/accept {clip_id}` (map into clip timeline, split, insert placeholder `VideoItem(kind="sponsor")`, `lower_third` overlay "Sponsored · brand", estimated captions at 2.5 words/s, saved through `edit_service` so a revision and activity are recorded); the flow is user-triggered. Unit tests for scoring and the accept path, integration test.
- **Frontend tasks:** replace `projects/[id]/sponsors/page.tsx` with `BriefForm`, slot cards (timestamp, kind badge, snippet, integration script, lower-third text, preview, "Accept into clip" with clip picker), disclosure reminder; `/monetization` hub listing briefs; editor: link a recorded asset to a sponsor placeholder (clears `placeholder`); provenance badges; remove the "soon" pill in `nav.ts`.
- **Acceptance:** with seeded hero footage and a brief, 3 slots appear with the right kinds; accepting adds a placeholder sponsor segment and keeps all timeline invariants (golden/property tests extended); the clip's revision history shows the change; renders show the placeholder card.
- **Size:** L.

### 5. YouTube OAuth, publish, paid-promotion disclosure (b)
- **What:** connect a YouTube account, upload a render as a video, schedule, and show status.
- **Why:** completes the idea to published loop; the Publish tab and the Settings YouTube section are placeholders.
- **Where:** Plan sections 2, 8.9, 8.10 step 8, 12; tables `youtube_connections`, `publish_jobs`; `config.py` (`GOOGLE_*`, `youtube_configured`); `security.encrypt_token/decrypt_token` (Fernet, exists); job `publish.upload` (queue `io`); error `NO_YOUTUBE_CONNECTION`; preset `publishable` flag.
- **Backend tasks:** `api/v1/youtube.py` (`/youtube/oauth/start`, `/oauth/callback`, `/status`, disconnect), `services/youtube_service.py` (token refresh, resumable upload, quota awareness), `workers/tasks/youtube_upload.py`, `api/v1/publish.py` (create publish job from a `done` render of a publishable preset, title/description/tags/visibility/schedule, status, retry); description pre-append "This video includes a paid promotion from {brand}." when an accepted sponsor slot is in the rendered timeline (depends on item 4); mark the content item `published` and stamp `published_at`; emit the twin `publish` event. Tests with `httpx.MockTransport`.
- **Frontend tasks:** Publish tab `PublishForm`, `PublishStatus` (progress via SSE, link, error + retry), "Connect YouTube" card, Settings connection section, download-only presets show a Download button.
- **Acceptance:** with real Google credentials a render uploads, the video link shows, the item moves to published; with sponsors the disclosure line is pre-filled and editable; without credentials the UI shows the setup help, not an error.
- **Notes:** Google OAuth apps in "Testing" have short-lived refresh tokens and unaudited projects may force uploads to private (Plan section 2); document the Google Cloud setup in RUNBOOK.
- **Size:** L.

### 6. Creator intelligence / Insights (c)
- **What:** analytics sync, KPIs, performance tables and charts, narrative and next ideas.
- **Why:** closes the learning loop; the data model and demo data exist but nothing reads them.
- **Where:** Plan 8.12 and 6.9; tables `yt_videos`, `yt_metrics_daily`, `insight_snapshots`; LLM task `insights.narrate_ideas` (exists); `idea_suggestions` already allows `source = 'insights'` (the ideas API currently stores `twin`); seeded rows are `is_seed=1` and must stay provenance `demo`.
- **Backend tasks:** `services/insights_service.py` (pandas: views, views-weighted view %, views per day, groups by hook type, topic, length bucket, rank score, top 5, exclusion of videos under 7 days, groups under 2 videos flagged); `api/v1/insights.py` (`GET /insights/summary?range=`, `POST /insights/narrate`, `PATCH` video topic/hook); `analytics.sync` job (needs item 5); store snapshots; narrate writes `idea_suggestions(source='insights')`; provenance `demo` when any seeded row is included.
- **Frontend tasks:** `/analytics` page (rename or add `/insights` route as in UI spec): range picker, KPI row, sortable performance table with editable topic/hook, hook and length charts, topic breakdown, top-5 card, narrative with caveats, next ideas with "Add to board"; Demo badge on seeded data; update the Ideas panel to show the source.
- **Acceptance:** after `make seed` the page renders real computed numbers from the synthetic rows with a Demo badge; groups with fewer than 2 videos say "not enough data"; with a key the narrative and 5 ideas appear badged AI and the ideas land in `idea_suggestions` with source insights.
- **Size:** M (L with real YouTube sync).

### 7. Digital Twin (d)
- **What:** style profile that learns from approvals, a chat that proposes actions, and an apply endpoint.
- **Why:** the product's "creative twin" differentiator; drawer and page are placeholders.
- **Where:** Plan 8.11, 6.2, 6.8; `services/twin_events.py` (registry exists; events `script_approved` and `clip_accepted` are already emitted, nothing listens); tables `twin_memories`, `twin_messages`, `creator_profiles.style_profile`; LLM tasks `twin.chat`, `twin.style_extract` (schemas, prompts, mock exist); job `twin.update`; the editor ops endpoint (`POST /clips/{id}/edit/ops`) for applying actions.
- **Backend tasks:** `services/twin_service.py` registering listeners at startup (`script_approved`, `clip_accepted`, later `published`); deterministic stats (avg segment sec, cuts/min, words/min, caption style, music kept) and EMA (alpha 0.3) into `style_profile`; memory rows with embeddings; after 5 approvals enqueue `twin.update` (style extract, bump `style_profile_rev`); `layer_rejected` preference mining from `activity_log` (same layer type rejected in at least 3 of the last 5 clips adds a `preference` memory and a "don't"); retrieval of top 3 memories for prompts; `api/v1/twin.py`: `GET /twin/profile`, `GET/DELETE /twin/memories`, `GET/POST /twin/chat`, `POST /twin/actions/apply` (validate against current clip state, apply through the edit ops so revision conflicts apply; unknown action types dropped); "style applied" flag consumed by script generation.
- **Frontend tasks:** `/creative-twin` page (style profile card: summary, tone chips, vocab, pacing, dos/don'ts, revision; memories list with delete; full chat with "Apply" buttons that never auto-run; edit and reset), the TwinDrawer chat, the editor left panel Agent chat, "Written in your style" banner on scripts (the banner exists, gated on `style_applied`).
- **Acceptance:** approving 5 scripts or accepting clips updates the profile and bumps the revision; a chat reply offers actions, "Apply" edits the clip through the revisioned ops and the editor shows it live; rejecting the same layer 3 times of 5 creates a preference memory; everything AI-written is badged.
- **Size:** L.

---

## P1: important

### 8. Content calendar and scheduling (e)
- **What:** dates on content items and a calendar view. Today `/calendar` is the Kanban board and cards have no due date.
- **Why:** UI spec mentions due dates; publishing needs schedule dates.
- **Where:** `content_items` (add `due_date` via a migration, or use `published_at` plus a new `scheduled_at`), `api/v1/content.py`, `frontend/src/components/board`, `app/(app)/calendar`. Pairs with item 5 (schedule publish).
- **Backend:** migration, PATCH fields, filters; **Frontend:** month/week view, drag to reschedule, due date on cards.
- **Acceptance:** an item can be given a date, appears on the calendar, and moving it persists. **Size:** M.

### 9. Per-chunk ASR checkpointing (i)
- **What:** persist each finished transcription chunk so a retry does not redo them.
- **Why:** a failure on chunk 8 of 10 currently restarts the whole `transcribe` stage (stage checkpoints exist, chunk ones do not), wasting Groq quota.
- **Where:** `services/ingest/transcribe.py` (`transcribe_chunks`), `ml/asr/*`, `assets.analysis`. Plan 3.3, 8.2.
- **Backend:** store `analysis.asr_chunks[i] = {provider, words, segments}` after each chunk (keyed by chunk plan and provider config), skip finished chunks on resume, invalidate when audio or provider changes; tests with a failing provider on chunk N.
- **Frontend:** show "chunk 3 of 10" progress (optional). **Acceptance:** a forced failure on the last chunk, then reprocess, calls the provider only for the missing chunks. **Size:** S to M.

### 10. API polish and gaps collected from the frontend (j)
Consolidated from FRONTEND_NOTES (numbers refer to that file) and the module handoffs. Each is small; do them in one sweep and run `make gen-api`.
- **Provenance on content cards** (note 1): add `provenance`/`is_seed` to `CardOut`; replace the `[DEMO]` title-prefix check in `lib/format.ts`. S.
- **Duplicate OpenAPI operation ids** (note 2): set explicit `operation_id` on the transcript PUT/POST in `assets.py` and the media GET/HEAD in `media.py`. S.
- **Typed open-object responses** (notes 3, 17, 4, 16): response models for `/health`, `/llm/status`, `/llm/test`, `PlanOut.plan`, `ReviewOut.issues/scores`, `ScriptOut.scenes/meta`, `AssetDetail.analysis`; `CardOut.stage` as the `Stage` enum; `GET /content/{id}` declared as `CardOut`; then delete the hand-written types in `lib/api/types.ts`. M.
- **Rename workspace/channel endpoint** (note 5): accept `channel_name` in `PUT /profile` (or `PATCH /workspace`); Settings form. S.
- **`make reset-password`** (note 6): **done**, and the login hint points to it; it also signs out every session.
- **"Wipe my data"** (note 7): **done** as `POST /workspace/wipe {confirm: "DELETE"}` (owner), plus `GET /workspace/export`.
- **Per-option hook provenance** (note 18), **"none yet" responses instead of 404/409 reads** (note 19), **unified `missing_scenes` shape** (note 20), **transcript endpoint for audio-less video** (note 21), **SSE starts only after the 4 s poll** (note 23; subscribe immediately after enqueue). Each S.
- **Empty `OLLAMA_BASE_URL=` counts as configured** (note 13): treat empty as default. S.
- **Acceptance:** the console and `make gen-api` are warning-free; frontend casts listed above are gone; tests updated. **Size:** M total.

### 11. Editor polish (k)
- **What:** transitions preview, audio gain preview above 0 dB, loop-selection playback, multi-item drag, persisted lock/mute, keyframe-accurate thumbnails.
- **Why:** preview currently hard-cuts where the render cross-fades (note 25), caps gain at 0 dB, and these were cut for time (note 26).
- **Where:** `frontend/src/lib/editor/engine.ts` (playback), `components/editor/*`, `lib/timeline/edit.ts`; backend only for persisting lock/mute (optional field on timeline items; golden file must change if the timeline schema changes).
- **Acceptance:** preview shows fades matching the render within a frame; selected range loops; dragging several items moves them as one history step; vitest coverage for each. **Size:** M to L.

### 12. Auth hardening (m)
- **What:** password reset flow beyond the CLI, session management, rate limiting on login, optional multi-user.
- **Why:** local mode is a single account; the JWT lives in `localStorage`; no brute-force protection.
- **Where:** `services/accounts.py`, `api/v1/auth.py`, `security.py`, `config.py` (`AUTH_ALLOW_MULTI`), Plan section 0 (teams/RBAC deferred).
- **Tasks:** login attempt throttling; token revocation (a `token_version` on the user so reset-password invalidates sessions); httpOnly cookie option; change-password endpoint and Settings form; if teams return, workspace membership and roles (every table already has `workspace_id`).
- **Done:** login throttling (5 failures per email and address in 15 minutes, `429 TOO_MANY_ATTEMPTS`), `users.token_version` (password change, `sign-out-everywhere` and `make reset-password` invalidate older tokens), change-password form in Settings.
- **Left:** httpOnly cookie option.
- **Acceptance:** repeated bad logins are throttled; changing the password signs out other sessions. **Size:** M (multi-user: L, deferred by the owner).

### 13. Packaging and performance (o)
- **What:** shrink the repo and the bundle; remove third-party assets.
- **Why:** `frontend/public` is 27 MB, includes third-party promo videos (HANDOFF section 12), and the landing page pulls three.js and GSAP.
- **Done:** third-party videos and placeholders removed, renders converted to WebP (`public` 27 MB to under 300 KB), landing lint clean.
- **Tasks left:** lazy-load media, code-split the landing page's 3D code; measure with `next build` output and Lighthouse; remove unused dependencies (`shadcn`, `three`, `gsap` if not needed); fix the 8 eslint warnings in `components/landing/landing-page.tsx`; consider moving media out of git (LFS) or using generated loops.
- **Acceptance:** no third-party branded media in the repo; `frontend/public` under 3 MB; first-load JS of the app shell reduced and recorded. **Size:** S to M.

### 14. Accessibility and i18n pass (p)
- **What:** an audit and fixes; extract strings.
- **Why:** the conventions require focus rings and accessible names, but nothing verifies them across pages; the timeline editor is keyboard-capable but unaudited with a screen reader; all copy is hard-coded English.
- **Tasks:** axe-core in Playwright for each main page; keyboard path for drag and drop on the board; contrast check of the dark theme tokens; `prefers-reduced-motion` verification on the landing page; adopt an i18n library (for example next-intl) and extract strings; the backend `language` field already exists on the profile and ASR.
- **Acceptance:** no serious axe violations on the main pages; the app can be switched to a second locale. **Size:** M (a11y) + M (i18n).

---

## P2: nice to have

### 15. Editor Audio, Color and Structure modes (f)
Only worth building when backed: Audio (per-clip gain curves, ducking, voice-over record; needs timeline fields and render graph support), Color (LUT/exposure filters in `render_graph.py` and preview), Structure (reorder by script beat using `beat_matches`). Each needs a timeline schema change (Plan 6.1), the golden file, backend `ops`, render support and a UI mode. **Size:** L each.

### 16. Storage and scale path (l)
- **What:** S3/R2 storage backend; Redis + RQ queue; Postgres + pgvector.
- **Why:** deferred by the owner for scalability; local-first stays the default.
- **Where:** `storage/base.py` already defines `StorageBackend` (only `LocalStorage` exists); `workers/runner.py` (thread pools, in-memory pubsub) replaced by RQ + Redis pub/sub as in Plan 3.2/3.3; `db.py` and `migrations/*.sql` (SQLite dialect) would need a Postgres dialect, `ml/vectors.py` a pgvector path, FTS5 a `tsvector` path.
- **Tasks:** implement `S3Storage` (signed URLs instead of the `/media` route); abstract the job runner behind an interface; port migrations; keep the SQLite path working and tested.
- **Acceptance:** the same test suite passes on the alternative backends behind a flag. **Size:** L each.

### 17. Plan 7.4 token budget (q)
Intentionally not built: it is a planning estimate. If wanted, a usage page can aggregate `llm_usage` rows (the table is already written by the gateway). **Size:** S.

### 18. Other known small items
- Hero seed numbers should be regenerated with the real embedder once available (`make seed ARGS="--reset"`), and the e2e assertions that depend on hashing (`75%` coverage) revisited.
- Edits payload only carries words for the ranges used at load, so `rebuild_captions` falls back to a server op (note 28).
- The landing page marketing assets and 3D visuals are unfinished; the `board` redirect and `frontend/openapi.json` generation could be CI-checked (fail when `make gen-api` produces a diff).
- Docs: keep `docs/API.md` in step; add sections for every new router.

## Status update (latest)

Done: teams and RBAC (invites, comments, presence, view-only); creator intelligence (`/analytics`, production insights computed from your own
data); movable, styled text overlays; `make showcase` for real content; empty first run (no seed needed); landing page fixes; **Digital Twin**
(style profile learned from approved scripts, memories from approved scripts and accepted clips, chat with suggested actions; in the editor
the "Ask" tab applies pause tightening, caption style and music changes as new revisions); **calendar planner** (`scheduled_for`, month view); **Research agent** (project Research tab: web search via Tavily/Serper, brief cited only from the results; port of Menil's design).

Still open:
1. **YouTube connection** is built (OAuth, resumable upload, scheduling, stats sync). Still to do: verify against a live channel, retention curves (YouTube Analytics API), and quota handling across many uploads.
2. Twin trim and hook actions apply directly; `layer_rejected` turns a type rejected in 3 of the last 5 clips into a preference memory and a "don't" (Plan 8.11). Not done: the EMA pacing stats from accepted clips.
3. Sponsors (Plan 8.10) are built: see `docs/API.md` "Monetization and sponsors". Linking a recorded sponsor clip to a placeholder in the editor is still manual (delete the placeholder, insert the clip).
