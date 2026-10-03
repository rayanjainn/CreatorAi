"""Hooks, script generation, versioning, editing and scene tools.

Plain Python (no FastAPI). Every LLM call happens before the first write of the request.

Script row layout (``scripts``): ``scenes`` follows Plan 6.6; ``meta`` holds the publishing
metadata (titles, description, ctas, captions, tags, supporting) plus these reserved keys:

``generation``       word-count metric, hook repair flag, plan version used
``edited_by_user``   ``{body_md, selected_hook, meta: bool, scenes: [idx]}``
``scene_provenance`` ``{"<idx>": Provenance}`` for scenes regenerated or tightened on their own
``meta_provenance``  provenance of the publishing metadata (``script.meta`` / generation)
``approval``         ``{approved_at, version, via}`` once the script is approved
``beats_embedding``  embedder (backend, model, provenance) behind ``script_beats.embedding``
"""

from __future__ import annotations

import logging
import re
from typing import Any

from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.llm import gateway as llm
from app.llm.schemas import HooksOutput, SceneRewriteOutput, ScriptGenerateOutput, ScriptMeta
from app.ml.embedder import embed_texts, embedder_info, embedder_provenance
from app.ml.hooks import classify_hook, hook_signals
from app.ml.vectors import pack_vector
from app.models import ContentItem, Script, ScriptBeat
from app.repositories.content import (
    ContentItemRepository,
    DirectorOutputRepository,
    ScriptBeatRepository,
    ScriptRepository,
)
from app.repositories.profiles import ProfileRepository
from app.schemas.common import Provenance, weakest
from app.services import content_service
from app.services.activity import log_activity

log = logging.getLogger(__name__)

WORDS_PER_SEC = 2.5
WORD_COUNT_TOLERANCE = 0.25  # +-25 % of length_sec * 2.5 words is "on target"
BEAT_MAX_WORDS = 28
MOCK_BANNER = "[MOCK] Offline mock output, not AI generated."
PATCHABLE = ("body_md", "scenes", "selected_hook", "meta")
PUBLISH_FIELDS = ("titles", "description", "ctas", "captions", "tags", "supporting")
DEFAULT_LENGTH_SEC = 45

_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’-]*")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


# ── pure helpers (unit-tested) ────────────────────────────────────────────────────────────────
def count_words(text: str) -> int:
    return len(_WORD.findall(text or ""))


def est_sec(text: str) -> float:
    """Spoken seconds at 2.5 words per second, one decimal."""
    return round(count_words(text) / WORDS_PER_SEC, 1)


def _clean(text: str) -> str:
    return " ".join(str(text or "").split())


def split_beats(text: str) -> list[str]:
    """Split spoken text into beats of one or two sentences (two only when short enough)."""
    sentences = [s.strip() for s in _SENTENCE_END.split(_clean(text)) if s.strip()]
    beats: list[str] = []
    i = 0
    while i < len(sentences):
        current = sentences[i]
        if i + 1 < len(sentences) and (
            count_words(current) + count_words(sentences[i + 1]) <= BEAT_MAX_WORDS
        ):
            current = f"{current} {sentences[i + 1]}"
            i += 1
        beats.append(current)
        i += 1
    return beats


