"""
Tests for the job-record overlay: the ownership boundary between client saves
and server-owned generation results.
"""

from datetime import UTC, datetime
from uuid import uuid4

from talleyrand.features.graph.dtos import (
    NodeContentDTO,
    NodeDTO,
    ResearchSuggestionDTO,
    WebSourceDTO,
)
from talleyrand.features.research.generation.manager import record_event
from talleyrand.features.research.generation.overlay import (
    INTERRUPTED_ERROR,
    apply_read_overlay,
    assemble_suggestions,
    effective_error,
    effective_status,
    graph_like,
    reconcile_save,
)
from talleyrand.features.research.generation.records import GenerationJobRecord

NOW = datetime(2026, 6, 11, tzinfo=UTC)


def make_node(node_id: str) -> NodeDTO:
    return NodeDTO(id=node_id)


def make_content(node_id: str, query: str = "q", response: str = "") -> NodeContentDTO:
    return NodeContentDTO(
        id=node_id,
        query=query,
        response=response,
        selected_model="gpt",
        documents=[],
        selection_suggestions=[],
        selections=[],
    )


def make_suggestion(parent_node_id: str, text: str) -> ResearchSuggestionDTO:
    return ResearchSuggestionDTO(
        id=str(uuid4()),
        parent_node_id=parent_node_id,
        text=text,
        created_at=NOW,
    )


def answer_record(
    node_id: str,
    status: str,
    answer: str | None = None,
    sources: list[WebSourceDTO] | None = None,
    sources_found: int = 0,
) -> GenerationJobRecord:
    return GenerationJobRecord(
        id=str(uuid4()),
        graph_id="g",
        user_id="u",
        kind="answer",
        node_id=node_id,
        status=status,
        created_at=NOW,
        answer=answer,
        answered_at=NOW if status == "done" else None,
        sources=sources or [],
        sources_found=sources_found or len(sources or []),
    )


def cheat_sheet_record(
    node_id: str, status: str = "done", cheat_sheet: str | None = "the sheet"
) -> GenerationJobRecord:
    return GenerationJobRecord(
        id=str(uuid4()),
        graph_id="g",
        user_id="u",
        kind="cheat_sheet",
        node_id=node_id,
        status=status,
        created_at=NOW,
        cheat_sheet=cheat_sheet if status == "done" else None,
    )


def suggestion_record(
    node_id: str | None, suggestions: list[ResearchSuggestionDTO], kind: str = "suggestions"
) -> GenerationJobRecord:
    return GenerationJobRecord(
        id=str(uuid4()),
        graph_id="g",
        user_id="u",
        kind=kind,
        node_id=node_id,
        status="done",
        created_at=NOW,
        suggestions=suggestions,
    )


NODE = str(uuid4())


def graph(contents: list[NodeContentDTO], suggestions=None):
    nodes = [make_node(str(content.id)) for content in contents]
    return graph_like(nodes, contents, suggestions if suggestions is not None else [], [])


class TestEffectiveStatus:
    def test_running_without_runtime_is_interrupted_error(self):
        record = answer_record(NODE, "running")
        assert effective_status(record, live_job_ids=set()) == "error"
        assert "interrupted" in (effective_error(record, set()) or "")

    def test_running_with_runtime_stays_running(self):
        record = answer_record(NODE, "running")
        assert effective_status(record, {record.id}) == "running"
        assert effective_error(record, {record.id}) is None

    def test_done_is_done_regardless_of_runtime(self):
        record = answer_record(NODE, "done", "a")
        assert effective_status(record, set()) == "done"


