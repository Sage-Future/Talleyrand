"""
Model calls through the operator's own signed-in Hermes (`hermes chat`).

Each call runs on whatever subscription Hermes is signed in to, pinned to
settings.hermes_provider (by default `openai-codex`, a ChatGPT plan); process
handling is in core/agent_cli.py. The run is made as close to plain inference
as the CLI allows:

- `-t bot_room`, Hermes's text-only toolset, which has no tools at all. An
  empty `-t ""` would NOT do: Hermes treats it as unset and loads its full
  default toolset;
- --safe-mode: none of the operator's config, memory, SOUL.md, AGENTS.md,
  plugins or MCP servers (the pooled provider login still works);
- --source tool, so these runs stay out of the operator's session lists.

Hermes has no system-prompt flag; Talleyrand's instructions travel in
HERMES_EPHEMERAL_SYSTEM_PROMPT, added to Hermes's own short default prompt.
Its stream-json output does not say which tools a run had. What keeps a run
tool-free is the toolset; as a backstop, a run that reports any tool activity
is killed at that event. That catches a toolset change, not the tool itself:
Hermes starts a tool as it reports it, so a fast one has already run. Nor is there a schema flag: structured
calls ask for JSON in the instructions and are validated here, with one
repair attempt. Checked against Hermes 0.21.4 on 2026-09-23 (see PLAN.md).
Failed requests are dumped, prompt included, to ~/.hermes/sessions.

Unlike Claude Code, a Hermes run cannot be held to the subscription: Hermes
loads ~/.hermes/.env (API keys included) into itself whatever environment it
is given, and its side calls (such as titling the session) may fall back to
those keys. The environment allowlist keeps the server's keys out; it cannot
keep out Hermes's own.
"""

import json
from typing import Any

from pydantic import BaseModel

from talleyrand.core.agent_cli import AgentError, run_cli, stderr_tail
from talleyrand.core.config import settings

STRUCTURED_INSTRUCTION = (
    "\n\nReply with a single JSON object that validates against this JSON Schema, and "
    "nothing else: no prose, no code fences.\n{schema}"
)


class HermesError(AgentError):
    label = "Hermes"
    setup_hint = "Install Hermes and sign in to your provider with `hermes setup`."


async def run(*, system_prompt: str, prompt: str, model: str | None = None) -> str:
    """
    Run one `hermes chat` call on model (default settings.hermes_model) and
    return the final answer text.
    """
    args = [
        settings.hermes_executable,
        "chat",
        "--query-file",
        "-",
        "--format",
        "stream-json",
        "--safe-mode",
        "--toolsets",
        "bot_room",
        "--provider",
        settings.hermes_provider,
        "--model",
        model or settings.hermes_model,
        "--reasoning",
        settings.hermes_reasoning,
        "--source",
        "tool",
        "--max-turns",
        "1",
    ]
    events, stderr, returncode = await run_cli(
        args,
        prompt,
        error=HermesError,
        env={"HERMES_EPHEMERAL_SYSTEM_PROMPT": system_prompt},
        on_event=_refuse_tools,
    )
    result = next((e for e in reversed(events) if e.get("type") == "result"), None)
    if result is None:
        raise HermesError(f"Hermes exited without an answer: {stderr_tail(stderr, returncode)}")
    if result.get("exit_code") or result.get("error"):
        raise HermesError(str(result.get("text") or result.get("error")))
    return str(result.get("text") or "")


async def run_structured[SchemaT: BaseModel](
    *, system_prompt: str, prompt: str, schema: type[SchemaT]
) -> SchemaT:
    """One structured call: JSON asked for in the instructions, validated here."""
    instructions = system_prompt + STRUCTURED_INSTRUCTION.format(
        schema=json.dumps(schema.model_json_schema())
    )
    reply = await run(system_prompt=instructions, prompt=prompt)
    try:
        return _parse(reply, schema)
    except ValueError as e:
        problem = str(e)[:500]
    retry = (
        f"{prompt}\n\nYour previous reply did not validate against the schema ({problem}). "
        "Reply again with only the JSON object."
    )
    reply = await run(system_prompt=instructions, prompt=retry)
    try:
        return _parse(reply, schema)
    except ValueError as e:
        raise HermesError(f"the reply did not match the expected format: {str(e)[:500]}") from e


def _refuse_tools(event: dict[str, Any]) -> None:
    """Stop a run the moment it reports tool activity: it should have none."""
    # Some runtimes report a fast tool only once it has completed.
    if event.get("type") in ("tool_use", "tool_result"):
        raise HermesError(f"Hermes called a tool ({event.get('name')}); refusing.")


def _parse[SchemaT: BaseModel](reply: str, schema: type[SchemaT]) -> SchemaT:
    """The reply as the schema, tolerating a ```json fence around it."""
    text = reply.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].removesuffix("```").strip()
    return schema.model_validate(json.loads(text))
