"""
LLM access shared by every feature.

stream_text dispatches streaming chat queries to OpenAI (Responses API) or
Anthropic (Messages API) based on the selected model's provider; it is used by
the node-query services. It yields the answer as TextChunks interleaved with
the SourceChunks describing what its web searches turned up. parse_structured
is the one-shot structured-output call (OpenAI-only) used by kickstart, the
suggesters, reports, and auto-naming.
"""

import asyncio
import logging
from collections.abc import AsyncGenerator, AsyncIterable
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

from anthropic import APIError as AnthropicAPIError
from anthropic import AsyncAnthropic
from anthropic.types import (
    CitationsWebSearchResultLocation,
    MessageDeltaUsage,
    RawMessageStreamEvent,
    WebSearchToolResultBlock,
)
from anthropic.types.beta import (
    BetaFallbackMessageIterationUsage,
    BetaMessageDeltaUsage,
    BetaRawMessageStreamEvent,
)
from openai import APIError as OpenAIAPIError
from openai import AsyncOpenAI, OpenAIError, omit
from openai.types.responses import (
    ResponseOutputItem,
    ResponseOutputRefusal,
    ResponseOutputText,
)
from pydantic import BaseModel

from talleyrand.core.llm_logging import log_prompt, log_response, log_structured_response
from talleyrand.core.model_settings import ModelConfig, Provider
from talleyrand.core.token_counter import truncate_to_token_limit

logger = logging.getLogger(__name__)

# Anthropic requires an explicit output-token budget on every request.
# 64K fits the streaming output ceiling of all supported Claude models.
ANTHROPIC_MAX_OUTPUT_TOKENS = 64_000

# Anthropic has no verbosity parameter; low verbosity is requested via the system prompt.
ANTHROPIC_CONCISE_INSTRUCTION = (
    "\n\nKeep your response concise and focused — avoid unnecessary elaboration."
)

# Claude tends to emit external links as bare or backtick-wrapped URLs; OpenAI
# models default to Markdown links. Request Markdown explicitly so links render
# as clickable chips. The [[1.2]] cross-link tokens are separate and unaffected.
ANTHROPIC_MARKDOWN_LINK_INSTRUCTION = (
    "\n\nWrite every external link as a Markdown link — [descriptive text](https://example.com) — "
    "never as a bare URL or a URL wrapped in backticks/inline code. "
    "This does not apply to the [[1.2]] cross-link tokens, which must stay exactly as written."
)

# Claude Opus 5's safety classifiers can decline a request outright, which would
# otherwise reach the reader as a blank answer. Anthropic can re-run the refused
# request on a stand-in model inside the same call; enabled per model via
# ModelConfig.refusal_fallback and announced in the answer so the reader always
# knows which model actually wrote it.
ANTHROPIC_REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-06-01"
ANTHROPIC_REFUSAL_FALLBACK_MODEL = "claude-opus-4-8"

PROVIDER_LABELS: dict[Provider, str] = {"openai": "OpenAI", "anthropic": "Anthropic"}


class MissingApiKeyError(Exception):
    """Raised when the selected model's provider has no API key configured."""

    def __init__(self, provider: Provider):
        self.provider = provider
        super().__init__(
            f"No {PROVIDER_LABELS[provider]} API key configured. "
            "Please add it in settings to use this model."
        )


def resolve_api_key(model: ModelConfig, openai_api_key: str, anthropic_api_key: str) -> str:
    """Pick the API key matching the model's provider."""
    api_key = openai_api_key if model.provider == "openai" else anthropic_api_key
    if not api_key:
        raise MissingApiKeyError(model.provider)
    return api_key


