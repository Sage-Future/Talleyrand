"""
How much of a model's window the next question would take.

The composer shows a meter of it. Counting client-side from characters is not
good enough: the same characters are one token or three depending on the
script and the tokenizer, and a case measured at 44% of the window by
characters was 142% of it by tokens (2026-09-14). So the count is made here,
with tiktoken, on the prompt the answer would be built from: the saved case
with the draft filed as a new question.
"""

import logging
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, status

from talleyrand.core.llm import count_prompt_tokens
from talleyrand.core.model_settings import get_model_config
from talleyrand.features.graph.dtos import (
    DocumentDTO,
    EdgeDTO,
    GraphNoId,
    NodeContentDTO,
    NodeDTO,
)
from talleyrand.features.research.context_builder import ResearchContext, build_research_context
from talleyrand.features.research.dtos import ContextSizeRequestDTO, ContextSizeResponseDTO
from talleyrand.features.research.generation.manager import manager
from talleyrand.features.research.prompts import RESEARCH_ANSWERER_INSTRUCTIONS
from talleyrand.infra.local_user import current_user
from talleyrand.models.user import User

logger = logging.getLogger(__name__)


def next_question_context(
    graph: GraphNoId,
    *,
    parent_node_id: UUID | None,
    draft_query: str,
    draft_documents: list[DocumentDTO],
    model: str,
) -> ResearchContext:
    """
    The prompt the answer to a draft question would be built from: the case
    with the draft filed as a new question — under its parent when the parent
    is in the case, as a new root otherwise.
    """
    draft_id = uuid4()
    edges = list(graph.edges)
    if parent_node_id is not None and any(node.id == parent_node_id for node in graph.nodes):
        edges.append(EdgeDTO(id=uuid4(), source=parent_node_id, target=draft_id))
    draft = NodeContentDTO(
        id=draft_id,
        query=draft_query,
        response="",
        selected_model=model,
        documents=draft_documents,
        selection_suggestions=[],
        selections=[],
    )
    with_draft = graph.model_copy(
        update={
            "nodes": [*graph.nodes, NodeDTO(id=draft_id)],
            "edges": edges,
            "node_contents": [*graph.node_contents, draft],
        }
    )
    return build_research_context(with_draft, str(draft_id))


async def context_size(
    graph_id: UUID,
    payload: ContextSizeRequestDTO,
    user: Annotated[User, Depends(current_user)],
) -> ContextSizeResponseDTO:
    """Count the prompt the next question would send, against what its model accepts."""
    try:
        model = get_model_config(payload.model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # The answer job reads the saved case the same way; PDFs travel as
    # attachments and are not counted here, as they are not before an answer.
    graph = await manager.load_effective_graph(user.email, str(graph_id), documents="text_only")
    if graph is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    context = next_question_context(
        graph,
        parent_node_id=payload.parent_node_id,
        draft_query=payload.draft_query,
        draft_documents=payload.draft_documents,
        model=model.id,
    )
    window = model.window
    # The agent CLIs have no counter to ask: tiktoken estimates, and the meter
    # says so.
    tokens = await count_prompt_tokens(window, RESEARCH_ANSWERER_INSTRUCTIONS, context.text)

    return ContextSizeResponseDTO(
        tokens=tokens, max_input_tokens=window.max_input_tokens, estimated=True
    )
