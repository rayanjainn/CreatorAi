# Contributing

Short version: branch, small commits, tests, green `make lint` and `make test`, docs updated.

## Set up

```bash
make doctor && make setup && make seed && make dev
```

See the [README](README.md) and [docs/RUNBOOK.md](docs/RUNBOOK.md). Project state and rules of the road: [docs/HANDOFF.md](docs/HANDOFF.md).
What to build next: [docs/TODO.md](docs/TODO.md).

## Workflow

- Branch from `main`: `feat/<area>`, `fix/<topic>` or `docs/<topic>`. Open a pull request into `main`.
- Commits are small and descriptive: `feat(area): ...`, `fix: ...`, `docs: ...`, `test: ...`. Use your own git identity.
  **No AI attribution** in commits, pull requests or docs (no `Co-Authored-By` or "Generated with" lines).
- Behaviour changes need tests, and docs change in the same commit (`docs/API.md` for endpoints, the relevant guide
  for conventions). Never edit an applied migration; add a new one.

## Before you push

```bash
make lint      # ruff check + format check, eslint
make test      # backend pytest, frontend typecheck + eslint + vitest
make e2e       # for UI changes (Playwright against the real stack)
make gen-api   # after any backend route or schema change; commit openapi.json and schema.d.ts
```

If you changed the timeline service or schema, regenerate the golden file (RUNBOOK section 8) and keep the TypeScript
mirror in `frontend/src/lib/timeline` in step.

## Rules that matter

- Anything generated carries `provenance`, and the UI shows a badge. Never present mock, heuristic or demo data as real.
- Every repository query takes `workspace_id`; routers never touch SQL; services never import FastAPI.
- Errors are `AppError("CODE", ...)` and serialise as `{error: {code, message, details}}`.
- Backend: Python 3.11+, type hints, ruff (line length 100). Frontend: TypeScript strict, ESLint clean.
- No secrets in git. `.env` and `data/` are ignored.

How to add a router, job, LLM task, migration, page or hook: [docs/HANDOFF.md](docs/HANDOFF.md) section 6.
