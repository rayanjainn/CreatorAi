"""Director helpers: duration fix-up, shot-list fitting, issue snapping, domain templates."""

from __future__ import annotations

import json

import pytest

from app.services import director_service as svc


def _structure(*durations: float) -> list[dict]:
    return [
        {"section": f"S{i}", "goal": "g", "duration_sec": d, "notes": ""}
        for i, d in enumerate(durations)
    ]


def test_durations_within_ten_percent_are_kept() -> None:
    rows, adjusted = svc.fix_durations(_structure(10, 20, 17), 50)  # 47 s = -6 %
    assert adjusted is False
    assert [r["duration_sec"] for r in rows] == [10, 20, 17]


def test_durations_outside_tolerance_are_scaled_to_the_exact_target() -> None:
    rows, adjusted = svc.fix_durations(_structure(10, 20, 30), 90)  # 60 s: -33 %
    assert adjusted is True
    assert [r["duration_sec"] for r in rows] == [15.0, 30.0, 45.0]
    assert sum(r["duration_sec"] for r in rows) == 90


def test_rounding_drift_goes_to_the_longest_section() -> None:
    rows, _ = svc.fix_durations(_structure(1, 1, 1, 10), 45)
    assert sum(r["duration_sec"] for r in rows) == pytest.approx(45.0)
    assert rows[3]["duration_sec"] == max(r["duration_sec"] for r in rows)


def test_all_zero_durations_are_split_equally() -> None:
    rows, adjusted = svc.fix_durations(_structure(0, 0, 0, 0), 40)
    assert adjusted is True
    assert [r["duration_sec"] for r in rows] == [10.0] * 4


def test_negative_durations_count_as_zero_and_empty_is_untouched() -> None:
    rows, _ = svc.fix_durations(_structure(-5, 30), 30)
    assert [r["duration_sec"] for r in rows] == [0.0, 30.0]
    assert svc.fix_durations([], 30) == ([], False)


def test_shot_list_fills_missing_scenes_from_the_template() -> None:
    template = svc.load_domain_template("technology")
    structure = [
        {"section": "Hook", "duration_sec": 5},
        {"section": "Step by step", "duration_sec": 30},
        {"section": "Totally custom", "duration_sec": 10},
    ]
    shots = [{"scene": 1, "shot_type": "wide", "framing": "f", "b_roll": "", "note": "n"}]
    fitted, filled = svc.fit_shot_list(shots, structure, template)
    assert [s["scene"] for s in fitted] == [1, 2, 3]
    assert filled == [2, 3]
    assert fitted[0]["shot_type"] == "wide"
    assert fitted[1]["shot_type"] == "screen recording"  # template shot for "Step by step"
    assert fitted[2]["shot_type"]  # falls back to a positional template shot


def test_shot_list_drops_extras_and_renumbers() -> None:
    template = svc.load_domain_template("education")
    structure = [{"section": "Hook"}, {"section": "Problem"}]
    shots = [
        {"scene": 5, "shot_type": "a", "framing": "", "b_roll": "", "note": ""},
        {"scene": 6, "shot_type": "b", "framing": "", "b_roll": "", "note": ""},
        {"scene": 7, "shot_type": "c", "framing": "", "b_roll": "", "note": ""},
    ]
    fitted, filled = svc.fit_shot_list(shots, structure, template)
    assert [(s["scene"], s["shot_type"]) for s in fitted] == [(1, "a"), (2, "b")]
    assert filled == []


CANDIDATES = [
    {"type": "pacing", "severity": "high", "at_sec": 30.0, "scene_idx": None},
    {"type": "pacing", "severity": "medium", "at_sec": 8.0, "scene_idx": 1},
    {"type": "coverage", "severity": "medium", "at_sec": None, "scene_idx": 2},
    {"type": "cta", "severity": "medium", "at_sec": 60.0, "scene_idx": None},
]


def test_issues_snap_to_candidates_and_take_their_fields() -> None:
    issues = [
        {"type": "whatever", "severity": "low", "at_sec": 30.4, "scene_idx": None, "fix": "Cut it"},
        {"type": "coverage", "severity": "low", "at_sec": None, "scene_idx": 2, "fix": "Reshoot"},
        {"type": "pacing", "severity": "low", "at_sec": 7.5, "scene_idx": None, "fix": "Trim"},
    ]
    out, dropped = svc.reconcile_issues(issues, CANDIDATES)
    assert dropped == 0
    assert [(i["type"], i["severity"], i["at_sec"], i["scene_idx"]) for i in out] == [
        ("pacing", "high", 30.0, None),
        ("coverage", "medium", None, 2),
        ("pacing", "medium", 8.0, 1),
    ]
    assert [i["fix"] for i in out] == ["Cut it", "Reshoot", "Trim"]


def test_invented_timestamps_and_scenes_are_dropped() -> None:
    issues = [
        {"at_sec": 99.0, "scene_idx": None, "fix": "Invented time"},
        {"at_sec": None, "scene_idx": 9, "fix": "Invented scene"},
        {"at_sec": None, "scene_idx": None, "fix": "Cites nothing"},
        {"at_sec": 30.0, "scene_idx": None, "fix": "   "},  # no fix text
    ]
    out, dropped = svc.reconcile_issues(issues, CANDIDATES)
    assert out == [] and dropped == 4


def test_a_candidate_is_used_once() -> None:
    issues = [
        {"at_sec": 30.0, "scene_idx": None, "fix": "first"},
        {"at_sec": 30.2, "scene_idx": None, "fix": "second"},
    ]
    out, dropped = svc.reconcile_issues(issues, CANDIDATES)
    assert [i["fix"] for i in out] == ["first"] and dropped == 1


@pytest.mark.parametrize("domain", svc.DOMAINS)
def test_domain_templates_are_complete(domain: str) -> None:
    t = svc.load_domain_template(domain)
    assert t["domain"] == domain and t["summary"]
    assert len(t["archetypes"]) >= 3 and len(t["hook_styles"]) >= 4
    for archetype in t["archetypes"]:
        assert abs(sum(s["share"] for s in archetype["structure"]) - 1.0) < 1e-6
        assert archetype["structure"][0]["section"]
    assert {"wpm", "max_intro_sec", "cut_every_sec", "pause_max_sec"} <= set(t["pacing"])
    assert len(t["shot_conventions"]) >= 5 and t["cta_patterns"] and t["common_risks"]
    assert json.dumps(svc.template_for_prompt(domain))


def test_unknown_domain_is_rejected() -> None:
    from app.errors import AppError

    with pytest.raises(AppError):
        svc.load_domain_template("cooking")
