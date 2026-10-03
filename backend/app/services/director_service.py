"""AI Director: domain-template plans, shot lists, exports and footage reviews.

Plain Python (no FastAPI). Scores in a review are computed in ``ml/review_metrics`` and are never
taken from the model; the model only writes strengths, ``issues[].fix`` and suggestions, and its
issues are snapped onto the deterministic candidate set (anything else is dropped).
"""

from __future__ import annotations

import csv
import io
import json
import logging
from functools import cache
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.llm import gateway as llm
from app.llm.schemas import DirectorPlan, DirectorReviewOutput
from app.ml import review_metrics as rm
from app.models import Asset, BeatMatch, ContentItem, DirectorOutput
from app.repositories.assets import SegmentRepository
from app.repositories.content import (
    ContentItemRepository,
    DirectorOutputRepository,
    ScriptBeatRepository,
    ScriptRepository,
)
from app.repositories.profiles import ProfileRepository
from app.schemas.common import Provenance, weakest
from app.services.activity import log_activity
from app.services.assets import overall_provenance

log = logging.getLogger(__name__)

DOMAINS_DIR = Path(__file__).resolve().parents[2] / "assets" / "domains"
DOMAINS = ("education", "technology", "entertainment", "lifestyle", "business")
DURATION_TOLERANCE = 0.10
ISSUE_SNAP_SEC = 1.0
MAX_SNIPPETS = 5


# ── domain templates ──────────────────────────────────────────────────────────────────────────
@cache
def load_domain_template(domain: str) -> dict[str, Any]:
    """The JSON template of ``domain`` (structure archetypes, hook styles, pacing, shot kit)."""
    if domain not in DOMAINS:
        raise AppError(
            "VALIDATION_ERROR", f"Unknown domain {domain!r}", details={"domains": DOMAINS}
        )
    path = DOMAINS_DIR / f"{domain}.json"
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def template_for_prompt(domain: str) -> dict[str, Any]:
    t = load_domain_template(domain)
    return {k: t[k] for k in ("summary", "archetypes", "hook_styles", "pacing", "cta_patterns")}


# ── plan post-processing (pure, unit-tested) ──────────────────────────────────────────────────
def fix_durations(
    structure: list[dict[str, Any]], target: float, tolerance: float = DURATION_TOLERANCE
) -> tuple[list[dict[str, Any]], bool]:
    """Make ``sum(duration_sec)`` equal ``target`` when it is further than ``tolerance`` away.

    Within the tolerance the model's numbers are kept. Otherwise every section is scaled by
    ``target / sum`` (equal split when all are zero), rounded to 0.1 s and the rounding drift goes
    to the longest section so the sum is exactly ``target``. Returns ``(structure, adjusted)``.
    """
    rows = [dict(s) for s in structure]
    if not rows or target <= 0:
        return rows, False
    durations = [max(0.0, float(s.get("duration_sec") or 0)) for s in rows]
    total = sum(durations)
    if total > 0 and abs(total - target) <= tolerance * target:
        for row, d in zip(rows, durations, strict=True):
            row["duration_sec"] = round(d, 1)
        return rows, False
    scaled = (
        [d * target / total for d in durations] if total > 0 else [target / len(rows)] * len(rows)
    )
    scaled = [round(d, 1) for d in scaled]
    drift = round(target - sum(scaled), 1)
    biggest = max(range(len(scaled)), key=lambda i: scaled[i])
    scaled[biggest] = round(scaled[biggest] + drift, 1)
    for row, d in zip(rows, scaled, strict=True):
        row["duration_sec"] = d
    return rows, True


