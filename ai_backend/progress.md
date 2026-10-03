# progress.md

Append one 5-line entry per task (newest last):

    ## P<phase>.T<task> <title> (YYYY-MM-DD)
    - Done:
    - Learned:
    - Next:
    - Gate: `npm run gate -- N` <passed | failed: reason>

## P0 Skeleton and test harness, T1-T8 (2026-10-04)
- Done: Express 5 app with all routers mounted as 501 stubs, Zod env, pg pool + templated SQL migrations, pg-boss queue + noop job + drainQueue(), six adapters (fake + real stubs), fixture generator, preflight, gate script, AGENTS.md.
- Learned: pgvector is not installed on the local PG17, so VECTOR_BACKEND=array (float8[] + cosine_distance()). FFmpeg 9.0.2 installed via winget; FFMPEG_PATH/FFPROBE_PATH set in .env. pg-boss is v12 (fetch/complete/findJobs). Search provider is serper (SERPER_API), not Tavily. Fixture cuts detect at exactly 7 s and 14 s with gt(scene,0.35).
- Next: P1 auth, projects, RBAC. Still HITL: confirm Gemini free-tier limits in AI Studio and that gemini-embedding-2 is callable on the free key.
- Gate: `npm run gate -- 0` passed (lint + 73/73 tests).

## P1.T1 auth module + requireAuth (2026-10-04)
- Done: 010_users.sql (uuid PK, lowercased unique email, password_hash, name); auth Router (register 201 / login 200 / me) with Zod bodies; service.js exports requireAuth, register, login, getUserById, findUserByEmail, signToken (bcryptjs 10 rounds, jsonwebtoken HS256 7d, sub = user id); tests/helpers/auth.js (createUser, authHeader); tests/phase1/auth.test.js (21 tests).
- Learned: login compares against a dummy hash when the email is unknown so the 401 is the same in timing and message; jwt.verify is pinned to HS256 so alg=none is rejected; getUserById returns null for non-uuid ids instead of a PG cast error.
- Next: P1.T2 projects CRUD. The phase0 "501 stubs" table listed the four phase-1 routes; with human approval those rows were removed (each phase drops its own rows when it replaces its stubs).
- Gate: `npm run gate -- 1` passed (lint + 90/90 tests).

## P1.T2 projects CRUD (2026-10-04)
- Done: 011_projects.sql (projects, project_members with role CHECK + PK(project_id,user_id), index on user_id); real projects Router with POST/GET/GET :id/PATCH/DELETE, requireAuth per route, members/activity kept as 501 via a merged stubRouter; service.js exports ROLES, hasRole, isProjectId, getMembership, assertRole, createProject (project + owner in one transaction), listProjects, getProject, updateProject (editor+), deleteProject (owner); 39 tests in tests/phase1/projects.test.js.
- Learned: the projects router runs before the /projects/:projectId module routers, so no path-less middleware on it; a malformed :projectId is 404 (projectIdParam), non-member 404, member below role 403. Body validation runs before the membership check, so a bad body is 400 for anyone (independent of whether the project exists).
- Next: P1.T3 requireRole(minRole) middleware built on getMembership/hasRole (assertRole already throws the right 404/403), members endpoints replacing the 501 stubs, last-owner protection, role matrix test.
- Gate: `npm run gate -- 1` passed (lint + 129/129 tests).

