"""Timeline persistence for clips: edits, optimistic concurrency, revisions and server-side ops.

Concurrency model: ``edits.revision`` is the version of the stored timeline. Every write (``PUT``,
``POST .../ops``, restore) carries the ``base_revision`` the client last saw and is applied as one
compare-and-swap ``UPDATE edits SET revision = revision + 1 ... WHERE revision = :base``. A write
with a stale base gets ``409 REVISION_CONFLICT`` with ``details.current_revision`` (the client
reloads or re-applies its change). Each successful write also appends an immutable
``edit_revisions`` row, so history is linear: a restore does not rewind, it creates a new revision
with the old content.

Every write is validated with ``timeline_service.validate`` (``422 VALIDATION_ERROR`` with
``details.violations``) against the real durations of the referenced assets. Status changes of
layers (``suggested`` -> ``accepted`` / ``rejected``) are logged to ``activity_log`` as
``layer_accepted`` / ``layer_rejected`` (one row per status, track and kind; ``meta`` has ``layer``
(``video|captions|audio|overlays``), ``kind``, ``item_ids``, ``count``, ``sources``, ``clip_id``,
``content_item_id`` and the new ``revision``). The Twin learns from ``layer_rejected``.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models import Asset, AssetSegment, Clip, Edit, EditRevision, utcnow
from app.repositories.clips import ClipRepository, EditRepository
from app.schemas.common import Provenance, weakest
from app.schemas.timeline import Timeline
from app.security import sign_media
from app.services import timeline_service as ts
from app.services.activity import log_activity

WAVEFORM_MAX_BINS = 6000  # 0.5 s per bin = 50 min
NOTE_MAX = 200


# ── loading ───────────────────────────────────────────────────────────────────────────────────
def _clip_edit(db: Session, workspace_id: str, clip_id: str) -> tuple[Clip, Edit]:
    clip = ClipRepository(db).require(workspace_id, clip_id)
    edit = EditRepository(db).for_clip(workspace_id, clip_id)
    if edit is None:
        raise not_found("Edit")
    return clip, edit


def referenced_asset_ids(timeline: Timeline) -> list[str]:
    ids: list[str] = []
    for item in [*timeline.tracks.video, *timeline.tracks.audio, *timeline.tracks.overlays]:
        asset_id = getattr(item, "asset_id", None)
        if asset_id and asset_id not in ids:
            ids.append(asset_id)
    return ids


def _assets(db: Session, workspace_id: str, ids: list[str]) -> dict[str, Asset]:
    if not ids:
        return {}
    rows = db.execute(select(Asset).where(Asset.workspace_id == workspace_id, Asset.id.in_(ids)))
    return {a.id: a for a in rows.scalars()}


def asset_durations(assets: dict[str, Asset]) -> dict[str, float]:
    return {a.id: float(a.duration_sec) for a in assets.values() if a.duration_sec}


def _words(db: Session, workspace_id: str, asset_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        select(AssetSegment)
        .where(AssetSegment.workspace_id == workspace_id, AssetSegment.asset_id == asset_id)
        .order_by(AssetSegment.idx)
    ).scalars()
    return [w for r in rows for w in (r.words or [])]


def _used_words(
    words: list[dict[str, Any]], ranges: list[tuple[float, float]]
) -> list[dict[str, Any]]:
    out = []
    for w in words:
        mid = (float(w["start"]) + float(w["end"])) / 2
        if any(a <= mid < b for a, b in ranges):
            out.append({"word": w["word"], "start": w["start"], "end": w["end"]})
    return out


def edit_payload(db: Session, workspace_id: str, clip: Clip, edit: Edit) -> dict[str, Any]:
    """``GET /clips/{id}/edit``: timeline, revision and what the editor needs to render it."""
    timeline = ts.parse_timeline(edit.timeline)
    assets = _assets(db, workspace_id, referenced_asset_ids(timeline))
    info: dict[str, dict[str, Any]] = {}
    for asset_id, asset in assets.items():
        analysis = dict(asset.analysis or {})
        ranges = [(v.src_in, v.src_out) for v in timeline.tracks.video if v.asset_id == asset_id]
        media_key = asset.audio_key or asset.storage_key if asset.kind == "audio" else None
        info[asset_id] = {
            "filename": asset.filename,
            "kind": asset.kind,
            "duration_sec": asset.duration_sec,
            "width": asset.width,
            "height": asset.height,
            "proxy_url": sign_media(asset.proxy_key) if asset.proxy_key else None,
            "audio_url": sign_media(media_key) if media_key else None,
            "thumb_url": sign_media(asset.thumb_key) if asset.thumb_key else None,
            "energy": [float(x) for x in (analysis.get("energy") or [])][:WAVEFORM_MAX_BINS],
            "energy_window_sec": 0.5,
            "silences": analysis.get("silences") or [],
            "words": _used_words(_words(db, workspace_id, asset_id), ranges) if ranges else [],
        }
    parts = [
        Provenance.model_validate(v)
        for v in ((clip.features or {}).get("provenance_by_part") or {}).values()
    ]
    return {
        "clip_id": clip.id,
        "edit_id": edit.id,
        "revision": edit.revision,
        "timeline": timeline,
        "updated_at": edit.updated_at,
        "assets": info,
        "violations": [v.model_dump() for v in ts.validate(timeline, asset_durations(assets))],
        "provenance": weakest(parts) or Provenance.heuristic("clip-scoring"),
    }


def get_edit(db: Session, workspace_id: str, clip_id: str) -> dict[str, Any]:
    clip, edit = _clip_edit(db, workspace_id, clip_id)
    return edit_payload(db, workspace_id, clip, edit)


# ── writing ───────────────────────────────────────────────────────────────────────────────────
def _conflict(edit: Edit, base: int) -> AppError:
    return AppError(
        "REVISION_CONFLICT",
        f"This edit changed since you loaded it (you have revision {base}, "
        f"the latest is {edit.revision}). Reload to continue.",
        details={
            "current_revision": edit.revision,
            "base_revision": base,
            "updated_at": edit.updated_at,
        },
    )


def _check_base(edit: Edit, base: int) -> None:
    if base != edit.revision:
        raise _conflict(edit, base)


def _commit(
    db: Session,
    workspace_id: str,
    clip: Clip,
    edit: Edit,
    timeline: Timeline,
    base_revision: int,
    note: str,
) -> dict[str, Any]:
    """Validate, compare-and-swap the revision, append the history row and log layer changes."""
    before = ts.parse_timeline(edit.timeline)
    assets = _assets(db, workspace_id, referenced_asset_ids(timeline))
    missing = [i for i in referenced_asset_ids(timeline) if i not in assets]
    ts.ensure_valid(timeline, asset_durations(assets))
    if missing:
        raise AppError(
            "VALIDATION_ERROR",
            "Timeline references assets that do not exist in this workspace",
            details={"violations": [{"code": "UNKNOWN_ASSET", "message": f"asset {m}", "path": "",
                                     "item_id": None} for m in missing]},
        )  # fmt: skip
    data = timeline.dump()
    new_revision = base_revision + 1
    stamp = utcnow()
    result = db.execute(
        update(Edit)
        .where(Edit.id == edit.id, Edit.revision == base_revision)
        .values(timeline=data, revision=new_revision, updated_at=stamp)
    )
    if result.rowcount != 1:  # type: ignore[attr-defined]
        db.refresh(edit)
        raise _conflict(edit, base_revision)
    db.add(
        EditRevision(edit_id=edit.id, revision=new_revision, timeline=data, note=note[:NOTE_MAX])
    )
    clip.updated_at = stamp
    db.flush()
    db.refresh(edit)
    changed = ts.layer_changes(before, timeline)
    for group in changed:
        action = "layer_accepted" if group["status"] == "accepted" else "layer_rejected"
        log_activity(
            db, workspace_id, action, "clip", clip.id,
            clip_id=clip.id, content_item_id=clip.content_item_id, layer=group["layer"],
            kind=group["kind"], item_ids=group["item_ids"], count=len(group["item_ids"]),
            sources=group["sources"], revision=new_revision,
        )  # fmt: skip
    return {"revision": new_revision, "timeline": timeline, "updated_at": stamp, "changed": changed}


def save_edit(
    db: Session, workspace_id: str, clip_id: str, timeline: Timeline, base_revision: int, note: str
) -> dict[str, Any]:
    clip, edit = _clip_edit(db, workspace_id, clip_id)
    _check_base(edit, base_revision)
    out = _commit(db, workspace_id, clip, edit, timeline, base_revision, note or "Saved")
    return {k: out[k] for k in ("revision", "timeline", "updated_at")}


def apply_op(
    db: Session,
    workspace_id: str,
    clip_id: str,
    op: str,
    params: dict[str, Any],
    base_revision: int,
    note: str = "",
) -> dict[str, Any]:
    """Run one deterministic op (Twin actions, editor shortcuts) and store the result."""
    clip, edit = _clip_edit(db, workspace_id, clip_id)
    _check_base(edit, base_revision)
    timeline = ts.parse_timeline(edit.timeline)
    assets = _assets(db, workspace_id, referenced_asset_ids(timeline))
    ctx = ts.OpContext(
        asset_durations=asset_durations(assets),
        silences={
            a.id: [(float(s), float(e)) for s, e in (a.analysis or {}).get("silences") or []]
            for a in assets.values()
        },
        words_provider=lambda asset_id: _words(db, workspace_id, asset_id),
    )
    result = ts.apply_op(timeline, op, params, ctx)
    out = _commit(db, workspace_id, clip, edit, result, base_revision, note or f"op: {op}")
    return {
        "op": op,
        "revision": out["revision"],
        "timeline": out["timeline"],
        "changed_layers": out["changed"],
        "updated_at": out["updated_at"],
    }


# ── revisions ─────────────────────────────────────────────────────────────────────────────────
def list_revisions(db: Session, workspace_id: str, clip_id: str) -> list[dict[str, Any]]:
    _, edit = _clip_edit(db, workspace_id, clip_id)
    return [
        {
            "revision": r.revision,
            "note": r.note,
            "created_at": r.created_at,
            "duration": float((r.timeline or {}).get("duration") or 0.0),
            "video_items": len(((r.timeline or {}).get("tracks") or {}).get("video") or []),
        }
        for r in EditRepository(db).revisions(edit)
    ]


def get_revision(db: Session, workspace_id: str, clip_id: str, revision: int) -> dict[str, Any]:
    _, edit = _clip_edit(db, workspace_id, clip_id)
    row = EditRepository(db).revision(edit, revision)
    if row is None:
        raise not_found("Revision", revision=revision)
    return {
        "revision": row.revision,
        "note": row.note,
        "created_at": row.created_at,
        "timeline": ts.parse_timeline(row.timeline),
    }


def restore_revision(
    db: Session, workspace_id: str, clip_id: str, revision: int, base_revision: int | None
) -> dict[str, Any]:
    """New revision with the content of ``revision`` (history is never rewritten)."""
    clip, edit = _clip_edit(db, workspace_id, clip_id)
    row = EditRepository(db).revision(edit, revision)
    if row is None:
        raise not_found("Revision", revision=revision)
    base = edit.revision if base_revision is None else base_revision
    _check_base(edit, base)
    out = _commit(
        db,
        workspace_id,
        clip,
        edit,
        ts.parse_timeline(row.timeline),
        base,
        f"Restored revision {revision}",
    )
    return {k: out[k] for k in ("revision", "timeline", "updated_at")}
