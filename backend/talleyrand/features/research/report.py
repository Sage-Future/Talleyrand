"""
Research report: turns a whole case into a Markdown report.

A one-shot, non-streaming REST call (the kickstart template). The report is not
a flat summary of every answer — it reads the case the way the user
built it: the BRIEF says what they set out to learn, the READ ORDER and the
shape of the tree say where their attention actually went, the HIGHLIGHTED
passages say what gripped them, and the DECLINED questions say what they ruled
out. The model weaves those signals into a narrative the user would recognize
as the story of their own case.
"""

from typing import Annotated

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from talleyrand.core.llm import parse_structured
from talleyrand.core.prompts import TALLEYRAND_DESCRIPTION
from talleyrand.features.graph.dependencies import get_openai_api_key
from talleyrand.features.graph.dtos import GraphNoId
from talleyrand.features.research.context_builder import (
    build_question_tree,
    build_research_context,
)
from talleyrand.features.research.dtos import ReportRequestDTO, ReportResponseDTO
from talleyrand.features.research.ref_tokens import outline_ref_tokens

REPORT_MODEL = "gpt-5.6-sol"
REPORT_REASONING_EFFORT = "xhigh"

INSTRUCTIONS = (
    TALLEYRAND_DESCRIPTION
    + """

You are Talleyrand's report writer. The user has spent time investigating a topic by asking questions, reading answers, branching into follow-ups, marking passages, and declining dead ends. They have pressed "Report". Write the Markdown report that captures what the case turned up and where it went.

The user prompt you receive is structured as:
- REPORT GUIDANCE (optional): an explicit instruction from the user about how to focus THIS report — what to emphasize, what to leave out, what angle to take. When present, treat it as the top-priority steering signal: follow it even where it overrides the default weighting below (e.g. foreground a thread the user read only lightly, or drop one they spent real time on, because the guidance says so). Stay faithful to the material — never invent findings to satisfy it. If it asks for something the case does not cover, say so briefly rather than fabricating.
- BRIEF (optional): the user's goal and what they already knew going in. The report serves this goal — frame the findings around the decision or question the brief names.
- CASE DOCUMENTS (optional): documents attached to the whole case.
- CASE TREE: every question in fixed outline order ([1], [1.1], [1.2], [2], …), with its ANSWER when the user read it. A question without an answer was filed but never opened — the user chose not to pursue it; mention such gaps only if they matter. A HIGHLIGHTED BY THE USER block under an answer lists passages the user marked as especially important. A LOVED BY THE USER line marks an answer the user flagged as especially useful. DOCUMENTS lines list attached documents.
- READ ORDER: the sequence in which the user actually read answers, as outline numbers. This is the path of their attention — not the tree's tidy outline order. The questions they returned to, went deep on, or read last are where their real interest settled.
- DECLINED QUESTIONS: suggestions the user explicitly rejected, with reasons. Negative signal: these are directions the user judged uninteresting, already-known, or off-goal. Do not resurface them as findings or open questions; let them tell you what to leave out.
- HIGHLIGHTS: every passage the user marked, gathered in one place with the question it came from. These are the user's own "this matters" — the spine of the report.
- LOVED ANSWERS: the answers the user marked with a heart as especially useful, gathered with the question each came from. A whole-answer "this matters" — alongside the highlights, the strongest signal of what to foreground.

Read all of it before writing. Reconstruct the case as a piece of thinking: what the user was really after (often a little broader or sharper than the brief admits), the path their attention took, what they came to understand, and what is genuinely the most important thing they learned. Weight the signals: LOVED ANSWERS, HIGHLIGHTS and the most-read / deepest branches are what mattered to the user; declines and unread filed questions are what did not. If REPORT GUIDANCE is present, let it set the scope and emphasis of the report, above this default weighting.

Write the report:
- Open with a short framing of the case — what the user set out to learn and the headline of what they found. Lead with the conclusion, not the methodology.
- Organize by theme or finding, not by walking the question tree node by node. Synthesize across branches: pull together what several answers jointly establish, and surface tensions where two branches pull apart.
- Foreground the loved answers and highlighted insights, and the threads the user spent the most attention on. Give proportionally less space to lightly-read corners and none to declined or unopened directions.
- Be faithful to the answers: report only what the case actually established. Do not invent findings, numbers, or sources that are not in the material. If something important was left open, say so in a brief "Open questions" close — but only genuine frontiers, never declined ones.
- End with a short "Open questions" or "Where this points next" section when the case leaves clear threads — the questions a sharp reader of this report would ask next.

Format:
- Start with a single H1 title that names the subject of the case.
- Use Markdown throughout: H2/H3 sections, lists, **bold** for key claims, tables where they clarify. Keep it readable — a report someone would actually read end to end, typically 500–1200 words, scaled to how much the case actually covered.
- Do NOT use the [[1.2]] cross-link tokens — this is a standalone document, not the app UI. Refer to findings in prose.
- Write in the same language as the user's questions and brief."""
)


