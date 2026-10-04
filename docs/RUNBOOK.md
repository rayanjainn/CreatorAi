# Runbook: operating CreatorAi

How to run, configure, reset, back up and fix CreatorAi on one machine. For the quick start see the
[README](../README.md); for project state see [HANDOFF.md](HANDOFF.md).

## 1. First run, step by step

```bash
make doctor    # optional, setup runs it too
make setup
make dev          # then open http://localhost:3000 and create your account
make seed         # OPTIONAL: labelled [DEMO] data for a populated tour
```

**`make setup`** (safe to re-run) prints the doctor report, then creates `backend/.venv`, installs the backend
(`pip install -e "backend[dev]"`), runs `npm ci` (skipped when `frontend/node_modules` is newer than the lockfile),
copies `.env.example` to `.env` if there is no `.env`, applies migrations and tries to download the embedding
model. Expected tail on a connected machine:

```
database: /.../data/creatorai.db
applied: 001_init.sql, 002_idea_provenance.sql, 003_beat_match_provenance.sql, 004_render_meta.sql
[ok] embedder ready: fastembed sentence-transformers/all-MiniLM-L6-v2 (384-d)

Setup done. Next: make dev, then open http://localhost:3000 and create your account (optional: make seed for labelled demo data)
```

Offline (or blocked Hugging Face) the download step prints `[FAILED] embedder: ...` and the line
`WARNING: model download failed (offline?)`. That is **not fatal**: the app runs with a clearly labelled heuristic
embedder until you run `make models` online (section 4). Re-running `make setup` later is harmless.

**`make seed`** takes about 10 seconds and ends with:

```
Done. Login: demo@creatorai.local / demo1234
Hero project id: <uuid>  (open /projects/<uuid>)
```

It is idempotent (nothing is duplicated). `make seed ARGS="--reset"` removes only what an earlier seed created and
seeds again; `ARGS="--render"` also renders the best hero clip; `ARGS="--skip-hero"` skips the footage pipeline.
If a user already exists, the demo data is attached to that account's workspace instead of creating the demo user.
Without an AI key you will see `CAPTIONS_UNAVAILABLE` and `LLM_NOT_CONFIGURED` notes: that is the honest unconfigured
behaviour, seeding does not call an LLM.

**`make dev`** starts both servers and prints:

```
  API   http://localhost:8000   (docs: /docs, health: /api/v1/health)
  Web   http://localhost:3000
  Press Ctrl-C to stop.
```

The first page load compiles the web app (a few seconds). Ctrl-C (or `kill` on `make dev`) stops both processes.
Check it is alive: `curl http://localhost:8000/api/v1/health` returns `{"status":"ok", ..., "data_mode": ...}`.

## 2. Configuration: every `.env` variable

`.env` lives in the repo root and is read by the backend (any working directory). Process environment variables
override it. Restart the API after editing (`make dev` auto-reloads Python code, not `.env`).
`data/.secret` and `.env` are git-ignored; never commit keys.

### Runtime
| Variable | Default | Meaning |
|---|---|---|
| `APP_ENV` | `dev` | `dev`, `test`, `prod` |
| `LOG_LEVEL` | `INFO` | Python log level |
| `DATA_DIR` | `./data` | where the database, media, renders, tmp and models live (relative to the repo root) |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | origins the browser may call the API from. `make dev WEB_PORT=...` sets it for you |
| `FRONTEND_URL` | `http://localhost:3000` | used for redirects (OAuth later) |

### Auth
| Variable | Default | Meaning |
|---|---|---|
| `AUTH_MODE` | `local` | only mode available: email + password |
| `AUTH_ALLOW_MULTI` | `false` | `true` lets more than one account sign up. Signup is otherwise open only while no user exists |
| `JWT_TTL_DAYS` | `7` | sign-in lifetime |
| `APP_SECRET` | blank | blank = generated once into `data/.secret` (chmod 600). Signs JWTs and encrypts stored tokens |
| `MEDIA_SIGNING_SECRET` | blank | blank = derived from `APP_SECRET` |
| `MEDIA_URL_TTL_SEC` | `3600` | lifetime of signed `/media/...` URLs |

### YouTube (not built; reserved)
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: read by the config and reported in
`/health` (`features.youtube.configured`), but no `/youtube/*` endpoints exist yet (see [TODO.md](TODO.md)).

