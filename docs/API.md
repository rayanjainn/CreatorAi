# API reference

Base URL `http://localhost:8000/api/v1`. The live schema is `GET /openapi.json` (`make gen-api` writes the
typed frontend client). This file documents behaviour that the schema cannot: semantics, provenance,
processing and error codes. **Later features append their own section here** (copy the layout of the
sections below: endpoint table, then notes).

## Conventions

- **Auth**: `Authorization: Bearer <jwt>` on everything except `/health`, `/auth/signup`, `/auth/login`.
  `GET` requests may use `?access_token=` (EventSource cannot set headers).
- **Health**: `GET /health` (public) reports `data_mode`, `signup_open` (true while `POST /auth/signup` would
  succeed) and the `features` block (llm providers, asr, embedder, ffmpeg, youtube).
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

## System: health, auth, profile, jobs, LLM (`health.py`, `auth.py`, `me.py`, `jobs.py`, `llm.py`)

| Method and path | Purpose |
|---|---|
| `GET /health` | Public. `{status, version, time, python, auth_mode, signup_open, data_mode, features}`; `features` = `llm {data_mode, order, providers{name:{configured, healthy}}, mock}`, `asr {sidecar, groq, faster_whisper}`, `embedder {backend, real, provenance, model, dim, match_ok, match_weak}`, `ffmpeg {present, version}`, `captions {renderer: "libass"\|"pillow", libass}` (the caption burn-in renderer exports use; `libass` = whether this ffmpeg's `subtitles` filter works), `youtube {configured}` |
| `POST /auth/signup` | `{email, password (8-200 chars), display_name?}` -> `201 {access_token, token_type, user, workspace_id, workspace_name, profile}`. `403 SIGNUP_CLOSED` once a user exists (unless `AUTH_ALLOW_MULTI`); `409 EMAIL_TAKEN` |
| `POST /auth/login` | `{email, password}` -> same body; `401 INVALID_CREDENTIALS` |
| `GET /auth/me`, `GET /me` | `{user, workspace_id, workspace_name, profile}` |
| `GET /profile`, `PUT /profile` | creator profile: `display_name, domain, audience, tone, language, platforms, style_profile`; PUT accepts any subset |
| `POST /onboarding` | `{display_name, domain, audience?, tone?, language?, platforms?, channel_name?, caption_style?, preferred_aspect?, sample_scripts?}`; sets `onboarding_done` |
| `GET /jobs` | filters `status`, `entity_type`, `entity_id`, `limit`, `offset`. Job: `{id, type, entity_type, entity_id, status queued|running|succeeded|failed|canceled, progress 0-100, stage, error, result, attempts, created_at, started_at, finished_at}` |
| `GET /jobs/{id}` | one job |
| `GET /jobs/{id}/events` | SSE: `event: progress` with `{job_id, type, status, progress, stage, message, result}` (the latest event is replayed first), `: keepalive` comments every 15 s, then `event: done`. Authenticate with `?access_token=` |
| `POST /jobs/{id}/cancel` | `409 JOB_NOT_CANCELABLE` unless queued/running |
| `POST /jobs/{id}/retry` | only failed jobs, else `409 JOB_NOT_RETRYABLE` |
| `GET /llm/status` | `{providers{name:{configured, healthy, circuit_open_sec, usage_today{calls, cache_hits}}}, cache_hits_today, allow_mock, data_mode, provider_order, models, tasks}` |
| `POST /llm/test` | one tiny real round trip per configured provider: `{data_mode, results{name:{configured, ok, latency_ms, model, error}}}`; errors are key-redacted |

`data_mode` is `real` (a real provider is configured), `unconfigured` (none, mock off: AI endpoints answer
`LLM_NOT_CONFIGURED`) or `mock` (`LLM_ALLOW_MOCK=true`).

## Uploads (`api/v1/uploads.py`)

Resumable, chunked, idempotent. Chunks are stored in `data/tmp/uploads/<workspace>/<upload>/`; the
files on disk are the truth for "what was received".

| Method and path | Purpose |
|---|---|
| `POST /uploads` | Body `{filename, mime?, size_bytes, content_item_id?}` -> `201 {id, chunk_size, total_chunks, received_chunks, status, ...}`. `413 UPLOAD_TOO_LARGE` over `MAX_UPLOAD_BYTES` (default 8 GB); `507 INSUFFICIENT_STORAGE` unless 2x the size + `MIN_FREE_DISK_MB` is free |
| `PUT /uploads/{id}/chunks/{n}` | Raw body (`application/octet-stream`), 0-based `n`. Every chunk is exactly `chunk_size` bytes except the last (the remainder). Re-sending a chunk replaces it (retry-safe); wrong size or index -> 422 |
| `GET /uploads/{id}` | Status for resuming: `received_chunks` (indexes) |
| `POST /uploads/{id}/complete` | Assembles, computes sha256, **dedupes by (workspace, sha256)**, creates the asset and enqueues `asset.process`. Returns `{upload, asset, job_id, duplicate}`. `duplicate: true` reuses the existing asset (no new job). Missing chunks -> `409 UPLOAD_INCOMPLETE`. Completing twice returns the same asset. Optional body `{mode: "full" | "light"}`: **`light`** (used by the editor for music, b-roll and stills) runs only probe/audio/proxy/silence (video), probe/audio/silence (audio) or probe/keyframes (image), so the asset is ready in seconds with no transcript, captions or embeddings and **needs no AI key**; it is recorded as `analysis.mode = "light"` |
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
| `POST /assets/{id}/reprocess` | `202 {job_id, asset}`. Body `{stage?, mode?}`: `mode: "full"` upgrades a light asset to the full analysis. Without `stage` it resumes at the first stage missing in `analysis.stages_done` (a skipped caption is retried; the embed stage re-runs by itself when the embedding backend changed); with `stage` restarts there. `409` while a job is active |
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

## Matching (`api/v1/matching.py`, job `project.match`)

Maps every script beat to the transcript span that says it (Plan 8.5). Matching is **never** run
automatically after a script edit: the user presses "Run matching" (`POST /content/{id}/match`). The only
automatic trigger is the `after_asset_ready` hook, which enqueues it when the item has a current script and
every attached asset is ready (`job.payload.trigger = "asset_ready"`).

| Method and path | Purpose |
|---|---|
| `POST /content/{id}/match` | `202 {job_id, pending_assets}`. `409 NO_SCRIPT` (no current script / no scenes), `409 ASSET_NOT_READY` (no ready video/audio asset with a transcript; `details.pending_assets`). An already active job is returned instead of starting another |
| `GET /content/{id}/match` | `{script_id, script_version, ran, embedder, beats[], coverage, missing_scenes[], weak_scenes[], job, provenance}` |
| `POST /beat-matches/{id}/swap` | Either `{alternative_index}` or `{asset_id, start_sec, end_sec}` (422 on both/neither, bad asset, or a range past the asset). Sets `status: confirmed`, provenance `user`; the previous span moves into `alternatives`. Returns the beat |
| `POST /beat-matches/{id}/confirm` | `confirmed` (`409` when the beat has no footage) |
| `POST /beat-matches/{id}/reject` | `rejected` (keeps the span so the UI can show what was refused) |

Beat object: `{script_beat_id, scene_idx, beat_idx, text, est_sec, match_id, status, asset_id, filename,
start_sec, end_sec, timecode ("00:12-00:18"), confidence (cosine), matched_text, out_of_order, shared_span,
thumbnail_url (keyframe of the shot at start_sec), preview_url (signed proxy; seek to start_sec),
alternatives[{index, asset_id, filename, start_sec, end_sec, timecode, score, text, out_of_order, is_current,
thumbnail_url}], provenance, updated_at}`. `status` is `matched | weak | missing | confirmed | rejected`,
or `unmatched` for a beat without a row yet (script edited after the last run). `coverage` =
`{total, matched, weak, missing, confirmed, rejected, unmatched, coverage_pct, matched_sec}` with
`coverage_pct = 100 * (matched + confirmed + 0.5 * weak) / beats` (the formula `ml/review_metrics.py` uses,
so the Director review agrees). `missing_scenes` / `weak_scenes`: `{scene_idx, title, kind, beat_ids, beats,
est_sec, suggestion, provenance}`; `suggestion` is a deterministic reshoot sentence built from the beat text
(no LLM, provenance `heuristic`).

Rules worth knowing:

* **Provenance**: matching is algorithmic. Rows (and the response) report `heuristic` when the hashing
  embedder produced the vectors and `ai` (provider `fastembed` / `sentence-transformers`) for a neural
  embedder; a row that used `match.disambiguate` reports the weakest of both (e.g. `mock`); user decisions
  are `user`. Stored in `beat_matches.provenance` (migration `003_beat_match_provenance.sql`).
* **Thresholds** come from `Settings.match_thresholds(backend)` (neural 0.45 / 0.30, hashing 0.30 / 0.15) and
  are echoed in `embedder.match_ok` / `match_weak`.
* **Mixed backends are refused**: spans are always embedded with the current embedder; if the script's beats
  were embedded with another backend/model they are re-embedded first (job `result.reembedded_beats`).
* **Ambiguity**: when the best two spans are both >= `MATCH_OK` and within 0.03, `match.disambiguate` runs for
  at most 3 beats per run, earliest first, only if an LLM is configured. Otherwise the beats stay as the
  algorithm decided them and `job.notes` says so (the job never fails because of it).
* **Re-runs** upsert `beat_matches` and never touch `confirmed` / `rejected` rows (`result.preserved`).
* `out_of_order: true` on a `weak` beat: its best span is >= `MATCH_OK` but the order constraint put it off the
  path (retake or reordered footage). `shared_span: true` additionally says the only reason is that a
  neighbouring beat uses the same take (beats are finer than transcript segments).
* Job `project.match` result: `{script_id, beats, spans, saved, preserved, counts, embedder, reembedded_beats,
  disambiguated, notes[], provenance}`. Stages: load 10, embed spans 40, align 80, save 100.

## Clips (`api/v1/clips.py`, job `clips.generate`)

| Method and path | Purpose |
|---|---|
| `POST /content/{id}/clips/generate` | `{asset_id?, count? (1-8, default 4), include_full_cut?}` -> `202 {job_id, asset_id}`. Source = `asset_id` or the longest ready video of the item. `409 ASSET_NOT_READY` |
| `GET /content/{id}/clips?status=&kind=` | Clips ordered by LLM/score rank (full cuts last) |
| `GET /clips?status=&kind=&content_item_id=&limit=&offset=` | Clips of **every** content item, best score first (`limit` 1-200, default 200). Feeds the cross-project Smart Clips hub; same `ClipOut` objects |
| `GET /clips/{id}` / `PATCH /clips/{id}` | `PATCH {title?, hook?, caption?}`: edited fields become `user` |
| `POST /clips/{id}/accept` / `reject` | Accept logs `clip_accepted` and emits the twin event `clip_accepted` `{clip_id, content_item_id}` after commit (once; idempotent). Reject logs `clip_rejected` |

Clip object: `{id, content_item_id, source_asset_id, kind: short|full, title, hook, caption, reason, score (0-1),
rank, start_sec, end_sec, duration_sec, status, features, warnings[], preview {url, start_sec, end_sec},
thumbnail_url, edit_revision, timeline_duration, provenance, provenance_by_part}`. Play `preview.url` (signed
proxy) from `start_sec` to `end_sec`; the editor timeline is `GET /clips/{id}/edit`.

* `features` = `{raw, norm, weights, rank, relaxed_min, pause_removed_sec, embedder, edited_by_user}`:
  `raw` are the six feature values (`beat_similarity`, `hook_signals`, `speech_rate`, `audio_energy`,
  `emphasis`, `visual_change`), `norm` the min-max normalised values across the asset's windows, `weights`
  the weights actually used (0.30/0.20/0.15/0.15/0.10/0.10, renormalised without a script or energy data).
* **Provenance** (`provenance_by_part`: `title`, `hook`, `caption`, `scores`): scores are always `heuristic`
  (rule-based); the copy is the model's provenance (`ai` / `mock`), `heuristic` for the deterministic
  fallback, `user` once edited. `provenance` is the weakest part, so AI copy next to rule-based scores
  reports `heuristic` (same convention as the Director review) - read `provenance_by_part` to badge the text.
* **LLM failure**: no provider (`LLM_NOT_CONFIGURED`), `LLM_BUSY` or invalid output never fails the job: the
  top `count` windows by score are kept with fallback copy (title = first 8 words, hook = first sentence,
  caption = first 150 characters) and `warnings` contains `COPY_FALLBACK: <code>: <message>` (job result and
  every clip).
* **Short footage**: when nothing reaches the 20 s minimum the minimum is lowered to 12/6/3 s and the clips
  carry `SHORT_FOOTAGE`. No speech at all: the job fails with `409 NO_CLIP_CANDIDATES`. Windows overlapping
  (IoU >= 0.3) an accepted or rejected clip of the same asset are not proposed again (`NO_NEW_CLIPS` warning
  when that leaves nothing).
* Re-running replaces earlier `suggested` clips that were never edited (revision 1) or rendered; accepted,
  rejected, edited and rendered clips stay.
* Every clip gets an `edits` row (revision 1) and an `edit_revisions` row. The timeline has one video item per
  piece after pause removal (`reason: "pause removed"` on pieces after a cut), `crop_x` from face detection,
  captions from word timestamps, and an AI music item (`-18 dB`, `suggested`) only if the library has a ready
  audio asset tagged `music`. `include_full_cut` adds a `kind: "full"` clip (16:9, `minimal_bottom`, all speech).
  Caption style defaults to `style_profile.captions.style`, else `bold_center`.
* Job stages: candidates 30, score 50, rerank+copy 85, timelines 100.

## Edits and timelines (`api/v1/edits.py`)

Timeline = Plan 6.1, validated by `schemas/timeline.py` + `services/timeline_service.validate`. All times are
seconds. Routes live under `/clips/{id}/edit`:

| Method and path | Purpose |
|---|---|
| `GET /edit` | `{clip_id, edit_id, revision, timeline, updated_at, assets, violations[], provenance}`. `assets[asset_id]` = `{filename, kind, duration_sec, width, height, proxy_url, audio_url, thumb_url, energy[] (dB per 0.5 s, waveform), energy_window_sec, silences[[s,e]], words[{word,start,end}] (only inside the ranges the timeline uses)}` for every referenced asset |
| `PUT /edit` | `{timeline, base_revision, note?}` -> `{revision, timeline, updated_at}`. `409 REVISION_CONFLICT` with `details.current_revision` when `base_revision` is stale; `422 VALIDATION_ERROR` with `details.violations[{code, message, path, item_id}]` |
| `POST /edit/ops` | `{op, params, base_revision, note?}` -> `{op, revision, timeline, changed_layers[], updated_at}`. Same conflict/validation behaviour |
| `GET /edit/revisions` | `[{revision, note, created_at, duration, video_items}]`, newest first |
| `GET /edit/revisions/{n}` | `{revision, note, created_at, timeline}` |
| `POST /edit/revisions/{n}/restore` | Optional body `{base_revision}`. Creates a NEW revision holding the old content (history is never rewritten) |

**Ops** (`params`, all deterministic; unknown ops/params -> 422 with `details.op`): `tighten_pauses {keep_sec
0.05-0.4}`, `trim` / `trim_clip {start_delta, end_delta (+-10), item_id?}` (first/last video item by default;
positive `start_delta` and negative `end_delta` shorten), `set_caption_style {style, clear_overrides?}`,
`toggle_music {on}` (422 if there is no music layer), `split_item {at_tl, item_id?}`, `delete_item {item_id}`
(video ripples gapless), `reorder {item_id, to_index}`, `set_status {item_id, status}`, `accept_all`,
`rebuild_captions {max_words?}` (Plan 8.9 rules), `set_crop_x {item_id, crop_x}`, `ripple_insert {at_tl, item}`,
`recompute_duration`. The Twin's action types map 1:1 (`tighten_pauses`, `set_caption_style`, `trim_clip`,
`toggle_music`).

