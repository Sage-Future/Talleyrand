"""
Tests for weaving the Anthropic text stream — each web-search source must land
as a Markdown link right after the claim it supports, repeat sources collapse to
one link, answers without citations pass through unchanged, and anything that
changes who answered the question (a fallback to a stand-in model, a refusal)
becomes a visible line rather than silently altering or emptying the answer.

Also for what the stream reports separately from the answer: every page a
search put in front of Claude, whether or not the answer went on to cite it.
"""

from collections.abc import Iterable

import pytest
from anthropic.types import (
    CitationsDelta,
    CitationsWebSearchResultLocation,
    MessageDeltaUsage,
    RawContentBlockDeltaEvent,
    RawContentBlockStartEvent,
    RawMessageDeltaEvent,
    RawMessageStopEvent,
    RawMessageStreamEvent,
    TextDelta,
    WebSearchResultBlock,
    WebSearchToolResultBlock,
    WebSearchToolResultError,
)
from anthropic.types.beta import (
    BetaFallbackBlock,
    BetaFallbackInfo,
    BetaFallbackMessageIterationUsage,
    BetaMessageDeltaUsage,
    BetaRawContentBlockStartEvent,
    BetaRawMessageDeltaEvent,
    BetaRawMessageStreamEvent,
)
from anthropic.types.beta.beta_raw_message_delta_event import Delta as BetaDelta
from anthropic.types.raw_message_delta_event import Delta

from talleyrand.core.llm import (
    MAX_WEB_SOURCES,
    SourceChunk,
    StreamChunk,
    TextChunk,
    WebSource,
    WebSourceCollector,
    _weave_anthropic_deltas,
)

MODEL_LABEL = "Claude Opus 5 max"


def _text(text: str) -> RawContentBlockDeltaEvent:
    return RawContentBlockDeltaEvent(
        type="content_block_delta",
        index=0,
        delta=TextDelta(type="text_delta", text=text),
    )


def _citation(url: str, title: str | None) -> RawContentBlockDeltaEvent:
    return RawContentBlockDeltaEvent(
        type="content_block_delta",
        index=0,
        delta=CitationsDelta(
            type="citations_delta",
            citation=CitationsWebSearchResultLocation(
                type="web_search_result_location",
                url=url,
                title=title,
                cited_text="cited text",
                encrypted_index="idx",
            ),
        ),
    )


def _search_results(*results: tuple[str, str, str | None]) -> RawContentBlockStartEvent:
    """A finished search handing Claude the whole result list it was shown."""
    return RawContentBlockStartEvent(
        type="content_block_start",
        index=0,
        content_block=WebSearchToolResultBlock(
            type="web_search_tool_result",
            tool_use_id="srvtoolu_1",
            content=[
                WebSearchResultBlock(
                    type="web_search_result",
                    url=url,
                    title=title,
                    page_age=page_age,
                    encrypted_content="opaque",
                )
                for url, title, page_age in results
            ],
        ),
    )


def _failed_search() -> RawContentBlockStartEvent:
    return RawContentBlockStartEvent(
        type="content_block_start",
        index=0,
        content_block=WebSearchToolResultBlock(
            type="web_search_tool_result",
            tool_use_id="srvtoolu_2",
            content=WebSearchToolResultError(
                type="web_search_tool_result_error",
                error_code="max_uses_exceeded",
            ),
        ),
    )


def _fallback(to_model: str) -> BetaRawContentBlockStartEvent:
    return BetaRawContentBlockStartEvent(
        type="content_block_start",
        index=0,
        content_block=BetaFallbackBlock(
            type="fallback",
            to=BetaFallbackInfo(model=to_model),
            **{"from": BetaFallbackInfo(model="claude-opus-5")},
        ),
    )


def _served_by_fallback(model: str) -> BetaRawMessageDeltaEvent:
    """Closing event of a turn routed straight to the stand-in — no fallback block."""
    return BetaRawMessageDeltaEvent(
        type="message_delta",
        delta=BetaDelta(stop_reason="end_turn", stop_sequence=None),
        usage=BetaMessageDeltaUsage(
            output_tokens=12,
            iterations=[
                BetaFallbackMessageIterationUsage(
                    type="fallback_message",
                    model=model,
                    input_tokens=30,
                    output_tokens=12,
                    cache_creation_input_tokens=0,
                    cache_read_input_tokens=0,
                )
            ],
        ),
    )


