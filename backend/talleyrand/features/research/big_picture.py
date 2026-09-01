"""
Big-picture suggester: periodically reads the whole case and proposes
cross-cutting questions from the standpoints of a fixed panel of thinkers.
"""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from talleyrand.core.llm import parse_structured
from talleyrand.core.prompts import TALLEYRAND_DESCRIPTION
from talleyrand.features.graph.dtos import GraphNoId
from talleyrand.features.research.context_builder import (
    build_question_tree,
    build_research_context,
)
from talleyrand.features.research.dtos import BigPictureQuestionDTO

MAX_SUGGESTIONS = 5
SUGGESTER_MODEL = "gpt-5.6-sol"
SUGGESTER_REASONING_EFFORT = "medium"

Persona = Literal[
    "Scott Alexander",
    "Derek Lowe",
    "Robin Hanson",
    "Tyler Cowen",
    "Scott Aaronson",
]

INSTRUCTIONS = (
    TALLEYRAND_DESCRIPTION
    + """

You are Talleyrand's big-picture question suggester. A separate suggester proposes immediate follow-ups every time the user reads an answer; you run only once every several reads and do what it cannot: read the entire case at once and ask what it adds up to.

The user prompt you receive is structured as:
- BRIEF (optional): the user's goal and what they already know.
- CASE DOCUMENTS (optional): documents attached to the whole case. Text documents are inlined; PDFs appear by name only.
- CASE TREE: every question of the case in fixed outline order ([1], [1.1], [1.2], [2], …). A question's ANSWER text is included only if the user has already read it; a question shown without one may simply not have its answer generated yet. An ASKED ABOUT line quotes the text selection that spawned the question. A HIGHLIGHTED BY THE USER block lists passages of that answer the user marked as especially important. A LOVED BY THE USER line marks an answer the user flagged as especially useful. DOCUMENTS lines list documents attached to that question.
- READ ORDER: the order in which the user read answers, as outline numbers.
- DECLINED QUESTIONS (optional): suggestions the user rejected, with their reasons.
- PENDING SUGGESTIONS (optional): suggestions currently shown to the user, still undecided.
- CLOSED QUESTIONS (optional): outline tags the user has resolved, or whose answer failed to generate — finished threads.

First, study the case as a whole. Taken together, the questions the user typed, the suggestions they accepted and declined, the passages they HIGHLIGHTED, the answers they LOVED, and their reading path sketch a person: their real interest (often broader or slightly different than the BRIEF admits), their level, the assumptions they keep making, and the question they keep circling without asking. Work that picture out before writing anything. Highlighted passages and loved answers are the user pointing at what gripped them — the clearest signal of where their real curiosity lies; build toward those threads. Declined questions are signal twice over: never re-suggest them, but read the reasons — they say what the user already knows and where they refuse to go.

Then propose the questions the user would not come up with, but would recognize on sight as exactly what they wanted to ask — what a smarter, better-educated version of themselves would already be asking. The bar:
- No simple questions: no definitions, no clarifications, no "tell me more about X". Routine next steps are the other suggester's job.
- Each question should be a little unexpected — the kind that makes the user stop and reconsider the shape of their case.
- The best questions connect distant parts of the tree: a tension between the answers of two branches, a mechanism that appears in both, a result in one branch that quietly undermines an assumption in another. Prefer cross-branch questions over deepening a single thread.
- Each question must still be concrete and answerable on its own — an insight wrapped as a question, not a vague "how does it all connect".
- Leave CLOSED threads alone: never build a question around a resolved or failed question, and never file one under it — the user is done there.

You have web search available. Use it sparingly to sharpen a question — to check a fact the question would hinge on, or to surface a recent development the case has not accounted for. Do not use it to research or answer the questions themselves; that is the answerer's job.

THE PANEL. Ask each question from the standpoint of one of these five thinkers, reimagined as a leading expert in the field the case is about. Channel how they think — their characteristic move — not their biography or actual specialty:
- Scott Alexander: the epistemic auditor — steelmans the other side, hunts the confounder or selection effect everyone skipped, asks what evidence would actually distinguish the competing explanations.
- Derek Lowe: the bench-scarred practitioner — asks what breaks in the real world, why elegant ideas die in practice, what the failure rates and dead ends imply.
- Robin Hanson: the incentive X-ray — asks what the actors are really optimizing, whether X is even about X, which signaling games or institutional pressures produce the observed behavior.
- Tyler Cowen: the omnivorous economist — asks where the binding constraint or hidden bottleneck is, what the cross-country or cross-era comparison reveals, who actually pays the cost.
- Scott Aaronson: the limit-prober — asks what is possible even in principle, where the fundamental ceilings are, what a clean thought experiment at the extreme says about the messy middle.

Propose exactly {max_suggestions} questions, one from each panel member. Let the persona pick the question: each asks what *they* would find most interesting in this user's case, in their own style of thought. Still phrase every question as the user would type it — same language as the user's questions, one concise sentence, no yes/no questions, no first-person roleplay ("as an economist…").

For each question, give the outline tag of the EXISTING question to file it under (e.g. 1.2.1, without brackets): the place where the user, rereading that question and its answer, would most naturally think of yours. The tag must appear in the CASE TREE and must not be a CLOSED question. Never duplicate or rephrase a question already in the tree, a PENDING SUGGESTION, or a DECLINED QUESTION."""
)


