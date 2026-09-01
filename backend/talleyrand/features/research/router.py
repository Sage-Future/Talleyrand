"""
Research API router.
"""

from fastapi import Depends
from fastapi.routing import APIRouter

from talleyrand.features.auth_jwt import router as auth_app
from talleyrand.features.rate_limit.service import per_user_rate_limit
from talleyrand.features.research import kickstart, report, suggestions
from talleyrand.features.research.generation import routes as generation

router = APIRouter(prefix="/research", tags=["research"])

# Per-account caps on the LLM-backed endpoints. Signup is open, so these are
# what keeps one account from saturating the shared instance; the numbers are
# far above interactive use. Auto-fired suggestion jobs (followups after each
# answer) share a scope separate from user-initiated answers, so a burst of
# one can never starve the other.
limit_answers = per_user_rate_limit("answers", per_minute=60)
limit_suggestions = per_user_rate_limit("suggestions", per_minute=60)
limit_selection_suggest = per_user_rate_limit("selection-suggest", per_minute=40)
limit_kickstart = per_user_rate_limit("kickstart", per_minute=20)
limit_report = per_user_rate_limit("report", per_minute=10)
limit_cheat_sheets = per_user_rate_limit("cheat-sheets", per_minute=30)

# Transient suggestions for the selection popup and the legacy canvas:
# context ships in the body, nothing is persisted server-side.
router.add_api_route(
    "/{graph_id}/node/{node_id}/suggest",
    suggestions.suggest,
    methods=["POST"],
    dependencies=[Depends(auth_app.require_auth), Depends(limit_selection_suggest)],
)

# Durable generation jobs: answers and frontier suggestions survive the browser.
router.add_api_route(
    "/{graph_id}/node/{node_id}/generate",
    generation.generate_answer,
    methods=["POST"],
    dependencies=[Depends(limit_answers)],
)

router.add_api_route(
    "/{graph_id}/node/{node_id}/suggest-followups",
    generation.suggest_followups,
    methods=["POST"],
    dependencies=[Depends(limit_suggestions)],
)

# On-demand cheat sheet for a question's thread; the answer flow starts the
# same job by itself whenever "summarize parents" is on.
router.add_api_route(
    "/{graph_id}/node/{node_id}/cheat-sheet",
    generation.generate_cheat_sheet,
    methods=["POST"],
    dependencies=[Depends(limit_cheat_sheets)],
)

router.add_api_route(
    "/{graph_id}/suggest-big-picture",
    generation.suggest_big_picture,
    methods=["POST"],
    dependencies=[Depends(limit_suggestions)],
)

# The stream's own credential: minted here on an authenticated request, then
# spent on the WebSocket URL below (see create_stream_ticket).
router.add_api_route(
    "/{graph_id}/stream-ticket",
    generation.create_stream_ticket,
    methods=["POST"],
)

router.add_api_websocket_route("/{graph_id}/stream", generation.stream)

router.add_api_route(
    "/kickstart/brief",
    kickstart.generate_brief,
    methods=["POST"],
    dependencies=[Depends(auth_app.require_auth), Depends(limit_kickstart)],
)

router.add_api_route(
    "/kickstart/questions",
    kickstart.generate_questions,
    methods=["POST"],
    dependencies=[Depends(auth_app.require_auth), Depends(limit_kickstart)],
)

# Markdown report of the whole case: context ships in the body,
# nothing is persisted server-side.
router.add_api_route(
    "/report",
    report.generate_report,
    methods=["POST"],
    dependencies=[Depends(auth_app.require_auth), Depends(limit_report)],
)
