#!/usr/bin/env python
"""Load DEMO data so a fresh checkout has something to look at: ``make seed``.

Everything seeded is labelled demo: content items and clips are named ``[DEMO] ...``, ideas,
scripts, Director plans and twin memories carry ``provenance.source = "demo"``, YouTube analytics
are ``yt_videos.is_seed = true``. Nothing here calls an LLM and nothing is mock output: the text is
hand-written (``scripts/demo_data.py``) and the analytics are synthetic numbers from a seeded RNG.

What it creates
  * demo user demo@creatorai.local / demo1234 (when no user exists; otherwise the demo data is
    attached to the existing account's workspace and the profile is only filled in when onboarding
    was not completed)
  * profile + starter style profile, 9 board cards across all six stages, 6 idea suggestions
  * 24 seed YouTube videos over 90 days + daily metrics (synthetic, deterministic)
  * 10 twin memories with embeddings from the real embedder
  * the HERO project: generated demo footage + transcript sidecar ingested through the real
    ``asset.process`` pipeline, a hand-written script and Director plan, then the real
    ``project.match`` and ``clips.generate`` code with LLM calls disabled (clips use the
    deterministic fallback copy, provenance ``heuristic``)

Idempotent: if demo content is already present it is left alone. ``--reset`` removes only the rows
this script created earlier (names starting with ``[DEMO]``, seed videos, demo ideas and memories,
the hero footage) and seeds again. ``--render`` also renders the best hero clip to mp4.
"""

from __future__ import annotations

import argparse
import logging
import math
import random
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import demo_data as dd  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.config import Settings, get_settings  # noqa: E402
from app.db import migrate, session_scope  # noqa: E402
from app.llm import gateway as gateway_module  # noqa: E402
from app.logging import configure_logging  # noqa: E402
from app.ml.embedder import embed_texts, embedder_info  # noqa: E402
from app.ml.hooks import classify_hook  # noqa: E402
from app.ml.vectors import pack_vector  # noqa: E402
from app.models import (  # noqa: E402
    Asset,
    Clip,
    ContentItem,
    CreatorProfile,
    IdeaSuggestion,
    Job,
    Render,
    TwinMemory,
    User,
    Workspace,
    YtMetricDaily,
    YtVideo,
)
from app.repositories.content import (  # noqa: E402
    DirectorOutputRepository,
    IdeaRepository,
    ScriptRepository,
)
from app.schemas.common import Provenance  # noqa: E402
from app.services import (  # noqa: E402  # noqa: E402
    accounts,
    clip_service,
    content_service,
    match_service,
    render_service,
    script_service,
)
from app.services import assets as assets_service  # noqa: E402
from app.storage.local import get_storage  # noqa: E402
from app.workers import load_handlers  # noqa: E402

DEMO_EMAIL = "demo@creatorai.local"
DEMO_PASSWORD = "demo1234"
SEED_RNG = 20261003  # fixed: the synthetic analytics are identical on every machine
DEMO = Provenance.demo().model_dump()
log = logging.getLogger("seed")


def say(message: str = "") -> None:
    print(message, flush=True)


# ── account and profile ───────────────────────────────────────────────────────────────────────
def ensure_account() -> tuple[str, str, str]:
    """``(workspace_id, email, note)``: the demo user, or the existing user's workspace."""
    with session_scope() as db:
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL)) or db.scalar(
            select(User).order_by(User.created_at)
        )
        if user is None:
            user, workspace = accounts.signup(
                db, DEMO_EMAIL, DEMO_PASSWORD, dd.PROFILE["display_name"]
            )
            note = f"created demo user {DEMO_EMAIL} / {DEMO_PASSWORD}"
        else:
            workspace = db.scalar(select(Workspace).where(Workspace.owner_id == user.id))
            assert workspace is not None
            note = (
                f"user {user.email} already exists: attaching the demo data to that workspace "
                f"(log in with your own password, not {DEMO_PASSWORD})"
                if user.email != DEMO_EMAIL
                else f"demo user {DEMO_EMAIL} already exists (password unchanged)"
            )
        profile = db.get(CreatorProfile, workspace.id)
        assert profile is not None
        if not profile.onboarding_done:
            p = dd.PROFILE
            profile.display_name, profile.domain = p["display_name"], p["domain"]
            profile.audience, profile.tone = p["audience"], p["tone"]
            profile.language, profile.platforms = p["language"], list(p["platforms"])
            profile.style_profile = dd.STYLE_PROFILE
            profile.onboarding_done = True
            workspace.name = p["channel_name"]
            note += "; filled the profile and a starter style profile (demo)"
        else:
            note += "; profile left untouched (onboarding already completed)"
        return workspace.id, user.email, note


