# ruff: noqa: E501
"""Hand-written DEMO content for ``seed_demo.py``.

Nothing here comes from a model. Everything is stored with ``provenance.source = "demo"`` and the
content items / clips / twin memories carry a visible ``[DEMO]`` prefix.
"""

from __future__ import annotations

PREFIX = "[DEMO] "

PROFILE = {
    "display_name": "Demo Creator",
    "domain": "technology",
    "audience": "aspiring video creators who edit on a laptop",
    "tone": "direct, friendly, no-fluff",
    "language": "en",
    "platforms": ["youtube_shorts", "youtube"],
    "channel_name": "Demo Channel",
}

STYLE_PROFILE = {
    "tone_descriptors": ["direct", "friendly", "no-fluff"],
    "vocabulary": {"favor": ["workflow", "rough cut", "ship it"], "avoid": ["synergy", "hack"]},
    "pacing": {"avg_wpm": 160, "avg_segment_sec": 3.2, "cuts_per_min": 16, "pause_keep_sec": 0.15},
    "captions": {"style": "bold_center", "words_per_line": 3},
    "hook_patterns": ["question", "number"],
    "visual": {"preferred_aspect": "9:16", "music": "light, low volume"},
    "dos": ["start with the result", "one idea per clip"],
    "donts": ["long intros"],
    "summary": (
        "You speak directly and keep things practical. You open with the result, then show the "
        "steps in short punchy sentences. You favour questions and numbers in hooks and keep "
        "captions bold and centred."
    ),
    "provenance": {
        "source": "demo",
        "note": "Starter style profile written by hand for the demo; not learned from your videos.",
    },
}

# (stage, title, idea_text, objective, target_duration_sec)
BOARD = [
    (
        "idea",
        "Why your edits feel slow (and the 3 fixes)",
        "Pacing problems beginners miss.",
        "Teach pacing basics",
        45,
    ),
    (
        "idea",
        "The one export setting nobody explains",
        "Bitrate vs. platform recompression.",
        "Explain export settings",
        40,
    ),
    (
        "idea",
        "My 10-minute morning edit routine",
        "A repeatable short-form routine.",
        "Show a routine",
        50,
    ),
    (
        "script",
        "Cut your rough cut in half",
        "Ruthless trimming without losing the story.",
        "Teach trimming",
        45,
    ),
    (
        "script",
        "Captions that people actually read",
        "Size, placement and word count.",
        "Teach captions",
        40,
    ),
    (
        "shoot",
        "Audio before video: the 5-minute fix",
        "Why clean audio keeps viewers.",
        "Teach audio cleanup",
        45,
    ),
    (
        "edit",
        "HERO",
        "A real run of the pipeline on generated demo footage.",
        "Show the full workflow",
        45,
    ),
    (
        "review",
        "B-roll that earns its place",
        "When to cover a jump cut and when not to.",
        "Teach b-roll",
        40,
    ),
    (
        "published",
        "I rebuilt my editing workflow in a weekend",
        "Behind the scenes of a workflow overhaul.",
        "Share a story",
        55,
    ),
]

HERO_TITLE = "My whole editing workflow in under a minute"

IDEAS = [
    (
        "Why does your footage feel flat? Fix it in one pass",
        "Question hooks are your best performers in the demo analytics.",
    ),
    ("3 shortcuts that save an hour per video", "Number hooks come second in the demo analytics."),
    ("I deleted half my timeline and it got better", "Story hooks with a concrete result."),
    ("Stop color grading first", "A bold claim hook on your strongest topic (workflow)."),
    (
        "The caption mistake that kills retention",
        "Captions and retention have been your recurring theme.",
    ),
    ("Audio sync in 60 seconds", "Short, practical audio tutorial."),
]

HERO_HOOKS = [
    (
        "Here is how I edit a video from start to finish.",
        "story",
        "Direct promise of the whole process",
    ),
    ("Want to edit faster? Watch these five steps.", "question", "Question hook"),
    ("Five steps, one bin, zero wasted clips.", "number", "Number hook"),
]

