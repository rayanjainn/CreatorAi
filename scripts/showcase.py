#!/usr/bin/env python
"""Fill a running CreatorAi with real content, run through the real pipeline: ``make showcase``.

Nothing is invented. You give it videos with clear English speech (files or direct URLs, or a
YouTube/other page URL when ``yt-dlp`` is installed); for each one it

  1. downloads it (if it is a URL) into ``data/showcase/``,
  2. uploads it to the library (transcription, shots, embeddings run as normal),
  3. creates a project for it with a plain title,
  4. when an AI key is configured: hooks -> script -> script/footage match -> Director plan,
  5. generates the short-form clips.

The result is ordinary user content (no [DEMO] titles); what the AI wrote is labelled AI by the app
as always. Needs ``make dev`` running. Examples::

    python scripts/showcase.py --file ~/Videos/talk.mp4 --title "How I plan a week of content"
    python scripts/showcase.py --sources showcase/sources.json
    python scripts/showcase.py --url https://... --title "My title"

Use only videos you may reuse (your own, public domain, or Creative Commons with credit).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "showcase"


def say(msg: str) -> None:
    print(f"[showcase] {msg}", flush=True)


class Api:
    def __init__(self, base: str, email: str, password: str, name: str) -> None:
        self.http = httpx.Client(base_url=f"{base.rstrip('/')}/api/v1", timeout=600)
        res = self.http.post("/auth/login", json={"email": email, "password": password})
        if res.status_code != 200:
            res = self.http.post(
                "/auth/signup",
                json={"email": email, "password": password, "display_name": name},
            )
            if res.status_code not in (200, 201):
                sys.exit(f"Could not sign in or sign up as {email}: {res.text}")
            say(f"created the account {email}")
        self.http.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
        me = self.http.get("/me").json()
        if not me["profile"]["onboarding_done"]:
            self.http.post(
                "/onboarding",
                json={"display_name": name, "domain": "education", "audience": ""},
            )

    def get(self, path: str, **kw: Any) -> Any:
        res = self.http.get(path, **kw)
        res.raise_for_status()
        return res.json()

    def post(self, path: str, **kw: Any) -> httpx.Response:
        return self.http.post(path, **kw)


def fetch(url: str, dest_dir: Path) -> Path:
    """Download a direct file URL, or use yt-dlp for page URLs (YouTube etc.)."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    direct = (
        url.split("?")[0].lower().endswith((".mp4", ".mov", ".webm", ".mkv", ".m4v"))
    )
    if direct:
        out = dest_dir / Path(url.split("?")[0]).name
        if out.exists():
            return out
        with httpx.stream("GET", url, follow_redirects=True, timeout=600) as r:
            r.raise_for_status()
            with out.open("wb") as fh:
                for chunk in r.iter_bytes(1 << 20):
                    fh.write(chunk)
        return out
    try:
        import yt_dlp  # type: ignore[import-not-found]
    except ImportError:
        sys.exit(
            "That is a page URL: install yt-dlp (`pip install yt-dlp`) or give a direct .mp4 URL."
        )
    opts = {
        "outtmpl": str(dest_dir / "%(id)s.%(ext)s"),
        "format": "mp4[height<=720]/best[height<=720]",
        "quiet": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return Path(ydl.prepare_filename(info))


def wait(api: Api, what: str, ready, timeout: int = 1800) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        if ready():
            return True
        time.sleep(3)
    say(f"  gave up waiting for {what}")
    return False


def ai_ready(api: Api) -> bool:
    try:
        st = api.get("/llm/status")
    except httpx.HTTPError:
        return False
    text = json.dumps(st).lower()
    return '"configured": true' in text or '"available": true' in text


def run_job(api: Api, res: httpx.Response, label: str) -> None:
    if res.status_code >= 400:
        say(
            f"  {label}: skipped ({res.status_code} {res.json().get('message', '')[:90]})"
        )
        return
    job_id = (res.json() or {}).get("job_id") or (res.json() or {}).get("id")
    if not job_id:
        say(f"  {label}: done")
        return
    wait(
        api,
        label,
        lambda: (
            api.get(f"/jobs/{job_id}")["status"] in ("succeeded", "failed", "canceled")
        ),
    )
    say(f"  {label}: {api.get(f'/jobs/{job_id}')['status']}")


def process(api: Api, path: Path, title: str, idea: str, use_ai: bool) -> None:
    say(f"{title}: uploading {path.name}")
    item = api.post("/content", json={"title": title, "idea_text": idea}).json()
    with path.open("rb") as fh:
        res = api.post(
            "/assets/upload",
            files={"file": (path.name, fh, "video/mp4")},
            data={"content_item_id": item["id"]},
        )
    res.raise_for_status()
    asset_id = res.json()["asset"]["id"]
    ok = wait(
        api,
        "transcription",
        lambda: api.get(f"/assets/{asset_id}")["status"] in ("ready", "failed"),
    )
    status = api.get(f"/assets/{asset_id}")["status"]
    if not ok or status != "ready":
        say(
            f"  footage did not become ready ({status}); see the Jobs page. Continuing."
        )
        return
    say("  footage is ready (transcribed and indexed)")
    if use_ai:
        hooks = api.post(f"/content/{item['id']}/hooks")
        run_job(api, hooks, "hooks")
        opts = []
        try:
            opts = (
                api.get(f"/content/{item['id']}/script").get("hook_options", []) or []
            )
        except httpx.HTTPError:
            pass
        hook = (
            opts[0].get("text")
            if opts and isinstance(opts[0], dict)
            else opts[0]
            if opts
            else title
        )
        run_job(
            api,
            api.post(f"/content/{item['id']}/script/generate", json={"hook": hook}),
            "script",
        )
        run_job(
            api, api.post(f"/content/{item['id']}/match"), "script-to-footage match"
        )
        run_job(api, api.post(f"/content/{item['id']}/director/plan"), "director plan")
    run_job(api, api.post(f"/content/{item['id']}/clips/generate"), "short clips")


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--email", default="creator@creatorai.local")
    ap.add_argument("--password", default="creatorai-showcase")
    ap.add_argument("--name", default="Creator")
    ap.add_argument(
        "--file", action="append", default=[], help="local video file (repeatable)"
    )
    ap.add_argument("--url", action="append", default=[], help="video URL (repeatable)")
    ap.add_argument(
        "--title",
        action="append",
        default=[],
        help="title for each --file/--url, in order",
    )
    ap.add_argument("--sources", help="JSON list of {title, url|file, idea}")
    ap.add_argument(
        "--no-ai",
        action="store_true",
        help="skip hooks/script/match/plan even when a key is set",
    )
    args = ap.parse_args()

    jobs: list[dict[str, str]] = []
    for i, f in enumerate([*args.file, *args.url]):
        key = "file" if f in args.file else "url"
        jobs.append(
            {
                key: f,
                "title": args.title[i]
                if i < len(args.title)
                else Path(f).stem.replace("_", " "),
            }
        )
    if args.sources:
        jobs += json.loads(Path(args.sources).read_text())
    if not jobs:
        sys.exit(
            "Nothing to do: pass --file, --url or --sources (see the top of this file)."
        )

    api = Api(args.api, args.email, args.password, args.name)
    use_ai = not args.no_ai and ai_ready(api)
    say(
        "AI keys found: writing hooks, scripts, matches and plans"
        if use_ai
        else "no AI key configured: footage and clips only (add a key to .env for the rest)"
    )
    for job in jobs:
        path = (
            Path(job["file"]).expanduser()
            if job.get("file")
            else fetch(job["url"], CACHE)
        )
        if not path.exists():
            say(f"missing file {path}")
            continue
        process(api, path, job["title"], job.get("idea", ""), use_ai)
    say(
        "done. Open the app: the board, library, Smart Clips and Insights now show your real projects."
    )
    shutil.rmtree(CACHE / ".tmp", ignore_errors=True)


if __name__ == "__main__":
    main()