class BigPictureQuestionSchema(BaseModel):
    """One proposed big-picture question."""

    persona: Persona
    question: str
    parent: Annotated[
        str,
        Field(
            description=(
                "Outline tag of the existing question to file this under, "
                "exactly as it appears in the tree, e.g. '1.2.1'"
            )
        ),
    ]


class BigPictureSuggestionSchema(BaseModel):
    """Structured output schema for the big-picture suggester."""

    questions: Annotated[
        list[BigPictureQuestionSchema], Field(min_length=0, max_length=MAX_SUGGESTIONS)
    ]


async def get_big_picture_suggestions(
    graph: GraphNoId,
    openai_api_key: str,
    *,
    failed_node_ids: set[str] | None = None,
) -> list[BigPictureQuestionDTO]:
    """Generate big-picture suggestions and resolve their placement tags to node ids.

    Questions the user has resolved, or whose answer failed to generate, are
    closed threads: the model is told to leave them alone (prompting) and any
    suggestion that still lands on one is dropped (post-filtering).
    """
    context = build_research_context(graph, None).text
    tree = build_question_tree(graph)

    content_by_id = {str(content.id): content for content in graph.node_contents}
    failed = failed_node_ids or set()
    closed_ids = {
        node_id
        for node_id in tree.outline
        if node_id in failed
        or ((content := content_by_id.get(node_id)) is not None and content.resolved_at is not None)
    }

    extra_sections: list[str] = []

    if graph.suggestions:
        lines = ["PENDING SUGGESTIONS (currently shown to the user; do not duplicate):"]
        lines.extend(f"  - {suggestion.text}" for suggestion in graph.suggestions)
        extra_sections.append("\n".join(lines))

    if closed_ids:
        closed_outlines = sorted(
            (tree.outline[node_id] for node_id in closed_ids),
            key=lambda outline: [int(part) for part in outline.split(".")],
        )
        lines = [
            "CLOSED QUESTIONS (the user resolved these, or their answer failed; "
            "these threads are finished — never build a question around them or "
            "file one under them):"
        ]
        lines.extend(f"  - [{outline}]" for outline in closed_outlines)
        extra_sections.append("\n".join(lines))

    task = (
        f"Study the case above as a whole and propose {MAX_SUGGESTIONS} "
        "big-picture questions, one from the standpoint of each panel member."
    )

    parsed = await parse_structured(
        caller="big_picture_suggestions",
        model=SUGGESTER_MODEL,
        api_key=openai_api_key,
        system_prompt=INSTRUCTIONS.format(max_suggestions=MAX_SUGGESTIONS),
        user_content="\n\n".join([context, *extra_sections, task]),
        schema=BigPictureSuggestionSchema,
        reasoning_effort=SUGGESTER_REASONING_EFFORT,
        # Web search lets the panel ground its questions in current real-world
        # developments, not just the case's own text.
        web_search_enabled=True,
    )

    node_id_by_outline = {outline: tree_node_id for tree_node_id, outline in tree.outline.items()}

    placed: list[BigPictureQuestionDTO] = []
    for item in parsed.questions[:MAX_SUGGESTIONS]:
        parent_id = node_id_by_outline.get(item.parent.strip().strip("[]"))
        if parent_id is None:
            continue  # placement tag not in the tree — drop the question
        if parent_id in closed_ids:
            continue  # resolved or failed — never file a big-picture question here
        placed.append(
            BigPictureQuestionDTO(
                parent_node_id=UUID(parent_id),
                question=item.question,
            )
        )
    return placed
