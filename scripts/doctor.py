#!/usr/bin/env python3
"""Check that this machine can run CreatorAi: ``make doctor``.

Standard library only, so it runs before ``make setup`` (and on any Python 3.8+ to tell you
that you need 3.11+). Required problems exit with 1; warnings never fail the run.

    python3 scripts/doctor.py            # human-readable report
    python3 scripts/doctor.py --offline  # skip the Hugging Face reachability probe
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIN_PY, MIN_NODE = (3, 11), 20
USE_COLOR = sys.stdout.isatty() and os.name != "nt"
GREEN, YELLOW, RED, DIM, RESET = (
    ("\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[0m") if USE_COLOR else ("",) * 5
)
HINTS = {
    "python": (
        "  macOS:          brew install python@3.12\n"
        "  Ubuntu 24.04:   sudo apt install python3 python3-venv\n"
        "  Ubuntu 22.04:   add the deadsnakes PPA, then apt install python3.12 python3.12-venv\n"
        "  then:           make setup PYTHON=python3.12"
    ),
    "venv": "  Ubuntu/Debian:  sudo apt install python3-venv",
    "node": (
        "  macOS:          brew install node@22\n"
        "  Ubuntu/Debian:  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - "
        "&& sudo apt install -y nodejs\n"
        "  any OS:         https://nodejs.org (LTS) or nvm: nvm install 22"
    ),
    "ffmpeg": (
        "  macOS:          brew install ffmpeg\n"
        "  Ubuntu/Debian:  sudo apt install ffmpeg\n"
        "  Windows:        use WSL2 (Ubuntu) and the line above"
    ),
}

failures = 0
warnings = 0


def ok(msg: str) -> None:
    print(f"  {GREEN}[ok]{RESET}   {msg}")


def warn(msg: str, hint: str = "") -> None:
    global warnings
    warnings += 1
    print(f"  {YELLOW}[warn]{RESET} {msg}")
    if hint:
        print(f"{DIM}{hint}{RESET}")


def fail(msg: str, hint: str = "") -> None:
    global failures
    failures += 1
    print(f"  {RED}[FAIL]{RESET} {msg}")
    if hint:
        print(hint)


def run(cmd: list[str], timeout: int = 15) -> str:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return (proc.stdout or "") + (proc.stderr or "")


def check_platform() -> None:
    if os.name == "nt":
        fail(
            "Native Windows is not supported (the Makefile needs bash).",
            "  Install WSL2 (`wsl --install` in an admin PowerShell), open Ubuntu, clone the repo\n"
            "  INSIDE the Linux filesystem (~/...), and follow the Ubuntu steps.",
        )
    else:
        ok(f"{platform.system()} {platform.machine()}")


def check_python() -> None:
    v = sys.version_info
    label = f"Python {v.major}.{v.minor}.{v.micro} ({sys.executable})"
    if (v.major, v.minor) >= MIN_PY:
        ok(label)
    else:
        found = [c for c in ("python3.13", "python3.12", "python3.11") if shutil.which(c)]
        extra = f"  Found {found[0]} on PATH: run `make setup PYTHON={found[0]}`" if found else ""
        fail(f"{label} is too old, need {MIN_PY[0]}.{MIN_PY[1]}+", extra or HINTS["python"])
    try:
        import ensurepip  # noqa: F401
        import venv  # noqa: F401

        ok("python venv module available")
    except ImportError:
        fail("Python `venv`/`ensurepip` is missing (cannot create backend/.venv)", HINTS["venv"])
    try:
        import sqlite3

        fts = sqlite3.connect(":memory:")
        fts.execute("create virtual table t using fts5(x)")
        ok(f"SQLite {sqlite3.sqlite_version} with FTS5")
    except Exception:
        fail("This Python's SQLite has no FTS5 (search needs it)", HINTS["python"])


def check_node() -> None:
    npm, node = shutil.which("npm"), shutil.which("node")
    if not node or not npm:
        fail("Node.js / npm not found", HINTS["node"])
        return
    match = re.search(r"v?(\d+)\.", run([node, "--version"]))
    major = int(match.group(1)) if match else 0
    version = run([node, "--version"]).strip()
    if major >= MIN_NODE:
        ok(f"Node {version}, npm {run([npm, '--version']).strip()}")
    else:
        fail(
            f"Node {version or '?'} is too old, need {MIN_NODE}+ (22 LTS recommended)",
            HINTS["node"],
        )


def check_libass(ffmpeg: str) -> None:
    """Burned-in captions need the ``subtitles`` filter (libass). Only exports depend on it, so a
    miss is a warning: ingest, search, the board and the editor all work without it.

    Probes by really running the filter instead of grepping ``-filters`` (listing formats vary).
    """
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "t.ass").write_text(
            "[Script Info]\nScriptType: v4.00+\nPlayResX: 64\nPlayResY: 64\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour\n"
            "Style: Default,Arial,12,&H00FFFFFF\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Text\n"
            "Dialogue: 0,0:00:00.00,0:00:01.00,Default,hi\n",
            encoding="utf-8",
        )
        try:
            proc = subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=64x64:d=0.2",
                    "-vf",
                    "subtitles=t.ass",
                    "-f",
                    "null",
                    "-",
                ],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=tmp,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            warn(f"could not test ffmpeg's subtitles filter ({exc})")
            return
    if proc.returncode == 0:
        ok("ffmpeg has libass (burned-in captions will render)")
        return
    err = (proc.stderr or "").strip().splitlines()
    detail = err[-1] if err else "no error output"
    others = [
        str(Path(d, "ffmpeg"))
        for d in os.environ.get("PATH", "").split(os.pathsep)
        if d and Path(d, "ffmpeg").exists() and str(Path(d, "ffmpeg")) != ffmpeg
    ]
    hint = (
        f"  ffmpeg said: {detail}\n"
        f"  binary tested: {ffmpeg}\n"
        "  Fix: use a build with libass (macOS: `brew install ffmpeg`, first on\n"
        "  PATH; Ubuntu/Debian: `sudo apt install ffmpeg`; static: a full/GPL build), or point\n"
        "  FFMPEG_BIN / FFPROBE_BIN at one.\n"
        "  Everything except caption burn-in on EXPORT works without it, so setup continues."
    )
    if others:
        hint += "\n  Other ffmpeg binaries on PATH: " + ", ".join(others)
    warn(
        "ffmpeg cannot run the `subtitles` filter (no libass): exports with captions will fail",
        hint,
    )


def check_ffmpeg() -> None:
    ffmpeg, ffprobe = (
        shutil.which(os.environ.get("FFMPEG_BIN", "ffmpeg")),
        shutil.which(os.environ.get("FFPROBE_BIN", "ffprobe")),
    )
    if not ffmpeg or not ffprobe:
        fail(
            "ffmpeg / ffprobe not found (needed for ingest, previews and rendering)",
            HINTS["ffmpeg"],
        )
        return
    first = run([ffmpeg, "-version"]).splitlines()[0:1]
    ok(f"{first[0] if first else 'ffmpeg found'}  [{ffmpeg}]")
    check_libass(ffmpeg)
    if "libx264" in run([ffmpeg, "-hide_banner", "-encoders"]):
        ok("ffmpeg has libx264 (H.264 proxies and renders)")
    else:
        fail("ffmpeg has no libx264 encoder", HINTS["ffmpeg"])


def check_disk() -> None:
    free_gb = shutil.disk_usage(ROOT).free / 1e9
    if free_gb >= 5:
        ok(f"{free_gb:.0f} GB free disk")
    else:
        warn(f"Only {free_gb:.1f} GB free; dependencies need ~2 GB and media grows quickly")


def port_busy(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def check_ports() -> None:
    for name, var, default in (("API", "API_PORT", 8000), ("web", "WEB_PORT", 3000)):
        port = int(os.environ.get(var, default))
        if port_busy(port):
            warn(
                f"Port {port} ({name}) is already in use",
                f"  `make dev` will fail. Free it or pick another: make dev {var}={port + 1}"
                + ("  (CORS is adjusted for you)" if var == "WEB_PORT" else ""),
            )
        else:
            ok(f"Port {port} ({name}) is free")


def check_repo_state(offline: bool) -> None:
    env = ROOT / ".env"
    if env.exists():
        text = env.read_text(errors="ignore")
        keys = [
            k
            for k in ("GEMINI_API_KEY", "GROQ_API_KEY", "OLLAMA_API_KEY")
            if re.search(rf"^{k}=\S+", text, re.M)
        ]
        if keys:
            ok(f".env found, AI keys set: {', '.join(keys)}")
        else:
            warn(
                ".env has no AI key yet (the app starts; AI features show 'not configured')",
                "  Add one free key: GEMINI_API_KEY, GROQ_API_KEY or OLLAMA_API_KEY (see README).",
            )
        if re.search(r"^LLM_ALLOW_MOCK=true", text, re.M):
            warn("LLM_ALLOW_MOCK=true in .env: AI output will be fake and labelled [MOCK]")
    else:
        ok(".env not created yet (`make setup` copies .env.example)")
    venv = ROOT / "backend" / ".venv"
    if venv.exists():
        ok("backend/.venv exists")
    else:
        print(f"  {DIM}[info]{RESET} backend/.venv not created yet (`make setup` creates it)")
    if not offline:
        try:
            urllib.request.urlopen("https://huggingface.co", timeout=4)
            ok("huggingface.co reachable (embedding model download will work)")
        except Exception:
            warn(
                "huggingface.co unreachable: `make models` will fail (non-fatal)",
                "  Until it succeeds, search and matching use a flagged heuristic embedder.\n"
                "  Re-run `make models` once you are online.",
            )


def main() -> int:
    offline = "--offline" in sys.argv
    print("CreatorAi doctor\n")
    check_platform()
    check_python()
    check_node()
    check_ffmpeg()
    check_disk()
    check_ports()
    check_repo_state(offline)
    print()
    if failures:
        print(
            f"{RED}{failures} required item(s) missing.{RESET} Fix them, then re-run `make doctor`."
        )
        return 1
    suffix = f" ({warnings} warning(s) above are optional)" if warnings else ""
    print(f"{GREEN}All required prerequisites found.{RESET}{suffix} Next: make setup")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
