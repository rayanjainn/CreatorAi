"""Hybrid library search (Plan.md section 8.4): vector + FTS5 lexical, fused with RRF (k = 60).

* Vector: numpy cosine over ``asset_segments`` (speech) and ``asset_shots`` (visual captions). The
  per-workspace matrices are cached in memory and dropped by ``invalidate`` on every write, so a
  query costs one embedding plus two matrix-vector products.
* Lexical: SQLite FTS5 (``asset_segments_fts``) over the transcript, BM25-ranked.
* Fusion: ``score = sum(1 / (60 + rank))`` over the rank lists a hit appears in; hits of one asset
  within 8 s of each other are merged. Vectors from a different embedder are never mixed in: such
  assets still match lexically and are reported in ``warnings`` until ``reindex`` re-embeds them.
"""

from __future__ import annotations

import logging
import re
import threading
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ml.embedder import STOPWORDS, embed_texts, embedder_info, embedder_provenance
from app.ml.vectors import EMBED_DIM, Matrix, unpack_vector
from app.schemas.common import Provenance
from app.security import sign_media

log = logging.getLogger(__name__)

RRF_K = 60
CANDIDATES = 30
MERGE_GAP_SEC = 8.0
MAX_MERGED_SPAN_SEC = 45.0
SNIPPET_CHARS = 240
_WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)


# ── pure helpers ──────────────────────────────────────────────────────────────────────────────
def rrf_fuse(rank_lists: Iterable[Sequence[str]], k: int = RRF_K) -> dict[str, float]:
    """Reciprocal Rank Fusion: each list contributes ``1 / (k + rank)`` (rank starts at 1)."""
    scores: dict[str, float] = {}
    for ranking in rank_lists:
        for rank, key in enumerate(ranking, start=1):
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
    return scores


def fts_query(query: str, max_terms: int = 12) -> str | None:
    """An FTS5 ``OR`` query of quoted content words (stopwords dropped); ``None`` if empty."""
    seen: dict[str, None] = {}
    for word in _WORD_RE.findall(query.lower()):
        if len(word) > 1 and word not in STOPWORDS:
            seen[word] = None
    terms = list(seen)[:max_terms]
    return " OR ".join(f'"{t}"' for t in terms) if terms else None


@dataclass
class Hit:
    asset_id: str
    start: float
    end: float
    kind: str  # speech | visual
    snippet: str
    score: float = 0.0
    similarity: float | None = None
    keys: list[str] = field(default_factory=list)


def merge_hits(
    hits: list[Hit], gap: float = MERGE_GAP_SEC, max_span: float = MAX_MERGED_SPAN_SEC
) -> list[Hit]:
    """Merge hits of the same asset that are within ``gap`` seconds (best-scored hit wins).

    ``hits`` must be sorted best first; the survivor keeps its score/snippet and its time range is
    widened to cover the merged hits (unless that would exceed ``max_span`` seconds).
    """
    kept: list[Hit] = []
    for hit in hits:
        target = None
        for other in kept:
            if other.asset_id != hit.asset_id:
                continue
            distance = max(hit.start - other.end, other.start - hit.end, 0.0)
            span = max(hit.end, other.end) - min(hit.start, other.start)
            if distance <= gap and span <= max_span:
                target = other
                break
        if target is None:
            kept.append(hit)
            continue
        target.start, target.end = min(target.start, hit.start), max(target.end, hit.end)
        target.similarity = max(
            (v for v in (target.similarity, hit.similarity) if v is not None), default=None
        )
    return kept


# ── per-workspace index ───────────────────────────────────────────────────────────────────────
@dataclass
class AssetMeta:
    id: str
    filename: str
    kind: str
    content_item_id: str | None
    thumb_key: str | None


