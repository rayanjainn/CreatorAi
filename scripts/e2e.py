#!/usr/bin/env python3
"""Run the Playwright suite against the REAL stack on a throwaway DATA_DIR.

Seeds demo data, starts the API (:8100, no AI keys, mock off) and a production build of the web app
(:3100), runs `npm run e2e`, then tears everything down. Used by `make e2e`.
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND, FRONTEND = ROOT / "backend", ROOT / "frontend"
API_PORT, WEB_PORT = "8100", "3100"
PY = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def wait(url: str, timeout: float = 90) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except Exception:
            time.sleep(0.5)
    raise SystemExit(f"timed out waiting for {url}")


def main() -> int:
    data = tempfile.mkdtemp(prefix="creatorai-e2e-")
    env = {
        **os.environ,
        "DATA_DIR": data,
        "LLM_ALLOW_MOCK": "false",
        "GEMINI_API_KEY": "",
        "GROQ_API_KEY": "",
        "OLLAMA_API_KEY": "",
        "CORS_ORIGINS": f"http://localhost:{WEB_PORT},http://127.0.0.1:{WEB_PORT}",
        "NEXT_PUBLIC_API_URL": f"http://localhost:{API_PORT}",
        "E2E_WEB_URL": f"http://localhost:{WEB_PORT}",
        "E2E_API_URL": f"http://localhost:{API_PORT}",
    }
    procs: list[subprocess.Popen[bytes]] = []
    try:
        print(f"[e2e] data dir {data}; seeding ...", flush=True)
        subprocess.run([str(PY), "scripts/migrate.py"], cwd=BACKEND, env=env, check=True)
        subprocess.run([str(PY), "scripts/seed_demo.py"], cwd=BACKEND, env=env, check=True)
        procs.append(subprocess.Popen(
            [str(PY), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", API_PORT],
            cwd=BACKEND, env=env, start_new_session=os.name != "nt",
        ))  # fmt: skip
        shell = os.name == "nt"
        subprocess.run(["npm", "run", "build"], cwd=FRONTEND, env=env, check=True, shell=shell)
        procs.append(subprocess.Popen(
            ["npx", "next", "start", "-p", WEB_PORT], cwd=FRONTEND, env=env, shell=os.name == "nt",
            start_new_session=os.name != "nt",
        ))  # fmt: skip
        wait(f"http://localhost:{API_PORT}/api/v1/health")
        wait(f"http://localhost:{WEB_PORT}/login")
        args = sys.argv[1:]
        cmd = ["npm", "run", "e2e", "--", *args]
        return subprocess.run(cmd, cwd=FRONTEND, env=env, shell=shell).returncode
    finally:
        for p in procs:  # kill the whole process group: `npx` spawns node children
            try:
                if os.name == "nt":
                    p.terminate()
                else:
                    os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for p in procs:
            try:
                p.wait(timeout=8)
            except subprocess.TimeoutExpired:
                p.kill()
        shutil.rmtree(data, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
