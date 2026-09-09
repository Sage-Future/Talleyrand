"""
Tests for how much of a case a load brings back.

A case is one document, and its attached documents are most of it. A reader
that never looks at their contents must be able to leave them in the
database, an existence check must not fetch the case at all, and naming a
case must not pull its answers whole.
"""

from collections.abc import AsyncIterator
from typing import Any

import pytest

from talleyrand.features.graph.models import GraphDataRepository

OWNER = "user@example.com"

# What a projected load hands back: the same case, contents blanked in place.
STORED = {
    "_id": "graph-1",
    "userId": OWNER,
    "name": "A case",
    "revision": 4,
    "brief": "The brief.",
    "nodes": [{"id": "9a1f35a4-9c02-4b6e-9a1c-2e2f2a1b3c4d"}],
    "edges": [],
    "nodeContents": [
        {
            "id": "9a1f35a4-9c02-4b6e-9a1c-2e2f2a1b3c4d",
            "query": "Does it hold?",
            "response": "It holds, narrowly.",
            "selectedModel": "gpt-6-astra-medium",
            "documents": [{"id": "d2", "name": "scan", "type": "pdf", "content": ""}],
            "selectionSuggestions": [],
            "selections": [],
        }
    ],
    "caseDocuments": [{"id": "d1", "name": "plan", "type": "txt", "content": ""}],
}


class _Cursor:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self._docs = docs

    def __aiter__(self) -> AsyncIterator[dict[str, Any]]:
        async def gen():
            for doc in self._docs:
                yield doc

        return gen()


class _FakeCollection:
    """Records the queries the repository issues and plays back one canned document."""

    def __init__(self, stored: dict[str, Any] | None) -> None:
        self.stored = stored
        self.find_one_calls: list[tuple[dict[str, Any], dict[str, Any] | None]] = []
        self.pipelines: list[list[dict[str, Any]]] = []

    async def find_one(self, filter: dict[str, Any], projection: dict[str, Any] | None = None):
        self.find_one_calls.append((filter, projection))
        return self.stored

    async def aggregate(self, pipeline: list[dict[str, Any]]) -> _Cursor:
        self.pipelines.append(pipeline)
        return _Cursor([self.stored] if self.stored is not None else [])


class _FakeDB:
    def __init__(self, collection: _FakeCollection) -> None:
        self.collection = collection

    def __getitem__(self, name: str) -> _FakeCollection:
        return self.collection


def _repo(stored: dict[str, Any] | None) -> tuple[GraphDataRepository, _FakeCollection]:
    collection = _FakeCollection(stored)
    return GraphDataRepository(db=_FakeDB(collection)), collection


@pytest.mark.asyncio
async def test_a_full_load_fetches_the_whole_document():
    repo, collection = _repo(STORED)

    result = await repo.get_by_id(OWNER, "graph-1")

    assert result is not None
    assert collection.find_one_calls == [({"_id": "graph-1", "userId": OWNER}, None)]
    assert collection.pipelines == []


@pytest.mark.asyncio
@pytest.mark.parametrize("documents", ["names_only", "text_only"])
async def test_a_projected_load_rewrites_only_the_document_lists(documents):
    repo, collection = _repo(STORED)

    result = await repo.get_by_id(OWNER, "graph-1", documents=documents)

    assert result is not None
    graph_id, graph = result
    assert graph_id == "graph-1"
    # The case comes back whole apart from the contents: names and types are
    # what the readers of a projected load go on.
    assert graph.brief == "The brief."
    assert graph.revision == 4
    assert [(doc.name, doc.type, doc.content) for doc in graph.case_documents] == [
        ("plan", "txt", "")
    ]
    assert graph.node_contents[0].documents[0].content == ""

    assert collection.find_one_calls == []
    (pipeline,) = collection.pipelines
    assert pipeline[0] == {"$match": {"_id": "graph-1", "userId": OWNER}}
    assert pipeline[1] == {"$limit": 1}
    # Nothing but the two document lists is touched, so every other field —
    # present or added later — survives without being named here.
    assert set(pipeline[2]["$set"]) == {"caseDocuments", "nodeContents"}


@pytest.mark.asyncio
async def test_text_only_keeps_text_documents_and_blanks_pdfs():
    repo, collection = _repo(STORED)

    await repo.get_by_id(OWNER, "graph-1", documents="text_only")
    text_only = collection.pipelines[0][2]["$set"]
    await repo.get_by_id(OWNER, "graph-1", documents="names_only")
    names_only = collection.pipelines[1][2]["$set"]

    def content_of(stage: dict[str, Any]) -> Any:
        return stage["caseDocuments"]["$map"]["in"]["$mergeObjects"][1]["content"]

    assert content_of(names_only) == ""
    assert content_of(text_only) == {"$cond": [{"$eq": ["$$doc.type", "pdf"]}, "", "$$doc.content"]}


@pytest.mark.asyncio
async def test_a_projected_load_of_a_missing_case_is_none():
    repo, _ = _repo(None)

    assert await repo.get_by_id(OWNER, "graph-1", documents="names_only") is None


@pytest.mark.asyncio
async def test_exists_asks_for_the_id_alone():
    repo, collection = _repo({"_id": "graph-1"})

    assert await repo.exists(OWNER, "graph-1") is True
    assert collection.find_one_calls == [({"_id": "graph-1", "userId": OWNER}, {"_id": 1})]

    repo, _ = _repo(None)
    assert await repo.exists(OWNER, "graph-1") is False


@pytest.mark.asyncio
async def test_naming_reads_questions_with_the_opening_of_each_answer():
    repo, collection = _repo(
        {"_id": "graph-1", "nodeContents": [{"query": "Q", "response": "It h"}]}
    )

    questions = await repo.get_questions_and_answers(OWNER, "graph-1", answer_chars=4)

    assert questions == [("Q", "It h")]
    ((_, projection),) = collection.find_one_calls
    assert projection is not None
    # The cut is made in the database, at the requested length
    inner = projection["nodeContents"]["$map"]["in"]
    assert inner["response"] == {"$substrCP": ["$$question.response", 0, 4]}

    repo, _ = _repo(None)
    assert await repo.get_questions_and_answers(OWNER, "graph-1", answer_chars=4) is None
