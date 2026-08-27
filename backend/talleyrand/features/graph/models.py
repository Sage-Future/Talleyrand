"""
Domain model for Graph data.
"""

from datetime import UTC, datetime
from typing import Annotated, Any

import bson
from fastapi.params import Depends
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from talleyrand.features.graph.dtos import (
    DeclinedQuestionDTO,
    DocumentDTO,
    EdgeDTO,
    NodeContentDTO,
    NodeDTO,
    ReadEventDTO,
    ResearchSuggestionDTO,
)
from talleyrand.infra.db import get_db

# Headroom under MongoDB's hard 16MB BSON cap, so a saved case is never one
# answer away from unstorable. The frontend enforces a smaller 12MB budget on
# attached documents; this is the server-side hard stop (HTTP 413 at the API).
MAX_GRAPH_BYTES = 15 * 1024 * 1024


class GraphTooLargeError(Exception):
    """The serialized case exceeds MAX_GRAPH_BYTES and cannot be stored."""

    def __init__(self, size_bytes: int) -> None:
        self.size_bytes = size_bytes
        super().__init__(f"graph document is {size_bytes} bytes; the maximum is {MAX_GRAPH_BYTES}")


def ensure_graph_fits(data_dict: dict[str, Any]) -> None:
    """Raise GraphTooLargeError if the document would exceed the storable size."""
    size_bytes = len(bson.encode(data_dict))
    if size_bytes > MAX_GRAPH_BYTES:
        raise GraphTooLargeError(size_bytes)


class GraphConflictError(Exception):
    """The stored case moved past the revision this save was built on.

    Raised instead of overwriting so a stale client (a second tab, another
    device) can never destroy work saved elsewhere; the caller answers 409
    and the client reloads the latest revision.
    """