def normalize_scenes(
    raw: list[dict[str, Any]], intents: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    """Canonical scenes: sequential ``idx``, beats re-derived from text when missing, ``text`` =
    beats joined, ``est_sec`` from word counts (the LLM's estimates are not trusted)."""
    intents = intents or {}
    out: list[dict[str, Any]] = []
    for scene in raw:
        beats: list[dict[str, Any]] = []
        for beat in scene.get("beats") or []:
            text = _clean(beat.get("text", ""))
            if text:
                beats.append({"text": text, "intent": str(beat.get("intent") or "")})
        if not beats:
            beats = [{"text": t, "intent": ""} for t in split_beats(scene.get("text", ""))]
        if not beats:
            continue
        for beat in beats:
            beat["intent"] = beat["intent"] or intents.get(beat["text"], "")
        out.append(
            {
                "idx": len(out),
                "title": _clean(scene.get("title", "")) or f"Scene {len(out) + 1}",
                "intent": _clean(scene.get("intent", "")),
                "est_sec": round(sum(est_sec(b["text"]) for b in beats), 1),
                "text": " ".join(b["text"] for b in beats),
                "beats": [
                    {
                        "idx": j,
                        "text": b["text"],
                        "intent": b["intent"],
                        "est_sec": est_sec(b["text"]),
                    }
                    for j, b in enumerate(beats)
                ],
            }
        )
    return out


def _overlap(a: str, b: str) -> float:
    sa = {w.lower() for w in _WORD.findall(a)}
    sb = {w.lower() for w in _WORD.findall(b)}
    return len(sa & sb) / len(sa | sb) if sa and sb else 0.0


def ensure_hook(scenes: list[dict[str, Any]], hook: str) -> tuple[list[dict[str, Any]], bool]:
    """Make the first scene start with ``hook`` verbatim. Returns ``(scenes, repaired)``.

    If the first sentence of the first beat is a paraphrase of the hook (word overlap >= 0.5) it
    is replaced by the hook, otherwise the hook is prepended as its own beat.
    """
    hook = _clean(hook)
    if not hook or not scenes:
        return scenes, False
    if _clean(scenes[0]["text"]).startswith(hook):
        return scenes, False
    first = scenes[0]
    beats = [dict(b) for b in first["beats"]]
    sentences = _SENTENCE_END.split(beats[0]["text"], maxsplit=1)
    if _overlap(sentences[0], hook) >= 0.5:
        tail = sentences[1] if len(sentences) > 1 else ""
        beats[0] = {**beats[0], "text": f"{hook} {tail}".strip()}
    else:
        beats.insert(0, {"text": hook, "intent": "hook"})
    fixed = normalize_scenes([{**first, "beats": beats}, *scenes[1:]])
    return fixed, True


def word_count_check(scenes: list[dict[str, Any]], length_sec: int) -> dict[str, Any]:
    words = sum(count_words(s["text"]) for s in scenes)
    target = round(length_sec * WORDS_PER_SEC)
    ratio = words / target if target else 0.0
    return {
        "words": words,
        "target_words": target,
        "ratio": round(ratio, 2),
        "within_tolerance": abs(ratio - 1) <= WORD_COUNT_TOLERANCE,
    }


def render_body_md(title: str, scenes: list[dict[str, Any]]) -> str:
    parts = [f"# {title.strip() or 'Script'}"]
    parts += [f"## {s['title']}\n{s['text']}" for s in scenes]
    return "\n\n".join(parts)


# ── provenance of a stored script ─────────────────────────────────────────────────────────────
def _prov(raw: Any) -> Provenance | None:
    try:
        return Provenance.model_validate(raw) if raw else None
    except ValueError:
        return None


def generation_provenance(script: Script) -> Provenance | None:
    if not script.provider:
        return None
    source = "mock" if script.provider == "mock" else "ai"
    return Provenance(source=source, provider=script.provider, model=script.model)  # type: ignore[arg-type]


def edited_flags(script: Script) -> dict[str, Any]:
    raw = (script.meta or {}).get("edited_by_user") or {}
    return {
        "body_md": bool(raw.get("body_md")),
        "selected_hook": bool(raw.get("selected_hook")),
        "meta": bool(raw.get("meta")),
        "scenes": sorted({int(i) for i in raw.get("scenes") or []}),
    }


def part_provenance(script: Script) -> dict[str, Any]:
    """Provenance per part (``user`` once edited); ``overall`` is the weakest of the parts."""
    gen = generation_provenance(script)
    user = Provenance.user()
    default = gen or user
    flags = edited_flags(script)
    meta = script.meta or {}
    scene_prov = meta.get("scene_provenance") or {}
    parts: dict[str, Any] = {}
    if script.body_md:
        parts["body_md"] = user if flags["body_md"] else default
    scenes: list[Provenance] = []
    for scene in script.scenes or []:
        idx = int(scene["idx"])
        scenes.append(
            user if idx in flags["scenes"] else _prov(scene_prov.get(str(idx))) or default
        )
    if scenes:
        parts["scenes"] = scenes
    if script.selected_hook:
        option = next(
            (o for o in script.hook_options or [] if o.get("text") == script.selected_hook), None
        )
        hook_prov = _prov(option.get("provenance")) if option else None
        parts["selected_hook"] = user if flags["selected_hook"] or not hook_prov else hook_prov
    if any(meta.get(k) for k in PUBLISH_FIELDS):
        parts["meta"] = user if flags["meta"] else _prov(meta.get("meta_provenance")) or default
    flat = [p for v in parts.values() for p in (v if isinstance(v, list) else [v])]
    hook_provs = [_prov(o.get("provenance")) for o in script.hook_options or []]
    if not flat:
        flat = [p for p in hook_provs if p]
    return {"parts": parts, "overall": weakest(flat) or user}


def script_out(db: Session, workspace_id: str, script: Script) -> dict[str, Any]:
    prov = part_provenance(script)
    meta = script.meta or {}
    flags = edited_flags(script)
    scene_prov = {
        int(s["idx"]): p
        for s, p in zip(script.scenes or [], prov["parts"].get("scenes", []), strict=False)
    }
    scenes = [
        {
            **s,
            "provenance": scene_prov.get(int(s["idx"])),
            "edited_by_user": int(s["idx"]) in flags["scenes"],
        }
        for s in script.scenes or []
    ]
    words = sum(count_words(s["text"]) for s in script.scenes or [])
    profile = ProfileRepository(db).get(workspace_id)
    approval = meta.get("approval") or {}
    return {
        "id": script.id,
        "content_item_id": script.content_item_id,
        "version": script.version,
        "is_current": script.is_current,
        "hook_options": list(script.hook_options or []),
        "selected_hook": script.selected_hook,
        "body_md": script.body_md,
        "scenes": scenes,
        "meta": {k: meta[k] for k in PUBLISH_FIELDS if k in meta},
        "tone": script.tone,
        "platform": script.platform,
        "length_sec": script.length_sec,
        "provider": script.provider,
        "model": script.model,
        "created_at": script.created_at,
        "updated_at": script.updated_at,
        "counters": {
            "word_count": words,
            "est_sec": round(sum(float(s.get("est_sec") or 0) for s in script.scenes or []), 1),
            "target_sec": script.length_sec,
            "target_words": round(script.length_sec * WORDS_PER_SEC) if script.length_sec else None,
            "scene_count": len(script.scenes or []),
            "beat_count": sum(len(s.get("beats") or []) for s in script.scenes or []),
        },
        "style_applied": profile.style_profile_rev > 0,
        "approved": bool(approval),
        "approved_at": approval.get("approved_at"),
        "edited_by_user": flags,
        "generation": meta.get("generation") or {},
        "provenance": prov["overall"],
        "provenance_by_part": {
            k: v if not isinstance(v, list) else {str(i): p for i, p in enumerate(v)}
            for k, v in prov["parts"].items()
        },
    }


def version_out(script: Script) -> dict[str, Any]:
    flags = edited_flags(script)
    return {
        "id": script.id,
        "version": script.version,
        "is_current": script.is_current,
        "created_at": script.created_at,
        "updated_at": script.updated_at,
        "tone": script.tone,
        "platform": script.platform,
        "length_sec": script.length_sec,
        "selected_hook": script.selected_hook,
        "word_count": sum(count_words(s["text"]) for s in script.scenes or []),
        "scene_count": len(script.scenes or []),
        "approved": bool((script.meta or {}).get("approval")),
        "edited": bool(
            flags["body_md"] or flags["meta"] or flags["scenes"] or flags["selected_hook"]
        ),
        "provenance": part_provenance(script)["overall"],
    }


# ── lookups ───────────────────────────────────────────────────────────────────────────────────
def _item(db: Session, workspace_id: str, item_id: str) -> ContentItem:
    return ContentItemRepository(db).require(workspace_id, item_id)


def _script_and_item(db: Session, workspace_id: str, script_id: str) -> tuple[Script, ContentItem]:
    script = ScriptRepository(db).require(workspace_id, script_id)
    return script, _item(db, workspace_id, script.content_item_id)


def current_script(db: Session, workspace_id: str, item_id: str) -> Script:
    _item(db, workspace_id, item_id)
    script = ScriptRepository(db).current(workspace_id, item_id)
    if script is None:
        raise AppError(
            "NO_SCRIPT", "This content item has no script yet", details={"content_item_id": item_id}
        )
    return script


def list_versions(db: Session, workspace_id: str, item_id: str) -> list[dict[str, Any]]:
    _item(db, workspace_id, item_id)
    return [version_out(s) for s in ScriptRepository(db).versions(workspace_id, item_id)]


def _topic(item: ContentItem) -> str:
    return item.title if not item.idea_text else f"{item.title}. {item.idea_text[:200]}"


def _defaults(
    db: Session, workspace_id: str, tone: str | None, platform: str | None
) -> tuple[str, str]:
    profile = ProfileRepository(db).get(workspace_id)
    first_platform = (profile.platforms or ["youtube_shorts"])[0]
    return tone or profile.tone or "conversational", platform or first_platform


def _plan_structure(
    db: Session, workspace_id: str, item_id: str
) -> tuple[list[dict[str, Any]], int | None]:
    plan = DirectorOutputRepository(db).latest(workspace_id, item_id, "plan")
    if plan is None:
        return [], None
    return list((plan.payload or {}).get("structure") or []), plan.version


# ── beats ─────────────────────────────────────────────────────────────────────────────────────
def sync_beats(db: Session, workspace_id: str, script: Script) -> dict[str, Any] | None:
    """Make ``script_beats`` mirror ``script.scenes``; returns the embedder info recorded in meta.

    Beat rows whose (scene, beat) position and text are unchanged are kept (with their matches);
    changed or new beats are re-embedded. A different embedder backend re-embeds everything.
    """
    repo = ScriptBeatRepository(db)
    existing = {(b.scene_idx, b.beat_idx): b for b in repo.for_script(workspace_id, script.id)}
    wanted = [
        (int(s["idx"]), int(b["idx"]), b) for s in script.scenes or [] for b in s.get("beats") or []
    ]
    info: dict[str, Any] | None = None
    try:
        current = embedder_info()
        info = {
            "backend": current["backend"],
            "model": current["model"],
            "dim": current["dim"],
            "provenance": embedder_provenance().model_dump(),
        }
    except Exception:
        log.exception("embedder unavailable; script beats stored without embeddings")
    previous = (script.meta or {}).get("beats_embedding") or {}
    same_backend = bool(info) and (previous.get("backend"), previous.get("model")) == (
        info["backend"] if info else None,
        info["model"] if info else None,
    )
    keys = {(si, bi) for si, bi, _ in wanted}
    for key, row in existing.items():
        if key not in keys:
            db.delete(row)
    db.flush()
    todo: list[tuple[ScriptBeat | None, int, int, dict[str, Any]]] = []
    for si, bi, beat in wanted:
        row = existing.get((si, bi))
        if row is not None:
            row.intent = beat.get("intent", "")
            row.est_sec = float(beat.get("est_sec") or 0)
            if row.text == beat["text"] and row.embedding is not None and same_backend:
                continue
        todo.append((row, si, bi, beat))
    vectors = None
    if todo and info is not None:
        try:
            vectors = embed_texts([beat["text"] for _, _, _, beat in todo])
        except Exception:
            log.exception("embedding script beats failed; stored without embeddings")
    for n, (row, si, bi, beat) in enumerate(todo):
        blob = pack_vector(vectors[n]) if vectors is not None else None
        if row is None:
            db.add(
                ScriptBeat(
                    workspace_id=workspace_id,
                    script_id=script.id,
                    scene_idx=si,
                    beat_idx=bi,
                    text=beat["text"],
                    intent=beat.get("intent", ""),
                    est_sec=float(beat.get("est_sec") or 0),
                    embedding=blob,
                )
            )
        else:
            row.text, row.embedding = beat["text"], blob
    db.flush()
    if (info is not None and vectors is not None) or not todo:
        script.meta = {**(script.meta or {}), "beats_embedding": info}
    return info


# ── hooks ─────────────────────────────────────────────────────────────────────────────────────
def generate_hooks(
    db: Session,
    workspace_id: str,
    item_id: str,
    count: int,
    tone: str | None,
    platform: str | None,
) -> dict[str, Any]:
    item = _item(db, workspace_id, item_id)
    tone, platform = _defaults(db, workspace_id, tone, platform)
    out, meta = llm.run_with_meta(
        "script.hooks",
        {"topic": _topic(item), "count": count, "tone": tone, "platform": platform},
        HooksOutput,
        workspace_id,
        cache=False,
    )
    provenance = meta.provenance
    hooks, seen = [], set()
    for hook in out.hooks:
        text = _clean(hook.text)
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        hooks.append(
            {
                "text": text,
                "type": hook.type,
                "why": hook.why,
                "signal_score": round(hook_signals(text), 2),
                "detected_type": classify_hook(text),
                "provenance": provenance.model_dump(),
            }
        )
    hooks = hooks[:count]
    repo = ScriptRepository(db)
    script = repo.current(workspace_id, item.id)
    if script is None:
        script = repo.add(
            workspace_id, content_item_id=item.id, version=repo.next_version(workspace_id, item.id),
            is_current=True, tone=tone, platform=platform,
        )  # fmt: skip
    script.hook_options = hooks
    db.flush()
    log_activity(db, workspace_id, "hooks_generated", "script", script.id,
                 content_item_id=item.id, count=len(hooks),
                 provider=provenance.provider, source=provenance.source)  # fmt: skip
    return {
        "script_id": script.id,
        "hooks": [{k: v for k, v in h.items() if k != "provenance"} for h in hooks],
        "provenance": provenance,
    }


# ── generation ────────────────────────────────────────────────────────────────────────────────
def generate_script(
    db: Session,
    workspace_id: str,
    item_id: str,
    hook: str,
    tone: str | None,
    platform: str | None,
    length_sec: int | None,
) -> dict[str, Any]:
    item = _item(db, workspace_id, item_id)
    tone, platform = _defaults(db, workspace_id, tone, platform)
    length = length_sec or item.target_duration_sec or DEFAULT_LENGTH_SEC
    hook = _clean(hook)
    structure, plan_version = _plan_structure(db, workspace_id, item.id)
    out, meta = llm.run_with_meta(
        "script.generate",
        {
            "topic": _topic(item),
            "hook": hook,
            "tone": tone,
            "platform": platform,
            "length_sec": length,
            "structure": structure,
        },
        ScriptGenerateOutput,
        workspace_id,
        cache=False,
    )
    provenance = meta.provenance
    scenes = normalize_scenes([s.model_dump() for s in out.scenes])
    if not scenes:
        raise AppError("LLM_INVALID_OUTPUT", "The model returned a script without any spoken text")
    scenes, repaired = ensure_hook(scenes, hook)
    check = word_count_check(scenes, length)
    if not check["within_tolerance"]:
        log.warning(
            "script word count off target: %s words for %ss (target %s, ratio %s)",
            check["words"], length, check["target_words"], check["ratio"],
        )  # fmt: skip
    body = out.body_md.strip()
    if repaired or not body:
        body = render_body_md(item.title, scenes)
        if meta.is_mock:
            body = f"{MOCK_BANNER}\n\n{body}"

    repo = ScriptRepository(db)
    base = repo.current(workspace_id, item.id)
    reuse = base is not None and not base.scenes and not base.body_md
    if reuse:
        script = base
        assert script is not None
    else:
        hook_options = list(base.hook_options) if base else []
        repo.clear_current(workspace_id, item.id)
        script = repo.add(
            workspace_id, content_item_id=item.id,
            version=repo.next_version(workspace_id, item.id), is_current=True,
            hook_options=hook_options,
        )  # fmt: skip
    script.selected_hook = hook
    script.body_md = body
    script.scenes = scenes
    script.tone, script.platform, script.length_sec = tone, platform, length
    script.provider, script.model = meta.provider, meta.model
    script.meta = {
        **out.meta.model_dump(),
        "meta_provenance": provenance.model_dump(),
        "generation": {
            **check,
            "hook_repaired": repaired,
            "plan_version": plan_version,
            "used_plan_structure": bool(structure),
            "cache_hit": meta.cache_hit,
        },
    }
    db.flush()
    sync_beats(db, workspace_id, script)
    log_activity(db, workspace_id, "script_generated", "script", script.id,
                 content_item_id=item.id, version=script.version, words=check["words"],
                 provider=provenance.provider, source=provenance.source)  # fmt: skip
    return script_out(db, workspace_id, script)


# ── editing, versions, approval ───────────────────────────────────────────────────────────────
def get_script(db: Session, workspace_id: str, script_id: str) -> dict[str, Any]:
    script, _ = _script_and_item(db, workspace_id, script_id)
    return script_out(db, workspace_id, script)


def update_script(
    db: Session, workspace_id: str, script_id: str, patch: dict[str, Any]
) -> dict[str, Any]:
    """Apply user edits. Edited parts become provenance ``user`` (``meta.edited_by_user``)."""
    script, item = _script_and_item(db, workspace_id, script_id)
    meta = dict(script.meta or {})
    flags = edited_flags(script)
    scene_prov = dict(meta.get("scene_provenance") or {})
    scenes_changed = False

    if patch.get("selected_hook") is not None:
        hook = _clean(patch["selected_hook"])
        if hook != script.selected_hook:
            script.selected_hook = hook
            flags["selected_hook"] = True

    if patch.get("scenes") is not None:
        old = list(script.scenes or [])
        intents = {b["text"]: b.get("intent", "") for s in old for b in s.get("beats") or []}
        by_old_text = {s["text"]: s for s in old}
        raw_scenes = []
        for pos, raw in enumerate(patch["scenes"]):
            prior = by_old_text.get(_clean(raw.get("text", ""))) or (
                old[pos] if pos < len(old) and old[pos]["title"] == raw.get("title") else None
            )
            if prior is not None and not raw.get("intent"):
                raw = {**raw, "intent": prior.get("intent", "")}
            raw_scenes.append(raw)
        new = normalize_scenes(raw_scenes, intents)
        by_text = {s["text"]: s for s in old}
        new_flags: list[int] = []
        new_prov: dict[str, Any] = {}
        for scene in new:
            prior = by_text.get(scene["text"])
            if prior is None:
                new_flags.append(scene["idx"])  # new or reworded text: written by the user
                continue
            if int(prior["idx"]) in flags["scenes"]:
                new_flags.append(scene["idx"])
            if str(prior["idx"]) in scene_prov:
                new_prov[str(scene["idx"])] = scene_prov[str(prior["idx"])]
        if new != old:
            scenes_changed = True
            script.scenes = new
            flags["scenes"], scene_prov = sorted(set(new_flags)), new_prov
            if patch.get("body_md") is None:
                script.body_md = render_body_md(item.title, new)
                flags["body_md"] = True

    if patch.get("body_md") is not None and patch["body_md"] != script.body_md:
        script.body_md = patch["body_md"]
        flags["body_md"] = True

    if patch.get("meta"):
        changes = {k: v for k, v in patch["meta"].items() if v is not None}
        if changes:
            meta.update(changes)
            flags["meta"] = True

    meta["edited_by_user"] = flags
    meta["scene_provenance"] = scene_prov
    script.meta = meta
    db.flush()
    if scenes_changed:
        sync_beats(db, workspace_id, script)
    log_activity(db, workspace_id, "script_edited", "script", script.id,
                 content_item_id=item.id, version=script.version,
                 parts=[k for k in PATCHABLE if patch.get(k) is not None])  # fmt: skip
    return script_out(db, workspace_id, script)


def restore_script(db: Session, workspace_id: str, script_id: str) -> dict[str, Any]:
    """Make an older version the current one (history is kept; nothing is deleted)."""
    script, item = _script_and_item(db, workspace_id, script_id)
    if not script.is_current:
        repo = ScriptRepository(db)
        repo.clear_current(workspace_id, item.id)
        script.is_current = True
        db.flush()
        log_activity(db, workspace_id, "script_restored", "script", script.id,
                     content_item_id=item.id, version=script.version)  # fmt: skip
    return script_out(db, workspace_id, script)


def approve_script(db: Session, workspace_id: str, script_id: str) -> dict[str, Any]:
    """Approve the current script: moves its item to ``shoot`` (twin approval event)."""
    script, item = _script_and_item(db, workspace_id, script_id)
    if not script.is_current:
        raise AppError(
            "CONFLICT", "Only the current script version can be approved; restore it first"
        )
    if not script.scenes:
        raise AppError("NO_SCRIPT", "The script is empty", details={"content_item_id": item.id})
    if item.stage in ("idea", "script"):
        content_service.move_item(db, workspace_id, item.id, "shoot", via="approve")
    else:
        content_service.approve_current_script(db, workspace_id, item, script, via="approve")
    return script_out(db, workspace_id, script)


# ── scene tools and metadata ──────────────────────────────────────────────────────────────────
def rewrite_scene(
    db: Session,
    workspace_id: str,
    script_id: str,
    idx: int,
    mode: str,
    instruction: str = "",
    ratio: float = 0.75,
) -> dict[str, Any]:
    """``regenerate`` (``script.regenerate_scene``) or ``tighten`` (``script.tighten``) a scene."""
    script, item = _script_and_item(db, workspace_id, script_id)
    scenes = [dict(s) for s in script.scenes or []]
    if not 0 <= idx < len(scenes):
        raise not_found("Scene", scene_idx=idx)
    scene = scenes[idx]
    before = count_words(scene["text"])
    is_opening = idx == 0
    hook = script.selected_hook
    scene_view = {k: scene[k] for k in ("idx", "title", "intent", "text", "beats")}
    if mode == "tighten":
        task = "script.tighten"
        variables: dict[str, Any] = {
            "topic": _topic(item),
            "hook": hook,
            "scene": scene_view,
            "target_words": max(3, round(before * ratio)),
            "is_opening": is_opening,
        }
    else:
        task = "script.regenerate_scene"
        tone, platform = _defaults(db, workspace_id, script.tone, script.platform)
        variables = {
            "topic": _topic(item),
            "hook": hook,
            "tone": tone,
            "platform": platform,
            "scene": scene_view,
            "previous_scene": scenes[idx - 1]["text"] if idx > 0 else "",
            "next_scene": scenes[idx + 1]["text"] if idx + 1 < len(scenes) else "",
            "target_words": max(8, before),
            "instruction": instruction,
            "is_opening": is_opening,
        }
    out, meta = llm.run_with_meta(
        task, variables, SceneRewriteOutput, workspace_id, cache=mode == "tighten"
    )
    provenance = meta.provenance
    rewritten = normalize_scenes(
        [
            {
                "title": scene["title"],
                "intent": out.intent or scene.get("intent", ""),
                "beats": [b.model_dump() for b in out.beats],
            }
        ]
    )
    if not rewritten:
        raise AppError("LLM_INVALID_OUTPUT", "The model returned an empty scene")
    if is_opening and hook:
        rewritten, _ = ensure_hook(rewritten, hook)
    scenes[idx] = {**rewritten[0], "idx": idx}
    script.scenes = normalize_scenes(scenes)
    script.body_md = render_body_md(item.title, script.scenes)
    flags = edited_flags(script)
    flags["scenes"] = [i for i in flags["scenes"] if i != idx]
    scene_prov = dict((script.meta or {}).get("scene_provenance") or {})
    scene_prov[str(idx)] = provenance.model_dump()
    script.meta = {**(script.meta or {}), "edited_by_user": flags, "scene_provenance": scene_prov}
    db.flush()
    sync_beats(db, workspace_id, script)
    log_activity(db, workspace_id, f"scene_{mode}d", "script", script.id,
                 content_item_id=item.id, scene_idx=idx, words_before=before,
                 provider=provenance.provider, source=provenance.source)  # fmt: skip
    return {
        "script": script_out(db, workspace_id, script),
        "scene": script.scenes[idx],
        "words_before": before,
        "words_after": count_words(script.scenes[idx]["text"]),
        "provenance": provenance,
    }


def generate_meta(db: Session, workspace_id: str, script_id: str) -> dict[str, Any]:
    """``script.meta``: titles, description, CTAs, captions, tags, pinned comment, thumb text."""
    script, item = _script_and_item(db, workspace_id, script_id)
    if not script.scenes:
        raise AppError("NO_SCRIPT", "Generate or write the script first",
                       details={"content_item_id": item.id})  # fmt: skip
    text = "\n".join(s["text"] for s in script.scenes)
    out, meta = llm.run_with_meta(
        "script.meta", {"topic": item.title, "script_text": text}, ScriptMeta, workspace_id
    )
    provenance = meta.provenance
    flags = edited_flags(script)
    flags["meta"] = False
    script.meta = {
        **(script.meta or {}),
        **out.model_dump(),
        "edited_by_user": flags,
        "meta_provenance": provenance.model_dump(),
    }
    db.flush()
    log_activity(db, workspace_id, "script_meta_generated", "script", script.id,
                 content_item_id=item.id, provider=provenance.provider,
                 source=provenance.source)  # fmt: skip
    return {
        "script_id": script.id,
        "meta": {k: script.meta[k] for k in PUBLISH_FIELDS if k in script.meta},
        "provenance": provenance,
    }
