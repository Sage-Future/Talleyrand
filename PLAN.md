# Agent Backend Implementation Plan (Claude Code, Hermes, Codex)

**Goal:** Run Talleyrand's full text research workflow through the operator's locally authenticated Claude Code, Hermes, or Codex subscription, with no OpenAI or Anthropic API key configured in Talleyrand.

**Architecture:** Talleyrand keeps ownership of cases, prompt construction, generation jobs, validation, persistence, and web retrieval. Below those services sits one subprocess boundary with three thin adapters: `claude -p`, `hermes chat -Q`, and `codex exec`. Each runs as a one-shot, tool-restricted process that returns a final text or JSON result. Web search is performed by Talleyrand itself (Kagi, optionally reranked with Mixedbread) and injected into the prompt, so every backend gets identical search behavior and verifiable sources.

**Tech stack:** Existing FastAPI, asyncio, httpx, Pydantic, MongoDB, React, TypeScript, Zustand. New pinned dependencies limited to a PDF text extractor (pypdf). No Node bridge, no embedded Hermes Python dependency, no MCP server in the first implementation.

**Status (2026-09-23):** M1 implemented on branch `feat/local-claude-code`. `./start-local.sh` starts a no-login local session in which every model call runs on the operator's Claude Code subscription. Backend: 278 tests pass, lint and format clean. Frontend: build and format clean. Verified live: a real answer job (about 25 s, with the no-search notice), auto-naming (a structured call, no API key header), the context meter (estimated against a 150K budget), a foreign `Host` refused, loopback-only binding, clean session shutdown, and cancellation of a real `claude` run killing its process. Not yet exercised live: a browser walkthrough, the kickstart, suggestions, and report flows, and stopping the session while an answer is in flight (covered by unit tests with a real subprocess).

**M4 (Hermes), 2026-09-23:** implemented on the same branch. Answers run on the `hermes` preset, and `AGENT_BACKEND=hermes ./start-local.sh` sends all auxiliary work to Hermes. In local mode both agent presets appear in the picker, so any question can use either agent. Process handling moved to a shared `core/agent_cli.py`, with one concurrency cap across agents (`AGENT_CONCURRENCY`, `AGENT_TIMEOUT_SECONDS`). Verified live: naming (5 s), kickstart questions (15 s, valid against the schema), an answer on the Hermes preset (18 s), a Claude Code answer inside a Hermes session, and clean shutdown. Backend: 290 tests pass.

**M2, M3 and Task 10 leftovers, 2026-09-24:** on the same branch, one commit each. Backend: 326 tests pass.
- **PDF text (M2, `3554b66`):** an agent reads a PDF as the text document its text layer makes, extracted locally with pypdf 6.19.0 (at most 300 pages and 200K characters per PDF, off the event loop). The text joins the case documents, so it is fitted like any other document. A PDF with no text layer, a password, or damage is named in the answer's notes, and refused by kickstart. Verified live: a Claude Code answer quoted a codeword that existed only in an attached PDF.
- **Web search (M2, `08b450a`):** Talleyrand searches for the agent. With search on, the answering agent writes up to three queries in one structured call, Kagi's v1 API runs them (`POST /api/v1/search`, Bearer `KAGI_API_KEY`), and the results go into the prompt after its cacheable opening. Every result becomes a source; the ones the answer links to are marked cited. Without a key, or when a search fails, the answer runs anyway and its notes say why. The test suite pins the key empty. **Not verified live:** no Kagi key was available to the implementer. **Mixedbread rerank skipped:** Kagi already ranks, and five results per query stay small.
- **Execution metadata (M3, `4a83c15`):** each agent answer records the provider, the model the CLI reported (Claude Code's init `model`, for example `claude-sonnet-5` for `sonnet`; Hermes's configured model), and notes on what it could not use. The record travels with the answer through the job record, overlay, replay, the saved case and `schema.d.ts`. The answer view shows the notes above the answer and the agent below it. The notes no longer sit in the answer text, so later prompts stop reading them back (review finding F8). Verified live over the job WebSocket.
- **Layer 2 continuity (M3): not built.** Measured instead, as section 11 asks: a child's prompt never extends its parent's transcript, because the whole-case context re-lists the tree, with the child in it, before the CURRENT QUESTION. So the hash check in section 5 would never match, and resume/fork would be dead code. Layer 1 (a stable brief-and-documents prefix) is what continuity gets. Revisit only with path-only context, a product decision.
- **Local-session UI (Task 10, `e1befc8`):** `/login` redirects into the app, Settings has no sign-out, and new share links are hidden (unsharing still works). Dictation, which runs on OpenAI, is hidden unless the browser has an OpenAI key.
- **Already covered, no change:** jobs interrupted by a restart already replay as interrupted (manager `record_event`). A subscription limit already reaches the reader in the CLI's own words ("usage limit reached … resets …").
- **M5 (Codex): blocked.** The `codex` CLI is not installed on this machine, and section 3 forbids guessing its flags. Install it and sign in, and Task 5 can proceed with live probes.
- **Still open:** a readiness endpoint and a backend picker in Settings (the model picker and `start-local.sh` preflight stand in), agent search for structured calls (big-picture and kickstart questions ask OpenAI for web search; on an agent they run without it), and PDF text in the context meter (it counts text documents only).

Hermes probe findings (Hermes 0.21.4):
- **No tools:** `-t ""` does NOT mean no tools. Hermes treats an empty value as unset and loads its full default toolset. `-t bot_room`, the built-in text-only toolset, resolves to zero tools, and the model confirmed it had none.
- **Isolation:** `--safe-mode` on the default profile keeps the pooled `openai-codex` login working, so the dedicated profile and second device-code login from section 3 aren't needed.
- **Instructions:** there is no system-prompt flag. `HERMES_EPHEMERAL_SYSTEM_PROMPT` carries Talleyrand's instructions, added to Hermes's roughly 750-token default prompt.
- **Output:** stream-json emits `init` (model and session only, no tools or auth), then `text`, `tool_use`, and `tool_result` events, then `result` with `exit_code`, `text`, and `error`. Since init reports no tools, the guard fails a run on any `tool_use` event.
- **Structured output:** schema instructions produced clean JSON on the first try. The adapter validates it, tolerates a code fence, and makes one repair attempt.
- **Readiness:** `hermes auth status <provider>` always exits 0, so the startup script matches on the text "logged in".
- **Privacy:** failed requests are dumped, prompt included, to `~/.hermes/sessions/`.

