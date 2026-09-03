"""
A source URL is a string an attacker can choose. It reaches storage from a
hand-written JSON import and comes back out of a share link, and the frontend
turns it into an anchor's href — so a `javascript:` URL parked in an answer's
source list is a stored XSS on the reader's origin, where their API keys live.

The frontend refuses to build an href from anything but http(s) (the fix that
closes the hole); these tests pin the second line of defence, that such a URL
cannot be stored in the first place — which also holds for a case copied
straight from a share link, a path that never passes through the frontend.
"""

import uuid

import pytest
from pydantic import ValidationError

from talleyrand.features.graph.dtos import NodeContentDTO, WebSourceDTO
from talleyrand.features.graph.models import GraphDocument


@pytest.mark.parametrize(
    "url",
    [
        "https://arxiv.org/abs/2401.00001",
        "http://example.com/a?b=c#d",
        "HTTPS://Example.COM/Path",  # the scheme is case-insensitive
        "https://example.com",  # bare host, no trailing slash: stored verbatim
    ],
)
def test_web_urls_are_kept_as_written(url: str):
    assert WebSourceDTO(url=url).url == url


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(document.cookie)",
        "JavaScript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:msgbox(1)",
        "file:///etc/passwd",
        "//example.com/protocol-relative",
        "/research/1",
        "",
        # Leading whitespace and control characters are how a scheme hides from
        # a prefix check: browsers strip them before parsing, so a URL that
        # arrives with them is one two parsers could read differently.
        " javascript:alert(1)",
        "\tjavascript:alert(1)",
        "\njavascript:alert(1)",
        "java\tscript:alert(1)",
    ],
)
def test_everything_else_is_refused(url: str):
    with pytest.raises(ValidationError):
        WebSourceDTO(url=url)


def _node_content(source_url: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "query": "Does the source list link out safely?",
        "response": "See the sources below.",
        "selectedModel": "claude",
        "documents": [],
        "selectionSuggestions": [],
        "selections": [],
        "sources": [{"url": source_url, "title": "Harmless-looking title"}],
    }


def test_a_poisoned_source_sinks_the_whole_answer():
    """No partial acceptance: the answer carrying the URL fails to parse, so
    neither a save nor a share-copy can smuggle one past the API boundary."""
    with pytest.raises(ValidationError):
        NodeContentDTO.model_validate(_node_content("javascript:alert(1)"))


def test_a_poisoned_source_cannot_be_stored():
    with pytest.raises(ValidationError):
        GraphDocument(
            name="Imported case",
            user_id="reader@example.com",
            nodes=[],
            edges=[],
            node_contents=[_node_content("javascript:alert(1)")],
        )


def test_an_ordinary_case_still_stores():
    document = GraphDocument(
        name="Imported case",
        user_id="reader@example.com",
        nodes=[],
        edges=[],
        node_contents=[_node_content("https://example.com/paper")],
    )
    assert document.node_contents[0].sources[0].url == "https://example.com/paper"
