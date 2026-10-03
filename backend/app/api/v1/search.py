"""Hybrid library search (vector + keyword, RRF) and re-indexing."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.deps import CtxDep, DbDep
from app.schemas.assets import ReindexOut, ReindexRequest, SearchOut
from app.services import search_service

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=SearchOut)
def search(
    ctx: CtxDep,
    db: DbDep,
    q: Annotated[str, Query(min_length=1, max_length=300, description="Natural-language query")],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    content_item_id: str | None = None,
    kind: Annotated[
        str | None, Query(pattern="^(speech|visual)$", description="Hit type filter")
    ] = None,
    asset_kind: Annotated[str | None, Query(pattern="^(video|audio|image)$")] = None,
) -> dict[str, Any]:
    """Moments across the library: ``{asset_id, filename, start_sec, end_sec, kind, snippet,
    thumb_url, score}`` plus ``provenance`` (``heuristic`` when the hashing embedder is active)."""
    return search_service.search(
        db,
        ctx.workspace_id,
        q,
        limit=limit,
        content_item_id=content_item_id,
        kind=kind,
        asset_kind=asset_kind,
    )


@router.post("/reindex", response_model=ReindexOut, status_code=202)
def reindex(ctx: CtxDep, db: DbDep, body: ReindexRequest | None = None) -> dict[str, Any]:
    """Re-embed assets whose vectors came from a different embedder (``force`` re-embeds all)."""
    return search_service.reindex(db, ctx.workspace_id, force=bool(body and body.force))