What M1 does differently from the text below, and why:

- **Selection is a model preset, not an execution context.** Claude Code is a third provider (`claude_code`) with one preset, `claude-code`, in the existing model picker (decision 7: one preset; the CLI model comes from `CLAUDE_CODE_MODEL`, default `sonnet`). Auxiliary work (kickstart, suggestions, summaries, reports, naming) goes to Claude Code whenever `AGENT_BACKEND=claude_code`, a startup constant rather than mutable state. That replaces the registry, execution endpoint, and per-request context in sections 4 and 7.
- **Answers say what they could not use instead of failing.** An answer with search on or PDFs attached runs anyway and starts with a one-line note. Failing would have blocked every answer, since search defaults to on. Structured calls with PDFs still fail with a clear message, because they have nowhere to put a note.
- **The frontend learns the mode from `VITE_AGENT_BACKEND`**, which `start-local.sh` sets alongside the backend's setting. There is no capabilities endpoint yet.
- **Probe findings (2026-09-23, Claude Code 2.1.280):**
  - `--safe-mode` keeps plugin hook output out of the prompt, but `system/init` still lists the plugins, so the guard checks tools, MCP servers, and `apiKeySource == "none"`, not plugins.
  - `--disable-slash-commands` removes the skills listing.
  - About 500 tokens of Claude Code's own reminders (account email, environment, date) still reach the model.
  - With `--json-schema`, init lists one tool, `StructuredOutput`, and the parsed object arrives as `structured_output` in the result.
  - The rate-limit event shows overage rejected for this seat, so runs cannot spill into paid usage credits.

**Review 2026-09-22:** Second pass focused on what stands between this plan and a working subscription setup. Checked `claude --help`, `claude auth status`, `hermes chat --help`, `hermes auth list`, and `hermes profile list` (none of these call a model), plus the repo. Findings are folded into sections 2, 3, 5, and 9. Two new sections cover operator setup (section 10) and the shortest path to a usable first release (section 11). The main corrections:

- `claude --bare` never reads OAuth or the keychain, so it cannot use a subscription. Isolation moves to `--safe-mode`, which keeps normal auth.
- Unless isolated, the operator's user-level Claude plugins and SessionStart hooks inject instructions into every `claude -p` run. Isolation is required for correctness, not just hygiene.
- The subprocess environment must be an allowlist. An inherited `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` silently turns a subscription run into API billing.
- Claude session resume only works when the cwd is the same across runs. Per-run scratch directories would break Layer 2 continuity, so a fixed empty directory replaces them.
- The Compose `frontend` service depends on `backend`, so the host-native topology needs its own startup steps.
- Task order put retrieval before routing. Section 11 reorders so that "usable with Claude, search off" comes first.
- Operator direction (2026-09-22): Talleyrand is local-only, not public, and needs no account or login. A `local_mode` setting replaces Google login with one fixed local user. It is the only switch that enables agent backends, which replaces the operator email allowlist. Because it drops authentication, local mode binds to loopback and rejects foreign `Host` headers (section 5).

## 0. Resolved decisions and how they shape this plan

The decisions recorded in section 9 were made after the first draft. This section states how each one changes the design; the rest of the plan is written against these consequences.

| # | Decision | Consequence in this plan |
| --- | --- | --- |
| 1 | Personal, local, single operator, no login | Host-native backend on the operator's machine; MongoDB is the only Docker service. Containerized agent topology, hosted Render bridge, and per-visitor agents are out of scope. `local_mode=true` swaps Google login for a fixed local user and is the only way to enable agent backends. With no authentication, loopback binding and a trusted-host check are what keep other machines and web pages out. |
| 2 | Subscription inference preferred; agent execution only if unavoidable | Each backend runs in its most inference-like mode: all built-in tools disabled, empty working directory, isolated settings, one turn. No adapter depends on the agent's tools for correctness. Direct use of subscription OAuth tokens against the Messages or Responses API is forbidden by provider terms and is not a path here. |
| 3 | Sacrifice as little continuity as possible | Two layers: stable prompt-prefix ordering so provider prompt caches hit on every run (no state), plus session resume with forking for the strictly linear case where Talleyrand can prove the prior transcript equals the prompt it would rebuild. Fresh runs remain the correctness fallback. |
| 4 | Research tools only, limited general access | Search happens inside Talleyrand, not inside the agent. Agents run with zero tools, so filesystem, shell, and MCP exposure is eliminated rather than sandboxed. Native agent search stays a later, per-backend capability. |
| 5 | Token streaming unneeded | Buffered final answers for every agent backend. No new progress event type in the first release; the existing pending state is enough. Existing API providers keep token streaming. |
| 6 | PDFs, search, text only; Kagi and Mixedbread allowed for search | Bounded local PDF text extraction. Kagi Search API as the retrieval source; Mixedbread reranking optional. Dictation is disabled in agent mode. Scanned or visual PDFs are rejected with a clear error; Mixedbread parsing is the noted upgrade path. |
| 7 | One approved preset per backend for answers and auxiliary work | Presets are per backend and configured server-side. Auxiliary calls (naming, suggestions, summaries) use the same preset with tools off and no retrieval. Quota impact is documented; no silent fallback to API providers. |
| 8 | Backend optionality maintained | All three adapters share one contract and one process helper. Delivery order follows what can be validated locally: Claude Code, then Hermes, then Codex when the CLI is installed. |

## 1. Scope and interpretation

"Backend agent" means the operator's authenticated CLI runtime produces the model output. It is not changing the OpenAI SDK's base URL, and it is not exposing Talleyrand as an MCP tool to an agent.

The complete text workflow must work without OpenAI or Anthropic keys: kickstart brief, kickstart questions, answering, follow-up suggestions, selection suggestions, big-picture suggestions, parent summaries, reports, and case naming. Dictation is excluded in agent mode. PDF and search limitations must be visible, not silently ignored.

