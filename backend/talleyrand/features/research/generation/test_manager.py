"""
Tests for the generation manager's runtime registry — abandoning a live job
(what lets a forced retry replace a frozen generation), freeing the slot of a
task cancelled before it runs, failing a stalled stream instead of hanging,
and letting go of the case once its answer is streaming.
"""

import asyncio
import gc
import weakref
from collections import deque
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from talleyrand.core.config import settings
from talleyrand.core.llm import SourceChunk, TextChunk, WebSource
from talleyrand.features.research.generation import manager as manager_module
from talleyrand.features.research.generation.manager import (
    BACKGROUND_CONCURRENCY,
    STREAM_STALLED_ERROR,
    AnswerParams,
    GenerationJobManager,
    JobChannel,
    RuntimeJob,
)
from talleyrand.features.research.generation.records import new_answer_record


@pytest.mark.asyncio
async def test_abandon_running_job_cancels_task_and_frees_node():
    mgr = GenerationJobManager()
    record = new_answer_record("g1", "u1", "n1")

    async def _never() -> None:
        await asyncio.sleep(3600)

    task = asyncio.create_task(_never())
    mgr.jobs[record.id] = RuntimeJob(record=record, background=False, task=task)
    mgr.answer_job_by_node[("g1", "n1")] = record.id

    mgr._abandon_job(record.id)

    # The node is freed synchronously so a fresh job can take its place.
    assert record.id not in mgr.jobs
    assert ("g1", "n1") not in mgr.answer_job_by_node

    # The stuck task is cancelled (it unwinds on the next loop turn).
    with pytest.raises(asyncio.CancelledError):
        await task
    assert task.cancelled()


def test_abandon_queued_job_removes_from_queue():
    mgr = GenerationJobManager()
    record = new_answer_record("g1", "u1", "n1")
    # Queued: registered and waiting for a slot, no task spawned yet.
    mgr.jobs[record.id] = RuntimeJob(record=record, background=True, task=None)
    mgr.answer_job_by_node[("g1", "n1")] = record.id
    mgr.user_queues["u1"] = deque([record.id])

    mgr._abandon_job(record.id)

    assert record.id not in mgr.jobs
    assert ("g1", "n1") not in mgr.answer_job_by_node
    # The freed slot is offered back to the queue, which drops the now-empty deque.
    assert record.id not in mgr.user_queues.get("u1", deque())


def test_abandon_unknown_job_is_noop():
    mgr = GenerationJobManager()
    mgr._abandon_job("does-not-exist")  # must not raise


@pytest.mark.asyncio
async def test_cancel_jobs_frees_task_cancelled_before_first_step():
    """
    A task cancelled before its coroutine runs its first step never enters its
    try block, so its finally (which removes the job and pumps the queue) never
    runs. cancel_jobs must free the registry itself, or the concurrency slot
    leaks and queued siblings strand forever.
    """
    mgr = GenerationJobManager()
    record = new_answer_record("g1", "u1", "n1")
    ran_finally = False

    async def _body() -> None:
        nonlocal ran_finally
        try:
            await asyncio.sleep(3600)
        finally:
            ran_finally = True

    task = asyncio.create_task(_body())
    mgr.jobs[record.id] = RuntimeJob(record=record, background=True, task=task)
    mgr.answer_job_by_node[("g1", "n1")] = record.id

    # Cancel before the task ever runs a step (no await happened in between).
    mgr.cancel_jobs([record.id])

    assert record.id not in mgr.jobs
    assert ("g1", "n1") not in mgr.answer_job_by_node

    with pytest.raises(asyncio.CancelledError):
        await task
    assert not ran_finally  # the finally genuinely never ran — yet the slot is freed


