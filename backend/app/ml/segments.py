"""Transcript segmenting (Plan.md section 8.3).

``segments_from_words`` accumulates words and closes a segment when
  (a) the word ends with ``.``, ``?`` or ``!`` and the segment is at least ``min_len`` long,
  (b) the segment reaches ``max_len``, or
  (c) the gap to the next word is >= ``GAP_SEC`` and the segment is at least ``GAP_MIN_LEN`` long.
Segments shorter than ``TINY_SEC`` are then merged into a neighbour.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

GAP_SEC = 1.2
GAP_MIN_LEN = 2.0
TINY_SEC = 2.0
SENTENCE_END = (".", "?", "!")


@dataclass
class _Seg:
    words: list[dict[str, Any]]

    @property
    def start(self) -> float:
        return float(self.words[0]["start"])

    @property
    def end(self) -> float:
        return float(self.words[-1]["end"])

    @property
    def length(self) -> float:
        return self.end - self.start


def _word_dict(w: Any) -> dict[str, Any]:
    if isinstance(w, dict):
        return {"word": str(w["word"]), "start": float(w["start"]), "end": float(w["end"])}
    return {"word": str(w.word), "start": float(w.start), "end": float(w.end)}


def segments_from_words(
    words: list[Any], min_len: float = 4.0, max_len: float = 20.0
) -> list[dict[str, Any]]:
    """Group timed words into ``[{idx, start, end, text, words}]`` segments.

    ``words`` may be dicts (``word/start/end``) or objects with those attributes.
    """
    items = [_word_dict(w) for w in words if str(_get(w, "word")).strip()]
    groups: list[_Seg] = []
    current: list[dict[str, Any]] = []
    for i, word in enumerate(items):
        current.append(word)
        seg = _Seg(current)
        gap = items[i + 1]["start"] - word["end"] if i + 1 < len(items) else None
        ends_sentence = word["word"].rstrip().endswith(SENTENCE_END)
        if (
            (ends_sentence and seg.length >= min_len)
            or seg.length >= max_len
            or (gap is not None and gap >= GAP_SEC and seg.length >= GAP_MIN_LEN)
        ):
            groups.append(seg)
            current = []
    if current:
        groups.append(_Seg(current))
    groups = _merge_tiny(groups)
    return [
        {
            "idx": idx,
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": " ".join(w["word"].strip() for w in seg.words).strip(),
            "words": seg.words,
        }
        for idx, seg in enumerate(groups)
    ]


def _get(w: Any, key: str) -> Any:
    return w.get(key) if isinstance(w, dict) else getattr(w, key, "")


def _merge_tiny(groups: list[_Seg]) -> list[_Seg]:
    """Merge every segment shorter than ``TINY_SEC`` into its neighbour (previous, else next)."""
    out = list(groups)
    i = 0
    while i < len(out) and len(out) > 1:
        if out[i].length < TINY_SEC:
            if i > 0:
                out[i - 1] = _Seg(out[i - 1].words + out[i].words)
                del out[i]
                continue
            out[i + 1] = _Seg(out[i].words + out[i + 1].words)
            del out[i]
            continue
        i += 1
    return out