@dataclass
class _Rows:
    ids: list[str] = field(default_factory=list)
    asset_idx: list[int] = field(default_factory=list)
    start: list[float] = field(default_factory=list)
    end: list[float] = field(default_factory=list)
    text: list[str] = field(default_factory=list)
    vectors: list[np.ndarray] = field(default_factory=list)


@dataclass
class Index:
    backend: str
    model: str
    assets: list[AssetMeta]
    asset_pos: dict[str, int]
    seg: _Rows
    shot: _Rows
    seg_matrix: Matrix
    shot_matrix: Matrix
    seg_asset: np.ndarray
    shot_asset: np.ndarray
    keyframes: dict[str, list[tuple[float, float, str]]]  # asset -> (start, end, key)
    stale_assets: int = 0


_lock = threading.RLock()
_cache: dict[str, Index] = {}


def invalidate(workspace_id: str | None = None) -> None:
    """Drop the cached index of a workspace (or all). Call after any write to segments, shots,
    embeddings, asset status or asset metadata (filename, content item, thumbnail)."""
    with _lock:
        if workspace_id is None:
            _cache.clear()
        else:
            _cache.pop(workspace_id, None)


def _matrix(rows: _Rows) -> Matrix:
    if not rows.vectors:
        return np.zeros((0, EMBED_DIM), dtype=np.float32)
    return np.vstack(rows.vectors).astype(np.float32, copy=False)


def build_index(db: Session, workspace_id: str, backend: str, model: str) -> Index:
    """Load every ready asset's vectors that match the active embedder into numpy matrices."""
    assets: list[AssetMeta] = []
    asset_pos: dict[str, int] = {}
    compatible: set[str] = set()
    stale = 0
    for row in db.execute(
        text(
            "select id, filename, kind, content_item_id, thumb_key, "
            "json_extract(analysis,'$.embedder.backend'), "
            "json_extract(analysis,'$.embedder.model') "
            "from assets where workspace_id = :ws and status = 'ready'"
        ),
        {"ws": workspace_id},
    ):
        asset_pos[row[0]] = len(assets)
        assets.append(AssetMeta(row[0], row[1], row[2], row[3], row[4]))
        if row[5] == backend and row[6] == model:
            compatible.add(row[0])
        elif row[5] is not None:
            stale += 1

    def load(table: str, with_text: str) -> _Rows:
        rows = _Rows()
        sql = (
            f"select t.id, t.asset_id, t.start_sec, t.end_sec, {with_text}, t.embedding "
            f"from {table} t join assets a on a.id = t.asset_id "
            "where t.workspace_id = :ws and a.status = 'ready' and t.embedding is not null"
        )
        for rid, aid, start, end, snippet, blob in db.execute(text(sql), {"ws": workspace_id}):
            if aid not in compatible or len(blob) != EMBED_DIM * 4:
                continue
            rows.ids.append(rid)
            rows.asset_idx.append(asset_pos[aid])
            rows.start.append(float(start))
            rows.end.append(float(end))
            rows.text.append(snippet)
            rows.vectors.append(unpack_vector(blob))
        return rows

    seg = load("asset_segments", "t.text")
    shot = load("asset_shots", "trim(t.caption || ' ' || replace(replace(t.tags,'[',''),']',''))")
    keyframes: dict[str, list[tuple[float, float, str]]] = {}
    for aid, start, end, key in db.execute(
        text(
            "select asset_id, start_sec, end_sec, keyframe_key from asset_shots "
            "where workspace_id = :ws and keyframe_key is not null order by asset_id, idx"
        ),
        {"ws": workspace_id},
    ):
        keyframes.setdefault(aid, []).append((float(start), float(end), key))
    return Index(
        backend=backend,
        model=model,
        assets=assets,
        asset_pos=asset_pos,
        seg=seg,
        shot=shot,
        seg_matrix=_matrix(seg),
        shot_matrix=_matrix(shot),
        seg_asset=np.asarray(seg.asset_idx, dtype=np.int64),
        shot_asset=np.asarray(shot.asset_idx, dtype=np.int64),
        keyframes=keyframes,
        stale_assets=stale,
    )