class TestReadOverlay:
    def test_normalizes_open_node_with_live_running_job(self):
        content = make_content(NODE, response="")
        content.answered_at = NOW
        record = answer_record(NODE, "running")
        apply_read_overlay(graph([content]), [record], {record.id})
        assert content.response == ""
        assert content.answered_at is None

    def test_running_job_does_not_blank_canvas_written_response(self):
        content = make_content(NODE, response="canvas answer")
        record = answer_record(NODE, "running")
        apply_read_overlay(graph([content]), [record], {record.id})
        assert content.response == "canvas answer"

    def test_folds_done_answer(self):
        content = make_content(NODE)
        record = answer_record(NODE, "done", "the answer")
        apply_read_overlay(graph([content]), [record], set())
        assert content.response == "the answer"
        assert content.answered_at == NOW

    def test_folds_the_answers_sources_along_with_it(self):
        content = make_content(NODE)
        record = answer_record(
            NODE,
            "done",
            "the answer",
            sources=[WebSourceDTO(url="https://a.com", title="A", cited=True)],
            sources_found=83,
        )
        apply_read_overlay(graph([content]), [record], set())
        assert content.sources == record.sources
        # The full count travels with the trimmed list, so a reader is never
        # told the model looked at less than it did.
        assert content.sources_found == 83

    def test_reopening_a_node_drops_the_sources_of_the_answer_it_removed(self):
        content = make_content(NODE, response="")
        content.sources = [WebSourceDTO(url="https://a.com")]
        content.sources_found = 1
        record = answer_record(NODE, "running")
        apply_read_overlay(graph([content]), [record], {record.id})
        assert content.sources == []
        assert content.sources_found == 0

    def test_done_record_does_not_override_differing_doc_content(self):
        content = make_content(NODE, response="newer canvas answer")
        record = answer_record(NODE, "done", "old generated answer")
        apply_read_overlay(graph([content]), [record], set())
        assert content.response == "newer canvas answer"

    def test_interrupted_job_does_not_mask(self):
        content = make_content(NODE, response="committed earlier")
        record = answer_record(NODE, "running")  # no runtime: server restarted
        apply_read_overlay(graph([content]), [record], set())
        assert content.response == "committed earlier"

    def test_skips_answer_record_whose_content_is_missing(self):
        view = graph_like([make_node(NODE)], [], [], [])  # node exists, content absent
        record = answer_record(NODE, "done", "the answer")
        apply_read_overlay(view, [record], set())  # must not raise

    def test_appends_done_suggestions_with_dedup(self):
        content = make_content(NODE, query="existing question")
        existing = make_suggestion(NODE, "already shown")
        fresh = make_suggestion(NODE, "brand new direction")
        dup_of_question = make_suggestion(NODE, "Existing question!")
        dup_of_existing = make_suggestion(NODE, "already shown")
        orphan = make_suggestion(str(uuid4()), "parent is gone")
        record = suggestion_record(NODE, [fresh, dup_of_question, dup_of_existing, orphan])

        view = graph([content], suggestions=[existing])
        apply_read_overlay(view, [record], set())
        assert [s.id for s in view.suggestions] == [existing.id, fresh.id]

    def test_does_not_append_same_suggestion_twice(self):
        content = make_content(NODE)
        fresh = make_suggestion(NODE, "new direction")
        record = suggestion_record(NODE, [fresh])
        view = graph([content], suggestions=[fresh])  # already incorporated
        apply_read_overlay(view, [record], set())
        assert len(view.suggestions) == 1


class TestCheatSheetOverlay:
    """A cheat sheet is regenerated in place, so a completed record is always
    newer than the payload; incorporation is proven by an explicit ack."""

    def test_read_overlay_folds_done_sheet(self):
        content = make_content(NODE)
        record = cheat_sheet_record(NODE)
        apply_read_overlay(graph([content]), [record], set())
        assert content.cheat_sheet == "the sheet"

    def test_read_overlay_overwrites_previous_sheet(self):
        content = make_content(NODE)
        content.cheat_sheet = "the older sheet"
        record = cheat_sheet_record(NODE, cheat_sheet="the refreshed sheet")
        apply_read_overlay(graph([content]), [record], set())
        assert content.cheat_sheet == "the refreshed sheet"

    def test_running_job_keeps_the_sheet_being_replaced(self):
        content = make_content(NODE)
        content.cheat_sheet = "the older sheet"
        record = cheat_sheet_record(NODE, status="running")
        apply_read_overlay(graph([content]), [record], {record.id})
        assert content.cheat_sheet == "the older sheet"

    def test_save_forces_sheet_in_until_acked(self):
        content = make_content(NODE)
        record = cheat_sheet_record(NODE)
        result = reconcile_save(graph([content]), [record], set(), set())
        assert result.records_to_delete == []
        assert content.cheat_sheet == "the sheet"

    def test_save_retires_acked_sheet(self):
        content = make_content(NODE)
        content.cheat_sheet = "the sheet"
        record = cheat_sheet_record(NODE)
        result = reconcile_save(graph([content]), [record], {record.id}, set())
        assert result.records_to_delete == [record.id]
        assert content.cheat_sheet == "the sheet"

    def test_save_retires_failed_sheet_without_an_ack(self):
        # No retry affordance for a cheat sheet: a dead job leaves the thread
        # itself as the header, and its record must not linger.
        content = make_content(NODE)
        failed = cheat_sheet_record(NODE, status="error")
        interrupted = cheat_sheet_record(NODE, status="running")  # no runtime
        result = reconcile_save(graph([content]), [failed, interrupted], set(), set())
        assert set(result.records_to_delete) == {failed.id, interrupted.id}
        assert content.cheat_sheet is None

    def test_done_sheet_replays_as_cheat_sheet_event(self):
        record = cheat_sheet_record(NODE)
        assert record_event(record, set()) == {
            "type": "cheat_sheet",
            "jobId": record.id,
            "nodeId": NODE,
            "status": "done",
            "data": "the sheet",
        }

    def test_interrupted_sheet_replays_as_error_so_the_view_stops_waiting(self):
        record = cheat_sheet_record(NODE, status="running")  # no runtime: restart
        event = record_event(record, set())
        assert event is not None
        assert event["type"] == "cheat_sheet"
        assert event["status"] == "error"
        assert event["data"] == INTERRUPTED_ERROR


