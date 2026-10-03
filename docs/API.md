# API reference

Base URL `http://localhost:8000/api/v1`. The live schema is `GET /openapi.json` (`make gen-api` writes the
typed frontend client). This file documents behaviour that the schema cannot: semantics, provenance,
processing and error codes. **Later features append their own section here** (copy the layout of the
sections below: endpoint table, then notes).

## Conventions

- **Auth**: `Authorization: Bearer <jwt>` on everything except `/health`, `/auth/signup`, `/auth/login`.
  `GET` requests may use `?access_token=` (EventSource cannot set headers).
- **Errors**: `{ "error": { "code", "message", "details" } }`. Codes used by ingest and search:
  `VALIDATION_ERROR` 422, `NOT_FOUND` 404, `CONFLICT` 409, `UPLOAD_TOO_LARGE` 413,
  `INSUFFICIENT_STORAGE` 507, `UPLOAD_INCOMPLETE` 409 (`details.missing` lists chunk indexes),
  `UPLOAD_CLOSED` 409, `MEDIA_FAILED` 500, `ASR_UNAVAILABLE` 503, `LLM_NOT_CONFIGURED` / `LLM_BUSY` 503.
- **Provenance**: every response containing generated content has `provenance: {source, provider, model}`
  with `source` in `ai | mock | heuristic | demo | user`. A mix reports the weakest source
  (`mock < heuristic < demo < ai < user`). Assets also expose `provenance_by_stage`.
- **Signed media URLs**: `/media/{key}?exp=&sig=` (1 h, HTTP Range supported). Prefix them with the API
  origin in the browser. A fresh URL is minted every time an asset or search result is serialised; use
  `app.security.sign_media(key)` in new code.
- **Pagination**: list endpoints that need totals return `{items, total, limit, offset}` (`limit` 1-200,
  default 50; `offset` >= 0).

## Uploads (`api/v1/uploads.py`)

Resumable, chunked, idempotent. Chunks are stored in `data/tmp/uploads/<workspace>/<upload>/`; the
files on disk are the truth for "what was received".

| Method and path | Purpose |
|---|---|
| `POST /uploads` | Body `{filename, mime?, size_bytes, content_item_id?}` -> `201 {id, chunk_size, total_chunks, received_chunks, status, ...}`. `413 UPLOAD_TOO_LARGE` over `MAX_UPLOAD_BYTES` (default 8 GB); `507 INSUFFICIENT_STORAGE` unless 2x the size + `MIN_FREE_DISK_MB` is free |
| `PUT /uploads/{id}/chunks/{n}` | Raw body (`application/octet-stream`), 0-based `n`. Every chunk is exactly `chunk_size` bytes except the last (the remainder). Re-sending a chunk replaces it (retry-safe); wrong size or index -> 422 |
| `GET /uploads/{id}` | Status for resuming: `received_chunks` (indexes) |
| `POST /uploads/{id}/complete` | Assembles, computes sha256, **dedupes by (workspace, sha256)**, creates the asset and enqueues `asset.process`. Returns `{upload, asset, job_id, duplicate}`. `duplicate: true` reuses the existing asset (no new job). Missing chunks -> `409 UPLOAD_INCOMPLETE`. Completing twice returns the same asset |
| `POST /uploads/{id}/abort` | Deletes the chunks. Unfinished uploads older than `UPLOAD_STALE_HOURS` (24) are purged nightly |

Client loop: `POST /uploads` -> for each index not in `received_chunks`: `PUT` it (up to 4 in parallel) ->
`POST complete` -> follow `job_id` via `GET /jobs/{id}/events` (SSE) or poll `GET /assets/{id}`.

## Assets (`api/v1/assets.py`)

