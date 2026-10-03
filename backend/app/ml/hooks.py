"""Hook signals and hook classification (Plan.md section 8.6). Pure functions, no I/O.

``hook_signals`` scores how hook-like the *first sentence* of a text is (0 to 1) and
``classify_hook`` buckets it into ``question | number | story | bold_claim | other``.
Both ignore a leading ``[MOCK]`` marker so mock output is scored like the text it imitates.
"""

from __future__ import annotations

import re

QUESTION_STARTS = ("why", "how", "what", "did", "do", "are", "is", "can")
NUMBER_WORDS = frozenset(
    """
    zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen
    fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty
    ninety hundred thousand million billion dozen
    """.split()
)
STORY_STARTS = ("i ", "my ", "when i", "last year")
HOOK_MIN_WORDS, HOOK_MAX_WORDS = 6, 22

_MOCK = re.compile(r"^\s*\[MOCK\]\s*", re.IGNORECASE)
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’-]*")
# Plural forms of "secret" and "mistake" count as the listed power words.
_POWER = re.compile(
    r"\b(?:never|nobody|secrets?|mistakes?|stop|truth|biggest|worst|best|only|how i)\b",
    re.IGNORECASE,
)


def first_sentence(text: str) -> str:
    """First sentence of ``text`` (leading ``[MOCK]`` marker and whitespace removed)."""
    cleaned = _MOCK.sub("", text or "").strip()
    if not cleaned:
        return ""
    return _SENTENCE_END.split(cleaned, maxsplit=1)[0].strip()


def _is_question(sentence: str) -> bool:
    if sentence.endswith("?"):
        return True
    words = _WORD.findall(sentence.lower())
    return bool(words) and words[0] in QUESTION_STARTS


def _has_number(sentence: str) -> bool:
    if any(ch.isdigit() for ch in sentence):
        return True
    return any(w in NUMBER_WORDS for w in _WORD.findall(sentence.lower()))


def _has_power_word(sentence: str) -> bool:
    return _POWER.search(sentence) is not None


def _is_story(sentence: str) -> bool:
    low = sentence.lower().lstrip()
    return low.startswith(STORY_STARTS)


def hook_signals(text: str) -> float:
    """Average of four booleans on the first sentence, in ``[0, 1]``.

    1. question: ends with ``?`` or starts with why/how/what/did/do/are/is/can;
    2. a digit or number word; 3. a power word (never, nobody, secret, mistake, stop, truth,
    biggest, worst, best, only, how i); 4. length between 6 and 22 words.
    """
    sentence = first_sentence(text)
    if not sentence:
        return 0.0
    n_words = len(_WORD.findall(sentence))
    checks = (
        _is_question(sentence),
        _has_number(sentence),
        _has_power_word(sentence),
        HOOK_MIN_WORDS <= n_words <= HOOK_MAX_WORDS,
    )
    return sum(checks) / len(checks)


def classify_hook(text: str) -> str:
    """First match wins: ``question`` > ``number`` > ``story`` > ``bold_claim`` > ``other``."""
    sentence = first_sentence(text)
    if not sentence:
        return "other"
    if _is_question(sentence):
        return "question"
    if _has_number(sentence):
        return "number"
    if _is_story(sentence):
        return "story"
    if _has_power_word(sentence):
        return "bold_claim"
    return "other"
