"""
The whole case is stored as ONE MongoDB document (16MB BSON hard cap).
These tests pin the save-path size guard: an oversized case must be rejected
with GraphTooLargeError (-> HTTP 413) instead of failing inside MongoDB,
which would leave autosave silently broken forever.
"""

import pytest

from talleyrand.features.graph.dtos import DocumentDTO
from talleyrand.features.graph.models import (
    MAX_GRAPH_BYTES,
    GraphDataRepository,
    GraphDocument,
    GraphTooLargeError,
    ensure_graph_fits,
)


def test_small_graph_fits():
    ensure_graph_fits({"name": "New case", "nodes": [], "edges": []})


def test_oversized_graph_is_rejected_with_its_size():
    with pytest.raises(GraphTooLargeError) as exc_info:
        ensure_graph_fits({"content": "a" * (MAX_GRAPH_BYTES + 1)})
    assert exc_info.value.size_bytes > MAX_GRAPH_BYTES


class _UnreachableDB:
    def __getitem__(self, name: str):
        raise AssertionError("the size guard must reject the graph before any DB access")


@pytest.mark.asyncio
async def test_save_rejects_oversized_case_before_touching_the_db():
    graph = GraphDocument(
        name="Bloated case",
        user_id="user@example.com",
        nodes=[],
        edges=[],
        node_contents=[],
        case_documents=[
            DocumentDTO(
                id="doc-1",
                name="huge",
                type="txt",
                content="a" * (MAX_GRAPH_BYTES + 1),
            )
        ],
    )
    repo = GraphDataRepository(db=_UnreachableDB())

    with pytest.raises(GraphTooLargeError):
        await repo.save("user@example.com", "graph-1", graph)
