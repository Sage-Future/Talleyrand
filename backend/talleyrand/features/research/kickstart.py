"""
Kickstart: turns the user's freeform kickoff notes into a draft brief and a
list of starting (root) questions for an empty case. Two independent
endpoints — the modal fires them in parallel.

The question suggester may search the web to ground its proposals in the
current landscape; the brief writer must not — a brief only distills the
user's own notes and never brings in outside facts.
"""

from typing import Annotated

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from talleyrand.core.llm import parse_structured
from talleyrand.core.prompts import TALLEYRAND_DESCRIPTION
from talleyrand.features.graph.dependencies import get_openai_api_key
from talleyrand.features.graph.dtos import DocumentDTO
from talleyrand.features.research.context_builder import format_documents
from talleyrand.features.research.dtos import (
    KickstartBriefRequestDTO,
    KickstartBriefResponseDTO,
    KickstartQuestionDTO,
    KickstartQuestionsRequestDTO,
    KickstartQuestionsResponseDTO,
)

KICKSTART_MODEL = "gpt-5.6-sol"
KICKSTART_REASONING_EFFORT = "low"
# Caps only the model's own proposals; the user's own questions extracted from
# the notes are always returned in full, however many there are.
MAX_INITIAL_QUESTIONS = 10
MAX_MORE_QUESTIONS = 5

BRIEF_INSTRUCTIONS = (
    TALLEYRAND_DESCRIPTION
    + """

You are Talleyrand's brief writer. The user is encouraged to free-flow their kickoff notes — unsorted thoughts, fragments, and tangents in whatever order they came; your goal is to find the structure in them. The BRIEF you write is the standing context of the whole case: it is injected into every answer and every question suggestion, so anything worth carrying across the case belongs in it.

The user prompt you receive is structured as:
- NOTES: the user's freeform thoughts on what they want to investigate.
- ATTACHED DOCUMENTS (optional): documents attached to the case. Text documents are inlined; PDFs are attached as files.

Write the brief in the user's voice (first person), as if they had written it themselves. Capture, where the notes support it:
- The goal: what they are trying to figure out, and what decision or output it feeds.
- What they already know or believe — so answers can skip it.
- What is unknown, uncertain, or contested — the actual frontier.
- Constraints and preferences: deadlines, scope limits, methods or sources they trust or distrust.
- Attached documents: one line each on what the document is and how it should be used.

Rules:
- Use only what is in the NOTES and documents. Never invent facts, opinions, or constraints the user did not state; tightening the phrasing and drawing obvious implications is fine.
- Length follows content — typically 80–250 words. Short paragraphs, or compact labeled lines (Goal:, Known:, Open:, Documents:) when the notes are rich.
- Write in the same language as the NOTES."""
)

QUESTIONS_INSTRUCTIONS = (
    TALLEYRAND_DESCRIPTION
    + """

You are Talleyrand's question suggester seeding a brand-new case. The case tree is empty: you propose its starting (root) questions.

The user prompt you receive is structured as:
- NOTES: the user's freeform kickoff thoughts on what they want to investigate.
- BRIEF (optional): the draft brief distilled from the NOTES, possibly edited by the user.
- APPROVED QUESTIONS (optional): kickoff questions the user has selected so far.
- PENDING SUGGESTIONS (optional): suggestions currently shown to the user, still undecided.
- DECLINED QUESTIONS (optional): suggestions the user rejected, with their reasons when given.
- ATTACHED DOCUMENTS (optional): documents attached to the case. Text documents are inlined; PDFs are attached as files.

Your proposals are suggestions, and suggesting is probing: each set is a hypothesis about the user's mind — what they want, and what they do not yet know. Infer their intent, test the guess with questions, and read the verdicts: an APPROVED question confirms a guess, a DECLINED one refutes it. Update your hypothesis and propose the next set accordingly. Weigh the intent signals in this order, strongest first:
1. DECLINED QUESTIONS and their reasons — an anti-signal: do not propose these or near-duplicates, and steer away from their directions. "know_this": the user already knows that content — avoid the topic and assume the knowledge. "too_basic": aim deeper. "off_topic": stay closer to the NOTES and BRIEF. "unclear": the user did not grasp what the question was asking — it was vaguely phrased or leaned on unstated jargon or context; keep the direction if it still fits, but rephrase it in plainer, self-explanatory language. A decline without a reason still means the user did not find the question worth asking.
2. NOTES — the user's own words: their goal, what they already know, what puzzles them.
3. BRIEF — the distilled standing context; where it differs from the NOTES, the user probably edited it deliberately.
4. APPROVED QUESTIONS — the directions they actually chose to pursue; propose complements, not variations.

You have a web search tool. When the topic touches the live world — recent developments, ongoing debates, named actors, data, products, policies — search before proposing, so your questions engage what is actually happening rather than a generic or stale picture of it. A search that surfaces something the user likely does not know yet is exactly what makes a proposal interesting. Purely conceptual topics may need no searching. The questions themselves stay clean: no citations, no URLs — each one reads as something the user could have typed.

Return two kinds of questions:

The user's own questions (from_user=true):
- If the NOTES contain explicit questions the user wrote, return each of them — all of them, however many — lightly normalized into a clean standalone question; improve the formulation when it helps.
- Do not return a user question that already appears in APPROVED, PENDING, or DECLINED.

Your own proposals (from_user=false), up to {max_questions}. They must:
- Open distinct lines of inquiry toward the user's goal — roots of separate branches, not follow-ups of each other, each answerable on its own.
- Be interesting to the user rather than predictable. You are not guessing what they would type next: if the questions the user would come up with on their own look boring from their standpoint, propose sharper, more diverse ones they would not have thought of.
- Be diverse: cover different angles as the material warrants — landscape and definitions, evidence and data, counterarguments, quantification, key actors, risks, the decision the user faces. None may be a reformulation of an APPROVED, PENDING, or DECLINED question — a near-duplicate wastes its slot.
- Skip what the user already knows per the NOTES and BRIEF.
- Be phrased in the user's voice, as something they could type: concise one-sentence questions, no yes/no questions.
- Use the same language as the NOTES.

Fewer than {max_questions} of your own is fine if the notes do not support more genuinely distinct directions."""
)


