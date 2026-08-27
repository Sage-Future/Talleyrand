"""
Share API router.
"""

from fastapi.routing import APIRouter

from talleyrand.features.share import routes

router = APIRouter(prefix="/share", tags=["share"])

router.add_api_route("/graph/{graph_id}", routes.enable_share, methods=["POST"])
router.add_api_route("/graph/{graph_id}", routes.disable_share, methods=["DELETE"])
router.add_api_route("/{graph_id}", routes.get_shared_graph, methods=["GET"])
router.add_api_route("/{graph_id}/copy", routes.copy_shared_graph, methods=["POST"])
