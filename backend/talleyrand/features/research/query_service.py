"""
Query service for the research view.
"""

import logging
from collections.abc import AsyncGenerator
from typing import Literal

from talleyrand.core.llm import PdfAttachment, StreamChunk, stream_text
from talleyrand.core.model_settings import get_model_config
from talleyrand.core.web_search import SearchProvider
from talleyrand.features.graph.dtos import GraphNoId
from talleyrand.features.research.context_builder import (
    build_research_context,
    collect_research_pdf_documents,
    read_pdfs_as_text,
    replace_documents,
)
from talleyrand.features.research.context_fitting import fit_research_context
from talleyrand.features.research.prompts import RESEARCH_ANSWERER_INSTRUCTIONS

logger = logging.getLogger(__name__)


async def do_research_query(
    node_id: str,
    graph: GraphNoId,
    web_search_enabled: bool = True,
    search_provider: SearchProvider = "kagi",
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

    instructions = RESEARCH_ANSWERER_INSTRUCTIONS

    # An agent reads a PDF as the text document its text layer makes, so the
    # text is fitted like any other document. The PDFs left over have no text
    # to give, and the answer says so.
    readable, unreadable = await read_pdfs_as_text(collect_research_pdf_documents(graph, node_id))
    graph = replace_documents(graph, readable)
    pdfs = [doc for doc, _reason in unreadable]

    # A case can hold more reading than the model can take. The documents are
    # what gives way: the brief and the tree are what the question is about.
    context = await fit_research_context(
        build_research_context(graph, node_id),
        model=node_llm_model.window,
        system_prompt=instructions,
    )

    pdf_documents = [
        PdfAttachment(filename=f"{doc.name}.pdf", data_uri=doc.content) for doc in pdfs
    ]

    return await stream_text(
        caller="research_query",
        model=node_llm_model,
        instructions=instructions,
        cached_prefix=context.case_prefix,
        user_prompt=context.body,
        pdf_documents=pdf_documents,
        web_search_enabled=web_search_enabled,
        search_provider=search_provider,
        verbosity=verbosity,
    )