# ── wipe ──────────────────────────────────────────────────────────────────────────────────────
def demo_item_ids(db: Any, ws: str) -> list[str]:
    stmt = select(ContentItem.id).where(
        ContentItem.workspace_id == ws, ContentItem.title.like(f"{dd.PREFIX}%")
    )
    return list(db.scalars(stmt))


def wipe(ws: str) -> dict[str, int]:
    """Remove exactly what a previous seed created (never touches anything else)."""
    counts = dict.fromkeys(("items", "assets", "renders", "ideas", "videos", "memories"), 0)
    storage = get_storage()
    with session_scope() as db:
        ids = demo_item_ids(db, ws)
        if ids:
            clip_ids = list(db.scalars(select(Clip.id).where(Clip.content_item_id.in_(ids))))
            for render in db.scalars(select(Render).where(Render.clip_id.in_(clip_ids))):
                for key in (render.output_key, render.thumb_key):
                    if key:
                        storage.delete_prefix(key)
                counts["renders"] += 1
            for asset_id in list(
                db.scalars(select(Asset.id).where(Asset.content_item_id.in_(ids)))
            ):
                assets_service.delete_asset(db, ws, asset_id)
                counts["assets"] += 1
            for item_id in ids:
                content_service.delete_item(db, ws, item_id, confirm=True)
                counts["items"] += 1
        for idea in db.scalars(select(IdeaSuggestion).where(IdeaSuggestion.workspace_id == ws)):
            if (idea.provenance or {}).get("source") == "demo":
                db.delete(idea)
                counts["ideas"] += 1
        for video in db.scalars(
            select(YtVideo).where(YtVideo.workspace_id == ws, YtVideo.is_seed.is_(True))
        ):
            db.delete(video)
            counts["videos"] += 1
        for memory in db.scalars(
            select(TwinMemory).where(
                TwinMemory.workspace_id == ws, TwinMemory.source_id == "demo:seed"
            )
        ):
            db.delete(memory)
            counts["memories"] += 1
    return counts


# ── board, ideas, scripts, plans ──────────────────────────────────────────────────────────────
def _plan_payload(title: str, scenes: list[tuple[str, str]], target: int) -> dict[str, Any]:
    """A small hand-assembled Director plan for the side items (static text, provenance demo)."""
    structure = [
        {
            "section": name,
            "goal": beat,
            "duration_sec": max(4.0, round(script_service.est_sec(beat), 1)),
            "notes": "",
        }
        for name, beat in scenes
    ]
    shots = [
        {
            "scene": n + 1,
            "shot_type": "medium",
            "framing": "face, eye-level",
            "b_roll": "",
            "note": "",
        }
        for n in range(len(scenes))
    ]
    return {
        "domain": "technology",
        "objective": f"Teach: {title}",
        "audience": dd.PROFILE["audience"],
        "angle": "One practical idea, shown fast.",
        "structure": structure,
        "storytelling": ["Open with the result", "One idea per sentence"],
        "shot_list": shots,
        "hook_ideas": [scenes[0][1]],
        "cta": "Follow for one tip a week.",
        "risks": ["Keep the intro under five seconds."],
        "_target": target,
    }


def add_plan(db: Any, ws: str, item: ContentItem, plan: dict[str, Any]) -> None:
    plan = {k: v for k, v in plan.items() if not k.startswith("_")}
    shots = len(plan["shot_list"])
    plan["meta"] = {
        "provenance": DEMO,
        "inputs": {"platform": "youtube_shorts", "target_duration_sec": item.target_duration_sec},
        "fixups": [],
        "shot_provenance": [DEMO] * shots,
        "edited_by_user": {"shot_list": []},
    }
    DirectorOutputRepository(db).add(
        ws, content_item_id=item.id, kind="plan", version=1, payload=plan, metrics={"fixups": []}
    )


