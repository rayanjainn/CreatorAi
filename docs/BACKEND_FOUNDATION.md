# Backend foundation: extension points

Everything below is already wired. To add a feature you add a file and, at most, one line in a list.
Layering rule: routers (`api/v1`) never touch SQL; services never import FastAPI; repositories take
`workspace_id` first.

## 1. Add a router

Create `backend/app/api/v1/<name>.py`. The module name must already be in `ROUTER_MODULES`
(`api/v1/__init__.py`, which lists every Plan.md module); add it there if it is not.

```python
from fastapi import APIRouter
from app.deps import CtxDep, DbDep, PageDep
from app.repositories.content import ContentItemRepository   # your repository

router = APIRouter(prefix="/content", tags=["content"])

@router.get("")
def list_items(ctx: CtxDep, db: DbDep, page: PageDep, stage: str | None = None):
    return ContentItemRepository(db).list(ctx.workspace_id, limit=page.limit, offset=page.offset, stage=stage)
```

- Always depend on `CtxDep` (auth) and use `ctx.workspace_id`. Only `health`, `auth/signup` and `auth/login` are public.
- `DbDep` commits after the handler and before the response is sent; raise `AppError` to roll back.
- Return Pydantic models (`response_model=`) so `make gen-api` produces useful frontend types.
- Errors: `raise AppError("CLIP_NOT_FOUND", "Clip not found", status=404)` or `not_found("Clip")`.
  Known codes and their default statuses are in `errors.ERROR_CODES` (add yours there).

## 2. Add a repository

```python
from app.models import ContentItem
from app.repositories.base import WorkspaceRepository

class ContentItemRepository(WorkspaceRepository[ContentItem]):
    model = ContentItem
    entity_name = "Content item"

    def in_stage(self, workspace_id: str, stage: str) -> list[ContentItem]:
        stmt = self._scoped(workspace_id).where(ContentItem.stage == stage)   # always start from _scoped
        return list(self.db.execute(stmt).scalars())
```

`get/require/list/add/delete` all require `workspace_id`; `require` raises 404 for other workspaces' rows.
Tables without `workspace_id` (`edit_revisions`, `yt_metrics_daily`) must be reached through their parent.
`repositories/jobs.py` and `repositories/profiles.py` are working examples.

## 3. Add a job handler

```python
# backend/app/workers/tasks/asset_process.py
from app.workers.runner import JobContext, register_job

def handle(ctx: JobContext) -> dict:
    asset_id = ctx.entity_id
    ctx.progress(5, "probe")                   # persists + broadcasts; raises JobCanceled if canceled
    with ctx.session_factory() as db:          # jobs own their sessions; commit yourself
        ...
        db.commit()
    ctx.progress(100, "finalize")
    return {"asset_id": asset_id}              # stored in jobs.result and sent in the final event

register_job("asset.process", handle)          # queue defaults from Plan.md (media/llm/io); pass queue="llm" to override
```

The module path must be listed in `HANDLER_MODULES` (`workers/__init__.py`; all Plan.md job modules are
already listed and are skipped until the file exists). Start work with:

```python
from app.workers.runner import enqueue
job_id = enqueue("asset.process", "asset", asset.id, {"reprocess": False}, workspace_id=ctx.workspace_id)
```

- Handlers must be idempotent and resumable (stage checkpoints in `assets.analysis.stages_done`).
- Raise any exception to fail (auto-retried per `JOB_MAX_RETRIES`); call `ctx.check_cancel()` between slow steps.
- The payload must be JSON-serialisable; it is stored so `POST /jobs/{id}/retry` can re-run the job.
- Tests: `JOBS_INLINE=true` is the default in the test suite, so `enqueue(...)` returns after the job finished.
  To exercise the thread pools set `get_settings().jobs_inline = False` and poll the `jobs` row.
- Nightly work: `from app.workers.scheduler import register_nightly; register_nightly(fn)`.

## 4. Add an LLM task

1. Output model in `llm/schemas.py` and an entry in `TASK_SCHEMAS`.
2. Route in `llm/tasks.py`: `TASK_SPECS["my.task"] = TaskSpec(800)` (add `gemini_tier="lite"` for cheap tasks,
   `vision=True` for image tasks). The chain is built from `LLM_PROVIDER_ORDER`; never hard-code providers.
3. Prompt `llm/prompts/my.task.md`: start with the common preamble, then `{creator_context}`, your
   `{variables}`, and end with `JSON SCHEMA:\n{schema}` (copy any existing prompt).