def _default_shot(section: str, template: dict[str, Any], scene: int) -> dict[str, Any]:
    kit = template.get("shot_conventions") or []
    match = next((k for k in kit if k["section"].lower() == section.lower()), None)
    if match is None and kit:
        match = kit[min(scene - 1, len(kit) - 1)]
    match = match or {"shot_type": "medium", "framing": "face, eye-level", "b_roll": "", "note": ""}
    return {
        "scene": scene,
        "shot_type": match["shot_type"],
        "framing": match["framing"],
        "b_roll": match.get("b_roll", ""),
        "note": match.get("note") or section,
    }


def fit_shot_list(
    shots: list[dict[str, Any]], structure: list[dict[str, Any]], template: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[int]]:
    """Exactly one shot per structure section, numbered from 1.

    A model entry is used when its ``scene`` number matches (else by position); missing scenes get
    the domain template's convention for that section. Returns ``(shots, filled_scene_numbers)``.
    """
    by_scene = {int(s["scene"]): s for s in shots}
    out: list[dict[str, Any]] = []
    filled: list[int] = []
    for i, section in enumerate(structure):
        scene = i + 1
        src = by_scene.get(scene) or (shots[i] if i < len(shots) else None)
        if src is None:
            out.append(_default_shot(str(section.get("section", "")), template, scene))
            filled.append(scene)
        else:
            out.append({**src, "scene": scene})
    return out, filled


def _plan_provenance(output: DirectorOutput) -> list[Provenance]:
    meta = (output.payload or {}).get("meta") or {}
    return [Provenance.model_validate(p) for p in meta.get("shot_provenance") or []]


def plan_out(output: DirectorOutput) -> dict[str, Any]:
    payload = dict(output.payload or {})
    meta = payload.pop("meta", {}) or {}
    gen = (
        Provenance.model_validate(meta["provenance"])
        if meta.get("provenance")
        else Provenance.user()
    )
    shots = _plan_provenance(output)
    return {
        "id": output.id,
        "content_item_id": output.content_item_id,
        "version": output.version,
        "created_at": output.created_at,
        "plan": payload,
        "inputs": meta.get("inputs", {}),
        "fixups": meta.get("fixups", []),
        "shot_provenance": shots,
        "edited_by_user": meta.get("edited_by_user", {"shot_list": []}),
        "provenance": weakest([gen, *shots]) or gen,
    }


# ── plan flow ─────────────────────────────────────────────────────────────────────────────────
def _require_item(db: Session, workspace_id: str, item_id: str) -> ContentItem:
    return ContentItemRepository(db).require(workspace_id, item_id)


def generate_plan(
    db: Session, workspace_id: str, item_id: str, request: dict[str, Any]
) -> dict[str, Any]:
    item = _require_item(db, workspace_id, item_id)
    profile = ProfileRepository(db).get(workspace_id)
    domain = request.get("domain") or item.domain or profile.domain
    objective = request.get("objective") or item.objective or f"Help viewers with: {item.title}"
    audience = request.get("audience") or profile.audience or "general viewers"
    target = int(request.get("target_duration_sec") or item.target_duration_sec or 45)
    platform = request.get("platform") or (profile.platforms or ["youtube_shorts"])[0]
    template = load_domain_template(domain)
    idea = item.title if not item.idea_text else f"{item.title}. {item.idea_text[:300]}"
    out, meta = llm.run_with_meta(
        "director.plan",
        {
            "idea": idea,
            "objective": objective,
            "platform": platform,
            "target_duration_sec": target,
            "domain": domain,
            "audience": audience,
            "domain_template": template_for_prompt(domain),
        },
        DirectorPlan,
        workspace_id,
        cache=False,
    )
    provenance = meta.provenance
    plan = out.model_dump(mode="json")
    fixups: list[str] = []
    structure, adjusted = fix_durations(plan["structure"], target)
    if adjusted:
        fixups.append(
            f"durations rescaled to the {target}s target (model total was "
            f"{sum(s['duration_sec'] for s in plan['structure']):.1f}s)"
        )
    shots, filled = fit_shot_list(plan["shot_list"], structure, template)
    if filled or len(plan["shot_list"]) != len(structure):
        fixups.append(
            f"shot list fitted to {len(structure)} scenes"
            + (f" (template shots added for scenes {filled})" if filled else "")
        )
    plan.update(
        domain=domain, objective=objective, audience=audience, structure=structure, shot_list=shots
    )
    plan["meta"] = {
        "provenance": provenance.model_dump(),
        "inputs": {"platform": platform, "target_duration_sec": target, "domain": domain},
        "fixups": fixups,
        "shot_provenance": [provenance.model_dump()] * len(shots),
        "edited_by_user": {"shot_list": []},
    }
    repo = DirectorOutputRepository(db)
    row = repo.add(
        workspace_id,
        content_item_id=item.id,
        kind="plan",
        version=repo.next_version(workspace_id, item.id, "plan"),
        payload=plan,
        metrics={"fixups": fixups},
    )
    item.objective, item.domain, item.target_duration_sec = objective, domain, target
    db.flush()
    log_activity(db, workspace_id, "plan_generated", "content_item", item.id,
                 version=row.version, fixups=len(fixups), provider=provenance.provider,
                 source=provenance.source)  # fmt: skip
    return plan_out(row)


