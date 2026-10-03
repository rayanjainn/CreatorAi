from __future__ import annotations

import threading

from app.workers.pubsub import PubSub


def test_replays_last_event_to_late_subscriber() -> None:
    bus = PubSub()
    bus.publish("j1", {"n": 1})
    bus.publish("j1", {"n": 2})
    sub = bus.subscribe("j1")
    assert sub.get(timeout=0.1) == {"n": 2}
    assert sub.get(timeout=0.05) is None
    bus.publish("j1", {"n": 3})
    assert sub.get(timeout=0.1) == {"n": 3}
    sub.close()


def test_channels_are_isolated_and_close_unsubscribes() -> None:
    bus = PubSub()
    a, b = bus.subscribe("a"), bus.subscribe("b")
    bus.publish("a", {"x": 1})
    assert a.get(timeout=0.1) == {"x": 1} and b.get(timeout=0.05) is None
    a.close()
    bus.publish("a", {"x": 2})
    assert a.get(timeout=0.05) is None
    assert bus.last_event("a") == {"x": 2}


def test_thread_safe_fanout() -> None:
    bus = PubSub()
    subs = [bus.subscribe("j") for _ in range(5)]

    def pump(start: int) -> None:
        for i in range(50):
            bus.publish("j", {"i": start + i})

    threads = [threading.Thread(target=pump, args=(k * 100,)) for k in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for sub in subs:
        received = []
        while (event := sub.get(timeout=0.05)) is not None:
            received.append(event)
        assert len(received) == 200
