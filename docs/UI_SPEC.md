# UI spec (pages, components, theme)

Source: the plan's route list + reference screenshots from the InVideo editor. Inspirations to borrow
patterns from: **InVideo** (agent chat + editor), **Descript** (transcript-driven editing: click a word to
seek, delete text to cut), **Vizard** (clip list with a score badge, one-click export presets).

## Theme
- **Background** near-black `#121212`; panels `#1c1c1c`–`#242424`, 1px subtle borders, big radii (16–24px).
- **Primary button**: white pill, black text, icon ("Open editor ↑", "Export", "Add media"). Secondary: ghost/outlined dark pills.
- **Segmented toggle** like "Agent | Editor" for mode switching.
- **Type**: serif display font for big page headlines (e.g. Instrument Serif / Playfair), **Inter** for UI, monospace for timecodes.
- **Accents**: blue = selection/playhead/timecodes · teal/green = audio waveforms · muted blue = video clips · lime dot = active project · amber = credits/upgrade chips · purple = avatar.
- **AI presence**: yellow "Agent" cursor chip vs orange/red "You" chip. Reuse for `source: 'ai' | 'user'` on timeline items/changes.
- **Progress style**: step tabs with a thin underline (Upload footage → Describe edit → Review cut → Export). Reuse for project tabs / stage tabs.
- **Chat style**: left chat panel with a collapsible checklist ("Transcribing… ✓") and a prompt box at the bottom with `+`, a model chip, and a round send button.
- **Icons**: thin line icons (lucide), left rail = icon-over-label items.

## Global shell (wraps every `(app)` page)
- **Left rail**: Home, Board, Library, Insights, Twin, Settings + "New project" button; active item = filled rounded tile.
- **Top bar**: breadcrumb, global search (opens Library search), job indicator, user avatar menu.
- **TwinDrawer**: right slide-over with chat, opens from anywhere.
- **JobToasts**: bottom-right toasts with progress bars, driven by SSE.
- **Shared states**: loading skeletons, `EmptyState`, `ConfirmDialog`, error toasts mapping `LLM_BUSY`, `QUOTA_EXCEEDED`, `NO_YOUTUBE_CONNECTION`.

## Auth pages
1. `/login` – logo, serif headline, centered card; email + password; "Continue with Google" (disabled in local mode); sign-in/sign-up toggle; inline errors; forgot-password link (local mode: shows "reset via `make reset-password`" hint).
2. `/onboarding` – 3–4 step wizard with underline progress: channel basics (name, niche/domain, audience) → style seed (tone chips, caption style picker with 3 previews, preferred aspect) → optional paste 2–3 sample scripts to bootstrap the Twin → connect YouTube (skippable) + "Go to board".

