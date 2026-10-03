# CreatorAi web app

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 + hand-written design CSS · TanStack Query ·
Zustand · framer-motion · base-ui (dialog, menu, tooltip). No telemetry, no remote assets: it only talks to the local API.

```bash
make setup && make dev        # API :8000 + web :3000 together (from the repo root)
cd frontend
npm run dev | build | start   # web only; API base URL = NEXT_PUBLIC_API_URL (default http://localhost:8000)
npm run typecheck             # next typegen && tsc --noEmit
npm run lint                  # eslint (next core-web-vitals + typescript)
npm run gen:api               # regenerate src/lib/api/schema.d.ts from openapi.json (use `make gen-api` from the root)
npm run test:unit             # vitest: timeline ops (golden + randomized), captions, playback engine, history, merge
npm run e2e                   # Playwright against an already running stack (E2E_WEB_URL / E2E_API_URL)
make e2e                      # (root) throwaway DATA_DIR + seed + API :8100 + built web :3100 + the suite
```

Chromium for e2e is resolved from `$PW_CHROMIUM`, `/opt/pw-browsers/chromium-*/chrome-linux/chrome`, or Playwright's own install.

## Structure

```
src/app/
  (public)/        landing `/`, `/login`, `/signup`
  (flow)/onboarding   4-step wizard (auth required, no shell)
  (app)/           auth-guarded shell: dashboard, projects, calendar (= Content Board), settings, jobs,
                   analytics / monetization / creative-twin (honest "not available"), and
                   assets, search, ai-studio, smart-clips, repurpose, script-match, creative-director,
                   editor/[clipId], projects/[id]/{plan,script,footage,match,clips,sponsors,publish}
  board/           redirect -> /calendar
src/components/
  ui/              Button, Modal (dialog), Menu, Tooltip, Field/Input/Select/Textarea, Skeleton
  common/          EmptyState, ErrorState, ConfirmDialog, PageHeader, StageBadge, ProgressRing, Thumb, Segmented,
                   NotAvailablePage / NotAvailableInline, ComingNext, ToastViewport, Splash
  provenance/      ProvenanceBadge, DataModeBanner, DataModeChip, useDataMode
  shell/           AppShell, Sidebar, Topbar, nav.ts (nav + breadcrumb titles), TwinDrawer, JobToasts, JobsProvider, RequireAuth
  board/           Board, ContentCard, ProjectCard/Row, NewContentDialog, DeleteContentDialog, IdeasPanel
  media/           VideoPlayer (signed proxy, Range seeking, clip window, `ref.seek(t)`), TranscriptView (clickable words),
                   ShotStrip, Waveform (SVG from the analysis energy curve)
  library/         LibraryPage (shared by /assets and /search), SearchBar, MomentCard, AssetCard/Grid, AssetStatusChip,
                   UploadDialog/UploadZone/UploadPill, PipelineChecklist, FailureNotice (+ Attach transcript), TagEditor,
                   AssetDetailHost (drawer driven by `?asset=<id>&t=<sec>`, see `useAssetDrawer`)
  plan/            DirectorForm, PlanView, ShotList (editable + CSV/MD export), ReviewReport, ScoreRing
  script/          HookPicker, ScriptGenerate, ScriptEditor (autosave + dirty indicator), MetaPanel, ScriptVersions
  match/           CoverageBar, ScriptFootageView, BeatRow (play / swap / confirm / reject), MissingScenes
  clips/           GenerateClips, ClipCard, InlineText, RenderDialog, RenderRow
  projects/        ProjectHeader (editable title, stage advance incl. NO_SCRIPT, switcher, running-jobs strip)
  hubs/            useProjects, HubRow (Creative Director / Script Match hubs)
src/lib/api/       schema.d.ts (generated) · types.ts · client.ts · errors.ts · error-toasts.ts · hooks.ts
src/lib/           upload.ts (chunked, resumable, 4 parallel chunks, speed/ETA) · track-job.ts · library.ts (stage list, kinds) ·
                   render-presets.ts · auth.ts (token) · sse.ts · time.ts · format.ts · board.ts (pure optimistic move) · use-*.ts
src/stores/        ui (sidebar, drawers, new-content dialog), jobs (live jobs), toasts, uploads (upload queue), project-ui (primary video)
src/styles/        tokens.css, base.css, shell.css, ui.css, pages.css, board.css (imported by app/globals.css)
```