class GraphDocument(BaseModel):
    """Domain model for Graph data stored in MongoDB."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,  # Accepts both snake_case and camelCase during parsing
    )

    name: str
    user_id: str
    nodes: list[NodeDTO]
    edges: list[EdgeDTO]
    node_contents: list[NodeContentDTO]
    created_at: datetime | None = None
    shared: bool = False

    # Optimistic-concurrency token: incremented on every accepted save. A save
    # carries the revision it was built on and only lands if the stored case
    # still has it (documents predating the field count as revision 0).
    revision: int = 0

    # Research view data (defaults keep old documents parseable)
    brief: str = ""
    case_documents: list[DocumentDTO] = []
    suggestions: list[ResearchSuggestionDTO] = []
    declined_questions: list[DeclinedQuestionDTO] = []
    read_history: list[ReadEventDTO] = []


class GraphDataRepository:
    """Repository for graph data operations."""

    def __init__(self, db: AsyncDatabase[Any]) -> None:
        self.db = db

    async def get_by_id(self, user_id: str, graph_id: str) -> tuple[str, GraphDocument] | None:
        """Get graph data by ID for a specific user. Returns (graph_id, graph_data) tuple."""

        data: dict[str, Any] | None = await self.db["graph_data"].find_one(
            {"_id": graph_id, "userId": user_id}
        )

        if data is None:
            return None

        # Extract _id before creating GraphDocument (GraphDocument doesn't have id field)
        graph_id = data["_id"]
        return (graph_id, GraphDocument(**data))

    async def get_all_metadata(self, user_id: str) -> list[dict[str, Any]]:
        """Get metadata for all user graphs (lightweight listing). Returns sorted by createdAt descending."""
        pipeline = [
            {"$match": {"userId": user_id}},
            {"$sort": {"createdAt": -1}},
            {
                "$project": {
                    "_id": 1,
                    "name": 1,
                    "createdAt": 1,
                    "nodeCount": {"$size": "$nodes"},
                    "edgeCount": {"$size": "$edges"},
                    "shared": {"$ifNull": ["$shared", False]},
                    # Names only: the listing tells the owner which files would
                    # travel with a share link, never the file contents.
                    "documentNames": {
                        "$map": {
                            "input": {"$ifNull": ["$caseDocuments", []]},
                            "as": "doc",
                            "in": "$$doc.name",
                        }
                    },
                }
            },
        ]

        cursor = await self.db["graph_data"].aggregate(pipeline)
        result = [doc async for doc in cursor]
        return result

    async def save(
        self, user_id: str, graph_id: str, graph_data: GraphDocument, *, force: bool = False
    ) -> int:
        """Save the working graph for a user; returns the stored revision.

        The write is conditional on graph_data.revision matching the stored
        document (a new graph is inserted at revision 0). On mismatch it
        raises GraphConflictError instead of overwriting, so two clients
        holding the same case can never silently destroy each other's work.
        force=True (demo seeding, where the code is the source of truth)
        overwrites unconditionally, name and revision included.

        Raises GraphTooLargeError instead of letting MongoDB reject an
        oversized document, so callers can answer with a clear 413.
        """

        # Serialize with camelCase field names using alias generator
        data_dict = graph_data.model_dump(mode="json", by_alias=True)
        data_dict.pop("userId", None)  # Don't update userId (set on creation only)
        data_dict.pop("createdAt", None)  # Don't update createdAt (set on creation only)
        data_dict.pop("shared", None)  # Don't update shared (managed by share endpoints only)
        # The name is owned by the rename endpoint (auto-naming uses it too), so a
        # whole-case save can't revert a rename that landed after its snapshot;
        # the payload's name is applied only when the case is first created.
        name = data_dict.pop("name")
        expected_revision = data_dict.pop("revision")

        ensure_graph_fits(data_dict)

        if force:
            await self.db["graph_data"].find_one_and_update(
                {"_id": graph_id, "userId": user_id},
                {
                    "$setOnInsert": {
                        "_id": graph_id,
                        "userId": user_id,
                        "createdAt": datetime.now(UTC),
                    },
                    "$set": {**data_dict, "name": name, "revision": expected_revision},
                },
                upsert=True,
            )
            return expected_revision

        # None in the $in also matches documents created before the revision
        # field existed; their first save migrates them ($inc treats a missing
        # field as 0).
        revision_matches: Any = {"$in": [0, None]} if expected_revision == 0 else expected_revision
        updated = await self.db["graph_data"].find_one_and_update(
            {"_id": graph_id, "userId": user_id, "revision": revision_matches},
            {"$set": data_dict, "$inc": {"revision": 1}},
            return_document=ReturnDocument.AFTER,
        )
        if updated is not None:
            return int(updated["revision"])

        # No match: either the case doesn't exist yet (create it) or a
        # concurrent writer moved the revision on (conflict). Scoped to the
        # user like every other query here — an id owned by someone else must
        # not read as "your case moved on" (it falls through to the insert,
        # whose duplicate-key failure covers it).
        existing = await self.db["graph_data"].find_one(
            {"_id": graph_id, "userId": user_id}, {"_id": 1}
        )
        if existing is not None:
            raise GraphConflictError()
        try:
            await self.db["graph_data"].insert_one(
                {
                    **data_dict,
                    "_id": graph_id,
                    "userId": user_id,
                    "name": name,
                    "createdAt": datetime.now(UTC),
                    "revision": 0,
                }
            )
        except DuplicateKeyError as exc:
            # Two first-saves raced; exactly one insert wins.
            raise GraphConflictError() from exc
        return 0

    async def delete(self, user_id: str, graph_id: str) -> bool:
        """Delete a graph by ID for a specific user."""
        result = await self.db["graph_data"].delete_one({"_id": graph_id, "userId": user_id})
        return result.deleted_count > 0

    async def rename(self, user_id: str, graph_id: str, new_name: str) -> bool:
        """Rename a graph by ID for a specific user."""
        result = await self.db["graph_data"].update_one(
            {"_id": graph_id, "userId": user_id},
            {"$set": {"name": new_name}},
        )
        return result.modified_count > 0

    async def get_shared_by_id(self, graph_id: str) -> tuple[str, GraphDocument] | None:
        """Get graph data by ID only if it is shared. No user scope."""
        data: dict[str, Any] | None = await self.db["graph_data"].find_one(
            {"_id": graph_id, "shared": True}
        )
        if data is None:
            return None
        graph_id = data["_id"]
        return (graph_id, GraphDocument(**data))

    async def set_shared(self, user_id: str, graph_id: str, *, shared: bool) -> bool:
        """Toggle the shared flag on a graph. Returns True if the graph was found and updated."""
        result = await self.db["graph_data"].update_one(
            {"_id": graph_id, "userId": user_id},
            {"$set": {"shared": shared}},
        )
        return result.matched_count > 0


def get_graph_repo(
    db: Annotated[AsyncDatabase[Any], Depends(get_db)],
) -> GraphDataRepository:
    """Dependency injection factory for GraphDataRepository."""
    return GraphDataRepository(db)
