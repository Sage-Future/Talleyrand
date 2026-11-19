"""
LLM access shared by every feature, all of it on the operator's own signed-in
agent CLI (core/claude_code.py, core/hermes.py) and its subscription.

stream_text answers a research question on the agent and model its preset
names; it is used by the node-query services. It returns the answer as a
TextChunk with the SourceChunks of what its web search turned up and an
ExecutionChunk saying how it was produced. parse_structured is the one-shot
structured-output call used by kickstart, the suggesters, reports, and
auto-naming, on settings.agent_backend.
"""

import asyncio
import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from talleyrand.core import claude_code, hermes, web_search
from talleyrand.core.agent_cli import AgentError
from talleyrand.core.config import settings
from talleyrand.core.llm_logging import log_response, log_structured_response
from talleyrand.core.model_settings import ModelConfig, ModelWindow, Provider
from talleyrand.core.token_counter import count_tokens

logger = logging.getLogger(__name__)

# Trimming a prompt to fit (fit_to_context). The step is what keeps a trimmed
# prompt cacheable across a case's questions; it costs at most one step's worth
# of content, negligible against a window measured in hundreds of thousands of
# tokens. The minimum cut keeps a bad chars-per-token estimate from stalling
# the loop.
TRIM_STEP_CHARS = 20_000
MIN_TRIM_CHARS = 300
TRIMMED_NOTICE = (
    "\n  [... the attached documents are cut off here: the case is larger than "
    "this model's context window ...]\n\n"
)

# Neither CLI takes a verbosity setting; low verbosity is asked for in the prompt.
CONCISE_INSTRUCTION = "\n\nKeep your response concise and focused — avoid unnecessary elaboration."

# Request Markdown links explicitly so links render as clickable chips. The
# [[1.2]] cross-link tokens are separate and unaffected.
MARKDOWN_LINK_INSTRUCTION = (
    "\n\nWrite every external link as a Markdown link — [descriptive text](https://example.com) — "
    "never as a bare URL or a URL wrapped in backticks/inline code. "
    "This does not apply to the [[1.2]] cross-link tokens, which must stay exactly as written."
)

PROVIDER_LABELS: dict[Provider, str] = {
    "claude_code": "Claude Code",
    "hermes": "Hermes",
}


def provider_error_detail(exc: Exception) -> str | None:
    """
    Human-readable message from an agent CLI error, or None for other exceptions.

    Lets the UI show the agent's own explanation (usage limits, sign-in)
    instead of a generic failure message.
    """
    if isinstance(exc, AgentError):
        return f"{exc.label}: {exc}"
    return None


class StructuredGenerationError(Exception):
    """
    A structured LLM call failed: provider error or no parseable output.

    str(exc) is a user-facing message. HTTP endpoints rely on the app-level
    handler in main.py to turn it into a 400; the durable-jobs manager surfaces
    it as the job's error message.
    """


async def parse_structured[SchemaT: BaseModel](
    *,
    caller: str,
    system_prompt: str,
    user_content: str,
    schema: type[SchemaT],
) -> SchemaT:
    """
    One-shot structured-output call, shared by every non-streaming feature, on
    settings.agent_backend.

    Logs the parsed response, and normalizes both failure modes (agent error,
    output the schema could not be parsed from) to StructuredGenerationError.
    """
    return await _parse_structured_agent(
        caller=caller,
        provider=settings.agent_backend,
        system_prompt=system_prompt,
        user_content=user_content,
        schema=schema,
    )


async def _parse_structured_agent[SchemaT: BaseModel](
    *,
    caller: str,
    provider: Provider,
    system_prompt: str,
    user_content: str,
    schema: type[SchemaT],
) -> SchemaT:
    """
    parse_structured on one agent CLI. Claude Code enforces the schema itself
    (--json-schema); Hermes is asked for it in the instructions. Either way the
    result is validated here.
    """
    label = PROVIDER_LABELS[provider]
    try:
        if provider == "hermes":
            parsed = await hermes.run_structured(
                system_prompt=system_prompt, prompt=user_content, schema=schema
            )
        else:
            result = await claude_code.run(
                system_prompt=system_prompt,
                prompt=user_content,
                json_schema=schema.model_json_schema(),
            )
            parsed = schema.model_validate(result.get("structured_output"))
    except (AgentError, ValueError) as e:
        raise StructuredGenerationError(f"{label}: {e}") from e
    log_structured_response(caller, parsed)
    return parsed