## Conventions

- **Everything is wired to the API.** No hard-coded people, stats or images. Demo content only comes from `make seed`
  (`[DEMO]` titles) and is shown with a Demo `ProvenanceBadge`.
- **Provenance**: wherever generated content is rendered use `<ProvenanceBadge source provider model />`
  (`ai | mock | heuristic | demo | user`; the API returns `provenance:{source,provider,model}` on generated payloads).
- **Not built yet = honest**: use `NotAvailablePage` (backend missing) or `ComingNext` (backend exists, screen is next). Never fake data.
- **Server state** lives in TanStack Query via `lib/api/hooks.ts` (keys in `qk`). Mutations toast errors automatically
  (`LLM_BUSY` with retry hint, `LLM_NOT_CONFIGURED`, `QUOTA_EXCEEDED`, `NO_YOUTUBE_CONNECTION`, `REVISION_CONFLICT`);
  pass `meta: { silent: true }` to handle errors yourself. UI-only state goes in Zustand stores.
- **Media URLs** from the API are relative and signed: wrap with `mediaUrl()` (or use `<Thumb>`). `<video>`/`EventSource` need
  `withAccessToken(path)`.
- **Jobs**: after enqueueing (upload, match, clips, render) call `trackJob(job_id)` from `components/shell/jobs-provider`;
  the topbar indicator, JobToasts and cache invalidation then work automatically.
- **Styling**: reuse the CSS classes/tokens (`.card`, `.button*`, `.badge*`, `.stage-badge`, `.prov`, `.field`, `.empty-state`,
  `.kanban*` ...). Tokens (`--primary #8b5cf6`, `--amber`, `--cyan`, surfaces `--surface/-2/-3`, `--radius 14px`) are in
  `styles/tokens.css`. Respect `prefers-reduced-motion`; give every control a visible `:focus-visible` ring and an accessible name.
- Tests hooks: key elements carry `data-testid` (see `e2e/app.spec.ts`).

## Hooks added for the library and projects (`lib/api/hooks.ts`)

Assets `useAssets / useAsset / useTranscript / usePatchAsset / useDeleteAsset / useReprocessAsset / useAttachTranscript / useSearch` ·
Director `usePlan / usePlanVersions / useGeneratePlan / usePatchPlan / useReview / useReviewVersions / useRunReview` ·
Scripts `useScript / useScriptVersions / useGenerateHooks / useGenerateScript / usePatchScript / useRestoreScript / useApproveScript /
useRewriteScene / useGenerateMeta` · Matching `useMatch / useRunMatch / useBeatDecision` · Clips `useClips / useAllClips / useGenerateClips /
usePatchClip / useClipDecision` · Renders `useContentRenders / useAllRenders / useRender / useCreateRender / useDeleteRender` ·
`useJob`, `useContentList`. Every enqueue calls `trackJob` itself. Mutations that call the LLM set `meta: LLM_INLINE` so
`LLM_NOT_CONFIGURED` / `LLM_BUSY` are rendered inline by `<LlmNotice error onRetry />` instead of a toast.
Reads that 404/409 when "nothing exists yet" (`NO_PLAN`, `NO_SCRIPT`, transcript) resolve to `null`, and the pages gate them on the card's
`progress` flags or a versions list, so the console stays free of expected errors.

**Primary video** (footage tab) is per-viewer UI state (`stores/project-ui.ts`, localStorage). It is passed as `asset_id` to
`POST /content/{id}/clips/generate`; without a choice the longest ready video is used (same as the backend).

**Playback caveat**: the proxy is H.264/AAC. Playwright's bundled Chromium cannot decode it, so `VideoPlayer` shows an honest error panel and
exposes the requested position as `data-seek-target` (that is what the e2e asserts). Chrome, Edge and Safari play it normally.

## E2E

