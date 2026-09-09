"""
Deleting a case is final: the privacy policy promises it is "removed from the
database immediately" and that there is no undo.

The threat is not the delete itself but the save that follows it. A client
autosaves a snapshot taken up to a debounce ago, and that snapshot outlives
the case whenever the two cross: the pending save of the case just deleted,
a second tab, a laptop waking up on last week's state. A save that creates
the case it fails to find would put every one of those back, days later,
whole. These tests pin the rule that makes that impossible — a save never
creates a case — and the 404 the client is told to stop on.
"""

import uuid
from typing import Any

import pytest
from fastapi import HTTPException

from talleyrand.features.graph.dtos import ImportGraphDTO, SaveGraphDataDTO
from talleyrand.features.graph.models import (
    GraphDataRepository,
    GraphDocument,
    GraphNotFoundError,
)
from talleyrand.features.graph.routes_graph import import_case
from talleyrand.features.graph.routes_graph import save as save_route
from talleyrand.models.user import User


def _graph(revision: int = 4) -> GraphDocument:
    return GraphDocument(
        name="A case",
        user_id="user@example.com",
        nodes=[],
        edges=[],
        node_contents=[],
        revision=revision,
    )


class _DeletedCaseCollection:
    """A collection where the case is gone: nothing matches, nothing exists."""

    def __init__(self) -> None:
        self.delete_calls: list[dict[str, Any]] = []

    async def find_one_and_update(self, filter: dict[str, Any], update: dict[str, Any], **kwargs):
        return None

    async def find_one(self, filter: dict[str, Any], projection: dict[str, Any] | None = None):
        return None

    async def insert_one(self, document: dict[str, Any]):
        raise AssertionError("a save must never create the case it cannot find")

    async def delete_one(self, filter: dict[str, Any]):
        self.delete_calls.append(filter)

        class _Result:
            deleted_count = 1

        return _Result()


class _FakeDB:
    def __init__(self, collection: _DeletedCaseCollection) -> None:
        self.collection = collection

    def __getitem__(self, name: str) -> _DeletedCaseCollection:
        return self.collection


@pytest.mark.asyncio
async def test_save_of_a_deleted_case_is_refused_not_recreated():
    collection = _DeletedCaseCollection()
    repo = GraphDataRepository(db=_FakeDB(collection))

    # The revision the snapshot was built on says nothing about whether the
    # case is still there, so neither a stale one nor a first-save 0 may
    # insert (insert_one asserts).
    with pytest.raises(GraphNotFoundError):
        await repo.save("user@example.com", "graph-1", _graph(revision=7))
    with pytest.raises(GraphNotFoundError):
        await repo.save("user@example.com", "graph-1", _graph(revision=0))


@pytest.mark.asyncio
async def test_delete_removes_the_document_rather_than_marking_it():
    collection = _DeletedCaseCollection()
    repo = GraphDataRepository(db=_FakeDB(collection))

    assert await repo.delete("user@example.com", "graph-1") is True

    # "Removed from the database immediately": the case is deleted outright,
    # not flagged as deleted and left behind.
    assert collection.delete_calls == [{"_id": "graph-1", "userId": "user@example.com"}]


class _GoneRepo:
    async def save(self, user_id: str, graph_id: str, graph_data: GraphDocument) -> int:
        raise GraphNotFoundError()


class _JobRepoSpy:
    def __init__(self) -> None:
        self.deleted: list[list[str]] | None = None

    async def get_for_graph(self, graph_id: str) -> list[Any]:
        return []

    async def delete_many(self, job_ids: list[str]) -> None:
        self.deleted = (self.deleted or []) + [job_ids]


@pytest.mark.asyncio
async def test_route_answers_404_so_the_client_stops_instead_of_retrying():
    payload = SaveGraphDataDTO(
        id="7f1f35a4-9c02-4b6e-9a1c-2e2f2a1b3c4d",
        name="A case",
        nodes=[],
        edges=[],
        node_contents=[],
        revision=4,
    )
    job_repo = _JobRepoSpy()

    with pytest.raises(HTTPException) as exc_info:
        await save_route(
            payload=payload,
            repo=_GoneRepo(),
            job_repo=job_repo,
            user=User(id="u1", email="user@example.com"),
        )

    assert exc_info.value.status_code == 404
    # Not a conflict: reloading would 404 too. The client has to close the
    # case, which is a different thing to tell the user.
    assert "deleted" in str(exc_info.value.detail)
    # A rejected save retires nothing — same as a conflict.
    assert job_repo.deleted is None


class _CreateSpy:
    def __init__(self) -> None:
        self.created: list[tuple[str, str, GraphDocument]] = []

    async def create(self, user_id: str, graph_id: str, graph_data: GraphDocument) -> None:
        self.created.append((user_id, graph_id, graph_data))


@pytest.mark.asyncio
async def test_an_import_cannot_name_the_case_it_lands_on():
    """The one place a client used to create a case by choosing its id."""

    repo = _CreateSpy()
    payload = ImportGraphDTO(name="Imported", nodes=[], edges=[], node_contents=[])

    result = await import_case(
        payload=payload,
        repo=repo,  # type: ignore[arg-type]
        user=User(id="u1", email="user@example.com"),
    )

    ((user_id, graph_id, document),) = repo.created
    assert user_id == "user@example.com"
    assert document.user_id == "user@example.com"
    assert document.name == "Imported"
    # The id is minted here and the file has no say in it, so an import can
    # neither overwrite a case in the account nor land on a deleted one's id.
    assert uuid.UUID(graph_id)
    assert result == {"id": graph_id}
