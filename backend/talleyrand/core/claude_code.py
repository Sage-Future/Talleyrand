"""
Model calls through the operator's own signed-in Claude Code (`claude -p`).

Each call runs on the operator's Claude subscription (process handling in
core/agent_cli.py), made as close to plain inference as the CLI allows: no
tools, no MCP servers, no skills, and none of the operator's own settings,
hooks, plugins or CLAUDE.md (--safe-mode), so nothing but Talleyrand's prompt
shapes the answer and nothing in a case can make it act.

What a run may do is set by those flags and by the environment it starts with
(core/agent_cli.py passes no API keys). The CLI's first event reports what the
run actually got, and a run that reports tools or API-key auth is killed at
that event, with no grace period. That is a fast stop, not a guarantee: the
CLI does not wait for the check, so a call it starts within a millisecond or
two of printing the event still goes out. A run that never reports its setup
is not trusted either. The CLI's contract was
checked against Claude Code 2.1.280 on 2026-09-23 (see PLAN.md).
"""

import json
import os
from typing import Any

from talleyrand.core.agent_cli import AgentError, run_cli, stderr_tail
from talleyrand.core.config import settings

# The `claude setup-token` fallback for machines where the keychain is
# unavailable; it is still subscription auth.
OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN"

# The one tool a run may have: Claude Code's own vehicle for --json-schema output.
ALLOWED_TOOLS = {"StructuredOutput"}


class ClaudeCodeError(AgentError):
    label = "Claude Code"
    setup_hint = "Install Claude Code and sign in with `claude auth login`."


async def run(
    *, system_prompt: str, prompt: str, json_schema: dict | None = None, model: str | None = None
) -> dict:
    """
    Run one `claude -p` call on model (default settings.claude_code_model) and
    return its terminal `result` event, with the model its init event reported
    (the alias resolved) added as "model".
    """
    args = [
        settings.claude_code_executable,
        "-p",
        "--safe-mode",
        "--disable-slash-commands",
        "--tools",
        "",
        "--strict-mcp-config",
        "--permission-prompts",
        "none",
        "--no-session-persistence",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        model or settings.claude_code_model,
        "--effort",
        settings.claude_code_effort,
        "--system-prompt",
        system_prompt,
    ]
    if json_schema is not None:
        args += ["--json-schema", json.dumps(json_schema)]
    env = {OAUTH_TOKEN_ENV: os.environ[OAUTH_TOKEN_ENV]} if OAUTH_TOKEN_ENV in os.environ else {}
    events, stderr, returncode = await run_cli(
        args, prompt, error=ClaudeCodeError, env=env, on_event=_check_init
    )
    init = next((e for e in events if _is_init(e)), None)
    if init is None:
        raise ClaudeCodeError(
            "Claude Code did not report its setup (no init event), so its answer is not "
            f"trusted: {stderr_tail(stderr, returncode)}"
        )
    result = next((e for e in reversed(events) if e.get("type") == "result"), None)
    if result is None:
        raise ClaudeCodeError(
            f"Claude Code exited without an answer: {stderr_tail(stderr, returncode)}"
        )
    if result.get("is_error") or result.get("subtype") != "success":
        raise ClaudeCodeError(str(result.get("result") or result.get("subtype") or "failed"))
    return result | {"model": init.get("model")}


def _is_init(event: dict[str, Any]) -> bool:
    return event.get("type") == "system" and event.get("subtype") == "init"


def _check_init(event: dict[str, Any]) -> None:
    """Refuse a run the moment its init event shows API-key auth or tools."""
    if not _is_init(event):
        return
    auth = event.get("apiKeySource")
    if auth != "none":
        raise ClaudeCodeError(
            f"Claude Code authenticated with {auth} instead of your Claude subscription; "
            "refusing to run on API billing. Unset it and sign in with `claude auth login`."
        )
    # Evidence of no tools is an empty list, not a missing field: a CLI release
    # that renames or reshapes these must fail here, not pass as tool-free.
    tools, mcp_servers = event.get("tools"), event.get("mcp_servers")
    if not isinstance(tools, list) or not isinstance(mcp_servers, list):
        raise ClaudeCodeError(
            "Claude Code did not report which tools the run has; refusing. Its output "
            "format may have changed (checked against 2.1.280)."
        )
    extra_tools = set(tools) - ALLOWED_TOOLS
    if extra_tools or mcp_servers:
        names = ", ".join(sorted(extra_tools) + [str(s) for s in mcp_servers])
        raise ClaudeCodeError(f"Claude Code started with tools enabled ({names}); refusing.")
