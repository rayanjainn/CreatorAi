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
