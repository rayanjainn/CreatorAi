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
2. Route in `llm/tasks.py`: `TASK_ROUTES["my.task"] = TaskRoute((GEMINI_MAIN, GROQ), max_tokens=800)`.
3. Prompt `llm/prompts/my.task.md`: start with the common preamble, then `{creator_context}`, your
   `{variables}`, and end with `JSON SCHEMA:\n{schema}` (copy any existing prompt).
4. Mock behaviour in `llm/providers/mock.py` (`_HANDLERS["my.task"] = fn`): derive output from the
   variables so the offline demo is useful. It is validated against your schema.
5. Call it:

```python
from app.llm import gateway as llm
from app.llm.schemas import HooksOutput

out = llm.run("script.hooks", {"topic": t, "count": 5, "tone": "witty", "platform": "shorts"},
              HooksOutput, ctx.workspace_id)          # sync; raises AppError LLM_BUSY (503, retry_after)
```

`creator_context` and `schema` placeholders are filled by the gateway. A missing variable raises
`ValueError` at call time. Add a sample to `tests/unit/test_llm_tasks.py` (`SAMPLES`); the parametrised
tests then check prompt rendering and mock validity for the new task automatically.

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
row.embedding = pack_vector(vecs[0])               # BLOB
hits = top_k(query_vec, unpack_matrix([r.embedding for r in rows]), k=5)   # [(index, cosine)]
ok, weak = get_settings().match_thresholds(embedder_info()["backend"])      # per-backend thresholds
```

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
  each test and resets singletons (pubsub, gateway, job registry). No network, no keys, hashing embedder.
- Fixtures: `client` (TestClient), `auth` (signed-up user's headers), `workspace_id`, `data_dir`.
- `make test` runs the whole backend suite in a few seconds; `make lint` runs `ruff check` and `ruff format --check`.

## Decisions to know

- `JobContext` handlers are sync functions; `llm.run` is a sync function (no async anywhere).
- `LLM_ALLOW_MOCK=true` makes `mock` the last link in every chain. Mock results are not cached.
- Signup is allowed only while no user exists (`AUTH_ALLOW_MULTI=true` lifts that). The profile is created
  with `domain="technology"` and `onboarding_done=false` until `POST /onboarding`.
- `GET /api/v1/health` is public and returns versions and feature flags (LLM providers, ASR, embedder, ffmpeg).
