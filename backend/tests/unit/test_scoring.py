"""Clip windows, features, normalisation, weights, NMS (Plan 8.8) and face helpers."""

from __future__ import annotations

import pytest

from app.ml import faces, scoring
from app.ml.scoring import Seg, Window


def segs(*spec: tuple[float, float, str]) -> list[Seg]:
    return [Seg(s, e, t) for s, e, t in spec]


def test_windows_start_after_sentence_ends_and_close_at_first_boundary_over_min() -> None:
    s = segs(
        (0, 8, "Intro line."),  # ends a sentence
        (8, 16, "second part, still going"),  # previous ended a sentence: may start here
        (16, 24, "third part."),  # previous did not end a sentence: no window starts here
        (24, 32, "fourth part."),
        (32, 40, "fifth part."),
    )
    found = scoring.candidate_windows(s, min_sec=20, max_sec=45)
    assert [(w.first, w.last) for w in found] == [(0, 2), (1, 3)]
    # window 0 closes at the first boundary >= 20 s (segment 2 ends at 24), not later
    assert (found[0].start, found[0].end) == (0, 24)
    assert all(20 <= w.duration <= 45 for w in found)
    assert all(w.first == 0 or s[w.first - 1].text.endswith(".") for w in found)


def test_window_that_cannot_close_within_max_is_dropped() -> None:
    s = segs((0, 30, "A long monologue."), (30, 60, "More of it."))
    # first boundary >= 20 s is 30 s <= 45 -> ok; but a 50 s first segment cannot close
    assert [(w.first, w.last) for w in scoring.candidate_windows(s)] == [(0, 0), (1, 1)]
    assert scoring.candidate_windows(segs((0, 50, "Too long."), (50, 52, "Tail."))) == []


def test_fallback_lowers_the_minimum_for_short_footage() -> None:
    short = segs((0, 2, "Hello there."), (2, 5, "More words."), (5, 9, "The end."))
    assert scoring.candidate_windows(short) == []
    relaxed = scoring.windows_with_fallback(short)
    assert relaxed and relaxed[0].relaxed_min == 6.0
    assert scoring.windows_with_fallback(segs((0, 1.0, "Hi."))) == []


def test_feature_formulas() -> None:
    assert scoring.speech_rate_score(27, 10) == pytest.approx(1.0)  # 2.7 words/s
    assert scoring.speech_rate_score(0, 10) == pytest.approx(1 - min(1, 2.7 / 1.5))
    assert scoring.speech_rate_score(15, 10) == pytest.approx(1 - 1.2 / 1.5)
    assert scoring.mean_energy([-40, -30, -20, -10], 0.5, 1.5) == pytest.approx(-25)
    assert scoring.mean_energy([], 0, 1) is None
    assert scoring.shots_in([(0, 5), (5, 12), (12, 20)], 4, 13) == 3
    assert scoring.emphasis("I absolutely love this! It is terrible.") > scoring.emphasis(
        "The table is here."
    )
    assert scoring.emphasis("") == 0.0


def test_minmax_and_constant_series() -> None:
    assert scoring.minmax([2, 4, 6]) == [0.0, 0.5, 1.0]
    assert scoring.minmax([3, 3]) == [0.5, 0.5]
    assert scoring.minmax([]) == []


def window(start: float, end: float, text: str = "words here.", **raw: float | None) -> Window:
    w = Window(0, 0, start, end, text)
    base: dict[str, float | None] = {
        "beat_similarity": 0.0,
        "hook_signals": 0.0,
        "speech_rate": 0.0,
        "audio_energy": -30.0,
        "emphasis": 0.0,
        "visual_change": 0.0,
    }
    w.raw = {**base, **raw}
    return w


def test_weights_and_score_with_all_features() -> None:
    a = window(
        0,
        25,
        beat_similarity=1.0,
        hook_signals=1.0,
        speech_rate=1.0,
        audio_energy=-10.0,
        emphasis=1.0,
        visual_change=1.0,
    )
    b = window(30, 55)
    weights = scoring.score_windows([a, b])
    assert weights == pytest.approx(scoring.WEIGHTS) and sum(weights.values()) == pytest.approx(1.0)
    assert a.score == pytest.approx(1.0) and b.score == pytest.approx(0.0)
    c = window(60, 85, beat_similarity=0.5)
    scoring.score_windows([a, b, c])
    assert c.score == pytest.approx(0.30 * 0.5)


