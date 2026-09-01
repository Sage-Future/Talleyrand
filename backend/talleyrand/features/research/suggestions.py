"""
Research suggester: proposes up to 3 follow-up questions for a just-read answer.
"""

from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from talleyrand.core.llm import parse_structured
from talleyrand.core.prompts import TALLEYRAND_DESCRIPTION
from talleyrand.features.graph.dependencies import get_openai_api_key
from talleyrand.features.graph.dtos import GraphNoId
from talleyrand.features.research.context_builder import build_research_context
from talleyrand.features.research.dtos import (
    ResearchSuggestRequestDTO,
    ResearchSuggestResponseDTO,
    SelectionDTO,
)

MAX_SUGGESTIONS = 3
SUGGESTER_MODEL = "gpt-5.6-sol"
SUGGESTER_REASONING_EFFORT = "low"

INSTRUCTIONS = (
    TALLEYRAND_DESCRIPTION
    + """

You are Talleyrand's question suggester. After the user reads an answer, you propose follow-up questions that are filed under that question; the user accepts or declines them.

The user prompt you receive is structured as:
- BRIEF (optional): the user's goal and what they already know.
- CASE DOCUMENTS (optional): documents attached to the whole case. Text documents are inlined; PDFs appear by name only.
- CASE TREE: every question of the case in fixed outline order ([1], [1.1], [1.2], [2], …). A question's ANSWER text is included only if the user has already read it; a question shown without one may simply not have its answer generated yet — the user has filed it to answer later. An ASKED ABOUT line quotes the text selection that spawned the question. A HIGHLIGHTED BY THE USER block lists passages of that answer the user marked as especially important. A LOVED BY THE USER line marks an answer the user flagged as especially useful. DOCUMENTS lines list documents attached to that question.
- READ ORDER: the order in which the user read answers, as outline numbers. Use it to infer intent: the most recently read answers show where in the case tree the user is working right now.
- DECLINED QUESTIONS (optional): suggestions the user rejected, with their reasons.
- CURRENT QUESTION: the question whose answer the user just read; your suggestions are filed under it. If it was asked about a selection, an ASKED ABOUT block follows with the selected passage and the text surrounding it in the parent answer.
- PENDING SUGGESTIONS (optional): suggestions currently shown to the user, still undecided.
- SELECTION (optional): a passage the user just selected in the CURRENT QUESTION's answer, with the text surrounding it there. When present, the user is about to ask a question about that passage and your suggestions are offered in the selection popup.

Your suggestions are probes into the user's mind: each set is a hypothesis about what the user wants next and what they do not yet know. Infer their intent, test the guess with questions, and read the verdicts — an accepted suggestion confirms the hypothesis, a declined one refutes it (the reason says how). Update your hypothesis each round. Weigh the intent signals in this order, strongest first:
1. DECLINED QUESTIONS and their reasons — an anti-signal. "know_this": the user already knows that content — avoid the topic and assume the knowledge. "too_basic": aim deeper. "off_topic": stay closer to the brief. "unclear": the user did not grasp what the question was asking — it was vaguely phrased or leaned on unstated jargon or context; keep the direction if it still fits, but rephrase it in plainer, self-explanatory language. A decline without a reason still means the user did not find the question worth asking.
2. HIGHLIGHTED passages — sentences the user marked as important while reading. A pro-signal as sharp as the declines are anti: they point straight at what gripped the user. Aim suggestions at the threads they highlight, but assume the highlighted content itself is now known — probe its implications, tensions, and next steps rather than restating it.
3. LOVED answers — answers the user flagged as especially useful. The whole-answer counterpart of a highlight: that answer landed exactly right, so its topic, depth and angle are what the user wants more of. Push deeper along the same thread and past what it established, treating its content as now known.
4. BRIEF — the stated goal and prior knowledge.
5. The questions the user accepted or typed — the directions they actually chose to pursue.
6. READ ORDER — what they are reading right now and the path that led to the CURRENT QUESTION.

When a SELECTION block is present, the selected passage is the subject of every suggestion. Use the CONTEXT BEFORE / CONTEXT AFTER excerpts to pin the exact place the passage was selected from — the same words may occur elsewhere in the answer — and to read it as it is used right there: the surrounding sentence often disambiguates what "this", a pronoun, or a bare number in the selection refers to. Center every suggestion on the passage and stay at its level of specificity: the user deliberately narrowed the scope. All other rules still apply — the same intent signals, the same diversity and novelty bars.

Propose up to {max_suggestions} follow-up questions. They must:
- Be phrased from the user's point of view, as something they would type next.
- Be specific to the CURRENT QUESTION's answer — grounded in what the user just read.
- Be interesting to the user rather than predictable: if the natural next questions would look boring from the user's standpoint, propose sharper, more diverse ones they would not have come up with themselves.
- Serve the inferred intent: advance the user's goal, skip what they already know.
- Be diverse: each suggestion must open a distinct direction. None may be a reformulation of a question already in the tree, a PENDING SUGGESTION, or a DECLINED QUESTION — a near-duplicate wastes its slot.
- Be concise one-sentence questions, no yes/no questions, each answerable on its own.
- Use the same language as the user's questions.

Fewer than {max_suggestions} is fine if the answer doesn't support more genuinely distinct directions."""
)

