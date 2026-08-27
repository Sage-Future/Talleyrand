"""
Per-account rate limiting for the expensive endpoints.

Signup is open to any Google account, so authentication alone does not protect
the shared instance: every LLM-backed endpoint parses the whole case, builds
context and calls a provider, and nothing else bounds how often one account
may do that. Limits are deliberately generous — an order of magnitude above
real interactive use — so they only ever stop runaway clients and abuse.

In-memory and single-process by design, matching how the app is deployed.
"""

import time
from collections import deque
from collections.abc import Callable
from math import ceil
from typing import Annotated

from fastapi import Depends, HTTPException, status

from talleyrand.features.auth_jwt import router as auth_app
from talleyrand.models.user import User

WINDOW_SECONDS = 60.0

# Every this many checks, drop keys whose entries all fell out of the window,
# so accounts that stopped calling do not accumulate in memory forever.
_SWEEP_EVERY = 4096


class SlidingWindowRateLimiter:
    """Counts events per key over a sliding window; no locking needed because
    all checks run on the single event loop with no awaits in between."""

    def __init__(
        self,
        window_seconds: float = WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.window_seconds = window_seconds
        self._clock = clock
        self._events: dict[str, deque[float]] = {}
        self._checks = 0

    def try_acquire(self, key: str, limit: int) -> float | None:
        """Record one event for key and return None, or — when the key is at
        its limit — record nothing and return the seconds until a slot frees."""
        now = self._clock()
        self._sweep(now)
        events = self._events.setdefault(key, deque())
        cutoff = now - self.window_seconds
        while events and events[0] <= cutoff:
            events.popleft()
        if len(events) >= limit:
            return events[0] - cutoff
        events.append(now)
        return None

    def _sweep(self, now: float) -> None:
        self._checks += 1
        if self._checks % _SWEEP_EVERY:
            return
        cutoff = now - self.window_seconds
        stale = [key for key, events in self._events.items() if not events or events[-1] <= cutoff]
        for key in stale:
            del self._events[key]


_limiter = SlidingWindowRateLimiter()


def per_user_rate_limit(scope: str, *, per_minute: int):
    """Build a route dependency capping how often one account may call the
    routes sharing `scope`. Exceeding the cap answers 429 with Retry-After."""

    async def check(user: Annotated[User, Depends(auth_app.require_auth)]) -> None:
        retry_after = _limiter.try_acquire(f"{scope}:{user.email}", per_minute)
        if retry_after is not None:
            seconds = max(1, ceil(retry_after))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Too many requests: this action is limited to {per_minute} per minute. "
                    f"Try again in {seconds} seconds."
                ),
                headers={"Retry-After": str(seconds)},
            )

    return check
