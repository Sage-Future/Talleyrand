"""
There is no sign-in, only the operator, so everything that keeps strangers out
has to come from the request itself:

- the peer must be this machine: a remote client is refused whatever Host it
  claims, however the server happens to be bound;
- the Host must name this machine, which stops a DNS-rebinding page from
  talking to the API as if it were same-origin;
- a state-changing request that a browser marks as coming from another origin
  is refused. A web page can send a POST without a CORS preflight (no
  Content-Type, text/plain, a form), and CORS only hides the response, so
  without this any page the operator visits could spend their subscription or
  write to their cases.
"""

from typing import Annotated

import pytest
from fastapi import Depends, FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from talleyrand.core.config import LOCAL_FRONTEND_ORIGIN, settings
from talleyrand.infra.local_user import current_user
from talleyrand.main import apply_local_boundary
from talleyrand.models.user import User

LOOPBACK = ("127.0.0.1", 50000)
FRONTEND = LOCAL_FRONTEND_ORIGIN


def _local_app() -> FastAPI:
    app = FastAPI()

    @app.get("/me")
    async def me(user: Annotated[User, Depends(current_user)]) -> User:
        return user

    @app.post("/act")
    async def act() -> dict:
        return {"acted": True}

    @app.websocket("/stream")
    async def stream(websocket: WebSocket) -> None:
        await websocket.accept()
        await websocket.send_text("events")
        await websocket.close()

    apply_local_boundary(app)
    return app


def _client(base_url: str = "http://localhost:8000", peer: tuple = LOOPBACK) -> TestClient:
    return TestClient(_local_app(), base_url=base_url, client=peer)


def test_every_request_is_the_operator_without_a_token():
    response = _client().get("/me")
    assert response.status_code == 200
    assert response.json()["email"] == settings.local_user_email


def test_loopback_by_ip_is_accepted():
    assert _client("http://127.0.0.1:8000").get("/me").status_code == 200


def test_ipv6_loopback_peer_is_accepted():
    assert _client(peer=("::1", 50000)).get("/me").status_code == 200


def test_a_request_for_any_other_host_is_refused():
    assert _client("http://attacker.example").get("/me").status_code == 400


def test_a_remote_peer_is_refused_even_when_it_claims_to_be_localhost():
    client = _client(peer=("192.168.1.99", 50000))
    assert client.get("/me").status_code == 403
    assert client.post("/act").status_code == 403


def test_a_cross_site_post_is_refused():
    # What fetch(url, {method: "POST", mode: "no-cors"}) from any page sends.
    response = _client().post("/act", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


def test_the_local_frontends_own_post_is_accepted():
    response = _client().post("/act", headers={"Origin": FRONTEND})
    assert response.status_code == 200


def test_a_post_with_no_origin_is_accepted():
    # Browsers always send Origin on a cross-origin POST; a request without one
    # comes from a local tool, not a web page.
    assert _client().post("/act").status_code == 200


def test_a_cross_site_read_is_left_to_cors():
    # A GET changes nothing, and CORS already keeps its response from the page.
    response = _client().get("/me", headers={"Origin": "https://evil.example"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_a_cross_site_websocket_is_refused():
    # The job stream has no credential of its own: the Origin check is what
    # keeps another site's page from reading a case's answers as they arrive.
    client = _client()
    with (
        pytest.raises(WebSocketDisconnect) as refused,
        client.websocket_connect(
            "ws://localhost:8000/stream", headers={"Origin": "https://evil.example"}
        ),
    ):
        pass
    assert refused.value.code == 1008


def test_the_local_frontends_websocket_is_accepted():
    with _client().websocket_connect(
        "ws://localhost:8000/stream", headers={"Origin": FRONTEND}
    ) as websocket:
        assert websocket.receive_text() == "events"
