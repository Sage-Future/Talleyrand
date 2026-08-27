"""
ASGI middleware enforcing a hard cap on HTTP request-body size.

Nothing else bounds a request: uvicorn and FastAPI accept bodies of any size
and buffer them fully in memory before validation runs (and before auth, which
FastAPI resolves only after the body is read). Without this cap a single
client can take the whole instance out of memory with a few oversized POSTs.
"""

from fastapi import HTTPException, status
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Must comfortably exceed the largest legitimate request body: a whole-case
# save (and the report/suggest calls, which ship the full case as JSON) is
# hard-capped at MAX_GRAPH_BYTES = 15MB in storage. Anything bigger than this
# cap could never be stored or processed and only burns server memory.
MAX_REQUEST_BODY_BYTES = 20 * 1024 * 1024


def _too_large_detail(max_body_bytes: int) -> str:
    return f"Request body is too large; the limit is {max_body_bytes // (1024 * 1024)} MB."


class BodySizeLimitMiddleware:
    """Reject HTTP request bodies larger than max_body_bytes with HTTP 413.

    A Content-Length above the cap is refused before the body is read. Bodies
    streamed without Content-Length are cut off as soon as the running total
    crosses the cap: the wrapped receive raises HTTPException, which FastAPI's
    body reader re-raises for the exception middleware to turn into a 413
    (fastapi.routing documents this as the intended middleware contract).
    """

    def __init__(self, app: ASGIApp, max_body_bytes: int = MAX_REQUEST_BODY_BYTES) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if self._declared_length(scope) > self.max_body_bytes:
            response = JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content={"detail": _too_large_detail(self.max_body_bytes)},
            )
            await response(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=_too_large_detail(self.max_body_bytes),
                    )
            return message

        await self.app(scope, limited_receive, send)

    @staticmethod
    def _declared_length(scope: Scope) -> int:
        for name, value in scope["headers"]:
            if name == b"content-length":
                return int(value)
        return 0