"No API key" does not mean free. Subscription quotas (Claude's rolling usage windows, ChatGPT plan limits, whatever Hermes's configured provider enforces) and Kagi per-query billing remain the operator's responsibility. Auxiliary calls count against the same quota as answers.

Claude billing, checked 2026-09-22 against Anthropic's help article "Use the Claude Agent SDK with your Claude plan":

- `claude -p` on a subscription login draws from the plan's usage limits. On Team, that means the member's seat allowance.
- Anthropic announced a change for 2026-06-15 that would have moved `claude -p` and Agent SDK usage onto a separate monthly credit billed at API rates. The change was paused on that date and has not taken effect. Anthropic says it will give notice before any revised plan applies. Recheck before relying on this, because a revival would change the cost model of this whole plan.
- Once the plan limit is reached, usage continues on usage credits (billed at API rates) if they are enabled for the account. On Team, admins control that. To make "subscription only" a hard guarantee, keep usage credits off for the seat. Talleyrand then shows the quota-exhausted error instead of spending money.
- The prompt-cache lifetime is 1 hour on subscription usage and drops to 5 minutes on usage credits. That affects how much Layer 1 continuity saves.

## 2. Findings

### Repository

The working tree was clean on `develop` before writing this plan.

| Area | Current implementation | Consequence |
| --- | --- | --- |
| Model calls | `backend/talleyrand/core/llm.py` implements OpenAI-only `parse_structured` (line 156) and dispatches answer streaming to OpenAI or Anthropic (line 389). Web search is an OpenAI Responses tool (line 186). | Both interfaces need a backend-neutral boundary. Search must move out of the provider call for agent mode. |
| Key selection | `core/llm.py:114` and `features/graph/dependencies.py` enforce model-provider keys. | Agent mode selects a different execution context; it must not use dummy keys. |
| Answers | `features/research/query_service.py:27` builds whole-case context and resolves the node's selected model. | Keep this prompt building. Whole-case context means most child answers change the prompt body, which limits how often session resume applies (see section 5). |
| Auxiliary calls | `research/kickstart.py`, `suggestions.py`, `big_picture.py`, `cheat_sheet.py`, `report.py`, `graph/graph_naming.py`. | Migrate every call and the route dependencies that reject requests without an OpenAI key. |
| Jobs | `research/generation/manager.py` owns queueing, cancellation, streaming, summaries, suggestion jobs; `records.py` persists results. | Reuse it. Browser disconnection must not stop the agent; deletion, retry, and shutdown must. |
| Streaming | `manager.py:407` waits for `TextChunk` and `SourceChunk` (defined in `core/llm.py` lines 230 and 237). | Agent adapters yield one final `TextChunk` and a `SourceChunk` per Talleyrand-retrieved source. No protocol change. |
| Context | `core/model_settings.py`, `core/llm.py:290`, `research/context_fitting.py`, `research/context_size.py` assume known API windows and token counters. | Agent mode needs a configured budget and local estimation; it must not call Anthropic for counting. |
| Documents | `graph/dtos.py:42` supports text and base64 PDFs; model calls send native PDF inputs. | No agent CLI accepts Responses-style `input_file`. Extract text locally. |
| Sources | `WebSource` and `WebSourceCollector` in `core/llm.py` (lines 213, 254). | Talleyrand-owned retrieval populates `WebSource` from known inputs, which makes source coverage complete rather than partial. |
| Browser setup | `frontend/src/client.ts` attaches API keys; `ResearchPage.tsx` prompts for an OpenAI key; Settings and ModelPicker assume providers. | Backend choice and readiness replace unconditional key gating. |
| Audio | `features/transcription/service.py` uses `AsyncOpenAI`. | Disabled in agent mode with an explanation. |
| Deployment | Compose runs Python in Docker; CLI installs and auth live on the host. The `frontend` service `depends_on: backend`, so `docker compose up frontend` also starts the containerized backend on port 8000. `pdm dev` binds `0.0.0.0`; `vite --host` exposes the frontend on the LAN. | Decision 1: run the backend on the host. Compose stays for MongoDB and for the existing API-only deployment. Host-native startup is `docker compose up -d mongodb` plus host `pdm` and `pnpm`, bound to 127.0.0.1 (section 10). |
| Auth | Every route depends on `features/auth_jwt/router.py:require_auth` (Bearer JWT issued after Google OAuth). `core/config.py` requires `jwt_secret_key` and non-empty `google_client_id`/`google_client_secret`. The frontend `AuthContext` calls `GET /auth/me` unconditionally and `ProtectedRoute` redirects to `/login` only if that fails. | Local mode is `app.dependency_overrides[require_auth]` returning a fixed `User(id="local", email="local@localhost")`, set up in `main.py`. With that in place `/auth/me` succeeds and the frontend enters the app without code changes. Relax the JWT and Google settings to optional when `local_mode=true`. The existing `email_whitelist` only matters for Google login and does not apply locally. |
| Subprocess env | `Settings` loads `.env` into the settings object, not `os.environ`. Child processes inherit whatever the shell that started uvicorn exported. | Pass agent subprocesses an allowlisted environment, never `os.environ` (section 5). |

Tests are colocated with source. Backend scripts: `pdm test`, `pdm lint`. Frontend: `pnpm build`, `pnpm format:check`. There is no frontend test runner.

### Local runtimes (checked 2026-09-21, help output only, no model calls)

| Runtime | State | Verified interface |
| --- | --- | --- |
| Claude Code | 2.1.278 installed | `--print`, `--output-format json|stream-json`, `--json-schema`, `--tools ""`, `--allowedTools`, `--system-prompt`, `--setting-sources`, `--strict-mcp-config`, `--bare`, `--session-id`, `--resume`, `--fork-session`, `--no-session-persistence`, `--model`. |
| Hermes | 0.21.4 installed | `hermes chat -Q --query-file - --format stream-json --toolsets ... --ignore-user-config --ignore-rules --resume`, `hermes profile`, `hermes proxy`. Bundled search backends are Parallel, Firecrawl, Exa, Brave, Tavily, SearXNG; Kagi and Mixedbread are absent. Pooled OAuth providers include `openai-codex` and `claude-code`. `hermes serve` is the JSON-RPC/WebSocket gateway for the desktop app; no `/v1/runs` HTTP server was found in the install. |
| Codex | not installed | Documented interfaces only. |

