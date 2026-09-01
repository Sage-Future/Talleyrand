"""
Tests for where the research prompt is split.

The prompt is built in three pieces so a case's stable opening can be cached
and its documents can be trimmed on their own. Neither is allowed to change
what the model actually reads: the pieces must still join into the one prompt
they replaced, and the split must fall exactly where the case stops repeating.
"""

from uuid import uuid4

from talleyrand.features.graph.dtos import (
    DocumentDTO,
    EdgeDTO,
    GraphNoId,
    NodeContentDTO,
    NodeDTO,
)
from talleyrand.features.research.context_builder import build_research_context

ROOT = str(uuid4())
CHILD = str(uuid4())


def content(node_id: str, query: str, response: str = "") -> NodeContentDTO:
    return NodeContentDTO(
        id=node_id,
        query=query,
        response=response,
        selected_model="claude-opus-5-max",
        documents=[],
        selection_suggestions=[],
        selections=[],
    )


def case(**graph_kwargs) -> GraphNoId:
    return GraphNoId(
        nodes=[NodeDTO(id=ROOT), NodeDTO(id=CHILD)],
        edges=[EdgeDTO(id=uuid4(), source=ROOT, target=CHILD)],
        node_contents=[
            content(ROOT, "Does the deal hold?"),
            content(CHILD, "What would break it?"),
        ],
        **graph_kwargs,
    )


def test_the_pieces_join_into_the_whole_prompt():
    graph = case(brief="Whether the deal holds.", case_documents=[document()])

    context = build_research_context(graph, CHILD)

    assert context.text == context.brief + context.documents + context.body
    assert context.text.startswith("BRIEF:\nWhether the deal holds.\n\nCASE DOCUMENTS:\n")
    assert "CURRENT QUESTION: [1.1] What would break it?" in context.body


def test_the_prefix_ends_where_the_case_stops_repeating():
    """Only the brief and the documents are the same for every question in the
    case; the tree and the question the user asked are not."""
    graph = case(brief="Whether the deal holds.", case_documents=[document()])

    context = build_research_context(graph, CHILD)

    assert context.case_prefix == context.brief + context.documents
    assert context.case_prefix.endswith("\n\n")
    assert "CASE TREE" not in context.case_prefix
    assert "CURRENT QUESTION" not in context.case_prefix


def test_two_questions_share_a_byte_identical_prefix():
    graph = case(brief="Whether the deal holds.", case_documents=[document()])

    root_context = build_research_context(graph, ROOT)
    child_context = build_research_context(graph, CHILD)

    assert root_context.case_prefix == child_context.case_prefix
    assert root_context.body != child_context.body


def test_a_case_with_no_brief_or_documents_has_no_prefix():
    context = build_research_context(case(), CHILD)

    assert context.case_prefix == ""
    assert context.text.startswith("CASE TREE")


def document() -> DocumentDTO:
    return DocumentDTO(id=str(uuid4()), name="plan", type="txt", content="The plan.")
