#!/usr/bin/env python3
# ruff: noqa: E501  (a test double with long literal responses)
"""A tiny fake of the LumiClip API for local development and the browser tests (no network, no key).

    python3 scripts/fake_lumiclip.py --port 8399
    # then in .env:  LUMICLIP_API_KEY=anything   LUMICLIP_BASE_URL=http://127.0.0.1:8399

Behaviour: ``POST /api/v1/clips/generate`` starts a project; ``GET /api/v1/projects/{id}`` walks through the
pipeline steps on successive polls and finishes with three clips (short generated videos). A source URL
containing ``private`` fails with "requires authentication", one containing ``quota`` with HTTP 402.
This is a test double, not LumiClip: clips are synthetic colour bars.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STEPS = ["downloading", "transcribing", "analyzing", "cutting"]
PROJECTS: dict[str, dict] = {}
MEDIA: dict[str, bytes] = {}


def make_media(tmp: Path) -> None:
    for i, color in enumerate(("0x7c3aed", "0x0ea5e9", "0xf59e0b"), start=1):
        out = tmp / f"c{i}.mp4"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s=360x640:d=3:r=15",
             "-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-shortest", str(out)],
            check=True,
        )  # fmt: skip
        MEDIA[f"/media/c{i}.mp4"] = out.read_bytes()
        thumb = tmp / f"c{i}.jpg"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(out), "-frames:v", "1", str(thumb)],
            check=True,
        )
        MEDIA[f"/media/c{i}.jpg"] = thumb.read_bytes()


class Handler(BaseHTTPRequestHandler):
    server_version = "FakeLumiClip/1"

    def log_message(self, *_: object) -> None:  # quiet
        pass

    def _json(self, status: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _auth(self) -> bool:
        if (
            self.headers.get("Authorization", "").startswith("Bearer ")
            and len(self.headers["Authorization"]) > 8
        ):
            return True
        self._json(401, {"error": "Unauthorized"})
        return False

    def do_GET(self) -> None:
        if self.path in MEDIA:
            data = MEDIA[self.path]
            self.send_response(200)
            self.send_header(
                "Content-Type", "video/mp4" if self.path.endswith(".mp4") else "image/jpeg"
            )
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
            return
        if not self._auth():
            return
        if self.path.startswith("/api/v1/projects/"):
            pid = self.path.rsplit("/", 1)[1]
            project = PROJECTS.get(pid)
            if project is None:
                return self._json(404, {"error": "Project not found"})
            project["polls"] += 1
            if "private" in project["url"]:
                return self._json(
                    200,
                    {
                        "id": pid,
                        "status": "failed",
                        "error": "This video requires authentication and cannot be processed.",
                    },
                )
            n = project["polls"]
            if n <= len(STEPS):
                return self._json(
                    200,
                    {"id": pid, "status": "processing", "step": STEPS[n - 1], "expected_clips": 3},
                )
            base = f"http://{self.headers['Host']}"
            clips = [
                {"id": f"{pid}-c{i}", "title": title, "duration": dur, "score": score, "reason": reason,
                 "clip_status": "completed", "download_url": f"{base}/media/c{i}.mp4",
                 "thumbnail_url": f"{base}/media/c{i}.jpg", "quality": "1080p"}
                for i, (title, dur, score, reason) in enumerate(
                    [("The one thing nobody tells you", 31.0, 0.94, "Strong contrarian opener with a payoff"),
                     ("Why the first 3 seconds decide everything", 42.5, 0.88, "Clear, quotable, fast pacing"),
                     ("A mistake I made for a year", 27.2, 0.81, "Personal story with a lesson")], start=1)
            ]  # fmt: skip
            return self._json(200, {"id": pid, "name": "Fake project", "status": "completed", "step": "done",
                                    "duration": 612, "expected_clips": 3, "clips": clips})  # fmt: skip
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if not self._auth():
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/api/v1/clips/generate":
            if "quota" in body.get("url", ""):
                return self._json(402, {"error": "Out of credits"})
            pid = f"fake-{len(PROJECTS) + 1}"
            PROJECTS[pid] = {"url": body.get("url", ""), "polls": 0, "body": body}
            return self._json(
                200, {"project_id": pid, "status": "processing", "estimated_minutes": 1}
            )
        if self.path.endswith("/export"):
            cid = self.path.split("/")[-2]
            return self._json(
                200,
                {
                    "status": "ready",
                    "clip_id": cid,
                    "url": f"http://{self.headers['Host']}/media/c1.mp4",
                    "cached": True,
                },
            )
        self._json(404, {"error": "not found"})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8399)
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        make_media(Path(tmp))
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
        print(f"fake LumiClip on http://127.0.0.1:{args.port}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