Recheck 2026-09-22 (help and auth-status only):

| Runtime | State | New facts |
| --- | --- | --- |
| Claude Code | 2.1.280 (auto-updated from 2.1.278 overnight) | `--bare`: "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper … (OAuth and keychain are never read)". `--safe-mode` disables CLAUDE.md, skills, plugins, hooks, and MCP servers while "Auth, model selection … work normally". `--setting-sources` takes `user,project,local`; an empty value is undocumented. `--permission-prompts none` auto-denies anything that would prompt. `--restricted` exists but overlaps with `--tools ""`. `claude auth status --json` returns `loggedIn`, `authMethod` (`claude.ai`), `apiProvider` (`firstParty`), and `subscriptionType` (`team`) without a model call. `claude setup-token` issues a long-lived subscription token for headless use. `--system-prompt-snapshot` (default on) reuses the first system prompt on resume. |
| Hermes | 0.21.4 | Pooled credentials: `openai-codex` (OAuth device code) and `copilot` (gh token). No `claude-code` credential. The default profile's model is `gpt-6-astra`. `--safe-mode` implies `--ignore-user-config` and `--ignore-rules` and also disables plugins and MCP. `--ignore-user-config` still loads `.env` credentials; whether pooled OAuth survives either flag is unverified. `-p/--profile <name>` is consumed before argparse and sets `HERMES_HOME`. Also relevant: `--source tool` (keeps sessions out of user lists), `--run-budget SECONDS`, `--max-turns N`, `--in DIR`, `--no-restore-cwd`, `hermes auth status <provider>`. Help does not say whether `-t ""` means no toolsets or the defaults. |
| Codex | not installed | Unchanged. If installed, it draws on the same ChatGPT quota as Hermes's `openai-codex` credential. |

The Claude account is a Team plan seat, so the organization's admin policies and data settings apply to case content sent through it, on top of Anthropic's terms.

Two conclusions follow. The Hermes Runs API described in the docs is not confirmed to exist in this version, so the Hermes transport is the CLI. Kagi and Mixedbread are not Hermes search backends, so retrieval must be Talleyrand's job if those providers are required.

## 3. Transport decisions

All three backends use one pattern: asyncio subprocess, argument arrays, prompt on stdin, JSON or JSONL on stdout, bounded stderr drain, process-group termination. No shell interpolation, no PTY.

### Claude Code

Candidate invocation, revised against 2.1.280 help, to be confirmed in Task 1:

```
claude -p --safe-mode --tools "" --strict-mcp-config --permission-prompts none \
  --output-format stream-json --verbose \
  --system-prompt <talleyrand-system-prompt> --model <preset> \
  [--json-schema <schema>] [--session-id <uuid> | --resume <id> --fork-session] \
  [--no-session-persistence]
```

- `--bare` is ruled out because it never reads OAuth or the keychain. `--safe-mode` provides the isolation and keeps subscription auth. This matters in practice: the operator's user settings load plugins whose SessionStart hooks inject instructions into every session, and without isolation those would shape Talleyrand answers.
- Use one fixed, empty cwd for every run (for example `~/.local/share/talleyrand/claude-cwd`, created at startup), not a per-run scratch directory. Claude stores transcripts under `~/.claude/projects/<cwd-slug>/`. A per-run cwd would create a project directory per call and break `--resume`, which looks sessions up by cwd.
- Use `stream-json` so the adapter can read the `system/init` event before the answer. If init reports any tool, MCP server, or plugin, or reports an API-key auth source instead of OAuth, the run fails with a typed error. That makes a leaked tool or an accidental switch to API billing a hard failure, not a silent one. Task 1 confirms the init field names (`tools`, `mcp_servers`, `plugins`, `apiKeySource`) and where `--json-schema` output lands in the terminal `result` event (expected `structured_output`).
- `--json-schema` gives native structured output. Still validate with Pydantic. Task 1 also runs the most nested feature schema to confirm `$defs`/`$ref` from `model_json_schema()` are accepted.
- `--permission-prompts none` turns any prompt into an automatic denial, so a run can never hang waiting for approval.
- The terminal result reports session ID, model, and usage. Persist session ID, model, and `claude --version` as execution metadata. The CLI auto-updates (2.1.278 to 2.1.280 in one day), so recording the version is how flag drift gets diagnosed.
- Auth is the operator's own `claude` login in the keychain. That works when uvicorn runs from the operator's logged-in terminal. When the keychain is unavailable (SSH, a LaunchDaemon), the fallback is `claude setup-token`: Talleyrand stores the token as a server-side secret and passes it only to the `claude` binary as `CLAUDE_CODE_OAUTH_TOKEN`. Talleyrand never calls Anthropic with it directly; Anthropic restricts subscription auth to its own clients, and `claude` is that client. The operator confirms headless use is within their plan's terms, and their organization's policy, before enabling the backend. `--max-budget-usd` applies to API billing and is irrelevant here.
- Readiness check with no model call: `claude --version` plus `claude auth status --json`, ready when `loggedIn && authMethod == "claude.ai" && apiProvider == "firstParty"`. Cache it for a short interval. Return only a ready flag and the subscription type to the browser, never the email or org ID.

### Hermes

Candidate invocation:

```
hermes -p talleyrand chat --query-file - --format stream-json --toolsets <none> \
  --ignore-rules --source tool --provider openai-codex -m <preset> \
  --run-budget <seconds> --in <fixed-empty-dir> --no-restore-cwd [--resume <session-id>]
```