| Method and path | Purpose |
|---|---|
| `POST /assets/upload` | One-shot multipart for small files: `file`, optional `sidecar` (`*.words.json`, `.srt`, `.vtt`), optional `content_item_id`. `201 {asset, job_id, duplicate}`. An invalid sidecar -> 422 and nothing is stored |
| `GET /assets` | Filters `kind`, `status`, `tag`, `content_item_id`, `q` (filename / description / tags), `sort` (`created_at`, `filename`, `duration`, `size`, `status`; prefix `-` for descending; default `-created_at`), `limit`, `offset`. Each item includes the latest `job {id,status,progress,stage}` |
| `GET /assets/{id}` | Card + `urls {original, proxy, thumb, audio}` (signed), `shots[]` (`start_sec,end_sec,caption,tags,keyframe_url,captioned`), `segments[]` (`start_sec,end_sec,text`), `analysis` (stages, probe, asr, embedder, silences, text for documents). `?include_energy=true` adds the loudness curve (dB per 0.5 s) |
| `PATCH /assets/{id}` | `{tags?, folder?, description?, content_item_id?}` (`content_item_id: null` detaches). Edited description/tags are marked user-edited and are not overwritten by later captioning |
| `DELETE /assets/{id}` | Removes rows (segments, shots cascade) and every stored file; cancels running jobs |
| `POST /assets/{id}/reprocess` | `202 {job_id, asset}`. Body `{stage?}`: without `stage` resumes at the first stage missing in `analysis.stages_done` (a skipped caption is retried; the embed stage re-runs by itself when the embedding backend changed); with `stage` restarts there. `409` while a job is active |
| `GET /assets/{id}/transcript` | `{segments:[{idx,start,end,text,words:[{word,start,end}]}], source: sidecar|asr, provider, model, language, words_estimated, provenance}`; 404 until transcribed |
| `PUT` or `POST /assets/{id}/transcript` | Raw body: words.json, SRT or VTT (auto-detected, or `?format=words.json|srt|vtt`). Stores it as the sidecar, invalidates `transcribe` onward and re-runs. `202 {job_id, asset}` |

Asset fields: `status` is `uploaded | processing | ready | failed`; `error` is a human message;
`analysis.error_code` / `analysis.failed_stage` explain a failure; `warnings[]` (`{code, stage, message}`)
carries soft problems such as `CAPTIONS_UNAVAILABLE` (the UI shows "AI captions unavailable").
Cancelling the job returns the asset to `uploaded` with `error: "Processing canceled"`; reprocess resumes.

### Transcript sidecars (provenance)

Order in the `transcribe` stage: attached sidecar -> Groq Whisper -> local faster-whisper -> fail with
`ASR_UNAVAILABLE` ("set GROQ_API_KEY, run `make models-asr`, or attach a transcript"). A transcript is
never invented. Provenance: sidecar = `user` (or `demo` when the file has `"provenance": "demo"`), ASR = `ai`.
`words.json` is `{"language": "en", "provenance": "demo"?, "words": [{"word","start","end"}, ...]}` (a bare
list also works). SRT/VTT carry cue times only, so word times are interpolated (`words_estimated: true`).

## Search (`api/v1/search.py`)

| Method and path | Purpose |
|---|---|
| `GET /search?q=` | Hybrid vector + keyword search with Reciprocal Rank Fusion (k = 60). Params: `limit` (1-50, default 10), `content_item_id`, `kind` (`speech` or `visual`), `asset_kind` (`video|audio|image`). Response `{query, results:[{asset_id, filename, start_sec, end_sec, kind, asset_kind, snippet, thumb_url, score, similarity}], provenance, embedder, warnings}` |
| `POST /search/reindex` | Body `{force?}`. Queues an embed-only re-run (`asset.process` with `from_stage=embed`) for assets embedded with another backend/model (all ready assets with `force`). `202 {queued, job_ids, embedder, provenance}` |

`score` is the fused RRF score (about 0.016 to 0.05, only comparable within one response); `similarity`
is the cosine of the best vector hit (`null` for keyword-only hits). Hits of one asset within 8 s are merged
(range widened, best hit's snippet kept, merged span capped at 45 s). Vector hits below the backend's
`MATCH_WEAK_*` threshold are dropped. `provenance` is `heuristic` while the hashing embedder is active
(`warnings` says so). Assets embedded with a different backend still match by keyword and are reported in
`warnings` until reindexed; vectors of different backends are never compared.
