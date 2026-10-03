# Demo guide (5 to 7 minutes)

A walkthrough of the seeded **hero project** that follows the real UI. Everything you click exists; things that
are not built are called out so you can say so before anyone asks.

## Before you start (2 minutes, do it earlier)

```bash
make setup && make seed      # once
make dev                     # leave running
```

- Open **http://localhost:3000** in **Chrome, Edge or Safari** (the footage is H.264; some Chromium builds cannot play it).
- Sign in: `demo@creatorai.local` / `demo1234`.
- For the full AI path add one key to `.env` (Gemini is the quickest: https://aistudio.google.com/apikey), restart
  `make dev`, open **Settings, "Test my keys"** and make sure it says *works*. Do this before the demo, not during.
- Optional: `make models` (once, online) so search and matching use the real embedder instead of the Heuristic one.
- Reset between runs: `make seed ARGS="--reset"` (removes only demo rows and reseeds).

**What the hero footage is:** about 50 s of solid-colour scenes labelled "DEMO FOOTAGE", with tone bursts instead of speech
and a transcript sidecar. It exists so the whole pipeline is demoable offline. Say so up front; do not pretend it is a
real shoot. Use your own footage if you want a prettier demo (upload on the Footage tab, see "With real footage").

## What the badges mean (say this once)

| Badge | Meaning |
|---|---|
| **Demo** | seeded data from `make seed`; hand-written text, synthetic numbers |
| **Heuristic** | computed by rules, not a model (review scores, clip copy fallback, the fallback embedder) |
| **AI** | produced by a real model; hover shows provider and model |
| **You** | typed or edited by you |
| **Mock** | fake output from the dev-only mock provider; a red banner shows on every page. You should never see this in a demo |

The topbar chip and the banner under it show the data mode: no key = a yellow "Add a free AI key" card (nothing is faked).

## The script

### 1. Sign in and the dashboard (30 s)
- Open `/`, click sign in (or go to `/login`), use the demo credentials. You land on **Dashboard**.
- Say: "Local-first: one process for the API, one for the web app, SQLite and files on this laptop. No cloud account."
- Point at the **setup card** if no key is configured: "With no key the AI tools stay off and say so; nothing is faked."

### 2. Content Board (45 s)
- Sidebar, **Content Board**. Nine `[DEMO]` cards across Idea, Script, Shoot, Edit, Review, Published, each with a Demo badge.
- Drag a card between columns. Moving a card to **Shoot** needs a script with scenes; otherwise the move is refused with a message.
- Open the **Ideas** panel: suggestions are seeded (Demo). With a key, "Generate ideas" calls the real model.
- Works without keys: everything here except generating ideas.

### 3. Open the hero project (20 s)
- Click **[DEMO] My whole editing workflow in under a minute** (Edit column). Tabs: Plan, Script, Footage, Match, Clips, Sponsors, Publish.
- Say: "Sponsors and Publish are not built yet; those tabs say so" (they show a "not available" page, which is the honest state).

### 4. Plan, the AI Director (45 s)
- **Plan** tab: angle, structure with durations, shot list. Badge: Demo (seeded). Edit a shot's framing, "Save", note the badge turns **You** on that row; try **Export CSV**.
- **With a key:** use the form to "Generate plan": the result carries the **AI** badge with the provider.
- **Without a key:** click Generate and show the inline `LLM_NOT_CONFIGURED` message naming the env vars. That is a feature.

### 5. Script (45 s)
- **Script** tab: 8 scenes, an "Approved" chip, per-scene estimated seconds, beats B1..Bn, versions.
- Click a scene and change a sentence: the editor autosaves and shows an unsaved/saved indicator.
- **With a key:** "Generate hooks" (the picker shows hook options with type tags), regenerate or tighten a scene, "Generate meta" for titles, description, tags.

### 6. Footage and search (45 s)
- **Footage** tab: `hero_demo.mp4`, status chips from the pipeline, primary-video radio, drop zone. Click the card to open the **asset drawer**: player, clickable transcript words (click one: the player seeks), shot strip, waveform, tags.
- Top search box (or **Asset Library**): try `trim the dead air`, `export vertical`. Results show the matching moment with a timecode; click to jump.
- Works without keys: all of it. Without the real embedder results are badged **Heuristic** (hashing); with `make models` they are real semantic matches. Mention the AI shot captions need a key (otherwise the drawer says AI captions unavailable).

### 7. Script-to-footage match (60 s)
- **Match** tab: the coverage bar (about 75 % with the fallback embedder; the number differs with the real one), each beat on the left with its matched span, thumbnail, timecode and a confidence status (Matched, Weak, Missing, Confirmed).
- Click **play** on a beat: the clip window plays. Open **swap** on a Missing beat, pick an alternative, status becomes Confirmed. **Missing scenes** cards suggest what to reshoot (for example a "Sound" scene).
- Say: "Alignment is a dynamic program over transcript spans; the badge is Heuristic because it is math, not a model."

### 8. Clips (60 s)
- **Clips** tab: two `[DEMO]` clips with scores, hook, caption, reason, duration. Warning "Fallback copy": titles were not written by an LLM (heuristic).
- Edit a title (turns **You**), **Accept** a clip. With a key, "Generate clips" runs scoring + LLM rerank/copy and the badge says **AI**.
- Say what accept does: it is logged and will feed the Twin later (not built).

### 9. Timeline editor (90 s)
- On a clip click **Open in editor**. Full-screen editor: monitor, inspector, timeline with video, caption and audio tracks, history panel.
- Show: `Space` play, `S` split at the playhead, drag a trim handle, `Ctrl/Cmd+Z` undo, "Tighten pauses", change the caption style in the inspector, **Accept all** on AI layers, the **revision menu** (restore an old revision). Save status shows "Saved" (autosave).
- Conflict story (optional): open the same clip in two tabs, edit both: the second gets a conflict dialog (reload, merge, or overwrite).
- If the player shows an error panel it is a codec problem in that browser (use Chrome), not data loss; the timeline still works.

### 10. Export (45 s)
- Back on Clips (or in the editor header) click **Render**, pick **YouTube Short** (also Reels, TikTok and YouTube long; a clip longer than the preset's cap shows a duration warning), "Start render". A progress bar follows the job, then a **Download** button; the **Renders** list keeps history and `/repurpose` lists every render.
- Say: captions are burned in with ffmpeg (libass, or the built-in renderer when libass is missing); a render includes every layer that is not rejected.
- Offline-safe, no key needed.

### 11. Jobs and Settings (30 s)
- **Jobs & Activity**: every upload, match, clip and render job with progress, retry/cancel, plus the activity log.
- **Settings**: "Language models" shows which providers are on, calls today, models in use; **Test my keys**. "Media & search engine" shows ffmpeg and the embedder with a Real or Heuristic label.

### 12. Close (15 s)
Honest scope: sponsorships, YouTube publishing, analytics and the Creative Twin are the next milestones
([TODO.md](TODO.md)); the Plan has them specified and the data model already exists.

## What works without keys vs with keys

| Works with no key | Needs a key (Gemini, Groq or Ollama) |
|---|---|
| sign-in, board, drag and drop, project pages | Director plan and review wording, hooks, script generate/rewrite, meta |
| upload, probe, proxies, silence, shots, keyframes | AI keyframe captions (visual search quality) |
| transcription via sidecar or local Whisper (`make models-asr`) | transcription via Groq Whisper (faster than local) |
| search, matching, clip candidates and scoring (heuristic copy) | clip title/hook/caption rerank |
| timeline editor, revisions, renders, downloads | ideas generation, Insights narrative (not built) |

## With real footage (optional, 3 minutes)
1. Footage tab, drop an mp4 (and optionally a `.srt`/`.words.json` next to it to skip ASR). The pipeline checklist advances live.
2. With `GROQ_API_KEY` transcription takes seconds; otherwise `make models-asr` once for local Whisper.
3. Write or generate a script, approve it (move the card to Shoot), then **Run matching**, **Generate clips**, edit, render.

## If something fails live (cheat sheet)

| What you see | What to do or say |
|---|---|
| "Add a free AI key" card, or AI button returns `LLM_NOT_CONFIGURED` | "That is the honest unconfigured state." Show the seeded Demo content instead, or paste a key into `.env` and restart `make dev` (30 s) |
| `LLM_BUSY` with a retry time | free-tier rate limit; wait the stated seconds and click again, or switch the provider order (`LLM_PROVIDER_ORDER`) |
| Test my keys says model not found | set `GEMINI_MODEL_MAIN` (or the Groq/Ollama model) to an id from the provider's console, restart |
| Red **MOCK MODE** banner | `LLM_ALLOW_MOCK=true` in `.env`: set false, restart. Do not demo in mock mode |
| Video shows an error panel / no picture | browser cannot decode H.264: switch to Chrome/Edge/Safari; the transcript, search and timeline still demonstrate the product |
| Search or match results look weak, badges say Heuristic | embedding model not downloaded: `make models` (online), restart, `POST /api/v1/search/reindex {"force":true}` |
| Upload fails at transcription `ASR_UNAVAILABLE` | attach a transcript from the asset drawer, or set `GROQ_API_KEY`; Reprocess resumes |
| Render stays queued | the media worker is busy with another job (one at a time); open Jobs & Activity, wait or cancel |
| Port in use / site not loading | `make dev API_PORT=8010 WEB_PORT=3010` and use the new URL |
| Data looks wrong or leftover from a previous demo | `make seed ARGS="--reset"` (about 10 s), refresh |
| Locked out | `make reset-password` |
| Everything is broken | `make reset && make seed` (wipes data, demo user is recreated) |

More in [RUNBOOK.md](RUNBOOK.md).
