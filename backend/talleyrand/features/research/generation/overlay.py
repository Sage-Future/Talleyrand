"""
Job-record overlay: the ownership boundary between client saves and server jobs.

A completed job record is authoritative for its result until the client proves
incorporation. Every graph read folds unacknowledged results in; every save
folds them into the incoming payload, so a client holding pre-completion state
can never overwrite a server-side result.

Acknowledgement per kind:
- answer: implicit — a payload whose response for the node equals the record's
  answer proves incorporation (works for the research client and the legacy
  canvas alike, which never sends explicit acks).
- suggestions/big_picture: explicit ackedJobIds on the save, sent by the client
  only after the suggestions entered its store. Until then the overlay
  re-appends them; afterwards the payload itself carries their (possibly
  mutated: aged, accepted, declined) state.
- cheat_sheet: explicit ackedJobIds too. A completed sheet is newer than
  anything the payload can carry (a refresh regenerates in place, so the
  payload still holds the previous sheet), so an unacked record simply
  overwrites. A failed or interrupted one retires carrying nothing: a cheat
  sheet has no retry affordance — the header falls back to the thread itself.
"""

from dataclasses import dataclass, field
from datetime import datetime

from talleyrand.features.graph.dtos import NodeContentDTO, ResearchSuggestionDTO
from talleyrand.features.research.generation.records import GenerationJobRecord, JobStatus

INTERRUPTED_ERROR = "Generation was interrupted by a server restart. Please retry."


def normalize_question(text: str) -> str:
    """Text key for near-duplicate detection (mirror of the dedup rule applied client-side)."""
    cleaned = "".join(ch for ch in text.lower() if ch.isalnum() or ch.isspace())
    return " ".join(cleaned.split())


def effective_status(record: GenerationJobRecord, live_job_ids: set[str]) -> JobStatus:
    """A queued/running record whose runtime task no longer exists died with the server."""
    if record.status in ("queued", "running") and record.id not in live_job_ids:
        return "error"
    return record.status


def effective_error(record: GenerationJobRecord, live_job_ids: set[str]) -> str | None:
    if record.status in ("queued", "running") and record.id not in live_job_ids:
        return INTERRUPTED_ERROR
    return record.error


@dataclass
class GraphLike:
    """The graph fields the overlay operates on; views into the caller's model."""

    node_ids: set[str]
    contents_by_id: dict[str, NodeContentDTO]
    suggestions: list[ResearchSuggestionDTO]
    taken_question_keys: set[str]


@dataclass
class ReconcileResult:
    """Records to drop after the save is persisted (their runtime tasks too)."""

    records_to_delete: list[str] = field(default_factory=list)
    jobs_to_cancel: list[str] = field(default_factory=list)


def graph_like(nodes, node_contents, suggestions, declined_questions) -> GraphLike:
    """Build the overlay view from any model carrying the graph DTO fields."""
    taken: set[str] = set()
    for content in node_contents:
        if content.query:
            taken.add(normalize_question(content.query))
    for suggestion in suggestions:
        taken.add(normalize_question(suggestion.text))
    for declined in declined_questions:
        taken.add(normalize_question(declined.text))
    return GraphLike(
        node_ids={str(node.id) for node in nodes},
        contents_by_id={str(content.id): content for content in node_contents},
        suggestions=suggestions,
        taken_question_keys=taken,
    )


def _force_open(content: NodeContentDTO) -> None:
    content.response = ""
    content.answered_at = None
    # The sources describe an answer that is no longer on the page.
    content.sources = []
    content.sources_found = 0


def _force_answer(content: NodeContentDTO, record: GenerationJobRecord) -> None:
    content.response = record.answer or ""
    content.answered_at = record.answered_at
    content.sources = record.sources
    content.sources_found = record.sources_found


def _apply_answer_record(
    content: NodeContentDTO,
    record: GenerationJobRecord,
    status: JobStatus,
    result: ReconcileResult | None,
) -> None:
    """
    Fold one answer record into a node's content (read path: result=None) or
    into a save payload (result collects retired records).

    A pre-completion research payload always carries response == "" for the
    node (the question is saved open before its job starts; streamed text never
    enters node contents). A NON-EMPTY response that differs from the record's
    answer is therefore deliberate content from another flow — a legacy-canvas
    re-query or edit — and supersedes the generated answer: it is kept, and on
    save the record retires unincorporated.
    """
    if status in ("queued", "running"):
        if not content.response:
            _force_open(content)
    elif status == "done":
        if content.response == record.answer:
            if result is not None:
                result.records_to_delete.append(record.id)  # proven incorporation
        elif not content.response:
            _force_answer(content, record)
        elif result is not None:
            result.records_to_delete.append(record.id)  # superseded, retire as-is