- Preferred isolation is a dedicated profile (`hermes profile create talleyrand`, no `--clone`) with provider and model pinned in its config and its own `openai-codex` device-code login. That profile's `HERMES_HOME` holds no user memory, SOUL.md, plugins, or MCP servers, and its session store is Talleyrand's alone, which keeps transcript cleanup scoped. Give the profile its own login rather than copying credentials: OAuth refresh tokens rotate, and two stores sharing one token can invalidate each other (Task 1 confirms). `--safe-mode` or `--ignore-user-config` on the default profile is the fallback if pooled OAuth survives those flags.
- Always pass `--provider` explicitly. `auto` could pick up an API key or the `copilot` credential.
- Confirm in Task 1 that `--toolsets ""` (or the equivalent) yields no tools, that stream-json marks the final response unambiguously, and how `--resume` interacts with forking (Hermes has no fork flag; resuming the same session from two children would corrupt it, so resume is linear-only or disabled for Hermes).
- Hermes has no native schema flag. Structured calls use schema instructions plus Pydantic validation with one bounded repair attempt.
- Provider choice is the operator's. Hermes's `openai-codex` pooled credential is the subscription-inference path OpenAI permits inside Codex; whether it is permitted through Hermes is a terms question for the operator. Treat Hermes's `claude-code` provider as out of bounds unless Anthropic's terms allow it; the Claude adapter above is the supported Claude path.
- The Runs API and `hermes proxy` are upgrade paths, not first-release scope. Revisit only if the CLI cannot express cancellation or isolation adequately.

### Codex

Candidate invocation, to verify against the installed version:

```
codex exec --json --ephemeral --sandbox read-only -C <empty-dir> [--output-schema <path>] -
```

Read-only sandbox still lets the model run shell commands in the sandbox. Confirm whether the installed version can disable the shell tool entirely; if not, the empty working directory plus sandbox is the accepted ceiling and is documented as such. Confirm unattended approval behavior, config isolation, that web search is off by default, and whether `codex exec resume` exists for continuity. Do not guess flags. Do not run inside the Talleyrand checkout.

### Streaming

All agent adapters advertise `answer_streaming=false`. They buffer the process output and emit one authoritative final `TextChunk` after terminal success, followed by `SourceChunk`s for the retrieved sources. Interim agent commentary is never answer text. Existing API providers are unchanged. Never emit the final answer twice.

## 4. Application boundary

Create `backend/talleyrand/core/execution/` with:

- `types.py`: execution settings, capabilities, request/result types, typed failures, session handle.
- `registry.py`: approved backend resolution and readiness checks. Agent backends resolve only when `local_mode=true`.
- `api.py`: wrapper around existing direct API behavior.
- `process.py`: bounded subprocess I/O, JSON/JSONL decoding, process-group termination.
- `claude.py`, `hermes.py`, `codex.py`: argument construction, output decoding, session handling.
- `structured.py`: strict final-output parsing and the one-attempt repair policy.
- `documents.py`: bounded PDF text extraction.
- `search.py`: Kagi search, optional Mixedbread rerank, source injection and citation mapping.

These are proposed new files, not existing symbols.

The contract provides `capabilities`, `generate_text`, and `generate_structured`. Requests carry operation, instructions, context, preset, retrieval policy, normalized attachments, an optional resume handle, and deadlines. Results include backend and model identity as reported (or "unknown"), final text or validated data, a session handle when the run is resumable, and sources.

Use an immutable execution context selected at request admission and passed to all child jobs. No process-global mutable "current backend". Settings changes must not reroute an already queued answer's summary or suggestions.

Capabilities distinguish: answer streaming, structured-output mechanism (native or instructed), retrieval (Talleyrand-owned, native, none), session resume (fork-safe, linear-only, none), supported document forms, context budget, and transcription. Unsupported functionality fails early with an actionable message.

Expose a `/backend/execution/backends` endpoint (behind `require_auth`, which is the local user in local mode) returning approved backend IDs, readiness, presets, and capability summaries. The browser selects an approved backend ID; it never supplies paths, executables, flags, or URLs. API mode remains the default for existing deployments.

Add optional answer execution metadata with backward-compatible defaults through graph DTOs, generation records, overlay, frontend types, import/export, and sharing: backend, requested and actual model, session handle, prompt prefix hash, source mode. Do not relabel old answers. Persist no keys or prompts.

## 5. Context, continuity, documents, search, isolation

### Context ownership and continuity

Talleyrand's graph remains authoritative and each operation's prompt is built from it. Continuity is layered on top without giving up that property.

Layer 1, prompt-cache continuity (no state): order every prompt as system instructions, then brief, then documents, then tree, then the node-specific tail. Provider caches hit on the stable prefix on every run regardless of session. This is the main continuity win and costs nothing.

Layer 2, session resume (opt-in per backend): when an answer completes, store the session handle and a hash of the exact prompt sent. When generating a child answer, the adapter computes the prompt it would send for the parent's portion. If the hash matches and the backend supports fork-safe resume, resume and fork (Claude `--resume --fork-session`), sending only the delta. If the backend supports linear-only resume (Hermes), resume only when the parent has no other resumed children. Otherwise run fresh. Deleting or regenerating a node invalidates handles beneath it. Because `query_service.py` builds whole-case context, the hash matches only for strictly linear extension with no other graph change; measure the hit rate in acceptance before investing further. Changing to path-only context is a product decision outside this plan.

Session files persist only for resumable answer runs; auxiliary runs use `--no-session-persistence` or equivalent. Document Claude and Hermes transcript locations and a cleanup policy.

Budget for instructions, output, and injected search results, not just the model's window. Use conservative configured limits and label counts as estimated. Retain document-first trimming; if the non-trimmable brief and tree alone cannot fit, reject clearly.

### Attachments

Text documents stay in the prompt. For PDFs, extract text locally with pypdf (pin in `pyproject.toml`/`pdm.lock` after confirming compatibility). Enforce upload limits plus decoded size, page count, extraction time, and extracted-text length. Treat document names as labels, not paths. Account for extracted text in context fitting. Empty, scanned, encrypted, or malformed PDFs produce explicit unsupported-document errors. Mixedbread's document parsing is the noted upgrade path for scanned PDFs; do not build it now.

### Search and citations

Retrieval is Talleyrand's, not the agent's, so `web_search_enabled` is enforced by code on every backend identically:

1. If search is enabled, one structured call generates up to N queries from the question and context.
2. Kagi Search API returns results; Mixedbread reranking is an optional pass over titles and snippets. Both credentials live server-side.
3. The top K results are injected as a numbered source list (title, URL, snippet) with instructions to cite by number. Start with snippets; add bounded page fetching only if answers prove too thin.
4. The adapter maps cited numbers to `WebSource` entries, so `SourceChunk`s are exact and coverage is complete. Uncited generated URLs stay as Markdown links but are not promoted to sources.

