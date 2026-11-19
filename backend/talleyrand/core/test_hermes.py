"""
Tests for the Hermes backend: the `hermes chat` subprocess and the routing in
core/llm.py that sends a local session's model calls through it.

Like test_claude_code.py, these run a REAL subprocess against a fake `hermes`
whose output mirrors what Hermes 0.21.4 actually prints with
`--format stream-json` (checked with live calls on 2026-09-23). The process
handling itself (timeouts, process-group kills, the environment allowlist) is
shared with Claude Code and tested there.
"""

import asyncio
import json
import sys
from pathlib import Path

import pytest
from pydantic import BaseModel

from talleyrand.core import agent_cli, hermes
from talleyrand.core.config import settings
from talleyrand.core.hermes import HermesError
from talleyrand.core.llm import StructuredGenerationError, TextChunk, parse_structured, stream_text
from talleyrand.core.model_settings import get_model_config

# Each call answers with the next line of `replies` (the last one repeats), so
# a test can script a first reply that fails validation and a repair.
FAKE_HERMES = """#!{python}
import json, os, pathlib, signal, sys, time

here = pathlib.Path(__file__).parent
mode = (here / "mode").read_text().strip()
prompt = sys.stdin.read()
calls = here / "calls.jsonl"
with calls.open("a") as f:
    f.write(json.dumps({{
        "args": sys.argv[1:], "prompt": prompt, "env": sorted(os.environ),
        "system": os.environ.get("HERMES_EPHEMERAL_SYSTEM_PROMPT"),
    }}) + "\\n")
count = len(calls.read_text().splitlines())
replies = (here / "replies").read_text().splitlines() if (here / "replies").exists() else []
reply = replies[min(count, len(replies)) - 1] if replies else "echo:" + prompt

def emit(obj):
    print(json.dumps(obj), flush=True)

emit({{"type": "system", "subtype": "init", "model": "gpt-6-astra", "session_id": "s1"}})
if mode == "tool":
    emit({{"type": "tool_use", "name": "terminal", "input": {{"command": "ls"}}}})
    # A long tool ignoring SIGTERM: killed outright, it never marks this.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    time.sleep(2)
    (here / "tool_ran").write_text("yes")
if mode == "tool_result_only":
    # Some runtimes report a fast tool only once it has completed.
    emit({{"type": "tool_result", "name": "terminal", "output": "", "duration_ms": 1}})
if mode == "rejected":
    emit({{"type": "result", "session_id": "s1", "exit_code": 1,
           "text": "ChatGPT or Codex Subscription rejected the request.", "error": "HTTP 400"}})
    sys.exit(1)
emit({{"type": "text", "text": reply}})
emit({{"type": "result", "session_id": "s1", "exit_code": 0, "text": reply,
       "tokens": {{"input": 1, "output": 1}}}})
"""


class _FakeHermes:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.executable = directory / "hermes"
        self.executable.write_text(FAKE_HERMES.format(python=sys.executable))
        self.executable.chmod(0o755)
        self.mode("ok")

    def mode(self, mode: str) -> None:
        (self.directory / "mode").write_text(mode)

    def replies(self, *replies: str) -> None:
        (self.directory / "replies").write_text("\n".join(replies))

    @property
    def calls(self) -> list[dict]:
        path = self.directory / "calls.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


@pytest.fixture
def fake_hermes(tmp_path, monkeypatch) -> _FakeHermes:
    fake = _FakeHermes(tmp_path)
    monkeypatch.setattr(settings, "agent_backend", "hermes")
    monkeypatch.setattr(settings, "hermes_executable", str(fake.executable))
    monkeypatch.setattr(agent_cli, "CWD", tmp_path / "cwd")
    return fake


class NameSchema(BaseModel):
    name: str


# --- the subprocess ---------------------------------------------------------


@pytest.mark.asyncio
async def test_prompt_and_instructions_reach_hermes_intact(fake_hermes):
    prompt = 'Why? $(rm -rf ~) `id` "quoted" \\ \né --toolsets all'
    answer = await hermes.run(system_prompt="Be brief.", prompt=prompt)
    assert answer == "echo:" + prompt
    (call,) = fake_hermes.calls
    assert call["prompt"] == prompt
    assert call["system"] == "Be brief."