def _refusal() -> RawMessageDeltaEvent:
    return RawMessageDeltaEvent(
        type="message_delta",
        delta=Delta(stop_reason="refusal", stop_sequence=None),
        usage=MessageDeltaUsage(output_tokens=0),
    )


async def _chunks(
    events: Iterable[RawMessageStreamEvent | BetaRawMessageStreamEvent],
) -> list[StreamChunk]:
    async def fake_stream():
        for event in events:
            yield event

    return [chunk async for chunk in _weave_anthropic_deltas(fake_stream(), MODEL_LABEL)]


async def _woven(events: Iterable[RawMessageStreamEvent | BetaRawMessageStreamEvent]) -> str:
    """The answer text alone, as the reader sees it."""
    return "".join(c.text for c in await _chunks(events) if isinstance(c, TextChunk))


async def _sources(
    events: Iterable[RawMessageStreamEvent | BetaRawMessageStreamEvent],
) -> list[WebSource]:
    """The sources the stream reported, merged the way an answer collects them."""
    collector = WebSourceCollector()
    for chunk in await _chunks(events):
        if isinstance(chunk, SourceChunk):
            collector.add(chunk.source)
    return collector.collected()


@pytest.mark.asyncio
async def test_citation_becomes_inline_link_after_cited_claim():
    result = await _woven(
        [
            _text("EV sales grew 35% in 2024"),
            _citation("https://iea.org/report", "Global EV Outlook"),
            _text(". Growth was strongest in China."),
        ]
    )
    assert result == (
        "EV sales grew 35% in 2024 ([Global EV Outlook](https://iea.org/report))"
        ". Growth was strongest in China."
    )


@pytest.mark.asyncio
async def test_link_attaches_before_paragraph_break_not_after():
    result = await _woven(
        [
            _text("First claim.\n\n"),
            _citation("https://a.com", "A"),
            _text("Second paragraph."),
        ]
    )
    assert result == "First claim. ([A](https://a.com))\n\nSecond paragraph."


@pytest.mark.asyncio
async def test_repeat_source_is_linked_once():
    result = await _woven(
        [
            _text("One claim"),
            _citation("https://a.com", "A"),
            _text(". Another claim"),
            _citation("https://a.com", "A"),
            _text("."),
        ]
    )
    assert result == "One claim ([A](https://a.com)). Another claim."


@pytest.mark.asyncio
async def test_missing_title_falls_back_to_domain():
    result = await _woven([_text("Claim"), _citation("https://www.example.com/some/page", None)])
    assert result == "Claim ([example.com](https://www.example.com/some/page))"


@pytest.mark.asyncio
async def test_markdown_breaking_characters_are_escaped():
    result = await _woven(
        [_text("Claim"), _citation("https://a.com/page_(draft)", "C:\\ [PDF] $100B Report")]
    )
    assert result == "Claim ([C:\\\\ \\[PDF\\] \\$100B Report](https://a.com/page_%28draft%29))"


@pytest.mark.asyncio
async def test_uncited_text_streams_through_unchanged():
    result = await _woven(
        [
            _text("Hello "),
            _text("world.\nSecond line."),
            RawMessageStopEvent(type="message_stop"),
        ]
    )
    assert result == "Hello world.\nSecond line."


@pytest.mark.asyncio
async def test_fallback_announces_the_model_that_took_over():
    result = await _woven([_fallback("claude-opus-4-8"), _text("Here is the answer.")])
    assert result == (
        f"\n\n*{MODEL_LABEL} declined this request — continuing with "
        "`claude-opus-4-8`.*\n\nHere is the answer."
    )


@pytest.mark.asyncio
async def test_refusal_without_fallback_names_the_refusing_model():
    result = await _woven([_refusal()])
    assert result == f"\n\n*{MODEL_LABEL} declined to answer this question.*\n\n"


@pytest.mark.asyncio
async def test_refusal_after_fallback_does_not_also_claim_an_answer():
    # Both notices fire when the stand-in refuses too. Read together they must
    # tell one coherent story — the handoff, then the outcome.
    result = await _woven([_fallback("claude-opus-4-8"), _refusal()])
    assert result == (
        f"\n\n*{MODEL_LABEL} declined this request — continuing with "
        "`claude-opus-4-8`.*\n\n"
        "\n\n*Every model that tried this request declined it.*\n\n"
    )


