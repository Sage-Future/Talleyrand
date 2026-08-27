"""
Tests for the thread cheat sheet: what counts as a thread worth condensing,
and what the model is shown of it.
"""

from datetime import UTC, datetime
from uuid import uuid4

from talleyrand.features.graph.dtos import (
    EdgeDTO,
    GraphNoId,
    HighlightDTO,
    NodeContentDTO,
    NodeDTO,
)
from talleyrand.features.research.cheat_sheet import (
    build_cheat_sheet_user_content,
    has_thread_to_summarize,
)

NOW = datetime(2026, 8, 19, tzinfo=UTC)

ROOT = str(uuid4())
MIDDLE = str(uuid4())
CURRENT = str(uuid4())
SIBLING = str(uuid4())


def content(node_id: str, query: str, response: str = "", **kwargs) -> NodeContentDTO:
    return NodeContentDTO(
        id=node_id,
        query=query,
        response=response,
        selected_model="gpt-5.6-terra",
        documents=[],
        selection_suggestions=[],
        selections=[],
        **kwargs,
    )


def edge(source: str, target: str) -> EdgeDTO:
    return EdgeDTO(id=uuid4(), source=source, target=target)


def thread_graph(**graph_kwargs) -> GraphNoId:
    """root → middle → current, plus a sibling branch off the root."""
    return GraphNoId(
        nodes=[NodeDTO(id=nid) for nid in (ROOT, MIDDLE, CURRENT, SIBLING)],
        edges=[edge(ROOT, MIDDLE), edge(MIDDLE, CURRENT), edge(ROOT, SIBLING)],
        node_contents=[
            content(ROOT, "What is logistic regression?", "It models P(y=1|x) with a sigmoid."),
            content(MIDDLE, "How are its coefficients read?", "Each beta is a log-odds change."),
            content(CURRENT, "When does it beat a decision tree?"),
            content(SIBLING, "What is a decision tree?", "A tree of splits."),
        ],
        **graph_kwargs,
    )


class TestHasThreadToSummarize:
    def test_true_when_an_ancestor_is_answered(self):
        assert has_thread_to_summarize(thread_graph(), CURRENT)

    def test_false_for_a_root_question(self):
        assert not has_thread_to_summarize(thread_graph(), ROOT)

    def test_false_when_no_ancestor_has_an_answer(self):
        graph = thread_graph()
        for node_content in graph.node_contents:
            node_content.response = ""
        assert not has_thread_to_summarize(graph, CURRENT)

    def test_false_for_a_question_outside_the_tree(self):
        assert not has_thread_to_summarize(thread_graph(), str(uuid4()))


class TestUserContent:
    def test_carries_the_chain_above_and_the_current_question(self):
        prompt = build_cheat_sheet_user_content(thread_graph(), CURRENT)
        assert "[1] QUESTION: What is logistic regression?" in prompt
        assert "It models P(y=1|x) with a sigmoid." in prompt
        assert "[1.1] QUESTION: How are its coefficients read?" in prompt
        assert "CURRENT QUESTION: [1.1.1] When does it beat a decision tree?" in prompt

    def test_leaves_out_branches_the_question_does_not_hang_off(self):
        prompt = build_cheat_sheet_user_content(thread_graph(), CURRENT)
        assert "What is a decision tree?" not in prompt

    def test_carries_the_brief_and_the_user_marks(self):
        graph = thread_graph(brief="Deciding which classifier to ship.")
        root = graph.node_contents[0]
        root.loved_at = NOW
        root.highlights = [
            HighlightDTO(id="h1", text="the sigmoid squashes to (0,1)", created_at=NOW)
        ]
        prompt = build_cheat_sheet_user_content(graph, CURRENT)
        assert "BRIEF:\nDeciding which classifier to ship." in prompt
        assert "LOVED BY THE USER" in prompt
        assert "the sigmoid squashes to (0,1)" in prompt

    def test_marks_an_unanswered_step_in_the_chain(self):
        graph = thread_graph()
        graph.node_contents[1].response = ""
        prompt = build_cheat_sheet_user_content(graph, CURRENT)
        assert "ANSWER: (not answered" in prompt

    def test_renders_stored_refs_as_outline_numbers(self):
        graph = thread_graph()
        graph.node_contents[1].response = f"As established in [[{ROOT}]], betas are log-odds."
        prompt = build_cheat_sheet_user_content(graph, CURRENT)
        assert "[[1]]" in prompt
        assert ROOT not in prompt