# (title, intent, [beat text, ...]); beats mirror what the generated demo footage actually says,
# apart from "Sound" which the footage does not cover (so matching reports a real gap).
HERO_SCENES = [
    ("Hook", "Promise the result", ["Here is how I edit a video from start to finish."]),
    ("Import", "Show the first step", ["So the first step is to import every clip into one bin."]),
    ("Trim", "Cut the dead air", ["Next I trim the dead air and cut out the long pauses."]),
    (
        "B-roll",
        "Keep the story moving",
        ["Then I add b-roll over the boring parts so the story keeps moving."],
    ),
    ("Color", "Polish after the cut", ["Color correction comes after the rough cut is locked."]),
    ("Sound", "Mention audio mixing", ["I keep the music low so my voice always stays clear."]),
    (
        "Export",
        "Deliver both formats",
        ["Finally I export a vertical version for shorts and a wide version for youtube."],
    ),
    ("Outro", "Close the loop", ["That is my whole editing workflow in under a minute."]),
]

HERO_META = {
    "titles": [
        "My whole editing workflow in under a minute",
        "Edit a video from start to finish (fast)",
        "The 6-step editing workflow I use every week",
    ],
    "description": "A quick tour of a repeatable editing workflow: import, trim, b-roll, color and export.",
    "ctas": ["Follow for one workflow tip a week."],
    "captions": ["My entire edit in under a minute."],
    "tags": ["video editing", "workflow", "tutorial", "shorts"],
    "supporting": {
        "pinned_comment": "Which step takes you longest?",
        "thumbnail_text": ["60 SEC WORKFLOW"],
    },
}

HERO_PLAN = {
    "domain": "technology",
    "objective": "Show the full editing workflow in under a minute",
    "audience": "aspiring video creators who edit on a laptop",
    "angle": "A complete edit, one step per sentence, with nothing skipped.",
    "structure": [
        {
            "section": "Hook",
            "goal": "Promise the whole workflow",
            "duration_sec": 6,
            "notes": "Say the result first.",
        },
        {
            "section": "Steps",
            "goal": "Import, trim, b-roll, color",
            "duration_sec": 24,
            "notes": "One sentence per step.",
        },
        {"section": "Sound", "goal": "Mention audio", "duration_sec": 5, "notes": "Keep it short."},
        {
            "section": "Export",
            "goal": "Show both formats",
            "duration_sec": 6,
            "notes": "Vertical and wide.",
        },
        {
            "section": "Outro",
            "goal": "Close the loop",
            "duration_sec": 4,
            "notes": "Repeat the promise.",
        },
    ],
    "storytelling": [
        "Open with the result",
        "One idea per sentence",
        "End by repeating the promise",
    ],
    # One entry per structure section (the API enforces exactly one shot per scene of the plan).
    "shot_list": [
        {
            "scene": 1,
            "shot_type": "medium",
            "framing": "face, eye-level",
            "b_roll": "",
            "note": "Look at the lens.",
        },
        {
            "scene": 2,
            "shot_type": "screen",
            "framing": "timeline: import, trim, b-roll, color",
            "b_roll": "bin full of clips, razor tool, before / after split",
            "note": "One sentence per step.",
        },
        {
            "scene": 3,
            "shot_type": "close-up",
            "framing": "face, eye-level",
            "b_roll": "mixer sliders",
            "note": "",
        },
        {
            "scene": 4,
            "shot_type": "screen",
            "framing": "export dialog",
            "b_roll": "two export presets",
            "note": "",
        },
        {
            "scene": 5,
            "shot_type": "medium",
            "framing": "face, eye-level",
            "b_roll": "",
            "note": "Repeat the promise.",
        },
    ],
    "hook_ideas": [h[0] for h in HERO_HOOKS],
    "cta": "Follow for one workflow tip a week.",
    "risks": ["Do not skip the trimming step: pacing drives retention."],
}

# Small scripts for the other script/shoot-stage items: title -> (hook, [(scene title, beat)])
SIDE_SCRIPTS = {
    "Cut your rough cut in half": (
        "You can cut your rough cut in half and lose nothing.",
        [
            ("Hook", "You can cut your rough cut in half and lose nothing."),
            ("Why", "Every second without a new idea gives viewers a reason to leave."),
            ("How", "Mark each sentence, keep the best take, and delete everything that repeats."),
            ("Close", "Try it on your next video and watch the retention curve."),
        ],
    ),
    "Captions that people actually read": (
        "Most captions are too small to read on a phone.",
        [
            ("Hook", "Most captions are too small to read on a phone."),
            ("Size", "Make them big, bold and centred, three words at a time."),
            ("Timing", "Highlight each word as it is spoken so the eye follows."),
            ("Close", "Test on your own phone before you publish."),
        ],
    ),
    "Audio before video: the 5-minute fix": (
        "Viewers forgive bad video but never bad audio.",
        [
            ("Hook", "Viewers forgive bad video but never bad audio."),
            ("Fix", "Cut the noise floor, level the voice, then add music very quietly."),
            ("Check", "Listen on cheap earbuds before you export."),
            ("Close", "Five minutes here saves the whole video."),
        ],
    ),
}

