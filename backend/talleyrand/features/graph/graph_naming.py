"""
Graph naming service for auto-generating graph names based on content.
"""

from typing import Annotated

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from talleyrand.core.llm import parse_structured
from talleyrand.core.prompts import TALLEYRAND_DESCRIPTION
from talleyrand.features.auth_jwt import router as auth_app
from talleyrand.features.graph.dependencies import get_openai_api_key
from talleyrand.features.graph.models import (
    GraphDataRepository,
    get_graph_repo,
)
from talleyrand.models.user import User

NAMING_MODEL = "gpt-5.6-luna"
# Naming a case is a one-line extraction, so it runs on the cheapest model with
# reasoning switched off. Left unset, GPT-5.6 would reason at medium by default.
NAMING_REASONING_EFFORT = "none"
# The opening of each answer is plenty to name a case by; the cut is made in
# the database so the answers never travel whole.
ANSWER_PREVIEW_CHARS = 500

INSTRUCTIONS = (
    TALLEYRAND_DESCRIPTION
    + """

You are Talleyrand's naming assistant. Based on the content of a case, generate a concise name (2-3 words maximum) that captures its main topic or theme.

The name should be:
- Brief: 2-3 words maximum
- Descriptive: Capture the main topic
- Clear: Easy to understand at a glance

Examples of good names:
- "Climate Impact Research"
- "API Design Review"
- "Market Analysis"
- "Code Architecture"

Return only the name."""
)


class GraphNameSchema(BaseModel):
    """Response schema for generated graph name."""

    name: str


def _build_naming_context(questions: list[tuple[str, str]]) -> str:
    """Build naming context from each question and the opening of its answer."""
    context_parts = []

    for query, response in questions:
        if query:
            context_parts.append(f"Query: {query}")
        if response:
            context_parts.append(f"Response: {response}")

    if not context_parts:
        return "Empty case with no questions or answers yet."

    return "\n\n".join(context_parts)


async def generate_name(
    graph_id: str,
    openai_api_key: Annotated[str, Depends(get_openai_api_key)],
    user: Annotated[User, Depends(auth_app.require_auth)],
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
):
    """Endpoint to generate a name for a graph based on its content."""
    questions = await repo.get_questions_and_answers(
        user.email, graph_id, answer_chars=ANSWER_PREVIEW_CHARS
    )

    if questions is None:
        raise HTTPException(status_code=404, detail="Graph not found")

    context = _build_naming_context(questions)
    user_content = f"""Based on the following case content, generate a concise 2-3 word name:

{context}

Generate a descriptive name that captures the main topic or theme of this case."""

    parsed = await parse_structured(
        caller="graph_naming",
        model=NAMING_MODEL,
        api_key=openai_api_key,
        system_prompt=INSTRUCTIONS,
        user_content=user_content,
        schema=GraphNameSchema,
        reasoning_effort=NAMING_REASONING_EFFORT,
    )

    return parsed.model_dump(by_alias=True, mode="json")
