"""Script-to-footage matching (Plan.md section 8.5): the ``project.match`` job and its API.

Pipeline (job stages load 10 -> embed spans 40 -> align 80 -> save 100):

1. load: the current script's beats and the transcript segments of the item's *ready* video/audio
   assets (upload order). Every asset gets a global offset (sum of earlier durations) so spans of
   different assets share one ordered timeline. Beat embeddings must come from the same embedder as
   the span embeddings: if the script was embedded with another backend/model the beats are
   re-embedded first (``script_service.sync_beats``); mixed backends are never compared.
2. embed spans: 1-4 consecutive segments of one asset while <= 45 s (1-3 when there would be more
   than 3000 spans), texts embedded in batches.
3. align: cosine matrix + monotonic DP (``ml.alignment``), statuses and top-3 alternatives.
4. ambiguity: when the best two spans of a beat are both >= MATCH_OK and closer than 0.03,
   ``match.disambiguate`` (<= 3 beats per run, earliest first) - only with an LLM configured.
5. save: upsert ``beat_matches``; rows the user ``confirmed`` or ``rejected`` are never touched.

Matching is algorithmic: provenance is ``heuristic`` for the hashing embedder and ``ai`` for a
neural one (weakest-of with the disambiguation model when it was used); user decisions are ``user``.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import AppError, not_found
from app.llm import gateway as llm
from app.llm.schemas import MatchDisambiguateOutput
from app.ml.alignment import BeatOutcome, align, ambiguous, classify, compatible
from app.ml.embedder import STOPWORDS, embed_texts, embedder_info, embedder_provenance
from app.ml.review_metrics import beat_credit
from app.ml.vectors import cosine_matrix, unpack_matrix
from app.models import Asset, AssetSegment, BeatMatch, ContentItem, Job, Script, ScriptBeat
from app.repositories.assets import ShotRepository
from app.repositories.content import ScriptBeatRepository, ScriptRepository
from app.schemas.common import Provenance, weakest
from app.security import sign_media
from app.services import script_service
from app.services.activity import log_activity
from app.workers.runner import JOB_HANDLERS, JobContext, enqueue

log = logging.getLogger(__name__)

JOB_TYPE = "project.match"
MAX_SPAN_SEGMENTS = 4
MAX_SPAN_SEC = 45.0
SPAN_LIMIT = 3000
AMBIGUITY_MARGIN = 0.03
MAX_DISAMBIGUATIONS = 3
EMBED_BATCH = 256
ALT_TEXT_CHARS = 240
PRESERVED = ("confirmed", "rejected")
_WORD = re.compile(r"[^\W_]+(?:'[^\W_]+)?", re.UNICODE)


# ── footage ───────────────────────────────────────────────────────────────────────────────────
@dataclass
class Span:
    asset_id: str
    start: float  # asset-local seconds
    end: float
    g_start: float  # global seconds (asset offset + local)
    g_end: float
    text: str


@dataclass
class Footage:
    assets: list[Asset]
    pending: list[str]
    segments: dict[str, list[AssetSegment]]
    offsets: dict[str, float]


def footage_assets(db: Session, workspace_id: str, item_id: str) -> tuple[list[Asset], list[str]]:
    """``(ready video/audio assets in upload order, ids of the ones still processing)``."""
    stmt = (
        select(Asset)
        .where(
            Asset.workspace_id == workspace_id,
            Asset.content_item_id == item_id,
            Asset.kind.in_(("video", "audio")),
        )
        .order_by(Asset.created_at, Asset.id)
    )
    rows = list(db.execute(stmt).scalars())
    ready = [a for a in rows if a.status == "ready"]
    return ready, [a.id for a in rows if a.status in ("uploaded", "processing")]


def load_footage(db: Session, workspace_id: str, item_id: str) -> Footage:
    assets, pending = footage_assets(db, workspace_id, item_id)
    segments: dict[str, list[AssetSegment]] = {}
    offsets: dict[str, float] = {}
    cursor = 0.0
    for asset in assets:
        rows = list(
            db.execute(
                select(AssetSegment)
                .where(AssetSegment.workspace_id == workspace_id, AssetSegment.asset_id == asset.id)
                .order_by(AssetSegment.idx)
            ).scalars()
        )
        segments[asset.id] = rows
        offsets[asset.id] = cursor
        cursor += float(asset.duration_sec or max((r.end_sec for r in rows), default=0.0))
    return Footage(assets, pending, segments, offsets)


def build_spans(
    segments: dict[str, list[tuple[float, float, str]]],
    offsets: dict[str, float],
    max_segments: int = MAX_SPAN_SEGMENTS,
    max_sec: float = MAX_SPAN_SEC,
) -> list[Span]:
    """Spans of 1..``max_segments`` consecutive segments of one asset, <= ``max_sec`` long (a
    single segment is always allowed). ``segments``: ``asset_id -> [(start, end, text)]``."""
    spans: list[Span] = []
    for asset_id, rows in segments.items():
        base = offsets.get(asset_id, 0.0)
        for i, (start, _, _) in enumerate(rows):
            for j in range(i, min(len(rows), i + max_segments)):
                end = rows[j][1]
                if j > i and end - start > max_sec:
                    break
                text = " ".join(r[2].strip() for r in rows[i : j + 1]).strip()
                spans.append(Span(asset_id, start, end, base + start, base + end, text))
    return spans


def build_spans_limited(
    segments: dict[str, list[tuple[float, float, str]]], offsets: dict[str, float]
) -> list[Span]:
    """Plan 8.5 step 2 including the 3000-span cap (then at most 3 segments per span)."""
    spans = build_spans(segments, offsets, MAX_SPAN_SEGMENTS)
    if len(spans) > SPAN_LIMIT:
        spans = build_spans(segments, offsets, MAX_SPAN_SEGMENTS - 1)
    return spans


def timecode(start: float | None, end: float | None) -> str | None:
    if start is None or end is None:
        return None

    def fmt(t: float) -> str:
        total = round(t)
        return f"{total // 60:02d}:{total % 60:02d}"

    return f"{fmt(start)}-{fmt(end)}"


# ── reshoot suggestions (deterministic) ───────────────────────────────────────────────────────
def keywords(texts: list[str], limit: int = 4) -> list[str]:
    counts: Counter[str] = Counter()
    for text in texts:
        for token in _WORD.findall(text.lower()):
            if token not in STOPWORDS and len(token) > 3:
                counts[token] += 1
    return [w for w, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


def reshoot_suggestion(kind: str, title: str, beats: list[str], est_sec: float) -> str:
    """Plain-language next step for a missing/weak scene, built from the beat text only."""
    lead = " ".join(beats[0].split()[:14]) if beats else title
    topics = ", ".join(keywords(beats)) or title
    seconds = max(5, round(est_sec))
    if kind == "missing":
        return (
            f'No footage covers "{title}". Record about {seconds} s saying: "{lead}..." '
            f"and show: {topics}."
        )
    return (
        f'Footage for "{title}" only loosely matches the script. Re-record the weak lines '
        f'(starting "{lead}...") or swap in a better take; make sure you cover: {topics}.'
    )


def scene_report(
    beats: list[dict[str, Any]], scenes: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Missing scenes (every beat missing) and weak scenes (any weak beat), Plan 8.5 step 8.

    ``beats``: ``[{scene_idx, id, text, est_sec, status}]`` (``status`` may be ``unmatched``).
    """
    by_scene: dict[int, list[dict[str, Any]]] = {}
    for beat in beats:
        by_scene.setdefault(beat["scene_idx"], []).append(beat)
    titles = {int(s["idx"]): str(s.get("title") or f"Scene {int(s['idx']) + 1}") for s in scenes}
    missing: list[dict[str, Any]] = []
    weak: list[dict[str, Any]] = []
    for idx in sorted(by_scene):
        rows = by_scene[idx]
        title = titles.get(idx, f"Scene {idx + 1}")
        if rows and all(r["status"] == "missing" for r in rows):
            kind, chosen = "missing", rows
        elif any(r["status"] == "weak" for r in rows):
            kind, chosen = "weak", [r for r in rows if r["status"] == "weak"]
        else:
            continue
        texts = [r["text"] for r in chosen]
        est = round(sum(float(r["est_sec"]) for r in chosen), 1)
        entry = {
            "scene_idx": idx,
            "title": title,
            "kind": kind,
            "beat_ids": [r["id"] for r in chosen],
            "beats": texts,
            "est_sec": est,
            "suggestion": reshoot_suggestion(kind, title, texts, est),
            "provenance": Provenance.heuristic("rules").model_dump(),
        }
        (missing if kind == "missing" else weak).append(entry)
    return missing, weak


