"""
Share API handlers.
"""

from typing import Annotated
from uuid import uuid4

from fastapi import Depends, HTTPException, status

from talleyrand.features.auth_jwt import router as auth_app
from talleyrand.features.graph.dtos import (
    CopyGraphResponseDTO,
    SharedGraphViewDTO,
    ShareStatusDTO,
)
from talleyrand.features.graph.models import (
    GraphDataRepository,
    GraphDocument,
    get_graph_repo,
)
from talleyrand.features.research.generation.manager import manager
from talleyrand.features.research.generation.overlay import apply_read_overlay, graph_like
from talleyrand.features.research.generation.records import (
    GenerationJobRepository,
    get_job_repo,
)
from talleyrand.models.user import User


async def _fold_generation_results(
    graph_id: str, graph_data: GraphDocument, job_repo: GenerationJobRepository
) -> None:
    """Fold unacknowledged generation results into a doc being read without auth scope."""
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


async def enable_share(
    graph_id: str,
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    user: Annotated[User, Depends(auth_app.require_auth)],
):
    """Enable sharing for a graph. Idempotent."""
    found = await repo.set_shared(user.email, graph_id, shared=True)
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return ShareStatusDTO(is_shared=True).model_dump(by_alias=True, mode="json")


async def disable_share(
    graph_id: str,
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    user: Annotated[User, Depends(auth_app.require_auth)],
):
    """Disable sharing for a graph."""
    found = await repo.set_shared(user.email, graph_id, shared=False)
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return ShareStatusDTO(is_shared=False).model_dump(by_alias=True, mode="json")


async def get_shared_graph(
    graph_id: str,
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    job_repo: Annotated[GenerationJobRepository, Depends(get_job_repo)],
):
    """
    Get a shared graph by ID. No authentication required.
    Returns 404 for both "not found" and "not shared" to prevent enumeration.
    """
    result = await repo.get_shared_by_id(graph_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _, graph_data = result
    await _fold_generation_results(graph_id, graph_data, job_repo)
    dto = SharedGraphViewDTO(
        name=graph_data.name,
        nodes=graph_data.nodes,
        edges=graph_data.edges,
        node_contents=graph_data.node_contents,
        brief=graph_data.brief,
        case_documents=graph_data.case_documents,
        suggestions=graph_data.suggestions,
        declined_questions=graph_data.declined_questions,
    )
    return dto.model_dump(by_alias=True, mode="json")


async def copy_shared_graph(
    graph_id: str,
    repo: Annotated[GraphDataRepository, Depends(get_graph_repo)],
    job_repo: Annotated[GenerationJobRepository, Depends(get_job_repo)],
    user: Annotated[User, Depends(auth_app.require_auth)],
):
    """Copy a shared graph to the authenticated user's account."""
    result = await repo.get_shared_by_id(graph_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _, graph_data = result
    await _fold_generation_results(graph_id, graph_data, job_repo)

    new_graph_id = str(uuid4())
    copy = GraphDocument(
        name=f"Copy of {graph_data.name}",
        user_id=user.email,
        nodes=graph_data.nodes,
        edges=graph_data.edges,
        node_contents=graph_data.node_contents,
        brief=graph_data.brief,
        case_documents=graph_data.case_documents,
        suggestions=graph_data.suggestions,
        declined_questions=graph_data.declined_questions,
        # read_history stays empty: the new owner hasn't read anything yet
    )
    await repo.save(user.email, new_graph_id, copy)

    return CopyGraphResponseDTO(id=new_graph_id).model_dump(by_alias=True, mode="json")
