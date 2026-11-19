"""
Research API router.
"""

from fastapi.routing import APIRouter

from talleyrand.features.research import context_size, kickstart, report, suggestions
from talleyrand.features.research.generation import routes as generation

router = APIRouter(prefix="/research", tags=["research"])

# Transient suggestions for the selection popup and the legacy canvas:
# context ships in the body, nothing is persisted server-side.
router.add_api_route(
    "/{graph_id}/node/{node_id}/suggest",
    suggestions.suggest,
    methods=["POST"],
)

# Durable generation jobs: answers and frontier suggestions survive the browser.
router.add_api_route(
    "/{graph_id}/node/{node_id}/generate",
    generation.generate_answer,
    methods=["POST"],
)

router.add_api_route(
    "/{graph_id}/node/{node_id}/suggest-followups",
    generation.suggest_followups,
    methods=["POST"],
)

# On-demand cheat sheet for a question's thread; the answer flow starts the
# same job by itself whenever "summarize parents" is on.
router.add_api_route(
    "/{graph_id}/node/{node_id}/cheat-sheet",
    generation.generate_cheat_sheet,
    methods=["POST"],
)

router.add_api_route(
    "/{graph_id}/suggest-big-picture",
    generation.suggest_big_picture,
    methods=["POST"],
)

# The composer's context meter: what the next question would send, counted
# by the tokenizer that will judge it.
router.add_api_route(
    "/{graph_id}/context-size",
    context_size.context_size,
    methods=["POST"],
)

router.add_api_websocket_route("/{graph_id}/stream", generation.stream)

router.add_api_route(
    "/kickstart/brief",
    kickstart.generate_brief,
    methods=["POST"],
)

router.add_api_route(
    "/kickstart/questions",
    kickstart.generate_questions,
    methods=["POST"],
)

# Markdown report of the whole case: context ships in the body,
# nothing is persisted server-side.
router.add_api_route(
    "/report",
    report.generate_report,
    methods=["POST"],
)
