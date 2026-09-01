"""
In-memory runtime for generation jobs.

One process-global manager owns every running job task, the per-user background
queue, and the per-graph event channels. Job results are persisted as records
(records.py); the runtime holds only what must not be persisted (API keys) or
is reconstructible (stream buffers).

Ordering guarantees relied upon by the protocol:
- registry entries are inserted synchronously before the first await of a start,
  so a concurrent start or a /jobs read can never observe a half-started job;
- channel attach snapshots and subscribes in one synchronous block, and chunk
  append + broadcast happen without an await in between, so a view receives
  every chunk exactly once (snapshot covers the past, the queue the future).
"""

import asyncio
import logging
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from talleyrand.core.config import settings
from talleyrand.core.llm import SourceChunk, WebSourceCollector, provider_error_detail
from talleyrand.features.graph.dtos import GraphNoId, WebSourceDTO
from talleyrand.features.graph.models import GraphDataRepository, GraphDocument
from talleyrand.features.research.big_picture import (
    MAX_SUGGESTIONS as BIG_PICTURE_CAP,
)
from talleyrand.features.research.big_picture import (
    get_big_picture_suggestions,
)
from talleyrand.features.research.cheat_sheet import (
    generate_cheat_sheet,
    has_thread_to_summarize,
)
from talleyrand.features.research.context_builder import build_question_tree
from talleyrand.features.research.generation.overlay import (
    apply_read_overlay,
    assemble_suggestions,
    effective_error,
    graph_like,
)
from talleyrand.features.research.generation.records import (
    GenerationJobRecord,
    GenerationJobRepository,
    new_answer_record,
    new_cheat_sheet_record,
    new_suggestion_record,
)
from talleyrand.features.research.query_service import do_research_query
from talleyrand.features.research.ref_tokens import freeze_ref_tokens
from talleyrand.features.research.suggestions import MAX_SUGGESTIONS as FOLLOWUP_CAP
from talleyrand.features.research.suggestions import get_research_suggestions
from talleyrand.infra.db import get_db

logger = logging.getLogger(__name__)

# How many of a user's background answers may generate at once; the rest queue.
# Not configurable: each running generation holds its own copy of the case and
# ships it to the provider, so this number sets the instance's peak memory as
# much as it sets throughput.
BACKGROUND_CONCURRENCY = 3
EMPTY_ANSWER_ERROR = "The model returned an empty answer."
STREAM_STALLED_ERROR = "The model stopped responding. Please retry."


@dataclass
class AnswerParams:
    openai_api_key: str
    anthropic_api_key: str
    web_search_enabled: bool
    verbosity: Literal["low", "medium"]
    # "Summarize parents": condense the thread above this question into a cheat
    # sheet alongside the answer. Runs as its own job, in parallel with the
    # answer — the sheet describes the thread above, not the answer being written.
    cheat_sheet: bool


@dataclass
class SuggestionParams:
    openai_api_key: str
    request_more: bool


@dataclass
class CheatSheetParams:
    openai_api_key: str


@dataclass
class RuntimeJob:
    record: GenerationJobRecord
    background: bool
    answer_params: AnswerParams | None = None
    suggestion_params: SuggestionParams | None = None
    cheat_sheet_params: CheatSheetParams | None = None
    chunks: list[str] = field(default_factory=list)
    pending: str = ""
    task: asyncio.Task | None = None

    @property
    def streamed_text(self) -> str:
        return "".join(self.chunks)


class JobChannel:
    """One client view of a graph's jobs: an event queue drained by a WS handler."""

    def __init__(self) -> None:
        self.events: asyncio.Queue[dict] = asyncio.Queue()

    def push(self, event: dict) -> None:
        self.events.put_nowait(event)


def _snapshot_event(job: RuntimeJob) -> dict:
    return {
        "type": "snapshot",
        "jobId": job.record.id,
        "nodeId": job.record.node_id,
        "status": job.record.status,
        "text": job.streamed_text,
    }


