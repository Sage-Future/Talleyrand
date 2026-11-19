# Talleyrand

**Ask better questions.**

Research means dozens of open questions, and it's easy to lose the thread. A linear chat only grows — you end up scrolling back and forth to find what you already worked out. Talleyrand keeps every question in one tree, answers each with the whole case in context, and always shows you the next question worth asking. The longer a case runs, the better it understands what you're after.

Free and open source. It runs on your own machine, and every model call goes through your own signed-in Claude Code or Hermes, on your Claude or ChatGPT subscription. No accounts, no API keys.

## How it works

**Start from a mess, not a blank page.** Type a stream of thoughts — what you know, what you want to know, notes, doubts, half-formed hunches. Talleyrand turns it into a short brief and your first questions.

**Branch a follow-up from any sentence.** See something worth digging into? Select it and ask. The new question is filed under the one it came from.

**One tree, whole-case context.** Every answer is written with the brief, every other thread, your highlights and your reactions in view. The tree tracks what's waiting, what you've read, and what's settled.

**It proposes what's next, and learns from you.** After each answer it suggests follow-ups, plus big-picture questions that challenge your framing. Accept them, or decline and say why. Every heart, highlight, and decline sharpens what it proposes next.

Also in the box: insight highlights that feed later answers, cross-links between questions, a choice of Claude and GPT models for each question, attached documents for a case or a single question, one-click Markdown reports, and server-side generation so closing the tab never loses work in flight.

## Run it

Every model call runs on your own signed-in agent CLI, drawing on your plan's usage limits. Two are supported:

- [Claude Code](https://claude.com/claude-code), on your Claude plan: sign in with `claude auth login`.
- [Hermes](https://hermes-agent.nousresearch.com), by default on your ChatGPT plan through its `openai-codex` provider: sign in with `hermes setup`.

**You also need:** a Docker runtime (Docker Desktop, OrbStack, …), [pnpm](https://pnpm.io), and [uv](https://docs.astral.sh/uv/) (or pdm).

```bash
./start-local.sh                        # Claude Code
AGENT_BACKEND=hermes ./start-local.sh   # Hermes
```

It starts MongoDB in Docker and the backend and frontend on this machine, then opens [http://localhost:3000](http://localhost:3000). The agent you start with runs the kickstart, suggestions, summaries, reports and naming, and is the default for answers; the model picker lets any question be answered by either agent, on any model its plan offers. Ctrl-C stops the session; MongoDB keeps running (`docker compose stop mongodb` stops it).

What to know:

- **Local only.** There is no sign-in, so the backend accepts only connections from this machine, and refuses state-changing requests that a browser marks as coming from another website. Both servers and MongoDB listen on 127.0.0.1 only. Never run it on a server, and don't use it on a machine other people have accounts on: any local account can reach it.
- **Every call counts against your plan**, including the kickstart, suggestions, summaries and naming, not just answers. At most two run at once (`AGENT_CONCURRENCY`).
- **Models:** each answer runs the model its question picks: Claude Haiku 4.5, Sonnet 5.5, Opus 5.5 or Fable 5.1 on Claude Code, or GPT-6 Luna, Sol, 6.1 Sol or Astra on Hermes. The agent's own work (kickstart, suggestions, summaries, reports, naming) runs `sonnet` on Claude Code and `gpt-6-astra` on Hermes. Both agents run at medium effort. Change the model with `CLAUDE_CODE_MODEL` and `HERMES_MODEL`, the effort with `CLAUDE_CODE_EFFORT` and `HERMES_REASONING`, and Hermes's provider (`openai-codex` by default) with `HERMES_PROVIDER`, in `backend/.env`.
- **PDFs** are read as their text, extracted on this machine (up to 300 pages and about 50K tokens each). Scanned, password-protected or damaged PDFs can't be read; answers say so at the top.
- **Web search** runs through the [Kagi Search API](https://help.kagi.com/kagi/api/search.html) or [Mixedbread's web store](https://www.mixedbread.com/docs/stores/search/web-store), with your own key: put `KAGI_API_KEY=...` and/or `MIXEDBREAD_API_KEY=...` in `backend/.env`, and pick one under **Search with** in Settings (Kagi by default). Each provider bills its searches. With search on, the answering agent first writes up to three queries (one small extra call on your plan), Talleyrand runs them on the chosen provider and hands the agent the results, and the answer's sources list every result, with the ones it links marked cited. Without the chosen provider's key, answers say at the top that search didn't run; turn search off in Settings to drop the note.
- **Billing:** Claude Code runs get no API keys, `./start-local.sh` refuses to start unless Claude Code is signed in with a subscription, and a run that still reports API-key billing is killed the moment it says so. That last check is a fast stop, not a guarantee. Hermes offers no such check: it uses whatever its own configuration provides, and it loads the API keys in `~/.hermes/.env` for its own side calls (Hermes also titles each run with an extra small model call).
- **Transcripts:** Claude Code runs keep no session. Hermes keeps its runs in its own session store, out of your session lists, and writes a failed request, prompt included, to `~/.hermes/sessions`.
- **Cases from a hosted Talleyrand** belong to the email you signed in with there. Set `LOCAL_USER_EMAIL` to that address in `backend/.env` to open them from the same database. Answers written by a GPT or Claude API model reopen on the matching model here.

## Development

### Backend

1. Install [PDM](https://pdm-project.org/en/latest/#installation), then the exact Python named in
   `backend/.python-version` — `pdm python install cpython@3.13.11`. Other versions are untested.

   Avoid `pdm use`: it rewrites `.python-version` to the major.minor only, which silently drops the
   patch pin and lets a later environment be built on a different 3.13.x.
2. Install the environment:

   ```bash
   cd backend
   pdm install
   ```

Re-run `pdm install` whenever the dependencies in `pyproject.toml` or `pdm.lock` change — an environment
built from an older lock can pass tests that fail on a fresh install.

Lint, format, and test:

```bash
cd backend
pdm lint    # ruff check .
pdm format  # ruff format .
pdm test    # pytest
```

Pre-commit hooks for linting and formatting are installed automatically by `pdm install`.

**VS Code:** after the virtual environment exists, point the editor at it — `⌘⇧P` → *Python: Select interpreter* → *Enter interpreter path* → `⌘⇧.` to show hidden files → `./backend/.venv`.

### Frontend

1. Install [pnpm](https://pnpm.io/installation) and Node 22.21.1. With nvm, `cd frontend && nvm use`
   reads the version from `.nvmrc` and switches for you. pnpm's own version is pinned by the
   `packageManager` field in `package.json` and switches automatically, so it does not matter which
   pnpm you install.
2. Install dependencies:

   ```bash
   cd frontend
   pnpm install
   ```

Build and check formatting:

```bash
cd frontend
pnpm build         # type-check and build; use this instead of pnpm start to verify a change
pnpm format:check
```

When the backend API changes, regenerate the typed client with `pnpm generate-openapi` (with `./start-local.sh` running).

## Known rough edges

- Every toolchain version is pinned to one exact release: Python and Node in `.python-version` / `.node-version`, pdm in `start-local.sh`, pnpm in `package.json`. A version bump means changing all of them together.
- The Node version is written twice — `frontend/.node-version` and `frontend/.nvmrc` for nvm, which does not read the former. They must hold the same value.
- Nothing runs the test suite automatically. There is no CI, so a broken test only shows up when someone runs it by hand.
- The frontend bundle is shipped as a single chunk and is larger than it needs to be.

## License

MIT — see [LICENSE](LICENSE).

Built by [Sage](https://sage-future.org/).
