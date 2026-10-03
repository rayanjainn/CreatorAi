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
