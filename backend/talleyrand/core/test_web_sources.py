"""
Tests for collecting the sources behind one answer: every page a search put
in front of the model is reported, folded by URL, and the saved list is capped
without ever losing a page the answer cites.
"""

from talleyrand.core.llm import MAX_WEB_SOURCES, WebSource, WebSourceCollector


def test_the_same_page_reported_twice_is_listed_once_with_what_each_knew():
    collector = WebSourceCollector()
    collector.add(WebSource(url="https://example.com", title="Example", page_age="2020-01-01"))
    collector.add(WebSource(url="https://example.com", cited=True))

    assert collector.collected() == [
        WebSource(url="https://example.com", title="Example", page_age="2020-01-01", cited=True)
    ]


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