### LLM
| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | blank | Google AI Studio key |
| `GEMINI_MODEL_MAIN` / `GEMINI_MODEL_LITE` | `gemini-2.5-flash` / `gemini-2.5-flash-lite` | heavy tasks / cheap tasks (**ids unverified against the live API**, see HANDOFF) |
| `GROQ_API_KEY` | blank | Groq key (also used for Whisper) |
| `SEARCH_PROVIDER`, `TAVILY_API_KEY`, `SERPER_API_KEY` | `tavily`, blank | web search for the Research tab (optional; free tiers) |
| `LUMICLIP_API_KEY`, `CLOUDINARY_*` | blank | optional cloud clipper and the library-video upload it needs |
| `GROQ_CHAT_MODEL` | `llama-3.3-70b-versatile` | |
| `OLLAMA_API_KEY` | blank | Ollama Cloud key; blank for a local server |
| `OLLAMA_BASE_URL` | `https://ollama.com` | `http://localhost:11434` for a local server. **Do not set it to an empty value**: an empty string counts as "configured" |
| `OLLAMA_MODEL` | `gpt-oss:120b` | any model your account/server can run |
| `OLLAMA_VISION_MODEL` | `qwen3-vl:235b` | used for image tasks; blank disables Ollama for vision |
| `LLM_PROVIDER_ORDER` | `gemini,groq,ollama` | who is tried first; unconfigured providers are skipped |
| `LLM_ALLOW_MOCK` | `false` | dev/test opt-in for the fake provider (`[MOCK]` output, red banner) |
| `LLM_CACHE_ENABLED` | `true` | cache identical requests |
| `LLM_TIMEOUT_SEC` | `30` | per request |
| `LLM_QUEUE_WAIT_SEC` | `25` | max wait for a rate-limit slot before `LLM_BUSY` |
| `GEMINI_RPM`, `GROQ_RPM`, `OLLAMA_RPM`, `GROQ_TPM` | `8`, `20`, `30`, `6000` | in-process limits, conservative for free tiers |
| `GROQ_MAX_INPUT_TOKENS` | `6000` | skip Groq when the prompt estimate is bigger |
| `LLM_BACKOFF_BASE_SEC` | `1` | 429/5xx backoff 1 s, 2 s, 4 s (3 tries) |
| `LLM_CIRCUIT_FAILURES` / `LLM_CIRCUIT_OPEN_SEC` | `3` / `60` | consecutive failures that stop using a provider, and for how long |

### Transcription
| Variable | Default | Meaning |
|---|---|---|
| `ASR_PROVIDER` | `auto` | `auto` (Groq if a key exists, then local), `groq`, `faster-whisper`, `none` |
| `GROQ_WHISPER_MODEL` | `whisper-large-v3-turbo` | |
| `WHISPER_LOCAL_MODEL` | `small` | faster-whisper size (`tiny`, `base`, `small`, `medium`, ...) |
| `ASR_CHUNK_SEC` | `600` | audio is cut into chunks of about this length at silences |
| `ASR_LANGUAGE` | `auto` | or a code such as `en` |
| `ASR_MAX_TRIES` | `3` | attempts per chunk and provider before falling back |