@dataclass
class PdfAttachment:
    """A PDF document to attach to the request."""

    filename: str
    data_uri: str  # data:application/pdf;base64,<payload>


@dataclass(frozen=True)
class WebSource:
    """
    One page a web search put in front of the model.

    cited marks the few the answer actually draws on; the rest are what the
    model looked at and passed over. A source may come without a title, in
    which case the reader is shown the URL instead.
    """

    url: str
    title: str | None = None
    page_age: str | None = None
    cited: bool = False


@dataclass(frozen=True)
class TextChunk:
    """A piece of the answer, exactly as the reader will see it."""

    text: str


@dataclass(frozen=True)
class SourceChunk:
    """A page a web search surfaced, or a citation of one surfaced earlier."""

    source: WebSource


@dataclass(frozen=True)
class ExecutionChunk:
    """
    How an agent CLI answer was produced, sent once with it: the provider, the
    model the CLI reported, and notes on what the answer could not use (web
    search, unreadable PDFs). Kept apart from the answer text, so the notes
    are shown to the reader but never fed back to a model as part of the case.
    """

    provider: str
    model: str | None
    notes: tuple[str, ...] = ()


type StreamChunk = TextChunk | SourceChunk | ExecutionChunk

# The sources are saved with the case, so the haul is capped; cited ones sort
# first, so truncation only ever drops pages
# the answer never used. The full count is reported separately, so a truncated
# list never under-reports how wide the model actually cast its net.
MAX_WEB_SOURCES = 60

# Queries an agent answer's web search may run (each billed by the search provider).
MAX_SEARCH_QUERIES = 3


class WebSourceCollector:
    """
    Everything the searches behind one answer turned up, cited or not.

    Finding a page and citing it are reported separately, in either order and
    with different fields known at each point, so reports are folded together
    by URL: a title or page age lands whenever one is mentioned, and a
    citation only ever sets the flag.
    """

    def __init__(self) -> None:
        self._by_url: dict[str, WebSource] = {}

    def add(self, source: WebSource) -> None:
        known = self._by_url.get(source.url)
        if known is None:
            self._by_url[source.url] = source
            return
        self._by_url[source.url] = WebSource(
            url=known.url,
            title=known.title or source.title,
            page_age=known.page_age or source.page_age,
            cited=known.cited or source.cited,
        )

    def found_count(self) -> int:
        """How many distinct pages the searches surfaced, before any cap."""
        return len(self._by_url)

    def collected(self) -> list[WebSource]:
        """Cited sources first, each group in the order the searches found them."""
        found = list(self._by_url.values())
        ordered = [s for s in found if s.cited] + [s for s in found if not s.cited]
        return ordered[:MAX_WEB_SOURCES]


async def count_prompt_tokens(model: ModelWindow, system_prompt: str, user_prompt: str) -> int:
    """
    What a request carrying this prompt counts as. The agent CLIs have no
    counter to ask, so tiktoken estimates them against a budget with room for
    the error.
    """
    # tiktoken counting is CPU-bound — keep it off the event loop
    return await asyncio.to_thread(count_tokens, system_prompt + user_prompt)