4. Mock behaviour in `llm/providers/mock.py` (`_HANDLERS["my.task"] = fn`): derive output from the
   variables; it is validated against your schema. Also list the user-visible text fields in `_MARKED`
   so the output carries the `[MOCK]` prefix (mock must be self-evident even if the badge is missed).
5. Call it:

```python
from app.llm import gateway as llm
from app.llm.schemas import HooksOutput

out, meta = llm.run_with_meta("script.hooks", {"topic": t, "count": 5, "tone": "witty", "platform": "shorts"},
                              HooksOutput, ctx.workspace_id)   # sync
provenance = meta.provenance            # Provenance(source="ai"|"mock", provider=..., model=...)
# llm.run(...) is a thin wrapper returning only `out`; use it only when the result is never shown.
```

Errors: `LLM_NOT_CONFIGURED` (503, no real provider and mock off; the message lists the env vars) and
`LLM_BUSY` (503, `retry_after`, every configured provider failed). The gateway never falls back to
mock unless `LLM_ALLOW_MOCK=true`. `meta` = `LLMMeta(provider, model, is_mock, cache_hit, latency_ms)`.

`creator_context` and `schema` placeholders are filled by the gateway. A missing variable raises
`ValueError` at call time. Add a sample to `tests/unit/test_llm_tasks.py` (`SAMPLES`); the parametrised
tests then check prompt rendering and mock validity for the new task automatically.

### Provenance contract (binding for every endpoint)

**Every API response that contains generated content MUST include a `provenance` object** so the UI
can badge it (`app/schemas/common.py`):

```python
from app.schemas.common import Provenance, attach_provenance   # WithProvenance mixin for models
Provenance(source="ai", provider="gemini", model="gemini-2.5-flash")   # meta.provenance
Provenance.heuristic("rules")      # deterministic non-AI logic: hashing embedder, rule-based scores
Provenance.demo()                  # seeded data (is_seed=true rows, make seed): ALWAYS "demo"
Provenance.user()                  # typed or edited by the user
```

`source` is `ai | mock | heuristic | demo | user`. A result that mixes sources reports the weakest one
(mock/heuristic/demo beat ai). Persist the provenance with the row (e.g. in the JSON column next to the
generated payload) so lists and detail views stay badged after a reload. The UI must render a visible
badge for anything other than `ai`/`user`, and never show mock/heuristic/demo as real.

### Provider setup, status and verification

- Providers: Gemini, Groq, Ollama (cloud: `OLLAMA_API_KEY`; local: `OLLAMA_BASE_URL=http://localhost:11434`).
  Ollama is "configured" when a key is set or the base URL is not the cloud default.
- `GET /health` (public) and `GET /llm/status` report `data_mode` (`real` | `mock` | `unconfigured`) and
  per-provider `configured`/`healthy` (healthy = configured and circuit closed).
- `POST /llm/test` (auth) does one tiny real round-trip per configured provider and returns
  `{ok, latency_ms, model, error}` each; error text is key-redacted. Keys are never logged.
- Vision tasks are routed only to Gemini and Ollama (`OLLAMA_VISION_MODEL`); Groq is skipped for
  images and when the prompt estimate exceeds `GROQ_MAX_INPUT_TOKENS`.

## 5. Add a migration

Create `backend/migrations/002_<name>.sql` (SQLite dialect, applied in name order inside one
transaction, tracked in `schema_migrations`). Never edit an applied migration. Update the matching model in
`app/models/` in the same commit. `make migrate` or app startup applies it; tests migrate a fresh DB.
SQLite notes: JSON is `TEXT` with a `json_valid` CHECK, booleans are `INTEGER 0/1`, timestamps are ISO
strings (use `utcnow()`), no triggers for `updated_at` (SQLAlchemy `onupdate`).
`ALTER TABLE ... DROP COLUMN` needs SQLite 3.35+.

## 6. Embeddings and vectors

```python
from app.ml.embedder import embed_texts, embedder_info
from app.ml.vectors import pack_vector, unpack_matrix, top_k

vecs = embed_texts(["a", "b"])                     # (n, 384) float32, L2-normalised
embedder_info()["real"]                            # False => hashing heuristic fallback; use embedder_provenance()
row.embedding = pack_vector(vecs[0])               # BLOB
hits = top_k(query_vec, unpack_matrix([r.embedding for r in rows]), k=5)   # [(index, cosine)]
ok, weak = get_settings().match_thresholds(embedder_info()["backend"])      # per-backend thresholds
```

