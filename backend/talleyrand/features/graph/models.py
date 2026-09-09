"""
Domain model for Graph data.
"""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

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


# How much of the attached documents a load brings back. Their contents are
# the bulk of a case — megabytes of text and base64 PDF against kilobytes of
# questions and answers — and most readers never look at them: the cheat sheet
# lists the documents by name, the suggesters inline the text ones only.
# Leaving the rest in the database keeps such a reader's copy of the case
# small, and every concurrent job holds its own copy.
type DocumentLoad = Literal["full", "text_only", "names_only"]


def _without_document_contents(documents: DocumentLoad) -> dict[str, Any]:
    """
    A $set stage blanking document contents in place, at the case level and
    under every question. Ids, names and types survive, so a document is
    still listed by name and a PDF is still known to be one; its content
    becomes "", which DocumentDTO accepts. text_only keeps the text documents
    whole and blanks only the PDFs.
    """
    content = (
        {"$cond": [{"$eq": ["$$doc.type", "pdf"]}, "", "$$doc.content"]}
        if documents == "text_only"
        else ""
    )

    def blanked(field: str) -> dict[str, Any]:
        return {
            "$map": {
                "input": {"$ifNull": [field, []]},
                "as": "doc",
                "in": {"$mergeObjects": ["$$doc", {"content": content}]},
            }
        }

    return {
        "caseDocuments": blanked("$caseDocuments"),
        "nodeContents": {
            "$map": {
                "input": {"$ifNull": ["$nodeContents", []]},
                "as": "question",
                "in": {
                    "$mergeObjects": [
                        "$$question",
                        {"documents": blanked("$$question.documents")},
                    ]
                },
            }
        },
    }


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