If search is disabled, no retrieval runs and the agent has no tools, so no network access happens outside the model call. Native agent search (Claude `WebSearch`, `codex exec --search`, Hermes web toolsets) is a later per-backend capability with partial-coverage source semantics; the UI must not present zero recorded sources as proof no search occurred once that mode exists.

Mixedbread's current API surface is unverified; confirm it in Task 1 and drop the rerank step if it does not fit in a few lines.

### Safety boundary

Agents run with tools disabled in an empty scratch directory, isolated from the operator's settings, memory, plugins, and MCP servers. That removes the filesystem and shell surface instead of sandboxing it. Codex is the exception if its shell tool cannot be disabled; document that ceiling. PDFs and search results are untrusted input; the prompt is not a permission boundary, which is why no tools are available to be abused.

Never enable blanket approval bypass. Any run that requests approval fails with "requires operator approval" rather than hanging.

Agent backends default off and are available only in local mode. Local mode has no authentication, so network reachability is the boundary. Three measures, all required:

1. Bind uvicorn and Vite to `127.0.0.1`. The current `pdm dev` uses `0.0.0.0` and `vite --host` exposes the LAN.
2. Add Starlette `TrustedHostMiddleware` with `allowed_hosts=["localhost", "127.0.0.1"]` in local mode. Without it, a DNS-rebinding page in the operator's browser can call the API same-origin and spend subscription quota or read cases. CORS alone does not stop that.
3. Keep CORS limited to the local frontend origin.

Agent subprocesses get an explicit environment, never `os.environ`: `PATH`, `HOME`, `USER`, `LANG`, and `TMPDIR`, plus `CLAUDE_CODE_OAUTH_TOKEN` only if the setup-token fallback is configured. This keeps out `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`/`VERTEX`/`FOUNDRY`, `OPENAI_API_KEY`, and Talleyrand's own secrets (Kagi, Mixedbread, Mongo). Any of the first group would silently move a run off the subscription.

## 6. Job lifecycle and failure semantics

Preserve browser reconnect/snapshot behavior, source collection, outline-reference freezing, deletion finality, and graph revision handling.

Apply queue-wait, startup, idle, and total deadlines. Add a server-wide concurrency cap across answers and auxiliary calls. Release answer capacity before awaiting follow-up work. Default the cap to 2: one answer fans out into summary, suggestions, and naming calls, and all of them draw on the same rolling subscription window.

`manager.py:408` wraps each `stream.__anext__()` in `stream_idle_timeout_seconds` (default 1000 s). A buffered agent run yields nothing until it finishes, so for agents that idle timeout is really a total deadline. Keep the adapter's own total deadline below it, and make sure cancelling the generator, whether from that timeout or from deletion, runs the process-group kill in a `finally`. Test both paths.

Map quota exhaustion to its own typed error, with the reset time when the CLI reports one, so the UI can say "subscription limit reached until X" instead of showing a generic failure.

On timeout, deletion, forced retry, or shutdown: terminate the process group, wait a bounded grace period, force-kill and reap, and drain stderr concurrently. Ignore late output from superseded attempts. Do not resurrect deleted nodes or publish partial output as completed.

Because every backend is a local subprocess, there is no remote run to reconcile. On startup, mark jobs recorded as running before the restart as interrupted. Do not automatically rerun them. Ensure children die with the parent (process group plus a supervisor check). Transparent resume is out of scope.

## 7. Ordered implementation tasks

For each task: write focused failing tests first, run them, implement the smallest change, rerun. Filenames below are proposed. Do not rewrite existing tests around mocks.

### Task 1 — Verify runtime contracts

Create `docs/agent-backends.md` and fixtures under `backend/talleyrand/core/execution/fixtures/`. With operator authorization, for each installed runtime: one text answer, one existing feature schema, an oversized input, cancellation mid-run, resume plus fork (Claude) or resume (Hermes), and a check that the run has no tools. Confirm `--safe-mode` isolation and OAuth auth via the `system/init` event for Claude; the isolation route and final-message marker for Hermes. Confirm Kagi Search API access and the Mixedbread API shape. Capture sanitized real output; record limitations instead of fabricating fixtures. Codex is deferred until installed. Gate implementation on tool-free execution and unambiguous final-output identification.

### Task 2 — Backend resolution without changing API behavior

Create contract, registry, API wrapper, `test_registry.py`, `test_api.py`. Modify `core/config.py`, `main.py`, and add an execution router and DTOs under `features/execution/`. Tests: API default, disabled or unknown backend rejection, agent backends rejected when `local_mode=false`, capability redaction, missing runtime, no endpoint or command injection. Wrap existing `llm.py` functions rather than rewriting them.

Local mode lives here too: a `local_mode` setting, JWT and Google settings made optional when it is on, the `require_auth` override and `TrustedHostMiddleware` in `main.py`, and a `dev-local` pdm script bound to 127.0.0.1. Tests: `/auth/me` returns the local user with no Authorization header; a request with `Host: evil.example` is rejected; with `local_mode=false`, behavior is unchanged (401 without a token, and startup still requires the Google settings).

### Task 3 — Process helper and Claude adapter

Create `process.py`, `claude.py`, `test_process.py`, `test_claude.py`. Use a fake executable for deterministic tests plus sanitized fixtures. Cover stdin metacharacters, long prompts, malformed or oversized output, stderr pressure, nonzero exits, missing login, empty output, total timeout, process-group cleanup, session ID capture, resume and fork argument construction. Only terminal success plus valid output completes a job. No API fallback.

### Task 4 — Hermes adapter

Create `hermes.py`, `test_hermes.py`. Cover stream-json decoding with split lines, interim versus final messages, profile or isolation flags, model routing, linear-only resume guard, provider auth failures, cancellation.

### Task 5 — Codex adapter

Create `codex.py`, `test_codex.py`, when the CLI is installed and Task 1 has been run for it. Cover JSONL item completion, output-schema handling, sandbox and cwd flags, unattended approval failure, resume if available.

### Task 6 — Structured output and documents