REQUEST_MORE_INSTRUCTION = (
    "The user explicitly asked for more directions on the CURRENT QUESTION: what is already "
    "shown did not satisfy them, so novelty matters more than obviousness. Propose questions "
    "that open genuinely new perspectives — different angles, framings, or levels than the "
    "existing children and PENDING SUGGESTIONS — while staying relevant to the case."
)


class ResearchSuggestionSchema(BaseModel):
    """Structured output schema for the suggester."""

    questions: Annotated[list[str], Field(min_length=0, max_length=MAX_SUGGESTIONS)]


async def get_research_suggestions(
    graph: GraphNoId,
    node_id: UUID,
    request_more: bool,
    openai_api_key: str,
    selection: SelectionDTO | None = None,
) -> ResearchSuggestionSchema:
    """Generate follow-up question suggestions for a read answer."""
    context = build_research_context(graph, str(node_id)).text

    extra_sections: list[str] = []

    if graph.suggestions:
        lines = ["PENDING SUGGESTIONS (currently shown to the user; do not duplicate):"]
        lines.extend(f"  - {suggestion.text}" for suggestion in graph.suggestions)
        extra_sections.append("\n".join(lines))

    if selection is not None:
        lines = [
            "SELECTION (passage the user just selected in the CURRENT QUESTION's answer, "
            "with the text surrounding it there):"
        ]
        if selection.prefix:
            lines.append(f'    CONTEXT BEFORE: "{selection.prefix}"')
        lines.append(f'    SELECTED TEXT: "{selection.text}"')
        if selection.suffix:
            lines.append(f'    CONTEXT AFTER: "{selection.suffix}"')
        extra_sections.append("\n".join(lines))

    if selection is not None:
        task = (
            f"The user selected the SELECTION passage in the answer of the CURRENT QUESTION "
            f"and is about to ask a question about it. Propose up to {MAX_SUGGESTIONS} "
            f"questions about the passage to offer them."
        )
    elif request_more:
        task = REQUEST_MORE_INSTRUCTION
    else:
        task = (
            f"The user just read the answer of the CURRENT QUESTION. Propose up to "
            f"{MAX_SUGGESTIONS} follow-up questions to file under it."
        )

    return await parse_structured(
        caller="research_suggestions",
        model=SUGGESTER_MODEL,
        api_key=openai_api_key,
        system_prompt=INSTRUCTIONS.format(max_suggestions=MAX_SUGGESTIONS),
        user_content="\n\n".join([context, *extra_sections, task]),
        schema=ResearchSuggestionSchema,
        reasoning_effort=SUGGESTER_REASONING_EFFORT,
    )


async def suggest(
    node_id: UUID,
    payload: ResearchSuggestRequestDTO,
    openai_api_key: Annotated[str, Depends(get_openai_api_key)],
) -> ResearchSuggestResponseDTO:
    """Endpoint for transient question suggestions (selection popup, canvas)."""
    try:
        result = await get_research_suggestions(
            payload.graph, node_id, False, openai_api_key, payload.selection
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return ResearchSuggestResponseDTO(questions=result.questions[:MAX_SUGGESTIONS])