# Twin memories: (kind, text)
MEMORIES = [
    (
        "approved_script",
        "Here is how I edit a video from start to finish. Import, trim, add b-roll, color, export. Five steps, nothing skipped.",
    ),
    (
        "approved_script",
        "Want to edit faster? Stop scrubbing the timeline. Mark your best takes while you watch, then cut everything else.",
    ),
    (
        "approved_script",
        "Three captions mistakes I made for a year: too small, too low, too many words at once.",
    ),
    (
        "approved_clip",
        "Clip about trimming dead air: short sentences, cut on the breath, no filler.",
    ),
    (
        "approved_clip",
        "Clip about export settings: one setting explained in 30 seconds with a screen recording.",
    ),
    (
        "preference",
        "Prefers bold centred captions on shorts and a small bottom caption on long videos.",
    ),
    ("preference", "Opens with the result, never with a greeting."),
    ("preference", "Keeps background music very quiet (about -18 dB)."),
    ("feedback", "Rejected an AI-suggested clip that started mid-sentence."),
    (
        "feedback",
        "Liked clips that end on a complete thought, even when they run a few seconds longer.",
    ),
]

# (title, hook sentence, format, topic, duration_sec)
VIDEOS = [
    ("Why your edits feel slow", "Why do your edits feel slow?", "short", "editing", 42),
    (
        "3 cuts that fix boring videos",
        "3 cuts that fix every boring video.",
        "short",
        "editing",
        38,
    ),
    (
        "I wasted a year editing wrong",
        "I wasted a year editing the wrong way.",
        "short",
        "workflow",
        47,
    ),
    (
        "Stop using transitions everywhere",
        "Stop using transitions everywhere, they hurt pacing.",
        "short",
        "editing",
        35,
    ),
    ("My timeline setup", "Here is my timeline setup for fast edits.", "short", "workflow", 52),
    (
        "Is your mic the problem?",
        "Is your mic the real problem with your videos?",
        "short",
        "audio",
        40,
    ),
    (
        "5 audio fixes in 5 minutes",
        "5 audio fixes you can do in five minutes.",
        "short",
        "audio",
        44,
    ),
    ("Color grading in 60 seconds", "Color grading explained in one minute.", "short", "color", 58),
    ("The best budget camera", "What is the best budget camera for creators?", "short", "gear", 33),
    (
        "My editing workflow, full walkthrough",
        "My full editing workflow from import to export.",
        "long",
        "workflow",
        612,
    ),
    (
        "Story first, edit second",
        "I used to edit first and write later, here is why that failed.",
        "short",
        "storytelling",
        49,
    ),
    (
        "How I plan a week of shorts",
        "How do I plan a full week of shorts in one hour?",
        "short",
        "growth",
        51,
    ),
    ("The caption mistake", "Nobody tells you this about captions.", "short", "editing", 31),
    (
        "10 shortcuts I use daily",
        "10 keyboard shortcuts I use every single day.",
        "short",
        "workflow",
        45,
    ),
    (
        "Do you need a gimbal?",
        "Do you really need a gimbal for talking head videos?",
        "short",
        "gear",
        37,
    ),
    (
        "Build a hook in 3 steps",
        "How do you build a hook in three steps?",
        "short",
        "storytelling",
        41,
    ),
    (
        "Long-form editing masterclass",
        "A long-form editing masterclass for beginners.",
        "long",
        "editing",
        905,
    ),
    (
        "Why retention drops at 3 seconds",
        "Why does retention drop at three seconds?",
        "short",
        "growth",
        36,
    ),
    (
        "My worst edit ever",
        "My worst edit ever got more views than my best.",
        "short",
        "storytelling",
        48,
    ),
    (
        "Music mixing for talking heads",
        "How loud should music be under your voice?",
        "short",
        "audio",
        43,
    ),
    (
        "Proxy workflow for slow laptops",
        "Proxies make a slow laptop feel fast.",
        "short",
        "workflow",
        39,
    ),
    (
        "What I would do with 1000 subs",
        "What I would do first with 1000 subscribers.",
        "short",
        "growth",
        46,
    ),
    (
        "Color before cuts? Never",
        "Never color before you cut, here is the truth.",
        "short",
        "color",
        34,
    ),
    (
        "Behind the scenes of a channel",
        "A behind the scenes look at how this channel runs.",
        "long",
        "growth",
        740,
    ),
]
