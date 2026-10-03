#!/usr/bin/env python3
"""Run the API (uvicorn --reload, :8000) and the web app (npm run dev, :3000) together.

Cross-platform. Logs are prefixed per process. Ctrl-C stops both.
"""

from __future__ import annotations

import contextlib
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
API_PORT = os.environ.get("API_PORT", "8000")
WEB_PORT = os.environ.get("WEB_PORT", "3000")
IS_WINDOWS = os.name == "nt"
COLORS = {"api": "\033[36m", "web": "\033[35m"}
RESET = "\033[0m"


def backend_python() -> str:
    """The backend virtualenv's interpreter if `make setup` created one, else the current one."""
    candidate = BACKEND / ".venv" / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")
    return str(candidate) if candidate.exists() else sys.executable


def port_in_use(port: str) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", int(port))) == 0


def preflight() -> str | None:
    """Return a friendly reason why the stack cannot start, or None."""
    if not (BACKEND / ".venv").exists():
        return "backend/.venv is missing. Run `make setup` first."
    if (FRONTEND / "package.json").exists() and not (FRONTEND / "node_modules").exists():
        return "frontend/node_modules is missing. Run `make setup` first."
    for name, var, port in (("API", "API_PORT", API_PORT), ("web", "WEB_PORT", WEB_PORT)):
        if port_in_use(port):
            return (
                f"Port {port} ({name}) is already in use. Stop the other process or choose "
                f"another port: make dev {var}={int(port) + 1}"
            )
    return None


def pump(name: str, proc: subprocess.Popen[str]) -> None:
    prefix = f"{COLORS[name]}[{name}]{RESET}" if sys.stdout.isatty() else f"[{name}]"
    assert proc.stdout is not None
    for line in proc.stdout:
        print(f"{prefix} {line.rstrip()}", flush=True)


def spawn(name: str, cmd: list[str], cwd: Path, env: dict[str, str]) -> subprocess.Popen[str]:
    kwargs: dict[str, object] = {}
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        shell=IS_WINDOWS and cmd[0] == "npm",
        **kwargs,  # type: ignore[arg-type]
    )
    threading.Thread(target=pump, args=(name, proc), daemon=True).start()
    return proc


def stop(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
        else:
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=8)
    except (subprocess.TimeoutExpired, ProcessLookupError):
        if not IS_WINDOWS:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)


def main() -> int:
    problem = preflight()
    if problem:
        print(f"[dev] {problem}", file=sys.stderr)
        return 1
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "FORCE_COLOR": "0"}
    if WEB_PORT != "3000":
        # The browser origin must be allowed by the API: follow a non-default web port.
        env.setdefault("CORS_ORIGINS", f"http://localhost:{WEB_PORT},http://127.0.0.1:{WEB_PORT}")
        env.setdefault("FRONTEND_URL", f"http://localhost:{WEB_PORT}")
    procs: dict[str, subprocess.Popen[str]] = {}
    api_cmd = [
        backend_python(), "-m", "uvicorn", "app.main:app",
        "--reload", "--reload-dir", "app", "--host", "127.0.0.1", "--port", API_PORT,
    ]  # fmt: skip
    procs["api"] = spawn("api", api_cmd, BACKEND, env)
    has_web = (FRONTEND / "package.json").exists()
    if has_web:
        web_env = {**env, "PORT": WEB_PORT}
        web_env.setdefault("NEXT_PUBLIC_API_URL", f"http://localhost:{API_PORT}")
        procs["web"] = spawn("web", ["npm", "run", "dev", "--", "-p", WEB_PORT], FRONTEND, web_env)

    print(f"\n  API   http://localhost:{API_PORT}   (docs: /docs, health: /api/v1/health)")
    if has_web:
        print(f"  Web   http://localhost:{WEB_PORT}")
    else:
        print("  Web   (frontend/package.json not found, API only)")
    print("  Press Ctrl-C to stop.\n", flush=True)

    code = 0
    try:
        while True:
            for name, proc in procs.items():
                if proc.poll() is not None:
                    print(f"[dev] {name} exited with code {proc.returncode}; stopping.", flush=True)
                    code = proc.returncode or 1
                    raise KeyboardInterrupt
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for proc in procs.values():
            stop(proc)
    return code


if __name__ == "__main__":
    sys.exit(main())