def add_script(
    db: Any,
    ws: str,
    item: ContentItem,
    hooks: list[tuple[str, str, str]],
    scenes_raw: list[dict[str, Any]],
    meta: dict[str, Any],
    approved: bool = False,
) -> Any:
    """A hand-written script (provider ``demo``) with embedded beats."""
    scenes = script_service.normalize_scenes(scenes_raw)
    hook_options = [
        {
            "text": text,
            "type": kind,
            "why": why,
            "signal_score": round(script_service.hook_signals(text), 2),
            "detected_type": classify_hook(text),
            "provenance": DEMO,
        }
        for text, kind, why in hooks
    ]
    length = round(sum(float(s["est_sec"]) for s in scenes))
    script = ScriptRepository(db).add(
        ws,
        content_item_id=item.id,
        version=1,
        is_current=True,
        hook_options=hook_options,
        selected_hook=hooks[0][0],
        body_md=script_service.render_body_md(item.title, scenes),
        scenes=scenes,
        meta={**meta, "meta_provenance": DEMO},
        tone=dd.PROFILE["tone"],
        platform="youtube_shorts",
        length_sec=length,
        provider="demo",
        model=None,
    )
    if approved:
        script.meta = {
            **script.meta,
            "approval": {"approved_at": item.created_at, "version": 1, "via": "seed"},
        }
    db.flush()
    script_service.sync_beats(db, ws, script)
    return script


def seed_board(ws: str) -> tuple[str, list[str]]:
    """Create the board cards. Returns ``(hero_item_id, all_item_ids)``."""
    hero_id, ids = "", []
    with session_scope() as db:
        for stage, title, idea, objective, target in dd.BOARD:
            hero = title == "HERO"
            item = content_service.create_item(
                db,
                ws,
                {
                    "title": dd.PREFIX + (dd.HERO_TITLE if hero else title),
                    "idea_text": idea,
                    "objective": objective,
                    "domain": "technology",
                    "target_duration_sec": target,
                    "stage": stage,
                },
            )
            ids.append(item.id)
            if hero:
                hero_id = item.id
                continue
            if title in dd.SIDE_SCRIPTS:
                hook, scenes = dd.SIDE_SCRIPTS[title]
                add_script(
                    db,
                    ws,
                    item,
                    [(hook, "other", "Hand-written demo hook")],
                    [{"title": n, "beats": [{"text": b}]} for n, b in scenes],
                    {"titles": [title], "description": idea, "tags": ["video editing"]},
                    approved=stage == "shoot",
                )
                add_plan(db, ws, item, _plan_payload(title, scenes, target))
    return hero_id, ids


def seed_ideas(ws: str) -> int:
    with session_scope() as db:
        repo = IdeaRepository(db)
        for title, why in dd.IDEAS:
            repo.add(
                ws,
                title=dd.PREFIX + title,
                rationale=why,
                source="twin",
                status="suggested",
                provenance=DEMO,
            )
    return len(dd.IDEAS)


# ── synthetic YouTube analytics ───────────────────────────────────────────────────────────────
HOOK_MULT = {"question": 1.35, "number": 1.15, "story": 1.0, "bold_claim": 0.9, "other": 0.7}
TOPIC_MULT = {
    "editing": 1.3, "workflow": 1.1, "growth": 1.05, "storytelling": 1.0,
    "color": 0.85, "gear": 0.9, "audio": 0.8,
}  # fmt: skip


def _retention(rng: random.Random, end: float) -> list[dict[str, float]]:
    """21 points ``{"ratio": 0..1, "watch": 1..}``: a fast early drop then a slow tail."""
    dip = rng.uniform(0.08, 0.2)
    return [
        {
            "ratio": round(i / 20, 2),
            "watch": round(
                max(0.05, 1 - dip * min(1.0, i / 3) - (1 - dip - end) * (i / 20) ** 0.8), 3
            ),
        }
        for i in range(21)
    ]


def seed_youtube(ws: str) -> tuple[int, int]:
    """Synthetic analytics for 24 videos over 90 days. NOT real data (``is_seed = true``)."""
    rng = random.Random(SEED_RNG)
    today = date.today()
    videos = metric_rows = 0
    with session_scope() as db:
        for i, (title, hook, fmt, topic, duration) in enumerate(dd.VIDEOS):
            hook_type = classify_hook(hook)
            offset = 88 - round(i * 85 / (len(dd.VIDEOS) - 1))  # days since publish, newest last
            published = today - timedelta(days=offset)
            base = (
                5200 * HOOK_MULT[hook_type] * TOPIC_MULT[topic] * (0.55 if fmt == "long" else 1.0)
                * math.exp(rng.gauss(0, 0.25))
            )  # fmt: skip
            pct = min(
                92.0,
                max(
                    25.0,
                    (62 if fmt == "short" else 41)
                    + (HOOK_MULT[hook_type] - 1) * 14
                    + rng.gauss(0, 4),
                ),
            )
            video = YtVideo(
                workspace_id=ws,
                youtube_video_id=f"demo_yt_{i:03d}",
                title=title,
                published_at=f"{published.isoformat()}T15:00:00Z",
                duration_sec=duration,
                format=fmt,
                hook_text=hook,
                hook_type=hook_type,
                topic=topic,
                retention=_retention(rng, pct / 100 * 0.7),
                is_seed=True,
            )  # fmt: skip
            db.add(video)
            db.flush()
            videos += 1
            for d in range(offset):  # one row per day since publish (up to yesterday)
                day = published + timedelta(days=d)
                views = max(
                    0, round(base * (0.22 * math.exp(-d / 9) + 0.004) * rng.uniform(0.85, 1.15))
                )
                day_pct = max(20.0, min(95.0, pct + rng.gauss(0, 1.5)))
                avg_dur = duration * day_pct / 100
                db.add(
                    YtMetricDaily(
                        yt_video_id=video.id,
                        day=day.isoformat(),
                        views=views,
                        watch_time_min=round(views * avg_dur / 60, 1),
                        avg_view_duration_sec=round(avg_dur, 1),
                        avg_view_pct=round(day_pct, 1),
                        likes=round(views * rng.uniform(0.03, 0.06)),
                        comments=round(views * rng.uniform(0.002, 0.006)),
                        subscribers_gained=round(views * rng.uniform(0.0008, 0.003)),
                    )
                )
                metric_rows += 1
    return videos, metric_rows