Create `structured.py`, `documents.py`, `test_structured.py`, `test_documents.py`; update the lock for pypdf. Run real feature schemas through each adapter path (native schema for Claude and Codex, instructed for Hermes). Reject extra chatter and truncated JSON; one repair attempt for schema failures only. Test enums, arrays, invalid IDs, refusals, oversized output, corrupt and scanned PDFs, extraction limits, cleanup on every exit path.

### Task 7 — Talleyrand-owned retrieval

Create `search.py`, `test_search.py` with `httpx.MockTransport`. Cover query generation schema, Kagi request and response mapping, rerank on and off, result cap, citation-number to `WebSource` mapping, uncited URLs not promoted, search disabled producing no network calls, credential absence producing a typed error.

### Task 8 — Route all research operations, context fitting, continuity

Modify `features/graph/dependencies.py`, `graph_naming.py`, `features/research/query_service.py`, `kickstart.py`, `suggestions.py`, `big_picture.py`, `cheat_sheet.py`, `report.py`, `context_fitting.py`, `context_size.py`, relevant DTOs, `core/model_settings.py`, and the counting boundary in `core/llm.py`. Add `features/research/test_agent_routing.py`. Parameterize over backends: each operation succeeds with no key headers, settings propagate to child work, no OpenAI or Anthropic client is constructed (test guard that fails on SDK construction), agent budgets apply, prompt prefix ordering is stable, resume applies only when the prefix hash matches and is fork-safe. API-mode behavior unchanged.

### Task 9 — Lifecycle, metadata, persistence

Modify `generation/manager.py`, `records.py`, `routes.py`, `dtos.py`, `overlay.py`, `graph/dtos.py`; extend `test_manager.py`, `test_overlay.py`, and graph persistence tests. Cover buffered completion, no duplicate final answer, capacity sharing, forced retry, deletion while running, tab disconnection, shutdown, late result suppression, interrupted-on-restart marking, handle invalidation on delete or regenerate. Metadata round-trips through save, load, overlay, export, share; old cases load unchanged.

### Task 10 — Frontend

Modify `frontend/src/client.ts`, `SettingsModal.tsx`, `ResearchPage.tsx`, `ModelPicker.tsx`, `config/models.ts`, `types/index.ts`, `services/researchGenerationService.ts`, `AnswerSources.tsx`, context-size services, `DocumentLibrary.tsx`, `DictateButton.tsx`, `useDictation.ts`. Add one backend-capabilities store. Settings shows API, Claude Code, Hermes, Codex with readiness, preset, and limitations. Replace the OpenAI-key nag with capability-aware setup. Disable dictation in agent mode with an explanation; show PDF extraction limits. Agent auth failures return typed execution errors, not app 401s. Regenerate `schema.d.ts` from the running backend. Frontend test runner only if approved; otherwise a browser walkthrough. For local mode: `/` and `/login` redirect into the app once `/auth/me` succeeds, and sign-out and share controls are hidden. Share links are meaningless when nothing is public.

### Task 11 — Documentation

Modify `README.md`, legal copy in `frontend/src/components/legal/`, and `docs/agent-backends.md`. Document host-native backend plus Docker MongoDB, operator CLI logins, Kagi and Mixedbread credentials, local mode and its loopback binding, Claude and Hermes isolation flags, transcript locations and cleanup, quota expectations, and the terms caveats from section 3. Keep the Compose API-only deployment working.

## 8. Verification and release criteria

Backend, from `backend/`:

- `pdm run pytest talleyrand/core/execution -v`
- `pdm run pytest talleyrand/features/research talleyrand/features/graph -v`
- `pdm test`
- `pdm lint`
- `pdm run ruff format --check .`

Frontend, from `frontend/`: `pnpm generate-openapi` against the running backend after API changes, `pnpm build`, `pnpm format:check`.

Live acceptance per backend, with browser keys absent and direct provider clients forbidden in the process:

1. Run `./start-local.sh` (section 10). The browser opens with no login; select a ready backend.
2. Kickstart a case; generate brief and questions; verify auto-name.
3. Answer, branch from selected text, generate follow-up and big-picture suggestions, enable parent summary, produce a report.
4. Attach text and a text PDF; verify scanned-PDF rejection and estimated context limits.
5. Search on: verify Kagi is called, cited sources match injected results exactly, uncited URLs are not sources. Search off: verify no retrieval and no outbound network from the agent.
6. Continuity: answer a child of a fresh answer and confirm resume plus fork was used; change the brief and confirm the next child runs fresh; delete a node and confirm handles beneath it are invalidated.
7. Close and reopen the tab mid-run; verify persisted final output.
8. Force retry, delete a running node, restart the backend; verify process cleanup, interrupted marking, no resurrected output.
9. Simulate missing login, expired auth, quota exhaustion, malformed schema output, agent outage, Kagi failure; verify clear errors, no key prompt, no API fallback.
10. Confirm the backend is unreachable from another machine on the LAN, rejects a foreign `Host` header, and refuses agent backends when `local_mode=false`. Confirm with `ANTHROPIC_API_KEY` exported in the uvicorn shell that runs still report OAuth auth, which shows the environment allowlist works.
11. Repeat existing OpenAI and Anthropic workflows for backward compatibility.

Completion requires live results for Claude Code and Hermes. Codex completes when the CLI is installed and exercised. Record versions, commands, outcomes, and limitations in the implementation report.

## 9. Decisions and remaining questions

Resolved (see section 0 for consequences):

1. Personal, local, single operator.
2. Subscription inference preferred; tool-free one-shot agent runs are the closest permitted form.
3. Minimize continuity loss: cache-friendly prefixes plus fork-safe resume where provable.
4. Research tools only: retrieval in Talleyrand, agents have no tools.
5. Token streaming unneeded.
6. PDFs, search, text only; Kagi and Mixedbread for search.
7. One preset per backend for all work.
8. Backend optionality maintained across Claude Code, Hermes, Codex.

9. (2026-09-22) Local-only, no account or login: `local_mode` with a fixed local user replaces Google login and the operator allowlist.

Settled by the 2026-09-22 review:

- `claude --bare` cannot use a subscription (help text: OAuth and keychain are never read). Use `--safe-mode --tools "" --strict-mcp-config --permission-prompts none`.

Open, to be settled in Task 1:

- Does `--safe-mode` really keep user hooks and plugins out of a `-p` run while OAuth still works? Check both in the `system/init` event.
- Which `system/init` fields show tools, MCP servers, plugins, and auth source, and where does `--json-schema` output appear in the result?
- Does `claude --resume <id> --fork-session` from the fixed cwd work together with `--system-prompt-snapshot`?
- Hermes: does a dedicated `talleyrand` profile with its own `openai-codex` login work, and what does `-t` take to mean "no toolsets"?
- Does Mixedbread's current API fit as a snippet reranker in a few lines? If not, Kagi alone.
- Are snippets sufficient, or is bounded page fetching needed for answer quality? Decide from acceptance, not upfront.
- Operator confirmation that headless `claude -p` and Hermes's pooled subscription providers are within the respective plans' terms.

## 10. Operator setup (local mode, host-native)

A session starts with one command, `./start-local.sh` at the repo root. It is an M1 deliverable, documented in `README.md` by Task 11. The only other operator steps are one-time.

**One-time:**

1. **CLI logins.** Run `claude auth login` with the subscription account, not Console. For Hermes (M4): `hermes profile create talleyrand`, then log that profile into `openai-codex` and pin its provider and model.
2. **Optional secrets.** Put `KAGI_API_KEY` and `MIXEDBREAD_API_KEY` in `backend/.env` (M2). Nothing else is needed. The script passes the local-mode settings as environment variables, which take precedence over `.env` in pydantic-settings, so the same `.env` still works for the Compose API-only deployment.

**Every session:** `./start-local.sh`. The script is plain bash with no new dependencies. In order, it:

1. **Preflight.** Checks that `docker info`, `pdm`, and `pnpm` succeed. Fails if something is already listening on port 8000 or 3000, which catches a leftover Compose backend. Runs `claude auth status --json` and warns, without failing, unless it shows `loggedIn` with `authMethod: "claude.ai"`, so API mode still starts.
2. **Clean environment.** Runs `unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OPENAI_API_KEY`. The backend's env allowlist does the real enforcement; this is a second guard.
3. **MongoDB.** Runs `docker compose up -d mongodb`, never bare `docker compose up`, which would also start the containerized backend on port 8000. Then polls until Mongo answers a ping, or gives up after about 30 s with a message.
4. **Dependencies.** Runs `pdm install` or `pnpm install --frozen-lockfile` only when `backend/.venv` or `frontend/node_modules` is missing, so a normal start takes seconds.
5. **Backend.** Starts it in the background with `LOCAL_MODE=true`, `MONGODB_URL=mongodb://admin:admin@localhost:27017`, and `COOKIE_SECURE=false`, via `pdm run dev-local` (uvicorn on 127.0.0.1:8000). Polls `http://127.0.0.1:8000/backend/openapi.json` until it answers.
6. **Frontend.** Starts Vite on 127.0.0.1:3000 with `VITE_BACKEND_URL=localhost:8000` and `VITE_IS_SECURE=false`, then runs `open http://localhost:3000`.
7. **Shutdown.** A `trap` on EXIT, INT, and TERM stops the frontend and then the backend. Uvicorn's graceful shutdown lets `generation_manager.shutdown()` kill agent process groups, so Ctrl-C in that terminal ends the whole session with no orphaned `claude` processes. MongoDB keeps running (Compose `restart: unless-stopped`) so the next start is fast. `docker compose stop mongodb` stops it.

Run it from a normal logged-in terminal so `claude` can read the keychain. There is no login page: the browser opens straight into the app, where Settings should show Claude Code as ready.

Verification for the script (M1): a cold start from a stopped Mongo reaches the app; a second run while the first is up fails fast on the port check; Ctrl-C leaves no `uvicorn`, `vite`, or `claude` processes (`pgrep` is empty); with Docker stopped, it exits with a clear message.

## 11. Shortest path to a usable first release

Section 7 orders tasks by component. To get a working setup soonest, deliver in these milestones. Each one is usable by itself.

**M1: Claude subscription, local mode, search off, text documents.** Task 1 (Claude part only, plus local-mode checks), Task 2 including local mode, Task 3, the structured half of Task 6, Task 8, the minimum of Tasks 9 and 10 (buffered completion, cancellation cleanup, a backend picker, and no key nag), and `start-local.sh` (section 10). Search-on requests fail with "search not configured" instead of calling OpenAI. PDFs get a clear "not yet supported in agent mode" error. This milestone makes the whole text workflow run on the Claude subscription.

**M2: Kagi retrieval and PDF text.** Task 7 and the documents half of Task 6. Blocked until the operator has Kagi Search API access, which is billed per query and needs its own key. Confirm that first. Mixedbread rerank only if it fits in a few lines.

**M3: Continuity.** Layer 2 resume and fork, plus execution metadata persistence (the rest of Task 9). Layer 1 prefix ordering already ships in M1 because it is only an ordering rule. Measure the resume hit rate before polishing further.

**M4: Hermes via `openai-codex`.** Task 4. This is the ChatGPT-subscription path that exists today.

**M5: Codex.** Task 5. Hermes already provides ChatGPT-subscription inference, so Codex adds no new model access. Its value is that it is OpenAI's first-party client, which matters if the terms rule out using the ChatGPT subscription through Hermes. Defer until that question comes up or the CLI is installed for other reasons.

Before M1 starts, the operator's authorization is needed for the Task 1 live probes. That is a handful of short `claude -p` calls against the subscription quota, each run from the fixed empty cwd.

## References inspected

- https://hermes-agent.nousresearch.com/docs/llms.txt
- https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration
- https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
- https://developers.openai.com/codex/noninteractive
- https://developers.openai.com/codex/app-server
- Local `claude --help` (2.1.278) and `hermes --help`, `hermes chat --help`, `hermes serve --help` (0.21.4), 2026-09-21.
- Local `claude --help`, `claude auth status --json` (2.1.280); `hermes chat --help`, `hermes auth list`, `hermes profile list`, `hermes profile create --help` (0.21.4), 2026-09-22.
- Repo: `core/config.py`, `features/auth_jwt/router.py`, `frontend/src/contexts/AuthContext.tsx`, `frontend/src/routes/router.tsx`, `docker-compose.yml`, `backend/pyproject.toml` scripts, `generation/manager.py:408`.
