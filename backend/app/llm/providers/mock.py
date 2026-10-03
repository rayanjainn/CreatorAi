"""Offline deterministic provider. Derives schema-valid output from the prompt variables.

It exists only for development and tests and is used only when ``LLM_ALLOW_MOCK=true`` (never the
default, never a silent fallback). Output is a pure function of ``(task, variables)`` and is marked
with ``[MOCK]`` in its user-visible text so it can never be mistaken for real AI output.
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from collections.abc import Callable
from typing import Any

from app.llm.providers.base import LLMRequest, LLMResult, Provider, ProviderError, estimate_tokens
from app.llm.schemas import ALLOWED_ACTION_TYPES, TASK_SCHEMAS

_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’-]*")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_STOP = frozenset(
    """
    a an the and or but if then so of to in on at by for with from as is are was were be
    been i me my we our you your he she it its they them this that these those what which
    who how why when where not no do does did have has had just very can will would could
    should about into over than too also more most some any all each other such only own
    same here there
    """.split()
)
HookFn = Callable[[dict[str, Any]], dict[str, Any]]


def _words(text: str) -> list[str]:
    return _WORD.findall(text or "")


def _clip_words(text: str, n: int) -> str:
    words = (text or "").split()
    return " ".join(words[:n])


def _first_sentence(text: str) -> str:
    parts = _SENTENCE.split((text or "").strip())
    return parts[0].strip() if parts and parts[0] else ""


def _keywords(text: str, n: int = 5) -> list[str]:
    counts = Counter(w.lower() for w in _words(text) if w.lower() not in _STOP and len(w) > 2)
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [w for w, _ in ranked[:n]]


def _topic(v: dict[str, Any], *keys: str) -> str:
    for key in (*keys, "topic", "idea", "title"):
        value = v.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().rstrip(".?! ")
    return "your next video"


def _limit(text: str, chars: int) -> str:
    text = text.strip()
    return text if len(text) <= chars else text[: chars - 1].rstrip() + "…"


def _pick(seed: str, options: list[str]) -> str:
    return options[int(hashlib.sha256(seed.encode()).hexdigest(), 16) % len(options)]


# ── director ─────────────────────────────────────────────────────────────────────────────────
_SECTIONS = [
    ("Hook", "Promise the outcome in one sentence", 0.15),
    ("Context", "Show why this matters to the viewer", 0.20),
    ("Core idea", "Deliver the main idea step by step", 0.40),
    ("Proof", "Back it up with an example or result", 0.15),
    ("CTA", "Tell the viewer exactly what to do next", 0.10),
]
_SHOTS = ["close-up", "medium", "screen recording", "b-roll", "close-up"]


def _director_plan(v: dict[str, Any]) -> dict[str, Any]:
    idea = _topic(v, "idea")
    target = int(v.get("target_duration_sec") or 45)
    structure = [
        {
            "section": name,
            "goal": goal,
            "duration_sec": round(target * share),
            "notes": f"Keep it about {idea}.",
        }
        for name, goal, share in _SECTIONS
    ]
    structure[-1]["duration_sec"] += target - sum(s["duration_sec"] for s in structure)
    return {
        "domain": str(v.get("domain") or "education"),
        "objective": str(v.get("objective") or f"Help viewers understand {idea}"),
        "audience": str(v.get("audience") or "curious viewers"),
        "angle": f"{idea}: the shortest path from confused to confident",
        "structure": structure,
        "storytelling": [
            "Open with the result",
            "One idea per scene",
            "End on a single clear action",
        ],
        "shot_list": [
            {
                "scene": i + 1,
                "shot_type": _SHOTS[i % len(_SHOTS)],
                "framing": "face, eye-level" if i % 2 == 0 else "over-the-shoulder",
                "b_roll": f"visual that shows {idea}"
                if _SHOTS[i % len(_SHOTS)] != "close-up"
                else "",
                "note": s["goal"],
            }
            for i, s in enumerate(structure)
        ],
        "hook_ideas": [f"What if {idea} took half the time?", f"Stop doing {idea} the hard way."],
        "cta": "Subscribe for the next one in this series",
        "risks": [
            "A long intro will hurt retention",
            "Too many ideas in one video dilutes the message",
        ],
    }


_REVIEW_FIXES = {
    "hook": "Open with the payoff in the first 3 seconds and cut the preamble",
    "pacing": "Trim the pause or slow stretch so the next idea lands sooner",
    "coverage": "Reshoot or add footage for this part of the script",
    "cta": "End with one direct call to action in the last 10 seconds",
    "clarity": "Shorten the sentences and cut filler words in this section",
}


def _director_review(v: dict[str, Any]) -> dict[str, Any]:
    scores = {k: float(x) for k, x in (v.get("scores") or {}).items() if k != "overall"}
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    strengths = [f"Strong {name} ({score:.0f}/100)" for name, score in ranked[:2] if score >= 60]
    issues = []
    for cand in (v.get("issue_candidates") or [])[:5]:
        kind = str(cand.get("type", "pacing"))
        issues.append(
            {
                "type": kind,
                "severity": cand.get("severity") or "medium",
                "at_sec": cand.get("at_sec"),
                "scene_idx": cand.get("scene_idx"),
                "fix": _REVIEW_FIXES.get(kind, _REVIEW_FIXES["pacing"]),
            }
        )
    weakest = [name for name, _ in ranked[-2:][::-1]]
    suggestions = [_REVIEW_FIXES.get(name, "Tighten this area") for name in weakest] or [
        "Re-run the review after the next edit"
    ]
    return {
        "strengths": strengths or ["The core idea comes through"],
        "issues": issues,
        "suggestions": suggestions,
    }


# ── scripts ──────────────────────────────────────────────────────────────────────────────────
def _hooks(v: dict[str, Any]) -> dict[str, Any]:
    topic = _clip_words(_topic(v), 8)
    templates = [
        ("question", f"What if {topic} took half the time?", "A question opens a curiosity gap"),
        ("number", f"3 things nobody tells you about {topic}", "Numbers promise a concrete payoff"),
        ("bold_claim", f"Stop doing {topic} the hard way.", "A bold claim creates tension"),
        ("story", f"Last year I got {topic} completely wrong.", "A personal story builds trust"),
        (
            "contrast",
            f"Everyone overcomplicates {topic}. Here is the simple way.",
            "Contrast sets up a reveal",
        ),
    ]
    count = max(1, min(int(v.get("count") or 5), 10))
    hooks = []
    for i in range(count):
        kind, text, why = templates[i % len(templates)]
        if i >= len(templates):
            text = f"{text} (take {i // len(templates) + 1})"
        hooks.append({"text": _clip_words(text, 18), "type": kind, "why": why})
    return {"hooks": hooks}


_SCENE_LINES = {
    "context": [
        "Most people get stuck on {t} because they start in the wrong place.",
        "The good news is it comes down to one simple shift.",
        "Once you see it, you cannot unsee it.",
    ],
    "core": [
        "Here is the approach to {t} that actually works.",
        "First, focus on the one thing that moves the needle.",
        "Then repeat it until it becomes automatic.",
    ],
    "proof": [
        "I tried this myself and the difference was obvious.",
        "In my case, {t} went from a chore to a five minute habit.",
        "You can check the result right here.",
    ],
    "cta": [
        "If this helped, follow for the next part.",
        "Drop a comment with the one thing you want me to cover next.",
    ],
}


def _scene_key(name: str) -> str:
    low = name.lower()
    if "cta" in low or "call" in low or "outro" in low:
        return "cta"
    if "proof" in low or "result" in low or "example" in low:
        return "proof"
    if "context" in low or "problem" in low or "setup" in low:
        return "context"
    return "core"


def _script_meta(topic: str, text: str) -> dict[str, Any]:
    keywords = _keywords(f"{topic} {text}", 8)
    hook = _first_sentence(text) or topic
    return {
        "titles": [
            _limit(f"{topic.capitalize()} in under a minute", 70),
            _limit(f"The simple way to handle {topic}", 70),
            _limit(f"Why {topic} is easier than you think", 70),
        ],
        "description": f"{_limit(hook, 120)}\nLearn {topic} step by step.\n\nSubscribe for more.",
        "ctas": ["Subscribe for weekly tips", "Comment what you want next"],
        "captions": [
            _limit(f"{hook} #{(keywords or ['tips'])[0]}", 150),
            f"Save this for later #{(keywords or ['tips'])[-1]}",
        ],
        "tags": keywords[:10] or ["tips"],
        "supporting": {
            "pinned_comment": f"What is your biggest struggle with {topic}?",
            "thumbnail_text": [_clip_words(topic.upper(), 4), "THE SIMPLE WAY"],
        },
    }


def _script_generate(v: dict[str, Any]) -> dict[str, Any]:
    topic = _topic(v)
    hook = str(v.get("hook") or f"What if {topic} took half the time?").strip()
    length = int(v.get("length_sec") or 45)
    structure = v.get("structure") or []
    names = [str(s.get("section")) for s in structure if isinstance(s, dict) and s.get("section")]
    names = names or [n for n, _, _ in _SECTIONS]
    if names[0].lower() != "hook":
        names = ["Hook", *names]
    budget = max(20, int(length * 2.5))
    per_scene = max(8, budget // len(names))
    scenes: list[dict[str, Any]] = []
    for idx, name in enumerate(names):
        if idx == 0:
            lines = [hook]
        else:
            pool = [line.format(t=topic) for line in _SCENE_LINES[_scene_key(name)]]
            lines, count = [], 0
            for line in pool:
                lines.append(line)
                count += len(line.split())
                if count >= per_scene:
                    break
        beats = [
            {
                "idx": b,
                "text": line,
                "intent": f"{name.lower()} beat {b + 1}",
                "est_sec": round(len(line.split()) / 2.5, 1),
            }
            for b, line in enumerate(lines)
        ]
        scenes.append(
            {
                "idx": idx,
                "title": name,
                "intent": f"{name} for {topic}",
                "est_sec": round(sum(b["est_sec"] for b in beats), 1),
                "text": " ".join(lines),
                "beats": beats,
            }
        )
    full = " ".join(s["text"] for s in scenes)
    body = f"# {topic.capitalize()}\n\n" + "\n\n".join(
        f"## {s['title']}\n{s['text']}" for s in scenes
    )
    return {"body_md": body, "scenes": scenes, "meta": _script_meta(topic, full)}


def _script_meta_task(v: dict[str, Any]) -> dict[str, Any]:
    text = str(v.get("script_text") or v.get("script") or "")
    topic = str(v.get("topic") or " ".join(_keywords(text, 3)) or "this idea")
    return _script_meta(topic, text)


# ── assets / matching / clips ────────────────────────────────────────────────────────────────
def _caption_keyframes(v: dict[str, Any]) -> dict[str, Any]:
    shots = []
    transcripts: list[str] = []
    for i, shot in enumerate(v.get("shots") or []):
        line = str(shot.get("transcript") or "").strip()
        transcripts.append(line)
        words = _keywords(line, 5)
        shots.append(
            {
                "id": str(shot.get("id") or f"shot_{i}"),
                "caption": _clip_words(line, 20) or f"Shot {i + 1}",
                "tags": words[:6] or ["scene"],
            }
        )
    joined = " ".join(transcripts)
    name = str(v.get("filename") or "this footage")
    return {
        "shots": shots,
        "description": _clip_words(joined, 40) or f"Footage from {name}",
        "tags": _keywords(joined, 8),
    }


def _overlap(a: str, b: str) -> float:
    sa = {w.lower() for w in _words(a) if w.lower() not in _STOP}
    sb = {w.lower() for w in _words(b) if w.lower() not in _STOP}
    return len(sa & sb) / len(sa | sb) if sa and sb else 0.0


def _disambiguate(v: dict[str, Any]) -> dict[str, Any]:
    beat = str(v.get("beat_text") or "")
    candidates = v.get("candidates") or []
    if not candidates:
        return {"best_id": "none", "confidence": 0.0}
    scored = [(_overlap(beat, str(c.get("text", ""))), str(c.get("id"))) for c in candidates]
    best_score, best_id = max(scored, key=lambda s: s[0])
    return {"best_id": best_id, "confidence": round(min(1.0, 0.5 + best_score), 2)}


def _rerank(v: dict[str, Any]) -> dict[str, Any]:
    keep = int(v.get("keep") or 4)
    clips = []
    for rank, cand in enumerate((v.get("candidates") or [])[:keep], start=1):
        text = str(cand.get("text") or "")
        tags = " ".join(f"#{k}" for k in _keywords(text, 3))
        hook = _clip_words(_first_sentence(text) or text, 15)
        clips.append(
            {
                "candidate_id": str(cand.get("id")),
                "keep": True,
                "rank": rank,
                "title": _limit(_clip_words(text, 8) or "Highlight", 70),
                "hook": hook or "Watch this",
                "caption": _limit(f"{_clip_words(text, 18)} {tags}".strip(), 150),
                "reason": "complete thought with a clear opening line",
            }
        )
    return {"clips": clips}


# ── sponsors ─────────────────────────────────────────────────────────────────────────────────
def _sponsor(v: dict[str, Any]) -> dict[str, Any]:
    brief = v.get("brief") or {}
    brand = str(brief.get("brand") or "our sponsor")
    product = str(brief.get("product") or "their product")
    points = [str(p) for p in brief.get("key_points") or []]
    cta = str(brief.get("cta") or f"Check out {brand} with the link below.")
    banned = [str(b) for b in brief.get("do_not_say") or [] if b]
    slots = []
    for slot in v.get("slots") or []:
        bridge = (_keywords(str(slot.get("before") or ""), 1) or ["getting more done"])[0]
        parts = [
            f"Speaking of {bridge}, this video is brought to you by {brand}.",
            f"{product} {points[0]}." if points else f"I have been using {product} lately.",
            *(f"It also {p}." for p in points[1:3]),
            cta,
        ]
        script = " ".join(parts)
        for phrase in banned:
            script = re.sub(re.escape(phrase), "", script, flags=re.IGNORECASE)
        after_words = _keywords(str(slot.get("after") or ""), 3)
        slots.append(
            {
                "slot_id": str(slot.get("slot_id")),
                "integration_script": re.sub(r"\s+", " ", script).strip(),
                "lower_third": _clip_words(f"Sponsored by {brand}", 6),
                "transition_back": f"Alright, back to {' '.join(after_words) or 'the video'}.",
            }
        )
    return {"slots": slots}


# ── twin ─────────────────────────────────────────────────────────────────────────────────────
def _twin_chat(v: dict[str, Any]) -> dict[str, Any]:
    message = str(v.get("message") or "")
    low = message.lower()
    scope = v.get("scope") or {}
    allowed = {
        a if isinstance(a, str) else a.get("type")
        for a in v.get("allowed_actions") or ALLOWED_ACTION_TYPES
    }
    clip_id = scope.get("clip_id")
    item_id = scope.get("content_item_id")
    reply = "Got it. Tell me what to change: pauses, caption style, hooks, music or a new idea."
    action: dict[str, Any] | None = None
    if clip_id and "tighten_pauses" in allowed and ("pause" in low or "tighten" in low):
        reply = "Tightened the pauses to 0.1 seconds. Apply it to hear the quicker pacing."
        action = {"type": "tighten_pauses", "clip_id": clip_id, "params": {"keep_sec": 0.1}}
    elif (
        clip_id
        and "set_caption_style" in allowed
        and ("caption" in low or "karaoke" in low or "subtitle" in low)
    ):
        style = (
            "karaoke"
            if "karaoke" in low
            else "minimal_bottom"
            if "minimal" in low
            else "bold_center"
        )
        reply = f"Switching the captions to {style.replace('_', ' ')}. Apply to see it on the clip."
        action = {"type": "set_caption_style", "clip_id": clip_id, "params": {"style": style}}
    elif clip_id and "toggle_music" in allowed and "music" in low:
        on = not any(w in low for w in ("remove", "no music", "turn off", "without", "off"))
        reply = "Turning the music layer on." if on else "Turning the music layer off."
        action = {"type": "toggle_music", "clip_id": clip_id, "params": {"on": on}}
    elif clip_id and "trim_clip" in allowed and "trim" in low:
        reply = "Trimming one second off the end of the clip."
        action = {
            "type": "trim_clip",
            "clip_id": clip_id,
            "params": {"start_delta": 0.0, "end_delta": -1.0},
        }
    elif item_id and "regenerate_hooks" in allowed and "hook" in low:
        reply = "Generating five fresh hooks for this video."
        action = {"type": "regenerate_hooks", "content_item_id": item_id, "params": {"count": 5}}
    elif "create_idea" in allowed and "idea" in low:
        title = _limit(_clip_words(message, 10) or "New idea", 80)
        reply = "Saving that as an idea for your board."
        action = {
            "type": "create_idea",
            "params": {"title": title, "rationale": "Suggested in chat"},
        }
    elif v.get("style_summary"):
        reply = (
            f"Staying in your voice: {_limit(str(v['style_summary']), 140)} What should we adjust?"
        )
    return {"reply": reply, "actions": [action] if action else []}


def _style_extract(v: dict[str, Any]) -> dict[str, Any]:
    scripts = [str(s) for s in v.get("scripts") or []]
    joined = " ".join(scripts)
    sentences = [s for s in _SENTENCE.split(joined) if s.strip()]
    avg = round(sum(len(s.split()) for s in sentences) / len(sentences), 1) if sentences else 0.0
    favor = _keywords(joined, 6)
    tone = ["direct" if avg and avg < 12 else "conversational"]
    if joined.count("?") >= max(1, len(scripts)):
        tone.append("question-led")
    tone.append("no-fluff")
    summary = (
        f"You write {tone[0]} sentences of about {avg or 'ten'} words and lean on "
        f"{', '.join(favor[:4]) or 'plain language'}. Lead with the payoff, keep one idea "
        "per scene "
        "and end with a single clear action."
    )
    return {
        "tone_descriptors": tone,
        "vocabulary": {"favor": favor, "avoid": ["synergy", "game-changer", "in today's video"]},
        "dos": ["start with the result", "one idea per scene"],
        "donts": ["long intros", "filler words"],
        "summary": _clip_words(summary, 80),
    }


# ── insights ─────────────────────────────────────────────────────────────────────────────────
def _narrate(v: dict[str, Any]) -> dict[str, Any]:
    tables = v.get("tables") or {}
    existing = {str(t).lower() for t in v.get("existing_titles") or []}
    top_hook = (tables.get("by_hook_type") or [{}])[0]
    top_topic = (tables.get("by_topic") or [{}])[0]
    top_len = (tables.get("by_length") or [{}])[0]
    hook = str(top_hook.get("hook_type") or "question")
    topic = str(top_topic.get("topic") or "your best topic")
    bucket = str(top_len.get("bucket") or "30-45s")
    narrative = [
        f"{hook} hooks lead on retention ({top_hook.get('avg_view_pct', 0)}% average viewed).",
        f"{topic} is your strongest topic with {top_topic.get('avg_views', 0)} views per video.",
        f"Videos in the {bucket} range perform best; aim for that length.",
    ]
    stems = [
        f"{topic}: the {hook} version",
        f"{topic} mistakes to avoid ({bucket})",
        f"I tested {topic} so you do not have to",
        f"The fastest way to learn {topic}",
        f"{topic} in {bucket.replace('-', ' to ')}",
    ]
    ideas = [
        {"title": t, "rationale": f"Builds on {hook} hooks and {topic} in the {bucket} sweet spot"}
        for t in stems
        if t.lower() not in existing
    ][:5]
    return {
        "narrative": narrative,
        "caveats": ["Metrics for videos under 7 days old are incomplete"],
        "ideas": ideas,
    }


_HANDLERS: dict[str, HookFn] = {
    "director.plan": _director_plan,
    "director.review": _director_review,
    "script.hooks": _hooks,
    "script.generate": _script_generate,
    "script.meta": _script_meta_task,
    "assets.caption_keyframes": _caption_keyframes,
    "match.disambiguate": _disambiguate,
    "clips.rerank_copy": _rerank,
    "sponsors.integration": _sponsor,
    "twin.chat": _twin_chat,
    "twin.style_extract": _style_extract,
    "insights.narrate_ideas": _narrate,
}


MOCK_MARK = "[MOCK]"
# task -> (path, max_words, max_chars); "*" walks every list item. Only user-visible text is marked.
_MARKED: dict[str, list[tuple[str, int | None, int | None]]] = {
    "director.plan": [("angle", None, None)],
    "director.review": [("strengths.*", None, None), ("suggestions.*", None, None)],
    "script.hooks": [("hooks.*.text", 18, None)],
    "script.generate": [("meta.titles.*", None, 70), ("meta.description", None, None)],
    "script.meta": [("titles.*", None, 70), ("description", None, None)],
    "assets.caption_keyframes": [("description", None, None)],
    "clips.rerank_copy": [("clips.*.title", None, 70), ("clips.*.hook", 15, None)],
    "sponsors.integration": [("slots.*.integration_script", None, None)],
    "twin.chat": [("reply", None, None)],
    "twin.style_extract": [("summary", None, None)],
    "insights.narrate_ideas": [("narrative.*", None, None), ("ideas.*.title", None, 80)],
}


def _mark(text: str, max_words: int | None, max_chars: int | None) -> str:
    if text.startswith(MOCK_MARK):
        return text
    out = f"{MOCK_MARK} {text}"
    if max_words is not None:
        out = " ".join(out.split()[:max_words])
    if max_chars is not None and len(out) > max_chars:
        out = out[: max_chars - 1].rstrip() + "…"
    return out


def _apply_mark(node: Any, parts: list[str], max_words: int | None, max_chars: int | None) -> Any:
    head, rest = parts[0], parts[1:]
    if head == "*" and isinstance(node, list):
        return [
            _mark(x, max_words, max_chars)
            if not rest
            else _apply_mark(x, rest, max_words, max_chars)
            for x in node
            if isinstance(x, str) or rest
        ]
    if isinstance(node, dict) and head in node:
        value = node[head]
        node = {
            **node,
            head: _mark(value, max_words, max_chars)
            if not rest and isinstance(value, str)
            else _apply_mark(value, rest, max_words, max_chars)
            if rest
            else value,
        }
    return node


def mark_mock_output(task: str, data: dict[str, Any]) -> dict[str, Any]:
    """Prefix the visible text fields of ``data`` with ``[MOCK]`` (idempotent)."""
    for path, words, chars in _MARKED.get(task, []):
        data = _apply_mark(data, path.split("."), words, chars)
    if task == "script.generate" and isinstance(data.get("body_md"), str):
        body = data["body_md"]
        if not body.startswith(MOCK_MARK):
            data = {
                **data,
                "body_md": f"{MOCK_MARK} Offline mock output, not AI generated.\n\n{body}",
            }
    return data


class MockProvider(Provider):
    name = "mock"
    supports_images = True
    MODEL = "mock-v1"

    def configured(self) -> bool:
        return True

    def model_for(self, tier: str) -> str:
        return self.MODEL

    def generate(self, request: LLMRequest) -> LLMResult:
        handler = _HANDLERS.get(request.task)
        if handler is None:
            raise ProviderError(f"mock has no handler for task {request.task!r}")
        schema = TASK_SCHEMAS[request.task]
        raw = schema.model_validate(handler(request.variables)).model_dump(mode="json")
        text = schema.model_validate(mark_mock_output(request.task, raw)).model_dump_json()
        return LLMResult(
            text=text,
            tokens_in=estimate_tokens(request.prompt),
            tokens_out=estimate_tokens(text),
            model=self.MODEL,
        )