**Invariants** (violation codes): `DIMENSIONS`, `VIDEO_START`/`VIDEO_ORDER`/`VIDEO_GAP`/`VIDEO_OVERLAP`
(non-rejected video items are gapless from 0; rejected items take no time), `SRC_RANGE`, `SRC_BEYOND_ASSET`
(`0 <= src_in < src_out <= asset.duration`), `LAYER_RANGE` (captions/overlays inside `[0, duration]`),
`DUPLICATE_ID`, `ID_PREFIX` (`v_ c_ a_ o_`), `DURATION_MISMATCH`, `SPONSOR_PLACEHOLDER`, `UNKNOWN_ASSET`.

**Activity**: every status change of a layer is logged per `(status, layer, kind)`: action `layer_accepted` /
`layer_rejected`, `entity_type: "clip"`, `meta {clip_id, content_item_id, layer: video|captions|audio|overlays,
kind, item_ids, count, sources[ai|user], revision}`. A `suggested` birth is not logged. The Twin reads
`layer_rejected`.

Error codes added: `REVISION_CONFLICT` 409, `NO_CLIP_CANDIDATES` 409.

## Renders and export (`api/v1/renders.py`, job `render.run`)

| Method and path | Purpose |
|---|---|
| `POST /clips/{id}/renders` | `{preset: yt_short|reels|tiktok|yt_long, caption_style?}` -> `202 {render, job_id}` (`render.status = "queued"`). `422 DURATION_EXCEEDS_PRESET` with `details {preset, max_duration, duration, over_by}`; `409 ASSET_NOT_READY` (a source file is missing or still processing); `422 VALIDATION_ERROR` (unknown preset, or a clip with no video) |
| `GET /clips/{id}/renders` | Renders of one clip, newest first |
| `GET /renders?status=&limit=&offset=` | Renders of **every** clip, newest first (`status` queued/rendering/done/failed; `limit` 1-200, default 200). Feeds the cross-project Repurpose hub |
| `GET /content/{id}/renders` | Every render of every clip of the item, newest first: the **Renders** list of the export section |
| `GET /renders/{id}` | One render with signed URLs once `done` |
| `DELETE /renders/{id}` | `204`; removes the files. `409 CONFLICT` while queued/rendering (cancel `job_id` first) or when a publish job used it |