@pytest.mark.asyncio
async def test_stalled_stream_fails_job_instead_of_hanging(monkeypatch):
    """A provider stream that goes silent must fail the job, not freeze it forever."""
    monkeypatch.setattr(settings, "stream_idle_timeout_seconds", 0.05)

    mgr = GenerationJobManager()
    record = new_answer_record("g1", "u1", "n1")
    params = AnswerParams(
        openai_api_key="k",
        anthropic_api_key="",
        web_search_enabled=False,
        verbosity="low",
        cheat_sheet=False,
    )
    job = RuntimeJob(record=record, background=True, answer_params=params)
    mgr.jobs[record.id] = job
    mgr.answer_job_by_node[("g1", "n1")] = record.id

    repo = AsyncMock()
    repo.set_running.return_value = True
    repo.fail.return_value = True
    monkeypatch.setattr(mgr, "_job_repo", lambda: repo)
    monkeypatch.setattr(mgr, "load_effective_graph", AsyncMock(return_value=object()))
    monkeypatch.setattr(
        manager_module, "build_question_tree", lambda _graph: SimpleNamespace(outline={})
    )

    stream_closed = False

    async def _hanging_stream():
        nonlocal stream_closed
        try:
            await asyncio.sleep(3600)
            yield ""  # never reached
        finally:
            stream_closed = True

    async def _fake_query(**_kwargs):
        return _hanging_stream()

    monkeypatch.setattr(manager_module, "do_research_query", _fake_query)

    # Must return promptly via the watchdog rather than hang on the dead stream.
    await asyncio.wait_for(mgr._run_answer(job), timeout=5)

    assert record.status == "error"
    repo.fail.assert_awaited_once()
    assert repo.fail.await_args.args[1] == STREAM_STALLED_ERROR
    assert stream_closed  # the stalled stream was closed, releasing its connection
    assert record.id not in mgr.jobs  # finally ran: the slot is freed


@pytest.mark.asyncio
async def test_completed_answer_carries_every_source_its_searches_found(monkeypatch):
    """
    A finished answer reports the pages behind it — the ones it cites and the
    ones it merely looked at — without any of them leaking into the text.
    """
    mgr = GenerationJobManager()
    record = new_answer_record("g1", "u1", "n1")
    params = AnswerParams(
        openai_api_key="k",
        anthropic_api_key="",
        web_search_enabled=True,
        verbosity="low",
        cheat_sheet=False,
    )
    job = RuntimeJob(record=record, background=False, answer_params=params)
    mgr.jobs[record.id] = job
    mgr.answer_job_by_node[("g1", "n1")] = record.id

    repo = AsyncMock()
    repo.set_running.return_value = True
    repo.complete_answer.return_value = True
    monkeypatch.setattr(mgr, "_job_repo", lambda: repo)
    monkeypatch.setattr(mgr, "load_effective_graph", AsyncMock(return_value=object()))
    monkeypatch.setattr(
        manager_module, "build_question_tree", lambda _graph: SimpleNamespace(outline={})
    )

    async def _stream():
        yield SourceChunk(
            WebSource(url="https://iea.org/report", title="IEA", page_age="April 3, 2025")
        )
        yield SourceChunk(WebSource(url="https://blog.example/x"))
        yield TextChunk("EV sales grew 35%.")
        yield SourceChunk(WebSource(url="https://iea.org/report", cited=True))

    async def _fake_query(**_kwargs):
        return _stream()

    monkeypatch.setattr(manager_module, "do_research_query", _fake_query)

    channel = JobChannel()
    mgr.attach("g1", channel)
    await mgr._run_answer(job)

    answer = repo.complete_answer.await_args.args[1]
    sources = repo.complete_answer.await_args.args[3]
    assert answer == "EV sales grew 35%."
    assert repo.complete_answer.await_args.args[4] == 2  # two distinct pages
    # The cited page sorts first and keeps the page age the search reported,
    # even though the citation itself carried neither title nor age.
    assert [(s.url, s.title, s.page_age, s.cited) for s in sources] == [
        ("https://iea.org/report", "IEA", "April 3, 2025", True),
        ("https://blog.example/x", None, None, False),
    ]

    done = [e for e in _drain(channel) if e["type"] == "done"]
    assert len(done) == 1
    assert [s["url"] for s in done[0]["sources"]] == [
        "https://iea.org/report",
        "https://blog.example/x",
    ]
    assert done[0]["sourcesFound"] == 2


def _drain(channel: JobChannel) -> list[dict]:
    events = []
    while not channel.events.empty():
        events.append(channel.events.get_nowait())
    return events