def _plan_row(
    db: Session, workspace_id: str, item_id: str, version: int | None = None
) -> DirectorOutput:
    _require_item(db, workspace_id, item_id)
    repo = DirectorOutputRepository(db)
    row = (
        repo.version(workspace_id, item_id, "plan", version)
        if version is not None
        else repo.latest(workspace_id, item_id, "plan")
    )
    if row is None:
        raise AppError("NO_PLAN", "No Director plan yet", details={"content_item_id": item_id})
    return row


def get_plan(
    db: Session, workspace_id: str, item_id: str, version: int | None = None
) -> dict[str, Any]:
    return plan_out(_plan_row(db, workspace_id, item_id, version))


def list_plans(db: Session, workspace_id: str, item_id: str) -> list[dict[str, Any]]:
    _require_item(db, workspace_id, item_id)
    out = []
    for row in DirectorOutputRepository(db).versions(workspace_id, item_id, "plan"):
        info = plan_out(row)
        structure = info["plan"].get("structure", [])
        out.append(
            {
                "id": row.id,
                "version": row.version,
                "created_at": row.created_at,
                "angle": info["plan"].get("angle", ""),
                "duration_sec": round(sum(float(s["duration_sec"]) for s in structure), 1),
                "scenes": len(structure),
                "provenance": info["provenance"],
            }
        )
    return out


def update_shot_list(
    db: Session, workspace_id: str, item_id: str, shot_list: list[dict[str, Any]]
) -> dict[str, Any]:
    """User edits to the latest plan's shot list; changed rows get provenance ``user``."""
    row = _plan_row(db, workspace_id, item_id)
    payload = json.loads(json.dumps(row.payload))
    n_scenes = len(payload.get("structure", []))
    if len(shot_list) != n_scenes:
        raise AppError(
            "VALIDATION_ERROR",
            f"The shot list needs exactly one entry per scene ({n_scenes}), got {len(shot_list)}",
            details={"scenes": n_scenes},
        )
    meta = payload.setdefault("meta", {})
    old = payload.get("shot_list", [])
    old_prov = meta.get("shot_provenance") or [meta.get("provenance")] * n_scenes
    fields = ("shot_type", "framing", "b_roll", "note")
    new_shots, new_prov, edited = [], [], []
    for i, shot in enumerate(shot_list):
        entry = {"scene": i + 1, **{k: shot.get(k, "") for k in fields}}
        same = i < len(old) and all(old[i].get(k, "") == entry[k] for k in fields)
        if same:
            new_prov.append(old_prov[i])
        else:
            new_prov.append(Provenance.user().model_dump())
        if not same:
            edited.append(i + 1)
        new_shots.append(entry)
    previously = set(meta.get("edited_by_user", {}).get("shot_list", []))
    payload["shot_list"] = new_shots
    meta["shot_provenance"] = new_prov
    meta["edited_by_user"] = {"shot_list": sorted(previously | set(edited))}
    row.payload = payload
    db.flush()
    if edited:
        log_activity(db, workspace_id, "plan_edited", "content_item", item_id,
                     version=row.version, scenes=edited)  # fmt: skip
    return plan_out(row)


