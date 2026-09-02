"""
Tests for letting go of a streaming request's body.

A research request carries the whole case — its documents and PDFs — and the
HTTP stack keeps that body alive for as long as the response is being read,
which for a streamed answer is the whole generation. Once the provider has
started answering, the body has been sent and is never read again, so it is
released; anything that is not a real httpx response is left alone.
"""

import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from talleyrand.core.llm import _release_request_body


def _started_stream(payload: dict) -> tuple[SimpleNamespace, httpx.Request]:
    """A stream object as the SDKs shape it: the httpx response, request attached."""
    request = httpx.Request("POST", "https://api.example.com/v1/responses", json=payload)
    response = httpx.Response(200, request=request)
    return SimpleNamespace(response=response), request


def test_body_is_released_once_the_response_has_started():
    stream, request = _started_stream({"input": "x" * 100_000})
    body = request.content
    # httpcore hands the connection the very ByteStream the request holds and
    # keeps it for as long as the response body is being read.
    transport_side = request.stream
    assert sys.getrefcount(body) > 2  # held by the request, beyond this test

    _release_request_body(stream)

    assert sys.getrefcount(body) == 2  # this test's own reference, and getrefcount's
    assert request.content == b""
    assert b"".join(transport_side) == b""


def test_streams_without_an_httpx_response_are_left_alone():
    # Test doubles and any future SDK shape: nothing to release, nothing to break.
    _release_request_body(AsyncMock())
    _release_request_body(SimpleNamespace(response=object()))
    _release_request_body(object())
