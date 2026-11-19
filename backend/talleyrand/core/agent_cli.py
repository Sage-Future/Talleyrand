"""
Running a signed-in agent CLI (Claude Code, Hermes) as one model call.

Shared by core/claude_code.py and core/hermes.py. Each call is one process
that runs on the operator's own subscription instead of an API key. What every
backend gets from here:

- the prompt over stdin, never through a shell;
- a fixed empty working directory, so no project context attaches;
- an environment of a handful of variables, never the server's own: an
  inherited ANTHROPIC_API_KEY or OPENAI_API_KEY would silently bill the run to
  an API instead of the subscription;
- one concurrency cap across backends, since calls share a usage window;
- output read as it is printed, so a backend can kill a run at the first
  event that shows it is not what it should be (API-key auth, tools). This
  is a fast stop, not a guarantee: the CLI does not wait for the check, so
  whatever it does in the millisecond or two before the kill still happens.
  What a run is allowed to do is decided by the flags and environment it
  starts with;
- a timeout, and on timeout, refusal or cancellation (a deleted question, a
  forced retry, shutdown) the whole process group killed before the error
  propagates. Groups still alive when the server exits without its orderly
  shutdown (a second Ctrl-C) are killed by an exit hook.
"""

import asyncio
import atexit
import contextlib
import json
import os
import signal
from collections.abc import Callable
from pathlib import Path
from typing import Any

from talleyrand.core.config import settings

# Empty on purpose: nothing in it may attach to a run.
CWD = Path.home() / ".local" / "share" / "talleyrand" / "agent-cwd"

ENV_ALLOWLIST = ("PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR")

KILL_GRACE_SECONDS = 5.0

# A whole answer arrives as one JSON line; asyncio's default line limit is 64 KiB.
LINE_LIMIT = 64 * 1024 * 1024

_slots = asyncio.Semaphore(settings.agent_concurrency)

# Process groups of runs in flight, for the exit hook below.
_live_groups: set[int] = set()


class AgentError(Exception):
    """An agent CLI call failed; str(exc) is a user-facing message."""

    label = "Agent"
    setup_hint = ""


async def run_cli(
    args: list[str],
    prompt: str,
    *,
    error: type[AgentError],
    env: dict[str, str] | None = None,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[list[dict[str, Any]], bytes, int | None]:
    """
    Run one CLI call to completion; returns (stdout's JSON events, stderr, exit
    code). on_event sees each event as it is printed and may raise `error` to
    stop the run right there.
    """
    CWD.mkdir(parents=True, exist_ok=True)
    child_env = {name: os.environ[name] for name in ENV_ALLOWLIST if name in os.environ}
    child_env |= env or {}

    async with _slots:
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=CWD,
                env=child_env,
                start_new_session=True,
                limit=LINE_LIMIT,
            )
        except FileNotFoundError as e:
            raise error(f"`{args[0]}` was not found. {error.setup_hint}") from e
        _live_groups.add(proc.pid)
        try:
            async with asyncio.timeout(settings.agent_timeout_seconds):
                events, stderr = await _read(proc, prompt, on_event)
        except TimeoutError as e:
            await _kill(proc)
            raise error(
                f"{error.label} did not finish within {settings.agent_timeout_seconds:.0f} seconds."
            ) from e
        except AgentError:
            # A refused run gets no chance to finish what it started.
            await _kill(proc, grace=0)
            raise
        except BaseException:
            await _kill(proc)
            raise
        finally:
            _live_groups.discard(proc.pid)
    return events, stderr, proc.returncode


async def _read(
    proc: asyncio.subprocess.Process,
    prompt: str,
    on_event: Callable[[dict[str, Any]], None] | None,
) -> tuple[list[dict[str, Any]], bytes]:
    """Feed the prompt and collect stdout's JSON events as they arrive."""
    assert proc.stdin and proc.stdout and proc.stderr

    async def feed() -> None:
        # A CLI that exits early (bad flags, refused auth) stops reading stdin.
        try:
            with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                proc.stdin.write(prompt.encode())
                await proc.stdin.drain()
        finally:
            proc.stdin.close()

    feeding = asyncio.create_task(feed())
    stderr = asyncio.create_task(proc.stderr.read())
    try:
        events = []
        async for line in proc.stdout:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue  # stdout carries the odd non-JSON line
            if isinstance(event, dict):
                events.append(event)
                if on_event is not None:
                    on_event(event)
        await feeding
        await proc.wait()
        return events, await stderr
    finally:
        feeding.cancel()
        stderr.cancel()


def stderr_tail(stderr: bytes, returncode: int | None) -> str:
    return stderr.decode(errors="replace").strip()[-500:] or f"exit code {returncode}"


async def _kill(proc: asyncio.subprocess.Process, grace: float = KILL_GRACE_SECONDS) -> None:
    """Terminate the run's process group, escalating to SIGKILL, and reap it."""
    try:
        if grace > 0:
            os.killpg(proc.pid, signal.SIGTERM)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(proc.wait(), grace)
        # Whatever is still in the group: a stuck CLI, or a child it left behind.
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    await proc.wait()


@atexit.register
def _kill_live_groups() -> None:
    """Kill every run still in flight; the server is exiting without them."""
    for pgid in list(_live_groups):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(pgid, signal.SIGKILL)
