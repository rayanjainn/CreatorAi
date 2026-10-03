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
src/lib/api/       schema.d.ts (generated) · types.ts · client.ts · errors.ts · error-toasts.ts · hooks.ts
src/lib/           auth.ts (token) · sse.ts · time.ts · format.ts · board.ts (pure optimistic move) · use-*.ts
src/stores/        ui (sidebar, drawers, new-content dialog), jobs (live jobs), toasts
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
