"""Write the FastAPI OpenAPI schema to a file: ``python scripts/dump_openapi.py [out.json]``.

Used by ``make gen-api`` so the frontend can regenerate its TypeScript types offline.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import REPO_ROOT
from app.main import app


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "frontend" / "openapi.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(app.openapi(), indent=2) + "\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
