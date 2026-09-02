"""
The four shared demo cases behind the landing page.

Each landing demo links to a real, copyable case whose content continues the
demo: the kickstart demo (compute governance), the branch demo (moral
progress), the frontier demo (Big Five) and the suggestions demo (free will).
The landing page links them as /shared/<id>; visitors browse them read-only
and copy them to continue.

The cases are real sessions, recorded in the app itself and checked in under
exports/ as the case export the app produces. Nothing in them is hand-written,
so they read exactly like the workspace does: answers with web sources,
cross-links between questions, pending suggestions.

To refresh a case, share it in the app and pull the share payload:

    curl -sS https://api.talleyrand.app/backend/share/<graph id> \
      | python -m json.tool --indent 2 --no-ensure-ascii > exports/<case>.json

The sidebar's Export button produces the same document (plus the owner's read
history, which the loader drops). The landing page mirrors parts of each case
(its brief and questions, answer excerpts, suggestion cards), so check
LandingPage.tsx after a refresh.

This module is the source of truth: the cases are re-seeded on every backend
startup (see seed.py), so edits here propagate on deploy. Ids and timestamps
come from the files — reseeding never produces a different document.
"""

import json
from pathlib import Path

from talleyrand.features.graph.dtos import GraphNoId
from talleyrand.features.graph.models import GraphDocument

# The demo cases' owner. Not a real account: Google OAuth can never mint this
# identity, so nobody can edit the cases through the app.
DEMO_USER_ID = "demo@talleyrand.internal"

# Reserved graph ids — the landing page links them as /shared/<id>.
COMPUTE_GOVERNANCE_ID = "demo-compute-governance"
MORAL_PROGRESS_ID = "demo-moral-progress"
BIG_FIVE_ID = "demo-big-five"
FREE_WILL_ID = "demo-free-will"

_EXPORTS = Path(__file__).with_name("exports")


def _from_export(case_id: str, filename: str) -> tuple[str, GraphDocument]:
    """
    A demo case recorded from a real session, loaded from its case export.

    The export is the GET /graph/{id} (or GET /share/{id}) payload: node ids,
    timestamps, answers with their sources and node-id cross-links all come
    from the file, so the document is as deterministic as hand-written data.
    The original owner's read history is dropped — a shared case never exposes
    it anyway — and the case is re-homed under the demo user.
    """
    raw = json.loads((_EXPORTS / filename).read_text(encoding="utf-8"))
    graph = GraphNoId.model_validate(raw)
    return case_id, GraphDocument(
        name=raw["name"],
        user_id=DEMO_USER_ID,
        nodes=graph.nodes,
        edges=graph.edges,
        node_contents=graph.node_contents,
        created_at=raw.get("createdAt"),
        brief=graph.brief,
        case_documents=graph.case_documents,
        suggestions=graph.suggestions,
        declined_questions=graph.declined_questions,
        read_history=[],
    )


def build_demo_cases() -> list[tuple[str, GraphDocument]]:
    """All demo cases as (graph_id, document) pairs, built fresh on each call."""
    return [
        _from_export(COMPUTE_GOVERNANCE_ID, "compute-governance.json"),
        _from_export(MORAL_PROGRESS_ID, "moral-progress.json"),
        _from_export(BIG_FIVE_ID, "big-five.json"),
        _from_export(FREE_WILL_ID, "free-will.json"),
    ]
