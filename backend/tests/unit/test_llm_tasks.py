"""Every task: prompt renders, mock output validates against its schema, behaviour is sensible."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel

from app.llm.gateway import Gateway
from app.llm.providers.base import LLMRequest
from app.llm.providers.mock import MockProvider
from app.llm.render import render_prompt, template_placeholders
from app.llm.schemas import TASK_SCHEMAS, TwinChatOutput
from app.llm.tasks import TASK_ROUTES

CANDIDATES = [
    {"id": f"c{i}", "start": i * 30.0, "end": i * 30.0 + 25, "features": {"score": 0.5},
     "text": f"Candidate {i}. This is how editing workflow {i} saves you hours every single week."}
    for i in range(1, 7)
]  # fmt: skip
SAMPLES: dict[str, dict[str, Any]] = {
    "director.plan": {"idea": "weekly editing workflow", "objective": "Teach beginners",
        "platform": "youtube_shorts", "target_duration_sec": 45, "domain": "technology",
        "audience": "aspiring creators", "domain_template": {"hooks": ["question"]}},
    "director.review": {"scores": {"hook": 82, "clarity": 75, "pacing": 40, "coverage": 90, "cta": 40},
        "metrics": {"wpm": 150}, "snippets": ["so um basically"], "missing_beats": [{"scene_idx": 3}],
        "issue_candidates": [{"type": "pacing", "at_sec": 134.0, "severity": "high"},
                             {"type": "coverage", "scene_idx": 3}, {"type": "cta"}]},
    "script.hooks": {"topic": "editing videos faster", "count": 5, "tone": "witty", "platform": "shorts"},
    "script.generate": {"topic": "editing videos faster", "hook": "Stop editing the slow way.",
        "tone": "witty", "platform": "shorts", "length_sec": 45,
        "structure": [{"section": "Hook"}, {"section": "Problem"}, {"section": "Solution"}, {"section": "CTA"}]},
    "script.regenerate_scene": {"topic": "editing videos faster", "hook": "Stop editing the slow way.",
        "tone": "witty", "platform": "shorts", "is_opening": False, "target_words": 30,
        "scene": {"idx": 2, "title": "Core idea", "intent": "teach", "text": "Do this. Then that.",
                  "beats": [{"idx": 0, "text": "Do this.", "intent": "", "est_sec": 1.0}]},
        "previous_scene": "Context text.", "next_scene": "Proof text.", "instruction": ""},
    "script.tighten": {"topic": "editing videos faster", "hook": "Stop editing the slow way.",
        "is_opening": False, "target_words": 12,
        "scene": {"idx": 1, "title": "Context", "intent": "setup", "text": "Most people really just get stuck here. It is honestly quite hard.",
                  "beats": [{"idx": 0, "text": "Most people really just get stuck here.", "intent": "", "est_sec": 3.0},
                            {"idx": 1, "text": "It is honestly quite hard.", "intent": "", "est_sec": 2.0}]}},
    "content.ideas": {"topic": "editing", "count": 3, "recent_titles": ["editing: the question version"], "domain": "technology"},
    "script.meta": {"script_text": "Stop editing the slow way. Here is my workflow.", "topic": "editing"},
    "assets.caption_keyframes": {"filename": "a.mp4", "shots": [
        {"id": "shot_0", "transcript": "Welcome to my studio setup today"},
        {"id": "shot_1", "transcript": ""}]},
    "match.disambiguate": {"beat_text": "show the export settings",
        "candidates": [{"id": "s1", "text": "now the weather"}, {"id": "s2", "text": "open export settings panel"}]},
    "clips.rerank_copy": {"objective": "teach", "candidates": CANDIDATES, "keep": 4},
    "sponsors.integration": {"brief": {"brand": "Acme", "product": "Acme Cloud", "key_points": ["syncs fast", "is private"],
        "cta": "Use code CREATOR.", "do_not_say": ["cheap"], "duration_sec": 20},
        "slots": [{"slot_id": "sl1", "before": "That wraps up editing.", "after": "Now let us talk about audio levels."}]},
    "twin.chat": {"message": "tighten the pauses please", "scope": {"clip_id": "clip-1", "content_item_id": "ci-1"},
        "style_summary": "Direct and witty.", "memories": [], "allowed_actions": ["tighten_pauses", "set_caption_style"]},
    "twin.style_extract": {"scripts": ["Ship it. Then fix it. Why wait?", "Stop planning. Start recording."],
        "current_summary": ""},
    "insights.narrate_ideas": {"tables": {"by_hook_type": [{"hook_type": "question", "avg_view_pct": 61.0}],
        "by_topic": [{"topic": "editing", "avg_views": 10200}], "by_length": [{"bucket": "30-45s"}]},
        "existing_titles": ["editing: the question version"]},
    "sponsors.pitch": {"brand": "Acme", "website": "https://acme.example", "contact_name": "Sam",
        "deliverables": "one 60 second integration", "fee": "$800", "video": "Editing faster",
        "stats": "avg views: 12000", "notes": ""},
    "research.brief": {"topic": "editing videos faster", "results": [
        {"title": "Editing tips", "url": "https://example.com/tips", "snippet": "Cut on the beat."},
        {"title": "Proxy workflows", "url": "https://example.com/proxy", "snippet": "Proxies speed up scrubbing."}]},
}  # fmt: skip


def test_every_task_has_route_schema_prompt_and_sample() -> None:
    assert set(TASK_ROUTES) == set(TASK_SCHEMAS) == set(SAMPLES)
    assert len(TASK_ROUTES) == 17


@pytest.mark.parametrize("task", sorted(TASK_SCHEMAS))
def test_prompt_renders_with_preamble_and_all_placeholders(task: str) -> None:
    placeholders = template_placeholders(task) - {"creator_context", "schema"}
    assert placeholders <= set(SAMPLES[task]), (
        f"{task} sample misses {placeholders - set(SAMPLES[task])}"
    )
    text = render_prompt(task, {**SAMPLES[task], "creator_context": "CTX-LINE", "schema": "{}"})
    assert text.startswith("You are CreatorAi, an assistant for a solo video creator.")
    assert "Output ONLY JSON matching the schema. No markdown, no commentary." in text
    assert "CTX-LINE" in text and "{creator_context}" not in text


def test_render_prompt_reports_missing_variable() -> None:
    with pytest.raises(ValueError, match="idea"):
        render_prompt("director.plan", {"creator_context": "", "schema": ""})


@pytest.mark.parametrize("task", sorted(TASK_SCHEMAS))
def test_mock_output_validates_for_every_task(task: str) -> None:
    mock = MockProvider()
    req = LLMRequest(task, "p", {}, 500, "mock-v1", variables=SAMPLES[task])
    result = mock.generate(req)
    TASK_SCHEMAS[task].model_validate_json(result.text)
    assert mock.generate(req).text == result.text  # deterministic


@pytest.mark.parametrize("task", sorted(TASK_SCHEMAS))
def test_gateway_run_end_to_end_with_mock(task: str) -> None:
    out = Gateway().run(task, SAMPLES[task], TASK_SCHEMAS[task], None)
    assert isinstance(out, BaseModel)


def test_mock_hooks_use_topic_and_cover_types() -> None:
    out = Gateway().run("script.hooks", SAMPLES["script.hooks"], TASK_SCHEMAS["script.hooks"], None)
    assert len(out.hooks) == 5 and len({h.type for h in out.hooks}) == 5  # type: ignore[attr-defined]
    assert all("editing videos faster" in h.text and len(h.text.split()) <= 18 for h in out.hooks)  # type: ignore[attr-defined]


def test_mock_script_starts_with_hook_and_follows_structure() -> None:
    v = SAMPLES["script.generate"]
    out = Gateway().run("script.generate", v, TASK_SCHEMAS["script.generate"], None)
    assert [s.title for s in out.scenes] == ["Hook", "Problem", "Solution", "CTA"]  # type: ignore[attr-defined]
    assert out.scenes[0].text.startswith(v["hook"])  # type: ignore[attr-defined]
    assert out.scenes[0].beats[0].text == v["hook"]  # type: ignore[attr-defined]
    assert all(b.est_sec > 0 for s in out.scenes for b in s.beats)  # type: ignore[attr-defined]
    assert "editing videos faster" in out.body_md  # type: ignore[attr-defined]


def test_mock_rerank_picks_first_k_and_writes_copy_from_text() -> None:
    out = Gateway().run(
        "clips.rerank_copy", SAMPLES["clips.rerank_copy"], TASK_SCHEMAS["clips.rerank_copy"], None
    )
    clips = out.clips  # type: ignore[attr-defined]
    assert [c.candidate_id for c in clips] == ["c1", "c2", "c3", "c4"]
    assert [c.rank for c in clips] == [1, 2, 3, 4] and all(c.keep for c in clips)
    assert all(
        len(c.title) <= 70 and len(c.hook.split()) <= 15 and len(c.caption) <= 150 for c in clips
    )
    assert "Candidate 1" in clips[0].title


def test_mock_caption_keyframes_echo_transcript() -> None:
    out = Gateway().run("assets.caption_keyframes", SAMPLES["assets.caption_keyframes"],
                        TASK_SCHEMAS["assets.caption_keyframes"], None)  # fmt: skip
    shots = out.shots  # type: ignore[attr-defined]
    assert [s.id for s in shots] == ["shot_0", "shot_1"]
    assert shots[0].caption == "Welcome to my studio setup today" and shots[1].caption == "Shot 2"
    assert len(out.tags) <= 8  # type: ignore[attr-defined]


def test_mock_twin_chat_actions_are_allow_listed() -> None:
    schema = TASK_SCHEMAS["twin.chat"]
    gw = Gateway()
    base = SAMPLES["twin.chat"]
    out = gw.run("twin.chat", base, schema, None)
    assert len(out.actions) == 1 and out.actions[0].type == "tighten_pauses"  # type: ignore[attr-defined]
    assert out.actions[0].clip_id == "clip-1"  # type: ignore[attr-defined]
    chatty = gw.run("twin.chat", {**base, "message": "how are you?"}, schema, None)
    assert chatty.actions == []  # type: ignore[attr-defined]
    not_allowed = gw.run(
        "twin.chat",
        {**base, "message": "add music", "allowed_actions": ["tighten_pauses"]},
        schema,
        None,
    )
    assert not_allowed.actions == []  # type: ignore[attr-defined]
    no_clip = gw.run("twin.chat", {**base, "scope": {}}, schema, None)
    assert no_clip.actions == []  # type: ignore[attr-defined]


def test_twin_schema_drops_unknown_actions() -> None:
    out = TwinChatOutput.model_validate(
        {
            "reply": "ok",
            "actions": [
                {"type": "delete_everything"},
                {"type": "toggle_music", "params": {"on": True}},
                "junk",
            ],
        }
    )
    assert [a.type for a in out.actions] == ["toggle_music"]
    assert TwinChatOutput.model_validate({"reply": "x", "actions": "bad"}).actions == []


def test_mock_sponsor_respects_do_not_say_and_cta() -> None:
    out = Gateway().run(
        "sponsors.integration",
        SAMPLES["sponsors.integration"],
        TASK_SCHEMAS["sponsors.integration"],
        None,
    )
    slot = out.slots[0]  # type: ignore[attr-defined]
    assert slot.slot_id == "sl1" and "Acme" in slot.integration_script
    assert (
        slot.integration_script.endswith("Use code CREATOR.") and len(slot.lower_third.split()) <= 6
    )


def test_mock_review_cites_inputs_and_insights_avoid_duplicates() -> None:
    review = Gateway().run(
        "director.review", SAMPLES["director.review"], TASK_SCHEMAS["director.review"], None
    )
    assert [i.at_sec for i in review.issues][:1] == [134.0]  # type: ignore[attr-defined]
    ideas = Gateway().run(
        "insights.narrate_ideas",
        SAMPLES["insights.narrate_ideas"],
        TASK_SCHEMAS["insights.narrate_ideas"],
        None,
    )
    assert len(ideas.narrative) == 3  # type: ignore[attr-defined]
    assert "editing: the question version" not in [i.title for i in ideas.ideas]  # type: ignore[attr-defined]
