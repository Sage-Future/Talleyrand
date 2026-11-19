"""
HTTP and WebSocket handlers for durable generation jobs.

The WebSocket is a pure view: one connection per open graph, multiplexing the
events of all that graph's jobs. Disconnecting never affects a job.
"""

import asyncio
import logging
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, WebSocket, status
from starlette.websockets import WebSocketDisconnect

from talleyrand.features.graph.models import GraphDataRepository, get_graph_repo
from talleyrand.features.research.cheat_sheet import has_thread_to_summarize
from talleyrand.features.research.generation.dtos import (
    GenerateAnswerRequestDTO,
    JobDTO,
    SuggestFollowupsRequestDTO,
    to_job_dto,
)
from talleyrand.features.research.generation.manager import (
    AnswerParams,
    JobChannel,
    SuggestionParams,
    manager,
    record_event,
)
from talleyrand.features.research.generation.records import (
    GenerationJobRepository,
    get_job_repo,
)
from talleyrand.infra.db import get_db
from talleyrand.infra.local_user import current_user
from talleyrand.models.user import User

logger = logging.getLogger(__name__)

KEEPALIVE_INTERVAL = 15


async def _require_graph(repo: GraphDataRepository, user_id: str, graph_id: str) -> None:
    if not await repo.exists(user_id, graph_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


async def generate_answer(
    graph_id: UUID,
    node_id: UUID,
    payload: GenerateAnswerRequestDTO,
    graph_repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    job_repo: Annotated[GenerationJobRepository, Depends(get_job_repo)],
    user: Annotated[User, Depends(current_user)],
) -> JobDTO:
    """Start (or queue) server-owned answer generation for a question node."""
    await _require_graph(graph_repo, user.email, str(graph_id))
    records = await job_repo.get_for_graph(str(graph_id))

    record = await manager.start_answer_job(
        graph_id=str(graph_id),
        user_id=user.email,
        node_id=str(node_id),
        background=payload.background,
        params=AnswerParams(
            web_search_enabled=payload.web_search_enabled,
            search_provider=payload.search_provider,
            verbosity=payload.verbosity,
            cheat_sheet=payload.cheat_sheet,
        ),
        existing_records=records,
        force=payload.force,
    )
    return to_job_dto(record, manager.live_job_ids())


async def generate_cheat_sheet(
    graph_id: UUID,
    node_id: UUID,
    graph_repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    user: Annotated[User, Depends(current_user)],
) -> JobDTO:
    """
    Condense the thread above a question on demand: for questions answered
    before "summarize parents" was turned on, and to refresh a sheet whose
    thread has moved on. The answer flow starts the same job automatically.
    """
    await _require_graph(graph_repo, user.email, str(graph_id))
    graph = await manager.load_effective_graph(user.email, str(graph_id), documents="names_only")
    if graph is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if not has_thread_to_summarize(graph, str(node_id)):
        raise HTTPException(
            status_code=400,
            detail="There are no answered questions above this one to summarize.",
        )
    record = await manager.start_cheat_sheet_job(
        graph_id=str(graph_id),
        user_id=user.email,
        node_id=str(node_id),
    )
    return to_job_dto(record, manager.live_job_ids())


async def suggest_followups(
    graph_id: UUID,
    node_id: UUID,
    payload: SuggestFollowupsRequestDTO,
    graph_repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    user: Annotated[User, Depends(current_user)],
) -> JobDTO:
    """Start a follow-up suggestion generation; results arrive on the job stream."""
    await _require_graph(graph_repo, user.email, str(graph_id))
    record = await manager.start_suggestion_job(
        graph_id=str(graph_id),
        user_id=user.email,
        node_id=str(node_id),
        kind="suggestions",
        params=SuggestionParams(request_more=payload.request_more),
    )
    return to_job_dto(record, manager.live_job_ids())


async def suggest_big_picture(
    graph_id: UUID,
    graph_repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    user: Annotated[User, Depends(current_user)],
) -> JobDTO:
    """Start a big-picture suggestion generation; results arrive on the job stream."""
    await _require_graph(graph_repo, user.email, str(graph_id))
    record = await manager.start_suggestion_job(
        graph_id=str(graph_id),
        user_id=user.email,
        node_id=None,
        kind="big_picture",
        params=SuggestionParams(request_more=False),
    )
    return to_job_dto(record, manager.live_job_ids())


async def stream(websocket: WebSocket):
    """
    Per-graph job event stream. On attach the channel queue is seeded with the
    complete job state — snapshots of live jobs, then stored terminal records,
    then a 'synced' marker — so the connection IS the sync: everything a job
    did before the client attached replays as the events it would have seen.
    """
    # Accept before closing with an application code: a close before accept is
    # an HTTP handshake rejection and the browser only ever sees code 1006.
    graph_id = websocket.path_params["graph_id"]
    repo = GraphDataRepository(get_db())
    if not await repo.exists(current_user().email, graph_id):
        await websocket.accept()
        await websocket.close(code=4004, reason="Not found")
        return

    await websocket.accept()
    channel = JobChannel()
    manager.attach(graph_id, channel)

    # Terminal/interrupted records replay after the snapshots, in the same
    # ordered queue. A completion racing this read is covered either way:
    # as a live broadcast (already subscribed) or as the record state here —
    # the client applies terminal events idempotently.
    records = await GenerationJobRepository(get_db()).get_for_graph(graph_id)
    live = manager.live_job_ids()
    for record in records:
        event = record_event(record, live)
        if event is not None:
            channel.push(event)
    channel.push({"type": "synced"})

    async def send_events() -> None:
        while True:
            try:
                event = await asyncio.wait_for(channel.events.get(), timeout=KEEPALIVE_INTERVAL)
            except TimeoutError:
                await websocket.send_json({"type": "keepalive"})
                continue
            await websocket.send_json(event)

    # The sender alone only notices a closed socket on its next send, up to a
    # keepalive later — long enough to stall server shutdown. Watching receive
    # ends the stream the moment either side closes.
    async def until_disconnect() -> None:
        while (await websocket.receive())["type"] != "websocket.disconnect":
            pass
        raise WebSocketDisconnect

    try:
        async with asyncio.TaskGroup() as tasks:
            tasks.create_task(send_events())
            tasks.create_task(until_disconnect())
    except* WebSocketDisconnect:
        logger.debug("Job stream client disconnected (graph %s)", graph_id)
    except* Exception:
        logger.exception("Job stream failed (graph %s)", graph_id)
    finally:
        manager.detach(graph_id, channel)
