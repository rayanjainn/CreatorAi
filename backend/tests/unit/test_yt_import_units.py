"""YouTube import pieces that need no network: link parsing, caption conversion, error mapping,
and the shape of the video search (HTTP replaced by a recorded-style reply)."""

from __future__ import annotations

import itertools
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.errors import AppError
from app.integrations import websearch, ytdlp


@pytest.mark.parametrize(
    ("url", "vid"),
    [
        ("https://www.youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw"),
        ("https://youtube.com/watch?feature=share&v=jNQXAC9IVRw&t=3", "jNQXAC9IVRw"),
        ("https://youtu.be/jNQXAC9IVRw?si=x", "jNQXAC9IVRw"),
        ("https://www.youtube.com/shorts/abcdefghijk", "abcdefghijk"),
        ("https://m.youtube.com/embed/abc_def-hij", "abc_def-hij"),
        ("https://www.youtube.com/@somechannel", None),
        ("https://www.youtube.com/playlist?list=PL123", None),
        ("https://vimeo.com/12345", None),
        ("", None),
    ],
)
def test_youtube_id(url: str, vid: str | None) -> None:
    assert websearch.youtube_id(url) == vid


def test_canonical_url_rejects_other_sites() -> None:
    assert ytdlp.canonical_url("https://youtu.be/jNQXAC9IVRw") == (
        "https://www.youtube.com/watch?v=jNQXAC9IVRw"
    )
    with pytest.raises(AppError) as err:
        ytdlp.canonical_url("http://127.0.0.1:8000/secret")
    assert err.value.code == "VALIDATION_ERROR"


def test_json3_auto_captions_become_word_times() -> None:
    doc = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 2000, "segs": [
                {"utf8": "hello", "tOffsetMs": 0}, {"utf8": " world", "tOffsetMs": 600}]},
            {"tStartMs": 1500, "dDurationMs": 10, "aAppend": 1, "segs": [{"utf8": "\n"}]},
            {"tStartMs": 2000, "dDurationMs": 1500, "segs": [{"utf8": "again", "tOffsetMs": 0}]},
        ]
    }  # fmt: skip
    words = ytdlp.json3_words(doc)
    assert [w["word"] for w in words] == ["hello", "world", "again"]
    assert words[0] == {"word": "hello", "start": 0.0, "end": 0.6}
    assert words[1]["start"] == 0.6 and words[1]["end"] == 2.0
    assert all(a["end"] <= b["start"] for a, b in itertools.pairwise(words))


def test_json3_subtitle_lines_are_spread_over_the_cue() -> None:
    doc = {
        "events": [
            {"tStartMs": 1000, "dDurationMs": 2000, "segs": [{"utf8": "one two three four"}]}
        ]
    }
    words = ytdlp.json3_words(doc)
    assert [w["word"] for w in words] == ["one", "two", "three", "four"]
    assert words[0]["start"] == 1.0 and words[-1]["end"] == 3.0
    assert ytdlp.json3_words({}) == []


@pytest.mark.parametrize(
    ("message", "code"),
    [
        ("ERROR: [youtube] x: Sign in to confirm your age", "YT_LOGIN_REQUIRED"),
        ("ERROR: [youtube] x: Sign in to confirm you're not a bot", "YT_LOGIN_REQUIRED"),
        ("ERROR: [youtube] x: Private video", "YT_UNAVAILABLE"),
        ("ERROR: [youtube] x: Video unavailable", "YT_UNAVAILABLE"),
        ("ERROR: unable to download video data: HTTP Error 403", "YT_DOWNLOAD_FAILED"),
    ],
)
def test_download_errors_are_explained(message: str, code: str) -> None:
    err = ytdlp._error(Exception(message))
    assert err.code == code and err.message and "reason" in err.details


def test_length_limit() -> None:
    s = Settings(YT_IMPORT_MAX_SEC=600, _env_file=None)  # type: ignore[call-arg]
    info = ytdlp.VideoInfo("abcdefghijk", "u", "t", None, 601.0, None, False, False)
    with pytest.raises(AppError) as err:
        ytdlp.check_length(info, s)
    assert err.value.code == "YT_TOO_LONG" and err.value.details["max_sec"] == 600
    ytdlp.check_length(ytdlp.VideoInfo("abcdefghijk", "u", "t", None, 600.0, None, False, False), s)


def _reply(monkeypatch: pytest.MonkeyPatch, payload: dict[str, Any]) -> list[dict[str, Any]]:
    sent: list[dict[str, Any]] = []

    def fake_post(url: str, **kw: Any) -> httpx.Response:
        sent.append({"url": url, **kw})
        return httpx.Response(200, json=payload, request=httpx.Request("POST", url))

    monkeypatch.setattr(websearch.httpx, "post", fake_post)
    return sent


def test_serper_video_search_keeps_only_youtube_videos(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = _reply(
        monkeypatch,
        {
            "videos": [
                {"title": "Edit faster", "link": "https://www.youtube.com/watch?v=R9Uu0JtvyMg",
                 "snippet": "s", "duration": "10:30", "channel": "Ed", "date": "2 days ago"},
                {"title": "dup", "link": "https://youtu.be/R9Uu0JtvyMg"},
                {"title": "Not youtube", "link": "https://vimeo.com/1"},
                {"title": "Long", "link": "https://www.youtube.com/watch?v=ds7DDgGgiVs", "duration": "1:02:03"},
                {"title": "", "link": "https://www.youtube.com/watch?v=EEV3E2U0keQ"},
            ]
        },
    )  # fmt: skip
    s = Settings(SEARCH_PROVIDER="serper", SERPER_API_KEY="k", _env_file=None)  # type: ignore[call-arg]
    out = websearch.search_videos("editing", 5, settings=s)
    assert sent[0]["url"].endswith("/videos") and sent[0]["headers"]["x-api-key"] == "k"
    assert [r["video_id"] for r in out] == ["R9Uu0JtvyMg", "ds7DDgGgiVs"]
    assert out[0]["duration_sec"] == 630 and out[1]["duration_sec"] == 3723
    assert out[0]["url"] == "https://www.youtube.com/watch?v=R9Uu0JtvyMg"
    assert out[0]["channel"] == "Ed"


def test_tavily_video_search_is_limited_to_youtube(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = _reply(
        monkeypatch,
        {
            "results": [
                {"title": "T", "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "content": "c"}
            ]
        },
    )
    s = Settings(SEARCH_PROVIDER="tavily", TAVILY_API_KEY="k", _env_file=None)  # type: ignore[call-arg]
    out = websearch.search_videos("zoo", 3, settings=s)
    assert sent[0]["json"]["include_domains"] == ["youtube.com", "youtu.be"]
    assert out == [
        {"video_id": "jNQXAC9IVRw", "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
         "title": "T", "snippet": "c", "channel": None, "duration_sec": None, "published": None}
    ]  # fmt: skip


def test_video_search_without_a_key_says_how_to_fix_it() -> None:
    s = Settings(SEARCH_PROVIDER="serper", SERPER_API_KEY="", _env_file=None)  # type: ignore[call-arg]
    with pytest.raises(AppError) as err:
        websearch.search_videos("x", settings=s)
    assert err.value.code == "SEARCH_NOT_CONFIGURED" and "SERPER_API_KEY" in err.value.message
