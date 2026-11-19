"""
Tests for the Claude Code backend: the `claude -p` subprocess and the routing
in core/llm.py that sends a local session's model calls through it.

These run a REAL subprocess against a fake `claude` executable, because the
process handling is the part that can go wrong: the prompt must reach stdin
byte for byte, the child must never see an API key that would bill the run to
the API instead of the subscription, and a cancelled or stalled run must take
its whole process group down with it rather than leave `claude` orphaned.
The fake's output mirrors what Claude Code 2.1.280 actually prints
(`--output-format stream-json --verbose`), checked with live calls on
2026-09-23.
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import pytest
from pydantic import BaseModel

from talleyrand.core import agent_cli, claude_code
from talleyrand.core.claude_code import ClaudeCodeError
from talleyrand.core.config import settings
from talleyrand.core.llm import (
    ExecutionChunk,
    PdfAttachment,
    StructuredGenerationError,
    TextChunk,
    parse_structured,
    stream_text,
)
from talleyrand.core.model_settings import get_model_config

FAKE_CLAUDE = """#!{python}
import json, os, pathlib, signal, subprocess, sys, time

here = pathlib.Path(__file__).parent
mode = (here / "mode").read_text().strip()
args = sys.argv[1:]
prompt = sys.stdin.read()
(here / "last_call.json").write_text(json.dumps(
    {{"args": args, "prompt": prompt, "env": sorted(os.environ), "cwd": os.getcwd()}}
))

init = {{
    "type": "system",
    "subtype": "init",
    "tools": ["StructuredOutput"] if "--json-schema" in args else [],
    "mcp_servers": [],
    "apiKeySource": "none",
    "model": "claude-sonnet-5",
}}
if mode == "api_key":
    init["apiKeySource"] = "ANTHROPIC_API_KEY"
if mode == "tools":
    init["tools"] = ["Bash"]
if mode == "no_tools_field":
    del init["tools"]
if mode != "no_init":
    print(json.dumps(init), flush=True)
if mode in ("api_key", "tools"):
    # A CLI that shrugs off SIGTERM and gets on with its model call, which
    # is marked if it runs. The refusal must not wait out a grace period.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    time.sleep(2)
    (here / "billed").write_text("yes")

if mode == "hang":
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    (here / "child_pid").write_text(str(child.pid))
    time.sleep(60)
if mode == "limit":
    print(json.dumps({{
        "type": "result", "subtype": "success", "is_error": True,
        "result": "Claude AI usage limit reached",
    }}))
    sys.exit(1)
if mode == "crash":
    print("claude: something broke", file=sys.stderr)
    sys.exit(2)

result = {{"type": "result", "subtype": "success", "is_error": False, "result": "echo:" + prompt}}
if "--json-schema" in args:
    result["structured_output"] = json.loads((here / "structured").read_text())
