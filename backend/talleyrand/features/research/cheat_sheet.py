"""
Thread cheat sheet: the questions above the current one, condensed.

Deep in a case, the thread above a question is collapsed in the UI. Unfolding
it to re-read four earlier answers is not what the user wants — they want the
content of those answers back in working memory: the definition, the formula,
the number, the verdict, and the through-line that explains why they are asking
what they are asking now.

This is that artifact. It is generated per question, alongside its answer (one
extra one-shot call), and stored on the question's node content, so the folded
header can show one cheat sheet instead of a list of collapsed ancestors.
"""

from pydantic import BaseModel

from talleyrand.core.llm import parse_structured
from talleyrand.core.prompts import TALLEYRAND_DESCRIPTION
from talleyrand.features.graph.dtos import GraphNoId
from talleyrand.features.research.context_builder import ancestors_of, build_question_tree
from talleyrand.features.research.ref_tokens import outline_ref_tokens

CHEAT_SHEET_MODEL = "gpt-5.6-sol"
CHEAT_SHEET_REASONING_EFFORT = "medium"
EMPTY_CHEAT_SHEET_ERROR = "The model returned an empty cheat sheet."

INSTRUCTIONS = (
    TALLEYRAND_DESCRIPTION
    + """

You are Talleyrand's cheat-sheet writer. The user is working deep in a case: the question they are on hangs off a chain of earlier questions and answers — the thread above it. In the app that whole chain is collapsed into a single folded row, and what you write is what unfolds.

Understand what the user is reaching for when they unfold it. They are NOT asking to re-read those answers; they had them once already. They are re-entering the thread and need four things back in working memory:
1. THE SPECIFICS they picked up on the way down and half-remember — the definition, the formula, the number with its units, the name, the distinction, the verdict.
2. THE THROUGH-LINE — how the thread got from its first question to the one they are on now, so the current question makes sense as the next move.
3. THE STATE OF PLAY — what the thread has already settled (so they don't re-ask it) and what it left open or contested.
4. THE CONDITIONS — the assumptions and caveats the earlier conclusions ride on, because those govern how the current answer should be read.

All of that in a glance. A cheat sheet the size of the answers it replaces has done nothing for the user — the whole value is that reading it is far cheaper than reading the thread.

So write the content, never a description of the content. "The answer explained logistic regression" is a failed line: it tells the user only that they once knew something. "Logistic regression: P(y=1|x) = 1/(1 + e^{-(β₀+β₁x)}); each β is the change in log-odds per unit of x" is the line they unfolded for. Same rule for every kind of material: give the actual threshold, the actual date, the actual counterargument, the actual conclusion.

The user prompt you receive is structured as:
- BRIEF (optional): the user's goal for the whole case and what they already knew going in.
- CASE DOCUMENTS / DOCUMENTS (optional): names of documents attached to the case or to a question. Names only — their content already went into the answers.
- THREAD ABOVE: the chain of questions from the top of the thread down to the parent of the current question, in order, each with its outline number ([1], [1.1], …) and its ANSWER. An ASKED ABOUT line quotes the passage of the previous answer the next question was asked about — that is the exact hinge where the user's attention turned, and the best evidence of the through-line. HIGHLIGHTED BY THE USER lists passages the user marked as important while reading. LOVED BY THE USER marks an answer they flagged as especially useful. A question may carry no answer yet; note the gap only if it matters.
- CURRENT QUESTION: the question the user is on. The cheat sheet is FOR this question — it prepares the reader for this answer. Do not answer it, do not summarize it, do not speculate about what its answer will say. It tells you what to weight.

Reflect this user's interests, not a generic summary of the material:
- HIGHLIGHTED passages and LOVED answers are the user's own "this mattered". Whatever they cover must survive into the cheat sheet, in its specifics — a highlighted number keeps its number.
- The BRIEF says what the case is for and what the user already knows. Foreground what serves the goal; do not spend lines re-teaching what the brief says they already know.
- The ASKED ABOUT quotes trace what the user actually chased down the thread. Weight those threads over material they passed by.
- The CURRENT QUESTION is the destination: of two true facts, the one that bears on it wins the line.

Rules:
- Reuse the thread's own words. The user has read these answers; recognizing a phrase they have seen is far faster than parsing a new one, and that speed is the point of the whole artifact. Lift the terms, names, numbers and characteristic phrasing verbatim and cut away everything around them. Do not paraphrase, do not reach for synonyms, do not tidy up the original wording — a fact restated in fresh words costs the user a full read and leaves them wondering whether it is even the same claim. Condense by deleting, not by rewriting.
- Be faithful. Every claim must come from the thread above. Never add facts, numbers, sources or implications that are not there, never sharpen a hedge into a certainty, and never round or restate a number differently than the answer did. If an answer was uncertain, contested or explicitly conditional, the cheat sheet says so in the same breath as the claim.
- Ration the space hard. You have room for only a handful of lines, so keep what the user would genuinely be missing and cut the rest: no background, no method, no restating what the CURRENT QUESTION already implies, no line the user could reconstruct unaided. Leaving a true fact out is normal and correct; a fifth of the thread is a good sheet.
- Merge across the thread rather than walking it question by question: state each fact once, where it belongs, even if two answers touched it. Where two answers pull against each other, say so — a live tension is exactly what the user needs to remember.
- Keep formulas as LaTeX ($…$ inline, $$…$$ display), keep units, keep dates, keep proper names.

Format:
- Markdown. Open with ONE short orientation sentence in italics: where the thread started and how it arrived at the current question.
- Then bullets, each ONE line of about twenty words: the term or claim in **bold**, then its specifics, in the thread's own words. Never use Markdown headings.
- At most FIVE bullets however deep the thread, and fewer is better — two or three for a single short parent. Depth adds material to choose between, not lines to the sheet.
- Close with one "Open:" line only when the thread leaves something genuinely unresolved that bears on the current question.
- You may cite a source question with its outline token — [[1.2]] — placed at the end of a bullet, and only where the user would plausibly want the full answer back. They render as clickable links. At most one per bullet, and skip them entirely when the thread is short.
- Hard ceiling of 120 words for the whole sheet, and it should read as clearly shorter than the thread it stands for — a sheet approaching a third of the answers above it is too long. When it does not fit, drop whole bullets — never squeeze the kept ones by cutting out their specifics, which would turn them back into the topic labels this sheet exists to avoid.
- Write in the same language as the user's questions and answers."""
)


