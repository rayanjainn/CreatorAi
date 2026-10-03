"""In-process sliding-window rate limiter (replaces the Redis limiter for the local stack)."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable


class SlidingWindowLimiter:
    """Allows at most ``limit`` cost units per ``window`` seconds for each key."""

    def __init__(
        self,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._events: dict[str, deque[tuple[float, float]]] = defaultdict(deque)

    def _purge(self, key: str, window: float, now: float) -> deque[tuple[float, float]]:
        events = self._events[key]
        while events and events[0][0] <= now - window:
            events.popleft()
        return events

    def _try(self, key: str, limit: float, cost: float, window: float) -> float:
        """Take a slot (returns 0) or return seconds until one is likely free."""
        with self._lock:
            now = self._clock()
            events = self._purge(key, window, now)
            used = sum(c for _, c in events)
            if used + cost <= limit or not events:
                events.append((now, cost))
                return 0.0
            freed, wait = used, 0.0
            for ts, c in events:
                freed -= c
                wait = ts + window - now
                if freed + cost <= limit:
                    break
            return max(wait, 0.01)

    def acquire(
        self,
        key: str,
        limit: float,
        *,
        cost: float = 1.0,
        window: float = 60.0,
        timeout: float = 25.0,
    ) -> bool:
        """Block until a slot opens; ``False`` if none opens within ``timeout`` seconds."""
        deadline = self._clock() + timeout
        while True:
            wait = self._try(key, limit, cost, window)
            if wait == 0.0:
                return True
            remaining = deadline - self._clock()
            if wait > remaining:
                return False
            self._sleep(min(wait, 0.5))

    def retry_after(
        self, key: str, limit: float, *, cost: float = 1.0, window: float = 60.0
    ) -> float:
        """Seconds until a slot would open (0 if one is open now); does not consume a slot."""
        with self._lock:
            now = self._clock()
            events = self._purge(key, window, now)
            used = sum(c for _, c in events)
            if used + cost <= limit or not events:
                return 0.0
            freed = used
            for ts, c in events:
                freed -= c
                if freed + cost <= limit:
                    return max(ts + window - now, 0.0)
            return window

    def reset(self) -> None:
        with self._lock:
            self._events.clear()