print(json.dumps(result))
"""


class _FakeClaude:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.executable = directory / "claude"
        self.executable.write_text(FAKE_CLAUDE.format(python=sys.executable))
        self.executable.chmod(0o755)
        self.mode("ok")

    def mode(self, mode: str) -> None:
        (self.directory / "mode").write_text(mode)

    def structured(self, data: object) -> None:
        (self.directory / "structured").write_text(json.dumps(data))

    @property
    def last_call(self) -> dict:
        return json.loads((self.directory / "last_call.json").read_text())

    def child_pid(self) -> int | None:
        path = self.directory / "child_pid"
        return int(path.read_text()) if path.exists() else None


@pytest.fixture
def fake_claude(tmp_path, monkeypatch) -> _FakeClaude:
    fake = _FakeClaude(tmp_path)
    monkeypatch.setattr(settings, "agent_backend", "claude_code")
    monkeypatch.setattr(settings, "claude_code_executable", str(fake.executable))
    monkeypatch.setattr(agent_cli, "CWD", tmp_path / "cwd")
    return fake


def _is_dead(pid: int) -> bool:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        time.sleep(0.05)
    return False


# --- the subprocess ---------------------------------------------------------


@pytest.mark.asyncio
async def test_prompt_reaches_the_cli_byte_for_byte(fake_claude):
    prompt = "Why? $(rm -rf ~) `id` \"quoted\" 'single' \\ \né中 -- --tools Bash"
    result = await claude_code.run(system_prompt="sys", prompt=prompt)
    assert result["result"] == "echo:" + prompt


@pytest.mark.asyncio
async def test_the_cli_runs_with_no_tools_no_config_and_no_persistence(fake_claude):
    await claude_code.run(system_prompt="Be brief.", prompt="hi")
    args = fake_claude.last_call["args"]
    assert args[args.index("--tools") + 1] == ""
    for flag in (
        "-p",
        "--safe-mode",
        "--disable-slash-commands",
        "--strict-mcp-config",
        "--no-session-persistence",
    ):
        assert flag in args
    assert args[args.index("--permission-prompts") + 1] == "none"
    assert args[args.index("--system-prompt") + 1] == "Be brief."
    assert args[args.index("--model") + 1] == settings.claude_code_model
    assert args[args.index("--effort") + 1] == settings.claude_code_effort
    assert Path(fake_claude.last_call["cwd"]).resolve() == agent_cli.CWD.resolve()


@pytest.mark.asyncio
async def test_api_keys_in_the_server_environment_never_reach_the_cli(fake_claude, monkeypatch):
    # Either key would make `claude` bill the API instead of the subscription.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "server-secret")
    await claude_code.run(system_prompt="sys", prompt="hi")
    env = set(fake_claude.last_call["env"])
    assert not env & {"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "JWT_SECRET_KEY"}
    assert {"PATH", "HOME"} <= env


@pytest.mark.asyncio
async def test_a_run_on_an_api_key_is_killed_at_its_init_event(fake_claude):
    fake_claude.mode("api_key")
    started = time.monotonic()
    with pytest.raises(ClaudeCodeError, match="ANTHROPIC_API_KEY"):
        await claude_code.run(system_prompt="sys", prompt="hi")
    # Killed outright at the event, not after a grace period: the call it
    # would have made two seconds later never happens.
    assert time.monotonic() - started < 1.5
    await asyncio.sleep(1)
    assert not (fake_claude.directory / "billed").exists()


@pytest.mark.asyncio
async def test_a_run_that_was_given_tools_is_killed_at_its_init_event(fake_claude):
    fake_claude.mode("tools")
    with pytest.raises(ClaudeCodeError, match="Bash"):
        await claude_code.run(system_prompt="sys", prompt="hi")
    await asyncio.sleep(1)
    assert not (fake_claude.directory / "billed").exists()


@pytest.mark.asyncio
async def test_an_init_event_that_does_not_list_its_tools_is_refused(fake_claude):
    # No list is no evidence of no tools; a CLI that renames the field must
    # not slip through as tool-free.
    fake_claude.mode("no_tools_field")
    with pytest.raises(ClaudeCodeError, match="tools"):
        await claude_code.run(system_prompt="sys", prompt="hi")


@pytest.mark.asyncio
async def test_a_run_still_in_flight_is_killed_by_the_exit_hook(fake_claude):
    # A forced server exit (a second Ctrl-C) skips the orderly shutdown that
    # cancels runs; the exit hook must still take their process groups down.
    fake_claude.mode("hang")
    task = asyncio.create_task(claude_code.run(system_prompt="sys", prompt="hi"))
    for _ in range(100):
        if fake_claude.child_pid() is not None:
            break
        await asyncio.sleep(0.05)
    agent_cli._kill_live_groups()
    child = fake_claude.child_pid()
    assert child is not None
    assert _is_dead(child)
    task.cancel()
    with pytest.raises((asyncio.CancelledError, ClaudeCodeError)):
        await task
    assert agent_cli._live_groups == set()


@pytest.mark.asyncio
async def test_a_run_that_never_reports_its_setup_is_refused(fake_claude):
    # Without the init event there is no evidence the run was on the
    # subscription with no tools, so its answer is not trusted.
    fake_claude.mode("no_init")
    with pytest.raises(ClaudeCodeError, match="init"):
        await claude_code.run(system_prompt="sys", prompt="hi")


@pytest.mark.asyncio
async def test_the_clis_own_error_message_reaches_the_user(fake_claude):
    fake_claude.mode("limit")
    with pytest.raises(ClaudeCodeError, match="usage limit reached"):
        await claude_code.run(system_prompt="sys", prompt="hi")


@pytest.mark.asyncio
async def test_a_crash_without_a_result_reports_stderr(fake_claude):
    fake_claude.mode("crash")
    with pytest.raises(ClaudeCodeError, match="something broke"):
        await claude_code.run(system_prompt="sys", prompt="hi")


@pytest.mark.asyncio
async def test_a_stalled_run_is_killed_with_its_whole_process_group(fake_claude, monkeypatch):
    monkeypatch.setattr(settings, "agent_timeout_seconds", 1.0)
    fake_claude.mode("hang")
    with pytest.raises(ClaudeCodeError, match="did not finish"):
        await claude_code.run(system_prompt="sys", prompt="hi")
    child = fake_claude.child_pid()
    assert child is not None
    assert _is_dead(child)


@pytest.mark.asyncio
async def test_cancelling_a_run_kills_its_whole_process_group(fake_claude):
    fake_claude.mode("hang")
    task = asyncio.create_task(claude_code.run(system_prompt="sys", prompt="hi"))
    for _ in range(100):
        if fake_claude.child_pid() is not None:
            break
        await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    child = fake_claude.child_pid()
    assert child is not None
    assert _is_dead(child)


# --- routing in core/llm.py -------------------------------------------------


class NameSchema(BaseModel):
    name: str


@pytest.mark.asyncio
async def test_structured_calls_run_on_claude_code(fake_claude):
    fake_claude.structured({"name": "Cryo-EM build or buy"})
    parsed = await parse_structured(
        caller="test",
        system_prompt="Name the case.",
        user_content="A case about cryo-EM.",
        schema=NameSchema,
    )
    assert parsed == NameSchema(name="Cryo-EM build or buy")
    args = fake_claude.last_call["args"]
    assert json.loads(args[args.index("--json-schema") + 1]) == NameSchema.model_json_schema()


@pytest.mark.asyncio
async def test_structured_output_that_breaks_the_schema_is_an_error(fake_claude):
    fake_claude.structured({"title": "wrong field"})
    with pytest.raises(StructuredGenerationError, match="Claude Code"):
        await parse_structured(
            caller="test",
            system_prompt="Name the case.",
            user_content="A case.",
            schema=NameSchema,
        )


async def _answer(**overrides) -> list[str]:
    kwargs = {
        "caller": "test",
        "model": get_model_config("claude-code-sonnet-5-5"),
        "instructions": "Answer.",
        "cached_prefix": "BRIEF ",
        "user_prompt": "QUESTION",
        "pdf_documents": [],
        "web_search_enabled": False,
        "search_provider": "kagi",
        "verbosity": "low",
    } | overrides
    stream = await stream_text(**kwargs)
    return [chunk.text async for chunk in stream if isinstance(chunk, TextChunk)]


@pytest.mark.asyncio
async def test_an_answer_is_the_whole_prompt_answered_once(fake_claude):
    assert await _answer() == ["echo:BRIEF QUESTION"]
    args = fake_claude.last_call["args"]
    assert args[args.index("--system-prompt") + 1].startswith("Answer.")
    # The preset's model, not settings.claude_code_model (the agent's own work).
    assert args[args.index("--model") + 1] == "claude-sonnet-5-5"


@pytest.mark.asyncio
async def test_an_answer_reports_its_model_and_what_it_could_not_use(fake_claude):
    stream = await stream_text(
        caller="test",
        model=get_model_config("claude-code-sonnet-5-5"),
        instructions="Answer.",
        cached_prefix="BRIEF ",
        user_prompt="QUESTION",
        pdf_documents=[PdfAttachment(filename="paper.pdf", data_uri="data:,")],
        web_search_enabled=True,
        search_provider="kagi",
        verbosity="low",
    )
    execution, answer = [chunk async for chunk in stream]
    assert isinstance(execution, ExecutionChunk)
    assert (execution.provider, execution.model) == ("claude_code", "claude-sonnet-5")
    web, pdf = execution.notes
    assert web.startswith("Web search did not run")
    assert pdf.startswith("paper.pdf could not be read")
    # The notes stay out of the answer, which later prompts read back.
    assert answer == TextChunk("echo:BRIEF QUESTION")
