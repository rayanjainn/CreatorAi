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

## Content board (`api/v1/content.py`, `ideas.py`, `activity.py`)

Stages are `idea | script | shoot | edit | review | published`. Every list is workspace-scoped.

| Method and path | Purpose |
|---|---|
| `GET /content` | Paged `{items,total,limit,offset}`; filters `stage`, `domain`, `q` (title / idea text) |
| `GET /content/board` | `{columns:[{stage,count,cards}], total}`, one column per stage in order, cards sorted by `position`. Filters `q`, `domain` |
| `POST /content` | `{title, idea_text?, objective?, domain?, target_duration_sec?, stage?}` -> `201` card, appended to the end of its column |
| `GET /content/{id}` / `PATCH /content/{id}` | Card. PATCH takes `title, idea_text, objective, domain, target_duration_sec` (a `stage` field is rejected with 422: use `/move`) |
| `POST /content/{id}/move` | `{stage, position?}`: drag and drop. Positions of the source and target columns are renumbered `0..n-1` in the same transaction; `position` is clamped, omitted = end |
| `DELETE /content/{id}?confirm=true` | Without `confirm=true`: `409 CONFIRMATION_REQUIRED` with `details.cascade` (`scripts, director_outputs, clips, assets_detached`). With it: `{deleted, id, cascade}`. Scripts, beats, plans, reviews, matches and clips are deleted; **assets are kept** (unlinked) |
| `GET /ideas?status=suggested` | Paged idea suggestions (`suggested` default, `accepted`, `dismissed`) |
| `POST /ideas/generate` | `{topic?, count=5 (1-10)}` -> `content.ideas` LLM call (synchronous) using the creator context and recent titles; titles equal to an existing content item or idea (normalised) are skipped (`skipped_duplicates`). Stored with `source: "twin"` (the table CHECK only allows `insights` and `twin`; `twin` = creator-context driven, `insights` is reserved for the analytics narrative) |
| `POST /ideas/{id}/accept` | Creates a content item in `idea` stage (profile domain, rationale as `idea_text`) and marks the idea `accepted`. `{idea, content_item}`. `409` if not `suggested` |
| `POST /ideas/{id}/dismiss` | Marks it `dismissed` |
| `GET /activity` | Paged `activity_log`, newest first; filters `action`, `entity_type`, `entity_id` |

Card:

```json
{ "id": "...", "title": "Edit faster", "stage": "script", "position": 0, "domain": "technology",
  "idea_text": "", "objective": "", "target_duration_sec": 45, "published_at": null,
  "thumbnail_url": "/media/media/<ws>/<asset>/thumb.jpg?exp=&sig=",
  "progress": { "assets_total": 2, "assets_ready": 1, "has_plan": true, "has_review": false,
                "has_script": true, "script_version": 2, "script_approved": false,
                "clips_count": 0, "clips_accepted": 0, "percent": 33 },
  "running_jobs": { "active": true, "count": 1, "types": ["asset.process"] } }
```

`thumbnail_url` is the thumb of the first video asset (oldest first) that has one. `progress.percent` is a
checklist of six steps (plan, script, approved script, a ready asset, a clip, published), `clips_*` are 0
while the clips table is empty. `running_jobs` counts queued/running jobs on the item and on its assets.

Stage rules: moving to `shoot` needs a current script with scenes (`409 NO_SCRIPT`), marks that script
approved and emits the twin `script_approved` event (once per script); moving to `published` stamps
`published_at`. A change of stage is logged to `activity_log` as `stage_moved` (`meta: {title, from, to,
position, script_approved}`). Other logged actions: `content_created`, `content_updated`, `content_deleted`,
`ideas_generated`, `idea_accepted`, `idea_dismissed`, `hooks_generated`, `script_generated`, `script_edited`,
`script_restored`, `script_approved`, `scene_regenerated`, `scene_tightened`, `script_meta_generated`,
`plan_generated`, `plan_edited`, `review_generated`.

Idea provenance: generated ideas store `{source, provider, model}` in `idea_suggestions.provenance`
(migration `002_idea_provenance.sql`). It is `null` for rows written without a model (for example by hand).

## Scripts (`api/v1/scripts.py`)

