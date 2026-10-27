"""Monetization: the creator's brand-deal pipeline, a transparent rate estimate, AI pitch emails
and a brand-site lookup that only reports what the brand publishes itself.

Honesty rules (HANDOFF section 4): every deal value is typed by the creator; the rate estimate is a
formula over the creator's own numbers and is labelled ``heuristic``; the pitch is written by a real
model (``LLM_NOT_CONFIGURED`` otherwise) from the creator's numbers only; the lookup returns emails
and links found on the pages it fetched, each with the page it came from, and never guesses one.
"""

from __future__ import annotations

import html
import re
from datetime import date
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.integrations.net import check_public_url, public_client
from app.llm import gateway as llm
from app.llm.schemas import SponsorPitchOutput
from app.models import BrandDeal, ContentItem, utcnow
from app.schemas.common import Provenance
from app.services.activity import log_activity

STAGES = ("prospect", "pitched", "negotiating", "contracted", "delivered", "paid", "lost")
OPEN_STAGES = ("pitched", "negotiating", "contracted", "delivered")
BOOKED_STAGES = ("contracted", "delivered")
EDITABLE = (
    "brand", "website", "contact_name", "contact_email", "stage", "fee", "currency",
    "deliverables", "due_date", "notes", "content_item_id",
)  # fmt: skip

# A starting range creators often quote for a YouTube integration, per 1,000 expected views.
# It is only a default for the calculator; the creator changes it to their own market.
DEFAULT_CPM = (20.0, 40.0)

LOOKUP_PATHS = ("", "/contact", "/contact-us", "/partners", "/partnerships", "/press", "/about")
LOOKUP_MAX_PAGES = 7
LOOKUP_MAX_BYTES = 1_000_000
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}")
NOT_EMAIL_SUFFIX = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".css", ".js")
SOCIAL_HOSTS = {
    "twitter.com": "x", "x.com": "x", "instagram.com": "instagram", "youtube.com": "youtube",
    "linkedin.com": "linkedin", "tiktok.com": "tiktok", "facebook.com": "facebook",
}  # fmt: skip


# ── deals ─────────────────────────────────────────────────────────────────────────────────────
def deal_out(d: BrandDeal) -> dict[str, Any]:
    return {
        "id": d.id,
        "brand": d.brand,
        "website": d.website,
        "contact_name": d.contact_name,
        "contact_email": d.contact_email,
        "stage": d.stage,
        "fee": d.fee,
        "currency": d.currency,
        "deliverables": d.deliverables,
        "due_date": d.due_date,
        "notes": d.notes,
        "content_item_id": d.content_item_id,
        "pitch": d.pitch,
        "overdue": _overdue(d),
        "created_at": d.created_at,
        "updated_at": d.updated_at,
    }


def _overdue(d: BrandDeal) -> bool:
    if not d.due_date or d.stage in ("delivered", "paid", "lost"):
        return False
    return d.due_date < date.today().isoformat()


def _require(db: Session, ws: str, deal_id: str) -> BrandDeal:
    row = db.get(BrandDeal, deal_id)
    if row is None or row.workspace_id != ws:
        raise not_found("Deal")
    return row


def _check_item(db: Session, ws: str, item_id: str | None) -> None:
    if item_id:
        item = db.get(ContentItem, item_id)
        if item is None or item.workspace_id != ws:
            raise not_found("Project")


def _clean(fields: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in fields.items() if k in EDITABLE}
    for key in ("brand", "website", "contact_name", "contact_email", "deliverables", "notes"):
        if key in out and out[key] is not None:
            out[key] = str(out[key]).strip()
    if out.get("website") and not re.match(r"^https?://", out["website"], re.I):
        out["website"] = "https://" + out["website"]
    if "stage" in out and out["stage"] not in STAGES:
        raise AppError("VALIDATION_ERROR", f"stage must be one of {', '.join(STAGES)}")
    if out.get("currency"):
        out["currency"] = str(out["currency"]).upper()[:3]
    return out


def list_deals(db: Session, ws: str, stage: str | None = None) -> list[dict[str, Any]]:
    q = select(BrandDeal).where(BrandDeal.workspace_id == ws)
    if stage:
        q = q.where(BrandDeal.stage == stage)
    return [deal_out(d) for d in db.scalars(q.order_by(BrandDeal.updated_at.desc()))]


def create_deal(db: Session, ws: str, fields: dict[str, Any]) -> dict[str, Any]:
    data = _clean(fields)
    if not data.get("brand"):
        raise AppError("VALIDATION_ERROR", "A deal needs a brand name.")
    _check_item(db, ws, data.get("content_item_id"))
    row = BrandDeal(workspace_id=ws, **data)
    db.add(row)
    db.flush()
    log_activity(db, ws, "deal_created", "brand_deal", row.id, brand=row.brand, stage=row.stage)
    return deal_out(row)