def export_plan(
    db: Session, workspace_id: str, item_id: str, fmt: str, version: int | None = None
) -> tuple[str, str, str]:
    """``(body, media_type, filename)`` of the plan as CSV or Markdown (provenance included)."""
    row = _plan_row(db, workspace_id, item_id, version)
    info = plan_out(row)
    plan = info["plan"]
    structure, shots = plan.get("structure", []), plan.get("shot_list", [])
    sources = [p.source for p in info["shot_provenance"]] or [info["provenance"].source] * len(
        shots
    )
    if fmt == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            ["scene", "section", "duration_sec", "shot_type", "framing", "b_roll", "note", "source"]
        )
        for i, shot in enumerate(shots):
            sec = structure[i] if i < len(structure) else {}
            writer.writerow(
                [shot["scene"], sec.get("section", ""), sec.get("duration_sec", ""),
                 shot["shot_type"], shot["framing"], shot["b_roll"], shot["note"],
                 sources[i] if i < len(sources) else ""]
            )  # fmt: skip
        return buffer.getvalue(), "text/csv", f"director-plan-v{row.version}.csv"
    prov = info["provenance"]
    lines = [
        f"# Director plan v{row.version}",
        "",
        f"*Source: {prov.source}"
        + (f" ({prov.provider} {prov.model})" if prov.provider else "")
        + "*",
        "",
        f"**Angle:** {plan.get('angle', '')}",
        f"**Objective:** {plan.get('objective', '')}",
        f"**Audience:** {plan.get('audience', '')}  ",
        f"**Domain:** {plan.get('domain', '')}",
        "",
        "## Structure",
        "",
        "| # | Section | Goal | Seconds | Notes |",
        "|---|---|---|---|---|",
    ]
    for i, s in enumerate(structure, start=1):
        lines.append(
            f"| {i} | {_cell(s['section'])} | {_cell(s['goal'])} | {s['duration_sec']} | "
            f"{_cell(s.get('notes', ''))} |"
        )
    lines += ["", "## Shot list", "", "| Scene | Shot | Framing | B-roll | Note | Source |",
              "|---|---|---|---|---|---|"]  # fmt: skip
    for i, shot in enumerate(shots):
        lines.append(
            f"| {shot['scene']} | {_cell(shot['shot_type'])} | {_cell(shot['framing'])} | "
            f"{_cell(shot['b_roll'])} | {_cell(shot['note'])} | "
            f"{sources[i] if i < len(sources) else ''} |"
        )
    if plan.get("storytelling"):
        lines += ["", "## Storytelling", ""] + [f"- {t}" for t in plan["storytelling"]]
    if plan.get("hook_ideas"):
        lines += ["", "## Hook ideas", ""] + [f"- {h}" for h in plan["hook_ideas"]]
    if plan.get("cta"):
        lines += ["", "## Call to action", "", plan["cta"]]
    if plan.get("risks"):
        lines += ["", "## Risks", ""] + [f"- {r}" for r in plan["risks"]]
    return "\n".join(lines) + "\n", "text/markdown", f"director-plan-v{row.version}.md"


def _cell(text: Any) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


