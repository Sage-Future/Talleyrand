"""
The boundary that replaces sign-in (see main.apply_local_boundary).

With every request signed in as the operator, what keeps strangers out has to
come from the request itself, not from how the server was launched:

- the peer must be this machine. A remote client is refused whatever Host
  header it sends, even if the server was bound to every interface;
- a state-changing request (anything but GET/HEAD/OPTIONS, and every
  WebSocket) that a browser marks as coming from another origin is refused. A
  page can POST without a CORS preflight (no Content-Type, text/plain, a form),
  and CORS only hides the response, so without this any site the operator
  visits could spend their subscription or write to their cases. Browsers send
  Origin on every cross-origin POST; a request without one comes from a local
  tool, not a page.

TrustedHostMiddleware stays alongside: it is what stops a DNS-rebinding page,
whose requests look same-origin, from reading anything.
"""

import ipaddress

from starlette.datastructures import Headers
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class LocalOnlyMiddleware:
    def __init__(self, app: ASGIApp, allowed_origins: list[str]) -> None:
        self.app = app
        self.allowed_origins = set(allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            refusal = self._refusal(scope)
            if refusal is not None:
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008, "reason": refusal})
                else:
                    await PlainTextResponse(refusal, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)

    def _refusal(self, scope: Scope) -> str | None:
        client = scope.get("client")
        if not client or not _is_loopback(client[0]):
            return "Local mode only accepts connections from this machine."
        state_changing = scope["type"] == "websocket" or scope["method"] not in SAFE_METHODS
        origin = Headers(scope=scope).get("origin")
        if state_changing and origin is not None and origin not in self.allowed_origins:
            return "Cross-site request refused."
        return None


def _is_loopback(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False
