# AI Video Platform — Backend Context

## Goal

Build an AI-assisted content production platform for creators and agencies.

## User Story

Creator/agency plans content → researches topic → generates script → shoots/uploads footage → AI understands footage → AI creates edits/reels → human can refine → renderer produces final video.

## Agents

* **Director Agent** — content planning, ideas, schedules.
* **Research Agent** — topic research, sources, trends, research brief.
* **Script Agent** — hooks, scripts, CTAs, shot/B-roll suggestions.
* **Editing Agent** — selects footage and generates timeline edits.
* **Creator Twin** — learns creator's content, speaking and editing style.

## Core Backend

```text
API
├── Agents
│   ├── Director
│   ├── Research
│   ├── Script
│   └── Editing
├── Media Service
├── Timeline Service
├── Render Service
└── MCP Gateway

API → Queue → Workers
              ├── Transcription
              ├── Scene Detection
              ├── Face Detection
              ├── Embeddings
              └── Video Analysis
```

## Media Pipeline

```text
Upload → Object Storage → Processing → Index
```

Store originals and derived assets separately.

Index:

* transcript
* scenes/shots
* faces
* keyframes
* visual/text embeddings
* timestamps/metadata

Use PostgreSQL + pgvector initially.

## Long Video → Reels

```text
Long Video
→ Transcript + Scenes
→ Semantic Moments
→ Moment Scoring
→ Candidate Clips
→ Editing Agent
→ Timeline(s)
→ Render
```

One long video can produce multiple independent reels.

## Timeline

The **versioned Timeline JSON is the source of truth**.

Both the manual editor and AI Editing Agent modify the same timeline.

```text
v1 AI edit
→ v2 Human edit
→ v3 AI revision
```

## Rendering

```text
Timeline + Assets
       ↓
Render Worker
       ↓
Final Video
```

Use FFmpeg initially; preview rendering can use lower-resolution proxies.

Also, for project multiple editors can edit the same clips together, so, we want to keep role based access control at project level.

Prefer node.js, express.js, no typescript, use cloudinary cloud bucket and postgres db

## Initial Milestone

**Plan → Research → Script → Upload → Process → Index → AI Edit → Timeline → Render**