def _append_suggestions(graph: GraphLike, record: GenerationJobRecord) -> None:
    existing_ids = {s.id for s in graph.suggestions}
    for suggestion in record.suggestions:
        if suggestion.id in existing_ids:
            continue
        if str(suggestion.parent_node_id) not in graph.node_ids:
            continue
        key = normalize_question(suggestion.text)
        if key in graph.taken_question_keys:
            continue
        graph.suggestions.append(suggestion)
        graph.taken_question_keys.add(key)
        existing_ids.add(suggestion.id)


def apply_read_overlay(
    graph: GraphLike, records: list[GenerationJobRecord], live_job_ids: set[str]
) -> None:
    """Fold unacknowledged job results into a graph being read."""
    for record in records:
        status = effective_status(record, live_job_ids)
        if record.kind == "answer":
            content = graph.contents_by_id.get(record.node_id or "")
            if content is None:
                continue
            _apply_answer_record(content, record, status, None)
        elif record.kind == "cheat_sheet":
            if status != "done":
                continue
            content = graph.contents_by_id.get(record.node_id or "")
            if content is not None:
                content.cheat_sheet = record.cheat_sheet
        elif status == "done":
            _append_suggestions(graph, record)


def reconcile_save(
    graph: GraphLike,
    records: list[GenerationJobRecord],
    acked_job_ids: set[str],
    live_job_ids: set[str],
) -> ReconcileResult:
    """
    Fold unacknowledged job results into an incoming save payload and decide
    which records the save retires: pruned (node deleted), implicitly acked
    (payload already carries the answer), or explicitly acked suggestions.
    """
    result = ReconcileResult()

    for record in records:
        status = effective_status(record, live_job_ids)

        # Node deleted by the client: the job is moot, whatever its state.
        if record.node_id is not None and record.node_id not in graph.node_ids:
            result.records_to_delete.append(record.id)
            if status in ("queued", "running"):
                result.jobs_to_cancel.append(record.id)
            continue

        if record.kind == "answer":
            content = graph.contents_by_id.get(record.node_id or "")
            if content is None:
                continue
            # error records are retired only by retry (replacement) or node deletion
            _apply_answer_record(content, record, status, result)
        elif record.kind == "cheat_sheet":
            if status == "error" or (record.id in acked_job_ids and status == "done"):
                result.records_to_delete.append(record.id)
            elif status == "done":
                content = graph.contents_by_id.get(record.node_id or "")
                if content is not None:
                    content.cheat_sheet = record.cheat_sheet
        else:
            if record.id in acked_job_ids and status in ("done", "error"):
                result.records_to_delete.append(record.id)
            elif status == "done":
                _append_suggestions(graph, record)

    return result


def assemble_suggestions(
    graph: GraphLike,
    questions: list[tuple[str, str]],  # (parent_node_id, text)
    *,
    big_picture: bool,
    cap: int,
    created_at: datetime,
    make_id,
) -> list[ResearchSuggestionDTO]:
    """
    Turn raw suggester output into stored suggestion DTOs, dropping questions
    whose parent is gone, whose parent has no answer, or whose text duplicates
    anything already taken. A parent with no answer — a question that failed to
    generate or has not been answered yet — can't anchor a follow-up: the
    question stays in the tree (so the suggester knows it was asked and won't
    repeat it), but nothing is filed under it.
    """
    taken = set(graph.taken_question_keys)
    assembled: list[ResearchSuggestionDTO] = []
    for parent_node_id, text in questions:
        parent = graph.contents_by_id.get(parent_node_id)
        if parent is None or not parent.response:
            continue
        key = normalize_question(text)
        if not key or key in taken:
            continue
        taken.add(key)
        assembled.append(
            ResearchSuggestionDTO(
                id=make_id(),
                parent_node_id=parent_node_id,
                text=text,
                big_picture=big_picture,
                created_at=created_at,
            )
        )
        if len(assembled) >= cap:
            break
    return assembled