## P1.T3 requireRole, members, role matrix (2026-10-04)
- Done: service.js exports requireRole(minRole) (runs requireAuth itself if req.user is unset; 401/404/403; sets req.project = { id, role } and req.role), listMembers, addMember, changeMemberRole, removeMember; T2 routes now authorize only via requireRole (projectIdParam removed; updateProject(project, input), deleteProject(projectId) no longer re-check); members GET/POST/PATCH/DELETE (self-leave allowed); last-owner rule in a transaction that locks owner rows FOR UPDATE; tests/phase1/members.test.js (39) and rbac-matrix.test.js (exported MATRIX + ACTORS, 46 cells). No migration needed.
- Learned: requireRole runs before body validation, so non-members get 404 whatever the body (T2 used to validate first). Under READ COMMITTED, FOR UPDATE re-checks role = 'owner' after the blocking tx commits, so concurrent mutual demotion leaves exactly one owner (409 or 403 for the loser).
- Next: Phase 1 done. Launch Track A (P2 media), B (P4 agents), C (P5 timeline) in parallel; every project-scoped route uses requireRole from projects/service.js and adds rows to the role MATRIX. (The three members rows were dropped from projects.test.js's stub table, as the phase-1 stub rows were from phase0.)
- Gate: `npm run gate -- 1` passed (lint + 211/211 tests).

## P2.T1 storage adapter, real + fake (2026-10-04)
- Done: real Cloudinary adapter over fetch + node:crypto (signUpload, getResource via Admin API basic auth, signed multipart uploadFile, signed destroy, proxyUrl/audioUrl, verifyNotification); fake gains verifyNotification/signNotification with FAKE_API_SECRET and destroy(publicId, { resourceType }); shared signParams / verifyNotificationWith in contract.js; tests/phase2/storage.test.js (fetch stubbed, no network).
- Learned: notification check is sha1(body + timestamp + secret) with a 2 h freshness window, compared in constant time. With orchestrator approval the 'storage.signUpload' row (and its now-unused import) was removed from phase0 adapters.test.js "real adapters are stubs".
- Next: P2.T2 media routes + repo.
- Gate: `npm run gate -- 2` passed (lint + 219/219 tests).

## P2.T2 media routes + repo (2026-10-04)
- Done: real media Router: POST /media/sign (editor+, folder proj/<id>/originals fixed by the server, strict empty body), GET /media (viewer+, ?kind= default original, ?parentAssetId=), GET /media/:assetId (viewer+), DELETE /media/:assetId (editor+, destroys the asset and every derived descendant in storage, then deletes the rows); POST /media, /media/:assetId/index and /reprocess left as 501 stubs on the real router; service adds signUpload, listAssets, getAsset, deleteAsset, originalsFolder, derivedFolder (getAssetsByIds unchanged); fake storage failNextDestroy(); tests/phase2/media.test.js + helpers.js.
- Learned: delete destroys in storage before touching rows, so a storage outage is a 500 with the rows intact and the delete retryable; keyframes are destroyed as resource_type image, everything else as video. Phase0 http.test.js row 'POST /projects/p1/media/sign' dropped (stub replaced).
- Next: P2.T3 register flow + media.process job + Cloudinary webhook.
- Gate: `npm run gate -- 2` passed (lint + 234/234 tests).

## P2.T3 register flow, media.process, Cloudinary webhook (2026-10-04)
- Done: media.process payload { assetId, projectId } (strict uuids) in jobs.js, no handler (P3); service registerUpload (folder check -> 400, existing -> same asset with no job, storage.getResource -> 400 if unknown, insert ON CONFLICT DO NOTHING + enqueue in ONE transaction via pg-boss send({ db })), projectOfOriginal, verifyNotification, handleNotification; POST /media (editor+, 201 new / 200 already registered); POST /webhooks/cloudinary (X-Cld-Signature/X-Cld-Timestamp -> 401, loose Zod notification, non-project uploads acked with registered:false); tests/phase2/register.test.js and rbac-matrix.test.js (own MATRIX, 8 routes x 5 actors).
- Learned: the webhook signs the raw body but app.js (frozen) runs express.json first, so the body is re-serialized with JSON.stringify; fine for Cloudinary's compact JSON, but a raw-body capture (express.json verify) would be more robust if app.js is ever reopened. Importing ACTORS from the phase1 test file re-runs its suite, so ACTORS is copied. Phase0 row 'POST /webhooks/cloudinary' dropped.
- Next: Phase 3 registers the media.process handler and replaces the /media/:assetId/index and /reprocess stubs (update their 501 rows in tests/phase2/rbac-matrix.test.js and phase0 http.test.js). Live smoke: sign -> upload fixture -> register against real Cloudinary.
- Gate: `npm run gate -- 2` passed (lint + 288/288 tests).

## P5.T1 timeline schema + semantic validator (2026-10-04)
- Done: schemas.js holds THE Timeline JSON v1 Zod schema (TimelineDoc, strict objects, discriminated video|caption tracks, int ms >= 0, even output size, volume 0..2) and the pure validateTimeline(doc, assetsById, { projectId }) -> [{ code, path, message }] (duplicate track/clip ids doc-wide, sourceOut > sourceIn, caption endMs > startMs, per-track overlap, asset found / same project / known duration / source range <= duration); service.js re-exports them plus checkTimelineDoc/assertTimelineDoc (assets via media getAssetsByIds); tests/phase5/validator.test.js (32 invalid docs) + check-doc.test.js.
- Learned: shape errors are returned alone (semantics only run on a well-shaped doc); through the service a foreign-project asset is asset_not_found (getAssetsByIds hides it), the pure validator reports asset_wrong_project when given projectId. An asset with null duration is rejected (asset_duration_unknown): the range can't be checked.
- Next: P5.T2 timelines + timeline_versions tables, append-only trigger, createTimeline/createVersion/getHead with optimistic concurrency.
- Gate: `npx eslint . && npx vitest run tests/phase0 tests/phase1 tests/phase5` passed (256/256); `gate -- 5` needs tests/phase2-4 from other tracks.

## P5.T2 timelines + append-only versions + optimistic concurrency (2026-10-04)
- Done: 050_timelines.sql (timelines with head_version; timeline_versions PK (timeline_id, version), CHECK parent = version - 1, human needs author_id, no FKs on author_id/agent_run_id; BEFORE UPDATE OR DELETE trigger raises "append-only" unless the parent timeline is already gone = the ON DELETE CASCADE path); repo.js; service.js createTimeline (always writes v1, empty doc when none given), createVersion (409 { headVersion } on stale base, SELECT ... FOR UPDATE + PK backstop mapped to 409), getHead, listTimelines, listVersions; tests/phase5/versions.test.js (15).
- Learned: the RI cascade deletes child rows after the parent row is gone, so the trigger can tell a cascade from a direct DELETE by checking the parent; TRUNCATE (resetDb) skips row triggers. Version author_id has no FK because ON DELETE SET NULL would be an UPDATE the trigger refuses; versions keep the author id as an audit record.
- Next: P5.T3 routes (replace the stub router), revert, diff, rbac matrix; drop the two phase-5 rows from the phase0 stub table.
- Gate: `npx eslint . && npx vitest run tests/phase0 tests/phase1 tests/phase5` passed (271/271).

## P5.T3 timeline routes, revert, diff (2026-10-04)
- Done: real Router({ mergeParams: true }) on exactly the 8 stub paths, requireRole per route (viewer reads, editor+ writes) before validate(); POST /timelines (no doc -> v1 = emptyTimelineDoc()), list, head, versions, version, POST versions (human author = req.user), POST revert { toVersion, baseVersion?, summary? } (new version copying the target doc, re-validated; optional baseVersion -> 409 if stale, omitted -> applies on the locked head), GET diff?from=&to= (validate({ query: DiffQuery }); added/removed/changed by clip id, outputChanged, tracksAdded/Removed); service adds getVersion, revertTimeline, diffVersions, pure diffTimelines; tests/phase5/routes.test.js (27) + rbac-matrix.test.js (8 routes x 5 actors, exported MATRIX/ACTORS). Removed the two phase-5 rows (POST .../versions, GET .../diff) from the phase0 501 stub table.
- Learned: service validation paths are relative to the service input (['doc', ...]); the routes prefix 'body' so HTTP shape and semantic issues share one path style. Do not import ACTORS from the phase1 test file: importing a test file registers its suites in the importer.
- Next: Phase 5 done. P6 editing agent calls createTimeline/createVersion (authorType 'ai', agentRunId) and handles 409 { headVersion }; P7 render pins getVersion(projectId, timelineId, v). P8 should merge tests/phase5 MATRIX rows.
- Gate: `npx eslint . && npx vitest run tests/phase0 tests/phase1 tests/phase5` passed (337/337). `npm run gate -- 5` needs tests/phase2-4 from the other tracks.

## P4.T1 agent runner, agent_runs, real LLM adapter (2026-10-04)
- Done: 040_agent_runs.sql; agents/run.js runAgent({ name, input, outputSchema, tools, system?, instructions?, refine?, persist?, runId? }) (Zod-validates, retries once quoting the error, persists the artifact and marks the run succeeded in one transaction, never throws for agent failures), configureRunner/resetRunner; agents/service.js getRun, startRun (queued row + agent.run job), executeRun; GET /agents/runs/:runId (viewer+); agent.run payload + workers/agents.js; adapters/llm/real.js createLlmClient (Gemini JSON mode, Groq json_object fallback, shared per-provider rate limiter, 429 exponential backoff then fallback, AbortController timeouts, injectable sleep/limiter); the fake LLM gained delay() and honours timeoutMs.
- Learned: the worktree started from main (no ai_backend/), so it was reset to feat/ai-backend-phase0. Agent failures are recorded on the run and the job completes, so pg-boss never retries a run whose outcome is already decided. Approved phase0 edits: removed the agents/runs 501 row (http.test.js) and the llm.completeJson "not implemented" row and its now-unused import (adapters.test.js).
- Next: P4.T2 Director (content_plans, POST /agents/director/plan, GET /plans).
- Gate: gate 4 needs tests/phase2 and phase3 (other tracks); `eslint . && vitest run tests/phase0 tests/phase1 tests/phase4` passed (231/231).

## P4.T2 Director Agent (2026-10-04)
- Done: 041_content_plans.sql; director schemas (DirectorInput {niche, audience, goals[], cadence, horizonDays, startDate?}, PlanDoc {ideas[] {title, angle, format, hook}, schedule[] {date, ideaIdx}} with ideaIdx bounds check, Plan); service exports directorAgent, requestPlan, listPlans, getPlan; routes POST /agents/director/plan (editor+, 202 { runId, status }), GET /plans, /plans/:planId (viewer+); registered in workers/agents.js; tests/phase4/director.test.js (8) and tests/phase4/rbac-matrix.test.js (director + runs rows).
- Learned: persist() now also receives projectId and userId from the run row. The timeout test waits for the fake model to be called (not a fixed sleep) before probing /health, so it is not timing-flaky. The registry is built per call so the agents <-> queue import cycle never reads a binding during module evaluation.
- Next: P4.T3 Research (research_briefs, real search adapter, citations restricted to search results).
- Gate: `eslint . && vitest run tests/phase0 tests/phase1 tests/phase4` passed (259/259); director plan 501 row removed from http.test.js.

## P4.T3 Research Agent and search adapter (2026-10-04)
- Done: 042_research_briefs.sql (plan_id FK nullable + idea_index); research schemas (ResearchBody = { topic } | { planId, ideaIndex }, BriefDoc {summary, keyPoints[], trends[], sources[] {title, url}}, Brief); service exports researchAgent (web_search tool, refine drops every URL the search did not return and rejects a brief left with none), requestResearch (plan idea snapshot into the run input; foreign plan 404, idea out of range 400), listBriefs, getBrief, restrictSources; routes POST /agents/research (editor+), GET /briefs, /briefs/:briefId (viewer+); adapters/search/real.js createSearchClient (serper via SERPER_API, tavily via TAVILY_API_KEY, AbortController timeout, invalid URLs dropped); tests research.test.js (8), search-adapter.test.js (4), matrix rows.
- Learned: the web_search tool result (query + results) is stored on the run as toolResults, so citations can be audited later. research/schemas imports director/schemas directly (pure Zod), because importing director/service there would read Idea during the agents <-> queue import cycle.
- Next: P4.T4 Script (scripts table, POST /agents/script from a brief, PATCH human edits), chain test.
- Gate: `eslint . && vitest run tests/phase0 tests/phase1 tests/phase4` passed (284/284); research 501 row (http.test.js) and the approved search.search "not implemented" row and its unused import (adapters.test.js) removed.

## P4.T4 Script Agent, human edits, chain test (2026-10-04)
- Done: 043_scripts.sql (brief_id NOT NULL FK, edited_by/edited_at); script schemas (ScriptBody {briefId, targetSeconds?, tone?, notes?}, ScriptDoc {hooks[], script[] {section, text, estSeconds}, cta, shots[] / broll[] {section?, description}}, ScriptPatch, Script); service exports scriptAgent, requestScript (brief + idea snapshot into the run input; foreign brief 404), listScripts, getScript, updateScript (merge patch, re-validate as ScriptDoc under FOR UPDATE); routes POST /agents/script (editor+), GET /scripts, /scripts/:scriptId (viewer+), PATCH /scripts/:scriptId (editor+); tests/phase4/script.test.js (7, incl. the plan -> research(ideas[0]) -> script chain with FK checks) and the full Phase 4 matrix (11 routes x 5 actors).
- Learned: the chain test checks both the joined ids and pg_constraint, so the links are real FKs. Gate 4 needs tests/phase2 and tests/phase3 to exist; in this worktree they are empty, uncommitted placeholder dirs.
- Next: merge Track B with Tracks A and C, then run the real gate 4 with their phase2/phase3 tests. Live smoke (HITL): run plan -> research -> script once on a real niche with ADAPTERS=real and read the script.
- Gate: `npm run gate -- 4` passed (lint + 310/310; phase2/phase3 empty placeholders here). Last phase-4 501 row (PATCH scripts) removed from http.test.js.

## P2 + P4 + P5 parallel tracks merged (2026-10-04)
- Done: three worktree agents (P2 media, P4 agents, P5 timeline) merged into feat/ai-backend-phase0; conflicts only in progress.md, jobs.js (kept both payloads) and the phase0 stub tables (each track had removed its own rows).
- Learned: parallel tracks need separate test databases (aivideo_p2_test / _p4_test / _p5_test) since resetDb truncates; the assets table + media getAssetsByIds were committed first as the P2/P5 contract. Webhook signature is checked against re-serialized JSON (app.js is frozen; raw-body capture needs approval).
- Next: P3 processing workers + index (Track A). HITL live smokes: Cloudinary sign -> upload -> register; one real plan -> research -> script.
- Gate: `npm run gate -- 5` needs tests/phase3; `eslint . --max-warnings=0` + `vitest run tests/phase0,1,2,4,5` passed twice (513/513).

## P2 live smoke: Cloudinary sign -> upload -> register (2026-10-04)
- Done: live upload of the fixture through sign -> Cloudinary -> register works (201, status uploaded); director plan run succeeded on real Gemini. Fixed getResource to request ?media_metadata=true for videos.
- Learned: the Cloudinary API key needs the Master Admin role (a restricted role gives 403 "missing permissions (create)" on upload); the Admin API omits video `duration` unless media_metadata=true, which left durationMs null. Signed `folder` alone puts the folder into public_id on this account.
- Next: P3 processing workers + index.
- Gate: eslint + vitest phase0,1,2,4,5 passed (513/513); storage.test.js URL assertion updated with human approval.

## P3.T1 orchestration, processing_jobs, transcription step, reprocess (2026-10-04)
- Done: 032_processing_jobs.sql (PK (asset_id, step), status queued|running|done|failed, error, attempts, run_id, job_id, output; HNSW cosine indexes in an `@if pgvector` block); workers/process.js (PIPELINE registry, media.process handler, one pg-boss job per step with { assetId, projectId, runId }, row-locked advance(), own attempt counter: maxAttempts 3, retry jobs with startAfter (0 in tests), NonRetryableError fails at once, superseded-run jobs skipped; setStepRunner/configurePipeline/resetPipeline for tests); steps/transcription.js (audioUrl -> adapter -> normalizeTranscript -> delete-then-insert); ChunkedTranscribeOutput + normalizeTranscript (re-base per chunk, drop/trim overlaps, clip to duration); real Groq Whisper adapter; media reprocessAsset + POST /media/:assetId/reprocess (editor+, 202); tests/phase3 pipeline + transcription.
- Learned: pg-boss fetch()/work() as used here do not expose retryCount, so the orchestrator counts attempts itself and sends step jobs with retryLimit 0. Locking all of an asset's step rows in step order before scheduling avoids double scheduling and deadlocks when transcription and scenes finish together.
- Next: P3.T4 embeddings step + search endpoint.
- Gate: `eslint . --max-warnings=0 && vitest run tests/phase3 tests/phase2` green except tests/phase2/media.test.js "Phase 3 routes stay 501" (2 rows; not on the approved list, needs a human decision) and the Track-B-dependent real-steps test.

## P3.T4 embeddings step + search endpoint (2026-10-04)
- Done: steps/embeddings.js (segment text; scene keyframe image when supportsImages(), caption text otherwise or on code 'unsupported'; dimension-checked; written via search service storeEmbeddings); search/repo.js setEmbeddings (jsonb_to_recordset, one UPDATE per table) + searchProject (UNION of transcript/scene hits, project-scoped JOIN on assets, kinds/assetIds filters, cosine order); POST /projects/:projectId/search (viewer+) -> { hits: [{ kind, assetId, startMs, endMs, text | caption + keyframeAssetId, score }] }; real Gemini batchEmbedContents adapter (outputDimensionality = EMBED_DIM, L2-normalised, inline images, 429 backoff); fake gained supportsImages/setImageSupport/failNext/calls; tests/phase3/search.test.js. Removed the approved phase0 rows (search 501 stub, embeddings/transcription "not implemented" + imports).
- Learned: unnest() flattens float8[][] so a 2D array param cannot write one vector per row; a jsonb recordset converted per backend (::text::vector or ARRAY(... WITH ORDINALITY)) keeps it one statement and inside search/repo.js.
- Next: P3.T5 index endpoint tests + Track A RBAC matrix.
- Gate: eslint + vitest tests/phase3 tests/phase2 green apart from the two items noted under P3.T1.

## P3.T5 index endpoint, Track A RBAC matrix, real-steps pipeline test (2026-10-04)
- Done: GET /media/:assetId/index (viewer+) -> { asset, transcript, scenes, faces [{ sceneIdx, atMs, bbox }], analysis | null, steps { [step]: { status, error, attempts, updatedAt } } } via media getIndexView (built on getAssetIndex); tests/phase3/index-endpoint.test.js (content, failed-step errors, cross-project/unknown/malformed -> 404, reprocess 202/400/404), rbac-matrix-a.test.js (index, reprocess, search x 5 actors), pipeline-real-steps.test.js (no injected steps; needs Track B). phase2 rbac-matrix index/reprocess rows moved from 501 to 200/202 (approved).
- Learned: the index response never exposes vectors; step status is keyed by step name so clients can poll one field.
- Next: merge feat/ai-backend-phase0 (Track B) and run the real-steps test against the real step modules.
- Gate: see the merge entry below.

## P3.T2 scenes + keyframes, real FFmpeg adapter (2026-10-04)
- Done: adapters/ffmpeg/real.js over child_process.spawn: probe(input), run(args, { onProgress }) (adds -hide_banner -nostdin -y -nostats -progress pipe:1; onProgress({ outTimeMs, done }); non-zero exit -> Error { code, stderrTail }), detectScenes(input, { threshold }) (select='gt(scene,T)',showinfo, pts_time from stderr), extractFrame(input, atMs, outPath); fake gains detectScenes (7 s/14 s, setCuts()), extractFrame (placeholder JPEG, frames[]). workers/steps/scenes.js: proxy URL -> cuts -> contiguous spans [0,c1)..[cN,duration) (duration from the row, else probe) -> mid-point keyframes uploaded to derived/keyframes + createDerivedAsset(kind keyframe) -> scenes rows replaced in one transaction; unreused keyframes of earlier runs deleted via media deleteAsset; temp dir removed in finally. tests/phase3/scenes-ffmpeg.test.js, scenes-step.test.js, helpers-b.js.
- Learned: ADAPTERS=fake in tests, so the step takes configureScenes({ ffmpeg: realFfmpeg, resolveInput: () => FIXTURE.path, tmpRoot }) / resetScenes(); with the default config the fake ffmpeg returns the fixture's cuts, so a pipeline test needs no override. Real Cloudinary assigns a new public_id per upload, hence the stale-keyframe cleanup. Approved: removed the ffmpeg.probe "not implemented" row and its import from phase0 adapters.test.js.
- Next: P3.T3 faces (storage.detectFaces) and analysis (vision captions + summary). Track A wires the steps into the pipeline.
- Gate: per the human's rule for this track, `npx eslint . --max-warnings=0 && npx vitest run tests/phase3` passed (14/14); earlier gates not run.

## P3.T3 faces + analysis (2026-10-04)
- Done: storage detectFaces(publicId) -> [{ x, y, width, height }] (real: signed POST image/explicit with faces=true, maps faces [[x,y,w,h]]; fake: deterministic box per id, setFaces(id, boxes | Error), cleared by reset(); FaceBox/FaceBoxes in contract.js). steps/faces.js: per scene keyframe -> faces rows (scene_id, at_ms = scene mid-point, bbox), all detections first, then delete+insert in one transaction. steps/analysis.js: captions CAPTION_BATCH=4 keyframe URLs per VISION_MODEL call ({ captions: [n strings] }), then one LLM_MODEL summary over captions + transcript (<= 6000 chars) -> asset_analysis upsert; Zod-validated, one retry quoting the problem, invalid twice throws; nothing written until all calls succeed. tests faces-step.test.js, analysis-step.test.js; helpers-b.js analysisReply.
- Learned: the fake LLM's default reply ({ ok: true }) fails the analysis schema, so any pipeline test must queue replies: queueResponse(analysisReply, analysisReply) from tests/phase3/helpers-b.js (adapts to caption or summary calls). Non-JSON-shape errors (429, timeouts) propagate unchanged so the orchestrator retries.
- Next: Track A wires scenes -> (faces, analysis) into media.process; live smoke checks real Cloudinary face coordinates and Gemini captions on keyframes.
- Gate: `npx eslint . --max-warnings=0 && npx vitest run tests/phase3` passed (30/30); earlier gates not run (human's rule).

## P3 Track A merged with Track B (2026-10-04)
- Done: merged feat/ai-backend-phase0 (Track B) into Track A. Conflicts: progress.md (kept both) and phase0 adapters.test.js (each track had removed its own approved "not implemented" rows, so the now-empty describe block and the three real-adapter imports were dropped). pipeline-real-steps.test.js now queues analysisReply twice on the fake LLM and resets scenes config.
- Learned: with the real steps, the fake ffmpeg cuts at 7 s / 14 s give 3 scenes, i.e. one caption batch plus one summary call; the pipeline reaches indexed with all five steps done and every segment/scene embedded.
- Next: human decision on tests/phase2/media.test.js "Phase 3 routes stay 501 on the real router" (2 rows still expect 501 for index/reprocess; not on the approved list). Then the orchestrator runs gate 3. Live smoke: real 2-3 min clip, three searches.
- Gate: eslint clean; vitest tests/phase3 tests/phase2 159/161, the 2 failures are only that phase2 501 block.

## P3 Tracks A + B merged (2026-10-04)
- Done: Track B (ffmpeg adapter, scenes+keyframes, faces, analysis steps) and Track A (process.js orchestrator over processing_jobs, transcription, embeddings, search, index/reprocess endpoints) merged into feat/ai-backend-phase0. Dropped the phase2 media.test.js "Phase 3 routes stay 501" block (same human-approved stub-row pattern; real statuses are in both RBAC matrices).
- Learned: contract-first (030/031 tables, media createDerivedAsset/setAssetStatus/getAssetIndex, workers/steps/*.js stubs) let the two tracks merge with no code conflicts. The fake LLM default reply fails the analysis schema, so pipeline tests must queue analysisReply.
- Next: live smoke (real 2-3 min clip: transcript, scenes, three searches; Cloudinary detectFaces is untested live), then P6 + P7 in parallel.
- Gate: per human rule (current phase only, plus at-risk earlier phases): eslint clean, vitest tests/phase0 + phase2 + phase3 passed (212/212).
