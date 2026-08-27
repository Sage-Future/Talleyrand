"""
Requests used to be unbounded: uvicorn/FastAPI buffer any body fully in memory
before validation or auth runs, so oversized POSTs could OOM the instance.
These tests pin the transport-level cap: declared oversized bodies are refused
up front, chunked bodies are cut off mid-read, and everything legitimate —
including the largest storable case and WebSocket traffic — still passes.
"""

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from pydantic import BaseModel

from talleyrand.features.graph.models import MAX_GRAPH_BYTES
from talleyrand.infra.body_limit import MAX_REQUEST_BODY_BYTES, BodySizeLimitMiddleware

CAP = 1024


class EchoBody(BaseModel):
    text: str


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(BodySizeLimitMiddleware, max_body_bytes=CAP)

    @app.post("/echo")
    async def echo(body: EchoBody) -> dict:
        return {"length": len(body.text)}

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_text(await websocket.receive_text())

    return app


def test_the_cap_admits_the_largest_storable_case():
    assert MAX_REQUEST_BODY_BYTES > MAX_GRAPH_BYTES


def test_small_request_passes_through():
    client = TestClient(_build_app())
    response = client.post("/echo", json={"text": "hello"})
    assert response.status_code == 200
    assert response.json() == {"length": 5}


def test_declared_oversized_body_is_rejected_up_front():
    client = TestClient(_build_app())
    response = client.post(
        "/echo", content=b"x" * (CAP + 1), headers={"content-type": "application/json"}
    )
    assert response.status_code == 413
    assert "limit" in response.json()["detail"]


@pytest.mark.asyncio
async def test_streamed_body_without_content_length_is_cut_off_mid_read():
    app = _build_app()
    sent: list[dict] = []

    # Three 512-byte chunks: the cap is crossed on the third, before the body ends.
    messages = iter(
        [{"type": "http.request", "body": b"x" * 512, "more_body": True} for _ in range(3)]
        + [{"type": "http.request", "body": b"", "more_body": False}]
    )

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/echo",
        "raw_path": b"/echo",
        "query_string": b"",
        "root_path": "",
        "headers": [(b"content-type", b"application/json")],
        "client": ("test", 0),
        "server": ("test", 80),
    }

    await app(scope, receive, send)

    start = next(message for message in sent if message["type"] == "http.response.start")
    assert start["status"] == 413


def test_websocket_traffic_is_untouched():
    client = TestClient(_build_app())
    with client.websocket_connect("/ws") as websocket:
        websocket.send_text("ping")
        assert websocket.receive_text() == "ping"
