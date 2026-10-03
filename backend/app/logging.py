"""Logging setup: one concise line format for the API, jobs and scripts."""

from __future__ import annotations

import logging
import sys

_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"


def configure_logging(level: str = "INFO") -> None:
    """Idempotently route application logs to stderr at ``level``."""
    root = logging.getLogger()
    root.setLevel(level.upper())
    if not any(getattr(h, "_creatorai", False) for h in root.handlers):
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter(_FORMAT, "%H:%M:%S"))
        handler._creatorai = True  # type: ignore[attr-defined]
        root.addHandler(handler)
    for noisy in ("httpx", "httpcore", "multipart"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