### Embeddings
| Variable | Default | Meaning |
|---|---|---|
| `EMBED_BACKEND` | `auto` | `auto` = fastembed, then sentence-transformers (if installed), then hashing. Or force one |
| `EMBED_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | 384-d |
| `MATCH_OK_ST` / `MATCH_WEAK_ST` | `0.45` / `0.30` | matching thresholds for real embedders |
| `MATCH_OK_HASHING` / `MATCH_WEAK_HASHING` | `0.30` / `0.15` | thresholds for the hashing fallback (**tuned on demo footage only**) |
| `FASTEMBED_CACHE_PATH` | `data/models/fastembed` | not in `.env.example`; set in the environment to move the model cache |

### Uploads and ingest
| Variable | Default | Meaning |
|---|---|---|
| `MAX_UPLOAD_BYTES` | 8 GB | per file |
| `UPLOAD_CHUNK_SIZE` | 8 MB | chunk size handed to the browser |
| `MIN_FREE_DISK_MB` | `200` | an upload needs 2x its size + this free |
| `UPLOAD_STALE_HOURS` | `24` | unfinished uploads are purged nightly |
| `KEYFRAME_EXTRACT_MAX` / `KEYFRAME_MAX_SHOTS` | `48` / `12` | keyframes extracted per video / captioned by the LLM |

### Jobs
| Variable | Default | Meaning |
|---|---|---|
| `JOBS_INLINE` | `false` | `true` runs jobs synchronously (tests only) |
| `JOB_MAX_RETRIES` | `2` | automatic retries |
| `JOB_RETRY_BACKOFF` | `10,30` | seconds before retry 1 and 2 |
| `JOB_POOL_MEDIA` / `JOB_POOL_LLM` / `JOB_POOL_IO` | `1` / `2` / `1` | worker threads per queue |

### Media analysis, clips and rendering
| Variable | Default | Meaning |
|---|---|---|
| `CLIP_MIN_SEC` / `CLIP_MAX_SEC` | `20` / `45` | clip window |
| `CLIP_TOP_K` / `CLIP_KEEP` | `8` / `4` | candidates scored / kept after rerank |
| `SILENCE_MIN_SEC`, `SILENCE_NOISE_DB`, `PAUSE_KEEP_SEC` | `0.6`, `-35`, `0.15` | pause detection and tightening |
| `SHOT_THRESHOLD`, `SHOT_MIN_LEN_FRAMES` | `27`, `15` | PySceneDetect content detector |
| `RENDER_X264_PRESET` | `veryfast` | ffmpeg x264 speed/quality |
| `FFMPEG_BIN`, `FFPROBE_BIN` | `ffmpeg`, `ffprobe` | full paths if not on `PATH` |

Port variables for `make dev` (`API_PORT`, `WEB_PORT`) and `NEXT_PUBLIC_API_URL` (web to API URL) are
process environment variables, not `.env` settings.

## 3. Ports, running pieces separately

```bash
make dev API_PORT=8010 WEB_PORT=3010     # both servers, other ports; CORS and the web's API URL follow
```

Separately (two terminals, from the repo root):

```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --reload-dir app --port 8000
cd frontend && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev -- -p 3000
```

If the web port is not 3000 also set `CORS_ORIGINS=http://localhost:<port>` for the API. **Backend only:** run the
first command, `make seed` (needs no server), and use `http://localhost:8000/docs` (Swagger) or curl:

```bash
TOKEN=$(curl -s localhost:8000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"demo@creatorai.local","password":"demo1234"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s localhost:8000/api/v1/content/board -H "authorization: Bearer $TOKEN" | head -c 400
```

**Production-style web** (what `make e2e` uses): `cd frontend && npm run build && npm run start -- -p 3000`. The API
URL is baked in at build time (`NEXT_PUBLIC_API_URL`), so build with the right one.

## 4. Models

| Model | Command | Size | Used for | Cache |
|---|---|---|---|---|
| Embedding (MiniLM-L6-v2, ONNX via fastembed) | `make models` | ~90 MB | search, matching, scoring | `data/models/fastembed` |
| faster-whisper (`WHISPER_LOCAL_MODEL`, default `small`) | `make models-asr` | about 0.5 GB for `small` | offline transcription | Hugging Face cache (`~/.cache/huggingface`) |

Both need internet **once**. `make setup` tries the embedder and continues with a warning when it cannot.

**What happens offline / without the model:** the embedder falls back to a deterministic hashing embedder. The app
logs `EMBEDDINGS ARE A HEURISTIC FALLBACK` once, `/health` reports `embedder: {backend: "hashing", real: false}`,
Settings labels it, and results are badged **Heuristic**. Hashing only matches shared words, so search and script
matching are noticeably weaker, and the thresholds `MATCH_*_HASHING` apply. **Vectors from different backends are not
comparable.** After downloading the real model: restart the API, then `POST /api/v1/search/reindex` (body
`{"force": true}`) or "reprocess" assets, so existing media is re-embedded; rerun matching on existing projects.
Seeded demo data embedded with hashing is re-embedded the same way, or run `make seed ARGS="--reset"`.

Local Whisper is only loaded when needed (no Groq key or Groq failing); a first `make models-asr` avoids a long
first-upload delay.

## 5. Transcription options

The `transcribe` stage tries, in order: **(1) an attached transcript** (a sidecar: `<file>.words.json`, `.srt` or
`.vtt`), **(2) Groq Whisper** when `GROQ_API_KEY` is set, **(3) local faster-whisper** (the model downloads on first use if you did not run
`make models-asr`, so it needs internet once), otherwise it fails with `ASR_UNAVAILABLE`. A transcript is never invented.

