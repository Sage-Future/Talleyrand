"""
Tests for reading web-search sources out of an OpenAI Responses stream.

OpenAI splits what Talleyrand needs across two places: a finished search call
lists every URL it showed the model but names none of them, while the finished
answer text names only the handful it cites. The payload shapes here are taken
from a recorded live response.
"""

from openai.types.responses import (
    ResponseFunctionWebSearch,
    ResponseOutputMessage,
    ResponseOutputRefusal,
    ResponseOutputText,
)
from openai.types.responses.response_function_web_search import (
    ActionOpenPage,
    ActionSearch,
    ActionSearchSource,
)
from openai.types.responses.response_output_text import AnnotationURLCitation

from talleyrand.core.llm import (
    WebSource,
    WebSourceCollector,
    _openai_cited_sources,
    _openai_searched_sources,
)


def _search_call(query: str, *urls: str) -> ResponseFunctionWebSearch:
    return ResponseFunctionWebSearch(
        id="ws_1",
        type="web_search_call",
        status="completed",
        action=ActionSearch(
            type="search",
            query=query,
            sources=[ActionSearchSource(type="url", url=url) for url in urls],
        ),
    )


def _open_page_call(url: str) -> ResponseFunctionWebSearch:
    return ResponseFunctionWebSearch(
        id="ws_2",
        type="web_search_call",
        status="completed",
        action=ActionOpenPage(type="open_page", url=url),
    )


def _answer_text(*citations: tuple[str, str]) -> ResponseOutputText:
    return ResponseOutputText(
        type="output_text",
        text="The answer.",
        annotations=[
            AnnotationURLCitation(
                type="url_citation",
                url=url,
                title=title,
                start_index=0,
                end_index=11,
            )
            for url, title in citations
        ],
    )


def test_a_search_reports_every_url_it_showed_the_model():
    sources = _openai_searched_sources(
        _search_call("compute governance", "https://arxiv.org/abs/1", "https://cset.org/a")
    )
    assert sources == [
        WebSource(url="https://arxiv.org/abs/1"),
        WebSource(url="https://cset.org/a"),
    ]


def test_a_search_that_returned_nothing_reports_nothing():
    call = ResponseFunctionWebSearch(
        id="ws_3",
        type="web_search_call",
        status="completed",
        action=ActionSearch(type="search", query="obscure", sources=None),
    )
    assert _openai_searched_sources(call) == []


def test_a_page_the_model_opened_counts_as_a_source():
    assert _openai_searched_sources(_open_page_call("https://arxiv.org/abs/1")) == [
        WebSource(url="https://arxiv.org/abs/1")
    ]


def test_output_items_that_are_not_searches_report_nothing():
    message = ResponseOutputMessage(
        id="msg_1",
        type="message",
        role="assistant",
        status="completed",
        content=[_answer_text(("https://a.com", "A"))],
    )
    assert _openai_searched_sources(message) == []


def test_the_answer_names_the_sources_it_cites():
    assert _openai_cited_sources(
        _answer_text(("https://arxiv.org/abs/1", "Compute thresholds"))
    ) == [WebSource(url="https://arxiv.org/abs/1", title="Compute thresholds", cited=True)]


def test_a_refusal_carries_no_citations():
    refusal = ResponseOutputRefusal(type="refusal", refusal="I can't help with that.")
    assert _openai_cited_sources(refusal) == []


def test_a_cited_page_is_the_same_row_as_the_search_result_that_found_it():
    # The two reports arrive from different events and only one carries a
    # title; the reader must end up with one row, titled and marked cited.
    collector = WebSourceCollector()
    for source in _openai_searched_sources(
        _search_call("compute governance", "https://arxiv.org/abs/1", "https://blog.example/x")
    ):
        collector.add(source)
    for source in _openai_cited_sources(
        _answer_text(("https://arxiv.org/abs/1", "Compute thresholds"))
    ):
        collector.add(source)

    assert collector.collected() == [
        WebSource(url="https://arxiv.org/abs/1", title="Compute thresholds", cited=True),
        WebSource(url="https://blog.example/x"),
    ]
