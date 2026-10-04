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
API_PORT, WEB_PORT, LUMI_PORT = "8100", "3100", "8398"
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
        "UPLOAD_CHUNK_SIZE": "65536",  # small chunks so the e2e upload really is chunked
        "CORS_ORIGINS": f"http://localhost:{WEB_PORT},http://127.0.0.1:{WEB_PORT}",
        "NEXT_PUBLIC_API_URL": f"http://localhost:{API_PORT}",
        "E2E_WEB_URL": f"http://localhost:{WEB_PORT}",
        "E2E_API_URL": f"http://localhost:{API_PORT}",
        "E2E_BACKEND_PYTHON": str(PY),
        # the optional cloud clipper, pointed at a local fake (scripts/fake_lumiclip.py)
        "LUMICLIP_API_KEY": "e2e-key",
        "LUMICLIP_BASE_URL": f"http://127.0.0.1:{LUMI_PORT}",
        "LUMICLIP_ALLOW_PRIVATE_DOWNLOADS": "true",
    }
    procs: list[subprocess.Popen[bytes]] = []

    def stop(p: subprocess.Popen[bytes]) -> None:
        try:  # kill the whole process group: `npx` spawns node children
            if os.name == "nt":
                p.terminate()
            else:
                os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            p.wait(timeout=8)
        except subprocess.TimeoutExpired:
            p.kill()

    def start_api(mock: bool) -> subprocess.Popen[bytes]:
        api_env = {**env, "LLM_ALLOW_MOCK": "true" if mock else "false"}
        proc = subprocess.Popen(
            [str(PY), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", API_PORT],
            cwd=BACKEND, env=api_env, start_new_session=os.name != "nt",
        )  # fmt: skip
        procs.append(proc)
        wait(f"http://localhost:{API_PORT}/api/v1/health")
        return proc

    try:
        print(f"[e2e] data dir {data}; seeding ...", flush=True)
        procs.append(
            subprocess.Popen(
                [sys.executable, str(ROOT / "scripts" / "fake_lumiclip.py"), "--port", LUMI_PORT],
                env=env, start_new_session=os.name != "nt",
            )
        )  # fmt: skip
        subprocess.run([str(PY), "scripts/migrate.py"], cwd=BACKEND, env=env, check=True)
        subprocess.run([str(PY), "scripts/seed_demo.py"], cwd=BACKEND, env=env, check=True)
        shell = os.name == "nt"
        subprocess.run(["npm", "run", "build"], cwd=FRONTEND, env=env, check=True, shell=shell)
        api = start_api(mock=False)
        procs.append(subprocess.Popen(
            ["npx", "next", "start", "-p", WEB_PORT], cwd=FRONTEND, env=env, shell=os.name == "nt",
            start_new_session=os.name != "nt",
        ))  # fmt: skip
        wait(f"http://127.0.0.1:{LUMI_PORT}/media/c1.jpg", timeout=60)
        wait(f"http://localhost:{WEB_PORT}/login")
        args = sys.argv[1:]

        def suite(project: str) -> int:
            cmd = ["npm", "run", "e2e", "--", f"--project={project}", *args]
            return subprocess.run(cmd, cwd=FRONTEND, env=env, shell=shell).returncode

        # Phase 1: no keys, mock off. Phase 2: same data, LLM_ALLOW_MOCK=true (generation flows).
        code = suite("keyless")
        stop(api)
        procs.remove(api)
        start_api(mock=True)
        mock_code = suite("mock")
        return code or mock_code
    finally:
        for p in procs:
            stop(p)
        shutil.rmtree(data, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