def coverage_summary(statuses: list[str], matched_sec: float = 0.0) -> dict[str, Any]:
    counts = Counter(statuses)
    total = len(statuses)
    credit = sum(beat_credit(s) for s in statuses)
    return {
        "total": total,
        "matched": counts["matched"],
        "weak": counts["weak"],
        "missing": counts["missing"],
        "confirmed": counts["confirmed"],
        "rejected": counts["rejected"],
        "unmatched": counts["unmatched"],
        "coverage_pct": round(100 * credit / total, 1)
        if total and len(statuses) > counts["unmatched"]
        else None,
        "matched_sec": round(matched_sec, 1),
    }


# ── enqueue ───────────────────────────────────────────────────────────────────────────────────
def start_match(db: Session, workspace_id: str, item_id: str) -> dict[str, Any]:
    """Validate and enqueue ``project.match`` (``409 NO_SCRIPT`` / ``409 ASSET_NOT_READY``)."""
    item = db.get(ContentItem, item_id)
    if item is None or item.workspace_id != workspace_id:
        raise not_found("Content item")
    script = ScriptRepository(db).current(workspace_id, item_id)
    if script is None or not script.scenes:
        raise AppError("NO_SCRIPT", "Write a script (with scenes) before matching footage.")
    ready, pending = footage_assets(db, workspace_id, item_id)
    has_text = any(
        db.execute(
            select(AssetSegment.id)
            .where(AssetSegment.workspace_id == workspace_id, AssetSegment.asset_id == a.id)
            .limit(1)
        ).first()
        for a in ready
    )
    if not ready or not has_text:
        raise AppError(
            "ASSET_NOT_READY",
            "No processed footage with a transcript is attached to this item yet.",
            details={"pending_assets": pending, "ready_assets": len(ready)},
        )
    if JOB_TYPE not in JOB_HANDLERS:
        raise AppError("INTERNAL_ERROR", "Matching is not available in this build")
    active = db.execute(
        select(Job.id).where(
            Job.workspace_id == workspace_id,
            Job.type == JOB_TYPE,
            Job.entity_id == item_id,
            Job.status.in_(("queued", "running")),
        )
    ).first()
    if active is not None:
        return {"job_id": active[0], "pending_assets": pending}
    db.commit()  # release the read snapshot before the job (inline in tests) writes
    job_id = enqueue(
        JOB_TYPE, "content_item", item_id, {"trigger": "user"}, workspace_id=workspace_id
    )
    return {"job_id": job_id, "pending_assets": pending}


