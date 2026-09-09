"""
Whole-case saves are guarded by an optimistic-concurrency revision: a save
built on a stale revision must be rejected (GraphConflictError -> HTTP 409)
instead of overwriting, so a second tab can never silently destroy work
saved elsewhere. These tests pin the repository's conditional-write shape
and the route's conflict handling.
"""

from typing import Any

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from talleyrand.features.graph.dtos import SaveGraphDataDTO
from talleyrand.features.graph.models import (
    GraphConflictError,
    GraphDataRepository,
    GraphDocument,
)
from talleyrand.features.graph.routes_graph import save as save_route
from talleyrand.models.user import User


def _graph(revision: int = 0) -> GraphDocument:
    return GraphDocument(
        name="A case",
        user_id="user@example.com",
        nodes=[],
        edges=[],
        node_contents=[],
        revision=revision,
    )


class _FakeCollection:
    """Records the queries the repository issues and plays back canned results."""

    def __init__(
        self,
        *,
        update_result: dict[str, Any] | None = None,
        existing_doc: dict[str, Any] | None = None,
        insert_raises: Exception | None = None,
    ) -> None:
        self.update_result = update_result
        self.existing_doc = existing_doc
        self.insert_raises = insert_raises
        self.update_calls: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = []
        self.find_one_calls: list[dict[str, Any]] = []
        self.inserted: dict[str, Any] | None = None

    async def find_one_and_update(self, filter: dict[str, Any], update: dict[str, Any], **kwargs):
        self.update_calls.append((filter, update, kwargs))
        return self.update_result

    async def find_one(self, filter: dict[str, Any], projection: dict[str, Any] | None = None):
        self.find_one_calls.append(filter)
        return self.existing_doc

    async def insert_one(self, document: dict[str, Any]):
        if self.insert_raises is not None:
            raise self.insert_raises
        self.inserted = document


class _FakeDB:
    def __init__(self, collection: _FakeCollection) -> None:
        self.collection = collection

    def __getitem__(self, name: str) -> _FakeCollection:
        return self.collection


@pytest.mark.asyncio
async def test_matching_revision_updates_conditionally_and_bumps():
    collection = _FakeCollection(update_result={"revision": 8})
    repo = GraphDataRepository(db=_FakeDB(collection))

    returned = await repo.save("user@example.com", "graph-1", _graph(revision=7))

    assert returned == 8
    (filter_doc, update_doc, kwargs), *_ = collection.update_calls
    # The write must be conditional on the revision the payload was built on
    assert filter_doc["revision"] == 7
    # Only the new revision comes back, never the whole case
    assert kwargs["projection"] == {"revision": 1}
    assert update_doc["$inc"] == {"revision": 1}
    # revision is advanced only via $inc, never overwritten from the payload
    assert "revision" not in update_doc["$set"]
    # the name is owned by the rename endpoint; a whole-case save can't revert it
    assert "name" not in update_doc["$set"]


@pytest.mark.asyncio
async def test_revision_zero_also_matches_documents_predating_the_field():
    collection = _FakeCollection(update_result={"revision": 1})
    repo = GraphDataRepository(db=_FakeDB(collection))

    await repo.save("user@example.com", "graph-1", _graph(revision=0))

    (filter_doc, _, _), *_ = collection.update_calls
    assert filter_doc["revision"] == {"$in": [0, None]}


@pytest.mark.asyncio
async def test_stale_revision_on_existing_case_is_a_conflict():
    collection = _FakeCollection(update_result=None, existing_doc={"_id": "graph-1"})
    repo = GraphDataRepository(db=_FakeDB(collection))

    with pytest.raises(GraphConflictError):
        await repo.save("user@example.com", "graph-1", _graph(revision=3))

    assert collection.inserted is None
    # The existence probe is scoped to the owner: an id owned by another user
    # must not read as "your case moved on".
    (existence_filter,) = collection.find_one_calls
    assert existence_filter == {"_id": "graph-1", "userId": "user@example.com"}


@pytest.mark.asyncio
async def test_create_inserts_at_revision_zero_with_its_name():
    collection = _FakeCollection()
    repo = GraphDataRepository(db=_FakeDB(collection))

    await repo.create("user@example.com", "graph-1", _graph(revision=9))

    assert collection.inserted is not None
    # A created case starts at 0 whatever the payload claims — an imported
    # file carries the revision it had in the account it was exported from.
    assert collection.inserted["revision"] == 0
    assert collection.inserted["name"] == "A case"
    assert collection.inserted["userId"] == "user@example.com"
    # A copy of a shared case must not arrive public.
    assert collection.inserted["shared"] is False


@pytest.mark.asyncio
async def test_racing_creates_yield_a_conflict_not_a_crash():
    collection = _FakeCollection(insert_raises=DuplicateKeyError("duplicate _id"))
    repo = GraphDataRepository(db=_FakeDB(collection))

    with pytest.raises(GraphConflictError):
        await repo.create("user@example.com", "graph-1", _graph())


@pytest.mark.asyncio
async def test_overwrite_writes_name_and_revision_unconditionally():
    collection = _FakeCollection(update_result=None)
    repo = GraphDataRepository(db=_FakeDB(collection))

    await repo.overwrite("user@example.com", "demo-1", _graph())

    (filter_doc, update_doc, kwargs), *_ = collection.update_calls
    assert "revision" not in filter_doc
    assert kwargs.get("upsert") is True
    assert update_doc["$set"]["name"] == "A case"
    assert update_doc["$set"]["revision"] == 0


class _ConflictingRepo:
    async def save(self, user_id: str, graph_id: str, graph_data: GraphDocument) -> int:
        raise GraphConflictError()


class _JobRepoSpy:
    def __init__(self) -> None:
        self.deleted: list[list[str]] | None = None

    async def get_for_graph(self, graph_id: str) -> list[Any]:
        return []

    async def delete_many(self, job_ids: list[str]) -> None:
        self.deleted = (self.deleted or []) + [job_ids]


@pytest.mark.asyncio
async def test_route_answers_409_and_retires_no_job_records_on_conflict():
    payload = SaveGraphDataDTO(
        id="7f1f35a4-9c02-4b6e-9a1c-2e2f2a1b3c4d",
        name="A case",
        nodes=[],
        edges=[],
        node_contents=[],
        revision=3,
    )
    job_repo = _JobRepoSpy()

    with pytest.raises(HTTPException) as exc_info:
        await save_route(
            payload=payload,
            repo=_ConflictingRepo(),
            job_repo=job_repo,
            user=User(id="u1", email="user@example.com"),
        )

    assert exc_info.value.status_code == 409
    # A rejected save must retire nothing: the records it would have acked
    # stay authoritative and are re-delivered when the client reloads.
    assert job_repo.deleted is None