All LLM calls are synchronous (`503 LLM_NOT_CONFIGURED` / `503 LLM_BUSY` with `retry_after`) and nothing is
written when they fail. A script row has `version`, `is_current` (exactly one per item), `hook_options`,
`selected_hook`, `body_md`, `scenes` (Plan 6.6), `meta` (publishing metadata), `tone`, `platform`, `length_sec`,
`provider`, `model`.

| Method and path | Purpose |
|---|---|
| `POST /content/{id}/hooks` | `{count?=5, tone?, platform?}` -> `{script_id, hooks:[{text,type,why,signal_score,detected_type}], provenance}`. Stored on the current script's `hook_options` (a script v1 is created when none exists); `signal_score` / `detected_type` come from `ml/hooks.py` (Plan 8.6) |
| `POST /content/{id}/script/generate` | `{hook, tone?, platform?, length_sec?}` -> the full script (below). Uses the latest Director plan's `structure` when present. Creates a new version and flips `is_current` (a script that only holds hooks is filled in place instead of becoming v2) |
| `GET /content/{id}/script` | Current script; `409 NO_SCRIPT` if the item has none |
| `GET /content/{id}/scripts` | Versions, newest first: `{id, version, is_current, word_count, scene_count, approved, edited, provenance, ...}` |
| `GET /scripts/{id}` | Any version |
| `PATCH /scripts/{id}` | User edits: `{body_md?, scenes?:[{title,intent?,text,beats?}], selected_hook?, meta?:{titles,description,ctas,captions,tags,supporting}}`. Unknown fields are rejected. `beats` may be omitted: the text is re-split into beats of 1-2 sentences |
| `POST /scripts/{id}/restore` | Makes that version current (history is kept) |
| `POST /scripts/{id}/approve` | Current version only (`409` otherwise): moves the item to `shoot` (idempotent) |
| `POST /scripts/{id}/scenes/{idx}/regenerate` | `{instruction?}` -> `script.regenerate_scene`; `{script, scene, words_before, words_after, provenance}` |
| `POST /scripts/{id}/scenes/{idx}/tighten` | `{target_ratio?=0.75 (0.3-0.95)}` -> `script.tighten` |
| `POST /scripts/{id}/meta` | `script.meta`: `{script_id, meta:{titles,description,ctas,captions,tags,supporting}, provenance}`; `409 NO_SCRIPT` while the script has no scenes |

Script response (abridged):

```json
{ "id": "...", "version": 2, "is_current": true, "selected_hook": "Stop editing slowly.",
  "body_md": "# ...", "hook_options": [{"text": "...", "type": "question", "why": "...",
                                         "signal_score": 0.5, "provenance": {"source": "ai", "provider": "gemini", "model": "..."}}],
  "scenes": [{"idx": 0, "title": "Hook", "intent": "...", "est_sec": 8.4, "text": "Stop editing slowly. ...",
              "beats": [{"idx": 0, "text": "...", "intent": "...", "est_sec": 4.2}],
              "provenance": {"source": "ai", "provider": "gemini", "model": "..."}, "edited_by_user": false}],
  "meta": {"titles": ["..."], "description": "...", "ctas": [], "captions": [], "tags": [], "supporting": {}},
  "counters": {"word_count": 112, "est_sec": 44.8, "target_sec": 45, "target_words": 112, "scene_count": 5, "beat_count": 11},
  "style_applied": false, "approved": false, "approved_at": null,
  "edited_by_user": {"body_md": false, "selected_hook": false, "meta": false, "scenes": []},
  "generation": {"words": 112, "target_words": 112, "ratio": 1.0, "within_tolerance": true, "hook_repaired": false,
                 "plan_version": 1, "used_plan_structure": true},
  "provenance": {"source": "ai", "provider": "gemini", "model": "gemini-2.5-flash"},
  "provenance_by_part": {"body_md": {...}, "scenes": {"0": {...}}, "selected_hook": {...}, "meta": {...}} }
```

Behaviour worth knowing:

* **Hook rule**: the first scene must start with the chosen hook verbatim. If the model paraphrased it, the
  first sentence is replaced by the hook (word overlap >= 0.5) or the hook is prepended as its own beat;
  `generation.hook_repaired` says so and `body_md` is rebuilt.
* **Length**: `generation.ratio` is words / (`length_sec` x 2.5). Outside +-25 % a warning is logged and
  `within_tolerance` is false; the call never fails. `est_sec` of beats and scenes is words / 2.5 (computed, not
  taken from the model), `scene.text` is the beats joined.
