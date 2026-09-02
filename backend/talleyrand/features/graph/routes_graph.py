"""
Graph API router.
"""

from typing import Annotated
from uuid import uuid4

from fastapi import Depends, HTTPException, Response, status
from pydantic_core import to_json

from talleyrand.features.auth_jwt import router as auth_app
from talleyrand.features.graph.dtos import (
    GraphMetadataDTO,
    RenameGraphDTO,
    SaveGraphDataDTO,
    get_save_graph_data_dto,
)
from talleyrand.features.graph.models import (
    MAX_GRAPH_BYTES,
    GraphConflictError,
    GraphDataRepository,
    GraphDocument,
    GraphTooLargeError,
    get_graph_repo,
)
from talleyrand.features.research.generation.manager import manager
from talleyrand.features.research.generation.overlay import (
    apply_read_overlay,
    graph_like,
    reconcile_save,
)
from talleyrand.features.research.generation.records import (
    GenerationJobRepository,
    get_job_repo,
)
from talleyrand.models.user import User


async def save(
    payload: Annotated[SaveGraphDataDTO, Depends(get_save_graph_data_dto)],
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    job_repo: Annotated[GenerationJobRepository, Depends(get_job_repo)],
    user: Annotated[User, Depends(auth_app.require_auth)],
):
    """
    Save the autosaved working graph for the current user.

    Unacknowledged generation-job results are folded into the payload first, so
    a client holding pre-completion state can never overwrite a server-side
    result; records the payload retires (acked or node-deleted) are dropped.

    The save is conditional on the payload's revision matching the stored
    case (409 otherwise), so a stale client can never overwrite work saved
    from another tab or device. A conflict retires nothing: job records
    outlive the rejected save and are re-delivered when the client reloads.
    """
    graph_id = str(payload.id)
    records = await job_repo.get_for_graph(graph_id)
    reconciled = reconcile_save(
        graph_like(
            payload.nodes, payload.node_contents, payload.suggestions, payload.declined_questions
        ),
        records,
        set(payload.acked_job_ids),
        manager.live_job_ids(),
    )

    graph_data = GraphDocument(
        user_id=user.email, **payload.model_dump(mode="json", exclude={"id", "acked_job_ids"})
    )
    try:
        new_revision = await repo.save(user.email, graph_id, graph_data)
    except GraphTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"This case is too large to save ({exc.size_bytes / (1024 * 1024):.1f} MB; "
                f"the limit is {MAX_GRAPH_BYTES // (1024 * 1024)} MB). "
                "Remove or shrink attached documents."
            ),
        ) from exc
    except GraphConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This case was edited in another tab or window, so this save is based on "
                "an outdated version. Reload to get the latest version."
            ),
        ) from exc

    manager.cancel_jobs(reconciled.jobs_to_cancel)
    await job_repo.delete_many(reconciled.records_to_delete)
    return {"id": graph_id, "revision": new_revision}


async def get(
    graph_id: str,
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    job_repo: Annotated[GenerationJobRepository, Depends(get_job_repo)],
    user: Annotated[User, Depends(auth_app.require_auth)],
):
    """
    Get graph data by ID, with unacknowledged generation results folded in.
    """
    result = await repo.get_by_id(user.email, graph_id)

    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    graph_id, graph_data = result
    records = await job_repo.get_for_graph(graph_id)
    apply_read_overlay(
        graph_like(
            graph_data.nodes,
            graph_data.node_contents,
            graph_data.suggestions,
            graph_data.declined_questions,
        ),
        records,
        manager.live_job_ids(),
    )
    formatted_data = SaveGraphDataDTO(id=graph_id, **graph_data.model_dump())
    # acked_job_ids is request-only (client -> server on PUT); keep it off reads.
    # Serialized straight to bytes: a full-context case is megabytes, and the
    # default path would build the JSON text and its encoding as two more
    # copies of it on the way out.
    return Response(
        content=to_json(formatted_data, by_alias=True, exclude={"acked_job_ids"}),
        media_type="application/json",
    )


async def get_all_metadata(
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    user: Annotated[User, Depends(auth_app.require_auth)],
):
    """
    Get metadata for all graphs for user (lightweight listing).
    """
    results = await repo.get_all_metadata(user.email)
    dtos = [
        GraphMetadataDTO(id=doc["_id"], **{k: v for k, v in doc.items() if k != "_id"})
        for doc in results
    ]
    # Format data to use camelCase for JSON keys
    return [data.model_dump(by_alias=True, mode="json") for data in dtos]


async def delete(
    graph_id: str,
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    job_repo: Annotated[GenerationJobRepository, Depends(get_job_repo)],
    user: Annotated[User, Depends(auth_app.require_auth)],
):
    """
    Delete graph by ID, along with its generation jobs.
    """
    deleted = await repo.delete(user.email, graph_id)

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    records = await job_repo.get_for_graph(graph_id)
    manager.cancel_jobs([record.id for record in records])
    await job_repo.delete_many([record.id for record in records])
    return {"success": True, "id": graph_id}


async def create_new(
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    user: Annotated[User, Depends(auth_app.require_auth)],
):
    """
    Create a new empty graph for the current user.
    """
    graph_id = str(uuid4())

    # Create an empty graph
    graph_data = GraphDocument(
        name="New case",
        user_id=user.email,
        nodes=[],
        edges=[],
        node_contents=[],
    )

    await repo.save(user.email, graph_id, graph_data)

    return {"id": graph_id}


async def rename(
    graph_id: str,
    payload: RenameGraphDTO,
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    user: Annotated[User, Depends(auth_app.require_auth)],
):
    """
    Rename a graph by ID.
    """
    renamed = await repo.rename(user.email, graph_id, payload.name)

    if not renamed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return {"success": True, "id": graph_id, "name": payload.name}
