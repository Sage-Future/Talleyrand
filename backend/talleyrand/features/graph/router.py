"""
Graph API router.
"""

from fastapi.routing import APIRouter

from talleyrand.features.graph import graph_naming
from talleyrand.features.graph import routes_graph as gr

router = APIRouter(prefix="/graph", tags=["graph"])


router.add_api_route("/{graph_id}", gr.save, methods=["PUT"])
router.add_api_route("/{graph_id}", gr.get, methods=["GET"])
router.add_api_route("/{graph_id}", gr.delete, methods=["DELETE"])
router.add_api_route("/{graph_id}/rename", gr.rename, methods=["PATCH"])
router.add_api_route("/", gr.get_all_metadata, methods=["GET"])
router.add_api_route("/", gr.create_new, methods=["POST"])
# Creating a case from a file is its own endpoint, not a save of one: a save
# never creates, so that a stale one can't put back a deleted case.
router.add_api_route("/import", gr.import_case, methods=["POST"])

router.add_api_route("/{graph_id}/generate-name", graph_naming.generate_name, methods=["POST"])