def test_weights_are_redistributed_without_a_script_or_energy() -> None:
    a = window(0, 25, beat_similarity=None, hook_signals=1.0)
    b = window(30, 55, beat_similarity=None)
    weights = scoring.score_windows([a, b])
    assert "beat_similarity" not in weights and sum(weights.values()) == pytest.approx(1.0)
    assert weights["hook_signals"] == pytest.approx(0.20 / 0.70)
    # constant features map to 0.5; only the hook feature separates the two windows
    assert a.score == pytest.approx(0.20 / 0.70 + 0.5 * (1 - 0.20 / 0.70), abs=1e-4)
    assert b.score == pytest.approx(0.5 * (1 - 0.20 / 0.70), abs=1e-4)
    nothing = window(0, 25, audio_energy=None, beat_similarity=None)
    assert "audio_energy" not in scoring.score_windows(
        [nothing, window(30, 55, audio_energy=None, beat_similarity=None)]
    )
    assert scoring.effective_weights([]) == {}
    assert scoring.score_windows([]) == {}


def test_nms_keeps_best_and_drops_overlaps_over_threshold() -> None:
    w1, w2, w3, w4 = (Window(0, 0, s, e, "t") for s, e in [(0, 30), (5, 35), (28, 58), (70, 100)])
    for w, sc in zip((w1, w2, w3, w4), (0.9, 0.95, 0.5, 0.4), strict=True):
        w.score = sc
    kept = scoring.nms([w1, w2, w3, w4])
    # w2 first; w1 overlaps it (IoU 25/35 > .3); w3 overlaps w2 by 7/53 < .3; w4 apart
    assert [(w.start, w.end) for w in kept] == [(5, 35), (28, 58), (70, 100)]
    assert len(scoring.nms([w1, w2, w3, w4], top_k=1)) == 1
    assert scoring.iou((0, 10), (10, 20)) == 0.0 and scoring.iou((0, 10), (0, 10)) == 1.0
    assert scoring.iou((0, 10), (5, 15)) == pytest.approx(5 / 15)


def test_fallback_copy_rules() -> None:
    text = "Why do most edits feel slow and boring to every viewer? Because pauses pile up fast."
    copy = scoring.fallback_copy(text)
    assert copy["title"] == "Why do most edits feel slow and boring"
    assert copy["hook"] == "Why do most edits feel slow and boring to every viewer?"
    assert copy["caption"] == text[:150] and len(copy["caption"]) <= 150
    assert scoring.fallback_copy("") == {"title": "", "hook": "", "caption": ""}


# ── faces ────────────────────────────────────────────────────────────────────────────────────
def test_face_helpers() -> None:
    assert faces.largest_face_center([], 100) is None
    assert faces.largest_face_center([(10, 0, 20, 20), (60, 0, 30, 30)], 100) == pytest.approx(0.75)
    assert faces.median_crop([0.2, 0.9, 0.3]) == 0.3
    assert faces.median_crop([]) == 0.5
    assert faces.sample_times(2.0, 5.0) == [2.0, 3.0, 4.0]
    assert faces.sample_times(1.0, 1.4) == [1.0]
    assert faces.sample_times(3.0, 3.0) == [3.0]


def test_crop_x_defaults_to_half_for_unreadable_or_faceless_video(
    tiny_media: object, tmp_path
) -> None:  # type: ignore[no-untyped-def]
    assert faces.crop_x_for_ranges(tmp_path / "missing.mp4", [(0, 2), (2, 4)]) == [0.5, 0.5]
    video = tiny_media.video  # type: ignore[attr-defined]
    assert faces.crop_x_for_ranges(video, [(0, 2), (2, 4)]) == [0.5, 0.5]  # no faces in colour bars


def test_crop_x_uses_the_median_of_detected_face_centres(
    tiny_media: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeCascade:
        calls = 0

        def empty(self) -> bool:
            return False

        def detectMultiScale(self, gray, **kwargs):  # type: ignore[no-untyped-def]
            FakeCascade.calls += 1
            width = gray.shape[1]
            assert kwargs["scaleFactor"] == 1.1 and kwargs["minNeighbors"] == 5
            assert kwargs["minSize"][0] == max(8, gray.shape[0] // 10)
            # a big face at 75 % of the frame and a small decoy on the left
            return [(0, 0, 10, 10), (int(width * 0.75) - 20, 5, 40, 40)]

    monkeypatch.setattr(faces, "_cascade", lambda: FakeCascade())
    out = faces.crop_x_for_ranges(tiny_media.video, [(0, 3), (4, 6)])  # type: ignore[attr-defined]
    assert out == [pytest.approx(0.75, abs=0.01)] * 2
    assert FakeCascade.calls == 5  # once per second per range (3 + 2)