def _cheat_sheet_event(
    record: GenerationJobRecord, status: Literal["running", "done", "error"], data: str | None
) -> dict:
    """One event type carries a cheat sheet's whole life: the client shows the
    thread's folded row as preparing, filled, or (on error) as the plain thread."""
    return {
        "type": "cheat_sheet",
        "jobId": record.id,
        "nodeId": record.node_id,
        "status": status,
        "data": data,
    }


def record_event(record: GenerationJobRecord, live_job_ids: set[str]) -> dict | None:
    """
    A stored record's state as a stream event, for replay on attach. Records
    with a live runtime are covered by snapshots and live broadcasts; terminal
    (and interrupted) ones replay as the same events a live job would emit.
    """
    if record.id in live_job_ids:
        return None
    if record.kind == "cheat_sheet":
        if record.status == "done":
            return _cheat_sheet_event(record, "done", record.cheat_sheet)
        # Failed or killed by a restart. Replayed so a view that reconnects
        # while waiting stops waiting; the record retires on the next save.
        return _cheat_sheet_event(
            record, "error", effective_error(record, live_job_ids) or "Generation failed."
        )
    if record.kind == "answer" and record.status == "done":
        return {
            "type": "done",
            "jobId": record.id,
            "nodeId": record.node_id,
            "answer": record.answer,
            "answeredAt": record.answered_at.isoformat() if record.answered_at else None,
            "sources": [s.model_dump(mode="json", by_alias=True) for s in record.sources],
            "sourcesFound": record.sources_found,
        }
    if record.kind != "answer" and record.status == "done":
        return {
            "type": "suggestions",
            "jobId": record.id,
            "data": [s.model_dump(mode="json", by_alias=True) for s in record.suggestions],
        }
    return {
        "type": "job_error",
        "jobId": record.id,
        "kind": record.kind,
        "nodeId": record.node_id,
        "data": effective_error(record, live_job_ids) or "Generation failed.",
    }