## Main pages
0. `/` **Home** – serif headline, big prompt box ("What do you want to make?") with "Start project", quick-start cards, recent-projects strip.
3. `/board` – Kanban: Idea, Script, Shoot, Edit, Review, Published. `ContentCard`: title, thumbnail, stage badge, progress ring, due date, running-job indicator. Header: "New content" + filters (search/topic/stage). `NewContentDialog`: title, topic, "generate ideas". Idea-suggestions panel (from Insights/Twin) with "Add to board". Drag & drop + card context menu.
4. `/library` – big natural-language search bar with filters (type video/audio/image/doc; status; tag). `AssetGrid`/`AssetCard`: poster, duration, type icon, status chip, tags. Search results: matching segment + timecode + snippet + "jump to moment" preview. `UploadDialog`: drag & drop, chunked upload progress, pipeline checklist (probe, transcribe, shots, embed). `AssetDetail` drawer: player, transcript (clickable words), shots, metadata, tag editor, delete. Grid/list toggle + sort.
5. `/projects/[id]` layout – editable title, stage badge, content-item switcher; tabs (underline style): Plan, Script, Footage, Match, Clips, Research, Publish; stage-advance button ("Move to Shoot"); running-jobs strip.
6. `/projects/[id]/plan` (AI Director) – `DirectorForm` (objective, audience, domain, target length, "Generate plan"); `PlanView` (angle, structure with duration bars, storytelling tips, hook ideas, CTA, risks); `ShotList` (editable/exportable table: scene, shot type, framing, b-roll, notes); `ReviewReport` once footage exists (score ring + 5 sub-scores; strengths; issues with severity + "go to timestamp"; missing scenes; suggestions; "Re-run review").
7. `/projects/[id]/script` – `HookPicker` (hook options + type tag + "use this"); `ScriptEditor` (reorderable scene list left, rich text with beat markers right); per-scene tools (regenerate, tighten, est. seconds); `MetaPanel` (3 titles, description, CTAs, tags, social captions, pinned comment, thumbnail text — each with copy); Twin banner ("Written in your style") + "Mark approved → Shoot".
8. `/projects/[id]/footage` – upload zone, attached assets list with processing status, primary-video selector, "Run matching".
9. `/projects/[id]/match` – coverage summary bar; `ScriptFootageView` (beats left, matched clips right); `BeatRow` (beat text, thumbnail, timecode, confidence badge, "swap match", "play"); `MissingScenes` card list with reshoot suggestions.
10. `/projects/[id]/clips` – "Generate clips" (count, include full cut) + job progress; `ClipList`/`ClipCard` (preview, score, title, hook, caption, reason, duration, status); actions: accept, reject, "Open in editor", "Render"; `RenderDialog` (preset, caption style, duration-cap warning, progress → download). **Renders** section at bottom lists past renders with download links (this is the `/export` route).
11. `/editor/[clipId]` (should look most like the screenshots) – left Chat (Twin/Agent), center Monitor/`PreviewPlayer`, right `Inspector`, bottom Timeline with a toolbar down its left edge. Toolbar: select, split, trim, text, overlay, undo/redo. Tracks: video (thumbnails), captions, audio (music/sfx/voiceover), overlays; each with lock/mute, ruler, playhead, zoom. `LayerBadge`: AI items get the yellow Agent badge + suggested/accepted/rejected state + reason tooltip. Inspector: in/out, gain, crop_x, transition, caption style/text + global aspect/caption style. Header: revision history dropdown, "Accept all", save status, Export (opens RenderDialog). Transport: play, frame step, timecode, volume. Handle `REVISION_CONFLICT` (409) with a reload prompt.
12. `/projects/[id]/sponsors` – `BriefForm` (brand, product, key points, duration, tone); "Find slots" → 3 `SlotCard`s (timestamp, kind badge, snippet, integration script, lower-third text, preview, "Accept into clip" with clip picker); disclosure reminder.
13. `/projects/[id]/publish` – `PublishForm` (render picker, title w/ alternatives from the script, description (auto-adds paid-promotion line when sponsors used), tags, topic, hook, visibility, schedule); "Connect YouTube" if not connected; `PublishStatus` (progress, success + link, error + retry); download-only presets (Reels, TikTok) show a Download button.
14. `/insights` – range picker (default 90d) + sync; `KpiRow`; sortable/filterable `PerformanceTable` with editable topic/hook; `HookChart`, `LengthChart`, topic breakdown (groups <2 videos show "not enough data"); top-5 card; AI narrative with caveats; `NextIdeas` (5, "Add to board").
15. `/twin` – `StyleProfileCard` (summary, tone chips, vocab favor/avoid, pacing stats, dos/don'ts, revision); memories list (deletable); full-size `TwinChat` with `ActionButtons` rendered as "Apply" (never auto-run); edit & reset profile.
16. `/settings` – profile & workspace; YouTube connection; defaults (caption style, preset, aspect); usage & limits (LLM/API indicators); danger zone (delete data, sign out).
17. `404` / error page, and a **Jobs/Activity** panel (full list of jobs + `activity_log`).
