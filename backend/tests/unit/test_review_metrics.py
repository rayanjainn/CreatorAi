"""Plan 8.7 review metrics with hand-computed expectations."""

from __future__ import annotations

import pytest

from app.ml import review_metrics as rm

SEGMENTS = [
    {"start": 1.0, "end": 8.0, "text": "Why do most creators waste 10 hours editing?"},
    {
        "start": 10.0,
        "end": 40.0,
        "text": "Um, you know, I basically cut everything. Actually it is like simple.",
    },
    {"start": 45.0, "end": 59.0, "text": "Subscribe for more tips."},
]
SILENCES = [(8.0, 11.0), (30.0, 33.5), (40.0, 40.5)]  # the 0.5 s one is below the 0.6 s floor
BEATS = [
    {"scene_idx": 0, "beat_idx": 0, "text": "Open with the problem"},
    {"scene_idx": 0, "beat_idx": 1, "text": "Show the timeline"},
    {"scene_idx": 1, "beat_idx": 0, "text": "Show the export settings"},
    {"scene_idx": 1, "beat_idx": 1, "text": "Wrap up"},
]
MATCHES = [
    {"scene_idx": 0, "beat_idx": 0, "status": "matched"},
    {"scene_idx": 0, "beat_idx": 1, "status": "weak"},
    {"scene_idx": 1, "beat_idx": 0, "status": "missing"},
    {"scene_idx": 1, "beat_idx": 1, "status": "confirmed"},
]
SPANS = [{"asset_id": "a1", "offset": 0.0, "duration": 60.0}]


def _compute(**overrides):
    args = {
        "segments": SEGMENTS,
        "silences": SILENCES,
        "duration": 60.0,
        "beats": BEATS,
        "matches": MATCHES,
        "spans": SPANS,
    }
    return rm.compute_review(**{**args, **overrides})


def test_scores_match_hand_computation() -> None:
    result = _compute()
    s = result["scores"]
    # hook: first sentence "Why do most creators waste 10 hours editing?" -> question, number,
    #       no power word, 8 words = 3/4; speech starts at 1.0 s (<= 2) -> 100 * (0.7*0.75 + 0.3)
    assert s["hook"] == 82.5
    # clarity: 5 fillers in 24 words = 20.8 per 100 -> capped; avg sentence 6 words -> 0.4 * 100
    assert s["clarity"] == 40.0
    # pacing: wpm = 24 / 1 min = 24 (|24-160|/80 capped at 1); silence >= 0.6 s: 3 + 3.5 = 6.5 s
    #         pause ratio 0.10833 -> 0.5 * (1 - 0.43333)
    assert s["pacing"] == 28.3
    # cta: "subscribe" is in the last 20 % (5 of 24 words)
    assert s["cta"] == 100.0
    # coverage: (matched 1 + weak 0.5 + missing 0 + confirmed 1) / 4
    assert s["coverage"] == 62.5
    # overall = .25*82.5 + .20*40 + .20*28.3333 + .25*62.5 + .10*100
    assert result["overall"] == 59.9
    m = result["metrics"]
    assert m["words"] == 24 and m["wpm"] == 24.0
    assert m["fillers"] == 5 and m["fillers_per_100_words"] == pytest.approx(20.83)
    assert m["pause_ratio"] == pytest.approx(0.1083, abs=1e-4)
    assert m["first_speech_sec"] == 1.0
    assert m["cta_found"] is True
    assert m["beat_status_counts"] == {"matched": 1, "weak": 1, "missing": 1, "confirmed": 1}


def test_candidate_issues_follow_the_plan() -> None:
    cands = _compute()["candidates"]
    assert [(c["type"], c.get("at_sec"), c.get("scene_idx")) for c in cands] == [
        ("pacing", 30.0, None),  # longest silence first
        ("pacing", 8.0, None),
        ("coverage", None, 1),  # scene 1: 50 %
        ("coverage", None, 0),  # scene 0: 75 %
        ("clarity", 0.0, None),  # 5 fillers in the first 20 s window
    ]
    assert cands[0]["duration_sec"] == 3.5 and cands[0]["asset_id"] == "a1"
    assert cands[0]["asset_sec"] == 30.0
    assert [c["severity"] for c in cands] == ["medium", "medium", "medium", "low", "medium"]


def test_missing_beats_are_listed() -> None:
    assert _compute()["missing"] == [
        {"scene_idx": 1, "beat_idx": 0, "text": "Show the export settings"}
    ]