class CheatSheetSchema(BaseModel):
    """Structured output: the cheat sheet as one Markdown document."""

    markdown: str


def has_thread_to_summarize(graph: GraphNoId, node_id: str) -> bool:
    """Whether a question hangs off a thread with at least one answer in it —
    the precondition for a cheat sheet, since answers are the material."""
    tree = build_question_tree(graph)
    if node_id not in tree.outline:
        return False
    content_by_id = {str(content.id): content for content in graph.node_contents}
    return any(
        content_by_id[ancestor_id].response
        for ancestor_id in ancestors_of(tree, node_id)
        if ancestor_id in content_by_id
    )


def _document_names(names: list[str], indent: str, label: str) -> list[str]:
    return [f"{indent}{label}: {', '.join(names)}"] if names else []


def build_cheat_sheet_user_content(graph: GraphNoId, node_id: str) -> str:
    """The ancestor chain of a question, with the user's marks, plus the question itself."""
    content_by_id = {str(content.id): content for content in graph.node_contents}
    tree = build_question_tree(graph)

    def refs(text: str) -> str:
        # Stored answers carry node-id ref tokens; the model reads and writes
        # outline numbers, so render them against the tree described here.
        return outline_ref_tokens(text, tree.outline)

    parts: list[str] = []

    if graph.brief.strip():
        parts.append(f"BRIEF:\n{graph.brief.strip()}\n")

    parts.extend(_document_names([doc.name for doc in graph.case_documents], "", "CASE DOCUMENTS"))
    if graph.case_documents:
        parts.append("")

    parts.append(
        "THREAD ABOVE (from the top of the thread down to the parent of the current question):"
    )
    for ancestor_id in ancestors_of(tree, node_id):
        content = content_by_id.get(ancestor_id)
        if content is None:
            continue
        parts.append(f"[{tree.outline[ancestor_id]}] QUESTION: {content.query}")
        if content.parent_selected_text:
            parts.append(
                "    ASKED ABOUT (the passage of the previous answer this question came from): "
                f'"{refs(content.parent_selected_text)}"'
            )
        parts.extend(_document_names([doc.name for doc in content.documents], "    ", "DOCUMENTS"))
        if content.response:
            parts.append(f"    ANSWER: {refs(content.response)}")
        else:
            parts.append(
                "    ANSWER: (not answered — the user filed this question but never opened it)"
            )
        if content.loved_at is not None:
            parts.append(
                "    LOVED BY THE USER (they marked this whole answer as especially useful)"
            )
        if content.highlights:
            parts.append("    HIGHLIGHTED BY THE USER (passages they marked while reading):")
            parts.extend(f'      - "{refs(highlight.text)}"' for highlight in content.highlights)
    parts.append("")

    current = content_by_id[node_id]
    parts.append(f"CURRENT QUESTION: [{tree.outline[node_id]}] {current.query}")
    if current.parent_selected_text:
        parts.append(
            "    ASKED ABOUT (the passage of the parent answer it was asked about): "
            f'"{refs(current.parent_selected_text)}"'
        )
    parts.extend(_document_names([doc.name for doc in current.documents], "    ", "DOCUMENTS"))
    parts.append("")

    parts.append(
        "Write the cheat sheet for the thread above this question now, following all the rules."
    )
    return "\n".join(parts)


async def generate_cheat_sheet(graph: GraphNoId, node_id: str, openai_api_key: str) -> str:
    """Condense the thread above a question into its cheat sheet (Markdown)."""
    parsed = await parse_structured(
        caller="research_cheat_sheet",
        model=CHEAT_SHEET_MODEL,
        api_key=openai_api_key,
        system_prompt=INSTRUCTIONS,
        user_content=build_cheat_sheet_user_content(graph, node_id),
        schema=CheatSheetSchema,
        reasoning_effort=CHEAT_SHEET_REASONING_EFFORT,
    )
    markdown = parsed.markdown.strip()
    if not markdown:
        # An empty sheet must fail rather than complete: a completed record is
        # retired only by the client acking the sheet it folded in, and there
        # would be nothing to fold in.
        raise ValueError(EMPTY_CHEAT_SHEET_ERROR)
    return markdown