* **Beats**: `script_beats` mirror the scenes after every generate / edit / scene tool. Unchanged beats keep
  their row (and their `beat_matches`); changed ones are re-embedded. The embedder (backend, model,
  provenance) is recorded in the script's reserved meta key `beats_embedding`; a different backend re-embeds all.
* **Provenance**: `scripts.provider/model` hold the generating model; regenerated or tightened scenes keep
  their own provenance; edited parts report `user` and `edited_by_user` lists them. `provenance` is the weakest
  of all parts (`provenance_by_part` shows each). Reserved keys inside the stored `meta` (`generation`,
  `edited_by_user`, `scene_provenance`, `meta_provenance`, `approval`, `beats_embedding`) are not part of
  the response's `meta`.
* `style_applied` is `creator_profiles.style_profile_rev > 0` (the Twin banner). Regenerating a scene rebuilds
  `body_md` from the scenes.

## AI Director (`api/v1/director.py`)

Routes live under `/content/{id}/director`. Domain templates (`backend/assets/domains/*.json`: structure
archetypes, hook styles, pacing norms, shot conventions, CTA patterns, common risks) feed the prompt.

| Method and path | Purpose |
|---|---|
| `POST /plan` | `{objective?, audience?, domain?, target_duration_sec?, platform?}` (all default from the item and profile) -> new plan version |
| `GET /plan?version=` / `GET /plan/versions` | Latest (or given) version; `409 NO_PLAN` when none |
| `PATCH /plan` | `{shot_list:[{scene?,shot_type,framing,b_roll?,note?}]}` edits the latest version in place; exactly one entry per scene (`422` otherwise); changed rows become `user` |
| `GET /plan/export?format=csv\|md&version=` | Download with `Content-Disposition`; both carry the per-row source |
| `POST /review` | Deterministic scores plus one `director.review` call -> new review version |
| `GET /review?version=` / `GET /review/versions` | Latest / given review; 404 when none |

Plan response: `{id, version, created_at, plan:{domain,objective,audience,angle,structure,storytelling,shot_list,
hook_ideas,cta,risks}, inputs, fixups[], shot_provenance[], edited_by_user:{shot_list:[scenes]}, provenance}`.
After the call the server enforces: `structure[].duration_sec` sums to the target (kept when within 10 %,
otherwise scaled proportionally to the exact target) and the shot list has one entry per scene (missing ones
come from the domain template). Both are listed in `fixups`. Provenance is persisted in
`director_outputs.payload.meta`.

Review response: `{id, version, overall_score, scores:{hook,clarity,pacing,coverage,cta}, strengths, issues:[{type,
severity, at_sec, scene_idx, asset_id, asset_sec, fix}], missing_scenes, suggestions, metrics, warnings,
assets_used, provenance, provenance_by_part:{scores, text}}`.

* **Scores** are computed in `ml/review_metrics.py` exactly as Plan 8.7 from the transcript segments and
  silences of the item's *ready* video/audio assets (concatenated in upload order) and the script's
  `beat_matches`. `wpm` = words / (duration / 60). The model never writes scores; whatever it returns about
  them is ignored.
* **Coverage unknown**: with no script or no `beat_matches` rows `scores.coverage` is `null`, `overall_score`
  is renormalised over the remaining weights, `metrics.coverage_known` is false and a warning
  (`NO_SCRIPT` / `COVERAGE_UNKNOWN`) says why.
* **Issues**: candidates (top-3 silences >= 2.5 s, 3 lowest-coverage scenes, hook < 60, missing CTA,
  filler-dense 20 s windows) are stored in `metrics.candidates`. The model's issues are snapped to a candidate
  (`at_sec` within 1 s, or the same `scene_idx`); type, severity and location come from the candidate and only
  `fix` from the model; anything else is dropped (`payload.meta.dropped_issues`). `asset_id` / `asset_sec`
  let the UI seek inside the right asset.
* **Errors**: `409 ASSET_NOT_READY` (no ready footage, or no transcript; `details.pending_assets`).
* **Provenance**: `provenance_by_part.text` is the model, `scores` is `heuristic` (rule-based; `demo` if the
  transcripts are demo data); `provenance` is the weakest of both, so a review of real AI wording reports
  `heuristic`.

Error codes added by this workflow: `NO_SCRIPT` 409, `NO_PLAN` 409, `ASSET_NOT_READY` 409,
`CONFIRMATION_REQUIRED` 409.
