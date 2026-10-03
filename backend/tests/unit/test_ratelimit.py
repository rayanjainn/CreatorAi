from __future__ import annotations

from app.llm.ratelimit import SlidingWindowLimiter


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def make() -> tuple[SlidingWindowLimiter, FakeClock]:
    clock = FakeClock()
    return SlidingWindowLimiter(clock=clock, sleep=clock.sleep), clock


def test_allows_up_to_limit_then_blocks() -> None:
    limiter, _ = make()
    assert all(limiter.acquire("k", 3, timeout=0) for _ in range(3))
    assert not limiter.acquire("k", 3, timeout=0)
    assert 0 < limiter.retry_after("k", 3) <= 60


def test_window_slides() -> None:
    limiter, clock = make()
    for _ in range(2):
        limiter.acquire("k", 2, timeout=0)
    clock.now = 59.0
    assert not limiter.acquire("k", 2, timeout=0)
    clock.now = 60.5
    assert limiter.acquire("k", 2, timeout=0)


def test_blocks_until_slot_opens_within_timeout() -> None:
    limiter, clock = make()
    limiter.acquire("k", 1, timeout=0)
    assert limiter.acquire("k", 1, timeout=70)
    assert clock.now >= 60


def test_gives_up_after_timeout() -> None:
    limiter, _ = make()
    limiter.acquire("k", 1, timeout=0)
    assert not limiter.acquire("k", 1, timeout=5)


def test_token_cost_and_independent_keys() -> None:
    limiter, _ = make()
    assert limiter.acquire("tpm", 100, cost=80, timeout=0)
    assert not limiter.acquire("tpm", 100, cost=30, timeout=0)
    assert limiter.acquire("other", 100, cost=30, timeout=0)
    assert limiter.acquire("big", 10, cost=50, timeout=0)  # oversize cost never deadlocks
