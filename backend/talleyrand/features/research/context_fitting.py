"""
Cutting a case down to what a model can read.

Every prompt built from a case — answers, suggestions, reports — carries the
same three sections, and the documents are the one that gives way when the
case is bigger than the model's window: the brief and the question tree are
what the question is about. core/llm.py's fit_to_context makes the cut; this
module applies it to a ResearchContext on behalf of every caller.
"""

from dataclasses import replace

from talleyrand.core.llm import fit_to_context
from talleyrand.core.model_settings import ModelWindow
from talleyrand.features.research.context_builder import ResearchContext


async def fit_research_context(
    context: ResearchContext,
    *,
    model: ModelWindow,
    api_key: str,
    system_prompt: str,
    head: str = "",
    tail: str = "",
) -> ResearchContext:
    """
    The context with its documents cut until head + context + tail fits `model`.

    head and tail are whatever the caller puts around the context in the prompt
    it sends. They must be given here so that the fit is measured on the prompt
    as sent, not on the context alone.
    """
    documents = await fit_to_context(
        model=model,
        api_key=api_key,
        system_prompt=system_prompt,
        keep_before=head + context.brief,
        trimmable=context.documents,
        keep_after=context.body + tail,
    )
    return replace(context, documents=documents)
