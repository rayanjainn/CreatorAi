"""Apply SQL migrations: ``python scripts/migrate.py``."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.db import migrate


def main() -> None:
    settings = get_settings()
    applied = migrate()
    print(f"database: {settings.db_path}")
    print("applied: " + (", ".join(applied) if applied else "nothing to do"))


if __name__ == "__main__":
    main()