class TestReconcileSave:
    def test_auto_acks_answer_when_payload_carries_it(self):
        content = make_content(NODE, response="the answer")
        record = answer_record(NODE, "done", "the answer")
        result = reconcile_save(graph([content]), [record], set(), set())
        assert result.records_to_delete == [record.id]
        assert content.response == "the answer"

    def test_forces_answer_over_stale_payload(self):
        content = make_content(NODE, response="")
        record = answer_record(NODE, "done", "the answer")
        result = reconcile_save(graph([content]), [record], set(), set())
        assert result.records_to_delete == []
        assert content.response == "the answer"
        assert content.answered_at == NOW

    def test_superseding_response_retires_record_and_wins(self):
        # Legacy canvas re-query or edit while a done record sat unacked
        content = make_content(NODE, response="regenerated in canvas")
        record = answer_record(NODE, "done", "old generated answer")
        result = reconcile_save(graph([content]), [record], set(), set())
        assert result.records_to_delete == [record.id]
        assert content.response == "regenerated in canvas"

    def test_running_job_keeps_canvas_written_response(self):
        content = make_content(NODE, response="canvas answer")
        record = answer_record(NODE, "running")
        reconcile_save(graph([content]), [record], set(), {record.id})
        assert content.response == "canvas answer"

    def test_prunes_records_of_deleted_nodes_and_cancels_live(self):
        running = answer_record(str(uuid4()), "running")
        done = answer_record(str(uuid4()), "done", "a")
        suggestion = suggestion_record(str(uuid4()), [])
        result = reconcile_save(graph([]), [running, done, suggestion], set(), {running.id})
        assert set(result.records_to_delete) == {running.id, done.id, suggestion.id}
        assert result.jobs_to_cancel == [running.id]

    def test_explicit_ack_is_ignored_for_answer_records(self):
        content = make_content(NODE, response="")
        record = answer_record(NODE, "done", "the answer")
        result = reconcile_save(graph([content]), [record], {record.id}, set())
        assert result.records_to_delete == []
        assert content.response == "the answer"

    def test_big_picture_record_is_not_pruned(self):
        content = make_content(NODE)
        record = suggestion_record(None, [make_suggestion(NODE, "x")], kind="big_picture")
        view = graph([content])
        result = reconcile_save(view, [record], set(), set())
        assert result.records_to_delete == []
        assert len(view.suggestions) == 1

    def test_error_answer_record_is_never_acked(self):
        content = make_content(NODE)
        record = answer_record(NODE, "error")
        record.error = "boom"
        result = reconcile_save(graph([content]), [record], {record.id}, set())
        assert result.records_to_delete == []
        assert content.response == ""

    def test_acked_suggestions_are_excluded_and_deleted(self):
        content = make_content(NODE)
        suggestion = make_suggestion(NODE, "declined by user")
        record = suggestion_record(NODE, [suggestion])
        view = graph([content])  # payload no longer carries it: user declined
        result = reconcile_save(view, [record], {record.id}, set())
        assert result.records_to_delete == [record.id]
        assert view.suggestions == []

    def test_unacked_suggestions_are_reappended(self):
        content = make_content(NODE)
        suggestion = make_suggestion(NODE, "not yet seen by client")
        record = suggestion_record(NODE, [suggestion])
        view = graph([content])
        result = reconcile_save(view, [record], set(), set())
        assert result.records_to_delete == []
        assert [s.id for s in view.suggestions] == [suggestion.id]

    def test_acked_error_suggestion_record_is_deleted(self):
        content = make_content(NODE)
        record = suggestion_record(NODE, [])
        record.status = "error"
        record.error = "boom"
        result = reconcile_save(graph([content]), [record], {record.id}, set())
        assert result.records_to_delete == [record.id]


