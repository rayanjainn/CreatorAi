"""Sidecar transcript parsing (words.json, SRT, VTT) and provenance combining."""

from __future__ import annotations

import json

import pytest

from app.errors import AppError
from app.ml.transcripts import detect_format, parse_sidecar
from app.schemas.common import Provenance, weakest

SRT = """1
00:00:01,000 --> 00:00:03,500
Hello <i>there</i>,
friend.

2
00:00:04,000 --> 00:00:06,000
Second cue.
"""
VTT = """WEBVTT

NOTE a comment

00:01.000 --> 00:03.000 align:start
First cue

00:00:04.000 --> 00:00:05.500
Second <c.x>cue</c>
"""


def test_words_json_object_and_list_forms() -> None:
    body = {
        "language": "en",
        "words": [{"word": "b", "start": 1, "end": 2}, {"text": "a", "s": 0, "e": 0.5}],
    }
    parsed = parse_sidecar(json.dumps(body))
    assert [w.word for w in parsed.transcript.words] == ["a", "b"]  # sorted by start
    assert parsed.source == "user" and parsed.transcript.language == "en"
    assert not parsed.transcript.words_estimated
    as_list = parse_sidecar(json.dumps(body["words"]))
    assert len(as_list.transcript.words) == 2


def test_words_json_declares_demo_provenance() -> None:
    parsed = parse_sidecar(
        json.dumps({"provenance": "demo", "words": [{"word": "x", "start": 0, "end": 1}]})
    )
    assert parsed.source == "demo"


@pytest.mark.parametrize(
    "bad",
    [
        "not json",
        "{}",
        '{"words": []}',
        '{"words": [{"word": "x", "start": "a", "end": 1}]}',
        '{"words": [{"word": " ", "start": 0, "end": 1}]}',
        '{"words": [{"word": "x", "start": -1, "end": 1}]}',
        '{"words": ["str"]}',
        "garbage with no cues",
    ],
)
def test_invalid_transcripts_raise_validation_error(bad: str) -> None:
    with pytest.raises(AppError) as exc:
        parse_sidecar(bad)
    assert exc.value.code == "VALIDATION_ERROR"


def test_srt_cues_strip_markup_and_estimate_words() -> None:
    parsed = parse_sidecar(SRT)
    t = parsed.transcript
    assert parsed.format == "srt" and t.words_estimated
    assert [(s.start, s.end, s.text) for s in t.segments] == [
        (1.0, 3.5, "Hello there, friend."),
        (4.0, 6.0, "Second cue."),
    ]
    assert t.words[0].start == 1.0 and t.words[-1].end == pytest.approx(6.0)


def test_vtt_short_and_long_timestamps() -> None:
    parsed = parse_sidecar(VTT)
    assert parsed.format == "vtt"
    assert [(s.start, s.end, s.text) for s in parsed.transcript.segments] == [
        (1.0, 3.0, "First cue"),
        (4.0, 5.5, "Second cue"),
    ]


def test_detect_format() -> None:
    assert detect_format("{}") == "words.json" and detect_format("[]") == "words.json"
    assert detect_format("WEBVTT\n") == "vtt" and detect_format("1\n") == "srt"
    assert (
        detect_format("x", "a.words.json") == "words.json" and detect_format("x", "a.vtt") == "vtt"
    )


def test_weakest_provenance_ordering() -> None:
    ai = Provenance(source="ai", provider="groq", model="m")
    assert weakest([]) is None and weakest([None]) is None
    assert weakest([ai, Provenance.user()]) == ai
    assert weakest([ai, Provenance.demo()]).source == "demo"  # type: ignore[union-attr]
    assert weakest([Provenance.demo(), Provenance.heuristic()]).source == "heuristic"  # type: ignore[union-attr]
    assert weakest([ai, Provenance(source="mock")]).source == "mock"  # type: ignore[union-attr]