class GraphNotFoundError(Exception):
    """The case a save targets is not in the database: it was deleted.

    A client's snapshot easily outlives the case it came from — a debounced
    autosave that fires after the delete, a second tab, a laptop waking up —
    and storing it would undo the delete, so the save is refused instead and
    the caller answers 404. create() is the only write that makes a case.
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


def _storable_fields(graph_data: GraphDocument) -> tuple[dict[str, Any], str, int]:
    """The document body a whole-case write stores, plus its name and revision.

    Strips what such a write must never carry: userId and createdAt belong to
    the case's creation, and shared is the share endpoints' to set. The name
    is owned by the rename endpoint (auto-naming uses it too), so a
    whole-case save can't revert a rename that landed after its snapshot — it
    is applied only where the case is created. The size guard runs here,
    before any database access.
    """

    data_dict = graph_data.model_dump(mode="json", by_alias=True)
    data_dict.pop("userId", None)  # Don't update userId (set on creation only)
    data_dict.pop("createdAt", None)  # Don't update createdAt (set on creation only)
    data_dict.pop("shared", None)  # Don't update shared (managed by share endpoints only)
    name = data_dict.pop("name")
    revision = data_dict.pop("revision")

    ensure_graph_fits(data_dict)
    return data_dict, name, revision


class GraphDataRepository:
    """Repository for graph data operations."""

    def __init__(self, db: AsyncDatabase[Any]) -> None:
        self.db = db

    async def get_by_id(
        self, user_id: str, graph_id: str, *, documents: DocumentLoad = "full"
    ) -> tuple[str, GraphDocument] | None:
        """Get graph data by ID for a specific user. Returns (graph_id, graph_data) tuple.

        `documents` says how much of the attached documents comes back (see
        DocumentLoad): anything but "full" hands back a case whose document
        contents are blank, for readers that never look at them.
        """
        query = {"_id": graph_id, "userId": user_id}
        if documents == "full":
            data: dict[str, Any] | None = await self.db["graph_data"].find_one(query)
        else:
            # A find projection would have to name every other field to keep
            # it; a $set stage rewrites the two document lists and leaves the
            # rest of the document as it is.
            cursor = await self.db["graph_data"].aggregate(
                [
                    {"$match": query},
                    {"$limit": 1},
                    {"$set": _without_document_contents(documents)},
                ]
            )
            found = [doc async for doc in cursor]
            data = found[0] if found else None

        if data is None:
            return None

        # Extract _id before creating GraphDocument (GraphDocument doesn't have id field)
        graph_id = data["_id"]
        return (graph_id, GraphDocument(**data))

    async def exists(self, user_id: str, graph_id: str) -> bool:
        """Whether the user owns a case with this id, without loading it.

        A case is one document with its attachments inside, so fetching it
        just to see that it is there costs megabytes per call — and the job
        endpoints and every stream connection ask exactly that.
        """
        found = await self.db["graph_data"].find_one(
            {"_id": graph_id, "userId": user_id}, {"_id": 1}
        )
        return found is not None

    async def get_questions_and_answers(
        self, user_id: str, graph_id: str, *, answer_chars: int
    ) -> list[tuple[str, str]] | None:
        """Every question with the first answer_chars of its answer, in case order.

        What naming a case needs, cut down in the database: the rest of the
        document — the attached documents above all — never leaves it.
        Returns None if the user has no such case.
        """
        data = await self.db["graph_data"].find_one(
            {"_id": graph_id, "userId": user_id},
            {
                "nodeContents": {
                    "$map": {
                        "input": {"$ifNull": ["$nodeContents", []]},
                        "as": "question",
                        "in": {
                            "query": "$$question.query",
                            "response": {"$substrCP": ["$$question.response", 0, answer_chars]},
                        },
                    }
                }
            },
        )
        if data is None:
            return None
        return [
            (item.get("query") or "", item.get("response") or "")
            for item in data.get("nodeContents", [])
        ]

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

    async def create(self, user_id: str, graph_id: str, graph_data: GraphDocument) -> None:
        """Insert a new case at revision 0. The only write that makes one.

        Saves never create (see save), so every case enters the database here:
        a new empty case, a copy of a shared one, an imported file. The
        caller's revision is ignored — a new case starts at 0 — and userId,
        createdAt and shared are set here rather than taken from the payload,
        so an imported file can't claim another owner or arrive public.

        Raises GraphConflictError if the id is already taken (two creates
        raced), and GraphTooLargeError like save().
        """

        data_dict, name, _ = _storable_fields(graph_data)
        try:
            await self.db["graph_data"].insert_one(
                {
                    **data_dict,
                    "_id": graph_id,
                    "userId": user_id,
                    "name": name,
                    "createdAt": datetime.now(UTC),
                    "shared": False,
                    "revision": 0,
                }
            )
        except DuplicateKeyError as exc:
            raise GraphConflictError() from exc

    async def save(self, user_id: str, graph_id: str, graph_data: GraphDocument) -> int:
        """Save the working graph for a user; returns the stored revision.

        The write is conditional on graph_data.revision matching the stored
        document. On mismatch it raises GraphConflictError instead of
        overwriting, so two clients holding the same case can never silently
        destroy each other's work.

        A save never creates a case. A client saves a snapshot taken up to a
        debounce ago, and that snapshot can outlive the case itself: writing
        it as a new document would silently undo a delete, which the privacy
        policy promises is immediate and final. A save matching no document
        of this user's therefore raises GraphNotFoundError; create() is the
        only path that inserts one.

        Raises GraphTooLargeError instead of letting MongoDB reject an
        oversized document, so callers can answer with a clear 413.
        """

        data_dict, _, expected_revision = _storable_fields(graph_data)

        # None in the $in also matches documents created before the revision
        # field existed; their first save migrates them ($inc treats a missing
        # field as 0).
        revision_matches: Any = {"$in": [0, None]} if expected_revision == 0 else expected_revision
        updated = await self.db["graph_data"].find_one_and_update(
            {"_id": graph_id, "userId": user_id, "revision": revision_matches},
            {"$set": data_dict, "$inc": {"revision": 1}},
            # Only the new revision is read back. Without the projection the
            # whole case — every document — would come back to be decoded and
            # thrown away on every autosave.
            projection={"revision": 1},
            return_document=ReturnDocument.AFTER,
        )
        if updated is not None:
            return int(updated["revision"])

        # No match: either a concurrent writer moved the revision on, or the
        # case is gone. Scoped to the user like every other query here — an id
        # owned by someone else must read as gone, not as "your case moved on".
        existing = await self.db["graph_data"].find_one(
            {"_id": graph_id, "userId": user_id}, {"_id": 1}
        )
        if existing is None:
            raise GraphNotFoundError()
        raise GraphConflictError()

    async def overwrite(self, user_id: str, graph_id: str, graph_data: GraphDocument) -> None:
        """Write a case whole — name and revision included — creating it if absent.

        For demo seeding only, where the code is the source of truth and
        nothing else ever writes these cases. Every other write goes through
        create() or save() and respects the stored revision.
        """

        data_dict, name, revision = _storable_fields(graph_data)
        await self.db["graph_data"].find_one_and_update(
            {"_id": graph_id, "userId": user_id},
            {
                "$setOnInsert": {
                    "_id": graph_id,
                    "userId": user_id,
                    "createdAt": datetime.now(UTC),
                },
                "$set": {**data_dict, "name": name, "revision": revision},
            },
            upsert=True,
            projection={"_id": 1},
        )

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