class GenerationJobManager:
    """Process-global registry, queue and event hub for generation jobs."""

    def __init__(self) -> None:
        self.jobs: dict[str, RuntimeJob] = {}
        self.answer_job_by_node: dict[tuple[str, str], str] = {}
        self.channels: dict[str, set[JobChannel]] = {}
        self.user_queues: dict[str, deque[str]] = {}
        self._shutting_down = False

    # --- introspection -----------------------------------------------------

    def live_job_ids(self) -> set[str]:
        return set(self.jobs.keys())

    def _job_repo(self) -> GenerationJobRepository:
        return GenerationJobRepository(get_db())

    def _graph_repo(self) -> GraphDataRepository:
        return GraphDataRepository(get_db())

    # --- channels ----------------------------------------------------------

    def attach(self, graph_id: str, channel: JobChannel) -> None:
        """Subscribe a view. Snapshot + subscribe are one synchronous block."""
        for job in self.jobs.values():
            if job.record.graph_id != graph_id:
                continue
            if job.record.kind == "answer":
                channel.push(_snapshot_event(job))
            elif job.record.kind == "cheat_sheet":
                channel.push(_cheat_sheet_event(job.record, "running", None))
        self.channels.setdefault(graph_id, set()).add(channel)

    def detach(self, graph_id: str, channel: JobChannel) -> None:
        graph_channels = self.channels.get(graph_id)
        if graph_channels is not None:
            graph_channels.discard(channel)
            if not graph_channels:
                del self.channels[graph_id]

    def _broadcast(self, graph_id: str, event: dict) -> None:
        for channel in self.channels.get(graph_id, ()):
            channel.push(event)

    # --- answer jobs ---------------------------------------------------------

    async def start_answer_job(
        self,
        *,
        graph_id: str,
        user_id: str,
        node_id: str,
        background: bool,
        params: AnswerParams,
        existing_records: list[GenerationJobRecord],
        force: bool = False,
    ) -> GenerationJobRecord:
        """
        Start (or queue) an answer generation. Idempotent: a live job or an
        unincorporated completed answer for the node is returned as-is; only
        error records are replaced. The guard and registry insertion happen
        synchronously (no await), so concurrent starts can't double-run a node.

        `force` retries a node whose generation appears frozen: the live (stuck)
        job is cancelled and dropped so a fresh one replaces it, rather than
        returning it. Its stored record is then replaced like an error record.
        """
        live_id = self.answer_job_by_node.get((graph_id, node_id))
        if live_id is not None:
            if not force:
                return self.jobs[live_id].record
            self._abandon_job(live_id)

        stale_error_ids: list[str] = []
        for record in existing_records:
            if record.kind != "answer" or record.node_id != node_id:
                continue
            if record.status == "done":
                return record
            stale_error_ids.append(record.id)  # error or interrupted: being replaced

        record = new_answer_record(graph_id, user_id, node_id)
        job = RuntimeJob(record=record, background=background, answer_params=params)
        self.jobs[record.id] = job
        self.answer_job_by_node[(graph_id, node_id)] = record.id

        repo = self._job_repo()
        try:
            deleted = await repo.delete_unless_done(stale_error_ids)
            if deleted < len(stale_error_ids):
                # A record completed between the caller's fetch and this point:
                # its answer wins, the new job stands down.
                for stale in await repo.get_for_graph(graph_id):
                    if (
                        stale.kind == "answer"
                        and stale.node_id == node_id
                        and stale.status == "done"
                    ):
                        self._remove_job(record.id)
                        return stale
            await repo.insert(record)
        except Exception:
            self._remove_job(record.id)
            raise

        if background and self._running_background_count(user_id) >= BACKGROUND_CONCURRENCY:
            self.user_queues.setdefault(user_id, deque()).append(record.id)
        else:
            self._spawn_answer(job)
        return record

    def _running_background_count(self, user_id: str) -> int:
        return sum(
            1
            for job in self.jobs.values()
            if job.record.user_id == user_id
            and job.record.kind == "answer"
            and job.record.status == "running"
            and job.background
        )

    def _spawn_answer(self, job: RuntimeJob) -> None:
        job.record.status = "running"
        self._broadcast(
            job.record.graph_id,
            {"type": "started", "jobId": job.record.id, "nodeId": job.record.node_id},
        )
        job.task = asyncio.create_task(self._run_answer(job))

    def _pump(self, user_id: str) -> None:
        if self._shutting_down:
            return
        queue = self.user_queues.get(user_id)
        while queue and self._running_background_count(user_id) < BACKGROUND_CONCURRENCY:
            job_id = queue.popleft()
            job = self.jobs.get(job_id)
            if job is None:
                continue
            self._spawn_answer(job)
        if queue is not None and not queue:
            del self.user_queues[user_id]

    async def _run_answer(self, job: RuntimeJob) -> None:
        record = job.record
        graph_id, node_id = record.graph_id, record.node_id or ""
        params = job.answer_params
        assert params is not None
        repo = self._job_repo()

        def flush() -> None:
            # Append + broadcast without an await in between: snapshots stay exact
            if not job.pending:
                return
            chunk, job.pending = job.pending, ""
            job.chunks.append(chunk)
            self._broadcast(
                graph_id,
                {
                    "type": "delta",
                    "jobId": record.id,
                    "nodeId": node_id,
                    "data": chunk,
                },
            )

        try:
            if not await repo.set_running(record.id):
                return  # pruned before it started (node deleted)

            graph = await self.load_effective_graph(record.user_id, graph_id)
            if graph is None:
                await repo.delete(record.id)
                return

            # The cheat sheet condenses the thread ABOVE this question, so it
            # neither waits for nor depends on the answer below: start it here,
            # in parallel, and it is usually ready before the answer finishes.
            # Started from the running answer (not from the queued one) so a
            # background burst can't run cheat sheets ahead of the answers.
            if params.cheat_sheet and has_thread_to_summarize(graph, node_id):
                await self.start_cheat_sheet_job(
                    graph_id=graph_id,
                    user_id=record.user_id,
                    node_id=node_id,
                    params=CheatSheetParams(openai_api_key=params.openai_api_key),
                )

            stream = await do_research_query(
                node_id=node_id,
                graph=graph,
                openai_api_key=params.openai_api_key,
                anthropic_api_key=params.anthropic_api_key,
                web_search_enabled=params.web_search_enabled,
                verbosity=params.verbosity,
            )

            # Bound the wait for each token, resetting on every one: a provider
            # stream that goes silent (a hung web-search/tool call that never
            # emits a terminal frame) would otherwise keep the read alive on
            # keepalive bytes and freeze the job in "running" forever. wait_for
            # isolates the timeout in a child task, so an _abandon_job cancel of
            # this task still surfaces as a plain CancelledError below.
            # Text reaches the reader as it arrives; the sources its searches
            # turn up are collected and delivered once, with the finished
            # answer, since nothing shows them until the answer is complete.
            sources = WebSourceCollector()
            try:
                while True:
                    try:
                        chunk = await asyncio.wait_for(
                            stream.__anext__(), timeout=settings.stream_idle_timeout_seconds
                        )
                    except StopAsyncIteration:
                        break
                    if isinstance(chunk, SourceChunk):
                        sources.add(chunk.source)
                        continue
                    job.pending += chunk.text
                    if len(job.pending) >= settings.query_chunk_size:
                        flush()
            except TimeoutError as e:
                raise TimeoutError(STREAM_STALLED_ERROR) from e
            finally:
                await stream.aclose()
            flush()

            answer = job.streamed_text
            if not answer:
                raise ValueError(EMPTY_ANSWER_ERROR)

            # The model wrote outline-number refs against the tree snapshot it
            # was shown; persist them as node ids so later tree edits can't
            # silently re-target them.
            tree = build_question_tree(graph)
            answer = freeze_ref_tokens(
                answer, {outline: nid for nid, outline in tree.outline.items()}
            )

            answered_at = datetime.now(UTC)
            collected = [
                WebSourceDTO(
                    url=source.url,
                    title=source.title,
                    page_age=source.page_age,
                    cited=source.cited,
                )
                for source in sources.collected()
            ]
            found = sources.found_count()
            if await repo.complete_answer(record.id, answer, answered_at, collected, found):
                record.status = "done"
                self._broadcast(
                    graph_id,
                    {
                        "type": "done",
                        "jobId": record.id,
                        "nodeId": node_id,
                        "answer": answer,
                        "answeredAt": answered_at.isoformat(),
                        "sources": [s.model_dump(mode="json", by_alias=True) for s in collected],
                        "sourcesFound": found,
                    },
                )
        except asyncio.CancelledError:
            pass  # cancelled by a save that pruned the node; record already deleted
        except Exception as e:
            message = provider_error_detail(e) or str(e) or "Generation failed."
            logger.exception("Answer job %s failed", record.id)
            if await repo.fail(record.id, message):
                record.status = "error"
                self._broadcast(
                    graph_id,
                    {
                        "type": "job_error",
                        "jobId": record.id,
                        "kind": "answer",
                        "nodeId": node_id,
                        "data": message,
                    },
                )
        finally:
            self._remove_job(record.id)
            self._pump(record.user_id)

    # --- suggestion jobs -----------------------------------------------------

    async def start_suggestion_job(
        self,
        *,
        graph_id: str,
        user_id: str,
        node_id: str | None,
        kind: Literal["suggestions", "big_picture"],
        params: SuggestionParams,
    ) -> GenerationJobRecord:
        """Start a suggestion generation; the task spawns once the record is persisted."""
        record = new_suggestion_record(graph_id, user_id, node_id, kind)
        job = RuntimeJob(record=record, background=True, suggestion_params=params)
        self.jobs[record.id] = job
        try:
            await self._job_repo().insert(record)
        except Exception:
            self._remove_job(record.id)
            raise
        job.task = asyncio.create_task(self._run_suggestions(job))
        return record

    async def _run_suggestions(self, job: RuntimeJob) -> None:
        record = job.record
        params = job.suggestion_params
        assert params is not None
        repo = self._job_repo()

        try:
            graph = await self.load_effective_graph(record.user_id, record.graph_id)
            if graph is None:
                await repo.delete(record.id)
                return

            if record.kind == "big_picture":
                # Answer jobs that errored mark "failed" questions; the suggester
                # leaves those threads alone (it derives resolved threads itself).
                failed_node_ids = {
                    r.node_id
                    for r in await repo.get_for_graph(record.graph_id)
                    if r.kind == "answer" and r.status == "error" and r.node_id is not None
                }
                placed = await get_big_picture_suggestions(
                    graph, params.openai_api_key, failed_node_ids=failed_node_ids
                )
                questions = [(str(q.parent_node_id), q.question) for q in placed]
                cap, big_picture = BIG_PICTURE_CAP, True
            else:
                parsed = await get_research_suggestions(
                    graph, UUID(record.node_id or ""), params.request_more, params.openai_api_key
                )
                questions = [(record.node_id or "", text) for text in parsed.questions]
                cap, big_picture = FOLLOWUP_CAP, False

            suggestions = assemble_suggestions(
                graph_like(
                    graph.nodes, graph.node_contents, graph.suggestions, graph.declined_questions
                ),
                questions,
                big_picture=big_picture,
                cap=cap,
                created_at=datetime.now(UTC),
                make_id=lambda: str(uuid4()),
            )

            if await repo.complete_suggestions(record.id, suggestions):
                record.status = "done"
                self._broadcast(
                    record.graph_id,
                    {
                        "type": "suggestions",
                        "jobId": record.id,
                        "data": [s.model_dump(mode="json", by_alias=True) for s in suggestions],
                    },
                )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            message = provider_error_detail(e) or str(e) or "Suggestion generation failed."
            logger.exception("Suggestion job %s failed", record.id)
            if await repo.fail(record.id, message):
                record.status = "error"
                self._broadcast(
                    record.graph_id,
                    {
                        "type": "job_error",
                        "jobId": record.id,
                        "kind": record.kind,
                        "nodeId": record.node_id,
                        "data": message,
                    },
                )
        finally:
            self._remove_job(record.id)

    # --- cheat-sheet jobs ----------------------------------------------------

    async def start_cheat_sheet_job(
        self, *, graph_id: str, user_id: str, node_id: str, params: CheatSheetParams
    ) -> GenerationJobRecord:
        """Start a cheat-sheet generation for a question; the task spawns once
        the record is persisted. Unlike answers this is not deduplicated per
        node: a second run is a deliberate refresh and its result supersedes."""
        record = new_cheat_sheet_record(graph_id, user_id, node_id)
        job = RuntimeJob(record=record, background=True, cheat_sheet_params=params)
        self.jobs[record.id] = job
        try:
            await self._job_repo().insert(record)
        except Exception:
            self._remove_job(record.id)
            raise
        self._broadcast(graph_id, _cheat_sheet_event(record, "running", None))
        job.task = asyncio.create_task(self._run_cheat_sheet(job))
        return record

    async def _run_cheat_sheet(self, job: RuntimeJob) -> None:
        record = job.record
        params = job.cheat_sheet_params
        assert params is not None
        repo = self._job_repo()

        try:
            graph = await self.load_effective_graph(record.user_id, record.graph_id)
            if graph is None:
                await repo.delete(record.id)
                return
            if not has_thread_to_summarize(graph, record.node_id or ""):
                # The question (or the thread above it) went away while this
                # job waited: there is nothing to condense, and no failure.
                await repo.delete(record.id)
                self._broadcast(
                    record.graph_id,
                    _cheat_sheet_event(
                        record, "error", "There is nothing above this question to condense."
                    ),
                )
                return

            markdown = await generate_cheat_sheet(
                graph, record.node_id or "", params.openai_api_key
            )
            # The model cites source questions by outline number against the
            # tree it was shown; persist them as node ids, like answers, so
            # later tree edits can't silently re-target a link.
            tree = build_question_tree(graph)
            markdown = freeze_ref_tokens(
                markdown, {outline: nid for nid, outline in tree.outline.items()}
            )

            if await repo.complete_cheat_sheet(record.id, markdown):
                record.status = "done"
                self._broadcast(record.graph_id, _cheat_sheet_event(record, "done", markdown))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            message = provider_error_detail(e) or str(e) or "Cheat sheet generation failed."
            logger.exception("Cheat sheet job %s failed", record.id)
            if await repo.fail(record.id, message):
                record.status = "error"
                self._broadcast(record.graph_id, _cheat_sheet_event(record, "error", message))
        finally:
            self._remove_job(record.id)

    # --- shared --------------------------------------------------------------

    async def load_effective_graph(self, user_id: str, graph_id: str) -> GraphNoId | None:
        """
        The graph as the doc + unacked job results — what any read would see.
        Records are read BEFORE the doc: a save writes the doc first and then
        retires records, so a record retired between the two reads implies the
        doc read afterwards already contains its result.
        """
        records = await self._job_repo().get_for_graph(graph_id)
        result = await self._graph_repo().get_by_id(user_id, graph_id)
        if result is None:
            return None
        _, doc = result
        apply_read_overlay(
            graph_like(doc.nodes, doc.node_contents, doc.suggestions, doc.declined_questions),
            records,
            self.live_job_ids(),
        )
        return _to_graph_no_id(doc)

    def _remove_job(self, job_id: str) -> None:
        job = self.jobs.pop(job_id, None)
        if job is None:
            return
        if job.record.kind == "answer":
            key = (job.record.graph_id, job.record.node_id or "")
            if self.answer_job_by_node.get(key) == job_id:
                del self.answer_job_by_node[key]
        queue = self.user_queues.get(job.record.user_id)
        if queue and job_id in queue:
            queue.remove(job_id)

    def _drop_and_release(self, job_id: str) -> None:
        """
        Cancel a job's task (if any) and drop it from the registry NOW, then
        offer its freed slot to the queue. We remove and pump synchronously
        instead of trusting the task's finally: a task cancelled before its
        first step never enters its try block, so its _remove_job + _pump never
        run — that would leak the concurrency slot and strand queued jobs. A
        task cancelled mid-run re-runs both harmlessly (both are idempotent).
        """
        job = self.jobs.get(job_id)
        if job is None:
            return
        user_id = job.record.user_id
        if job.task is not None:
            job.task.cancel()
        self._remove_job(job_id)
        self._pump(user_id)

    def _abandon_job(self, job_id: str) -> None:
        """
        Drop a live job and free its node so a forced retry can replace a frozen
        generation. Cancellation interrupts the stuck await and never writes a
        terminal result for the abandoned record.
        """
        self._drop_and_release(job_id)

    def cancel_jobs(self, job_ids: list[str]) -> None:
        """Cancel runtime tasks and free their slots (used when a save pruned their records)."""
        for job_id in job_ids:
            self._drop_and_release(job_id)

    async def shutdown(self) -> None:
        self._shutting_down = True
        self.user_queues.clear()
        tasks = [job.task for job in self.jobs.values() if job.task is not None]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self.jobs.clear()
        self.answer_job_by_node.clear()


def _to_graph_no_id(doc: GraphDocument) -> GraphNoId:
    return GraphNoId(
        nodes=doc.nodes,
        edges=doc.edges,
        node_contents=doc.node_contents,
        brief=doc.brief,
        case_documents=doc.case_documents,
        suggestions=doc.suggestions,
        declined_questions=doc.declined_questions,
        read_history=doc.read_history,
    )


manager = GenerationJobManager()