def test_coverage_unknown_renormalises_overall() -> None:
    result = _compute(matches=[])
    assert result["scores"]["coverage"] is None
    # (0.25*82.5 + 0.20*40 + 0.20*28.3333 + 0.10*100) / 0.75
    assert result["overall"] == 59.1
    assert result["metrics"]["coverage_known"] is False
    assert result["metrics"]["overall_weights"]["coverage"] == 0.0
    assert not [c for c in result["candidates"] if c["type"] == "coverage"]
    assert result["missing"] == []


def test_no_script_means_no_coverage_either() -> None:
    result = _compute(beats=[], matches=[])
    assert result["scores"]["coverage"] is None


def test_hook_cta_and_silence_candidates() -> None:
    segments = [
        {"start": 5.0, "end": 20.0, "text": "Today we talk about editing software for videos."},
        {"start": 25.0, "end": 55.0, "text": "It has many panels and menus to explore carefully."},
    ]
    result = rm.compute_review(
        segments=segments,
        silences=[(20.0, 25.0), (1.0, 3.0)],  # 5 s (high) and a 2 s one (< 2.5 s: ignored)
        duration=60.0,
        spans=SPANS,
    )
    # hook: no question, no number, no power word, 8 words = 1/4; late start -> 0.6
    assert result["scores"]["hook"] == round(100 * (0.7 * 0.25 + 0.3 * 0.6), 1) == 35.5
    assert result["scores"]["cta"] == 40.0
    kinds = [(c["type"], c["severity"], c["at_sec"]) for c in result["candidates"]]
    assert kinds == [("pacing", "high", 20.0), ("hook", "high", 5.0), ("cta", "medium", 60.0)]


def test_top_three_silences_only() -> None:
    silences = [(float(10 * i), float(10 * i) + 2.6 + i) for i in range(5)]
    cands = rm.compute_review(segments=SEGMENTS, silences=silences, duration=60.0)["candidates"]
    pacing = [c for c in cands if c["type"] == "pacing"]
    assert [c["at_sec"] for c in pacing] == [40.0, 30.0, 20.0]


@pytest.mark.parametrize(
    ("words", "expected"),
    [
        (["um", "uh", "like", "so", "basically", "actually"], 6),
        (["you", "know", "what", "you", "know"], 2),
        (["you", "are", "known"], 0),
        ([], 0),
    ],
)
def test_count_fillers(words: list[str], expected: int) -> None:
    assert rm.count_fillers(words) == expected


def test_cta_phrases_are_whole_words_in_the_tail() -> None:
    assert rm.score_cta("this is the end please follow me".split())[0] == 100.0
    assert rm.score_cta("so here is the thing link in".split())[0] == 100.0
    assert rm.score_cta("following the rules is hard".split())[0] == 40.0  # "following" != follow
    # the phrase exists but not in the last 20 %
    words = ["subscribe"] + ["word"] * 9
    assert rm.score_cta(words)[0] == 40.0


def test_combine_overall_ignores_missing_scores() -> None:
    assert rm.combine_overall({"hook": 100.0, "coverage": None}) == 100.0
    assert rm.combine_overall({}) == 0.0
    scores = {"hook": 80.0, "clarity": 60.0, "pacing": 40.0, "coverage": 20.0, "cta": 100.0}
    assert rm.combine_overall(scores) == pytest.approx(
        0.25 * 80 + 0.2 * 60 + 0.2 * 40 + 0.25 * 20 + 0.1 * 100
    )


def test_hook_window_uses_word_times() -> None:
    segments = [
        {
            "start": 0.0,
            "end": 30.0,
            "text": "Why is it so hard? Because nobody told you the secret.",
            "words": [
                {"word": "Why", "start": 0.2, "end": 0.4},
                {"word": "is", "start": 0.5, "end": 0.6},
                {"word": "it", "start": 0.7, "end": 0.8},
                {"word": "so", "start": 0.9, "end": 1.0},
                {"word": "hard?", "start": 1.1, "end": 1.4},
                {"word": "Because", "start": 20.0, "end": 20.5},
            ],
        }
    ]
    assert rm.speech_in_window(segments, 0, 15) == "Why is it so hard?"


def test_locate_maps_global_seconds_to_assets() -> None:
    spans = [
        {"asset_id": "a", "offset": 0.0, "duration": 30.0},
        {"asset_id": "b", "offset": 30.0, "duration": 20.0},
    ]
    assert rm.locate(spans, 42.5) == ("b", 12.5)
    assert rm.locate(spans, 99.0) == (None, None)
