# AGENTS.md

Node 20+, Express 5, plain JavaScript (ESM), no TypeScript. Zod is the type system.
Scope: `context.md`. Build plan and per-phase gates: `plans.md`. Progress log: `progress.md`.

## Commands

    npm run preflight        # Postgres, databases (creates if missing), pgvector, ffmpeg
    npm run migrate          # apply src/db/migrations
    npm start / npm run worker
    npm run gate -- N        # lint + tests/phase0..phaseN. The ONLY definition of done.
    npm run fixture          # build tests/fixtures/fixture.mp4 (20 s, cuts at 7 s and 14 s)

## Layout

    src/app.js            createApp(); mounts every router. FROZEN after phase 0.
    src/config/env.js     Zod env; getEnv() fails fast
    src/db/               pool.js, migrate.js, migrations/NNN_name.sql
    src/queue/            boss.js (pg-boss, enqueue, runJob), jobs.js (names + payload schemas)
    src/workers/          job handlers; register each in workers/index.js
    src/adapters/<name>/  index.js (get<Name>() picks real|fake), real.js, fake.js, contract.js
    src/modules/<name>/   routes.js, service.js, repo.js, schemas.js
    tests/phaseN/         gate tests; tests/helpers (resetDb, drainQueue, runNode); tests/fixtures

## Rules

1. Work TDD: one failing test, make it pass, repeat. Test at the seam (HTTP via supertest,
   or a module's service.js). Never test private helpers.
2. Done = `npm run gate -- N` exits 0. Gates are cumulative.
3. Never delete, `.skip`, `.only` or weaken an existing test, or loosen a Zod schema, to get
   green. If a test is wrong, stop and report.
4. Three failed attempts at the same failure: stop, write it to progress.md, escalate.
5. Touch only the files your task owns. Other modules are reached through their
   `service.js` only. Do not edit `src/app.js` or another module's folder.
6. Migration numbers are reserved per phase: P0 001-009, P1 010-019, P2 020-029, ...
   P8 080-089. Plain SQL. `-- @if pgvector` / `-- @if array` ... `-- @endif` blocks and
   `{{VECTOR}}` (vector(EMBED_DIM) or float8[]) handle the vector backend.
7. Only `src/modules/search/repo.js` knows which VECTOR_BACKEND is active.
8. Every external system sits behind an adapter with a deterministic fake. Tests run with
   ADAPTERS=fake and never touch the network. Model IDs come from env, never code.
9. Zod validates every request body (`validate(schema)` from src/lib/http.js), every job
   payload (src/queue/jobs.js), every agent output and the Timeline JSON.
10. Errors: throw `HttpError` helpers from src/lib/errors.js; the error handler renders
    `{ error: { code, message, details?, requestId } }`. Never leak internals in a 500.
11. Replacing a stub: swap `stubRouter(...)` in your module's routes.js for a real
    `Router({ mergeParams: true })` with the same paths. Project-scoped routers are mounted
    at `/projects/:projectId` and declare full sub-paths.
12. Jobs: add the payload schema to `src/queue/jobs.js`, the handler to
    `src/workers/index.js`. In tests, `drainQueue()` runs pending jobs inline.
13. Tests use DATABASE_URL_TEST only (`resetDb()` refuses any database not ending `_test`).
14. On green: one commit per task, `phase N: <task>`. Append a 5-line entry to progress.md:
    task, what was done, what was learned, what is next, gate result.
