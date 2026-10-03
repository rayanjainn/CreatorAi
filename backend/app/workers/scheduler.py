"""Nightly scheduler: a ``threading.Timer`` loop that runs registered callbacks (03:00 local)."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

NIGHTLY_CALLBACKS: list[Callable[[], None]] = []
RUN_HOUR = 3


def register_nightly(callback: Callable[[], None]) -> None:
    """Add a no-argument callback to the nightly run (for example, analytics sync)."""
    NIGHTLY_CALLBACKS.append(callback)


def seconds_until_next_run(now: datetime | None = None, hour: int = RUN_HOUR) -> float:
    current = now or datetime.now()
    target = current.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= current:
        target += timedelta(days=1)
    return (target - current).total_seconds()


def run_nightly() -> None:
    """Run every callback once; one failing callback never blocks the others."""
    for callback in list(NIGHTLY_CALLBACKS):
        try:
            callback()
        except Exception:
            log.exception("nightly callback %s failed", getattr(callback, "__name__", callback))


class Scheduler:
    def __init__(self) -> None:
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()
        self._stopped = True

    def start(self) -> None:
        with self._lock:
            self._stopped = False
            self._arm()

    def stop(self) -> None:
        with self._lock:
            self._stopped = True
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

    def _arm(self) -> None:
        timer = threading.Timer(seconds_until_next_run(), self._fire)
        timer.daemon = True
        self._timer = timer
        timer.start()

    def _fire(self) -> None:
        run_nightly()
        with self._lock:
            if not self._stopped:
                self._arm()


scheduler = Scheduler()