Default backend order is `fastembed` (ONNX MiniLM, core dependency) -> `sentence-transformers` (if
installed) -> `hashing`. Hashing is a flagged heuristic: a WARNING is logged once, `/health` reports
`embedder: {backend, real: false}` and results must be badged `heuristic` (`embedder_provenance()`).
The model downloads on first use; `make models` preloads it (`make setup` runs it non-fatally).
Do not mix vectors from different backends in one index; re-embed after switching backend.

### ASR providers (`ml/asr`)

```python
from app.ml.asr import get_asr_chain, ASRError
for p in get_asr_chain():                          # [GroqASR, LocalASR] filtered by ASR_PROVIDER/config
    try:
        t = p.transcribe(chunk_path, language=None, offset_sec=chunk_start)   # Transcript
        break                                      # t.words/t.segments in original-audio seconds
    except ASRError as exc:
        if not exc.retryable: ...                  # then try the next provider
```

`Transcript` carries `provider`, `model`, `language`, `words`, `segments`, `words_estimated` (Groq returned
no word times, so they were interpolated per Plan 8.2) and `.provenance` (`ai`). Groq uses
`/openai/v1/audio/transcriptions` (multipart, `verbose_json`, word + segment granularities); local uses
faster-whisper (`int8`, `word_timestamps`, `vad_filter`). Sidecar transcripts are handled by ingest, and an
empty chain / total failure must fail the `transcribe` stage with `ASR_UNAVAILABLE`, never invent text.
`make models-asr` preloads the Whisper model.

## 7. Storage, media URLs and ffmpeg

```python
from app.storage.local import get_storage
from app.security import sign_media
store = get_storage()
store.put_file(f"media/{ws}/{asset}/original.mp4", upload_path)
path = store.path_for(f"media/{ws}/{asset}/original.mp4")     # for ffmpeg
asset_out["proxy_url"] = sign_media(proxy_key)                  # "/media/<key>?exp=&sig=" (relative to the API origin)

from app.media.ffmpeg import probe, run
info = probe(path)
run(["-i", path, ...args, out], duration=info.duration, on_progress=lambda f: ctx.progress(30 + 40 * f, "proxy"))
```

The frontend must prefix `/media/...` URLs with the API origin (`http://localhost:8000`).

## 8. Testing conventions

- `tests/conftest.py` creates one temp `DATA_DIR` for the session, migrates once, wipes every table after
  each test and resets singletons (pubsub, gateway, job registry). No network, no keys, hashing embedder, `LLM_ALLOW_MOCK=true` set **explicitly** (the config default is
  false). Tests of real providers use `httpx.MockTransport`; stub model loaders for embedder/ASR. Never hit the network.