# ── review ────────────────────────────────────────────────────────────────────────────────────
def _gather(db: Session, workspace_id: str, item: ContentItem) -> dict[str, Any]:
    """Segments, silences and spans of the item's ready video/audio assets on one timeline."""
    stmt = (
        select(Asset)
        .where(
            Asset.workspace_id == workspace_id,
            Asset.content_item_id == item.id,
            Asset.kind.in_(("video", "audio")),
        )
        .order_by(Asset.created_at, Asset.id)
    )
    assets = list(db.execute(stmt).scalars())
    ready = [a for a in assets if a.status == "ready"]
    pending = [a for a in assets if a.status != "ready"]
    if not ready:
        raise AppError(
            "ASSET_NOT_READY",
            "Upload footage for this item and wait for processing to finish before a review.",
            details={"content_item_id": item.id, "pending_assets": [a.id for a in pending]},
        )
    segments: list[dict[str, Any]] = []
    silences: list[tuple[float, float]] = []
    spans: list[dict[str, Any]] = []
    used: list[dict[str, Any]] = []
    provenances: list[Provenance] = []
    offset = 0.0
    seg_repo = SegmentRepository(db)
    for asset in ready:
        rows = seg_repo.for_asset(workspace_id, asset.id)
        duration = float(asset.duration_sec or max((r.end_sec for r in rows), default=0.0))
        for r in rows:
            segments.append(
                {
                    "start": r.start_sec + offset,
                    "end": r.end_sec + offset,
                    "text": r.text,
                    "asset_id": asset.id,
                    "words": [
                        {**w, "start": float(w["start"]) + offset, "end": float(w["end"]) + offset}
                        for w in (r.words or [])
                    ],
                }
            )
        for s, e in (asset.analysis or {}).get("silences", []):
            silences.append((float(s) + offset, float(e) + offset))
        spans.append({"asset_id": asset.id, "offset": offset, "duration": duration})
        used.append(
            {
                "asset_id": asset.id,
                "filename": asset.filename,
                "offset_sec": round(offset, 2),
                "duration_sec": round(duration, 2),
                "segments": len(rows),
            }
        )
        provenances.append(overall_provenance(asset.analysis or {}))
        offset += duration
    if not segments:
        raise AppError(
            "ASSET_NOT_READY",
            "The footage has no transcript yet, so there is nothing to review.",
            details={"content_item_id": item.id, "reason": "no_transcript"},
        )
    return {
        "segments": segments,
        "silences": silences,
        "spans": spans,
        "duration": offset,
        "used": used,
        "pending": pending,
        "provenance": weakest(provenances),
    }


