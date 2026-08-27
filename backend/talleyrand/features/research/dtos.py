"""
API level contracts (DTOs) for the research feature.
"""

from typing import Literal
from uuid import UUID

from talleyrand.features.graph.dtos import BaseSchema, DocumentDTO, GraphNoId


class SelectionDTO(BaseSchema):
    """A passage the user selected in the current question's answer."""

    text: str
    prefix: str | None = None
    suffix: str | None = None


class ResearchSuggestRequestDTO(BaseSchema):
    """Request body for transient question suggestions (selection popup, canvas)."""

    graph: GraphNoId
    selection: SelectionDTO | None = None


class ResearchSuggestResponseDTO(BaseSchema):
    """Response body for research question suggestions."""

    questions: list[str]


class BigPictureQuestionDTO(BaseSchema):
    """One big-picture suggestion, placed under an existing question of the tree."""

    parent_node_id: UUID
    question: str


class KickstartBriefRequestDTO(BaseSchema):
    """Request body for generating a case brief from kickoff notes."""

    input_text: str
    documents: list[DocumentDTO] = []


class KickstartBriefResponseDTO(BaseSchema):
    """Response body with the generated case brief."""

    brief: str


class KickstartDeclinedQuestionDTO(BaseSchema):
    """A kickoff question the user declined, with the reason when they gave one."""

    text: str
    reason: Literal["know_this", "too_basic", "off_topic", "unclear"] | None = None


class KickstartQuestionsRequestDTO(BaseSchema):
    """Request body for generating starting questions from kickoff notes."""

    input_text: str
    documents: list[DocumentDTO] = []
    brief: str = ""
    approved: list[str] = []
    pending: list[str] = []
    declined: list[KickstartDeclinedQuestionDTO] = []
    request_more: bool = False


class KickstartQuestionDTO(BaseSchema):
    """One proposed starting question; from_user marks questions extracted from the notes."""

    text: str
    from_user: bool


class KickstartQuestionsResponseDTO(BaseSchema):
    """Response body with proposed starting questions."""

    questions: list[KickstartQuestionDTO]


class ReportRequestDTO(BaseSchema):
    """Request body for generating a Markdown report of the whole case."""

    graph: GraphNoId
    guidance: str = ""


class ReportResponseDTO(BaseSchema):
    """Response body with the generated Markdown report."""

    markdown: str