def get_index(db: Session, workspace_id: str) -> Index:
    info = embedder_info()
    with _lock:
        cached = _cache.get(workspace_id)
        if cached and (cached.backend, cached.model) == (info["backend"], info["model"]):
            return cached
        index = build_index(db, workspace_id, info["backend"], info["model"])
        _cache[workspace_id] = index
        return index


# ── search ────────────────────────────────────────────────────────────────────────────────────
def _vector_top(
    matrix: Matrix, assets: np.ndarray, allowed: np.ndarray, query: np.ndarray, floor: float
) -> list[tuple[int, float]]:
    """Best ``CANDIDATES`` rows (``index, cosine``) among allowed assets with cosine >= floor."""
    if matrix.shape[0] == 0 or not allowed.any():
        return []
    mask = allowed[assets]
    rows = np.flatnonzero(mask)
    if rows.size == 0:
        return []
    scores = matrix[rows] @ query  # stored vectors and the query are L2-normalised
    take = min(CANDIDATES, scores.shape[0])
    best = np.argpartition(-scores, take - 1)[:take]
    ordered = best[np.argsort(-scores[best])]
    return [(int(rows[i]), float(scores[i])) for i in ordered if scores[i] >= floor]


def _lexical_top(
    db: Session,
    workspace_id: str,
    match: str,
    content_item_id: str | None,
    asset_kind: str | None,
) -> list[tuple[str, str, float, float, str]]:
    sql = (
        "select s.id, s.asset_id, s.start_sec, s.end_sec, s.text "
        "from asset_segments_fts f join asset_segments s on s.rowid = f.rowid "
        "join assets a on a.id = s.asset_id "
        "where asset_segments_fts match :m and s.workspace_id = :ws and a.status = 'ready'"
    )
    params: dict[str, Any] = {"m": match, "ws": workspace_id, "n": CANDIDATES}
    if content_item_id:
        sql += " and a.content_item_id = :ci"
        params["ci"] = content_item_id
    if asset_kind:
        sql += " and a.kind = :ak"
        params["ak"] = asset_kind
    sql += " order by f.rank limit :n"
    return [tuple(r) for r in db.execute(text(sql), params)]  # type: ignore[misc]


def _thumb(index: Index, asset_id: str, at_sec: float) -> str | None:
    frames = index.keyframes.get(asset_id, [])
    for start, end, key in frames:
        if start <= at_sec <= end:
            return sign_media(key)
    if frames:
        nearest = min(frames, key=lambda f: min(abs(f[0] - at_sec), abs(f[1] - at_sec)))
        return sign_media(nearest[2])
    meta = index.assets[index.asset_pos[asset_id]] if asset_id in index.asset_pos else None
    return sign_media(meta.thumb_key) if meta and meta.thumb_key else None


