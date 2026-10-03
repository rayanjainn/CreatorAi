"""Plan 8.3 segmenting rules, including edge cases."""

from __future__ import annotations

from app.ml.segments import segments_from_words


def w(word: str, start: float, end: float) -> dict[str, object]:
    return {"word": word, "start": start, "end": end}


def run(words: list[dict[str, object]], **kw: float) -> list[dict[str, object]]:
    return segments_from_words(words, **kw)  # type: ignore[arg-type]


def spaced(texts: list[str], step: float = 0.5, start: float = 0.0) -> list[dict[str, object]]:
    return [w(t, start + i * step, start + i * step + step * 0.8) for i, t in enumerate(texts)]


def test_empty_and_blank_words() -> None:
    assert run([]) == []
    assert run([w("  ", 0, 1)]) == []


def test_single_short_word_is_kept() -> None:
    out = run([w("Hi.", 0.0, 0.4)])
    assert len(out) == 1 and out[0]["text"] == "Hi." and out[0]["idx"] == 0


def test_sentence_end_closes_only_after_min_len() -> None:
    # "b." ends at 0.9 s: below min_len, so it does not close; "h." ends at 4.9 s and does.
    first = ["A", "b."] + ["c"] * 7 + ["h."]
    second = [f"n{i}" for i in range(9)] + ["now."]
    out = run(spaced(first + second))
    assert [s["text"] for s in out] == [" ".join(first), " ".join(second)]
    assert out[0]["start"] == 0.0 and out[0]["end"] == 4.9


def test_max_len_closes_long_run_without_punctuation() -> None:
    words = spaced([f"w{i}" for i in range(60)], step=0.5)  # 30 s of unpunctuated speech
    out = run(words)
    assert len(out) >= 2
    assert all(float(s["end"]) - float(s["start"]) <= 20.5 for s in out[:-1])


def test_gap_closes_segment_when_long_enough() -> None:
    first = spaced(["one", "two", "three", "four", "five"], step=0.5)  # 0..2.3
    second = spaced(["six", "seven", "eight", "nine", "ten"], step=0.5, start=5.0)
    out = run(first + second)
    assert len(out) == 2
    assert out[0]["text"] == "one two three four five" and out[1]["start"] == 5.0


def test_gap_ignored_when_segment_too_short_then_tiny_merge() -> None:
    # 1 s of words followed by a 3 s gap: segment < 2 s so the gap rule does not fire, one segment.
    out = run([w("hello", 0, 0.4), w("there", 0.5, 1.0), w("friend", 4.0, 4.5)])
    assert len(out) == 1


def test_tiny_segments_merge_into_previous_neighbour() -> None:
    long_part = spaced(["a"] * 10 + ["end."], step=0.5)  # ends sentence at >= 4 s
    tiny = [w("Ok.", 6.0, 6.3)]  # 0.3 s segment
    out = run(long_part + tiny + spaced(["x"] * 12 + ["done."], step=0.5, start=7.0))
    assert not any(float(s["end"]) - float(s["start"]) < 2.0 for s in out)
    assert "Ok." in out[0]["text"] or "Ok." in out[1]["text"]


def test_leading_tiny_segment_merges_into_next() -> None:
    out = run([w("Yes!", 0.0, 0.3), *spaced(["so"] * 10 + ["it", "works."], step=0.5, start=3.0)])
    assert out[0]["text"].startswith("Yes! so")


def test_indices_are_sequential_and_words_preserved() -> None:
    words = spaced([f"w{i}." if i % 9 == 8 else f"w{i}" for i in range(45)], step=0.5)
    out = run(words)
    assert [s["idx"] for s in out] == list(range(len(out)))
    assert sum(len(s["words"]) for s in out) == 45  # type: ignore[arg-type]


def test_accepts_objects_with_attributes() -> None:
    from app.ml.asr.base import Word

    out = segments_from_words([Word("Hello", 0.0, 0.5), Word("world.", 0.6, 1.2)])
    assert out[0]["text"] == "Hello world." and out[0]["words"][1]["word"] == "world."  # type: ignore[index]
