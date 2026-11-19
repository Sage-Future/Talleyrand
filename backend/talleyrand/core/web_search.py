"""
Web search for the agent CLIs, through Kagi or Mixedbread.

The agents run with no tools, so they cannot search; Talleyrand searches on
their behalf and puts the results in the prompt (core/llm.py's _stream_agent).
The keys are the operator's own (settings.kagi_api_key,
settings.mixedbread_api_key, each billed by its provider) and never reach an
agent's environment.

- Kagi: POST /api/v1/search, Bearer auth, results under data.search; checked
  against Kagi's published OpenAPI client on 2026-09-24.
- Mixedbread: POST /v1/stores/search on its "mixedbread/web" store, Bearer
  auth, results under data with the page in metadata; checked against the
  Web Store docs on 2026-09-30.
"""

import asyncio
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from talleyrand.core.config import settings

type SearchProvider = Literal["kagi", "mixedbread"]

KAGI_URL = "https://kagi.com/api/v1/search"
MIXEDBREAD_URL = "https://api.mixedbread.com/v1/stores/search"
TIMEOUT_SECONDS = 20.0
RESULTS_PER_QUERY = 5

LABELS: dict[SearchProvider, str] = {"kagi": "Kagi", "mixedbread": "Mixedbread"}


class SearchError(Exception):
    """A search failed; str(exc) is a user-facing message."""


@dataclass(frozen=True)
class SearchResult:
    url: str
    title: str
    snippet: str
    published: str | None


def api_key(provider: SearchProvider) -> str:
    return settings.kagi_api_key if provider == "kagi" else settings.mixedbread_api_key


async def search(
    provider: SearchProvider,
    queries: list[str],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[SearchResult]:
    """Every query's top results, in query order, each URL once."""
    search_one = _kagi_one if provider == "kagi" else _mixedbread_one
    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {api_key(provider)}"},
        timeout=TIMEOUT_SECONDS,
        transport=transport,
    ) as client:
        batches = await asyncio.gather(*(search_one(client, query) for query in queries))
    seen: set[str] = set()
    results = []
    for result in (r for batch in batches for r in batch):
        if result.url not in seen:
            seen.add(result.url)
            results.append(result)
    return results


async def _kagi_one(client: httpx.AsyncClient, query: str) -> list[SearchResult]:
    body = await _post(client, "kagi", KAGI_URL, {"query": query, "limit": RESULTS_PER_QUERY})
    return [
        SearchResult(
            url=item["url"],
            title=item.get("title") or item["url"],
            snippet=item.get("snippet") or "",
            published=item.get("time"),
        )
        for item in (body.get("data") or {}).get("search") or []
        if item.get("url")
    ]


async def _mixedbread_one(client: httpx.AsyncClient, query: str) -> list[SearchResult]:
    body = await _post(
        client,
        "mixedbread",
        MIXEDBREAD_URL,
        {"query": query, "store_identifiers": ["mixedbread/web"], "top_k": RESULTS_PER_QUERY},
    )
    results = []
    for item in body.get("data") or []:
        metadata = item.get("metadata") or {}
        url = metadata.get("url") or item.get("filename")
        if not url:
            continue
        title = metadata.get("title") or url
        # The text opens with the page title; the excerpt follows it.
        snippet = (item.get("text") or "").removeprefix(title).strip()
        results.append(SearchResult(url=url, title=title, snippet=snippet, published=None))
    return results


async def _post(
    client: httpx.AsyncClient, provider: SearchProvider, url: str, payload: dict
) -> dict[str, Any]:
    label = LABELS[provider]
    try:
        response = await client.post(url, json=payload)
    except httpx.HTTPError as e:
        raise SearchError(f"{label} could not be reached ({type(e).__name__})") from e
    try:
        body = response.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    if response.status_code != 200:
        raise SearchError(
            f"{label} refused the search ({response.status_code}: {_error_detail(body)})"
        )
    return body


def _error_detail(body: dict[str, Any]) -> str:
    # Kagi lists errors[].message. Mixedbread does not document its error body,
    # so the common shapes are tried in turn.
    if errors := body.get("errors"):
        return "; ".join(e.get("message", "") for e in errors) or "no detail"
    error = body.get("error")
    detail = (
        body.get("message")
        or body.get("detail")
        or (error.get("message") if isinstance(error, dict) else error)
    )
    return str(detail) if detail else "no detail"