def provider_error_detail(exc: Exception) -> str | None:
    """
    Human-readable message from a provider SDK error, or None for other exceptions.

    Lets the UI show the provider's own explanation (billing, rate limits, overload)
    instead of a generic failure message.
    """
    if isinstance(exc, OpenAIAPIError):
        provider_label = PROVIDER_LABELS["openai"]
    elif isinstance(exc, AnthropicAPIError):
        provider_label = PROVIDER_LABELS["anthropic"]
    else:
        return None

    # Anthropic bodies look like {"error": {"message": ...}}; OpenAI bodies are
    # already unwrapped to the inner error object. Non-JSON bodies (e.g. proxy
    # HTML) have no extractable message — use the SDK-formatted one.
    body = exc.body
    error = body.get("error", body) if isinstance(body, dict) else None
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return f"{provider_label}: {error['message']}"
    return f"{provider_label}: {exc.message}"


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
    model: str,
    api_key: str,
    system_prompt: str,
    user_content: str | list[dict],
    schema: type[SchemaT],
    reasoning_effort: str | None = None,
    web_search_enabled: bool = False,
) -> SchemaT:
    """
    One-shot structured-output call, shared by every non-streaming feature.

    Logs the prompt and the parsed response, and normalizes both failure modes
    (provider error, output the schema could not be parsed from) to
    StructuredGenerationError. user_content is either a plain string or
    Responses-API content parts (input_text + input_file) when PDFs are attached.
    """
    log_prompt(
        caller=caller,
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_content
        if isinstance(user_content, str)
        else "[structured input with PDFs]",
    )

    client = AsyncOpenAI(api_key=api_key)
    try:
        response = await client.responses.parse(
            model=model,
            # omit, not None: the SDK's parse() iterates an explicit tools value
            # (None included) client-side, so None raises before any request.
            reasoning={"effort": reasoning_effort} if reasoning_effort is not None else omit,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            tools=[{"type": "web_search"}] if web_search_enabled else omit,
            text_format=schema,
        )
    except OpenAIError as e:
        raise StructuredGenerationError(provider_error_detail(e) or str(e)) from e

    if response.output_parsed is None:
        raise StructuredGenerationError("The model returned no usable output.")

    log_structured_response(caller, response.output_parsed)
    return response.output_parsed


@dataclass
class PdfAttachment:
    """A PDF document to attach to the request."""

    filename: str
    data_uri: str  # data:application/pdf;base64,<payload>

    @property
    def base64_data(self) -> str:
        """Bare base64 payload without the data-URI prefix."""
        return self.data_uri.split(",", 1)[1]


@dataclass(frozen=True)
class WebSource:
    """
    One page a web search put in front of the model.

    cited marks the few the answer actually draws on; the rest are what the
    model looked at and passed over. Neither provider reports a title for
    every source — OpenAI only names the ones it cites — so a missing title
    is normal and the reader is shown the URL instead.
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


type StreamChunk = TextChunk | SourceChunk

# A single search is enough to blow past any sane list: one OpenAI search
# returned 39 results in testing, and an answer may run several — ordinary
# questions do exceed this cap. The sources are saved with the case, so the
# haul is capped; cited ones sort first, so truncation only ever drops pages
# the answer never used. The full count is reported separately, so a truncated
# list never under-reports how wide the model actually cast its net.
MAX_WEB_SOURCES = 60


class WebSourceCollector:
    """
    Everything the searches behind one answer turned up, cited or not.

    Providers report finding a page and citing it as separate events, in
    either order and with different fields known at each point, so reports are
    folded together by URL: a title or page age lands whenever the provider
    happens to mention it, and a citation only ever sets the flag.
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


async def fit_to_context(
    *,
    model: ModelConfig,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    reserve_tokens: int = 100,
) -> str:
    """Truncate user_prompt from the start to fit the model's context window."""
    if model.provider == "openai":
        # tiktoken counting is CPU-bound — keep it off the event loop
        return await asyncio.to_thread(
            _fit_openai, model, system_prompt, user_prompt, reserve_tokens
        )
    return await _fit_anthropic(model, api_key, system_prompt, user_prompt, reserve_tokens)


def _fit_openai(
    model: ModelConfig, system_prompt: str, user_prompt: str, reserve_tokens: int
) -> str:
    return truncate_to_token_limit(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model=model.id,
        reserve_tokens=reserve_tokens,
    )


async def _fit_anthropic(
    model: ModelConfig, api_key: str, system_prompt: str, user_prompt: str, reserve_tokens: int
) -> str:
    client = AsyncAnthropic(api_key=api_key)
    # Input and output share the context window, so reserve the output budget too
    available_tokens = model.context_tokens - ANTHROPIC_MAX_OUTPUT_TOKENS - reserve_tokens

    total_tokens = await _count_anthropic_tokens(client, model, system_prompt, user_prompt)
    if total_tokens <= available_tokens:
        return user_prompt

    logger.warning(
        f"User prompt exceeds token limit: {total_tokens} > {available_tokens}. "
        "Truncating from start..."
    )
    initial_tokens = total_tokens
    while total_tokens > available_tokens and len(user_prompt) > 300:
        chars_per_token = len(user_prompt) / total_tokens
        excessive_tokens = total_tokens - available_tokens
        chars_to_remove = max(int(excessive_tokens * chars_per_token), 300)
        user_prompt = user_prompt[chars_to_remove:]
        total_tokens = await _count_anthropic_tokens(client, model, system_prompt, user_prompt)

    logger.info(
        f"Truncated {initial_tokens - total_tokens} tokens from user prompt "
        f"({initial_tokens} -> {total_tokens})"
    )
    return user_prompt