def seed_memories(ws: str) -> tuple[int, bool]:
    texts = [f"{dd.PREFIX}{text}" for _, text in dd.MEMORIES]
    vectors = embed_texts(texts)
    with session_scope() as db:
        for (kind, _), text, vector in zip(dd.MEMORIES, texts, vectors, strict=True):
            db.add(
                TwinMemory(
                    workspace_id=ws,
                    kind=kind,
                    text=text,
                    source_id="demo:seed",
                    embedding=pack_vector(vector),
                )
            )
    return len(texts), bool(embedder_info()["real"])


# ── hero project ──────────────────────────────────────────────────────────────────────────────
@contextmanager
def llm_disabled() -> Iterator[None]:
    """No provider and no mock for the duration: real code paths take their no-LLM branches."""
    settings = Settings(
        GEMINI_API_KEY="",
        GROQ_API_KEY="",
        OLLAMA_API_KEY="",
        LLM_ALLOW_MOCK=False,
        _env_file=None,  # type: ignore[call-arg]
    )
    previous = gateway_module._gateway
    gateway_module._gateway = gateway_module.Gateway(settings=settings)
    quiet = logging.getLogger("app.services.clip_service")  # the fallback is expected here
    level = quiet.level
    quiet.setLevel(logging.ERROR)
    try:
        yield
    finally:
        quiet.setLevel(level)
        gateway_module._gateway = previous


def ensure_media(demo_dir: Path) -> Any:
    import make_demo_media

    video, sidecar = demo_dir / "hero_demo.mp4", demo_dir / "hero_demo.words.json"
    if not (video.is_file() and sidecar.is_file()):
        say(f"  generating demo footage in {demo_dir} ...")
        return make_demo_media.generate(demo_dir)
    words, cuts, duration = make_demo_media.build_timings()
    return make_demo_media.DemoMedia(video, sidecar, duration, words, cuts)


def job_result(job_id: str) -> Job:
    with session_scope() as db:
        job = db.get(Job, job_id)
        assert job is not None
        db.expunge(job)
        return job


