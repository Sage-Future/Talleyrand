"""
The hosted instance is open to any Google account, so per-account rate limits
on the LLM-backed endpoints are what keeps one client from saturating the
shared server. These tests pin the limiter's window arithmetic and the route
behavior: 429 with Retry-After at the cap, per-account isolation, and no
lockout extension from rejected attempts.
"""

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from talleyrand.features.auth_jwt import router as auth_app
from talleyrand.features.rate_limit.service import (
    _SWEEP_EVERY,
    SlidingWindowRateLimiter,
    per_user_rate_limit,
)
from talleyrand.models.user import User


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_allows_up_to_the_limit_then_blocks():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(window_seconds=60.0, clock=clock)

    assert limiter.try_acquire("key", limit=2) is None
    assert limiter.try_acquire("key", limit=2) is None
    assert limiter.try_acquire("key", limit=2) == 60.0


def test_blocked_attempts_do_not_extend_the_lockout():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(window_seconds=60.0, clock=clock)
    limiter.try_acquire("key", limit=1)

    clock.now += 50.0
    assert limiter.try_acquire("key", limit=1) == 10.0
    clock.now += 10.1
    assert limiter.try_acquire("key", limit=1) is None


def test_window_slides_open_again():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(window_seconds=60.0, clock=clock)
    limiter.try_acquire("key", limit=1)

    clock.now += 60.1
    assert limiter.try_acquire("key", limit=1) is None


def test_keys_are_independent():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(window_seconds=60.0, clock=clock)

    assert limiter.try_acquire("one", limit=1) is None
    assert limiter.try_acquire("two", limit=1) is None
    assert limiter.try_acquire("one", limit=1) is not None


def test_idle_keys_are_swept_so_memory_stays_bounded():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(window_seconds=60.0, clock=clock)
    limiter.try_acquire("idle", limit=1)

    clock.now += 61.0
    for _ in range(_SWEEP_EVERY):
        limiter.try_acquire("busy", limit=10**9)

    assert "idle" not in limiter._events


def _build_app(scope: str, per_minute: int) -> FastAPI:
    app = FastAPI()

    @app.post(
        "/limited",
        dependencies=[Depends(per_user_rate_limit(scope, per_minute=per_minute))],
    )
    async def limited() -> dict:
        return {"ok": True}

    return app


def _as_user(app: FastAPI, email: str) -> None:
    app.dependency_overrides[auth_app.require_auth] = lambda: User(id="1", email=email)


def test_route_answers_429_with_retry_after_at_the_cap():
    app = _build_app("test-cap", per_minute=2)
    _as_user(app, "someone@example.com")
    client = TestClient(app)

    assert client.post("/limited").status_code == 200
    assert client.post("/limited").status_code == 200

    blocked = client.post("/limited")
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) >= 1
    assert "per minute" in blocked.json()["detail"]


def test_accounts_are_limited_independently():
    app = _build_app("test-isolation", per_minute=1)
    client = TestClient(app)

    _as_user(app, "first@example.com")
    assert client.post("/limited").status_code == 200
    assert client.post("/limited").status_code == 429

    _as_user(app, "second@example.com")
    assert client.post("/limited").status_code == 200
