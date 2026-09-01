"""
API contracts for durable generation jobs.
"""

from datetime import datetime
from typing import Literal

from talleyrand.features.graph.dtos import BaseSchema, ResearchSuggestionDTO, WebSourceDTO
from talleyrand.features.research.generation.overlay import effective_error, effective_status
from talleyrand.features.research.generation.records import GenerationJobRecord, JobKind, JobStatus


class GenerateAnswerRequestDTO(BaseSchema):
    """Request body to start (or queue) an answer generation for a question node."""

    background: bool = False
    web_search_enabled: bool = True
    verbosity: Literal["low", "medium"] = "low"
    # "Summarize parents" is on: also condense the thread above this question
    # into a cheat sheet, as a parallel job.
    cheat_sheet: bool = False
    # Retry a node whose generation appears frozen: abandon the live job and
    # start a fresh one, instead of idempotently returning the stuck job.
    force: bool = False


class SuggestFollowupsRequestDTO(BaseSchema):
    """Request body to start a follow-up suggestion generation."""

    request_more: bool = False


class StreamTicketDTO(BaseSchema):
    """A short-lived credential for opening one case's job event stream."""

    ticket: str


class JobDTO(BaseSchema):
    """A generation job with its effective status and any terminal payload."""

    id: str
    kind: JobKind
    node_id: str | None
    status: JobStatus
    answer: str | None = None
    answered_at: datetime | None = None
    sources: list[WebSourceDTO] = []
    sources_found: int = 0
    suggestions: list[ResearchSuggestionDTO] = []
    error: str | None = None


def to_job_dto(record: GenerationJobRecord, live_job_ids: set[str]) -> JobDTO:
    return JobDTO(
        id=record.id,
        kind=record.kind,
        node_id=record.node_id,
        status=effective_status(record, live_job_ids),
        answer=record.answer,
        answered_at=record.answered_at,
        sources=record.sources,
        sources_found=record.sources_found,
        suggestions=record.suggestions,
        error=effective_error(record, live_job_ids),
    )