`make e2e` seeds a throwaway DATA_DIR, builds the app and runs two Playwright projects against it: `keyless` (API with no keys, mock off:
everything except `e2e/mock/`) and then `mock` (the API restarted with `LLM_ALLOW_MOCK=true`; only `e2e/mock/generation.spec.ts`, which
asserts the MOCK banner and badges). `UPLOAD_CHUNK_SIZE=65536` is set so the upload spec really is chunked. The specs assume a fresh seed
(the match spec swaps and confirms beats), so rerun against a reseeded DB.

## Add a page

1. Create `src/app/(app)/<route>/page.tsx` (client component if it uses hooks). Add it to `components/shell/nav.ts`
   (`NAV` and `ROUTE_TITLES`) if it needs a nav entry or breadcrumb title.
2. Use `PageHeader`, then handle the four states: skeleton while `isPending`, `ErrorState` on error, `EmptyState` when empty, data.

## Add an API hook

1. Make sure the endpoint is in `openapi.json` (`make gen-api` from the root regenerates it and `schema.d.ts`).
2. Add the key to `qk` and the hook in `lib/api/hooks.ts` using `unwrap(api.GET('/api/v1/...', ...))`; invalidate related keys on success.
   Open-object responses (health, llm) get hand-written types in `lib/api/types.ts`.

## Auth and redirects

Token in `localStorage` (`creatorai.token`), `AuthProvider` + `useAuth()`. `RequireAuth` rules: anonymous -> `/login?next=`,
signed in but not onboarded -> `/onboarding`, onboarded visiting `/onboarding` -> `/dashboard` (unless `?redo=1`). Any 401 signs out.

## Clip editor (`/editor/[clipId]`)

Full-bleed workspace (the shell hides sidebar/topbar for `/editor/*`): header (back, editable title, Edit/Preview, save status,
undo/redo, revision menu, Accept all, stale-render hint, shortcuts, Export), left **Agent & history** panel, centre **monitor**,
right **inspector** (Selection / Project tabs) and the bottom **timeline** with its tool column. Below 1024 px it shows an
"open on a larger screen" notice, a read-only summary and Export. Only Edit and Preview exist as modes (Audio/Color/Structure have no backend).

Architecture
- `src/lib/timeline/*`: pure, DOM-free mirror of `backend/app/services/timeline_service.py` (`ops`, `validate`, `captions`, `merge`,
  `history`, `playback`, `edit` = editor-only moves/resizes/adds). `golden.json` is generated from the real Python service
  (`python backend/scripts/dump_timeline_golden.py`; a backend test fails when it is stale) and replayed by vitest together with
  150 seeded randomized op sequences that re-check every invariant.
- `src/stores/editor.ts` (Zustand): timeline, base revision, server copy (merge base), selection, playhead, zoom, tool, locks/mutes,
  undo/redo with coalescing (drags = one step), dirty/version, save status, conflict, revision preview.
- `src/lib/editor/controller.ts`: debounced autosave (`PUT /edit` with `base_revision`), server ops (`tighten_pauses`, `rebuild_captions`
  fallback), revisions (preview/restore), `REVISION_CONFLICT` handling: reload, safe three-way merge (only when edits touch different
  layers and neither re-cut the video) or explicit overwrite (their revision stays in history).
- `src/lib/editor/engine.ts`: playback engine. The clock is the master, two `<video>` slots pre-buffer/swap at cuts (gapless; a split keeps
  one element), audio layers use HTMLAudio (preview caps at 0 dB), crop_x becomes `object-position`. Decode errors/stalls fall back to
  clock-only playback and the monitor says so. Unit-tested with fake media elements.
- Accept/Reject/Restore set `status` (`accepted`/`rejected`), which the server logs as `layer_accepted`/`layer_rejected` (checked in e2e via `/activity`).

Shortcuts: Space/K play, arrows frame (Shift = 1 s), J/L +-1 s, Home/End, V select, T trim, S split, `[` `]` trim to playhead, Delete,
Ctrl/Cmd+Z / Shift+Z / Y, Ctrl+S, +/- zoom (Ctrl+wheel), N snapping, Esc, `?` help.
