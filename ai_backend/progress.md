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
