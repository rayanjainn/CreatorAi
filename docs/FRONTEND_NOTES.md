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
