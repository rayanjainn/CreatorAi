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

## P5.T1 timeline schema + semantic validator (2026-10-04)
- Done: schemas.js holds THE Timeline JSON v1 Zod schema (TimelineDoc, strict objects, discriminated video|caption tracks, int ms >= 0, even output size, volume 0..2) and the pure validateTimeline(doc, assetsById, { projectId }) -> [{ code, path, message }] (duplicate track/clip ids doc-wide, sourceOut > sourceIn, caption endMs > startMs, per-track overlap, asset found / same project / known duration / source range <= duration); service.js re-exports them plus checkTimelineDoc/assertTimelineDoc (assets via media getAssetsByIds); tests/phase5/validator.test.js (32 invalid docs) + check-doc.test.js.
- Learned: shape errors are returned alone (semantics only run on a well-shaped doc); through the service a foreign-project asset is asset_not_found (getAssetsByIds hides it), the pure validator reports asset_wrong_project when given projectId. An asset with null duration is rejected (asset_duration_unknown): the range can't be checked.
- Next: P5.T2 timelines + timeline_versions tables, append-only trigger, createTimeline/createVersion/getHead with optimistic concurrency.
- Gate: `npx eslint . && npx vitest run tests/phase0 tests/phase1 tests/phase5` passed (256/256); `gate -- 5` needs tests/phase2-4 from other tracks.