class KickstartBriefSchema(BaseModel):
    """Structured output schema for the brief writer."""

    brief: str


class KickstartQuestionItemSchema(BaseModel):
    """One proposed question with its provenance."""

    text: str
    from_user: bool


class KickstartQuestionsSchema(BaseModel):
    """Structured output schema for the kickoff question suggester."""

    # Unbounded: the user's own questions are returned in full, however many
    questions: list[KickstartQuestionItemSchema]


def _user_content(sections: list[str], documents: list[DocumentDTO]) -> str | list[dict]:
    """Join prompt sections; inline txt documents, attach PDFs as file parts."""
    parts = list(sections)
    if documents:
        parts.append("\n".join(format_documents(documents, "", label="ATTACHED DOCUMENTS")))

    text = "\n\n".join(parts)
    pdf_docs = [doc for doc in documents if doc.type == "pdf"]
    if not pdf_docs:
        return text

    content: list[dict] = [{"type": "input_text", "text": text}]
    content.extend(
        {
            "type": "input_file",
            "filename": f"{doc.name}.pdf",
            "file_data": doc.content,  # Already has data:application/pdf;base64, prefix
        }
        for doc in pdf_docs
    )
    return content


def _question_list_section(title: str, questions: list[str]) -> str:
    return "\n".join([title, *(f"  - {question}" for question in questions)])


async def generate_brief(
    payload: KickstartBriefRequestDTO,
    openai_api_key: Annotated[str, Depends(get_openai_api_key)],
) -> KickstartBriefResponseDTO:
    """Generate the case brief from the user's kickoff notes."""
    notes = payload.input_text.strip()
    if not notes:
        raise HTTPException(status_code=400, detail="Kickoff notes are empty.")

    parsed = await parse_structured(
        caller="research_kickstart_brief",
        model=KICKSTART_MODEL,
        api_key=openai_api_key,
        system_prompt=BRIEF_INSTRUCTIONS,
        user_content=_user_content([f"NOTES:\n{notes}"], payload.documents),
        schema=KickstartBriefSchema,
        reasoning_effort=KICKSTART_REASONING_EFFORT,
    )
    return KickstartBriefResponseDTO(brief=parsed.brief.strip())


async def generate_questions(
    payload: KickstartQuestionsRequestDTO,
    openai_api_key: Annotated[str, Depends(get_openai_api_key)],
) -> KickstartQuestionsResponseDTO:
    """Generate starting questions from the kickoff notes and list state."""
    notes = payload.input_text.strip()
    if not notes:
        raise HTTPException(status_code=400, detail="Kickoff notes are empty.")

    max_questions = MAX_MORE_QUESTIONS if payload.request_more else MAX_INITIAL_QUESTIONS

    sections = [f"NOTES:\n{notes}"]
    if payload.brief.strip():
        sections.append(
            f"BRIEF (current draft, possibly edited by the user):\n{payload.brief.strip()}"
        )
    if payload.approved:
        sections.append(_question_list_section("APPROVED QUESTIONS:", payload.approved))
    if payload.pending:
        sections.append(_question_list_section("PENDING SUGGESTIONS:", payload.pending))
    if payload.declined:
        declined_lines = ["DECLINED QUESTIONS:"]
        for declined in payload.declined:
            reason = f" [reason: {declined.reason}]" if declined.reason else ""
            declined_lines.append(f"  - {declined.text}{reason}")
        sections.append("\n".join(declined_lines))
    sections.append(
        f"The user explicitly asked for more starting questions: what is already shown did not "
        f"satisfy them, so novelty matters more than obviousness. Propose up to {max_questions} "
        "questions opening genuinely new perspectives — different angles, framings, or levels "
        "than APPROVED and PENDING — while staying true to the NOTES and BRIEF."
        if payload.request_more
        else f"The user just wrote their kickoff NOTES. Propose up to {max_questions} starting "
        "questions, and extract the user's own questions if the NOTES contain any."
    )

    parsed = await parse_structured(
        caller="research_kickstart_questions",
        model=KICKSTART_MODEL,
        api_key=openai_api_key,
        system_prompt=QUESTIONS_INSTRUCTIONS.format(max_questions=max_questions),
        user_content=_user_content(sections, payload.documents),
        schema=KickstartQuestionsSchema,
        reasoning_effort=KICKSTART_REASONING_EFFORT,
        web_search_enabled=True,
    )

    # All of the user's own questions survive; only the model's proposals are capped
    questions: list[KickstartQuestionDTO] = []
    proposed_count = 0
    for item in parsed.questions:
        text = item.text.strip()
        if not text:
            continue
        if not item.from_user:
            if proposed_count >= max_questions:
                continue
            proposed_count += 1
        questions.append(KickstartQuestionDTO(text=text, from_user=item.from_user))

    return KickstartQuestionsResponseDTO(questions=questions)
