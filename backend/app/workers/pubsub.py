"""Thread-safe in-memory pub/sub with last-event replay, feeding the SSE endpoint."""

from __future__ import annotations

import queue
import threading
from collections import OrderedDict
from typing import Any

Event = dict[str, Any]
_REPLAY_LIMIT = 512


class Subscription:
    """A subscriber's inbox. Created by :meth:`PubSub.subscribe`; always call :meth:`close`."""

    def __init__(self, bus: PubSub, job_id: str) -> None:
        self._bus = bus
        self.job_id = job_id
        self._queue: queue.Queue[Event] = queue.Queue()

    def put(self, event: Event) -> None:
        self._queue.put(event)

    def get(self, timeout: float | None = None) -> Event | None:
        """Next event, or ``None`` if nothing arrived within ``timeout`` seconds."""
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def close(self) -> None:
        self._bus._unsubscribe(self)


class PubSub:
    """Per-job channels. A new subscriber first receives the last event published for the job."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: dict[str, list[Subscription]] = {}
        self._last: OrderedDict[str, Event] = OrderedDict()

    def publish(self, job_id: str, event: Event) -> None:
        with self._lock:
            self._last[job_id] = event
            self._last.move_to_end(job_id)
            while len(self._last) > _REPLAY_LIMIT:
                self._last.popitem(last=False)
            targets = list(self._subs.get(job_id, ()))
        for sub in targets:
            sub.put(event)

    def subscribe(self, job_id: str) -> Subscription:
        sub = Subscription(self, job_id)
        with self._lock:
            replay = self._last.get(job_id)
            if replay is not None:
                sub.put(replay)
            self._subs.setdefault(job_id, []).append(sub)
        return sub

    def last_event(self, job_id: str) -> Event | None:
        with self._lock:
            return self._last.get(job_id)

    def _unsubscribe(self, sub: Subscription) -> None:
        with self._lock:
            subs = self._subs.get(sub.job_id, [])
            if sub in subs:
                subs.remove(sub)
            if not subs:
                self._subs.pop(sub.job_id, None)

    def reset(self) -> None:
        with self._lock:
            self._subs.clear()
            self._last.clear()


pubsub = PubSub()