# ── the job ───────────────────────────────────────────────────────────────────────────────────
def _llm_available() -> bool:
    try:
        return llm.get_gateway().data_mode() != "unconfigured"
    except Exception:
        return False


def _ensure_beat_embeddings(
    db: Session, workspace_id: str, script: Script, notes: list[str]
) -> tuple[list[ScriptBeat], bool]:
    """Beats of ``script`` embedded with the *current* embedder (re-embedding if they are not)."""
    info = embedder_info()
    beats = ScriptBeatRepository(db).for_script(workspace_id, script.id)
    stored = (script.meta or {}).get("beats_embedding") or {}
    stale = (stored.get("backend"), stored.get("model")) != (info["backend"], info["model"])
    if stale or any(b.embedding is None for b in beats):
        script_service.sync_beats(db, workspace_id, script)
        db.commit()
        beats = ScriptBeatRepository(db).for_script(workspace_id, script.id)
        notes.append(f"script beats re-embedded with {info['backend']} ({info['model']})")
        if any(b.embedding is None for b in beats):
            raise AppError("INTERNAL_ERROR", "Could not embed the script beats for matching")
        return beats, True
    return beats, False


def _iou(a: Span, b: Span) -> float:
    if a.asset_id != b.asset_id:
        return 0.0
    inter = min(a.end, b.end) - max(a.start, b.start)
    union = max(a.end, b.end) - min(a.start, b.start)
    return inter / union if inter > 0 and union > 0 else 0.0


