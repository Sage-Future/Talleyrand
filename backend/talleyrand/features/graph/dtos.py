"""
API level contracts (DTOs) for graph feature.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Body, Path
from pydantic import BaseModel, ConfigDict, field_validator
from pydantic.alias_generators import to_camel


class BaseSchema(BaseModel):
    """Base schema with common configuration."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


class EdgeDTO(BaseSchema):
    """
    A directed edge in the question graph: source is the parent question,
    target the follow-up filed under it.
    """

    id: UUID
    source: UUID
    target: UUID


class NodeDTO(BaseSchema):
    """
    A question node. All business data lives in NodeContentDTO under the same id.
    """

    id: UUID


class DocumentDTO(BaseSchema):
    """
    Data Transfer Object for document information.

    This class represents a document with its basic properties including
    a unique identifier, display name, type, and content.
    For txt documents, content is raw text.
    For pdf documents, content is base64-encoded PDF data.
    """

    id: str
    name: str
    type: Literal["txt", "pdf"]
    content: str


class TextSelectionDTO(BaseSchema):
    """
    Data Transfer Object for representing a text selection within a document.
    """

    text: str
    start_offset: int | None = None
    end_offset: int | None = None
    prefix: str | None = None
    suffix: str | None = None
    child_node_id: str | None = None


class HighlightDTO(BaseSchema):
    """A passage the user marked as an insight (the lightbulb action in the
    selection popup). Anchored to the answer text like a selection; carries no
    child question. Strong positive signal of what the user found important —
    fed to the answerer, the suggesters, and the report."""

    id: str
    text: str
    start_offset: int | None = None
    end_offset: int | None = None
    prefix: str | None = None
    suffix: str | None = None
    created_at: datetime


class WebSourceDTO(BaseSchema):
    """
    One page a web search put in front of the model while it wrote an answer.

    cited marks the ones the answer draws on — those are already linked inline
    in the text; the rest are what the model looked at and passed over. Only
    Claude titles every result, so a bare URL is normal.
    """

    url: str
    title: str | None = None
    page_age: str | None = None
    cited: bool = False

    @field_validator("url")
    @classmethod
    def _reject_non_web_schemes(cls, url: str) -> str:
        """
        Keep anything but an ordinary web link out of storage.

        Real sources are http(s) — they only ever come from a web search the
        model ran. But a case is also importable from hand-written JSON and
        shareable by link, so this field is an attacker-controlled string that
        the reader's browser is later handed; the frontend refuses to build an
        href from anything else (utils/webUrl.ts) and this keeps such a URL
        from being stored in the first place.

        Deliberately strict about the prefix rather than parsing: a URL
        arriving with leading whitespace or control characters is a URL whose
        scheme two parsers may disagree about, and no legitimate source has one.
        """
        if not url.lower().startswith(("http://", "https://")):
            raise ValueError("a source URL must be http:// or https://")
        return url


class NodeContentDTO(BaseSchema):
    """
    Data Transfer Object for node content in the graph system.

    Represents the complete content and metadata of a node, including the user's query,
    AI-generated response, associated documents, and various selections made by the user.
    """

    id: UUID
    query: str
    response: str
    selected_model: str
    documents: list[DocumentDTO]

    # Research view metadata (informational, never load-bearing)
    answered_at: datetime | None = None
    resolved_at: datetime | None = None

    # Whole answer marked as especially useful by the user (the heart toggle).
    # Strong positive signal fed to the answerer, the suggesters and the report.
    loved_at: datetime | None = None

    parent_selected_text: str | None = None
    parent_selected_prefix: str | None = None
    parent_selected_suffix: str | None = None

    selection_suggestions: list[str]

    selections: list[TextSelectionDTO]

    # Passages the user marked as insights via the lightbulb in the selection popup
    highlights: list[HighlightDTO] = []

    # The thread above this question, condensed (features/research/cheat_sheet.py).
    # Generated alongside the answer when the user turns "summarize parents" on;
    # derived material — never fed back into any prompt.
    cheat_sheet: str | None = None

    # What the answer's web searches turned up, cited or not. Recorded with the
    # answer and replaced whenever it is regenerated; never fed back into any prompt.
    sources: list[WebSourceDTO] = []
    # How many pages the searches surfaced in total. Larger than the list above
    # when the haul was too big to keep whole.
    sources_found: int = 0