Render object: `{id, clip_id, clip_title, clip_kind, content_item_id, preset, caption_style, edit_revision,
status: queued|rendering|done|failed, job_id, duration_sec, size_bytes, error, publishable, created_at,
finished_at, preview_url, download_url, thumbnail_url, stale}`.

* Track progress with `GET /jobs/{job_id}` or the SSE stream (stages `build graph` 10 -> `ffmpeg` 10..95 ->
  `thumbnail` 100). `POST /jobs/{job_id}/cancel` kills ffmpeg; the render becomes `failed` with
  `error: "Canceled"`. A failed render keeps the reason in `error`. Renders left running by a crash or restart
  are marked `failed` ("interrupted by restart") on boot.
* `preview_url` plays inline; `download_url` is the same signed file with `&dl=<name>.mp4`, which makes `/media`
  answer with `Content-Disposition: attachment`. Both are `null` until `done`, valid for one hour (re-fetch
  the render for fresh ones).
* `edit_revision` is the timeline revision that was rendered (read from `edit_revisions`, so edits made while
  a render runs do not leak in). `stale: true` means the clip has been edited since.
* `caption_style` defaults to the preset's (table below). The request does not change the clip: the timeline
  is copied, sized for the preset, and the style applied (items with `style_override` keep theirs). Captions
  are re-grouped for the new style (3 words vs 7 per line) only when all of them are still AI-made, none was
  rejected and none has an override; otherwise the stored captions are used as they are.
