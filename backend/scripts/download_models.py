"""Download the models the app needs so it runs offline afterwards: ``make models``.

    python scripts/download_models.py            # embedder only (~90 MB)
    python scripts/download_models.py --asr      # plus faster-whisper (WHISPER_LOCAL_MODEL)
    python scripts/download_models.py --asr --asr-model base

Exit code 0 when everything requested succeeded, 1 otherwise (``make setup`` treats that as a
warning, not an error).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ml.models import preload_asr, preload_embedder


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--asr", action="store_true", help="also download a faster-whisper model")
    parser.add_argument(
        "--asr-model", default=None, help="whisper size (default WHISPER_LOCAL_MODEL)"
    )
    args = parser.parse_args(argv)

    steps = [("embedder", preload_embedder)]
    if args.asr:
        steps.append(("asr", lambda: preload_asr(args.asr_model)))
    failed = 0
    for name, step in steps:
        try:
            print(f"[ok] {step()}")
        except Exception as exc:  # network down, disk full, missing package ...
            failed += 1
            print(f"[FAILED] {name}: {type(exc).__name__}: {exc}", file=sys.stderr)
    if failed:
        print(
            "Some models could not be downloaded (offline?). The app still starts, but "
            "embeddings fall back to a heuristic. Re-run `make models` when online.",
            file=sys.stderr,
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