def update_deal(db: Session, ws: str, deal_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    row = _require(db, ws, deal_id)
    data = _clean(fields)
    if "brand" in data and not data["brand"]:
        raise AppError("VALIDATION_ERROR", "A deal needs a brand name.")
    if "content_item_id" in data:
        _check_item(db, ws, data["content_item_id"])
    before = row.stage
    for key, value in data.items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    db.flush()
    if row.stage != before:
        log_activity(
            db, ws, "deal_stage_changed", "brand_deal", row.id,
            brand=row.brand, from_stage=before, to_stage=row.stage,
        )  # fmt: skip
    return deal_out(row)


def delete_deal(db: Session, ws: str, deal_id: str) -> None:
    db.delete(_require(db, ws, deal_id))
    db.flush()


def summary(db: Session, ws: str) -> dict[str, Any]:
    """Pipeline numbers computed from the creator's own deals (no estimates)."""
    deals = list(db.scalars(select(BrandDeal).where(BrandDeal.workspace_id == ws)))
    currencies = sorted({d.currency for d in deals if d.fee is not None}) or ["USD"]
    by_stage = {s: {"count": 0, "value": 0.0} for s in STAGES}
    for d in deals:
        by_stage[d.stage]["count"] += 1
        by_stage[d.stage]["value"] += d.fee or 0.0
    paid = [d for d in deals if d.stage == "paid" and d.fee is not None]
    closed = [d for d in deals if d.stage in ("paid", "lost", *BOOKED_STAGES)]
    won = [d for d in closed if d.stage != "lost"]
    upcoming = sorted(
        (d for d in deals if d.due_date and d.stage not in ("paid", "lost")),
        key=lambda d: d.due_date or "",
    )
    return {
        "currency": currencies[0] if len(currencies) == 1 else None,
        "currencies": currencies,
        "by_stage": by_stage,
        "open_value": round(sum(by_stage[s]["value"] for s in OPEN_STAGES), 2),
        "booked_value": round(sum(by_stage[s]["value"] for s in BOOKED_STAGES), 2),
        "paid_value": round(sum(d.fee or 0 for d in paid), 2),
        "average_paid_fee": round(sum(d.fee or 0 for d in paid) / len(paid), 2) if paid else None,
        "win_rate": round(len(won) / len(closed), 3) if closed else None,
        "overdue": [deal_out(d) for d in deals if _overdue(d)],
        "upcoming": [deal_out(d) for d in upcoming[:5]],
        "total": len(deals),
    }


# ── rate estimate ─────────────────────────────────────────────────────────────────────────────
def rate_estimate(
    db: Session,
    ws: str,
    *,
    avg_views: int,
    cpm_low: float | None = None,
    cpm_high: float | None = None,
    placements: int = 1,
) -> dict[str, Any]:
    """``views / 1000 x CPM`` for a low and a high CPM, plus the creator's own paid history."""
    low = DEFAULT_CPM[0] if cpm_low is None else cpm_low
    high = DEFAULT_CPM[1] if cpm_high is None else cpm_high
    if high < low:
        low, high = high, low
    per = avg_views / 1000.0
    paid = [
        d.fee
        for d in db.scalars(
            select(BrandDeal).where(BrandDeal.workspace_id == ws, BrandDeal.stage == "paid")
        )
        if d.fee is not None
    ]
    return {
        "avg_views": avg_views,
        "cpm_low": low,
        "cpm_high": high,
        "placements": placements,
        "low": round(per * low * placements, 2),
        "high": round(per * high * placements, 2),
        "mid": round(per * (low + high) / 2 * placements, 2),
        "formula": "average views / 1000 x CPM x placements",
        "default_cpm": not (cpm_low is not None and cpm_high is not None),
        "history": {
            "paid_deals": len(paid),
            "average_fee": round(sum(paid) / len(paid), 2) if paid else None,
            "highest_fee": max(paid) if paid else None,
        },
        "provenance": Provenance.heuristic("rate-formula").model_dump(),
    }


# ── pitch ─────────────────────────────────────────────────────────────────────────────────────
def _stats_line(stats: dict[str, Any]) -> str:
    labels = {
        "subscribers": "subscribers",
        "avg_views": "average views per video",
        "audience": "audience",
        "top_countries": "top countries",
        "engagement": "engagement",
    }
    parts = [f"{labels[k]}: {v}" for k, v in stats.items() if k in labels and v not in (None, "")]
    return "; ".join(parts) or "none given"


def generate_pitch(
    db: Session, ws: str, deal_id: str, stats: dict[str, Any], extra: str = ""
) -> dict[str, Any]:
    deal = _require(db, ws, deal_id)
    video = ""
    if deal.content_item_id:
        item = db.get(ContentItem, deal.content_item_id)
        video = item.title if item else ""
    fee = f"{deal.fee:,.0f} {deal.currency}" if deal.fee is not None else ""
    variables = {
        "brand": deal.brand,
        "website": deal.website or "not given",
        "contact_name": deal.contact_name,
        "deliverables": deal.deliverables or "one sponsored integration in a video",
        "fee": fee,
        "video": video,
        "stats": _stats_line(stats),
        "notes": (extra or deal.notes or "")[:600],
    }
    out, meta = llm.run_with_meta("sponsors.pitch", variables, SponsorPitchOutput, ws, cache=False)
    deal = _require(db, ws, deal_id)  # re-read after the LLM call (no write held open during it)
    deal.pitch = {
        **out.model_dump(),
        "provenance": meta.provenance.model_dump(),
        "created_at": utcnow(),
    }
    deal.updated_at = utcnow()
    db.flush()
    log_activity(db, ws, "deal_pitch_written", "brand_deal", deal.id, brand=deal.brand)
    return deal_out(deal)


# ── brand lookup ──────────────────────────────────────────────────────────────────────────────
def _normalise_site(site: str) -> str:
    site = site.strip()
    if not re.match(r"^https?://", site, re.I):
        site = "https://" + site
    parsed = urlparse(site)
    if not parsed.hostname or "." not in parsed.hostname:
        raise AppError("VALIDATION_ERROR", "Enter the brand's website, for example acme.com")
    return f"{parsed.scheme.lower()}://{parsed.hostname.lower()}"


def _meta(text: str, name: str) -> str:
    m = re.search(
        rf'<meta[^>]+(?:name|property)=["\']{name}["\'][^>]*content=["\']([^"\']*)["\']',
        text,
        re.I,
    ) or re.search(
        rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:name|property)=["\']{name}["\']', text, re.I
    )
    return html.unescape(m.group(1)).strip() if m else ""


def _emails(text: str, host: str) -> list[str]:
    found = {html.unescape(e).strip(".").lower() for e in EMAIL_RE.findall(html.unescape(text))}
    out = []
    for e in sorted(found):
        if e.endswith(NOT_EMAIL_SUFFIX) or "example." in e or e.startswith(("u003e", "x22")):
            continue
        out.append(e)
    # the brand's own domain first, then the rest (agencies, PR firms)
    base = host.removeprefix("www.")
    return sorted(out, key=lambda e: (not e.split("@")[1].endswith(base), e))


def _socials(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for href in re.findall(r'href=["\'](https?://[^"\'\s>]+)', text, re.I):
        host = (urlparse(href).hostname or "").removeprefix("www.")
        key = SOCIAL_HOSTS.get(host)
        if key and key not in out and urlparse(href).path.strip("/"):
            out[key] = href
    return out


def brand_lookup(site: str, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """Fetch a few public pages of the brand's own site and report what they say about contact."""
    base = _normalise_site(site)
    if transport is None:
        check_public_url(base)
    host = urlparse(base).hostname or ""
    pages: list[dict[str, Any]] = []
    emails: dict[str, str] = {}
    socials: dict[str, str] = {}
    title = description = ""
    with public_client(transport=transport) as client:
        for path in LOOKUP_PATHS[:LOOKUP_MAX_PAGES]:
            url = urljoin(base + "/", path.lstrip("/")) if path else base
            try:
                res = client.get(url)
            except httpx.HTTPError as exc:
                pages.append({"url": url, "status": None, "error": type(exc).__name__})
                continue
            ctype = res.headers.get("content-type", "")
            if res.status_code >= 400 or "html" not in ctype:
                pages.append({"url": str(res.url), "status": res.status_code})
                continue
            text = res.text[:LOOKUP_MAX_BYTES]
            pages.append({"url": str(res.url), "status": res.status_code})
            if not path:
                t = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
                title = html.unescape(t.group(1)).strip()[:160] if t else ""
                description = (_meta(text, "description") or _meta(text, "og:description"))[:400]
            for e in _emails(text, host):
                emails.setdefault(e, str(res.url))
            for k, v in _socials(text).items():
                socials.setdefault(k, v)
    if not any(p.get("status") == 200 for p in pages):
        raise AppError(
            "DOWNLOAD_FAILED",
            f"Could not read {host}. Check the address or try again later.",
            details={"pages": pages},
        )
    ordered = _emails(" ".join(emails), host)
    return {
        "site": base,
        "title": title,
        "description": description,
        "emails": [{"email": e, "found_on": emails[e]} for e in ordered],
        "socials": socials,
        "pages": pages,
        "note": (
            "Only addresses printed on these pages are listed. None found means the brand does "
            "not publish one there: use its contact form or a partnerships page instead."
        ),
    }
