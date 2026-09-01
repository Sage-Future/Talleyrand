"""
Query service for the research view.
"""

import logging
from collections.abc import AsyncGenerator
from dataclasses import replace
from typing import Literal

from talleyrand.core.llm import (
    PdfAttachment,
    StreamChunk,
    fit_to_context,
    resolve_api_key,
    stream_text,
)
from talleyrand.core.model_settings import get_model_config
from talleyrand.features.graph.dtos import GraphNoId
from talleyrand.features.research.context_builder import (
    build_research_context,
    collect_research_pdf_documents,
)
from talleyrand.features.research.prompts import RESEARCH_ANSWERER_INSTRUCTIONS

logger = logging.getLogger(__name__)


async def do_research_query(
    node_id: str,
    graph: GraphNoId,
    openai_api_key: str,
    anthropic_api_key: str,
    web_search_enabled: bool = True,
    verbosity: Literal["low", "medium"] = "low",
) -> AsyncGenerator[StreamChunk, None]:
    """
    Answer the current question against the whole-tree research context.
    Returns a generator that yields the answer text and the web sources its
    searches surfaced.
    """
    content_by_id = {str(content.id): content for content in graph.node_contents}
    if node_id not in content_by_id:
        raise ValueError(f"Node {node_id} not found in graph")

    current_node_content = content_by_id[node_id]
    node_llm_model = get_model_config(current_node_content.selected_model)
    api_key = resolve_api_key(node_llm_model, openai_api_key, anthropic_api_key)

    instructions = RESEARCH_ANSWERER_INSTRUCTIONS
    context = build_research_context(graph, node_id)

    # A case can hold more reading than the model can take. The documents are
    # what gives way: the brief and the tree are what the question is about.
    context = replace(
        context,
        documents=await fit_to_context(
            model=node_llm_model,
            api_key=api_key,
            system_prompt=instructions,
            keep_before=context.brief,
            trimmable=context.documents,
            keep_after=context.body,
        ),
    )

    pdf_documents = [
        PdfAttachment(filename=f"{doc.name}.pdf", data_uri=doc.content)
        for doc in collect_research_pdf_documents(graph, node_id)
    ]

    return await stream_text(
        caller="research_query",
        model=node_llm_model,
        api_key=api_key,
        instructions=instructions,
        cached_prefix=context.case_prefix,
        user_prompt=context.body,
        pdf_documents=pdf_documents,
        web_search_enabled=web_search_enabled,
        verbosity=verbosity,
    )