async def fit_to_context(
    *,
    model: ModelWindow,
    system_prompt: str,
    keep_before: str,
    trimmable: str,
    keep_after: str,
    reserve_tokens: int = 500,
) -> str:
    """
    Shrink `trimmable` until `keep_before + trimmable + keep_after` fits what
    the model accepts as input, and return the section that survived.

    Only the middle section gives way, so callers put there the one material
    they can afford to lose. In research that is the attached documents: a case
    too large for the window still reaches the model with its brief and its
    whole question tree intact, minus however much of its reading it had to
    leave behind.

    A section trimmed to nothing is not an error: the prompt goes out at
    whatever size remains.

    reserve_tokens must cover what the request carries beyond the counted
    prompt: the instructions stream_text appends to the system prompt
    (concise, Markdown links) come to a couple of hundred tokens at most.
    """

    async def count(prompt: str) -> int:
        return await count_prompt_tokens(model, system_prompt, prompt)

    available_tokens = model.max_input_tokens - reserve_tokens

    total_tokens = await count(keep_before + trimmable + keep_after)
    if total_tokens <= available_tokens:
        return trimmable

    logger.warning(
        f"Prompt exceeds {model.api_model}'s input limit: {total_tokens} > {available_tokens}. "
        "Trimming the trimmable section..."
    )
    initial_tokens = total_tokens
    kept = len(trimmable)
    while total_tokens > available_tokens and kept > 0:
        chars_per_token = (len(keep_before) + kept + len(keep_after)) / total_tokens
        excessive_tokens = total_tokens - available_tokens
        chars_to_remove = max(int(excessive_tokens * chars_per_token), MIN_TRIM_CHARS)
        kept = max(kept - chars_to_remove, 0)
        total_tokens = await count(keep_before + _trim(trimmable, kept) + keep_after)

    # Every question in a case builds a prompt that differs only in its own
    # question block — a few hundred characters. Rounding the cut down to a
    # fixed step lands them all on the same boundary, so the trimmed section
    # stays byte-identical between them and they share one cache entry instead
    # of each writing its own. Rounding only ever removes more, so it still fits.
    if kept >= TRIM_STEP_CHARS:
        kept -= kept % TRIM_STEP_CHARS

    logger.info(
        f"Trimmed the prompt from {initial_tokens} tokens to fit {available_tokens}: "
        f"{len(trimmable)} -> {kept} characters in the trimmable section"
    )
    return _trim(trimmable, kept)


def _trim(trimmable: str, kept: int) -> str:
    """The first `kept` characters of a section, told plainly where it was cut."""
    if kept >= len(trimmable):
        return trimmable
    return trimmable[:kept] + TRIMMED_NOTICE


def _trim(trimmable: str, kept: int) -> str:
    """The first `kept` characters of a section, told plainly where it was cut."""
    if kept >= len(trimmable):
        return trimmable
    return trimmable[:kept] + TRIMMED_NOTICE


async def stream_text(
    *,
    caller: str,
    model: ModelConfig,
    instructions: str,
    cached_prefix: str,
    user_prompt: str,
    pdf_documents: list[PdfAttachment],
    web_search_enabled: bool,
    search_provider: web_search.SearchProvider,
    verbosity: Literal["low", "medium"],
) -> AsyncGenerator[StreamChunk, None]:
    """
    Answer on the preset's agent and model, and return a generator of chunks.

    The prompt the model reads is cached_prefix + user_prompt. Callers put in
    cached_prefix the opening stretch that repeats verbatim across requests —
    for research, a case's brief and documents — which the CLIs' providers
    cache on their own. Passing "" is fine.

    The agent runs to completion before this returns, so its errors raise
    here rather than during iteration.
    """
    return await _stream_agent(
        caller=caller,
        provider=model.provider,
        agent_model=model.agent_model,
        instructions=instructions,
        cached_prefix=cached_prefix,
        user_prompt=user_prompt,
        pdf_documents=pdf_documents,
        web_search_enabled=web_search_enabled,
        search_provider=search_provider,
        verbosity=verbosity,
    )