class ResearchSuggestionDTO(BaseSchema):
    """A question proposed by the system, awaiting user accept/decline in the research view.

    Pending under its parent question until accepted or declined — no lifespan.
    """

    id: str
    parent_node_id: UUID
    text: str
    # Marks questions from the big-picture suggester (distinct, more prominent styling)
    big_picture: bool = False
    created_at: datetime


class DeclinedQuestionDTO(BaseSchema):
    """A suggestion the user explicitly declined; feeds the suggester as an anti-target."""

    text: str
    reason: Literal["know_this", "too_basic", "off_topic", "unclear"] | None = None
    parent_node_id: UUID | None = None
    declined_at: datetime


class ReadEventDTO(BaseSchema):
    """A first-read event: the user has read the answer of the given node."""

    node_id: UUID
    at: datetime


class GraphNoId(BaseSchema):
    """DTO for graph data without ID."""

    nodes: list[NodeDTO]
    edges: list[EdgeDTO]
    node_contents: list[NodeContentDTO]

    # Research view data (defaults keep old documents and payloads parseable)
    brief: str = ""
    case_documents: list[DocumentDTO] = []
    suggestions: list[ResearchSuggestionDTO] = []
    declined_questions: list[DeclinedQuestionDTO] = []
    read_history: list[ReadEventDTO] = []


class SaveGraphDataNoIdDTO(GraphNoId):
    """DTO for graph data."""

    name: str
    created_at: datetime | None = None
    # Optimistic-concurrency token: GET returns the stored revision, PUT must
    # echo it back; a mismatch means another client saved first and yields 409.
    revision: int = 0
    # Generation jobs whose results this payload provably incorporates;
    # the save retires their records (see research.generation.overlay).
    acked_job_ids: list[str] = []


class ImportGraphDTO(GraphNoId):
    """DTO for creating a case from an uploaded export file.

    The file's own id and revision are deliberately absent: an import is a
    create, and the server mints both.
    """

    name: str


class SaveGraphDataDTO(SaveGraphDataNoIdDTO):
    """DTO for graph data."""

    id: UUID


def get_save_graph_data_dto(
    graph_id: Annotated[UUID, Path()],
    body: Annotated[SaveGraphDataNoIdDTO, Body()],
) -> SaveGraphDataDTO:
    """Helper to combine path and body params into a single DTO."""
    return SaveGraphDataDTO(id=graph_id, **body.model_dump())


class RenameGraphDTO(BaseSchema):
    """DTO for renaming a graph."""

    name: str


class GraphMetadataDTO(BaseSchema):
    """DTO for graph metadata (lightweight listing)."""

    id: str
    name: str
    node_count: int
    edge_count: int
    created_at: datetime | None = None
    # Whether the case is currently readable by anyone holding its link, and
    # the names of the files that a share link hands out with it.
    shared: bool
    document_names: list[str]


class SharedGraphViewDTO(BaseSchema):
    """Public DTO for shared graph view. Intentionally excludes userId and other PII.

    Carries the research-view data too, so a shared case renders with
    its brief and open suggestions. Read history stays private to the owner.
    """

    name: str
    nodes: list[NodeDTO]
    edges: list[EdgeDTO]
    node_contents: list[NodeContentDTO]
    brief: str = ""
    case_documents: list[DocumentDTO] = []
    suggestions: list[ResearchSuggestionDTO] = []
    declined_questions: list[DeclinedQuestionDTO] = []


class ShareStatusDTO(BaseSchema):
    """DTO for share status response."""

    is_shared: bool


class CopyGraphResponseDTO(BaseSchema):
    """DTO for copy graph response."""

    id: str
