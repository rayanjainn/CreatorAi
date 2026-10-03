"""Pure script helpers: beat splitting, scene normalisation, hook repair, word-count check."""

from __future__ import annotations

from app.services import script_service as svc


def test_split_beats_groups_short_sentences_in_pairs() -> None:
    text = "One idea here. Another one follows. A third stands alone? Fourth is here."
    assert svc.split_beats(text) == [
        "One idea here. Another one follows.",
        "A third stands alone? Fourth is here.",
    ]


def test_split_beats_keeps_long_sentences_alone() -> None:
    long = " ".join(["word"] * 27) + "."
    beats = svc.split_beats(f"{long} Short one. Another short one.")
    assert beats[0] == long
    assert beats[1] == "Short one. Another short one."


def test_split_beats_handles_empty_and_single() -> None:
    assert svc.split_beats("") == []
    assert svc.split_beats("   ") == []
    assert svc.split_beats("Just one sentence without a full stop") == [
        "Just one sentence without a full stop"
    ]


def test_est_sec_uses_two_and_a_half_words_per_second() -> None:
    assert svc.est_sec(" ".join(["w"] * 25)) == 10.0
    assert svc.est_sec("") == 0.0


def test_normalize_scenes_derives_beats_text_and_estimates() -> None:
    raw = [
        {"title": "Hook", "text": "Stop editing slowly. Do this instead."},
        {
            "title": "Body",
            "intent": "teach",
            "text": "ignored because beats are present",
            "beats": [
                {"idx": 7, "text": "  First   idea. ", "intent": "a", "est_sec": 99},
                {"text": "", "intent": "dropped"},
                {"text": "Second idea.", "intent": ""},
            ],
        },
        {"title": "Empty", "text": ""},
    ]
    scenes = svc.normalize_scenes(raw, intents={"Second idea.": "carried"})
    assert [s["idx"] for s in scenes] == [0, 1]  # the empty scene is dropped
    assert scenes[0]["beats"][0]["text"] == "Stop editing slowly. Do this instead."
    body = scenes[1]
    assert [b["idx"] for b in body["beats"]] == [0, 1]
    assert body["text"] == "First idea. Second idea."
    assert body["beats"][1]["intent"] == "carried"
    assert body["beats"][0]["est_sec"] == 0.8  # 2 words / 2.5
    assert body["est_sec"] == 1.6


def _scenes(*texts: str) -> list[dict]:
    return svc.normalize_scenes([{"title": f"S{i}", "text": t} for i, t in enumerate(texts)])


def test_ensure_hook_keeps_a_verbatim_start() -> None:
    scenes = _scenes("Stop editing slowly. Here is why.")
    fixed, repaired = svc.ensure_hook(scenes, "Stop editing slowly.")
    assert repaired is False and fixed == scenes


def test_ensure_hook_replaces_a_paraphrase_of_the_hook() -> None:
    scenes = _scenes("Stop editing so slowly. Here is why.", "Next scene.")
    fixed, repaired = svc.ensure_hook(scenes, "Stop editing slowly.")
    assert repaired is True
    assert fixed[0]["text"].startswith("Stop editing slowly.")
    assert "so slowly" not in fixed[0]["text"]
    assert fixed[1]["text"] == "Next scene."


def test_ensure_hook_prepends_when_unrelated() -> None:
    scenes = _scenes("Welcome back to the channel everyone.", "Next scene.")
    fixed, repaired = svc.ensure_hook(scenes, "What if editing took ten minutes?")
    assert repaired is True
    assert fixed[0]["beats"][0]["text"] == "What if editing took ten minutes?"
    assert fixed[0]["beats"][0]["intent"] == "hook"
    assert fixed[0]["beats"][1]["text"].startswith("Welcome back")
    assert [b["idx"] for b in fixed[0]["beats"]] == [0, 1]
    assert fixed[0]["text"].startswith("What if editing took ten minutes?")


def test_ensure_hook_ignores_whitespace_differences() -> None:
    scenes = _scenes("Stop   editing slowly. More.")
    assert svc.ensure_hook(scenes, "Stop editing slowly.")[1] is False


def test_word_count_check_is_a_metric_not_an_error() -> None:
    scenes = _scenes(" ".join(["word"] * 100))
    ok = svc.word_count_check(scenes, 40)  # target 100 words
    assert ok == {"words": 100, "target_words": 100, "ratio": 1.0, "within_tolerance": True}
    low = svc.word_count_check(scenes, 80)  # target 200
    assert low["ratio"] == 0.5 and low["within_tolerance"] is False
    edge = svc.word_count_check(scenes, 32)  # target 80 -> 1.25 is still within +-25 %
    assert edge["within_tolerance"] is True


def test_render_body_md() -> None:
    body = svc.render_body_md("My video", _scenes("Hook text.", "Body text."))
    assert body == "# My video\n\n## S0\nHook text.\n\n## S1\nBody text."