@pytest.mark.asyncio
async def test_case_is_released_once_the_answer_streams(monkeypatch):
    """
    Every running answer loads its own copy of the case, documents and PDFs
    included. Once its request is on its way nothing reads that copy again, so
    it must be gone while the answer streams — not held until the job ends.
    """
    mgr = GenerationJobManager()
    record = new_answer_record("g1", "u1", "n1")
    params = AnswerParams(
        openai_api_key="k",
        anthropic_api_key="",
        web_search_enabled=False,
        verbosity="low",
        cheat_sheet=False,
    )
    job = RuntimeJob(record=record, background=False, answer_params=params)
    mgr.jobs[record.id] = job
    mgr.answer_job_by_node[("g1", "n1")] = record.id

    repo = AsyncMock()
    repo.set_running.return_value = True
    repo.complete_answer.return_value = True
    monkeypatch.setattr(mgr, "_job_repo", lambda: repo)

    class _Case:
        """Stands in for the loaded case; watched for collection, never retained here."""

    watched: list[weakref.ref] = []

    async def _load(*_args, **_kwargs) -> _Case:
        case = _Case()
        watched.append(weakref.ref(case))
        return case

    monkeypatch.setattr(mgr, "load_effective_graph", _load)
    monkeypatch.setattr(
        manager_module, "build_question_tree", lambda _graph: SimpleNamespace(outline={})
    )

    released_before_first_chunk: bool | None = None

    async def _stream():
        nonlocal released_before_first_chunk
        gc.collect()
        released_before_first_chunk = watched[0]() is None
        yield TextChunk("The answer.")

    async def _fake_query(**_kwargs):
        return _stream()

    monkeypatch.setattr(manager_module, "do_research_query", _fake_query)

    await mgr._run_answer(job)

    assert released_before_first_chunk is True
    assert record.status == "done"
    assert repo.complete_answer.await_args.args[1] == "The answer."


@pytest.mark.asyncio
async def test_background_answers_beyond_the_cap_wait_their_turn(monkeypatch):
    """
    The cap is what bounds the instance's peak memory: every generation loads
    its own copy of the case to build and send its request. Nothing may raise
    it — there is no per-user limit any more, only this constant.
    """
    mgr = GenerationJobManager()

    repo = AsyncMock()
    repo.delete_unless_done.return_value = 0
    monkeypatch.setattr(mgr, "_job_repo", lambda: repo)
    # Spawning would start a real generation; only the queueing decision is under test.
    spawned: list[str] = []
    monkeypatch.setattr(
        mgr,
        "_spawn_answer",
        lambda job: (spawned.append(job.record.id), setattr(job.record, "status", "running")),
    )

    params = AnswerParams(
        openai_api_key="k",
        anthropic_api_key="",
        web_search_enabled=False,
        verbosity="low",
        cheat_sheet=False,
    )
    records = [
        await mgr.start_answer_job(
            graph_id="g1",
            user_id="u1",
            node_id=f"n{index}",
            background=True,
            params=params,
            existing_records=[],
        )
        for index in range(BACKGROUND_CONCURRENCY + 2)
    ]

    assert len(spawned) == BACKGROUND_CONCURRENCY
    assert spawned == [record.id for record in records[:BACKGROUND_CONCURRENCY]]
    # The rest wait in order, holding nothing.
    assert list(mgr.user_queues["u1"]) == [record.id for record in records[BACKGROUND_CONCURRENCY:]]


@pytest.mark.asyncio
async def test_a_finished_answer_hands_its_slot_to_the_next_in_line(monkeypatch):
    mgr = GenerationJobManager()
    running = new_answer_record("g1", "u1", "n1")
    running.status = "running"
    mgr.jobs[running.id] = RuntimeJob(record=running, background=True)
    mgr.answer_job_by_node[("g1", "n1")] = running.id

    waiting = new_answer_record("g1", "u1", "n2")
    mgr.jobs[waiting.id] = RuntimeJob(record=waiting, background=True)
    mgr.user_queues["u1"] = deque([waiting.id])

    spawned: list[str] = []
    monkeypatch.setattr(mgr, "_spawn_answer", lambda job: spawned.append(job.record.id))

    mgr._remove_job(running.id)
    mgr._pump("u1")

    assert spawned == [waiting.id]
    assert "u1" not in mgr.user_queues
