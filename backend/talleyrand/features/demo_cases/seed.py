"""Startup seeding of the landing page's shared demo cases."""

import logging
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from talleyrand.features.demo_cases.cases import DEMO_USER_ID, build_demo_cases
from talleyrand.features.graph.models import GraphDataRepository

logger = logging.getLogger(__name__)


async def seed_demo_cases(db: AsyncDatabase[Any]) -> None:
    """
    Upsert the demo cases and mark them shared.

    Runs on every startup, overwriting previous content, so the shared cases
    always match the code — and the landing page links that point at them.
    """
    repo = GraphDataRepository(db)
    cases = build_demo_cases()
    for graph_id, document in cases:
        # force: the code is the source of truth for demo cases — overwrite
        # regardless of the stored revision (nothing else ever saves them).
        await repo.save(DEMO_USER_ID, graph_id, document, force=True)
        await repo.set_shared(DEMO_USER_ID, graph_id, shared=True)

    # Retired demo cases (removed or renamed ids) disappear with their links
    current_ids = {graph_id for graph_id, _ in cases}
    for metadata in await repo.get_all_metadata(DEMO_USER_ID):
        if metadata["_id"] not in current_ids:
            await repo.delete(DEMO_USER_ID, metadata["_id"])

    logger.info("Seeded %d shared demo cases", len(cases))