def search(
    db: Session,
    workspace_id: str,
    query: str,
    *,
    limit: int = 10,
    content_item_id: str | None = None,
    kind: str | None = None,
    asset_kind: str | None = None,
) -> dict[str, Any]:
    """Hybrid search; ``kind`` is ``speech`` or ``visual``, ``asset_kind`` video/audio/image."""
    query = query.strip()
    index = get_index(db, workspace_id)
    provenance = embedder_provenance()
    allowed = np.array(
        [
            (content_item_id is None or a.content_item_id == content_item_id)
            and (asset_kind is None or a.kind == asset_kind)
            for a in index.assets
        ],
        dtype=bool,
    )
    floor = get_settings().match_thresholds(index.backend)[1]
    qvec = embed_texts([query])[0]
    hits: dict[str, Hit] = {}
    vec_seg: list[str] = []
    vec_shot: list[str] = []
    lex_seg: list[str] = []

    if kind in (None, "speech"):
        for row, sim in _vector_top(index.seg_matrix, index.seg_asset, allowed, qvec, floor):
            key = f"seg:{index.seg.ids[row]}"
            vec_seg.append(key)
            hits[key] = Hit(
                index.assets[index.seg.asset_idx[row]].id,
                index.seg.start[row],
                index.seg.end[row],
                "speech",
                index.seg.text[row],
                similarity=sim,
            )
        match = fts_query(query)
        if match:
            for sid, aid, start, end, body in _lexical_top(
                db, workspace_id, match, content_item_id, asset_kind
            ):
                key = f"seg:{sid}"
                lex_seg.append(key)
                hits.setdefault(key, Hit(aid, float(start), float(end), "speech", body))
    if kind in (None, "visual"):
        for row, sim in _vector_top(index.shot_matrix, index.shot_asset, allowed, qvec, floor):
            key = f"shot:{index.shot.ids[row]}"
            vec_shot.append(key)
            hits[key] = Hit(
                index.assets[index.shot.asset_idx[row]].id,
                index.shot.start[row],
                index.shot.end[row],
                "visual",
                index.shot.text[row],
                similarity=sim,
            )

    fused = rrf_fuse([vec_seg, lex_seg, vec_shot])
    ranked = sorted(fused, key=lambda k: (-fused[k], k))
    ordered: list[Hit] = []
    for key in ranked:
        hit = hits[key]
        hit.score = fused[key]
        ordered.append(hit)
    results = []
    for hit in merge_hits(ordered)[:limit]:
        meta = index.assets[index.asset_pos[hit.asset_id]]
        mid = (hit.start + hit.end) / 2
        results.append(
            {
                "asset_id": hit.asset_id,
                "filename": meta.filename,
                "start_sec": round(hit.start, 3),
                "end_sec": round(hit.end, 3),
                "kind": hit.kind,
                "asset_kind": meta.kind,
                "snippet": hit.snippet.strip()[:SNIPPET_CHARS],
                "thumb_url": _thumb(index, hit.asset_id, mid),
                "score": round(hit.score, 6),
                "similarity": None if hit.similarity is None else round(hit.similarity, 4),
            }
        )
    warnings: list[str] = []
    if index.stale_assets:
        warnings.append(
            f"{index.stale_assets} asset(s) were embedded with a different model and only match "
            "by keywords; run POST /search/reindex to re-embed them."
        )
    if provenance.source != "ai":
        warnings.append(
            "Search uses the heuristic hashing embedder, not a neural model; run `make models`."
        )
    return {
        "query": query,
        "results": results,
        "provenance": provenance,
        "embedder": {k: embedder_info()[k] for k in ("backend", "model", "real")},
        "warnings": warnings,
    }


def reindex(db: Session, workspace_id: str, force: bool = False) -> dict[str, Any]:
    """Queue an embed-only re-run for assets whose vectors came from another embedder."""
    from app.models import Asset
    from app.repositories.assets import AssetRepository
    from app.services.assets import start_processing

    info = embedder_info()
    repo = AssetRepository(db)
    targets: list[Asset] = []
    for asset in repo.list(workspace_id, limit=100_000, status="ready"):
        if asset.kind not in ("video", "audio", "image"):
            continue
        stored = (asset.analysis or {}).get("embedder") or {}
        stale = (stored.get("backend"), stored.get("model")) != (info["backend"], info["model"])
        if (force or stale) and not repo.active_jobs(workspace_id, asset.id):
            targets.append(asset)
    job_ids: list[str] = []
    for asset in targets:
        job_id = start_processing(
            db, workspace_id, asset, from_stage="embed", skip_hooks=True, reindex=True
        )
        if job_id:
            job_ids.append(job_id)
    invalidate(workspace_id)
    return {
        "queued": len(job_ids),
        "job_ids": job_ids,
        "embedder": {k: info[k] for k in ("backend", "model", "real")},
        "provenance": Provenance.model_validate(info["provenance"]),
    }