@pytest.mark.asyncio
async def test_answer_without_a_fallback_carries_no_notice():
    result = await _woven([_text("Plain answer."), RawMessageStopEvent(type="message_stop")])
    assert result == "Plain answer."


@pytest.mark.asyncio
async def test_stand_in_without_a_fallback_block_is_still_announced():
    # Anthropic remembers that a model declined and routes later requests
    # straight to the stand-in, with no fallback block in the stream — the
    # closing usage is then the only sign the answer came from another model.
    result = await _woven([_text("Here is the answer."), _served_by_fallback("claude-opus-4-8")])
    assert result == (
        "Here is the answer."
        f"\n\n*{MODEL_LABEL} did not write this answer — Anthropic routed "
        "the request to `claude-opus-4-8`.*\n\n"
    )


@pytest.mark.asyncio
async def test_announced_fallback_is_not_announced_twice_at_the_end():
    result = await _woven(
        [
            _fallback("claude-opus-4-8"),
            _text("Here is the answer."),
            _served_by_fallback("claude-opus-4-8"),
        ]
    )
    assert result.count("claude-opus-4-8") == 1


@pytest.mark.asyncio
async def test_every_search_result_is_reported_not_just_the_cited_ones():
    sources = await _sources(
        [
            _search_results(
                ("https://iea.org/report", "Global EV Outlook", "April 3, 2025"),
                ("https://blog.example.com/evs", "Some EV blog", None),
            ),
            _text("EV sales grew 35%"),
            _citation("https://iea.org/report", "Global EV Outlook"),
        ]
    )
    assert [(s.url, s.cited) for s in sources] == [
        ("https://iea.org/report", True),
        ("https://blog.example.com/evs", False),
    ]


@pytest.mark.asyncio
async def test_a_searched_source_keeps_its_page_age_once_cited():
    # Finding and citing arrive as separate events carrying different fields;
    # the citation must not overwrite what the search result already knew.
    sources = await _sources(
        [
            _search_results(("https://iea.org/report", "Global EV Outlook", "April 3, 2025")),
            _citation("https://iea.org/report", "Global EV Outlook"),
        ]
    )
    assert sources == [
        WebSource(
            url="https://iea.org/report",
            title="Global EV Outlook",
            page_age="April 3, 2025",
            cited=True,
        )
    ]


@pytest.mark.asyncio
async def test_the_same_page_found_by_two_searches_is_listed_once():
    sources = await _sources(
        [
            _search_results(("https://a.com", "A", None)),
            _search_results(("https://a.com", "A", None), ("https://b.com", "B", None)),
        ]
    )
    assert [s.url for s in sources] == ["https://a.com", "https://b.com"]


@pytest.mark.asyncio
async def test_a_source_cited_but_never_listed_is_still_reported():
    # Claude cites from a result list it may report under a different search;
    # a citation alone is enough to put the page in front of the reader.
    sources = await _sources([_text("Claim"), _citation("https://a.com", "A")])
    assert sources == [WebSource(url="https://a.com", title="A", cited=True)]


@pytest.mark.asyncio
async def test_a_failed_search_contributes_no_sources():
    sources = await _sources([_failed_search(), _text("Answering without the web.")])
    assert sources == []


@pytest.mark.asyncio
async def test_search_results_do_not_leak_into_the_answer_text():
    result = await _woven(
        [
            _search_results(("https://a.com", "A", None)),
            _text("The answer."),
        ]
    )
    assert result == "The answer."


def test_the_source_list_is_capped_but_never_drops_a_cited_one():
    # A single search can return dozens of results and an answer runs several,
    # so the haul is trimmed — the pages the answer rests on must survive it.
    collector = WebSourceCollector()
    for index in range(MAX_WEB_SOURCES * 2):
        collector.add(WebSource(url=f"https://example.com/{index}"))
    collector.add(WebSource(url="https://cited.example.com", cited=True))

    collected = collector.collected()
    assert len(collected) == MAX_WEB_SOURCES
    assert collected[0] == WebSource(url="https://cited.example.com", cited=True)
    # The trimmed list must not become the story: the true haul is still known.
    assert collector.found_count() == MAX_WEB_SOURCES * 2 + 1