def _alt_dict(span: Span, score: float, index: int, out_of_order: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {
        "asset_id": span.asset_id,
        "start_sec": round(span.start, 3),
        "end_sec": round(span.end, 3),
        "score": round(float(score), 4),
        "text": span.text[:ALT_TEXT_CHARS],
    }
    if out_of_order and index == 0:
        out["out_of_order"] = True
    return out


def _disambiguate(
    workspace_id: str,
    beat_text: str,
    cands: list[tuple[Span, float]],
) -> tuple[int, float, Provenance] | None:
    payload = [
        {
            "id": f"c{n}",
            "text": span.text[:400],
            "start": round(span.start, 2),
            "end": round(span.end, 2),
        }
        for n, (span, _) in enumerate(cands)
    ]
    try:
        out, meta = llm.run_with_meta(
            "match.disambiguate",
            {"beat_text": beat_text, "candidates": payload},
            MatchDisambiguateOutput,
            workspace_id,
        )
    except Exception as exc:
        log.warning("match.disambiguate failed: %s", exc)
        return None
    chosen = next((n for n, c in enumerate(payload) if c["id"] == out.best_id), None)
    if chosen is None:
        return None
    return chosen, out.confidence, Provenance.from_meta(meta)


def run_match(ctx: JobContext) -> dict[str, Any]:
    """The ``project.match`` handler body (see module docstring)."""
    ws, item_id = ctx.workspace_id, str(ctx.entity_id)
    settings = get_settings()
    notes: list[str] = []
    ctx.progress(0, "load")
    with ctx.session_factory() as db:
        item = db.get(ContentItem, item_id)
        if item is None or item.workspace_id != ws:
            raise AppError("NOT_FOUND", "Content item not found", retryable=False)
        script = ScriptRepository(db).current(ws, item_id)
        if script is None:
            raise AppError("NO_SCRIPT", "Write a script before matching footage.", retryable=False)
        beats, reembedded = _ensure_beat_embeddings(db, ws, script, notes)
        if not beats:
            raise AppError("NO_SCRIPT", "The current script has no beats.", retryable=False)
        footage = load_footage(db, ws, item_id)
        seg_rows = {
            aid: [(r.start_sec, r.end_sec, r.text) for r in rows if r.text.strip()]
            for aid, rows in footage.segments.items()
        }
        if not any(seg_rows.values()):
            raise AppError(
                "ASSET_NOT_READY",
                "The footage has no transcript to match against.",
                retryable=False,
            )
        beat_vecs = unpack_matrix([b.embedding for b in beats])
        beat_info = [(b.id, b.scene_idx, b.beat_idx, b.text) for b in beats]
        asset_names = {a.id: a.filename for a in footage.assets}
        script_id = script.id
        info = embedder_info()
        existing = {
            m.script_beat_id: m.status
            for m in db.execute(
                select(BeatMatch).where(
                    BeatMatch.workspace_id == ws,
                    BeatMatch.script_beat_id.in_([b[0] for b in beat_info]),
                )
            ).scalars()
        }
    if footage.pending:
        notes.append(f"{len(footage.pending)} asset(s) still processing were not matched")
    ctx.progress(10, "load")

    spans = build_spans_limited(seg_rows, footage.offsets)
    if len(spans) > SPAN_LIMIT:
        notes.append(f"{len(spans)} spans after limiting to 3 segments")
    texts = [s.text for s in spans]
    chunks: list[np.ndarray] = []
    for start in range(0, len(texts), EMBED_BATCH):
        chunks.append(embed_texts(texts[start : start + EMBED_BATCH]))
        ctx.progress(10 + 30 * min(1.0, (start + EMBED_BATCH) / max(1, len(texts))), "embed spans")
    span_vecs = np.vstack(chunks) if chunks else np.zeros((0, beat_vecs.shape[1]), dtype=np.float32)
    ctx.progress(40, "embed spans")

    ok_t, weak_t = settings.match_thresholds(info["backend"])
    sim = cosine_matrix(beat_vecs, span_vecs) if len(spans) else np.zeros((len(beats), 0))
    g_start = np.array([s.g_start for s in spans])
    g_end = np.array([s.g_end for s in spans])
    asset_of = [s.asset_id for s in spans]
    path = align(sim, g_start, g_end, weak_t)
    ctx.progress(70, "align")
    outcomes: list[BeatOutcome] = classify(sim, path, g_start, g_end, asset_of, ok_t, weak_t)

    disamb: dict[int, tuple[float, Provenance]] = {}
    ambiguous_beats = [
        o.beat
        for o in outcomes
        if o.span is not None and ambiguous(sim[o.beat], o.alternatives, ok_t, AMBIGUITY_MARGIN)
    ]
    if ambiguous_beats:
        if not _llm_available():
            notes.append(
                f"{len(ambiguous_beats)} ambiguous beat(s) left undecided: no LLM configured"
            )
        else:
            by_beat = {o.beat: o for o in outcomes}
            path_spans = dict(path)
            for bi in ambiguous_beats[:MAX_DISAMBIGUATIONS]:
                out = by_beat[bi]
                cands = [(spans[j], float(sim[bi, j])) for j in out.alternatives[:3]]
                picked = _disambiguate(ws, beat_info[bi][3], cands)
                if picked is None:
                    notes.append(
                        f"match.disambiguate failed for beat {bi}; kept the algorithmic span"
                    )
                    continue
                n, confidence, prov = picked
                new_span = out.alternatives[n]
                if new_span != out.span:
                    if not _fits_order(bi, new_span, path_spans, spans):
                        notes.append(
                            f"LLM preferred another span for beat {bi}; it breaks the order"
                        )
                        continue
                    out.span = new_span
                    out.score = float(sim[bi, new_span])
                    out.status = "matched" if out.score >= ok_t else "weak"
                    path_spans[bi] = new_span
                out.alternatives = [new_span, *[j for j in out.alternatives if j != new_span]]
                disamb[bi] = (confidence, prov)
    ctx.progress(80, "align")

    embed_prov = embedder_provenance()
    saved, preserved = 0, 0
    with ctx.session_factory() as db:
        rows = {
            m.script_beat_id: m
            for m in db.execute(
                select(BeatMatch).where(
                    BeatMatch.workspace_id == ws,
                    BeatMatch.script_beat_id.in_([b[0] for b in beat_info]),
                )
            ).scalars()
        }
        for outcome in outcomes:
            beat_id = beat_info[outcome.beat][0]
            row = rows.get(beat_id)
            if row is not None and row.status in PRESERVED:
                preserved += 1
                continue
            alts = [
                _alt_dict(spans[j], sim[outcome.beat, j], n, outcome.out_of_order)
                for n, j in enumerate(outcome.alternatives)
            ]
            if (
                outcome.out_of_order
                and outcome.span is not None
                and any(
                    _iou(spans[outcome.span], spans[other]) > 0.5
                    for beat_i, other in path
                    if beat_i != outcome.beat
                )
            ):
                alts[0]["shared_span"] = True  # same take as a neighbouring beat (finer beats)
            prov_model = embed_prov
            prov_extra: dict[str, Any] = {}
            if outcome.beat in disamb:
                confidence, dprov = disamb[outcome.beat]
                prov_model = weakest([embed_prov, dprov]) or embed_prov
                prov_extra["disambiguation"] = {
                    "confidence": round(confidence, 2),
                    **dprov.model_dump(),
                }
            values: dict[str, Any] = {
                "content_item_id": item_id,
                "asset_id": spans[outcome.span].asset_id if outcome.span is not None else None,
                "start_sec": round(spans[outcome.span].start, 3)
                if outcome.span is not None
                else None,
                "end_sec": round(spans[outcome.span].end, 3) if outcome.span is not None else None,
                "score": round(outcome.score, 4),
                "status": outcome.status,
                "alternatives": alts,
                "provenance": {
                    **prov_model.model_dump(),
                    "embedder": info["backend"],
                    **prov_extra,
                },
            }
            if row is None:
                db.add(BeatMatch(workspace_id=ws, script_beat_id=beat_id, **values))
            else:
                for key, value in values.items():
                    setattr(row, key, value)
            saved += 1
        counts = Counter(o.status for o in outcomes)
        log_activity(
            db, ws, "match_completed", "content_item", item_id,
            script_id=script_id, matched=counts["matched"], weak=counts["weak"],
            missing=counts["missing"], preserved=preserved, embedder=info["backend"],
        )  # fmt: skip
        db.commit()
    ctx.progress(100, "save")
    ctx.result.update({"notes": notes})
    return {
        "script_id": script_id,
        "beats": len(beats),
        "spans": len(spans),
        "saved": saved,
        "preserved": preserved,
        "counts": dict(Counter(o.status for o in outcomes)),
        "embedder": {
            "backend": info["backend"],
            "model": info["model"],
            "match_ok": ok_t,
            "match_weak": weak_t,
        },
        "reembedded_beats": reembedded,
        "disambiguated": len(disamb),
        "notes": notes,
        "assets": [{"asset_id": a, "filename": asset_names[a]} for a in asset_names],
        "provenance": embed_prov.model_dump(),
        "existing_rows": len(existing),
    }


def _fits_order(beat: int, span: int, path_spans: dict[int, int], spans: list[Span]) -> bool:
    """May ``beat`` take ``span`` without breaking the monotonic order with its path neighbours?"""
    before = [b for b in path_spans if b < beat]
    after = [b for b in path_spans if b > beat]
    cand = spans[span]
    if before:
        prev = spans[path_spans[max(before)]]
        if not compatible(prev.g_end, cand.g_start, cand.g_end):
            return False
    if after:
        nxt = spans[path_spans[min(after)]]
        if not compatible(cand.g_end, nxt.g_start, nxt.g_end):
            return False
    return True


# ── reading ───────────────────────────────────────────────────────────────────────────────────
def _prov_of(row: BeatMatch) -> Provenance | None:
    raw = row.provenance
    if not raw:
        return None
    try:
        return Provenance(
            source=raw["source"], provider=raw.get("provider"), model=raw.get("model")
        )
    except (KeyError, ValueError):
        return None


class _Lookup:
    """Per-request caches: assets, keyframe thumbnails and segment text."""

    def __init__(self, db: Session, workspace_id: str) -> None:
        self.db, self.ws = db, workspace_id
        self._assets: dict[str, Asset | None] = {}
        self._shots: dict[str, list[Any]] = {}
        self._segs: dict[str, list[AssetSegment]] = {}

    def asset(self, asset_id: str | None) -> Asset | None:
        if not asset_id:
            return None
        if asset_id not in self._assets:
            a = self.db.get(Asset, asset_id)
            self._assets[asset_id] = a if a is not None and a.workspace_id == self.ws else None
        return self._assets[asset_id]

    def thumbnail(self, asset_id: str | None, at: float | None) -> str | None:
        asset = self.asset(asset_id)
        if asset is None:
            return None
        if asset_id not in self._shots:
            self._shots[asset_id or ""] = ShotRepository(self.db).for_asset(self.ws, asset.id)
        for shot in self._shots[asset_id or ""]:
            if at is not None and shot.start_sec <= at < shot.end_sec and shot.keyframe_key:
                return sign_media(shot.keyframe_key)
        return sign_media(asset.thumb_key) if asset.thumb_key else None

    def text(self, asset_id: str | None, start: float | None, end: float | None) -> str:
        if not asset_id or start is None or end is None:
            return ""
        if asset_id not in self._segs:
            self._segs[asset_id] = list(
                self.db.execute(
                    select(AssetSegment)
                    .where(AssetSegment.workspace_id == self.ws, AssetSegment.asset_id == asset_id)
                    .order_by(AssetSegment.idx)
                ).scalars()
            )
        mid = [
            s for s in self._segs[asset_id] if s.end_sec > start + 0.05 and s.start_sec < end - 0.05
        ]
        return " ".join(s.text.strip() for s in mid)[: ALT_TEXT_CHARS * 2]


def _beat_view(beat: ScriptBeat, row: BeatMatch | None, lookup: _Lookup) -> dict[str, Any]:
    base: dict[str, Any] = {
        "script_beat_id": beat.id,
        "scene_idx": beat.scene_idx,
        "beat_idx": beat.beat_idx,
        "text": beat.text,
        "est_sec": float(beat.est_sec or 0),
    }
    if row is None:
        return {**base, "status": "unmatched", "alternatives": []}
    asset = lookup.asset(row.asset_id)
    alts = []
    for n, alt in enumerate(row.alternatives or []):
        a = lookup.asset(alt.get("asset_id"))
        alts.append(
            {
                "index": n,
                "asset_id": alt["asset_id"],
                "filename": a.filename if a else None,
                "start_sec": alt["start_sec"],
                "end_sec": alt["end_sec"],
                "timecode": timecode(alt["start_sec"], alt["end_sec"]),
                "score": alt.get("score", 0.0),
                "text": alt.get("text", ""),
                "out_of_order": bool(alt.get("out_of_order")),
                "is_current": (alt["asset_id"], alt["start_sec"], alt["end_sec"])
                == (row.asset_id, row.start_sec, row.end_sec),
                "thumbnail_url": lookup.thumbnail(alt["asset_id"], alt["start_sec"]),
            }
        )
    first = (row.alternatives or [{}])[0]
    return {
        **base,
        "match_id": row.id,
        "status": row.status,
        "asset_id": row.asset_id,
        "filename": asset.filename if asset else None,
        "start_sec": row.start_sec,
        "end_sec": row.end_sec,
        "timecode": timecode(row.start_sec, row.end_sec),
        "confidence": row.score,
        "matched_text": lookup.text(row.asset_id, row.start_sec, row.end_sec),
        "out_of_order": bool(first.get("out_of_order")) and row.status == "weak",
        "shared_span": bool(first.get("shared_span")) and row.status == "weak",
        "thumbnail_url": lookup.thumbnail(row.asset_id, row.start_sec),
        "preview_url": sign_media(asset.proxy_key) if asset and asset.proxy_key else None,
        "alternatives": alts,
        "provenance": _prov_of(row),
        "updated_at": row.updated_at,
    }


def _last_job(db: Session, workspace_id: str, item_id: str) -> Job | None:
    return db.execute(
        select(Job)
        .where(Job.workspace_id == workspace_id, Job.type == JOB_TYPE, Job.entity_id == item_id)
        .order_by(Job.created_at.desc(), Job.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def get_match(db: Session, workspace_id: str, item_id: str) -> dict[str, Any]:
    """Beats with their matches, coverage, missing/weak scenes and the last job (``GET /match``)."""
    item = db.get(ContentItem, item_id)
    if item is None or item.workspace_id != workspace_id:
        raise not_found("Content item")
    script = ScriptRepository(db).current(workspace_id, item_id)
    if script is None:
        raise AppError("NO_SCRIPT", "This item has no script yet.")
    beats = ScriptBeatRepository(db).for_script(workspace_id, script.id)
    rows = {
        m.script_beat_id: m
        for m in db.execute(
            select(BeatMatch).where(
                BeatMatch.workspace_id == workspace_id,
                BeatMatch.script_beat_id.in_([b.id for b in beats] or [""]),
            )
        ).scalars()
    }
    lookup = _Lookup(db, workspace_id)
    views = [_beat_view(b, rows.get(b.id), lookup) for b in beats]
    statuses = [v["status"] for v in views]
    matched_sec = sum(
        (v["end_sec"] - v["start_sec"])
        for v in views
        if v["status"] in ("matched", "confirmed", "weak") and v["start_sec"] is not None
    )
    missing, weak = scene_report(
        [
            {
                "scene_idx": v["scene_idx"],
                "id": v["script_beat_id"],
                "text": v["text"],
                "est_sec": v["est_sec"],
                "status": v["status"],
            }
            for v in views
        ],
        list(script.scenes or []),
    )
    info = embedder_info()
    provs = [v["provenance"] for v in views if v.get("provenance") is not None]
    provenance = weakest(provs) or embedder_provenance()
    job = _last_job(db, workspace_id, item_id)
    return {
        "content_item_id": item_id,
        "script_id": script.id,
        "script_version": script.version,
        "ran": bool(rows),
        "embedder": {
            "backend": info["backend"],
            "model": info["model"],
            "real": info["real"],
            "match_ok": info["match_ok"],
            "match_weak": info["match_weak"],
        },
        "beats": views,
        "coverage": coverage_summary(statuses, matched_sec),
        "missing_scenes": missing,
        "weak_scenes": weak,
        "job": None
        if job is None
        else {
            "id": job.id,
            "status": job.status,
            "progress": job.progress,
            "stage": job.stage,
            "error": job.error,
            "finished_at": job.finished_at,
            "notes": list((job.result or {}).get("notes") or []),
        },
        "provenance": provenance,
    }


# ── user decisions ────────────────────────────────────────────────────────────────────────────
def _row(db: Session, workspace_id: str, match_id: str) -> tuple[BeatMatch, ScriptBeat]:
    row = db.get(BeatMatch, match_id)
    if row is None or row.workspace_id != workspace_id:
        raise not_found("Beat match")
    beat = db.get(ScriptBeat, row.script_beat_id)
    if beat is None:
        raise not_found("Script beat")
    return row, beat


def _view(db: Session, workspace_id: str, row: BeatMatch, beat: ScriptBeat) -> dict[str, Any]:
    return _beat_view(beat, row, _Lookup(db, workspace_id))


def swap(db: Session, workspace_id: str, match_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Point the beat at another span (an alternative or a custom range); status ``confirmed``."""
    row, beat = _row(db, workspace_id, match_id)
    previous = (
        {
            "asset_id": row.asset_id,
            "start_sec": row.start_sec,
            "end_sec": row.end_sec,
            "score": row.score,
        }
        if row.asset_id and row.start_sec is not None
        else None
    )
    alternatives = list(row.alternatives or [])
    lookup = _Lookup(db, workspace_id)
    if body.get("alternative_index") is not None:
        index = int(body["alternative_index"])
        if index >= len(alternatives):
            raise AppError(
                "VALIDATION_ERROR",
                f"alternative_index {index} is out of range ({len(alternatives)} alternatives)",
                details={"alternatives": len(alternatives)},
            )
        chosen = dict(alternatives[index])
        chosen.pop("out_of_order", None)
    else:
        asset = lookup.asset(body["asset_id"])
        if asset is None or asset.kind not in ("video", "audio"):
            raise AppError(
                "VALIDATION_ERROR", "asset_id must be a video or audio asset of this workspace"
            )
        start, end = float(body["start_sec"]), float(body["end_sec"])
        limit = float(asset.duration_sec or 0)
        if limit and end > limit + 0.05:
            raise AppError(
                "VALIDATION_ERROR",
                f"end_sec {end:g} is past the end of the asset ({limit:g} s)",
                details={"duration_sec": limit},
            )
        text = lookup.text(asset.id, start, end)
        chosen = {
            "asset_id": asset.id,
            "start_sec": round(start, 3),
            "end_sec": round(end, 3),
            "score": _custom_score(beat, text),
            "text": text[:ALT_TEXT_CHARS],
        }
    rest = [a for a in ([previous] if previous else []) + alternatives if _key(a) != _key(chosen)]
    seen: set[tuple[Any, ...]] = {_key(chosen)}
    merged = [chosen]
    for alt in rest:
        if _key(alt) not in seen:
            seen.add(_key(alt))
            merged.append(
                {k: v for k, v in alt.items() if k != "out_of_order"}
                | {"text": alt.get("text", "")}
            )
    row.asset_id, row.start_sec, row.end_sec = (
        chosen["asset_id"],
        chosen["start_sec"],
        chosen["end_sec"],
    )
    row.score = float(chosen.get("score", 0.0))
    row.alternatives = merged[:4]
    row.status = "confirmed"
    row.provenance = Provenance.user().model_dump()
    db.flush()
    log_activity(db, workspace_id, "beat_match_swapped", "beat_match", row.id,
                 content_item_id=row.content_item_id, script_beat_id=beat.id)  # fmt: skip
    return _view(db, workspace_id, row, beat)


def _key(alt: dict[str, Any]) -> tuple[Any, ...]:
    return (alt.get("asset_id"), alt.get("start_sec"), alt.get("end_sec"))


def _custom_score(beat: ScriptBeat, text: str) -> float:
    """Cosine of the beat and the chosen range's text with the current embedder (0 if unknown)."""
    if not text.strip() or beat.embedding is None:
        return 0.0
    try:
        vec = unpack_matrix([beat.embedding])
        return round(max(0.0, float(cosine_matrix(vec, embed_texts([text]))[0, 0])), 4)
    except Exception:
        log.exception("could not score custom match span")
        return 0.0


def confirm(db: Session, workspace_id: str, match_id: str) -> dict[str, Any]:
    row, beat = _row(db, workspace_id, match_id)
    if row.asset_id is None or row.start_sec is None:
        raise AppError("CONFLICT", "This beat has no footage to confirm; swap in a span first.")
    row.status = "confirmed"
    row.provenance = Provenance.user().model_dump()
    db.flush()
    log_activity(db, workspace_id, "beat_match_confirmed", "beat_match", row.id,
                 content_item_id=row.content_item_id, script_beat_id=beat.id)  # fmt: skip
    return _view(db, workspace_id, row, beat)


def reject(db: Session, workspace_id: str, match_id: str) -> dict[str, Any]:
    row, beat = _row(db, workspace_id, match_id)
    row.status = "rejected"
    row.provenance = Provenance.user().model_dump()
    db.flush()
    log_activity(db, workspace_id, "beat_match_rejected", "beat_match", row.id,
                 content_item_id=row.content_item_id, script_beat_id=beat.id)  # fmt: skip
    return _view(db, workspace_id, row, beat)
