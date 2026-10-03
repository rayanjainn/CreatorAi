"""Caption stage (Plan.md section 8.1): ONE ``assets.caption_keyframes`` call per batch of <= 12.

Fills ``asset_shots.caption/tags`` and ``assets.description/tags``; the remaining shots inherit tags
from the nearest captioned shot. If no LLM is available the asset is NOT failed: the stage is
recorded as ``caption: skipped (...)`` and a ``CAPTIONS_UNAVAILABLE`` warning is surfaced.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.db import session_scope
from app.errors import AppError
from app.llm import gateway as llm
from app.llm.schemas import CaptionKeyframesOutput
from app.llm.types import LLMMeta
from app.ml.shots import select_evenly
from app.models import Asset, AssetSegment, AssetShot
from app.repositories.assets import SegmentRepository, ShotRepository
from app.services.assets import analysis_of, clean_tags, update_analysis
from app.services.ingest.run import Run, set_provenance

log = logging.getLogger(__name__)
BATCH = 12
SKIPPABLE = {
    "LLM_NOT_CONFIGURED": "llm unavailable",
    "LLM_BUSY": "llm busy",
    "LLM_INVALID_OUTPUT": "llm invalid output",
}
MAX_CAPTION_CHARS = 200
MAX_DESCRIPTION_CHARS = 600
MAX_SHOT_TAGS = 8


def nearest_line(segments: list[AssetSegment], at_sec: float, limit: int = 240) -> str:
    """Transcript text spoken at ``at_sec`` (or the closest segment), trimmed to ``limit``."""
    if not segments:
        return ""
    best = min(
        segments,
        key=lambda s: (
            0.0
            if s.start_sec <= at_sec <= s.end_sec
            else min(abs(s.start_sec - at_sec), abs(s.end_sec - at_sec))
        ),
    )
    return best.text.strip()[:limit]


def choose_shots(shots: list[AssetShot], limit: int = BATCH) -> list[AssetShot]:
    """Up to ``limit`` shots that have a keyframe, evenly spaced across the asset."""
    with_frames = [s for s in shots if s.keyframe_key]
    return [with_frames[i] for i in select_evenly(len(with_frames), limit)]


def inherit_tags(shots: list[AssetShot], captioned: dict[int, list[str]]) -> dict[int, list[str]]:
    """Tags for every shot: captioned shots keep theirs, others copy the nearest captioned one."""
    if not captioned:
        return {}
    mids = {s.idx: (s.start_sec + s.end_sec) / 2 for s in shots}
    out: dict[int, list[str]] = {}
    for shot in shots:
        if shot.idx in captioned:
            out[shot.idx] = captioned[shot.idx]
            continue
        nearest = min(captioned, key=lambda i: (abs(mids.get(i, 0.0) - mids[shot.idx]), i))
        out[shot.idx] = list(captioned[nearest])
    return out


def stage_caption(run: Run) -> None:
    asset = run.snapshot()
    with session_scope() as db:
        shots = ShotRepository(db).for_asset(run.workspace_id, run.asset_id)
        segments = SegmentRepository(db).for_asset(run.workspace_id, run.asset_id)
        for row in [*shots, *segments]:
            db.expunge(row)
    chosen = choose_shots(shots)
    if not chosen:
        run.commit("caption", note="caption: skipped (no keyframes)")
        return
    items: list[tuple[AssetShot, bytes, str]] = []
    for shot in chosen:
        assert shot.keyframe_key
        data = run.path(shot.keyframe_key).read_bytes()
        items.append((shot, data, nearest_line(segments, (shot.start_sec + shot.end_sec) / 2)))

    captions: dict[int, tuple[str, list[str]]] = {}
    description = ""
    asset_tags: list[str] = []
    meta: LLMMeta | None = None
    try:
        for b, start in enumerate(range(0, len(items), BATCH)):
            run.check_cancel()
            batch = items[start : start + BATCH]
            variables = {
                "filename": asset.filename,
                "shots": [{"id": f"shot_{s.idx}", "transcript": line} for s, _, line in batch],
            }
            out, meta = llm.run_with_meta(
                "assets.caption_keyframes",
                variables,
                CaptionKeyframesOutput,
                run.workspace_id,
                images=[img for _, img, _ in batch],
            )
            _collect(out, [s for s, _, _ in batch], captions)
            if b == 0:
                description = out.description.strip()
            asset_tags += out.tags
    except AppError as exc:
        if exc.code not in SKIPPABLE:
            raise
        _skip(run, exc, SKIPPABLE[exc.code])
        return
    assert meta is not None
    prov = meta.provenance.model_dump()
    inherited = inherit_tags(shots, {i: tags for i, (_, tags) in captions.items()})

    def apply(db: Session, a: Asset) -> None:
        for shot in ShotRepository(db).for_asset(a.workspace_id, a.id):
            if shot.idx in captions:
                shot.caption = captions[shot.idx][0]
            if shot.idx in inherited:
                shot.tags = inherited[shot.idx]
        edited = set(analysis_of(a).get("user_edited") or [])
        if description and "description" not in edited:
            a.description = description[:MAX_DESCRIPTION_CHARS]
        if asset_tags and "tags" not in edited:
            a.tags = clean_tags(asset_tags)[:8]
        update_analysis(a, captioned_shots=sorted(captions))
        set_provenance(a, "caption", prov)

    run.commit("caption", apply)


def _collect(
    out: CaptionKeyframesOutput, batch: list[AssetShot], into: dict[int, tuple[str, list[str]]]
) -> None:
    """Map returned ids (``shot_<idx>``) to shots; fall back to positional order if ids drift."""
    by_id = {f"shot_{s.idx}": s for s in batch}
    positional = len(out.shots) == len(batch) and not any(c.id in by_id for c in out.shots)
    for pos, item in enumerate(out.shots):
        shot = batch[pos] if positional else by_id.get(item.id)
        if shot is None:
            continue
        into[shot.idx] = (
            item.caption.strip()[:MAX_CAPTION_CHARS],
            clean_tags(item.tags)[:MAX_SHOT_TAGS],
        )


def _skip(run: Run, exc: AppError, reason: str) -> None:
    """Record a graceful skip: stage note + visible warning; keep any earlier captions."""
    warning = {
        "code": "CAPTIONS_UNAVAILABLE",
        "stage": "caption",
        "message": f"AI captions unavailable: {exc.message}",
    }
    log.warning("captioning skipped for asset %s (%s)", run.asset_id, exc.code)

    def apply(_: Session, a: Asset) -> None:
        if not analysis_of(a).get("captioned_shots"):
            set_provenance(a, "caption", None)

    run.commit("caption", apply, note=f"caption: skipped ({reason})", warnings=[warning])
