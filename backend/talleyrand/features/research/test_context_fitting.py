"""
Tests for cutting a case down to what each model can read.

Every prompt built from a case must pass the same fitting the answer gets: a
case bigger than the model's window reaches the model with its documents cut
and everything else — the brief, the tree, the sections the caller adds
around the case — intact. And the draft the composer measures must be
counted as the question it would become.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from talleyrand.core import llm as llm_module
from talleyrand.core.llm import TRIMMED_NOTICE
from talleyrand.core.model_settings import get_model_window
from talleyrand.features.graph.dtos import (
    DocumentDTO,
    EdgeDTO,
    GraphNoId,
    NodeContentDTO,
    NodeDTO,
    ResearchSuggestionDTO,
)
from talleyrand.features.research import big_picture, kickstart, report, suggestions
from talleyrand.features.research.context_size import next_question_context
from talleyrand.features.research.dtos import KickstartBriefRequestDTO, ReportRequestDTO

NOW = datetime(2026, 9, 14, tzinfo=UTC)
ROOT = uuid4()
CHILD = uuid4()
CHARS_PER_TOKEN = 4
WINDOW = get_model_window("gpt-6-astra")
# More than the model takes, at the stub's four characters to the token
OVERSIZED = "plan text. " * ((WINDOW.max_input_tokens * CHARS_PER_TOKEN) // 11 + 10_000)


def content(node_id: UUID, query: str, response: str = "") -> NodeContentDTO:
    return NodeContentDTO(
        id=node_id,
        query=query,
        response=response,
        selected_model="gpt-6-astra-medium",
        documents=[],
        selection_suggestions=[],
        selections=[],
    )


def case(**graph_kwargs) -> GraphNoId:
    return GraphNoId(
        nodes=[NodeDTO(id=ROOT), NodeDTO(id=CHILD)],
        edges=[EdgeDTO(id=uuid4(), source=ROOT, target=CHILD)],
        node_contents=[
            content(ROOT, "Does the deal hold?", "It holds, narrowly."),
            content(CHILD, "What would break it?", "A missed payment."),
        ],
        read_history=[],
        **graph_kwargs,
    )


def oversized_case(**graph_kwargs) -> GraphNoId:
    return case(
        brief="Whether the deal holds.",
        case_documents=[DocumentDTO(id="d1", name="plan", type="txt", content=OVERSIZED)],
        **graph_kwargs,
    )


@pytest.fixture
def counted_by_chars(monkeypatch):
    """Count OpenAI prompts without tiktoken: four characters to the token."""
    monkeypatch.setattr(
        llm_module, "count_tokens", lambda text, _model: len(text) // CHARS_PER_TOKEN
    )


@pytest.fixture
def structured_calls(monkeypatch):
    """Record every structured call instead of making it; answer with an empty result."""
    calls: list[dict] = []

    async def fake_parse_structured(**kwargs):
        calls.append(kwargs)
        schema = kwargs["schema"]
        fields = schema.model_fields
        if "questions" in fields:
            return schema(questions=[])
        if "markdown" in fields:
            return schema(markdown="# Report")
        return schema(brief="A brief.")

    for module in (suggestions, big_picture, report, kickstart):
        monkeypatch.setattr(module, "parse_structured", fake_parse_structured)
    return calls


def assert_fits(call: dict) -> None:
    prompt = call["system_prompt"] + call["user_content"]
    assert len(prompt) // CHARS_PER_TOKEN <= WINDOW.max_input_tokens
    assert TRIMMED_NOTICE in call["user_content"]


@pytest.mark.asyncio
async def test_followup_suggester_cuts_the_documents_and_keeps_its_own_sections(
    counted_by_chars, structured_calls
):
    graph = oversized_case(
        suggestions=[
            ResearchSuggestionDTO(
                id="s1", text="Who else is exposed?", parent_node_id=CHILD, created_at=NOW
            )
        ]
    )

    await suggestions.get_research_suggestions(graph, CHILD, False, "sk-test")

    (call,) = structured_calls
    assert_fits(call)
    user_content = call["user_content"]
    assert user_content.startswith("BRIEF:\nWhether the deal holds.\n\nCASE DOCUMENTS:\n")
    assert "CURRENT QUESTION: [1.1] What would break it?" in user_content
    assert "PENDING SUGGESTIONS" in user_content
    assert user_content.endswith("follow-up questions to file under it.")


@pytest.mark.asyncio
async def test_big_picture_suggester_cuts_the_documents(counted_by_chars, structured_calls):
    await big_picture.get_big_picture_suggestions(oversized_case(), "sk-test")

    (call,) = structured_calls
    assert_fits(call)
    assert "CASE TREE" in call["user_content"]
    assert call["user_content"].endswith("one from the standpoint of each panel member.")


@pytest.mark.asyncio
async def test_report_cuts_the_documents_around_its_guidance(counted_by_chars, structured_calls):
    payload = ReportRequestDTO(graph=oversized_case(), guidance="Focus on the risks.")

    await report.generate_report(payload, "sk-test")

    (call,) = structured_calls
    assert_fits(call)
    user_content = call["user_content"]
    assert user_content.startswith("REPORT GUIDANCE")
    assert "Focus on the risks." in user_content
    assert "CASE TREE" in user_content
    assert user_content.endswith("following all the rules above.")


@pytest.mark.asyncio
async def test_kickstart_cuts_the_attached_documents_after_the_notes(
    counted_by_chars, structured_calls
):
    payload = KickstartBriefRequestDTO(
        input_text="What I want to know.",
        documents=[DocumentDTO(id="d1", name="plan", type="txt", content=OVERSIZED)],
    )

    await kickstart.generate_brief(payload, "sk-test")

    (call,) = structured_calls
    assert_fits(call)
    assert call["user_content"].startswith("NOTES:\nWhat I want to know.\n\nATTACHED DOCUMENTS:")


def test_draft_is_counted_as_the_question_it_would_become():
    context = next_question_context(
        case(),
        parent_node_id=CHILD,
        draft_query="Who would notice first?",
        draft_documents=[DocumentDTO(id="d2", name="memo", type="txt", content="The memo.")],
        model="gpt-6-astra-medium",
    )

    assert "[1.1.1] QUESTION: Who would notice first?" in context.body
    assert "      - memo: The memo." in context.body
    assert context.body.rstrip().endswith("CURRENT QUESTION: [1.1.1] Who would notice first?")


def test_draft_under_an_unknown_parent_is_a_new_root():
    context = next_question_context(
        case(),
        parent_node_id=uuid4(),
        draft_query="Where does the money go?",
        draft_documents=[],
        model="gpt-6-astra-medium",
    )

    assert "[2] QUESTION: Where does the money go?" in context.body