class ReportSchema(BaseModel):
    """Structured output: the full Markdown report as one document."""

    markdown: str


def _build_report_user_content(graph: GraphNoId, guidance: str) -> str:
    """Overview context (brief, tree with answers + inline highlights, read order)
    plus the report-only DECLINED and consolidated HIGHLIGHTS sections. An optional
    user guidance line, when given, leads as the top-priority steering signal."""
    context = build_research_context(graph, None).text
    tree = build_question_tree(graph)

    sections: list[str] = []

    guidance = guidance.strip()
    if guidance:
        sections.append(
            "REPORT GUIDANCE (the user's explicit instruction for how to focus this "
            "report — follow it as the top priority, over the default weighting, as long "
            "as it stays faithful to the case):\n" + guidance
        )

    sections.append(context)

    highlight_lines: list[str] = []
    for content in graph.node_contents:
        if not content.highlights:
            continue
        outline = tree.outline.get(str(content.id))
        if outline is None:
            continue
        for highlight in content.highlights:
            highlight_lines.append(
                f'  - [{outline}] "{outline_ref_tokens(highlight.text, tree.outline)}"'
            )
    if highlight_lines:
        sections.append(
            "HIGHLIGHTS (every passage the user marked, with the question it came from — "
            "the spine of the report):\n" + "\n".join(highlight_lines)
        )

    loved_lines: list[str] = []
    for content in graph.node_contents:
        if content.loved_at is None:
            continue
        outline = tree.outline.get(str(content.id))
        if outline is None:
            continue
        loved_lines.append(f"  - [{outline}] {content.query}")
    if loved_lines:
        sections.append(
            "LOVED ANSWERS (the user marked these whole answers as especially useful — "
            "alongside the highlights, the strongest signal of what to foreground):\n"
            + "\n".join(loved_lines)
        )

    sections.append("Write the Markdown report of this case now, following all the rules above.")
    return "\n\n".join(sections)


async def generate_report(
    payload: ReportRequestDTO,
    openai_api_key: Annotated[str, Depends(get_openai_api_key)],
) -> ReportResponseDTO:
    """Generate a Markdown report summarizing the whole case."""
    graph = payload.graph

    has_answer = any(content.response for content in graph.node_contents)
    if not has_answer:
        raise HTTPException(
            status_code=400,
            detail="Answer at least one question before generating a report.",
        )

    parsed = await parse_structured(
        caller="research_report",
        model=REPORT_MODEL,
        api_key=openai_api_key,
        system_prompt=INSTRUCTIONS,
        user_content=_build_report_user_content(graph, payload.guidance),
        schema=ReportSchema,
        reasoning_effort=REPORT_REASONING_EFFORT,
    )
    return ReportResponseDTO(markdown=parsed.markdown.strip())