async def _count_anthropic_tokens(
    client: AsyncAnthropic, model: ModelConfig, system_prompt: str, user_prompt: str
) -> int:
    result = await client.messages.count_tokens(
        model=model.api_model,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return result.input_tokens


async def stream_text(
    *,
    caller: str,
    model: ModelConfig,
    api_key: str,
    instructions: str,
    user_prompt: str,
    pdf_documents: list[PdfAttachment],
    web_search_enabled: bool,
    verbosity: Literal["low", "medium"],
) -> AsyncGenerator[StreamChunk, None]:
    """
    Send a streaming chat request and return a generator of answer chunks.

    Text arrives as TextChunks; whatever the model's web searches surfaced
    arrives alongside as SourceChunks, which carry no answer text and are
    reported whether or not the answer ends up citing them.

    The request is sent before the generator is returned, so provider errors
    (e.g. invalid API key) raise here rather than during iteration.
    """
    log_prompt(
        caller=caller,
        model=model.id,
        system_prompt=instructions,
        user_prompt="[structured input with PDFs]" if pdf_documents else user_prompt,
    )
    if pdf_documents:
        logger.info(f"Attaching {len(pdf_documents)} PDF document(s) to request")

    if model.provider == "openai":
        return await _stream_openai(
            caller=caller,
            model=model,
            api_key=api_key,
            instructions=instructions,
            user_prompt=user_prompt,
            pdf_documents=pdf_documents,
            web_search_enabled=web_search_enabled,
            verbosity=verbosity,
        )
    return await _stream_anthropic(
        caller=caller,
        model=model,
        api_key=api_key,
        instructions=instructions,
        user_prompt=user_prompt,
        pdf_documents=pdf_documents,
        web_search_enabled=web_search_enabled,
        verbosity=verbosity,
    )


async def _stream_openai(
    *,
    caller: str,
    model: ModelConfig,
    api_key: str,
    instructions: str,
    user_prompt: str,
    pdf_documents: list[PdfAttachment],
    web_search_enabled: bool,
    verbosity: Literal["low", "medium"],
) -> AsyncGenerator[StreamChunk, None]:
    client = AsyncOpenAI(api_key=api_key)

    if pdf_documents:
        content_parts: list[dict] = [{"type": "input_text", "text": user_prompt}]
        for doc in pdf_documents:
            content_parts.append(
                {
                    "type": "input_file",
                    "filename": doc.filename,
                    "file_data": doc.data_uri,
                }
            )
        api_input: str | list = [{"role": "user", "content": content_parts}]
    else:
        api_input = user_prompt

    stream = await client.responses.create(
        model=model.api_model,
        instructions=instructions,
        input=api_input,
        tools=[{"type": "web_search"}] if web_search_enabled else None,
        # Without this the response names only the sources it cites. The
        # searches themselves are billed either way, so this is metadata we
        # have already paid for.
        include=["web_search_call.action.sources"] if web_search_enabled else None,
        # "none" is a real effort level, so test against None rather than truthiness —
        # omitting the parameter would silently give the model its default effort.
        reasoning=(
            {"effort": model.reasoning_effort} if model.reasoning_effort is not None else None
        ),
        text={"verbosity": verbosity},
        stream=True,
    )

    async def stream_generator() -> AsyncGenerator[StreamChunk, None]:
        """Yield text deltas and web-search sources from the Responses API stream."""
        full_response: list[str] = []
        try:
            async for event in stream:
                if event.type == "response.output_text.delta":
                    full_response.append(event.delta)
                    yield TextChunk(event.delta)
                elif event.type == "response.output_item.done":
                    for source in _openai_searched_sources(event.item):
                        yield SourceChunk(source)
                elif event.type == "response.content_part.done":
                    for source in _openai_cited_sources(event.part):
                        yield SourceChunk(source)
            log_response(caller, "".join(full_response))
        finally:
            # Release the HTTP connection when the consumer stops early
            # (client disconnect, abort) — closing the generator alone won't
            await stream.close()

    return stream_generator()


def _openai_searched_sources(item: ResponseOutputItem) -> list[WebSource]:
    """
    Every page one finished web-search call put in front of the model.

    A search action reports the entire result listing the model was shown —
    dozens of URLs, none of them titled; an open_page action reports the one
    page it went on to read. Only a finished call carries an action, which is
    why this reads the done event and never the added one.
    """
    if item.type != "web_search_call":
        return []
    if item.action.type == "search":
        return [WebSource(url=source.url) for source in item.action.sources or []]
    if item.action.type == "open_page":
        return [WebSource(url=item.action.url)]
    # A find action searches within a page already reported by an open_page.
    return []


def _openai_cited_sources(part: ResponseOutputText | ResponseOutputRefusal) -> list[WebSource]:
    """
    The sources the finished answer cites, carrying the page titles OpenAI
    reveals nowhere else — its search listings are bare URLs.
    """
    if part.type != "output_text":
        return []
    return [
        WebSource(url=annotation.url, title=annotation.title, cited=True)
        for annotation in part.annotations
        if annotation.type == "url_citation"
    ]


async def _stream_anthropic(
    *,
    caller: str,
    model: ModelConfig,
    api_key: str,
    instructions: str,
    user_prompt: str,
    pdf_documents: list[PdfAttachment],
    web_search_enabled: bool,
    verbosity: Literal["low", "medium"],
) -> AsyncGenerator[StreamChunk, None]:
    client = AsyncAnthropic(api_key=api_key)

    if verbosity == "low":
        instructions += ANTHROPIC_CONCISE_INSTRUCTION
    instructions += ANTHROPIC_MARKDOWN_LINK_INSTRUCTION

    content: list[dict] = [{"type": "text", "text": user_prompt}]
    for doc in pdf_documents:
        content.append(
            {
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": doc.base64_data,
                },
                "title": doc.filename,
            }
        )

    request_kwargs: dict[str, Any] = {
        "model": model.api_model,
        "max_tokens": ANTHROPIC_MAX_OUTPUT_TOKENS,
        "system": instructions,
        "messages": [{"role": "user", "content": content}],
        "stream": True,
    }
    if web_search_enabled:
        # The default allowed_callers includes programmatic tool calling, which
        # Haiku rejects; we never run code execution, so direct-only is right
        # for every model.
        request_kwargs["tools"] = [
            {
                "type": "web_search_20260209",
                "name": "web_search",
                "allowed_callers": ["direct"],
            }
        ]
    if model.reasoning_effort is not None:
        request_kwargs["thinking"] = {"type": "adaptive"}
        request_kwargs["output_config"] = {"effort": model.reasoning_effort}

    if model.refusal_fallback:
        request_kwargs["betas"] = [ANTHROPIC_REFUSAL_FALLBACK_BETA]
        request_kwargs["fallbacks"] = [{"model": ANTHROPIC_REFUSAL_FALLBACK_MODEL}]
        stream = await client.beta.messages.create(**request_kwargs)
    else:
        stream = await client.messages.create(**request_kwargs)

    async def stream_generator() -> AsyncGenerator[StreamChunk, None]:
        """Yield text deltas with web-search citations woven in as Markdown links."""
        full_response: list[str] = []
        try:
            async for chunk in _weave_anthropic_deltas(stream, model.label):
                if isinstance(chunk, TextChunk):
                    full_response.append(chunk.text)
                yield chunk
            log_response(caller, "".join(full_response))
        finally:
            # Release the HTTP connection when the consumer stops early
            # (client disconnect, abort) — closing the generator alone won't
            await stream.close()

    return stream_generator()