- **Groq Whisper:** set the key. Audio is extracted as 16 kHz mono 48 kbps MP3 and cut into ~10 minute chunks (about 3.6 MB each,
  far under Groq's 25 MB upload cap). Free-tier audio-seconds limits apply.
- **Local:** `make models-asr`, then set nothing (or `ASR_PROVIDER=faster-whisper` to force it). CPU `int8`; slow on
  long footage.
- **Attach a transcript:** in the asset drawer ("Attach transcript"), or
  `curl -X PUT 'localhost:8000/api/v1/assets/<id>/transcript?format=srt' -H "authorization: Bearer $TOKEN" --data-binary @file.srt`.
  SRT/VTT carry cue times only, so word times are interpolated and flagged `words_estimated`.
- `ASR_PROVIDER=none` disables ASR (sidecar only).

## 6. Local Ollama

```bash
ollama pull llama3.1:8b            # or any model that follows JSON instructions
```
```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_VISION_MODEL=               # blank, or a local vision model such as llava, for shot captions
LLM_PROVIDER_ORDER=ollama          # optional: use it first
```

Restart, then Settings, "Test my keys". Small models may fail the strict JSON schemas (you will see
`LLM_INVALID_OUTPUT` or `LLM_BUSY`); prefer a 30B+ class model. Ollama structured output was only tested against
recorded HTTP (see HANDOFF).

## 7. Reset, backup, restore, data layout

| Goal | How |
|---|---|
| Wipe database and media (keep the secret, models, demo footage) | `make reset`, then `make seed` if you want demo data |
| Wipe everything including the secret | stop the API, `rm -rf data/`, `make setup` (signs everyone out; the model downloads again) |
| Forgot the password | `make reset-password` (prompts; non-interactive: `make reset-password ARGS="--email you@x.com --password 'new-password'"`) |
| Backup | stop the API, copy `data/` (database, media, renders, secret). Restore by copying it back |
| Move to another machine | copy `data/` and your `.env` to the same layout; run `make setup` (it will not touch existing data) |

```
data/
  creatorai.db (+ -wal, -shm)     SQLite database (WAL mode: copy all three, or stop the API first)
  .secret                         generated APP_SECRET (keep it with the database)
  models/fastembed/               embedding model cache
  media/{workspace}/{asset}/      original.<ext>, proxy.mp4, thumb.jpg, audio/, keyframes/, transcript.json, sidecar.*
  renders/{render}.mp4 / .jpg     finished renders
  demo/hero_demo.mp4 + .words.json  generated demo footage (make seed / demo-media)
  tmp/                            uploads in progress (tmp/uploads), render work files (tmp/renders)
```

For a consistent hot backup of the database use `sqlite3 data/creatorai.db ".backup backup.db"`.
If you lose `data/.secret`, existing sign-ins stop working (sign in again); passwords and data are unaffected.

## 8. Regenerating generated files

- **API types:** after any backend schema/route change run `make gen-api`. It rewrites `frontend/openapi.json` and
  `frontend/src/lib/api/schema.d.ts` (both committed). Expect FastAPI warnings about duplicate operation ids
  (known, harmless; see TODO).
- **Timeline golden file:** `frontend/src/lib/timeline/golden.json` is generated from the real Python timeline
  service. After changing `backend/app/services/timeline_service.py` or `schemas/timeline.py` run
  `backend/.venv/bin/python backend/scripts/dump_timeline_golden.py frontend/src/lib/timeline/golden.json`, then
  `cd frontend && npm test`. A backend test (`test_timeline_golden.py`) fails while the file is stale; the
  TypeScript mirror in `src/lib/timeline/ops.ts` must be updated to match.

## 9. Upgrading dependencies

```bash
backend/.venv/bin/python -m pip install --upgrade -e "backend[dev]"   # then: make test
cd frontend && npm update && npm test                                  # then: make test, make e2e
```

Constraints that matter: `opencv-python-headless<5` and `scenedetect<0.7` (OpenCV 5 has no Haar face detector, and
scenedetect 0.7 pulls in OpenCV 5); `typescript` is pinned to 5.7.3. Re-run `make gen-api` after upgrading FastAPI or
Pydantic and review the diff of `schema.d.ts`.

## 10. Where the logs are

There are no log files. The API logs to **stderr**; `make dev` prefixes the lines `[api]` and `[web]` in the
terminal. Set `LOG_LEVEL=DEBUG` for more. Per-job history is in the app (Jobs & Activity page, or
`GET /api/v1/jobs`), and every job failure carries its error text. Render ffmpeg output is not stored; the failure
reason is in the render's `error` field. To keep logs: `make dev 2>&1 | tee dev.log`.

## 11. Common errors and fixes

| Symptom | Cause | Fix |
|---|---|---|
| `LLM_NOT_CONFIGURED` (503), "Add a free AI key" banner | no provider configured and mock off (intended) | add one key to `.env`, restart the API, Settings, "Test my keys" |
| `LLM_BUSY` (503, `retry_after`) | every configured provider failed or the rate-limit queue was full; circuit breakers open for 60 s after 3 failures | wait `retry_after` seconds and retry; check Settings for a provider with an open circuit; verify the key and model id; lower load or add a second provider |
| Test keys: "model not found" / 404 | model id not available to your key | set `GEMINI_MODEL_MAIN`/`GROQ_CHAT_MODEL`/`OLLAMA_MODEL` to an id listed in the provider's console |
| Asset failed at `transcribe`: `ASR_UNAVAILABLE` | no sidecar, no Groq key, no local Whisper | set `GROQ_API_KEY`, or `make models-asr`, or attach a transcript; then "Reprocess" resumes from the failed stage |
| `LLM_INVALID_OUTPUT` (502) | a model returned JSON that failed the schema twice | retry; use a stronger model |
| `make dev`: "Port 8000 (API) is already in use" | another process (an old `make dev`, another app) | stop it, or `make dev API_PORT=8010 WEB_PORT=3010`. Find it: `lsof -i :8000` (macOS/Linux) |
| Browser shows CORS errors / "Failed to fetch" | web port is not in `CORS_ORIGINS`, or the web build points to another API URL | use `make dev WEB_PORT=...` (sets CORS) or edit `CORS_ORIGINS`; rebuild the web app after changing `NEXT_PUBLIC_API_URL` |
| `ffmpeg not found` / `MEDIA_FAILED` | ffmpeg missing, or `FFMPEG_BIN` wrong | install it (README), run `make doctor` |
| `No such filter: 'subtitles'` / captions look slightly different from libass | ffmpeg built without libass (Homebrew's `ffmpeg` 9) | nothing to fix: with `CAPTION_RENDERER=auto` (default) exports use the built-in Pillow caption renderer, which needs no libass or freetype. `curl localhost:8000/api/v1/health` shows `features.captions {renderer, libass}`; `make doctor` reports it. The error only appears when `CAPTION_RENDERER=libass` is forced on such a build: set it back to `auto` (or `pillow`). The built-in look is close to libass but not pixel-identical; install a libass build (`FFMPEG_BIN` / `FFPROBE_BIN` in `.env`; `make doctor` prints which `ffmpeg` it tested) if you prefer libass |
| Video does not play in the browser, player shows an error panel | Chromium builds (including Playwright's) lack the H.264 decoder | use Chrome, Edge, Safari or Firefox; the file itself is fine (download the render) |
| Face reframing logs "face detection unavailable ... CascadeClassifier" | OpenCV 5 got installed (the Haar detector is gone) | `make setup` repairs it; or `pip uninstall -y opencv-python opencv-python-headless && pip install "opencv-python-headless>=4.9,<5"` in `backend/.venv` |
| `sqlite3.OperationalError: database is locked` | another process holds the write lock for more than 30 s (a `sqlite3` shell with an open transaction, a second API/seed running during a long write, or `data/` on a network/cloud-synced drive) | close the other process; keep `data/` on a local disk (not iCloud/Dropbox/network); run one API only |
| Embedder download blocked (`ProxyError`, `403`, timeouts) | corporate proxy or no internet | set `HTTPS_PROXY` and retry `make models`, or accept the Heuristic fallback; a pre-downloaded model directory can be copied into `data/models/fastembed` |
| Search/matching is poor and badges say Heuristic | hashing embedder active | `make models` while online, restart, then `POST /search/reindex {"force":true}` |
| Search misses everything after a manual `VACUUM` | external-content FTS5 index out of sync | `sqlite3 data/creatorai.db "insert into asset_segments_fts(asset_segments_fts) values('rebuild');"` |
| "Upload failed: insufficient storage" (507) | less than 2x file size + `MIN_FREE_DISK_MB` free | free space; lower `MIN_FREE_DISK_MB` |
| Jobs stuck "interrupted by restart" | the API was stopped mid-job | jobs marked failed on boot; use Retry in Jobs & Activity or "Reprocess" on the asset |
| `REVISION_CONFLICT` (409) in the editor | the clip changed elsewhere | the editor offers reload, merge or overwrite |
| Login rejected after `make reset` | the user was wiped | sign up again (signup is open when no user exists) or `make seed` |
| Unexpected `[MOCK]` text and a red banner | `LLM_ALLOW_MOCK=true` in `.env` | set it to `false`, restart |
| `make setup` fails midway (pip or npm error) | interrupted or partial install | delete `backend/.venv` and/or `frontend/node_modules` and run `make setup` again |

| `faster-whisper failed: open() got an unexpected keyword argument 'metadata_errors'` | PyAV (`av`) version mismatch in local Whisper's own audio decoding | fixed: the app now decodes audio with ffmpeg and passes Whisper an array, so PyAV's `av.open` is never called. Update with `git pull`, then reprocess the asset |
