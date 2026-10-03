# Documentation index

| Read this | When |
|---|---|
| [../README.md](../README.md) | first: what it is, 4-command quick start, prerequisites, API keys, commands |
| [RUNBOOK.md](RUNBOOK.md) | running and operating it: first-run output, every env var, models, ASR, Ollama, resetting, backups, troubleshooting |
| [HANDOFF.md](HANDOFF.md) | taking over the project: what is built and not, decisions and why, contracts, how to extend, conventions, branch history, test inventory, "verify on your machine first" |
| [TODO.md](TODO.md) | what to build next, prioritised with acceptance criteria |
| [DEMO_GUIDE.md](DEMO_GUIDE.md) | giving a 5 to 7 minute demo, and what to do when it fails live |
| [ARCHITECTURE.md](ARCHITECTURE.md) | how the processes, jobs, LLM gateway, ingest, matching, clips, timelines, rendering and data layout work |
| [API.md](API.md) | endpoint semantics, error codes, provenance (the live schema is `GET /openapi.json`) |
| [BACKEND_FOUNDATION.md](BACKEND_FOUNDATION.md) | extension guides: router, repository, job, LLM task, migration, embeddings, ASR, storage, tests |
| [LOCAL_FIRST.md](LOCAL_FIRST.md) | what replaced Docker, Postgres, Redis and Supabase; the dev experience contract |
| [UI_SPEC.md](UI_SPEC.md) | the page and component spec the frontend follows |
| [FRONTEND_NOTES.md](FRONTEND_NOTES.md) | frontend gaps and decisions (consolidated into TODO item 10) |
| [../frontend/README.md](../frontend/README.md) | web app structure, conventions, editor internals, e2e |
| [../Plan.md](../Plan.md) | the product plan (schema, contracts, algorithms) with an implementation status table at the top |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | contribution workflow |

Precedence when documents disagree: code, then LOCAL_FIRST (infrastructure) over Plan.md. Check links with `make docs-check`.