async def _weave_anthropic_deltas(
    stream: AsyncIterable[RawMessageStreamEvent | BetaRawMessageStreamEvent],
    model_label: str,
) -> AsyncGenerator[StreamChunk, None]:
    """
    Yield text deltas from a Messages API stream, inserting each web-search
    source as an inline Markdown link and announcing anything that changed who
    answered the question.

    Claude delivers the sources it finds via web search as citation events
    alongside the text, not as links written into the text itself — an answer
    rendered from text deltas alone references articles without linking them.
    A citation event arrives after the text it supports, so trailing whitespace
    is held back until the next text delta; that keeps the link attached to the
    cited claim instead of dangling after a paragraph break.

    Each completed search also delivers the whole result list Claude was shown,
    most of which it never cites. Those pass through as SourceChunks — as do
    the citations, which name the handful the answer actually rests on.

    Three signals would otherwise pass silently and leave the reader with a
    blank or misattributed answer: a fallback block, meaning the chosen model
    declined and a stand-in took over mid-answer; a refusal stop reason, meaning
    no model answered at all; and a stand-in named in the closing usage with no
    fallback block, meaning the request was routed around the chosen model from
    the start. Each becomes a visible line in the answer.
    """
    seen_urls: set[str] = set()
    pending_whitespace = ""
    fell_back = False
    async for event in stream:
        if event.type == "content_block_start":
            if event.content_block.type == "fallback":
                fell_back = True
                pending_whitespace = ""
                # Worded as a handoff, not an outcome: the stand-in can refuse
                # too, and the refusal notice below then completes the story.
                # Claiming an answer here would contradict it.
                yield TextChunk(
                    f"\n\n*{model_label} declined this request — continuing with "
                    f"`{event.content_block.to.model}`.*\n\n"
                )
            elif event.content_block.type == "web_search_tool_result":
                for source in _anthropic_searched_sources(event.content_block):
                    yield SourceChunk(source)
        elif event.type == "content_block_delta":
            if event.delta.type == "text_delta":
                text = pending_whitespace + event.delta.text
                visible = text.rstrip()
                pending_whitespace = text[len(visible) :]
                if visible:
                    yield TextChunk(visible)
            elif event.delta.type == "citations_delta":
                citation = event.delta.citation
                if citation.type == "web_search_result_location":
                    yield SourceChunk(WebSource(url=citation.url, title=citation.title, cited=True))
                    link = _web_search_citation_link(citation, seen_urls)
                    if link:
                        yield TextChunk(link)
        elif event.type == "message_delta":
            if event.delta.stop_reason == "refusal":
                pending_whitespace = ""
                yield TextChunk(
                    "\n\n*Every model that tried this request declined it.*\n\n"
                    if fell_back
                    else f"\n\n*{model_label} declined to answer this question.*\n\n"
                )
            elif not fell_back and (stand_in := _fallback_model_that_served(event.usage)):
                pending_whitespace = ""
                yield TextChunk(
                    f"\n\n*{model_label} did not write this answer — Anthropic routed "
                    f"the request to `{stand_in}`.*\n\n"
                )


