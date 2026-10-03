"""Creator context block prepended to every creative prompt (Plan.md section 7.2)."""

from __future__ import annotations

from sqlalchemy import select

from app.db import session_scope
from app.ml.embedder import embed_texts
from app.ml.vectors import top_k, unpack_matrix
from app.models import CreatorProfile, TwinMemory

MAX_CHARS = 1400
SNIPPET_WORDS = 60


def build_creator_context(workspace_id: str | None, query: str = "", top: int = 3) -> str:
    """Profile line, style summary, vocabulary and the ``top`` past works closest to ``query``."""
    if not workspace_id:
        return "CREATOR: unknown"
    with session_scope() as db:
        profile = db.get(CreatorProfile, workspace_id)
        if profile is None:
            return "CREATOR: unknown"
        memories = list(
            db.scalars(select(TwinMemory).where(TwinMemory.workspace_id == workspace_id))
        )
    style = profile.style_profile or {}
    vocab = style.get("vocabulary") or {}
    lines = [
        f"CREATOR: {profile.display_name} | DOMAIN: {profile.domain} | "
        f"AUDIENCE: {profile.audience or 'general'} | TONE: {profile.tone}",
        f"STYLE: {style.get('summary', '')}",
        f"FAVOR: {', '.join(vocab.get('favor', [])[:5])} "
        f"AVOID: {', '.join(vocab.get('avoid', [])[:5])}",
    ]
    snippets = _similar_work(memories, query, top)
    lines.append("SIMILAR PAST WORK: " + (" || ".join(snippets) if snippets else "none yet"))
    return "\n".join(lines)[:MAX_CHARS]


def _similar_work(memories: list[TwinMemory], query: str, top: int) -> list[str]:
    usable = [m for m in memories if m.embedding]
    if not usable or not query.strip():
        return []
    corpus = unpack_matrix([m.embedding for m in usable])
    hits = top_k(embed_texts([query])[0], corpus, top)
    return [" ".join(usable[i].text.split()[:SNIPPET_WORDS]) for i, score in hits if score > 0]
