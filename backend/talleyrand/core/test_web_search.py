"""
Web search for agent answers: the chosen provider's results reach the prompt,
every result is reported as a source, and only the ones the answer links to
count as cited. No test here reaches Kagi, Mixedbread or an agent CLI.
"""

import json

import httpx
import pytest

from talleyrand.core import llm, web_search
from talleyrand.core.llm import SourceChunk, TextChunk

RESULT = {"url": "https://example.org/vienna", "title": "Congress of Vienna", "snippet": "1815."}


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(web_search.settings, "kagi_api_key", "kagi-test-key")
    monkeypatch.setattr(web_search.settings, "mixedbread_api_key", "mxb-test-key")


@pytest.mark.asyncio
async def test_each_kagi_query_is_one_authenticated_search(key):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, str(request.url), request.headers["authorization"]))
        body = json.loads(request.content)
        return httpx.Response(200, json={"data": {"search": [RESULT | {"title": body["query"]}]}})

    results = await web_search.search(
        "kagi", ["vienna 1815", "talleyrand"], transport=httpx.MockTransport(handler)
    )

    assert {s[2] for s in seen} == {"Bearer kagi-test-key"}
    assert {s[:2] for s in seen} == {("POST", web_search.KAGI_URL)}
    # The same page found twice is one result, from the first query.
    assert [(r.url, r.title) for r in results] == [(RESULT["url"], "vienna 1815")]


@pytest.mark.asyncio
async def test_mixedbread_searches_its_web_store_and_reads_the_page_from_metadata(key):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(
            (str(request.url), request.headers["authorization"], json.loads(request.content))
        )
        # The shape of a web-store result, from Mixedbread's Web Store docs.
        page = {
            "type": "text",
            "text": "Congress of Vienna\n\nThe congress closed in June 1815.",
            "filename": RESULT["url"],
            "metadata": {
                "title": "Congress of Vienna",
                "url": RESULT["url"],
                "source": "web_search",
            },
        }
        return httpx.Response(200, json={"object": "list", "data": [page, {"text": "no url"}]})

    results = await web_search.search(
        "mixedbread", ["vienna 1815"], transport=httpx.MockTransport(handler)
    )

    ((url, auth, body),) = seen
    assert (url, auth) == (web_search.MIXEDBREAD_URL, "Bearer mxb-test-key")
    assert body["store_identifiers"] == ["mixedbread/web"]
    assert body["query"] == "vienna 1815"
    assert results == [
        web_search.SearchResult(
            url=RESULT["url"],
            title="Congress of Vienna",
            snippet="The congress closed in June 1815.",
            published=None,
        )
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider, status, body, message",
    [
        ("kagi", 401, {"errors": [{"message": "Invalid API key"}]}, "Kagi .*401: Invalid API key"),
        ("mixedbread", 401, {"detail": "Invalid API key"}, "Mixedbread .*401: Invalid API key"),
        ("mixedbread", 429, {"error": {"message": "Rate limited"}}, "429: Rate limited"),
        ("mixedbread", 500, [], "500: no detail"),
    ],
)
async def test_the_providers_error_message_reaches_the_user(key, provider, status, body, message):
    transport = httpx.MockTransport(lambda request: httpx.Response(status, json=body))
    with pytest.raises(web_search.SearchError, match=message):
        await web_search.search(provider, ["q"], transport=transport)


@pytest.mark.asyncio
@pytest.mark.parametrize("provider, label", [("kagi", "Kagi"), ("mixedbread", "Mixedbread")])
async def test_an_unreachable_provider_is_a_search_error(key, provider, label):
    def handler(request):
        raise httpx.ConnectError("offline")

    with pytest.raises(web_search.SearchError, match=f"{label} could not be reached"):
        await web_search.search(provider, ["q"], transport=httpx.MockTransport(handler))


