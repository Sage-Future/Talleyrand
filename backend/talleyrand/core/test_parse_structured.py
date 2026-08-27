"""
Tests for parse_structured, the shared structured-output call.

These run the REAL OpenAI SDK client with only the network hop stubbed
(httpx.MockTransport), because the SDK does meaningful work client-side:
responses.parse() iterates the tools argument before any request, so an
explicit tools=None crashes with TypeError before the API is ever reached — a
fake OpenAI client masks exactly that class of bug.
"""

import json
from typing import Any

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic import BaseModel

from talleyrand.core import llm
from talleyrand.core.llm import StructuredGenerationError, parse_structured


class NameSchema(BaseModel):
    name: str


def _response_payload(text: str) -> dict[str, Any]:
    """A minimal successful Responses-API payload the SDK parses."""
    return {
        "id": "resp_1",
        "object": "response",
        "created_at": 1.0,
        "model": "gpt-test",
        "status": "completed",
        "error": None,
        "incomplete_details": None,
        "instructions": None,
        "metadata": {},
        "output": [
            {
                "type": "message",
                "id": "msg_1",
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text, "annotations": []}],
            }
        ],
        "parallel_tool_calls": True,
        "temperature": 1.0,
        "tool_choice": "auto",
        "tools": [],
        "top_p": 1.0,
    }


class _Transport:
    """Canned OpenAI backend recording each outgoing request body."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.response = httpx.Response(200, json=_response_payload('{"name": "Fusion"}'))

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        return self.response


@pytest.fixture
def openai_backend(monkeypatch) -> _Transport:
    transport = _Transport()

    def client_with_mock_transport(**kwargs):
        return AsyncOpenAI(
            **kwargs,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport.handler)),
        )

    monkeypatch.setattr(llm, "AsyncOpenAI", client_with_mock_transport)
    return transport


async def _call(**overrides):
    kwargs: dict[str, Any] = {
        "caller": "test",
        "model": "gpt-test",
        "api_key": "sk-test",
        "system_prompt": "system",
        "user_content": "user",
        "schema": NameSchema,
    }
    kwargs.update(overrides)
    return await parse_structured(**kwargs)


@pytest.mark.asyncio
async def test_call_without_web_search_or_reasoning_reaches_the_api(openai_backend):
    """The default call (no web search, no reasoning effort) must omit those
    params entirely — an explicit None for tools crashes inside the SDK."""
    parsed = await _call()

    assert parsed == NameSchema(name="Fusion")
    (body,) = openai_backend.requests
    assert "tools" not in body
    assert "reasoning" not in body


@pytest.mark.asyncio
async def test_web_search_and_reasoning_ride_along_when_requested(openai_backend):
    await _call(web_search_enabled=True, reasoning_effort="low")

    (body,) = openai_backend.requests
    assert body["tools"] == [{"type": "web_search"}]
    assert body["reasoning"] == {"effort": "low"}


@pytest.mark.asyncio
async def test_provider_error_becomes_structured_generation_error(openai_backend):
    openai_backend.response = httpx.Response(
        401, json={"error": {"message": "Incorrect API key provided: sk-test."}}
    )

    with pytest.raises(StructuredGenerationError, match="Incorrect API key"):
        await _call()