@pytest.mark.asyncio
async def test_hermes_runs_text_only_with_no_config_on_the_pinned_provider(fake_hermes):
    await hermes.run(system_prompt="sys", prompt="hi")
    args = fake_hermes.calls[0]["args"]
    # Not "": Hermes treats an empty toolset list as unset and loads its defaults.
    assert args[args.index("--toolsets") + 1] == "bot_room"
    assert "--safe-mode" in args
    assert args[args.index("--provider") + 1] == settings.hermes_provider
    assert args[args.index("--model") + 1] == settings.hermes_model
    assert args[args.index("--reasoning") + 1] == settings.hermes_reasoning
    assert args[args.index("--source") + 1] == "tool"
    assert args[args.index("--query-file") + 1] == "-"


@pytest.mark.asyncio
async def test_api_keys_in_the_server_environment_never_reach_hermes(fake_hermes, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    await hermes.run(system_prompt="sys", prompt="hi")
    env = set(fake_hermes.calls[0]["env"])
    assert not env & {"OPENAI_API_KEY", "ANTHROPIC_API_KEY"}


@pytest.mark.asyncio
async def test_a_run_that_calls_a_tool_is_killed_at_that_event(fake_hermes):
    fake_hermes.mode("tool")
    with pytest.raises(HermesError, match="terminal"):
        await hermes.run(system_prompt="sys", prompt="hi")
    await asyncio.sleep(2.5)
    assert not (fake_hermes.directory / "tool_ran").exists()


@pytest.mark.asyncio
async def test_a_tool_reported_only_once_it_finished_is_refused(fake_hermes):
    fake_hermes.mode("tool_result_only")
    with pytest.raises(HermesError, match="terminal"):
        await hermes.run(system_prompt="sys", prompt="hi")


@pytest.mark.asyncio
async def test_the_providers_own_error_message_reaches_the_user(fake_hermes):
    fake_hermes.mode("rejected")
    with pytest.raises(HermesError, match="Subscription rejected"):
        await hermes.run(system_prompt="sys", prompt="hi")


# --- structured output ------------------------------------------------------


@pytest.mark.asyncio
async def test_structured_calls_run_on_hermes_with_the_schema_in_the_instructions(fake_hermes):
    fake_hermes.replies('{"name": "Cryo-EM build or buy"}')
    parsed = await parse_structured(
        caller="test",
        system_prompt="Name the case.",
        user_content="A case about cryo-EM.",
        schema=NameSchema,
    )
    assert parsed == NameSchema(name="Cryo-EM build or buy")
    (call,) = fake_hermes.calls
    assert call["system"].startswith("Name the case.")
    assert json.dumps(NameSchema.model_json_schema()) in call["system"]


def test_a_fenced_json_reply_is_accepted():
    reply = '```json\n{"name": "Fenced"}\n```'
    assert hermes._parse(reply, NameSchema) == NameSchema(name="Fenced")


@pytest.mark.asyncio
async def test_a_reply_that_breaks_the_schema_gets_one_repair_attempt(fake_hermes):
    fake_hermes.replies('{"title": "wrong field"}', '{"name": "Repaired"}')
    parsed = await hermes.run_structured(system_prompt="sys", prompt="A case.", schema=NameSchema)
    assert parsed == NameSchema(name="Repaired")
    first, second = fake_hermes.calls
    assert second["prompt"].startswith("A case.")
    assert "did not validate" in second["prompt"]


@pytest.mark.asyncio
async def test_a_second_bad_reply_is_an_error_not_a_third_call(fake_hermes):
    fake_hermes.replies("not json at all")
    with pytest.raises(StructuredGenerationError, match="Hermes"):
        await parse_structured(
            caller="test",
            system_prompt="sys",
            user_content="A case.",
            schema=NameSchema,
        )
    assert len(fake_hermes.calls) == 2


# --- answers ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_answer_runs_on_hermes_and_says_what_it_could_not_use(fake_hermes):
    stream = await stream_text(
        caller="test",
        model=get_model_config("hermes-gpt-6-1-sol"),
        instructions="Answer.",
        cached_prefix="BRIEF ",
        user_prompt="QUESTION",
        pdf_documents=[],
        web_search_enabled=True,
        search_provider="kagi",
        verbosity="low",
    )
    execution, answer = [chunk async for chunk in stream]
    # The preset's model, not settings.hermes_model (the agent's own work).
    assert (execution.provider, execution.model) == ("hermes", "gpt-6.1-sol")
    args = fake_hermes.calls[-1]["args"]
    assert args[args.index("--model") + 1] == "gpt-6.1-sol"
    assert execution.notes[0].startswith("Web search did not run (it needs a Kagi API key")
    assert answer == TextChunk("echo:BRIEF QUESTION")
    assert fake_hermes.calls[0]["system"].startswith("Answer.")
