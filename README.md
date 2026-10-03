# CreatorAi

CreatorAi is a local-first workspace for solo video creators. You plan an idea, write a script with AI, upload your
raw footage, and let the app understand it (transcripts, shots, semantic search), match the script to the footage,
cut short clips and finish them in an editable timeline before exporting. It runs on your own machine as two
processes (a FastAPI API and a Next.js web app) with a SQLite database and files under `data/`: no Docker, no
Redis, no Postgres, no cloud account. The only network use is the AI provider you choose (Gemini, Groq or
Ollama; all have free tiers) and, once, the model downloads.

Everything that is not a real model result is labelled in the UI (AI, Mock, Heuristic, Demo, You), and the app
never fakes AI output: without a key the AI tools say so and the rest keeps working.

## Quick start

```bash
git clone <this repo> && cd BNB26_PookieBlinder_Internal_Round
make setup     # checks prerequisites, venv + dependencies, .env, database, model download (1 to 3 min)
make seed      # demo user, board, hero project with real pipeline output (~10 s)
make dev       # API on :8000 and web on :3000
# open http://localhost:3000   and sign in:  demo@creatorai.local / demo1234
```

That is all you need to look around. To switch the AI tools on, put **one** free key in `.env` (see
[AI keys](#ai-keys)) and restart `make dev`. Not sure your machine is ready? Run `make doctor` first.

Seeded content is clearly marked: cards are titled `[DEMO] ...` and carry a Demo badge. The hero project
(`[DEMO] My whole editing workflow in under a minute`) comes with generated footage, a script, a Director plan,
a match report and two clips. A 5 to 7 minute tour is in [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Python | 3.11 or newer (tested on 3.11) with `venv` | backend |
| Node.js | 20 or newer (tested on 22 LTS) and npm | web app |
| FFmpeg + ffprobe | 6 or newer recommended, **built with libx264** (libass is optional) | media analysis, proxies, renders |
| Disk | ~2 GB for dependencies, plus your media | |
| Internet | once, for `pip`, `npm` and the ~90 MB embedding model | everything else is offline |

`make doctor` checks all of this and prints the install line for anything missing.

| Platform | Install the prerequisites |
|---|---|
| macOS | `brew install python@3.12 node@22 ffmpeg` |
| Ubuntu / Debian | `sudo apt update && sudo apt install -y python3 python3-venv ffmpeg git make` and Node 22: `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt install -y nodejs` (Ubuntu 24.04 and Debian 12/13 ship Python 3.11+. Ubuntu 22.04 ships 3.10: `sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt install python3.12 python3.12-venv`, then `make setup PYTHON=python3.12`) |
| Windows | Use **WSL2**: `wsl --install` in an admin PowerShell, open the Ubuntu shell, clone the repo **inside the Linux filesystem** (`~/...`, not `/mnt/c`), then follow the Ubuntu line. Native Windows is not supported (the Makefile needs bash). Open the app in your Windows browser at `http://localhost:3000` |

Captions are burned into exports either with libass (the ffmpeg `subtitles` filter) or, when this ffmpeg has no libass (Homebrew's `ffmpeg` 9 has none), with a built-in Pillow renderer that only needs ffmpeg's core filters. `CAPTION_RENDERER=auto` (default) picks libass when it works and the built-in renderer otherwise; `make doctor` reports which one you will get and `GET /api/v1/health` shows it under `features.captions`. Nothing to install either way. To use a different ffmpeg set `FFMPEG_BIN` / `FFPROBE_BIN` in `.env`.

## AI keys

One key is enough; the app tries providers in the order of `LLM_PROVIDER_ORDER` (default `gemini,groq,ollama`)
and skips unconfigured ones. Put keys in `.env` (created by `make setup`), then restart `make dev`.

| Provider | Get a free key | `.env` variable |
|---|---|---|
| Gemini (Google AI Studio) | https://aistudio.google.com/apikey | `GEMINI_API_KEY` |
| Groq | https://console.groq.com/keys | `GROQ_API_KEY` (also enables Whisper transcription) |
| Ollama Cloud | https://ollama.com/settings/keys | `OLLAMA_API_KEY` (model: `OLLAMA_MODEL`) |
| Ollama on your machine | install Ollama, `ollama pull <model>` | `OLLAMA_BASE_URL=http://localhost:11434`, `OLLAMA_MODEL=<model>`, no key |

**Confirm the keys work:** open **Settings, "Test my keys"** (one tiny real request per configured provider,
showing latency and model), or `POST /api/v1/llm/test` with your bearer token. Model ids are user-adjustable
(`GEMINI_MODEL_MAIN`, `GROQ_CHAT_MODEL`, `OLLAMA_MODEL`, ...): free-tier model lists change, so copy current ids from
each console if a test fails with "model not found".

**With no key** the app is in the `unconfigured` state: a setup card explains what to add, AI buttons (plan,
hooks, script, review, clip copy, captions) answer `LLM_NOT_CONFIGURED` (HTTP 503) with the variable names, and
nothing is invented. Upload, local transcription, shots, search, matching, clips, the editor and rendering still
work. **Mock mode** (`LLM_ALLOW_MOCK=true`) is an opt-in for development and tests only: a deterministic fake
provider joins the chain, its text starts with `[MOCK]`, a red banner shows on every page and every result is badged
Mock. Never leave it on.

### What is real, mock, heuristic or demo

Every generated payload carries `provenance: {source, provider, model}` and the UI renders a badge:

| Badge | Meaning |
|---|---|
| **AI** | produced by a real model (provider and model shown on hover) |
| **You** | typed or edited by you |
| **Heuristic** | deterministic non-AI logic: rule-based scores, or the hashing embedder when the real model is not downloaded |
| **Demo** | seeded by `make seed` (`[DEMO]` titles, synthetic analytics) |
| **Mock** | fake provider, only with `LLM_ALLOW_MOCK=true` |

A result mixing sources shows the weakest one. The topbar chip and the `DataModeBanner` follow `GET /api/v1/health`
`data_mode`: `real` (a provider is configured), `unconfigured` (setup card), `mock` (loud warning).

## What you can do today

| Area | What works | Notes |
|---|---|---|
| Asset library | resumable chunked upload (up to 8 GB), probe, proxy, audio, silence, shots, keyframes, transcript (sidecar, Groq Whisper or local faster-whisper), AI shot captions, embeddings; tags, reprocess, delete | video, audio, images, text documents |
| Semantic search | hybrid vector + keyword search over speech and visuals, jump to the moment | needs the embedding model for good quality |
| Content board | Kanban across idea, script, shoot, edit, review, published; idea suggestions; activity log | |
| AI Director | plan (angle, structure, shot list, CSV/Markdown export) and a deterministic review of your footage | plan needs an AI key |
| Scripts | hooks, versioned script with scene tools, meta (titles, description, tags, captions), approval | needs an AI key |
| Script-to-footage matching | maps each script beat to the best transcript span, coverage bar, missing scenes with reshoot hints, swap/confirm/reject | |
| Smart clips | scores windows, reframes 9:16 with face detection, rerank + copy | copy needs an AI key, otherwise labelled heuristic |
| Timeline editor | tracks, trim/split/reorder, captions, revisions with conflict handling, autosave, accept/reject AI layers | Edit and Preview modes only |
| Render / export | YouTube Short, Reels, TikTok, YouTube long presets with burned-in captions, downloads | |
| Jobs and settings | live job progress (SSE), retry/cancel, AI status, key test | |

Not built yet (the pages say so honestly): sponsorships, YouTube connection and publishing, analytics/insights, and
the Creative Twin chat. See [docs/TODO.md](docs/TODO.md).

## Architecture

```
 Browser  (Next.js :3000)
   │  REST + Bearer JWT   ·   SSE /jobs/{id}/events   ·   <video> /media/... (signed, Range)
   ▼
 FastAPI (:8000) ─────────────────────────────────────────────────────────────
   api/v1 routers ──► services ──► repositories ──► SQLite (WAL) data/creatorai.db
   enqueue() ──► in-process job runner (threads: media 1, llm 2, io 1) ──► SSE
   LLM gateway ──► cache ► rate limit ► Gemini / Groq / Ollama   (mock only on opt-in)
   ml: fastembed MiniLM (or flagged hashing) + numpy vectors · ASR chain · shots · scoring
   media: ffmpeg/ffprobe · local storage under data/ · /media Range route
 ─────────────────────────────────────────────────────────────────────────────
   data/  creatorai.db  media/  renders/  tmp/  models/  .secret
```

Deeper: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Ports

| Service | Default | Override |
|---|---|---|
| API | 8000 | `make dev API_PORT=8010` |
| Web | 3000 | `make dev WEB_PORT=3010` (CORS follows automatically) |
| `make e2e` | API 8100, web 3100 | fixed, on a throwaway data dir |

## Commands

`make help` lists everything. The ones you will use:

| Command | What it does |
|---|---|
| `make doctor` | check prerequisites with friendly messages |
| `make setup` | venv, dependencies, `.env`, migrations, model download (safe to re-run) |
| `make seed` | demo data (`ARGS="--reset"` to reseed, `ARGS="--render"` to also render a clip) |
| `make dev` | API + web together, Ctrl-C stops both |
| `make models` / `make models-asr` | download the embedding model / plus local Whisper (needs internet once) |
| `make test` | backend pytest, frontend typecheck + eslint + vitest |
| `make lint` | ruff check + format check, eslint |
| `make e2e` | Playwright end-to-end suite against the real stack (see below) |
| `make reset` | wipe database and media (keeps `data/.secret`), re-migrate |
| `make reset-password` | set the account password from the terminal |
| `make gen-api` | regenerate `openapi.json` and the frontend API types |
| `make docs-check` | check relative links and anchors in all Markdown files |
| `make migrate`, `make demo-media`, `make clean` | apply migrations, generate demo footage, remove caches |

## Tests

```bash
make test    # ~110 s backend (600+ tests, no network, no keys) + ~15 s frontend typecheck, lint, 330 unit tests
make lint    # ruff + eslint
make e2e     # ~48 Playwright tests; needs a Chromium (Playwright's or $PW_CHROMIUM); builds the web app first
```

`make e2e` runs against a throwaway data directory with demo data, API on :8100 and web on :3100. It cannot
play H.264 video in Playwright's bundled Chromium, so playback is asserted through the player's seek target; use
Chrome, Edge or Safari for real playback.

## Project structure

```
backend/
  app/            api/v1 routers · services · repositories · models · schemas · llm · ml · media · workers · storage
  migrations/     SQL migrations (source of truth for the schema)
  scripts/        migrate, seed_demo, make_demo_media, download_models, dump_openapi, dump_timeline_golden, reset_password
  tests/          unit/ and integration/ (pytest)
frontend/
  src/app/        Next.js routes: (public) landing/login, (flow) onboarding, (app) shell + project and editor pages
  src/components/ UI by area (board, library, plan, script, match, clips, editor, provenance, shell, ui ...)
  src/lib/        typed API client + hooks, upload engine, timeline library (mirror of the backend ops), editor controller
  e2e/            Playwright specs
scripts/          dev.py (run both servers), e2e.py, doctor.py, check_links.py
.github/          CI workflow (backend, frontend; e2e on demand)
docs/             handoff, runbook, TODO, demo guide, architecture, API
data/             (git-ignored) your database, media, renders and model cache
Plan.md           the product plan, with an implementation status table at the top
```

## Documentation

| Doc | For |
|---|---|
| [docs/README.md](docs/README.md) | index of all docs |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | operating it: env vars, models, ASR, resetting, troubleshooting, backups |
| [docs/HANDOFF.md](docs/HANDOFF.md) | project state for the next engineer: what is built, decisions, contracts, how to extend |
| [docs/TODO.md](docs/TODO.md) | prioritised list of what is not done yet |
| [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) | a 5 to 7 minute demo script and a "if it fails live" cheat sheet |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | processes, flows, pipelines, data layout |
| [docs/API.md](docs/API.md) | endpoint semantics, errors, provenance |
| [docs/BACKEND_FOUNDATION.md](docs/BACKEND_FOUNDATION.md) | how to add a router, job, LLM task, migration |
| [docs/LOCAL_FIRST.md](docs/LOCAL_FIRST.md) | what replaced Docker, Postgres, Redis and Supabase |
| [docs/UI_SPEC.md](docs/UI_SPEC.md) | the UI spec the pages follow |
| [docs/FRONTEND_NOTES.md](docs/FRONTEND_NOTES.md) | frontend gaps and decisions |
| [frontend/README.md](frontend/README.md) | web app structure, conventions, editor internals |
| [Plan.md](Plan.md) | the full product plan (schema, contracts, algorithms) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | how to contribute |

## Troubleshooting in one minute

| Symptom | Fix |
|---|---|
| `make dev` says a port is in use | `make dev API_PORT=8010 WEB_PORT=3010` |
| Banner "Add a free AI key" | expected without a key; add one to `.env`, restart |
| Settings shows `Heuristic` embedder | model download failed offline; run `make models` online, restart |
| Upload fails at transcription (`ASR_UNAVAILABLE`) | set `GROQ_API_KEY`, or `make models-asr`, or attach a transcript on the asset |
| Video does not play in Chromium | your build lacks H.264; use Chrome, Edge or Safari |

More in [docs/RUNBOOK.md](docs/RUNBOOK.md).
