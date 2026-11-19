"""
Tests for what each Claude preset puts on the wire.

These run the REAL Anthropic SDK client with only the network hop stubbed
(httpx.MockTransport). The SDK decides the endpoint and the beta header from
the method called and serializes the body itself, so a fake client would pass
a request the API rejects — a refusal-fallback form the SDK version cannot
send, or a fallback list on a model that has no fallback.
"""

import json
from typing import Any

import httpx
import pytest
from anthropic import AsyncAnthropic

from talleyrand.core import llm as llm_module
from talleyrand.core.llm import ANTHROPIC_REFUSAL_FALLBACK_BETA, stream_text
from talleyrand.core.model_settings import MODEL_CONFIGS, get_model_config

CLAUDE_PRESETS = [m.id for m in MODEL_CONFIGS.values() if m.provider == "anthropic"]


class _Transport:
    """Canned Anthropic backend recording each outgoing request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.bodies: list[dict[str, Any]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        # Decoded now: stream_text releases the request body once the response
        # has started, so it is empty by the time a test looks.
        self.bodies.append(json.loads(request.content))
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=b"")

    @property
    def body(self) -> dict[str, Any]:
        return self.bodies[-1]


@pytest.fixture
def transport(monkeypatch) -> _Transport:
    recorder = _Transport()

    def client(api_key: str) -> AsyncAnthropic:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(recorder))
        return AsyncAnthropic(api_key=api_key, http_client=http_client)

    monkeypatch.setattr(llm_module, "AsyncAnthropic", client)
    return recorder


async def send(preset_id: str, *, web_search_enabled: bool = False) -> None:
    stream = await stream_text(
        caller="test",
        model=get_model_config(preset_id),
        api_key="sk-ant-test",
        instructions="INSTRUCTIONS",
        cached_prefix="",
        user_prompt="Does it hold?",
        pdf_documents=[],
        web_search_enabled=web_search_enabled,
        verbosity="low",
    )
    await stream.aclose()


@pytest.mark.parametrize("preset_id", CLAUDE_PRESETS)
@pytest.mark.asyncio
async def test_every_preset_sends_its_own_effort(transport, preset_id):
    # Every current Claude model thinks by default, at a level that differs by
    # model, so the preset's level is always sent rather than left to Anthropic.
    await send(preset_id)

    body = transport.body
    assert body["model"] == MODEL_CONFIGS[preset_id].api_model
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": MODEL_CONFIGS[preset_id].reasoning_effort}


@pytest.mark.parametrize(
    "preset_id",
    [preset_id for preset_id in CLAUDE_PRESETS if MODEL_CONFIGS[preset_id].refusal_fallback],
)
@pytest.mark.asyncio
async def test_fallback_presets_let_anthropic_pick_the_stand_in(transport, preset_id):
    await send(preset_id)

    request = transport.requests[-1]
    assert request.url.params.get("beta") == "true"
    assert request.headers["anthropic-beta"] == ANTHROPIC_REFUSAL_FALLBACK_BETA
    assert transport.body["fallbacks"] == "default"


def test_fable_and_sonnet_opt_into_the_fallback_and_haiku_does_not():
    # Haiku 5.5 has no server-side fallback: a fallback list is a 400 there.
    fallback_models = {m.api_model for m in MODEL_CONFIGS.values() if m.refusal_fallback}
    assert fallback_models == {"claude-fable-5-2", "claude-sonnet-5-5"}


@pytest.mark.asyncio
async def test_haiku_goes_to_the_plain_endpoint_without_fallbacks(transport):
    await send("claude-haiku-5-5")

    request = transport.requests[-1]
    assert "beta" not in request.url.params
    assert "anthropic-beta" not in request.headers
    assert "fallbacks" not in transport.body


@pytest.mark.asyncio
async def test_web_search_is_called_directly_only(transport):
    await send("claude-haiku-5-5", web_search_enabled=True)

    assert transport.body["tools"] == [
        {"type": "web_search_20260209", "name": "web_search", "allowed_callers": ["direct"]}
    ]