def _fallback_model_that_served(usage: MessageDeltaUsage | BetaMessageDeltaUsage) -> str | None:
    """
    The stand-in model that answered when no fallback block appeared, else None.

    Once a model declines, Anthropic remembers the decision and routes later
    matching requests straight to the stand-in — that turn has no fallback
    block, so a `fallback_message` entry in the per-iteration usage is the only
    sign the answer came from another model. Plain (non-beta) streams never
    report iterations, and only requests that opted into fallbacks are ever
    routed this way.
    """
    if not isinstance(usage, BetaMessageDeltaUsage):
        return None
    for iteration in usage.iterations or []:
        if isinstance(iteration, BetaFallbackMessageIterationUsage):
            return iteration.model
    return None


def _anthropic_searched_sources(block: WebSearchToolResultBlock) -> list[WebSource]:
    """
    Every result one completed search handed to Claude, cited or not.

    A search that failed reports an error object here instead of a list, and
    contributes no sources.
    """
    if not isinstance(block.content, list):
        return []
    return [
        WebSource(url=result.url, title=result.title, page_age=result.page_age)
        for result in block.content
    ]


def _web_search_citation_link(
    citation: CitationsWebSearchResultLocation, seen_urls: set[str]
) -> str | None:
    """Inline Markdown link for a web-search citation; None for repeat sources."""
    if citation.url in seen_urls:
        return None
    seen_urls.add(citation.url)
    # Backslashes are doubled first so they can't corrupt the escapes added
    # after them. Square brackets break Markdown link text; dollar signs open
    # inline math in the answer renderer; parentheses break the URL part.
    label = citation.title or urlparse(citation.url).netloc.removeprefix("www.")
    label = label.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("$", "\\$")
    url = citation.url.replace("(", "%28").replace(")", "%29")
    return f" ([{label}]({url}))"