def _beats_and_matches(
    db: Session, workspace_id: str, item_id: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
    script = ScriptRepository(db).current(workspace_id, item_id)
    if script is None:
        return [], [], False
    beats = ScriptBeatRepository(db).for_script(workspace_id, script.id)
    by_id = {b.id: b for b in beats}
    stmt = select(BeatMatch).where(
        BeatMatch.workspace_id == workspace_id,
        BeatMatch.content_item_id == item_id,
        BeatMatch.script_beat_id.in_(list(by_id) or [""]),
    )
    matches = [
        {
            "scene_idx": by_id[m.script_beat_id].scene_idx,
            "beat_idx": by_id[m.script_beat_id].beat_idx,
            "status": m.status,
            "asset_id": m.asset_id,
            "start_sec": m.start_sec,
            "end_sec": m.end_sec,
        }
        for m in db.execute(stmt).scalars()
    ]
    beat_dicts = [{"scene_idx": b.scene_idx, "beat_idx": b.beat_idx, "text": b.text} for b in beats]
    return beat_dicts, matches, True


def _snippets(
    computed: dict[str, Any], segments: list[dict[str, Any]], beats: list[dict[str, Any]]
) -> list[str]:
    out: list[str] = []
    hook_text = computed["metrics"].get("hook_text", "")
    if hook_text:
        out.append(f"Opening (first 15 s): {hook_text[:220]}")
    silences = [c for c in computed["candidates"] if c["type"] == "pacing"]
    if silences:
        s = max(silences, key=lambda c: c["duration_sec"])
        before = [g for g in segments if g["end"] <= s["at_sec"] + 0.5]
        after = [g for g in segments if g["start"] >= s["at_sec"] + s["duration_sec"] - 0.5]
        out.append(
            f"Longest pause ({s['duration_sec']} s at {s['at_sec']} s) between "
            f"'{(before[-1]['text'] if before else '')[:100]}' and "
            f"'{(after[0]['text'] if after else '')[:100]}'"
        )
    for cand in [c for c in computed["candidates"] if c["type"] == "coverage"][:3]:
        text = next((b["text"] for b in beats if b["scene_idx"] == cand["scene_idx"]), "")
        out.append(f"Weakly covered scene {cand['scene_idx']}: {text[:200]}")
    return out[:MAX_SNIPPETS]


def reconcile_issues(
    issues: list[dict[str, Any]], candidates: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], int]:
    """Snap model issues onto the candidate set; drop the ones that match no candidate.

    An issue matches the nearest candidate ``at_sec`` within 1 s, otherwise a candidate with the
    same ``scene_idx`` (same type preferred). Type, severity, ``at_sec`` and ``scene_idx`` are
    taken from the candidate; only ``fix`` comes from the model. One issue per candidate.
    """
    used: set[int] = set()
    out: list[dict[str, Any]] = []
    dropped = 0
    for issue in issues:
        pick: int | None = None
        at = issue.get("at_sec")
        if at is not None:
            near = [
                (abs(float(c["at_sec"]) - float(at)), i)
                for i, c in enumerate(candidates)
                if c.get("at_sec") is not None and i not in used
            ]
            near = [n for n in near if n[0] <= ISSUE_SNAP_SEC]
            if near:
                pick = min(near)[1]
        if pick is None and issue.get("scene_idx") is not None:
            same = [
                i
                for i, c in enumerate(candidates)
                if c.get("scene_idx") == issue["scene_idx"] and i not in used
            ]
            pick = next((i for i in same if candidates[i]["type"] == issue.get("type")), None)
            if pick is None and same:
                pick = same[0]
        if pick is None or not str(issue.get("fix", "")).strip():
            dropped += 1
            continue
        used.add(pick)
        c = candidates[pick]
        out.append(
            {
                "type": c["type"],
                "severity": c["severity"],
                "at_sec": c.get("at_sec"),
                "scene_idx": c.get("scene_idx"),
                "asset_id": c.get("asset_id"),
                "asset_sec": c.get("asset_sec"),
                "fix": str(issue["fix"]).strip(),
            }
        )
    return out, dropped


def review_out(row: DirectorOutput) -> dict[str, Any]:
    payload = row.payload or {}
    meta = payload.get("meta") or {}
    parts = {
        k: Provenance.model_validate(v) for k, v in (meta.get("provenance_by_part") or {}).items()
    }
    overall = (
        Provenance.model_validate(meta["provenance"])
        if meta.get("provenance")
        else Provenance.user()
    )
    return {
        "id": row.id,
        "content_item_id": row.content_item_id,
        "version": row.version,
        "created_at": row.created_at,
        "overall_score": payload.get("overall_score", 0.0),
        "scores": payload.get("scores", {}),
        "strengths": payload.get("strengths", []),
        "issues": payload.get("issues", []),
        "missing_scenes": payload.get("missing_scenes", []),
        "suggestions": payload.get("suggestions", []),
        "metrics": row.metrics or {},
        "warnings": meta.get("warnings", []),
        "assets_used": meta.get("assets_used", []),
        "provenance": overall,
        "provenance_by_part": parts,
    }


