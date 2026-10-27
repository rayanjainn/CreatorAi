"""Sponsor briefs and slots (Plan.md section 8.10).

A brief belongs to a project (content item). ``find_slots`` scores the boundaries of the project's
main video transcript (``ml/sponsor_slots``), then asks the LLM once for every slot's read,
lower third and line back. Without a configured model the slots are still found (they are
deterministic, badged ``heuristic``) and the read is left for the creator to write. ``accept``
inserts the read as a sponsor placeholder into a clip through the normal edit path, so it gets a
revision and can be undone from the editor history.
"""

from __future__ import annotations

import itertools
from typing import Any

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.llm import gateway as llm
from app.llm.schemas import SponsorIntegrationOutput
from app.ml import sponsor_slots as slots_ml
from app.ml.embedder import embed_texts, embedder_provenance
from app.ml.vectors import unpack_vector
from app.models import Asset, AssetSegment, BrandDeal, ContentItem, SponsorBrief, SponsorSlot
from app.repositories.clips import EditRepository
from app.schemas.common import Provenance, weakest
from app.services import clip_service, edit_service
from app.services import timeline_service as ts
from app.services.activity import log_activity

BRIEF_FIELDS = ("brand", "product", "key_points", "cta", "do_not_say", "duration_sec", "deal_id")


# ── briefs ────────────────────────────────────────────────────────────────────────────────────
def brief_out(b: SponsorBrief) -> dict[str, Any]:
    return {
        "id": b.id,
        "content_item_id": b.content_item_id,
        "deal_id": b.deal_id,
        "brand": b.brand,
        "product": b.product,
        "key_points": b.key_points or [],
        "cta": b.cta,
        "do_not_say": b.do_not_say or [],
        "duration_sec": b.duration_sec,
        "created_at": b.created_at,
    }


def _item(db: Session, ws: str, item_id: str) -> ContentItem:
    item = db.get(ContentItem, item_id)
    if item is None or item.workspace_id != ws:
        raise not_found("Project")
    return item


def _brief(db: Session, ws: str, brief_id: str) -> SponsorBrief:
    row = db.get(SponsorBrief, brief_id)
    if row is None or row.workspace_id != ws:
        raise not_found("Sponsor brief")
    return row


def _slot(db: Session, ws: str, slot_id: str) -> SponsorSlot:
    row = db.get(SponsorSlot, slot_id)
    if row is None or row.workspace_id != ws:
        raise not_found("Sponsor slot")
    return row


def _clean_brief(db: Session, ws: str, fields: dict[str, Any]) -> dict[str, Any]:
    data = {k: v for k, v in fields.items() if k in BRIEF_FIELDS}
    for key in ("brand", "product", "cta"):
        if key in data and data[key] is not None:
            data[key] = str(data[key]).strip()
    for key in ("key_points", "do_not_say"):
        if key in data:
            data[key] = [str(x).strip() for x in data[key] or [] if str(x).strip()][:10]
    if data.get("deal_id"):
        deal = db.get(BrandDeal, data["deal_id"])
        if deal is None or deal.workspace_id != ws:
            raise not_found("Deal")
    return data


def list_briefs(db: Session, ws: str, item_id: str) -> list[dict[str, Any]]:
    _item(db, ws, item_id)
    rows = db.scalars(
        select(SponsorBrief)
        .where(SponsorBrief.workspace_id == ws, SponsorBrief.content_item_id == item_id)
        .order_by(SponsorBrief.created_at.desc())
    )
    return [{**brief_out(b), "slots": list_slots(db, ws, b.id)} for b in rows]


