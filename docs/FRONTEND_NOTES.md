# Frontend notes (gaps and decisions for the final TODO list)

Backend gaps and oddities hit while wiring the frontend. Each is worked around in the UI.

1. **No provenance on content cards.** `CardOut` has no `provenance`; seeded rows are recognised by the
   `[DEMO]` title prefix (`lib/format.ts: isDemoTitle`). Proper fix: expose `is_seed`/`provenance` on content items.
2. **Duplicate OpenAPI operation ids** (`_put_transcript...` in `assets.py`, `serve_media` GET/HEAD in `media.py`)
   make FastAPI warn on `make gen-api`. Harmless for the generated types, but should get explicit `operation_id`s.
3. **Open-object responses**: `/health`, `/llm/status` and `/llm/test` are `additionalProperties: true`, so their types
   are hand-written in `src/lib/api/types.ts`. Adding response models would let `gen:api` type them.
4. **`CardOut.stage` is `string`**, not the `Stage` enum; the frontend narrows it by cast.
5. **No endpoint to rename the workspace/channel** (only `POST /onboarding` accepts `channel_name`), so Settings can not
   edit it. `ProfileUpdate` also has no `channel_name`.
6. **`make reset-password` does not exist** (UI_SPEC mentions it). The login page's "Forgot password" hint points at
   `make reset` (which wipes data) instead. A password-reset CLI would be kinder.
7. **No "wipe my data" endpoint**; the Settings danger zone points at `make reset`.
8. **`signup_open` added to `GET /health`** (small backend change + test) so `/login` can hide "create account" and `/signup`
   can show the closed state up front. `SIGNUP_CLOSED` from the API is still handled.
9. **Root `.env` ships `LLM_ALLOW_MOCK=true`** in some checkouts (differs from `.env.example`, which says `false`); that
   puts the app in mock mode and shows the loud mock banner. Check `.env` if you expect "unconfigured".
10. **Embedder download blocked offline** shows as `hashing` heuristic (`embedder.real=false`); Settings labels it as such.
11. `public/InvideoEditorPromo.mp4` and `public/1InvideoEditorPromo.mp4` look like a third-party promo clip. The login page still
    plays the first one (with a fallback panel if it cannot load); decide whether to keep or replace it. The second is unused.
12. Next.js `next dev` writes `AGENTS.md`/`CLAUDE.md` into `frontend/`; disabled with `agentRules: false` and git-ignored.
13. **Empty `OLLAMA_BASE_URL=` counts as a configured Ollama provider** (data_mode becomes `real` with no key). Leave the variable
    unset (default `https://ollama.com`, which needs `OLLAMA_API_KEY`) to be "unconfigured".
14. **Seeded hero plan was not editable**: `HERO_PLAN` had 5 structure sections but 7 shot rows, so `PATCH .../director/plan`
    answered `422 (exactly one entry per scene)` for every edit. `scripts/demo_data.py` now seeds 5 shots.
15. **`GET /clips` and `GET /renders` added** (plain lists, filters, `limit` 1-200) so Smart Clips and Repurpose do not do N+1 per project.
16. **`GET /content/{id}` returns the full card** (`progress`, `running_jobs`, `thumbnail_url`) but the OpenAPI response model is
    `ContentItemOut`; the frontend casts to `Card`. Declaring `response_model=CardOut` would fix the types.
17. **Open-object payloads** (`PlanOut.plan`, `ReviewOut.issues/scores`, `ScriptOut.scenes/meta`, `AssetDetail.analysis`) are `object` in
    OpenAPI, so their shapes are hand-typed in `lib/api/types.ts` and can drift. Typed sub-models would let `gen:api` cover them.
18. **Hooks are not stamped with provenance per option** (`HooksOut.hooks[]` has none; only the response does). The picker falls back to the
    response provenance for fresh hooks; persisted ones carry it in `script.hook_options[].provenance`.
19. **Expected 404/409 reads are avoided by gating** (card flags, version lists) because browsers log every failed fetch; a `204`/`null`
    style "none yet" response would remove the need.
20. **Review `missing_scenes` items use `text`** (not `title`/`beats`) while match `missing_scenes` use `title`/`beats`/`suggestion`; the
    UI handles both.
21. **No transcript endpoint for audio-less video**: `GET .../transcript` 404s until transcription ran, so the transcript tab falls back to
    `segments` from the asset detail.
22. **Playback in headless Chromium** is impossible for the H.264 proxy (see frontend/README). Seeking is verified through the player's
    `data-seek-target`; real playback needs Chrome/Edge/Safari.
23. **Job SSE only starts after the 4 s poll finds the job**, so an upload's pipeline checklist can lag one poll behind the real stage; the
    asset query (`stages_done`, polled every 2.5 s while processing) keeps it correct.