- Fixtures: `client` (TestClient), `auth` (signed-up user's headers), `workspace_id`, `data_dir`.
- `make test` runs the whole backend suite in a few seconds; `make lint` runs `ruff check` and `ruff format --check`.

## Decisions to know

- `JobContext` handlers are sync functions; `llm.run` is a sync function (no async anywhere).
- `LLM_ALLOW_MOCK` defaults to **false**. When true, `mock` is the last link of every chain; mock results
  are not cached, carry `provenance.source="mock"` and `[MOCK]` text markers.
- Seed/demo convention: anything created by `make seed` or flagged `is_seed` (e.g. `yt_videos`) is
  `provenance.source = "demo"` in every response that exposes it.
- Signup is allowed only while no user exists (`AUTH_ALLOW_MULTI=true` lifts that). The profile is created
  with `domain="technology"` and `onboarding_done=false` until `POST /onboarding`.
- `GET /api/v1/health` is public and returns versions, `data_mode` and feature flags (LLM providers, ASR, embedder incl. `real`, ffmpeg).

## Ingest, assets and search (extension points)

```python
# read access (always scope by workspace)
from app.repositories.assets import AssetRepository, SegmentRepository, ShotRepository
segments = SegmentRepository(db).for_asset(ws, asset_id)      # AssetSegment(idx,start_sec,end_sec,text,words,embedding)
shots = ShotRepository(db).for_asset(ws, asset_id)            # AssetShot(idx,start_sec,end_sec,keyframe_key,caption,tags,embedding)

# signed URLs (never expose keys or paths)
from app.security import sign_media
url = sign_media(shot.keyframe_key)                           # "/media/<key>?exp=&sig="
from app.services.assets import asset_out, asset_detail       # dicts with urls + provenance

# vectors: embeddings are float32 BLOBs; only compare vectors with the same analysis.embedder (backend, model)
from app.ml.vectors import unpack_vector, unpack_matrix
from app.ml.embedder import embed_texts, embedder_info, embedder_provenance
from app.services import search_service
search_service.search(db, ws, "query", limit=10)              # same payload as GET /search
search_service.invalidate(ws)                                 # call after writing segments/shots/embeddings/metadata

# react to a finished asset without touching ingest
from app.services import hooks
hooks.register_after_asset_ready(lambda workspace_id, asset_id: ...)

# start / resume processing from code (commits first; returns None if the handler is not registered)
from app.services.assets import start_processing, reprocess
start_processing(db, ws, asset, from_stage="embed")           # payload: from_stage, skip_hooks
```

- `AppError(..., retryable=False)` makes the job runner skip retries (used for `ASR_UNAVAILABLE`).
- Handler modules may define `register()`; `workers.load_handlers()` calls it, so tests can re-register
  handlers after the registry is cleared (`tests/conftest.py` does this before every test).
- `schemas.common.weakest([...])` combines provenances; `analysis.provenance[stage]` stores per-stage values.
- Test helpers: `tests/helpers.py` (`upload_file`, `get_asset`, `gemini_gateway` + `install_gateway`
  for a stubbed real LLM, `wipe_provider_keys` for "no LLM"), fixtures `demo_media` (45 s DEMO footage +
  sidecar, generated by `backend/scripts/make_demo_media.py`) and `tiny_media` (6 s clip), `no_processing`
  (uploads without running the pipeline). Binary fixtures are generated on the fly, never committed.
- Demo footage: `make demo-media` writes `data/demo/hero_demo.mp4` and `hero_demo.words.json`
  (`"provenance": "demo"`). `make seed` should ingest it with
  `services.assets.register_file(..., sidecar=(text, name), sidecar_source="demo")` + `start_processing`.

## Matching, clips and timelines (extension points)

```python
from app.schemas.timeline import Timeline, Tracks, VideoItem, CaptionItem, AudioItem, OverlayItem, Transition, new_item_id
from app.services import timeline_service as ts
from app.services.edit_service import apply_op, save_edit       # persisted, revisioned, conflict-checked

tl = Timeline.model_validate(edit.timeline)          # strict (extra fields are rejected)
tl2 = ts.split_item(tl, at_tl=12.0)                  # every op returns a NEW Timeline, input untouched
ts.ensure_valid(tl2, {asset_id: duration})           # 422 VALIDATION_ERROR with details.violations
edit.timeline = tl2.dump()                           # JSON-safe dict
```

Ops (all in `timeline_service`): `tighten_pauses(tl, silences, keep_sec=0.15)`, `trim(tl, start_delta, end_delta,
*, item_id=None, asset_durations=None)`, `set_caption_style(tl, style, *, clear_overrides=False)`,
`toggle_music(tl, on)`, `split_item(tl, at_tl, *, item_id=None)`, `delete_item(tl, item_id)`,
`reorder(tl, item_id, to_index)`, `set_status(tl, item_id, status)`, `accept_all(tl)`,
`rebuild_captions(tl, words_provider, *, max_words=None, source="ai", status="suggested")`,
`ripple_insert(tl, at_tl, item)`, `recompute_duration(tl)`, plus `apply_op(tl, name, params, OpContext)` and
`layer_changes(before, after)`. Sponsors: build `VideoItem(kind="sponsor", asset_id=None, placeholder=True,
src_in=0, src_out=brief.duration_sec, text=script, ...)`, call `ripple_insert`, add the `lower_third`
`OverlayItem`, then `rebuild_captions` (placeholder text becomes estimated captions at 2.5 words/s) and save
through `edit_service.save_edit` / the `PUT /clips/{id}/edit` route so the revision and activity are recorded.
Renders read `edits.timeline` (all non-rejected layers) and must pin the `edit.revision` they rendered.

Twin events: `twin_events.CLIP_ACCEPTED = "clip_accepted"` (payload `{clip_id, content_item_id}`); layer
decisions are in `activity_log` (`layer_accepted` / `layer_rejected`, see docs/API.md, Edits).

Test helpers (`tests/helpers.py`): `make_item_with_script(client, auth, scenes=None)` (script whose beats
paraphrase the demo footage, `DEMO_BEATS`) and `seed_demo_asset(client, auth, media, item_id, workspace_id)`
(processed demo footage attached to an item; the pipeline runs once per session, later calls re-insert the
rows). Use them instead of uploading the demo video in every test.