class TestRecordEvent:
    def test_live_record_is_suppressed(self):
        record = answer_record(NODE, "running")
        assert record_event(record, {record.id}) is None

    def test_done_answer_replays_as_done(self):
        record = answer_record(NODE, "done", "the answer")
        event = record_event(record, set())
        assert event == {
            "type": "done",
            "jobId": record.id,
            "nodeId": NODE,
            "answer": "the answer",
            "answeredAt": NOW.isoformat(),
            "sources": [],
            "sourcesFound": 0,
        }

    def test_done_answer_replays_the_sources_it_recorded(self):
        # A reader who reconnects after the answer finished must still be told
        # what the searches behind it turned up.
        record = answer_record(
            NODE,
            "done",
            "the answer",
            sources=[WebSourceDTO(url="https://a.com", title="A", cited=True)],
        )
        event = record_event(record, set())
        assert event["sources"] == [
            {"url": "https://a.com", "title": "A", "pageAge": None, "cited": True}
        ]

    def test_done_suggestions_replay_as_suggestions(self):
        suggestion = make_suggestion(NODE, "an idea")
        record = suggestion_record(NODE, [suggestion])
        event = record_event(record, set())
        assert event is not None
        assert event["type"] == "suggestions"
        assert event["jobId"] == record.id
        assert [s["id"] for s in event["data"]] == [suggestion.id]

    def test_interrupted_answer_replays_as_job_error(self):
        record = answer_record(NODE, "running")  # no runtime: server restarted
        event = record_event(record, set())
        assert event == {
            "type": "job_error",
            "jobId": record.id,
            "kind": "answer",
            "nodeId": NODE,
            "data": INTERRUPTED_ERROR,
        }

    def test_stored_error_replays_with_its_message(self):
        record = answer_record(NODE, "error")
        record.error = "boom"
        event = record_event(record, set())
        assert event is not None
        assert event["type"] == "job_error"
        assert event["data"] == "boom"


class TestAssembleSuggestions:
    def test_dedups_caps_and_drops_orphans(self):
        content = make_content(NODE, query="What is X?", response="X is the answer.")
        view = graph([content], suggestions=[make_suggestion(NODE, "pending one")])
        questions = [
            (NODE, "what is x"),  # dup of an existing query
            (NODE, "Pending one"),  # dup of a pending suggestion
            (str(uuid4()), "orphaned"),  # parent not in graph
            (NODE, "fresh one"),
            (NODE, "fresh one"),  # dup within the batch
            (NODE, "fresh two"),
            (NODE, "fresh three"),  # over the cap
        ]
        assembled = assemble_suggestions(
            view,
            questions,
            big_picture=False,
            cap=2,
            created_at=NOW,
            make_id=lambda: str(uuid4()),
        )
        assert [s.text for s in assembled] == ["fresh one", "fresh two"]
        assert all(not s.big_picture for s in assembled)

    def test_drops_suggestions_for_unanswered_parent(self):
        # A failed (or not-yet-answered) question has no answer to anchor a
        # follow-up, so nothing is filed under it; answered parents are unaffected.
        answered = make_content(NODE, query="answered q", response="the answer")
        unanswered_id = str(uuid4())
        unanswered = make_content(unanswered_id, query="failed q", response="")
        view = graph([answered, unanswered])
        questions = [
            (unanswered_id, "follow-up on the failed question"),
            (NODE, "follow-up on the answered question"),
        ]
        assembled = assemble_suggestions(
            view,
            questions,
            big_picture=True,
            cap=5,
            created_at=NOW,
            make_id=lambda: str(uuid4()),
        )
        assert [s.text for s in assembled] == ["follow-up on the answered question"]
