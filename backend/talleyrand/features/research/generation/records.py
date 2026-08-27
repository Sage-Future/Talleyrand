"""
Persistent job records for durable generation.

Records live in their own collection (not inside the graph document) so the
whole-document graph upsert can never touch them. All terminal writes are
conditional on the record still existing: a record pruned by a save (node
deleted) silently absorbs the late completion instead of resurrecting.
"""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import uuid4

from fastapi.params import Depends
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from pymongo.asynchronous.database import AsyncDatabase

from talleyrand.features.graph.dtos import ResearchSuggestionDTO, WebSourceDTO
from talleyrand.infra.db import get_db

JobKind = Literal["answer", "suggestions", "big_picture", "cheat_sheet"]
JobStatus = Literal["queued", "running", "done", "error"]


class GenerationJobRecord(BaseModel):
    """One generation job: an LLM answer, a suggestion batch, or a cheat sheet."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    graph_id: str
    user_id: str
    kind: JobKind
    node_id: str | None  # answer/suggestions/cheat_sheet: the question node; big_picture: None
    status: JobStatus
    created_at: datetime

    # Terminal payloads
    answer: str | None = None
    answered_at: datetime | None = None
    sources: list[WebSourceDTO] = []
    sources_found: int = 0
    suggestions: list[ResearchSuggestionDTO] = []
    cheat_sheet: str | None = None
    error: str | None = None


def new_answer_record(graph_id: str, user_id: str, node_id: str) -> GenerationJobRecord:
    return GenerationJobRecord(
        id=str(uuid4()),
        graph_id=graph_id,
        user_id=user_id,
        kind="answer",
        node_id=node_id,
        status="queued",
        created_at=datetime.now(UTC),
    )


def new_cheat_sheet_record(graph_id: str, user_id: str, node_id: str) -> GenerationJobRecord:
    return GenerationJobRecord(
        id=str(uuid4()),
        graph_id=graph_id,
        user_id=user_id,
        kind="cheat_sheet",
        node_id=node_id,
        status="running",
        created_at=datetime.now(UTC),
    )


def new_suggestion_record(
    graph_id: str, user_id: str, node_id: str | None, kind: JobKind
) -> GenerationJobRecord:
    return GenerationJobRecord(
        id=str(uuid4()),
        graph_id=graph_id,
        user_id=user_id,
        kind=kind,
        node_id=node_id,
        status="running",
        created_at=datetime.now(UTC),
    )


class GenerationJobRepository:
    """Repository for generation job records."""

    def __init__(self, db: AsyncDatabase[Any]) -> None:
        self.collection = db["generation_jobs"]

    @staticmethod
    def _to_doc(record: GenerationJobRecord) -> dict[str, Any]:
        doc = record.model_dump(mode="json", by_alias=True)
        doc["_id"] = doc.pop("id")
        return doc

    @staticmethod
    def _from_doc(doc: dict[str, Any]) -> GenerationJobRecord:
        doc["id"] = doc.pop("_id")
        return GenerationJobRecord(**doc)

    async def insert(self, record: GenerationJobRecord) -> None:
        await self.collection.insert_one(self._to_doc(record))

    async def get_for_graph(self, graph_id: str) -> list[GenerationJobRecord]:
        cursor = self.collection.find({"graphId": graph_id})
        return [self._from_doc(doc) async for doc in cursor]

    async def set_running(self, job_id: str) -> bool:
        result = await self.collection.update_one({"_id": job_id}, {"$set": {"status": "running"}})
        return result.matched_count > 0

    async def complete_answer(
        self,
        job_id: str,
        answer: str,
        answered_at: datetime,
        sources: list[WebSourceDTO],
        sources_found: int,
    ) -> bool:
        """Mark an answer job done. Returns False if the record was pruned meanwhile."""
        result = await self.collection.update_one(
            {"_id": job_id},
            {
                "$set": {
                    "status": "done",
                    "answer": answer,
                    "answeredAt": answered_at.isoformat(),
                    "sources": [s.model_dump(mode="json", by_alias=True) for s in sources],
                    "sourcesFound": sources_found,
                }
            },
        )
        return result.matched_count > 0

    async def complete_suggestions(
        self, job_id: str, suggestions: list[ResearchSuggestionDTO]
    ) -> bool:
        """Mark a suggestion job done. Returns False if the record was pruned meanwhile."""
        result = await self.collection.update_one(
            {"_id": job_id},
            {
                "$set": {
                    "status": "done",
                    "suggestions": [s.model_dump(mode="json", by_alias=True) for s in suggestions],
                }
            },
        )
        return result.matched_count > 0

    async def complete_cheat_sheet(self, job_id: str, cheat_sheet: str) -> bool:
        """Mark a cheat-sheet job done. Returns False if the record was pruned meanwhile."""
        result = await self.collection.update_one(
            {"_id": job_id}, {"$set": {"status": "done", "cheatSheet": cheat_sheet}}
        )
        return result.matched_count > 0

    async def fail(self, job_id: str, error: str) -> bool:
        """Mark a job failed. Returns False if the record was pruned meanwhile."""
        result = await self.collection.update_one(
            {"_id": job_id}, {"$set": {"status": "error", "error": error}}
        )
        return result.matched_count > 0

    async def delete(self, job_id: str) -> None:
        await self.collection.delete_one({"_id": job_id})

    async def delete_unless_done(self, job_ids: list[str]) -> int:
        """
        Delete records being replaced by a retry — unless one completed in the
        meantime (its answer must not be discarded). Returns the deleted count.
        """
        if not job_ids:
            return 0
        result = await self.collection.delete_many(
            {"_id": {"$in": job_ids}, "status": {"$ne": "done"}}
        )
        return result.deleted_count

    async def delete_many(self, job_ids: list[str]) -> None:
        if job_ids:
            await self.collection.delete_many({"_id": {"$in": job_ids}})


def get_job_repo(
    db: Annotated[AsyncDatabase[Any], Depends(get_db)],
) -> GenerationJobRepository:
    """Dependency injection factory for GenerationJobRepository."""
    return GenerationJobRepository(db)