def seed_hero(ws: str, hero_id: str, demo_dir: Path, render: bool) -> dict[str, Any]:
    out: dict[str, Any] = {"item_id": hero_id}
    media = ensure_media(demo_dir)
    say("  ingesting the footage through the real asset.process pipeline ...")
    with session_scope() as db:
        asset, _, job_id = assets_service.ingest_local_file(
            db,
            ws,
            media.video,
            content_item_id=hero_id,
            sidecar=media.sidecar,
            sidecar_source="demo",
        )
        asset_id = asset.id
    job = job_result(job_id) if job_id else None
    with session_scope() as db:
        asset = db.get(Asset, asset_id)
        assert asset is not None
        out["asset_id"], out["asset_status"] = asset_id, asset.status
        out["asset_warnings"] = list((asset.analysis or {}).get("warnings") or [])
        if asset.status != "ready":
            raise SystemExit(
                f"hero footage did not process (status {asset.status}): "
                f"{asset.error or (job.error if job else 'no job ran')}"
            )

    with session_scope() as db:
        item = db.get(ContentItem, hero_id)
        assert item is not None
        scenes = [
            {"title": t, "intent": i, "beats": [{"text": b} for b in beats]}
            for t, i, beats in dd.HERO_SCENES
        ]
        add_script(db, ws, item, dd.HERO_HOOKS, scenes, dd.HERO_META, approved=True)
        add_plan(db, ws, item, dd.HERO_PLAN)

    with llm_disabled():
        say("  matching the script to the footage (project.match, no LLM) ...")
        with session_scope() as db:
            started = match_service.start_match(db, ws, hero_id)
        match_job = job_result(started["job_id"])
        say(f"    project.match -> {match_job.status}")
        out["match"] = match_job.result if match_job.status == "succeeded" else match_job.error
        say("  generating clips (clips.generate, deterministic fallback copy) ...")
        with session_scope() as db:
            started = clip_service.start_generate(db, ws, hero_id, {"count": 3})
        clips_job = job_result(started["job_id"])
        say(f"    clips.generate -> {clips_job.status}")
        if clips_job.status != "succeeded":
            raise SystemExit(f"clips.generate failed: {clips_job.error}")
        out["clips_result"] = clips_job.result

    with session_scope() as db:
        clips = list(
            db.scalars(
                select(Clip).where(Clip.content_item_id == hero_id).order_by(Clip.score.desc())
            )
        )
        for clip in clips:
            clip.title = dd.PREFIX + clip.title
            clip.features = {**(clip.features or {}), "seeded_demo": True}
        out["clip_ids"] = [c.id for c in clips]
        out["clip_titles"] = [c.title for c in clips]
    if render and out["clip_ids"]:
        say("  rendering the best clip (yt_short) ...")
        with session_scope() as db:
            rendered, render_job = render_service.start_render(
                db, ws, out["clip_ids"][0], "yt_short", None
            )
            render_id = rendered.id
        job = job_result(render_job)
        with session_scope() as db:
            row = db.get(Render, render_id)
            assert row is not None
            out["render"] = {
                "id": row.id,
                "status": row.status,
                "error": row.error,
                "file": str(get_storage().path_for(row.output_key)) if row.output_key else None,
                "duration_sec": row.duration_sec,
            }
        say(f"    render.run -> {job.status}")
    return out


# ── main ──────────────────────────────────────────────────────────────────────────────────────
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--reset", action="store_true", help="remove earlier demo data and reseed")
    parser.add_argument("--render", action="store_true", help="also render the best hero clip")
    parser.add_argument("--skip-hero", action="store_true", help="skip the footage pipeline")
    parser.add_argument("--demo-dir", type=Path, default=None, help="where demo media lives")
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging("WARNING")
    settings.ensure_dirs()
    applied = migrate()
    if applied:
        say(f"applied migrations: {', '.join(applied)}")
    settings.jobs_inline = True  # run jobs in this process, in order
    settings.job_max_retries = 0
    load_handlers()
    demo_dir = args.demo_dir or settings.data_dir / "demo"

    ws, email, note = ensure_account()
    say(f"account: {note}")
    with session_scope() as db:
        present = demo_item_ids(db, ws)
    if present and not args.reset:
        say(f"demo data already present ({len(present)} [DEMO] cards): nothing to do.")
        say("Run `make seed ARGS=--reset` (or `seed_demo.py --reset`) to rebuild it.")
        return 0
    if args.reset:
        say(f"removed previous demo data: {wipe(ws)}")

    hero_id, ids = seed_board(ws)
    say(f"board: {len(ids)} [DEMO] cards across all six stages")
    say(f"ideas: {seed_ideas(ws)} idea suggestions (provenance demo)")
    videos, rows = seed_youtube(ws)
    say(f"youtube: {videos} seed videos, {rows} daily metric rows (SYNTHETIC, is_seed=true)")
    memories, real = seed_memories(ws)
    embedder = "real" if real else "heuristic hashing"
    say(f"twin: {memories} memories embedded with the {embedder} embedder")
    hero: dict[str, Any] = {}
    if args.skip_hero:
        say("hero project: skipped (--skip-hero)")
    else:
        say("hero project:")
        hero = seed_hero(ws, hero_id, demo_dir, args.render)
        say(f"  clips: {len(hero.get('clip_ids', []))} [DEMO] clips (copy provenance: heuristic)")
        if hero.get("asset_warnings"):
            say(f"  note: {hero['asset_warnings']}")
        if hero.get("render"):
            say(f"  render: {hero['render']}")

    say("")
    say(f"Done. Login: {email}" + (f" / {DEMO_PASSWORD}" if email == DEMO_EMAIL else ""))
    if hero_id:
        say(f"Hero project id: {hero_id}  (open /projects/{hero_id})")
    say("Next: `make dev`, sign in, open the board; try Match, Clips and Render on the hero card.")
    say("Everything seeded is demo data: [DEMO] names, provenance demo, is_seed analytics.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