def generate_review(db: Session, workspace_id: str, item_id: str) -> dict[str, Any]:
    item = _require_item(db, workspace_id, item_id)
    data = _gather(db, workspace_id, item)
    beats, matches, has_script = _beats_and_matches(db, workspace_id, item.id)
    computed = rm.compute_review(
        segments=data["segments"],
        silences=data["silences"],
        duration=data["duration"],
        beats=beats,
        matches=matches,
        spans=data["spans"],
    )
    warnings: list[dict[str, Any]] = []
    if not has_script:
        warnings.append(
            {"code": "NO_SCRIPT", "message": "No script: coverage and missing scenes are unknown."}
        )
    elif not matches:
        warnings.append(
            {
                "code": "COVERAGE_UNKNOWN",
                "message": "Footage is not matched to the script yet; coverage is left out of "
                "the overall score.",
            }
        )
    if data["pending"]:
        warnings.append(
            {
                "code": "ASSET_NOT_READY",
                "message": f"{len(data['pending'])} asset(s) still processing were left out.",
                "asset_ids": [a.id for a in data["pending"]],
            }
        )

    scores = computed["scores"]
    candidates = computed["candidates"]
    out, meta = llm.run_with_meta(
        "director.review",
        {
            "scores": scores,
            "metrics": {k: v for k, v in computed["metrics"].items() if k != "hook_text"},
            "snippets": _snippets(computed, data["segments"], beats),
            "missing_beats": computed["missing"],
            "issue_candidates": [
                {k: c[k] for k in ("type", "severity", "at_sec", "scene_idx", "detail")}
                for c in candidates
            ],
        },
        DirectorReviewOutput,
        workspace_id,
    )
    llm_prov = meta.provenance
    issues, dropped = reconcile_issues([i.model_dump() for i in out.issues], candidates)
    missing = [
        {**m, "suggestion": f"Shoot or upload footage that shows: {m['text']}"}
        for m in computed["missing"]
    ]
    scores_prov = weakest(
        [Provenance.heuristic("rules"), data["provenance"]]
    ) or Provenance.heuristic("rules")
    parts = {"scores": scores_prov, "text": llm_prov}
    overall_prov = weakest([scores_prov, llm_prov]) or llm_prov
    payload = {
        # Scores always come from code; whatever the model may have said about them is ignored.
        "overall_score": computed["overall"],
        "scores": scores,
        "strengths": [s for s in out.strengths if s.strip()],
        "issues": issues,
        "missing_scenes": missing,
        "suggestions": [s for s in out.suggestions if s.strip()],
        "meta": {
            "provenance": overall_prov.model_dump(),
            "provenance_by_part": {k: v.model_dump() for k, v in parts.items()},
            "dropped_issues": dropped,
            "warnings": warnings,
            "assets_used": data["used"],
        },
    }
    repo = DirectorOutputRepository(db)
    row = repo.add(
        workspace_id,
        content_item_id=item.id,
        kind="review",
        version=repo.next_version(workspace_id, item.id, "review"),
        payload=payload,
        metrics={**computed["metrics"], "candidates": candidates},
    )
    log_activity(db, workspace_id, "review_generated", "content_item", item.id,
                 version=row.version, overall=computed["overall"],
                 provider=llm_prov.provider, source=llm_prov.source)  # fmt: skip
    return review_out(row)


def get_review(
    db: Session, workspace_id: str, item_id: str, version: int | None = None
) -> dict[str, Any]:
    _require_item(db, workspace_id, item_id)
    repo = DirectorOutputRepository(db)
    row = (
        repo.version(workspace_id, item_id, "review", version)
        if version is not None
        else repo.latest(workspace_id, item_id, "review")
    )
    if row is None:
        raise AppError("NOT_FOUND", "No review yet", details={"content_item_id": item_id})
    return review_out(row)


def list_reviews(db: Session, workspace_id: str, item_id: str) -> list[dict[str, Any]]:
    _require_item(db, workspace_id, item_id)
    return [
        {
            "id": r.id,
            "version": r.version,
            "created_at": r.created_at,
            "overall_score": (r.payload or {}).get("overall_score", 0.0),
            "provenance": review_out(r)["provenance"],
        }
        for r in DirectorOutputRepository(db).versions(workspace_id, item_id, "review")
    ]
