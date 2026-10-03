"""Smart clip generation (Plan.md section 8.8) and the clip review actions.

``clips.generate`` stages: candidates 30 -> score 50 -> rerank+copy (llm) 85 -> timelines 100.

* candidates / score: ``ml.scoring`` (windows from sentence-start segments, six min-max normalised
  features, NMS IoU < 0.3, top 8). Scoring is rule-based, so its provenance is ``heuristic``.
* rerank + copy: ONE ``clips.rerank_copy`` call over the 8 candidates picks the best ``count``
  (4) and writes title / hook / caption. If the call fails or no LLM is configured the top
  ``count`` by score are kept with the deterministic fallback copy (title = first 8 words,
  hook = first sentence, caption = first 150 chars), the clip provenance is ``heuristic`` and a
  warning is stored.
* timelines: pause removal (``timeline_service.tighten_pauses``), face reframing (``ml.faces``),
  captions from word timestamps, an optional AI music layer and the ``edits`` row (revision 1) plus
  ``edit_revisions`` revision 1. ``include_full_cut`` adds one 16:9 ``kind='full'`` clip.

Clip provenance lives in ``clips.features``: ``provenance`` (weakest of all parts) and
``provenance_by_part`` (``title``/``hook``/``caption`` = the LLM, ``user`` once edited; ``scores`` =
``heuristic``).
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import AppError, not_found
from app.llm import gateway as llm
from app.llm.schemas import ClipRerankOutput
from app.ml import scoring
from app.ml.embedder import embed_texts, embedder_info, embedder_provenance
from app.ml.faces import crop_x_for_ranges
from app.ml.vectors import cosine_matrix, unpack_matrix
from app.models import (
    Asset,
    AssetSegment,
    AssetShot,
    Clip,
    ContentItem,
    Edit,
    EditRevision,
    Job,
    Render,
)
from app.repositories.clips import ClipRepository, EditRepository
from app.repositories.content import DirectorOutputRepository, ScriptRepository
from app.repositories.profiles import ProfileRepository
from app.schemas.common import Provenance, weakest
from app.schemas.timeline import AudioItem, Timeline, VideoItem, new_item_id
from app.security import sign_media
from app.services import match_service, twin_events
from app.services import timeline_service as ts
from app.services.activity import log_activity
from app.storage.local import get_storage
from app.workers.runner import JOB_HANDLERS, JobContext, enqueue

log = logging.getLogger(__name__)

JOB_TYPE = "clips.generate"
CLIP_ACCEPTED = twin_events.CLIP_ACCEPTED
MUSIC_GAIN_DB = -18.0
COPY_FIELDS = ("title", "hook", "caption")
IOU_EXISTING = 0.3


@dataclass(frozen=True)
class AssetRef:
    """The two asset fields a timeline needs (usable outside a DB session)."""

    id: str
    duration_sec: float


# ── helpers ───────────────────────────────────────────────────────────────────────────────────
def pick_source_asset(
    db: Session, workspace_id: str, item_id: str, asset_id: str | None = None
) -> Asset:
    """``asset_id`` if given (a ready video of the workspace), else the longest ready video asset
    of the item. ``409 ASSET_NOT_READY`` when there is none or it has no transcript."""
    if asset_id:
        asset = db.get(Asset, asset_id)
        if asset is None or asset.workspace_id != workspace_id:
            raise not_found("Asset")
        if asset.kind != "video":
            raise AppError(
                "VALIDATION_ERROR", "Clips need a video asset", details={"asset_id": asset.id}
            )
        if asset.status != "ready":
            raise AppError(
                "ASSET_NOT_READY", "This asset is still processing", details={"asset_id": asset.id}
            )
        candidates = [asset]
    else:
        stmt = select(Asset).where(
            Asset.workspace_id == workspace_id,
            Asset.content_item_id == item_id,
            Asset.kind == "video",
            Asset.status == "ready",
        )
        candidates = sorted(
            db.execute(stmt).scalars(), key=lambda a: (-(a.duration_sec or 0.0), a.created_at)
        )
    for asset in candidates:
        has_text = db.execute(
            select(AssetSegment.id)
            .where(AssetSegment.workspace_id == workspace_id, AssetSegment.asset_id == asset.id)
            .limit(1)
        ).first()
        if has_text:
            return asset
    raise AppError(
        "ASSET_NOT_READY",
        "No processed video with a transcript is available for this item yet.",
        details={"content_item_id": item_id},
    )


def start_generate(
    db: Session, workspace_id: str, item_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    item = db.get(ContentItem, item_id)
    if item is None or item.workspace_id != workspace_id:
        raise not_found("Content item")
    asset = pick_source_asset(db, workspace_id, item_id, body.get("asset_id"))
    if JOB_TYPE not in JOB_HANDLERS:
        raise AppError("INTERNAL_ERROR", "Clip generation is not available in this build")
    active = db.execute(
        select(Job.id).where(
            Job.workspace_id == workspace_id,
            Job.type == JOB_TYPE,
            Job.entity_id == item_id,
            Job.status.in_(("queued", "running")),
        )
    ).first()
    if active is not None:
        return {"job_id": active[0], "asset_id": asset.id}
    payload = {
        "asset_id": asset.id,
        "count": body.get("count"),
        "include_full_cut": bool(body.get("include_full_cut")),
    }
    db.commit()
    job_id = enqueue(JOB_TYPE, "content_item", item_id, payload, workspace_id=workspace_id)
    return {"job_id": job_id, "asset_id": asset.id}


def _music_asset(db: Session, workspace_id: str) -> Asset | None:
    """First audio asset of the library tagged ``music`` (Plan 8.8 step 9)."""
    stmt = (
        select(Asset)
        .where(Asset.workspace_id == workspace_id, Asset.kind == "audio", Asset.status == "ready")
        .order_by(Asset.created_at, Asset.id)
    )
    for asset in db.execute(stmt).scalars():
        if (
            any(str(t).strip().lower() == "music" for t in (asset.tags or []))
            and asset.duration_sec
        ):
            return asset
    return None


def default_caption_style(db: Session, workspace_id: str) -> str:
    profile = ProfileRepository(db).get(workspace_id)
    style = ((profile.style_profile or {}).get("captions") or {}).get("style") if profile else None
    return style if style in ("bold_center", "minimal_bottom", "karaoke") else "bold_center"


def build_clip_timeline(
    *,
    asset: AssetRef,
    start: float,
    end: float,
    silences: Sequence[tuple[float, float]],
    words: Sequence[dict[str, Any]],
    video_path: Any,
    aspect: str,
    caption_style: str,
    keep_sec: float,
    reason: str | None,
    music: AssetRef | None = None,
) -> Timeline:
    """One source range -> a validated timeline (pause removal, crop_x, captions, music)."""
    limit = float(asset.duration_sec or end)
    end = min(end, limit)
    timeline = Timeline.empty(aspect, caption_style)  # type: ignore[arg-type]
    timeline.tracks.video = [
        VideoItem(
            id=new_item_id("v"),
            source="ai",
            status="suggested",
            reason=reason,
            asset_id=asset.id,
            src_in=round(start, 3),
            src_out=round(end, 3),
            tl_start=0.0,
        )
    ]
    timeline = ts.recompute_duration(timeline)
    timeline = ts.tighten_pauses(timeline, {asset.id: list(silences)}, keep_sec)
    items = timeline.tracks.video
    for item, crop in zip(
        items, crop_x_for_ranges(video_path, [(i.src_in, i.src_out) for i in items]), strict=True
    ):
        item.crop_x = crop
    timeline = ts.rebuild_captions(timeline, lambda _asset: words)
    if music is not None and timeline.duration > 0:
        timeline.tracks.audio.append(
            AudioItem(
                id=new_item_id("a"),
                source="ai",
                status="suggested",
                kind="music",
                asset_id=music.id,
                src_in=0.0,
                src_out=round(min(float(music.duration_sec or 0), timeline.duration), 3),
                tl_start=0.0,
                gain_db=MUSIC_GAIN_DB,
                reason="background music from your library",
            )
        )
    durations = {asset.id: limit}
    if music is not None:
        durations[music.id] = float(music.duration_sec or 0)
    return ts.ensure_valid(timeline, durations)


def _objective(db: Session, workspace_id: str, item: ContentItem) -> str:
    plan = DirectorOutputRepository(db).latest(workspace_id, item.id, "plan")
    payload = (plan.payload if plan else None) or {}
    nested = payload.get("plan") if isinstance(payload.get("plan"), dict) else {}
    return str(payload.get("objective") or nested.get("objective") or item.objective or item.title)


def _llm_copy(
    workspace_id: str, objective: str, keep: int, windows: list[scoring.Window]
) -> tuple[dict[str, dict[str, Any]], Provenance, list[str]]:
    """One ``clips.rerank_copy`` call -> ``({candidate_id: copy + rank}, provenance, warnings)``.

    Raises on any gateway failure (the caller falls back to deterministic copy)."""
    candidates = [
        {
            "id": f"c{n + 1}",
            "start": round(w.start, 2),
            "end": round(w.end, 2),
            "text": w.text[:700],
            "features": {k: round(v, 3) for k, v in w.norm.items()},
        }
        for n, w in enumerate(windows)
    ]
    out, meta = llm.run_with_meta(
        "clips.rerank_copy",
        {"objective": objective, "keep": keep, "candidates": candidates},
        ClipRerankOutput,
        workspace_id,
    )
    valid = {c["id"] for c in candidates}
    chosen: dict[str, dict[str, Any]] = {}
    for entry in sorted((c for c in out.clips if c.keep), key=lambda c: c.rank):
        if entry.candidate_id in valid and entry.candidate_id not in chosen:
            chosen[entry.candidate_id] = {
                "title": entry.title.strip()[:70],
                "hook": " ".join(entry.hook.split()[:15]),
                "caption": entry.caption.strip()[:150],
                "reason": entry.reason.strip(),
                "rank": len(chosen) + 1,
            }
        if len(chosen) >= keep:
            break
    warnings: list[str] = []
    if not chosen:
        raise AppError("LLM_INVALID_OUTPUT", "The model returned no usable clip picks")
    if len(chosen) < keep:
        warnings.append(f"MODEL_PICKED_{len(chosen)}_OF_{keep}")
    return chosen, Provenance.from_meta(meta), warnings


def _existing_ranges(
    db: Session, workspace_id: str, item_id: str, asset_id: str
) -> list[tuple[float, float]]:
    rows = ClipRepository(db).for_item(workspace_id, item_id, kind="short")
    return [
        (c.start_sec, c.end_sec)
        for c in rows
        if c.source_asset_id == asset_id and c.status in ("accepted", "rejected")
    ]


def _drop_stale_suggestions(db: Session, workspace_id: str, item_id: str, asset_id: str) -> int:
    """Remove earlier ``suggested`` clips of this source that were never edited or rendered."""
    removed = 0
    edits = EditRepository(db)
    for clip in ClipRepository(db).for_item(workspace_id, item_id, status="suggested"):
        if clip.source_asset_id != asset_id:
            continue
        edit = edits.for_clip(workspace_id, clip.id)
        renders = db.execute(
            select(func.count()).select_from(Render).where(Render.clip_id == clip.id)
        ).scalar_one()
        if renders or (edit is not None and edit.revision > 1):
            continue
        db.delete(clip)
        removed += 1
    db.flush()
    return removed


# ── the job ───────────────────────────────────────────────────────────────────────────────────
def run_generate(ctx: JobContext) -> dict[str, Any]:
    ws, item_id = ctx.workspace_id, str(ctx.entity_id)
    settings = get_settings()
    count = int(ctx.payload.get("count") or settings.clip_keep)
    include_full = bool(ctx.payload.get("include_full_cut"))
    warnings: list[str] = []
    ctx.progress(0, "candidates")
    with ctx.session_factory() as db:
        item = db.get(ContentItem, item_id)
        if item is None or item.workspace_id != ws:
            raise AppError("NOT_FOUND", "Content item not found", retryable=False)
        asset = pick_source_asset(db, ws, item_id, ctx.payload.get("asset_id"))
        segments = list(
            db.execute(
                select(AssetSegment)
                .where(AssetSegment.workspace_id == ws, AssetSegment.asset_id == asset.id)
                .order_by(AssetSegment.idx)
            ).scalars()
        )
        shots = [
            (s.start_sec, s.end_sec)
            for s in db.execute(
                select(AssetShot).where(
                    AssetShot.workspace_id == ws, AssetShot.asset_id == asset.id
                )
            ).scalars()
        ]
        analysis = dict(asset.analysis or {})
        silences = [(float(s), float(e)) for s, e in analysis.get("silences") or []]
        envelope = [float(x) for x in analysis.get("energy") or []]
        script = ScriptRepository(db).current(ws, item_id)
        beat_vecs: np.ndarray | None = None
        if script is not None and script.scenes:
            beats, _ = match_service.ensure_beat_embeddings(db, ws, script, warnings)
            if beats:
                beat_vecs = unpack_matrix([b.embedding for b in beats])
        seg_all = [scoring.Seg(s.start_sec, s.end_sec, s.text) for s in segments]
        word_rows = [w for s in segments for w in (s.words or [])]
        objective = _objective(db, ws, item)
        existing = _existing_ranges(db, ws, item_id, asset.id)
        asset_id, asset_name = asset.id, asset.filename
        asset_duration = float(asset.duration_sec or 0.0)
    warnings = [w for w in warnings if not w.startswith("script beats re-embedded")]

    windows = scoring.windows_with_fallback(seg_all, settings.clip_min_sec, settings.clip_max_sec)
    if not windows and not include_full:
        raise AppError(
            "NO_CLIP_CANDIDATES",
            "No clip-sized stretch of speech was found in this video.",
            details={"asset_id": asset_id, "segments": len(seg_all)},
            retryable=False,
        )
    found = len(windows)
    windows = [
        w for w in windows if all(scoring.iou((w.start, w.end), r) < IOU_EXISTING for r in existing)
    ]
    if found and not windows:
        warnings.append(
            "NO_NEW_CLIPS: every candidate overlaps a clip you already accepted or rejected"
        )
    ctx.progress(30, "candidates")
    if windows and windows[0].relaxed_min:
        warnings.append(
            f"SHORT_FOOTAGE: minimum clip length lowered to {windows[0].relaxed_min:g} s"
        )

    info = embedder_info()
    embed_prov = embedder_provenance()
    if windows:
        vecs = embed_texts([w.text for w in windows])
        sims = (
            cosine_matrix(vecs, beat_vecs).max(axis=1)
            if beat_vecs is not None and len(beat_vecs)
            else None
        )
        for n, window in enumerate(windows):
            window.raw = scoring.raw_features(
                window,
                beat_similarity=None if sims is None else float(sims[n]),
                envelope=envelope,
                shots=shots,
            )
        weights = scoring.score_windows(windows)
        top = scoring.nms(windows, scoring.NMS_IOU, settings.clip_top_k)
    else:
        weights, top = {}, []
    ctx.progress(50, "score")

    copy: dict[str, dict[str, Any]] = {}
    copy_prov: Provenance | None = None
    keep = min(count, len(top))
    if top:
        try:
            copy, copy_prov, extra = _llm_copy(ws, objective, keep, top)
            warnings += extra
        except Exception as exc:
            code = getattr(exc, "code", exc.__class__.__name__)
            warnings.append(f"COPY_FALLBACK: {code}: {str(exc)[:200]}")
            log.warning("clips.rerank_copy unavailable (%s); using fallback copy", exc)
    ctx.progress(85, "rerank+copy")

    scores_prov = Provenance.heuristic("clip-scoring", embed_prov.model)
    picks: list[tuple[int, scoring.Window, dict[str, Any], Provenance | None]] = []
    chosen_ids = list(copy)
    if copy:
        for cid in chosen_ids:
            n = int(cid[1:]) - 1
            picks.append((copy[cid]["rank"], top[n], copy[cid], copy_prov))
        if len(picks) < keep:  # model returned fewer picks: fill by score with fallback copy
            used = {id(p[1]) for p in picks}
            for window in top:
                if len(picks) >= keep:
                    break
                if id(window) not in used:
                    picks.append(
                        (
                            len(picks) + 1,
                            window,
                            {
                                **scoring.fallback_copy(window.text),
                                "reason": "Top-scoring window (fallback copy)",
                            },
                            None,
                        )
                    )
    else:
        for rank, window in enumerate(top[:keep], start=1):
            fallback = {
                **scoring.fallback_copy(window.text),
                "reason": "Top-scoring window (fallback copy)",
            }
            picks.append((rank, window, fallback, None))

    # Heavy work (face detection, timelines) happens before the write transaction: progress
    # writes through its own session, so none may be open while we report it.
    with ctx.session_factory() as db:
        style = default_caption_style(db, ws)
        music_row = _music_asset(db, ws)
        music = AssetRef(music_row.id, float(music_row.duration_sec or 0)) if music_row else None
        row = db.get(Asset, asset_id)
        assert row is not None
        asset = AssetRef(row.id, float(row.duration_sec or 0))
        video_path = get_storage().path_for(row.proxy_key or row.storage_key)
        item_title = item.title

    @dataclass
    class Built:
        rank: int | None
        window: scoring.Window | None
        text: dict[str, Any]
        prov: Provenance | None
        timeline: Timeline
        kind: str

    built: list[Built] = []
    total = len(picks) + (1 if include_full else 0)
    for done, (rank, window, text, prov) in enumerate(picks, start=1):
        timeline = build_clip_timeline(
            asset=asset,
            start=window.start,
            end=window.end,
            silences=silences,
            words=word_rows,
            video_path=video_path,
            aspect="9:16",
            caption_style=style,
            keep_sec=settings.pause_keep_sec,
            reason=str(text.get("reason") or "") or None,
            music=music,
        )
        built.append(Built(rank, window, text, prov, timeline, "short"))
        ctx.progress(85 + 15 * done / max(1, total), "timelines")
    if include_full:
        full_timeline = build_clip_timeline(
            asset=asset,
            start=0.0,
            end=asset_duration,
            silences=silences,
            words=word_rows,
            video_path=video_path,
            aspect="16:9",
            caption_style="minimal_bottom",
            keep_sec=settings.pause_keep_sec,
            reason="full cut with pauses removed",
        )
        built.append(Built(None, None, {}, None, full_timeline, "full"))
        ctx.progress(99, "timelines")

    created: list[str] = []
    with ctx.session_factory() as db:
        _drop_stale_suggestions(db, ws, item_id, asset_id)
        for entry in built:
            if entry.kind == "full":
                created.append(
                    _save_full_cut(
                        db,
                        ws,
                        item_id,
                        item_title,
                        asset_id,
                        asset_duration,
                        entry.timeline,
                        scores_prov,
                    )
                )
                continue
            assert entry.window is not None
            created.append(
                _save_clip(
                    db,
                    ws,
                    item_id,
                    asset_id,
                    asset_duration,
                    entry,
                    weights,
                    info["backend"],
                    scores_prov,
                    warnings,
                )
            )
        log_activity(
            db,
            ws,
            "clips_generated",
            "content_item",
            item_id,
            asset_id=asset_id,
            clips=len(created),
            fallback_copy=not copy,
            include_full_cut=include_full,
        )
        db.commit()
    ctx.progress(100, "timelines")
    return {
        "asset_id": asset_id,
        "filename": asset_name,
        "clip_ids": created,
        "candidates": len(windows),
        "kept": len(picks),
        "full_cut": include_full,
        "warnings": warnings,
        "copy_source": copy_prov.model_dump()
        if copy_prov
        else Provenance.heuristic("fallback-copy").model_dump(),
        "provenance": scores_prov.model_dump(),
    }


def _add_edit(db: Session, workspace_id: str, clip: Clip, timeline: Timeline, note: str) -> Edit:
    edit = Edit(workspace_id=workspace_id, clip_id=clip.id, timeline=timeline.dump(), revision=1)
    db.add(edit)
    db.flush()
    db.add(EditRevision(edit_id=edit.id, revision=1, timeline=timeline.dump(), note=note))
    db.flush()
    return edit


def _save_clip(
    db: Session,
    workspace_id: str,
    item_id: str,
    asset_id: str,
    asset_duration: float,
    entry: Any,
    weights: dict[str, float],
    embedder: str,
    scores_prov: Provenance,
    warnings: list[str],
) -> str:
    window, text, prov = entry.window, entry.text, entry.prov
    part_prov = (prov or Provenance.heuristic("fallback-copy")).model_dump()
    clip_warnings = (
        list(warnings) if prov is None else [w for w in warnings if not w.startswith("COPY")]
    )
    by_part = dict.fromkeys(COPY_FIELDS, part_prov) | {"scores": scores_prov.model_dump()}
    top_prov = weakest([Provenance.model_validate(v) for v in by_part.values()]) or scores_prov
    clip = Clip(
        workspace_id=workspace_id,
        content_item_id=item_id,
        source_asset_id=asset_id,
        kind="short",
        title=text["title"],
        hook=text["hook"],
        caption=text["caption"],
        reason=str(text.get("reason") or ""),
        score=window.score,
        start_sec=round(window.start, 3),
        end_sec=round(min(window.end, asset_duration or window.end), 3),
        features={
            "raw": {k: None if v is None else round(v, 4) for k, v in window.raw.items()},
            "norm": window.norm,
            "weights": {k: round(v, 4) for k, v in weights.items()},
            "rank": entry.rank,
            "relaxed_min": window.relaxed_min,
            "pause_removed_sec": round(window.duration - entry.timeline.duration, 3),
            "embedder": embedder,
            "warnings": clip_warnings,
            "edited_by_user": [],
            "provenance": top_prov.model_dump(),
            "provenance_by_part": by_part,
        },
    )
    db.add(clip)
    db.flush()
    _add_edit(db, workspace_id, clip, entry.timeline, "Generated by clips.generate")
    return clip.id


def _save_full_cut(
    db: Session,
    workspace_id: str,
    item_id: str,
    title: str,
    asset_id: str,
    duration: float,
    timeline: Timeline,
    scores_prov: Provenance,
) -> str:
    """The ``kind='full'`` clip: all speech, pauses removed, 16:9, ``minimal_bottom`` captions."""
    prov = scores_prov.model_dump()
    clip = Clip(
        workspace_id=workspace_id,
        content_item_id=item_id,
        source_asset_id=asset_id,
        kind="full",
        title=title[:70],
        hook="",
        caption="",
        reason="Full cut: all speech, pauses removed",
        score=0.0,
        start_sec=0.0,
        end_sec=round(duration, 3),
        features={
            "rank": None,
            "pause_removed_sec": round(duration - timeline.duration, 3),
            "warnings": [],
            "edited_by_user": [],
            "provenance": prov,
            "provenance_by_part": {**dict.fromkeys(COPY_FIELDS, prov), "scores": prov},
        },
    )
    db.add(clip)
    db.flush()
    _add_edit(db, workspace_id, clip, timeline, "Generated full cut")
    return clip.id


# ── reading ───────────────────────────────────────────────────────────────────────────────────
def _parts(clip: Clip) -> dict[str, Provenance]:
    raw = (clip.features or {}).get("provenance_by_part") or {}
    out: dict[str, Provenance] = {}
    for key, value in raw.items():
        try:
            out[key] = Provenance.model_validate(value)
        except ValueError:
            continue
    return out


def clip_out(
    db: Session, workspace_id: str, clip: Clip, edit: Edit | None = None
) -> dict[str, Any]:
    asset = db.get(Asset, clip.source_asset_id)
    features = dict(clip.features or {})
    parts = _parts(clip) or {"scores": Provenance.heuristic("clip-scoring")}
    top = weakest(parts.values()) or Provenance.heuristic("clip-scoring")
    thumb = None
    if asset is not None:
        shot = db.execute(
            select(AssetShot)
            .where(
                AssetShot.workspace_id == workspace_id,
                AssetShot.asset_id == asset.id,
                AssetShot.start_sec <= clip.start_sec,
            )
            .order_by(AssetShot.start_sec.desc())
            .limit(1)
        ).scalar_one_or_none()
        key = shot.keyframe_key if shot and shot.keyframe_key else asset.thumb_key
        thumb = sign_media(key) if key else None
    if edit is None:
        edit = EditRepository(db).for_clip(workspace_id, clip.id)
    return {
        "id": clip.id,
        "content_item_id": clip.content_item_id,
        "source_asset_id": clip.source_asset_id,
        "kind": clip.kind,
        "title": clip.title,
        "hook": clip.hook,
        "caption": clip.caption,
        "reason": clip.reason,
        "score": clip.score,
        "rank": features.get("rank"),
        "start_sec": clip.start_sec,
        "end_sec": clip.end_sec,
        "duration_sec": round(clip.end_sec - clip.start_sec, 3),
        "status": clip.status,
        "features": {
            k: v
            for k, v in features.items()
            if k not in ("provenance", "provenance_by_part", "warnings")
        },
        "warnings": list(features.get("warnings") or []),
        "preview": {
            "url": sign_media(asset.proxy_key) if asset and asset.proxy_key else None,
            "start_sec": clip.start_sec,
            "end_sec": clip.end_sec,
        },
        "thumbnail_url": thumb,
        "edit_revision": edit.revision if edit else None,
        "timeline_duration": (edit.timeline or {}).get("duration") if edit else None,
        "created_at": clip.created_at,
        "updated_at": clip.updated_at,
        "provenance": top,
        "provenance_by_part": parts,
    }


def list_clips(
    db: Session, workspace_id: str, item_id: str, status: str | None = None, kind: str | None = None
) -> list[dict[str, Any]]:
    if (
        db.get(ContentItem, item_id) is None
        or db.get(ContentItem, item_id).workspace_id != workspace_id
    ):  # type: ignore[union-attr]
        raise not_found("Content item")
    clips = ClipRepository(db).for_item(workspace_id, item_id, status=status, kind=kind)
    edits = EditRepository(db).by_clips(workspace_id, [c.id for c in clips])
    rows = [clip_out(db, workspace_id, c, edits.get(c.id)) for c in clips]
    return sorted(rows, key=lambda r: (r["kind"] == "full", r["rank"] or 99, -r["score"]))


def get_clip(db: Session, workspace_id: str, clip_id: str) -> dict[str, Any]:
    return clip_out(db, workspace_id, ClipRepository(db).require(workspace_id, clip_id))


def patch_clip(
    db: Session, workspace_id: str, clip_id: str, patch: dict[str, Any]
) -> dict[str, Any]:
    """User edits of the copy; each edited field becomes provenance ``user``."""
    clip = ClipRepository(db).require(workspace_id, clip_id)
    features = dict(clip.features or {})
    parts = dict(features.get("provenance_by_part") or {})
    edited = list(features.get("edited_by_user") or [])
    for field in COPY_FIELDS:
        value = patch.get(field)
        if value is None or " ".join(str(value).split()) == getattr(clip, field):
            continue
        setattr(clip, field, " ".join(str(value).split()))
        parts[field] = Provenance.user().model_dump()
        if field not in edited:
            edited.append(field)
    top = weakest([Provenance.model_validate(v) for v in parts.values()])
    features.update(
        edited_by_user=edited,
        provenance_by_part=parts,
        provenance=(top or Provenance.user()).model_dump(),
    )
    clip.features = features
    db.flush()
    log_activity(
        db,
        workspace_id,
        "clip_edited",
        "clip",
        clip.id,
        content_item_id=clip.content_item_id,
        fields=edited,
    )
    return clip_out(db, workspace_id, clip)


def accept(db: Session, workspace_id: str, clip_id: str) -> dict[str, Any]:
    clip = ClipRepository(db).require(workspace_id, clip_id)
    if clip.status != "accepted":
        clip.status = "accepted"
        db.flush()
        log_activity(
            db,
            workspace_id,
            "clip_accepted",
            "clip",
            clip.id,
            content_item_id=clip.content_item_id,
            kind=clip.kind,
            score=clip.score,
        )
        twin_events.emit(
            CLIP_ACCEPTED,
            workspace_id,
            {"clip_id": clip.id, "content_item_id": clip.content_item_id},
            db=db,
        )
    return clip_out(db, workspace_id, clip)


def reject(db: Session, workspace_id: str, clip_id: str) -> dict[str, Any]:
    clip = ClipRepository(db).require(workspace_id, clip_id)
    if clip.status != "rejected":
        clip.status = "rejected"
        db.flush()
        log_activity(
            db,
            workspace_id,
            "clip_rejected",
            "clip",
            clip.id,
            content_item_id=clip.content_item_id,
            kind=clip.kind,
        )
    return clip_out(db, workspace_id, clip)