* `publishable` is true for `yt_short` and `yt_long`; `reels` and `tiktok` are download only.
* Activity: `render_done` (`entity_type: "render"`, `meta {clip_id, content_item_id, preset, caption_style,
  edit_revision, duration_sec, size_bytes, clip_title}`).

| Preset | Aspect | Size | Max duration | Default captions |
|---|---|---|---|---|
| `yt_short` | 9:16 | 1080x1920 | 60 s | `bold_center` |
| `reels` | 9:16 | 1080x1920 | 90 s | `bold_center` |
| `tiktok` | 9:16 | 1080x1920 | 60 s | `karaoke` |
| `yt_long` | 16:9 | 1920x1080 | none | `minimal_bottom` |

The caps are conservative defaults (confirm the platforms' current limits). Duration = sum of non-rejected
video items; transitions shorten the output by their overlap (`duration_sec` is the real file length).

`GET /media/{key}?exp=&sig=[&dl=name]`: `dl` (max 120 chars, sanitised) is cosmetic and not part of the
signature; it only switches the response to an attachment.

## Demo data (`make seed`)

`make seed` (`ARGS="--reset --render --skip-hero"`, see `backend/scripts/seed_demo.py`) is idempotent. Login:
`demo@creatorai.local` / `demo1234` (when a user already exists the demo data is attached to that workspace
instead). Seeded: 9 `[DEMO]` board cards (3 idea, 2 script, 1 shoot, 1 edit = the hero, 1 review, 1 published),
6 idea suggestions (`source: "twin"`, provenance `demo`), a starter style profile, 24 synthetic YouTube videos
(`is_seed = true`, 90 days of daily metrics from a fixed RNG seed: not real analytics), 10 twin memories
(`source_id = "demo:seed"`, text prefixed `[DEMO]`) and the hero project: generated footage with a `demo`
sidecar through the real `asset.process`, a hand-written script and Director plan (provenance `demo`), then
the real `project.match` and `clips.generate` with no LLM (clip copy provenance `heuristic`, titles prefixed
`[DEMO]`). `--reset` deletes only rows it created. `--render` also renders the best clip with `yt_short`.



## LumiClip cloud clipper (optional)

Cuts short clips out of a video **link** (or a library video) in the cloud, then lets you save the clips to the library.
Keys are server settings (`LUMICLIP_API_KEY`, and `CLOUDINARY_*` to send a *library* video, which needs a public URL); the
browser never sees them. Without a key `GET /lumiclip/status` says `configured: false` and the UI shows a setup card. Every
response carries `provenance: {source: "ai", provider: "lumiclip"}`.

| Endpoint | Notes |
|---|---|
| `GET /lumiclip/status` | `{configured, cloudinary_configured, base_url}` |
| `POST /lumiclip/projects` | Body: exactly one of `url` (http/https) or `asset_id` (ready library video, uploaded to Cloudinary first, `503 CLOUDINARY_NOT_CONFIGURED` otherwise), plus `aspect_ratio` (`9:16`/`16:9`), `start_time`, `end_time`, `language`, `subtitle_style`, `content_item_id`. `201` project. `503 LUMICLIP_NOT_CONFIGURED` without a key |
| `GET /lumiclip/projects` | Newest first. `?content_item_id=` filters |
| `GET /lumiclip/projects/{id}` | While the project runs this asks LumiClip for fresh progress (`step`: downloading, transcribing, analyzing, cutting, done); finished ones are final and cost no provider call. `error_category`: `source_auth`, `source_unavailable`, `api_auth`, `quota`, `unknown` |
| `POST /lumiclip/projects/{id}/clips/{clip_id}/import` | Downloads a finished clip into the library (`mode` `light` by default: no transcript needed). Returns `{asset_id, duplicate, job_id, project}`; `409 ASSET_NOT_READY` while the clip is still being cut. Downloads only from public http(s) hosts |
| `POST /lumiclip/projects/{id}/clips/{clip_id}/export` | `{quality: 720p|1080p}` -> LumiClip's `{status, url}` |
| `DELETE /lumiclip/projects/{id}` | Removes it from the list (saved assets stay) |

Errors: `LUMICLIP_AUTH` (bad key), `QUOTA_EXCEEDED` (402/429 from the provider), `LUMICLIP_UNREACHABLE`, `LUMICLIP_FAILED`.
For local development and tests `scripts/fake_lumiclip.py` stands in for the provider (see `.env.example`).

## Teams and collaboration

Every user has a home workspace (their own, they are its `owner`) and can be a member of others. The browser picks the
workspace with the `X-Workspace-Id` header (or `?workspace=` on GETs such as the SSE stream); without it the home workspace is
used. A non-member gets `403 FORBIDDEN`. `GET /me` returns `role` (in the selected workspace) and `workspaces`
(`[{id, name, role, is_home}]`).

**Roles**, lowest first: `viewer` (read, comment, see who is here), `editor` (create and change content), `admin` (team,
profile, integrations, `POST /llm/test`), `owner` (like admin; owners can also change admins and owners; the last owner cannot
be demoted). **One policy**, enforced in `deps.get_ctx` for every endpoint (`services/access.py`): GET needs `viewer`, any other
write needs `editor`, `/workspace/*`, `PUT /profile`, `POST /onboarding`, `/youtube/*` writes and `POST /llm/test` need `admin`.
A **project override** (`project_members`) replaces the workspace role on one project (a viewer can be an editor of one video, an
editor read-only on one); it is looked up from the project the request is about (`/content/{item_id}/...`, `/clips/{id}`,
`/scripts/{id}`, `/renders/{id}`, `/beat-matches/{id}`, `/assets/{id}`, `/comments/{id}`) and never applies to admins or owners.
A denied request is `403 FORBIDDEN` with `details: {role, needs, workspace_role}`.

| Endpoint | Notes |
|---|---|
| `GET /workspace`, `PATCH /workspace {name}` | The current workspace (name, my role, member count); rename is admin |
| `GET /workspace/members` | `[{user_id, email, display_name, role, joined_at, is_me}]`, highest role first |
| `PATCH /workspace/members/{user_id} {role}` | Admin. Admins manage editors and viewers; only owners grant or change admin/owner. `409 LAST_OWNER` |
| `DELETE /workspace/members/{user_id}` | Admin removes someone; **anyone may remove themselves** (leave). `409 LAST_OWNER`; `409 HOME_WORKSPACE` for your own workspace |
| `POST /workspace/invites {email, role, content_item_id?, project_role?}` | Admin. Creates a link `{FRONTEND_URL}/invite/{token}` (no email is sent: copy it). One open invite per email (a new one replaces the old). `project_role` + `content_item_id` give the invitee an override on that one project. Valid 7 days |
| `GET /workspace/invites`, `DELETE /workspace/invites/{id}` | Admin: pending invites (with `token` and `link`), revoke |
| `GET /invites/{token}` | **Public** preview: workspace, inviter, role, project, `status` (`pending`/`accepted`/`expired`), `account_exists` |
| `POST /invites/{token}/accept` | Signed-in user joins (idempotent for the same person). The invite is for one email: `403 INVITE_EMAIL_MISMATCH`; `410 INVITE_USED` / `INVITE_EXPIRED` |
| `POST /auth/signup {…, invite_token}` | Lets someone create an account on a machine that already has one, for the invite's email, and joins them |
| `GET /content/{item_id}/members` | Everyone with their workspace role, project override and effective role |
| `PUT/DELETE /workspace/projects/{item_id}/members/{user_id}` | Admin: set `{role: editor|viewer}` or clear the override (not for admins/owners) |
| `GET/POST /content/{item_id}/comments` | `?clip_id=` filters. Body `{body, clip_id?, at_sec?, parent_id?}`. **Viewers can comment** |
| `PATCH/DELETE /comments/{id}` | The author edits the text; the author or an editor on the project resolves; the author or an admin deletes |
| `POST /content/{item_id}/presence {where}` | Heartbeat every ~10 s while a project is open; returns the others who are here now (in memory, 30 s) |

`GET /activity` rows carry `user_id` (who did it) for everything done through the API.

## Insights, Twin, Research, scheduling

| Endpoint | Notes |
|---|---|
| `GET /insights/production?days=30..365` | Counts from the workspace's own data: pipeline by stage, weekly created/published, stalled projects, footage hours, clip statuses and score spread, accept rate (needs 3 decisions), exports, 30-day activity, rule-based `nudges`. `provenance.source = "user"`; `performance.available = false` (no YouTube). |
| `GET /twin`, `GET /twin/messages`, `DELETE /twin/messages` | Style profile (+ revision, approvals since the last update), recent memories, chat history. |
| `POST /twin/chat` `{message, content_item_id?, clip_id?}` | `twin.chat` LLM call; the reply carries `provenance`; it may carry one suggested action. `LLM_NOT_CONFIGURED` without a key. |
| `POST /twin/messages/{id}/apply` `{index}` | Applies one suggestion: `create_idea` adds an idea; `tighten_pauses`, `set_caption_style`, `toggle_music` run as a new edit revision (`reload: true`); others return `open_editor`. |
| `POST /twin/style/update` | Re-learns the style from approved scripts (`NOTHING_TO_LEARN` 409 if none). Memories are written by the `script_approved` / `clip_accepted` events. |
| `POST /research` `{topic, content_item_id?}`, `GET /research?content_item_id=` | Web search (`SEARCH_PROVIDER` tavily or serper) then a `research.brief` LLM call. Sources are limited in code to URLs the search returned. Errors: `SEARCH_NOT_CONFIGURED` 503, `SEARCH_FAILED` 502, `NO_RESULTS` 404, `BAD_OUTPUT` 502. |
| `PATCH /content/{id}` `{scheduled_for: "YYYY-MM-DD" \| null}` | Plans a project on a day (nothing is posted). |
| Timeline overlay `style` | Optional on `text` and `lower_third` overlays: `{x, y, font: montserrat\|inter\|serif\|mono, size, color, bg, bg_opacity, align, width, shadow}`. The renderer draws it (`media/cards.py`). |

## Monetization and sponsors (`api/v1/monetization.py`, `api/v1/sponsors.py`)

Every deal value is typed by the creator. Generated text carries `provenance`; the rate estimate is `heuristic`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/monetization/deals?stage=` | the workspace's deals, newest change first; each has `overdue` |
| `POST` | `/monetization/deals` | `{brand, website?, contact_name?, contact_email?, stage?, fee?, currency?, deliverables?, due_date?, notes?, content_item_id?}`; `stage` is `prospect|pitched|negotiating|contracted|delivered|paid|lost` |
| `PATCH`/`DELETE` | `/monetization/deals/{id}` | stage changes are logged (`deal_stage_changed`) |
| `POST` | `/monetization/deals/{id}/pitch` | `{stats: {subscribers?, avg_views?, audience?, top_countries?, engagement?}, notes?}`, LLM task `sponsors.pitch`; stores `pitch {subject, email, talking_points, follow_up, provenance}` on the deal; `503 LLM_NOT_CONFIGURED` without a model |
| `GET` | `/monetization/summary` | `by_stage {count, value}`, `open_value`, `booked_value`, `paid_value`, `average_paid_fee`, `win_rate`, `overdue[]`, `upcoming[]` |
| `POST` | `/monetization/rate` | `{avg_views, cpm_low?, cpm_high?, placements?}` → `{low, mid, high, history {paid_deals, average_fee, highest_fee}}`; default CPM 20 to 40 (`default_cpm: true`) |
| `POST` | `/monetization/lookup` | `{website}` → `{title, description, emails [{email, found_on}], socials, pages}`; reads up to 7 pages of the brand's own site; private and local addresses are refused on every redirect (`422`); `DOWNLOAD_FAILED` (502) when no page could be read |
| `GET`/`POST` | `/content/{id}/sponsors` | list briefs (each with `slots`) / create `{brand, product, key_points[], cta, do_not_say[], duration_sec 10..60, deal_id?}` |
| `PATCH`/`DELETE` | `/sponsors/{brief_id}` | |
| `POST` | `/sponsors/{brief_id}/find-slots` | `{asset_id?}`; Plan 8.10 scoring over the main video's transcript, up to 3 slots, one batched `sponsors.integration` call for `integration_script`, `lower_third`, `transition_back`; without a model the slots are kept with empty reads and a warning; replaces earlier *suggested* slots only. `409 ASSET_NOT_READY` without a processed video |
| `PATCH` | `/sponsor-slots/{id}` | `{integration_script?, lower_third?, transition_back?, status?: suggested|rejected}`; an edit makes the provenance `user` |
| `POST` | `/sponsor-slots/{id}/accept` | `{clip_id}`: ripples a `VideoItem(kind=sponsor, placeholder)` in at the slot, adds a `lower_third` "Sponsored · brand" and estimated captions, all `suggested`, as a new edit revision. A slot inside a pause the cut removed snaps to the cut. `422 SLOT_OUTSIDE_CLIP` when the clip does not cover the moment; `409` when already placed |

## YouTube and publishing (`api/v1/youtube.py`, `api/v1/publish.py`, jobs `publish.upload`, `analytics.sync`)

Needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (your own OAuth client); without them `oauth/start` answers `503 YOUTUBE_NOT_CONFIGURED`
with `details.env`. The refresh token is stored Fernet-encrypted; access tokens stay in memory.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/youtube/status` | `{configured, connected, status, channel_id, channel_title, connected_at, last_sync_at, redirect_uri}` |
| `POST` | `/youtube/oauth/start` | admin; `{url}` to open (offline access, consent prompt, signed `state`) |
| `GET` | `/youtube/oauth/callback` | **public**, called by Google; always `303` to `FRONTEND_URL/settings?youtube=connected|denied|error&message=` |
| `DELETE` | `/youtube/connection` | admin; revokes at Google (best effort) and forgets the channel |
| `POST` | `/youtube/sync` | `202 {job_id}`: views, likes, comments of videos published from CreatorAi into `yt_metrics_daily` (also nightly) |
| `GET` | `/content/{id}/publish/defaults` | title (first script title), description, tags, finished renders with `publishable` and `sponsor_brands`, `disclosure_template`, `connection` |
| `GET` | `/content/{id}/publish` | publish rows: `status` `queued|uploading|scheduled|published|failed`, `url`, `studio_url`, `error` |
| `POST` | `/content/{id}/publish` | `{render_id, title<=100, description, tags[], visibility, scheduled_at?}` → `202` row + `job_id`. Download-only presets (Reels, TikTok) are `422`; no usable connection is `409 NO_YOUTUBE_CONNECTION` (an expired grant marks the connection `revoked`). A schedule uploads as private with `publishAt`. On success the project moves to `published` (or gets `scheduled_for`) |
| `POST` | `/publish/{id}/retry` | only a failed row |

`GET /insights/production` `performance` lists those videos with their latest counters and totals; seeded demo analytics are never mixed in.