def create_brief(db: Session, ws: str, item_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    _item(db, ws, item_id)
    data = _clean_brief(db, ws, fields)
    if not data.get("brand") or not data.get("product"):
        raise AppError("VALIDATION_ERROR", "A sponsor brief needs a brand and a product.")
    row = SponsorBrief(workspace_id=ws, content_item_id=item_id, **data)
    db.add(row)
    db.flush()
    log_activity(db, ws, "sponsor_brief_created", "content_item", item_id, brand=row.brand)
    return {**brief_out(row), "slots": []}


def update_brief(db: Session, ws: str, brief_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    row = _brief(db, ws, brief_id)
    data = _clean_brief(db, ws, fields)
    if ("brand" in data and not data["brand"]) or ("product" in data and not data["product"]):
        raise AppError("VALIDATION_ERROR", "A sponsor brief needs a brand and a product.")
    for key, value in data.items():
        setattr(row, key, value)
    db.flush()
    return {**brief_out(row), "slots": list_slots(db, ws, row.id)}


def delete_brief(db: Session, ws: str, brief_id: str) -> None:
    db.delete(_brief(db, ws, brief_id))
    db.flush()


# ── slots ─────────────────────────────────────────────────────────────────────────────────────
def slot_out(s: SponsorSlot) -> dict[str, Any]:
    return {
        "id": s.id,
        "brief_id": s.brief_id,
        "asset_id": s.asset_id,
        "at_sec": s.at_sec,
        "kind": s.kind,
        "score": s.score,
        "rationale": s.rationale,
        "integration_script": s.integration_script,
        "lower_third": s.lower_third,
        "transition_back": s.transition_back,
        "status": s.status,
        "clip_id": s.clip_id,
        "provenance": s.provenance or Provenance.heuristic("sponsor-slots").model_dump(),
    }


def list_slots(db: Session, ws: str, brief_id: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(SponsorSlot)
        .where(SponsorSlot.workspace_id == ws, SponsorSlot.brief_id == brief_id)
        .order_by(SponsorSlot.at_sec)
    )
    return [slot_out(s) for s in rows]


def _segments(db: Session, ws: str, asset: Asset) -> tuple[list[slots_ml.Seg], np.ndarray]:
    rows = list(
        db.scalars(
            select(AssetSegment)
            .where(AssetSegment.workspace_id == ws, AssetSegment.asset_id == asset.id)
            .order_by(AssetSegment.idx)
        )
    )
    segs = [slots_ml.Seg(r.start_sec, r.end_sec, r.text) for r in rows]
    missing = [i for i, r in enumerate(rows) if not r.embedding]
    fresh = embed_texts([rows[i].text for i in missing]) if missing else None
    vectors = []
    for i, r in enumerate(rows):
        if r.embedding:
            vectors.append(unpack_vector(r.embedding))
        else:
            assert fresh is not None
            vectors.append(fresh[missing.index(i)])
    matrix = np.vstack(vectors).astype(np.float32) if vectors else np.zeros((0, 384), np.float32)
    return segs, matrix


def find_slots(db: Session, ws: str, brief_id: str, asset_id: str | None = None) -> dict[str, Any]:
    """Detect up to three slots for a brief and write their copy (one batched LLM call)."""
    brief = _brief(db, ws, brief_id)
    asset = clip_service.pick_source_asset(db, ws, brief.content_item_id, asset_id)
    segs, matrix = _segments(db, ws, asset)
    duration = float(asset.duration_sec or (segs[-1].end if segs else 0.0))
    brief_text = " ".join([brief.brand, brief.product, *(brief.key_points or [])])
    brief_vec = embed_texts([brief_text])[0]
    silences = [(float(s), float(e)) for s, e in (asset.analysis or {}).get("silences") or []]
    found = slots_ml.find_slots(segs, matrix, brief_vec, duration, silences)
    warnings: list[str] = []
    if not found:
        warnings.append(
            "No good slot was found: the video needs at least about 45 seconds of transcript with "
            "a sentence break after the first 15 seconds."
        )
    scores = Provenance.heuristic("sponsor-slots")
    if embedder_provenance().source != "ai":
        warnings.append("Slots were scored with the fallback embedder; run `make models`.")
    copy: dict[str, dict[str, str]] = {}
    copy_prov: Provenance | None = None
    if found:
        payload = []
        for n, cand in enumerate(found):
            before, after = slots_ml.context_window(segs, cand.index)
            payload.append({"slot_id": f"s{n}", "before": before, "after": after})
        try:
            out, meta = llm.run_with_meta(
                "sponsors.integration",
                {"brief": brief_out(brief), "slots": payload},
                SponsorIntegrationOutput,
                ws,
                cache=False,
            )
            copy = {c.slot_id: c.model_dump() for c in out.slots}
            copy_prov = meta.provenance
        except AppError as exc:
            if exc.code not in ("LLM_NOT_CONFIGURED", "LLM_BUSY", "LLM_INVALID_OUTPUT"):
                raise
            warnings.append(
                "The sponsor reads were not written: "
                + (
                    "no AI provider is configured. Write them yourself or add a key."
                    if exc.code == "LLM_NOT_CONFIGURED"
                    else "the AI provider did not answer. Try again in a minute."
                )
            )
    # writes happen after the LLM call (SQLite has one writer)
    brief = _brief(db, ws, brief_id)
    db.execute(
        delete(SponsorSlot).where(
            SponsorSlot.workspace_id == ws,
            SponsorSlot.brief_id == brief.id,
            SponsorSlot.status == "suggested",
        )
    )
    for n, cand in enumerate(found):
        c = copy.get(f"s{n}") or {}
        prov = weakest([scores, copy_prov]) if c and copy_prov else scores
        db.add(
            SponsorSlot(
                workspace_id=ws, brief_id=brief.id, asset_id=asset.id, at_sec=cand.at_sec,
                kind=cand.kind, score=cand.score, rationale=cand.rationale,
                integration_script=str(c.get("integration_script") or "").strip(),
                lower_third=str(c.get("lower_third") or "").strip()[:60],
                transition_back=str(c.get("transition_back") or "").strip(),
                provenance=(prov or scores).model_dump(),
            )
        )  # fmt: skip
    db.flush()
    log_activity(
        db, ws, "sponsor_slots_found", "content_item", brief.content_item_id,
        brief_id=brief.id, count=len(found), asset_id=asset.id,
    )  # fmt: skip
    return {
        "brief": brief_out(brief),
        "asset_id": asset.id,
        "slots": list_slots(db, ws, brief.id),
        "warnings": warnings,
        "provenance": (weakest([scores, copy_prov]) if copy_prov else scores).model_dump(),
    }


def update_slot(db: Session, ws: str, slot_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    row = _slot(db, ws, slot_id)
    edited = False
    for key in ("integration_script", "lower_third", "transition_back"):
        if key in fields and fields[key] is not None:
            setattr(row, key, str(fields[key]).strip()[: 60 if key == "lower_third" else 2000])
            edited = True
    if fields.get("status") in ("suggested", "rejected"):
        if row.status == "accepted":
            raise AppError("CONFLICT", "This slot is already in a clip; undo it in the editor.")
        row.status = fields["status"]
    if edited:
        row.provenance = Provenance.user().model_dump()
    db.flush()
    return slot_out(row)


def map_to_clip(timeline: Any, asset_id: str, at_sec: float, snap: float = 3.0) -> float | None:
    """Timeline time of source second ``at_sec`` of ``asset_id``, or ``None`` if it was cut.

    A slot usually sits in a pause, and cuts often remove pauses: when ``at_sec`` falls in a gap
    of at most ``snap`` seconds between two consecutive pieces of the same source, the slot goes
    at the cut between them.
    """
    items = ts.active(timeline.tracks.video)
    for item in items:
        if item.asset_id == asset_id and item.src_in <= at_sec < item.src_out:
            return round(item.tl_start + (at_sec - item.src_in), 3)
    for a, b in itertools.pairwise(items):
        same = a.asset_id == b.asset_id == asset_id
        if same and a.src_out <= at_sec <= b.src_in and b.src_in - a.src_out <= snap:
            return round(a.tl_start + a.duration, 3)
    return None


def accept(db: Session, ws: str, slot_id: str, clip_id: str) -> dict[str, Any]:
    """Insert the slot's read into a clip as a sponsor placeholder (a new edit revision)."""
    slot = _slot(db, ws, slot_id)
    brief = _brief(db, ws, slot.brief_id)
    if slot.status == "accepted" and slot.clip_id:
        raise AppError(
            "CONFLICT", "This slot is already in a clip.", details={"clip_id": slot.clip_id}
        )
    edit = EditRepository(db).for_clip(ws, clip_id)
    if edit is None:
        raise not_found("Clip")
    timeline = ts.parse_timeline(edit.timeline)
    at_tl = map_to_clip(timeline, slot.asset_id, slot.at_sec)
    if at_tl is None:
        raise AppError(
            "SLOT_OUTSIDE_CLIP",
            "This clip does not contain that moment of the video. Pick a clip that covers it, "
            "or use the full cut.",
            details={"at_sec": slot.at_sec, "clip_id": clip_id},
        )
    script = slot.integration_script or f"Sponsor read for {brief.brand}: record this part."
    result, item_id = ts.insert_sponsor(
        timeline, at_tl, duration=float(brief.duration_sec), script=script, brand=brief.brand,
        slot_id=slot.id,
    )  # fmt: skip
    saved = edit_service.save_edit(
        db, ws, clip_id, result, edit.revision, f"Sponsor slot: {brief.brand}"
    )
    slot.status, slot.clip_id = "accepted", clip_id
    db.flush()
    log_activity(
        db, ws, "sponsor_slot_accepted", "clip", clip_id,
        slot_id=slot.id, brand=brief.brand, at_tl=at_tl, revision=saved["revision"],
    )  # fmt: skip
    return {
        "slot": slot_out(slot),
        "clip_id": clip_id,
        "item_id": item_id,
        "at_tl": at_tl,
        "revision": saved["revision"],
    }


def disclosure_brands(db: Session, ws: str, clip_id: str) -> list[str]:
    """Brands with an accepted sponsor slot still present in the clip (for the publish note)."""
    edit = EditRepository(db).for_clip(ws, clip_id)
    if edit is None:
        return []
    timeline = ts.parse_timeline(edit.timeline)
    live = {o.sponsor_slot_id for o in ts.active(timeline.tracks.overlays) if o.sponsor_slot_id}
    if not live or not any(v.kind == "sponsor" for v in ts.active(timeline.tracks.video)):
        return []
    rows = db.execute(
        select(SponsorBrief.brand)
        .join(SponsorSlot, SponsorSlot.brief_id == SponsorBrief.id)
        .where(SponsorSlot.workspace_id == ws, SponsorSlot.id.in_(live))
    ).scalars()
    return sorted(set(rows))
