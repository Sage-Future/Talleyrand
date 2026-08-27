"""
Graph API router.
"""

from fastapi import Depends
from fastapi.routing import APIRouter

from talleyrand.features.auth_jwt import router as auth_app
from talleyrand.features.graph import graph_naming
from talleyrand.features.graph import routes_graph as gr
from talleyrand.features.rate_limit.service import per_user_rate_limit

router = APIRouter(prefix="/graph", tags=["graph"])


router.add_api_route("/{graph_id}", gr.save, methods=["PUT"])
router.add_api_route("/{graph_id}", gr.get, methods=["GET"])
router.add_api_route("/{graph_id}", gr.delete, methods=["DELETE"])
router.add_api_route("/{graph_id}/rename", gr.rename, methods=["PATCH"])
router.add_api_route("/", gr.get_all_metadata, methods=["GET"])
router.add_api_route("/", gr.create_new, methods=["POST"])

# Auto-naming loads the whole case and makes an OpenAI call, so it gets a
# per-account cap like every other LLM-backed endpoint; the app only fires it
# automatically (never in a loop), so the limit is far above legitimate use.
router.add_api_route(
    "/{graph_id}/generate-name",
    graph_naming.generate_name,
    methods=["POST"],
    dependencies=[
        Depends(auth_app.require_auth),
        Depends(per_user_rate_limit("naming", per_minute=20)),
    ],
)