@pytest.fixture
def agent(monkeypatch):
    """A fake agent: writes one query, then answers citing one result."""
    calls: dict = {"prompts": []}

    async def fake_structured(**kwargs):
        calls["query_prompt"] = kwargs["user_content"]
        return llm.SearchQueries(queries=["congress of vienna", ""])

    async def fake_run(*, system_prompt, prompt, json_schema=None, model=None):
        calls["prompts"].append(prompt)
        return {"result": f"It held ([source]({RESULT['url']}))."}

    async def fake_search(provider, queries):
        calls["provider"], calls["queries"] = provider, queries
        return [
            web_search.SearchResult(
                RESULT["url"], RESULT["title"], RESULT["snippet"], "2020-01-01"
            ),
            web_search.SearchResult("https://example.org/other", "Other", "", None),
        ]

    monkeypatch.setattr(llm, "_parse_structured_agent", fake_structured)
    monkeypatch.setattr(llm.claude_code, "run", fake_run)
    monkeypatch.setattr(llm.web_search, "search", fake_search)
    return calls


async def _answer(**overrides):
    kwargs = {
        "caller": "test",
        "provider": "claude_code",
        "agent_model": "claude-sonnet-5-5",
        "instructions": "",
        "cached_prefix": "BRIEF ",
        "user_prompt": "CURRENT QUESTION: did it hold?",
        "pdf_documents": [],
        "web_search_enabled": True,
        "search_provider": "kagi",
        "verbosity": "low",
    } | overrides
    return [chunk async for chunk in await llm._stream_agent(**kwargs)]


@pytest.mark.asyncio
async def test_an_answer_searches_and_cites_what_it_links(key, agent):
    chunks = await _answer()

    assert agent["query_prompt"] == "CURRENT QUESTION: did it hold?"
    assert (agent["provider"], agent["queries"]) == ("kagi", ["congress of vienna"])
    prompt = agent["prompts"][0]
    assert prompt.startswith("BRIEF CURRENT QUESTION: did it hold?\n\nWEB SEARCH RESULTS")
    assert (
        "[1] Congress of Vienna (2020-01-01)\n    https://example.org/vienna\n    1815." in prompt
    )
    assert chunks[0].notes == ()
    assert [c.text for c in chunks if isinstance(c, TextChunk)] == [
        "It held ([source](https://example.org/vienna))."
    ]
    sources = [c.source for c in chunks if isinstance(c, SourceChunk)]
    assert [(s.url, s.cited) for s in sources] == [
        ("https://example.org/vienna", True),
        ("https://example.org/other", False),
    ]


@pytest.mark.asyncio
async def test_search_off_searches_nothing(key, agent):
    chunks = await _answer(web_search_enabled=False)

    assert "queries" not in agent and "query_prompt" not in agent
    assert not any(isinstance(c, SourceChunk) for c in chunks)


@pytest.mark.asyncio
async def test_without_a_key_nothing_is_spent_and_the_answer_says_so(agent):
    chunks = await _answer()

    assert "query_prompt" not in agent
    assert chunks[0].notes[0].startswith("Web search did not run (it needs a Kagi API key")


@pytest.mark.asyncio
async def test_a_failed_search_still_answers_and_says_so(key, agent, monkeypatch):
    async def failing_search(provider, queries):
        raise web_search.SearchError("Kagi could not be reached (ConnectError)")

    monkeypatch.setattr(llm.web_search, "search", failing_search)

    chunks = await _answer()

    assert "Kagi could not be reached" in chunks[0].notes[0]
    assert chunks[1].text.startswith("It held")


@pytest.mark.asyncio
async def test_an_answer_searches_with_the_provider_it_names(key, agent):
    await _answer(search_provider="mixedbread")

    assert agent["provider"] == "mixedbread"


@pytest.mark.asyncio
async def test_without_the_chosen_providers_key_the_answer_names_it(agent, monkeypatch):
    # A Kagi key does not stand in for a missing Mixedbread one.
    monkeypatch.setattr(web_search.settings, "kagi_api_key", "kagi-test-key")
    chunks = await _answer(search_provider="mixedbread")

    assert "query_prompt" not in agent
    assert "it needs a Mixedbread API key, MIXEDBREAD_API_KEY" in chunks[0].notes[0]
