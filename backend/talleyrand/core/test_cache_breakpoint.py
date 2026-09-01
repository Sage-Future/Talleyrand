"""
Tests for where the Anthropic cache breakpoint lands.

Anthropic caches nothing unless the request says where its reusable prefix
ends, and it matches on exact bytes. The breakpoint must therefore close the
part a case's questions share — the brief and the documents — and nothing that
changes per question may fall inside it.
"""

from unittest.mock import AsyncMock

import pytest

from talleyrand.core import llm as llm_module
from talleyrand.core.llm import stream_text
from talleyrand.core.model_settings import get_model_config

PREFIX = "BRIEF:\nWhether the deal holds.\n\nCASE DOCUMENTS:\n  - plan: text\n\n"
BODY = "CASE TREE (fixed order; the user's case so far):\n[1] QUESTION: Does it hold?\n"


@pytest.fixture
def sent(monkeypatch) -> dict:
    """Capture the request instead of sending it; returns the kwargs it carried."""
    captured: dict = {}

    async def create(**kwargs):
        captured.update(kwargs)
        return AsyncMock()

    client = AsyncMock()
    client.messages.create = create
    client.beta.messages.create = create
    monkeypatch.setattr(llm_module, "AsyncAnthropic", lambda **_: client)
    return captured


async def send(cached_prefix: str, sent: dict) -> list[dict]:
    await stream_text(
        caller="test",
        model=get_model_config("claude-opus-5-max"),
        api_key="unused",
        instructions="INSTRUCTIONS",
        cached_prefix=cached_prefix,
        user_prompt=BODY,
        pdf_documents=[],
        web_search_enabled=False,
        verbosity="low",
    )
    return sent["messages"][0]["content"]


@pytest.mark.asyncio
async def test_breakpoint_closes_the_shared_prefix(sent):
    content = await send(PREFIX, sent)

    assert content[0]["text"] == PREFIX
    assert content[0]["cache_control"] == {"type": "ephemeral", "ttl": "5m"}
    # Everything that moves per question sits after the breakpoint, uncached.
    assert content[1]["text"] == BODY
    assert "cache_control" not in content[1]


@pytest.mark.asyncio
async def test_prompt_reads_the_same_as_before_the_split(sent):
    content = await send(PREFIX, sent)

    assert "".join(block["text"] for block in content) == PREFIX + BODY


@pytest.mark.asyncio
async def test_case_with_nothing_to_share_sends_no_empty_block(sent):
    """A case with no brief and no documents has no prefix; the API rejects an
    empty text block, and there would be nothing worth caching anyway."""
    content = await send("", sent)

    assert len(content) == 1
    assert content[0]["text"] == BODY
