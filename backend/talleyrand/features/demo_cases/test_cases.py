"""
Integrity tests for the seeded demo cases.

The cases are checked-in exports of real sessions, full of internal
references (edges, cross-link tokens, selection and highlight anchors,
suggestion parents); these tests keep every reference resolvable, so a
refreshed export that was trimmed or re-ordered by hand fails here rather
than on the landing page.
"""

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic_core import to_json

from talleyrand.features.demo_cases import cases as demo_cases
from talleyrand.features.demo_cases.cases import (
    BIG_FIVE_ID,
    COMPUTE_GOVERNANCE_ID,
    DEMO_USER_ID,
    FREE_WILL_ID,
    MORAL_PROGRESS_ID,
    build_demo_cases,
)
from talleyrand.features.graph.dtos import GraphNoId, ReadEventDTO, SaveGraphDataDTO
from talleyrand.features.graph.models import GraphDocument
from talleyrand.features.research.context_builder import build_question_tree
from talleyrand.features.research.ref_tokens import NODE_ID_REF, OUTLINE_REF

CASES = build_demo_cases()
CASE_IDS = [graph_id for graph_id, _ in CASES]


def as_graph(document: GraphDocument) -> GraphNoId:
    return GraphNoId(
        nodes=document.nodes,
        edges=document.edges,
        node_contents=document.node_contents,
    )


def test_case_ids_match_the_landing_page_contract():
    """The landing page links /shared/<id> for exactly these ids."""
    assert CASE_IDS == [
        COMPUTE_GOVERNANCE_ID,
        MORAL_PROGRESS_ID,
        BIG_FIVE_ID,
        FREE_WILL_ID,
    ]


def test_building_twice_is_deterministic():
    assert [doc.model_dump(mode="json") for _, doc in CASES] == [
        doc.model_dump(mode="json") for _, doc in build_demo_cases()
    ]


@pytest.mark.parametrize(("graph_id", "document"), CASES, ids=CASE_IDS)
def test_nodes_and_contents_align(graph_id: str, document: GraphDocument):
    node_ids = [node.id for node in document.nodes]
    content_ids = [content.id for content in document.node_contents]
    assert len(node_ids) == len(set(node_ids))
    assert sorted(node_ids) == sorted(content_ids)
    assert all(content.query for content in document.node_contents)


@pytest.mark.parametrize(("graph_id", "document"), CASES, ids=CASE_IDS)
def test_edges_form_a_tree(graph_id: str, document: GraphDocument):
    node_ids = {node.id for node in document.nodes}
    targets = [edge.target for edge in document.edges]
    assert all(edge.source in node_ids and edge.target in node_ids for edge in document.edges)
    assert len(targets) == len(set(targets)), "a question has two parents"

    tree = build_question_tree(as_graph(document))
    assert len(tree.dfs_order) == len(node_ids), "a cycle dropped questions from the tree"


@pytest.mark.parametrize(("graph_id", "document"), CASES, ids=CASE_IDS)
def test_cross_link_tokens_resolve(graph_id: str, document: GraphDocument):
    """Built responses carry only node-id tokens, each naming a real question."""
    node_ids = {str(node.id) for node in document.nodes}
    for content in document.node_contents:
        assert not OUTLINE_REF.search(content.response), (
            f"unrewritten outline token in {content.query!r}"
        )
        for token in NODE_ID_REF.findall(content.response):
            assert token in node_ids, f"[[{token}]] in {content.query!r} resolves to nothing"


@pytest.mark.parametrize(("graph_id", "document"), CASES, ids=CASE_IDS)
def test_answer_states_are_consistent(graph_id: str, document: GraphDocument):
    for content in document.node_contents:
        assert bool(content.response) == (content.answered_at is not None)
        if content.resolved_at is not None:
            assert content.answered_at is not None
            assert content.resolved_at > content.answered_at


@pytest.mark.parametrize(("graph_id", "document"), CASES, ids=CASE_IDS)
def test_selections_anchor_their_children(graph_id: str, document: GraphDocument):
    content_by_id = {str(content.id): content for content in document.node_contents}
    child_parent = {str(edge.target): str(edge.source) for edge in document.edges}

    for content in document.node_contents:
        for selection in content.selections:
            assert content.response[selection.start_offset : selection.end_offset] == (
                selection.text
            )
            child = content_by_id[selection.child_node_id]
            assert child.parent_selected_text == selection.text
            assert child_parent[str(child.id)] == str(content.id)

    # And the reverse: every selection-born child has its marker on the parent
    for content in document.node_contents:
        if content.parent_selected_text is None:
            continue
        parent = content_by_id[child_parent[str(content.id)]]
        assert any(selection.child_node_id == str(content.id) for selection in parent.selections)


@pytest.mark.parametrize(("graph_id", "document"), CASES, ids=CASE_IDS)
def test_highlights_anchor_in_their_answer(graph_id: str, document: GraphDocument):
    for content in document.node_contents:
        for highlight in content.highlights:
            assert content.response[highlight.start_offset : highlight.end_offset] == (
                highlight.text
            )


@pytest.mark.parametrize(("graph_id", "document"), CASES, ids=CASE_IDS)
def test_suggestions_hang_under_answered_questions(graph_id: str, document: GraphDocument):
    content_by_id = {content.id: content for content in document.node_contents}
    for suggestion in document.suggestions:
        assert content_by_id[suggestion.parent_node_id].response
    for declined in document.declined_questions:
        assert declined.parent_node_id in content_by_id


@pytest.mark.parametrize(("graph_id", "document"), CASES, ids=CASE_IDS)
def test_every_question_is_answered(graph_id: str, document: GraphDocument):
    """Demo cases read as living research: no question is left without an answer."""
    assert all(content.response for content in document.node_contents)


def test_case_export_loads_verbatim(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A real session's export (the GET /graph/{id} payload) becomes the demo case
    as-is: same ids, timestamps and content, minus the owner's read history."""
    _, source = build_demo_cases()[1]
    source.read_history.append(
        ReadEventDTO(node_id=source.nodes[0].id, at=datetime(2026, 7, 1, tzinfo=UTC))
    )
    export = SaveGraphDataDTO(id=uuid4(), **{**source.model_dump(), "revision": 7})
    (tmp_path / "moral.json").write_bytes(to_json(export, by_alias=True, exclude={"acked_job_ids"}))
    monkeypatch.setattr(demo_cases, "_EXPORTS", tmp_path)

    case_id, loaded = demo_cases._from_export("demo-from-export", "moral.json")

    assert case_id == "demo-from-export"
    assert loaded.user_id == DEMO_USER_ID
    assert loaded.read_history == []
    expected = source.model_copy(update={"read_history": []})
    assert loaded.model_dump(mode="json") == expected.model_dump(mode="json")