async def _stream_agent(
    *,
    caller: str,
    provider: Provider,
    agent_model: str,
    instructions: str,
    cached_prefix: str,
    user_prompt: str,
    pdf_documents: list[PdfAttachment],
    web_search_enabled: bool,
    search_provider: web_search.SearchProvider,
    verbosity: Literal["low", "medium"],
) -> AsyncGenerator[StreamChunk, None]:
    """
    An answer from an agent CLI, delivered whole: the CLI runs to completion
    before this returns, so its errors raise here,
    and the generator then yields the finished answer. What the
    answer could not use is reported with it (ExecutionChunk), never silently
    dropped.

    The agent has no tools, so with search on Talleyrand searches for it
    (_search_the_web) and appends the results, after the cacheable opening.
    Every result is reported as a source; the ones the answer links to are
    marked cited.
    """
    label = PROVIDER_LABELS[provider]
    # Neither CLI takes a verbosity setting, so it is asked for in the prompt.
    if verbosity == "low":
        instructions += CONCISE_INSTRUCTION
    instructions += MARKDOWN_LINK_INSTRUCTION
    prompt = cached_prefix + user_prompt

    notes = []
    results: list[web_search.SearchResult] = []
    if web_search_enabled:
        try:
            results = await _search_the_web(provider, search_provider, user_prompt)
        except (web_search.SearchError, StructuredGenerationError) as e:
            notes.append(
                f"Web search did not run ({e}), so this answer draws on the model's own knowledge."
            )
        prompt += _search_results_section(results)
    if pdf_documents:
        # Readable PDFs reach an agent as text (query_service); these had none.
        names = ", ".join(doc.filename for doc in pdf_documents)
        notes.append(
            f"{names} could not be read: {label} reads a PDF's text, and "
            f"{'these have' if len(pdf_documents) > 1 else 'this has'} none, a password, "
            "or damage."
        )

    if provider == "hermes":
        # Hermes runs the model it is given; its output does not name one.
        model = agent_model
        answer = await hermes.run(system_prompt=instructions, prompt=prompt, model=model)
    else:
        result = await claude_code.run(system_prompt=instructions, prompt=prompt, model=agent_model)
        answer = str(result.get("result") or "")
        model = result.get("model")
    log_response(caller, answer)

    async def stream_generator() -> AsyncGenerator[StreamChunk, None]:
        yield ExecutionChunk(provider=provider, model=model, notes=tuple(notes))
        yield TextChunk(answer)
        for r in results:
            # ponytail: cited means linked verbatim; a reworded URL counts as uncited.
            yield SourceChunk(
                WebSource(url=r.url, title=r.title, page_age=r.published, cited=r.url in answer)
            )

    return stream_generator()


class SearchQueries(BaseModel):
    queries: list[str]


SEARCH_QUERY_INSTRUCTIONS = f"""You write web search queries for a research assistant.
The user message is a research case: its question tree and, at the end, the CURRENT QUESTION.
Write up to {MAX_SEARCH_QUERIES} short keyword queries whose results would help answer the
CURRENT QUESTION. Each must stand alone: spell out what the case refers to, since the search
engine sees only the query."""


async def _search_the_web(
    provider: Provider, search_provider: web_search.SearchProvider, case_body: str
) -> list[web_search.SearchResult]:
    """
    Search results for the question that ends case_body: the agent writes the
    queries (one small structured call), the search provider runs them.
    """
    label = web_search.LABELS[search_provider]
    if not web_search.api_key(search_provider):
        # Checked first, so a missing key does not spend a query-writing call.
        raise web_search.SearchError(
            f"it needs a {label} API key, {search_provider.upper()}_API_KEY in backend/.env"
        )
    # ponytail: queries come from the tree and question alone, not the brief and
    # documents, to keep this call small.
    planned = await _parse_structured_agent(
        caller="web_search_queries",
        provider=provider,
        system_prompt=SEARCH_QUERY_INSTRUCTIONS,
        user_content=case_body,
        schema=SearchQueries,
    )
    queries = [q.strip() for q in planned.queries if q.strip()][:MAX_SEARCH_QUERIES]
    if not queries:
        return []
    results = await web_search.search(search_provider, queries)
    logger.info(f"{label}: {len(queries)} queries, {len(results)} results")
    return results


def _search_results_section(results: list[web_search.SearchResult]) -> str:
    if not results:
        return ""
    lines = [
        "\n\nWEB SEARCH RESULTS (found for the CURRENT QUESTION just now; these are the "
        "only web sources you have, so cite the ones you use as Markdown links to their "
        "exact URLs):"
    ]
    for n, r in enumerate(results, start=1):
        dated = f" ({r.published})" if r.published else ""
        lines.append(f"[{n}] {r.title}{dated}\n    {r.url}\n    {r.snippet}")
    return "\n".join(lines)
