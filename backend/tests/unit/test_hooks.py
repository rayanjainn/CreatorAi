"""Plan 8.6: hook signals (average of four booleans on the first sentence) and classification."""

from __future__ import annotations

import pytest

from app.ml.hooks import classify_hook, first_sentence, hook_signals


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", 0.0),
        ("   ", 0.0),
        # question only (4 words: too short)
        ("Why does ice float?", 0.25),
        # number + power words + length 7; not a question
        ("3 mistakes nobody tells you about editing", 0.75),
        # power word only (3 words)
        ("Stop doing this.", 0.25),
        # all four: starts with how, a digit, "how i", 12 words
        ("How I made 10 videos in a single day without ever stopping!", 1.0),
        # only the FIRST sentence counts
        ("Hello there. Why 5 secrets?", 0.0),
        # number words count, length 7 counts, no question, no power word
        ("Today I will show you three simple tricks", 0.5),
        # starts with an interrogative without a question mark + length 6
        ("What this tool does is amazing", 0.5),
        # 22 words is still fine, 23 is too long (question mark keeps one signal)
        (" ".join(["word"] * 21) + " end?", 0.5),
        (" ".join(["word"] * 22) + " end?", 0.25),
    ],
)
def test_hook_signals(text: str, expected: float) -> None:
    assert hook_signals(text) == pytest.approx(expected)


def test_signals_ignore_the_mock_marker() -> None:
    assert hook_signals("[MOCK] Why does ice float?") == hook_signals("Why does ice float?")
    assert first_sentence("[MOCK] Hi there. Next one.") == "Hi there."


def test_power_word_plurals_and_phrases() -> None:
    assert hook_signals("The secrets of fast editing for everyone") >= 0.5  # secrets + length
    assert hook_signals("This is the best advice") == pytest.approx(0.25)  # only "best"
    # "how i" as a phrase
    assert classify_hook("Here is how i edit") == "bold_claim"


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("Why does ice float?", "question"),
        ("Can you edit faster", "question"),
        ("Is this the end.", "question"),
        ("How I got 10k subscribers", "question"),  # starts with "how": question wins
        ("7 tips for better audio", "number"),
        ("Three things I wish I knew", "number"),
        ("My 3 favourite tools", "number"),  # number beats story
        ("I tried editing for a week", "story"),
        ("My workflow changed overnight", "story"),
        ("When I started, nothing worked", "story"),
        ("Last year was a mess", "story"),
        ("Never trust the default export settings", "bold_claim"),
        ("This is the worst advice online", "bold_claim"),
        ("Editing is fun and rewarding", "other"),
        ("", "other"),
    ],
)
def test_classify_hook(text: str, kind: str) -> None:
    assert classify_hook(text) == kind


def test_classify_uses_first_sentence_only() -> None:
    assert classify_hook("Editing is fun. Why 5 secrets?") == "other"
