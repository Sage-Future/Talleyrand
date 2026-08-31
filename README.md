# Talleyrand

**Ask better questions.**

Research means dozens of open questions, and it's easy to lose the thread. A linear chat only grows — you end up scrolling back and forth to find what you already worked out. Talleyrand keeps every question in one tree, answers each with the whole case in context, and always shows you the next question worth asking. The longer a case runs, the better it understands what you're after.

Free and open source. You bring your own model API key.

**[Try it at talleyrand.app](https://talleyrand.app)** — or read a real case first: [compute governance](https://talleyrand.app/shared/demo-compute-governance) · [moral progress](https://talleyrand.app/shared/demo-moral-progress) · [the Big Five](https://talleyrand.app/shared/demo-big-five) · [free will](https://talleyrand.app/shared/demo-free-will)

## How it works

**Start from a mess, not a blank page.** Type or dictate a stream of thoughts — what you know, what you want to know, notes, doubts, half-formed hunches. Talleyrand turns it into a short brief and your first questions.

**Branch a follow-up from any sentence.** See something worth digging into? Select it and ask. The new question is filed under the one it came from.

**One tree, whole-case context.** Every answer is written with the brief, every other thread, your highlights and your reactions in view. The tree tracks what's waiting, what you've read, and what's settled.

**It proposes what's next, and learns from you.** After each answer it suggests follow-ups, plus big-picture questions that challenge your framing. Accept them, or decline and say why. Every heart, highlight, and decline sharpens what it proposes next.

Also in the box: insight highlights that feed later answers, cross-links between questions, a choice of GPT and Claude models at any thinking level, attached documents for a case or a single question, one-click Markdown reports, read-only share links others can copy and continue, dictation, and server-side generation so closing the tab never loses work in flight.

## What you need to use it

- A Google account (sign-in is Google OAuth only).
- **An OpenAI API key — required.** It powers the kickstart, suggestions, reports, and summaries.
- An Anthropic API key — optional, for answering with Claude models.

Keys are entered in the app's Settings, kept in your browser, and sent with each request. They are never stored on the server, so a self-hosted instance needs no model API keys of its own.

## Run it locally

**You need:** Docker Desktop (or Docker Engine + Compose v2), and a Google Cloud account to create OAuth credentials. The app will not start without Google OAuth configured — sign-in is the only way in.

**1. Clone the repository.**

```bash
git clone https://github.com/Sage-Future/Talleyrand.git && cd Talleyrand
```

**2. Create the `.env` file.** The next steps fill it in.

```bash
cp backend/.env.example backend/.env
```

**3. Generate a `JWT_SECRET_KEY`** and put it in `backend/.env`. It must be at least 32 characters; the server refuses to start otherwise.

```bash
openssl rand -hex 32
```

**4. Set up Google OAuth.**

- Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
- Go to **APIs & Services → Credentials**.
- Pick an existing OAuth 2.0 Client ID, or create one: **+ Create credentials → OAuth client ID**, application type **Web application**.
- Under **Authorized redirect URIs**, add exactly:
  ```
  http://localhost:8000/backend/oauth/google/callback
  ```
- Save, then copy the client ID and secret into `backend/.env`:
  ```
  GOOGLE_CLIENT_ID=<your client id>
  GOOGLE_CLIENT_SECRET=<your client secret>
  GOOGLE_REDIRECT_URI=http://localhost:8000/backend/oauth/google/callback
  ```

You do **not** need to fill in "Authorized JavaScript origins" — sign-in is a server-side redirect, so Google never checks one.

**5. Start everything.**

```bash
docker compose up
```

Or, to skip the MongoDB logs:

```bash
docker compose up -d
docker compose logs -f backend frontend
```

**6. Open [http://localhost:3000](http://localhost:3000)** and sign in. The frontend runs on :3000, the backend on :8000, and MongoDB on :27017. The four demo cases above are seeded automatically on first start.

**7. Add your OpenAI API key** in the app's Settings, and you're ready to open a case.

To stop: `docker compose down`. To wipe the local database as well: `docker compose down -v`.

**If something goes wrong:** the backend restarts on a loop if its configuration is invalid, and the symptom is a sign-in button that does nothing. Run `docker compose logs backend` — a missing or malformed value is reported by name at the very end. After editing `backend/.env`, recreate the container rather than restarting it; `docker compose restart` does not re-read the file:

```bash
docker compose up -d --force-recreate backend
```

## Deploy

A deployment is three pieces: a MongoDB database, the backend as a web service, and the frontend as a static site. The instructions below are for [Render](https://render.com), which is what talleyrand.app runs on, but nothing here is Render-specific.

Pick the two public URLs up front — one for the site, one for the API (for example `https://example.com` and `https://api.example.com`). Several settings reference each other, and the frontend must be rebuilt if the API URL changes.

### 1. Database

Render does not offer MongoDB. Create a free cluster on [MongoDB Atlas](https://www.mongodb.com/atlas) (or host your own), allow network access from your backend, and keep the connection string for `MONGODB_URL`.

### 2. Backend — Render Web Service

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Build Command | `pip install pdm==2.29.0 && pdm install --prod --frozen --no-editable` |
| Start Command | `pdm run start` |

Setting the root directory is required — without it the build commands run at the repository root and fail.

Environment variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `PYTHON_VERSION` | yes | Must match `backend/.python-version` exactly (`3.13.11`). Render's default depends on when the service was created, and this variable takes precedence over the file. |
| `JWT_SECRET_KEY` | yes | A fresh `openssl rand -hex 32`, not the one from your laptop. Min 32 characters. |
| `GOOGLE_CLIENT_ID` | yes | From Google Cloud. |
| `GOOGLE_CLIENT_SECRET` | yes | From Google Cloud. |
| `GOOGLE_REDIRECT_URI` | yes | `https://api.example.com/backend/oauth/google/callback` — the **API** host, not the site host. |
| `AUTH_FAILURE_REDIRECT` | yes | `https://example.com/auth/failure`. Defaults to `localhost:3000`, so a failed login on a live site sends users nowhere useful if you skip this. |
| `CORS_ORIGINS` | yes | `["https://example.com"]`. This is also the allowlist of hosts users may be returned to after signing in, so the site origin must be here or login will fail. |
| `MONGODB_URL` | yes | Your Atlas connection string. |
| `MONGODB_DATABASE` | no | Defaults to `talleyrand`. |
| `EMAIL_WHITELIST_ENABLED` | no | See "Who can sign in" below. |
| `EMAIL_WHITELIST` | no | JSON list, e.g. `["you@example.com"]`. |
| `LOGGING_LEVEL` | no | Defaults to `INFO`. |

In a dashboard, enter list values without shell quotes: `["https://example.com"]`, not `'["https://example.com"]'`.

### 3. Frontend — Render Static Site

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Build Command | `pnpm install --frozen-lockfile; pnpm run build` |
| Publish Directory | `dist` |

Environment variables — these are read **at build time**, so changing them requires a rebuild:

| Variable | Value |
| --- | --- |
| `NODE_VERSION` | Must match `frontend/.node-version` exactly (`22.21.1`). Render's default depends on when the service was created, and this variable takes precedence over the file. |
| `VITE_BACKEND_URL` | `api.example.com` — the API host, with no protocol and no trailing slash. |
| `VITE_IS_SECURE` | `true` |

Without these the built site calls `localhost:8000` and nothing works.

Then add a **rewrite rule**, or every link other than the home page will 404 — including the share links you send people:

| Source | Destination | Action |
| --- | --- | --- |
| `/*` | `/index.html` | Rewrite |

### 4. Google OAuth for production

In the same Google Cloud project, add your production callback to **Authorized redirect URIs**:

```
https://api.example.com/backend/oauth/google/callback
```

Then publish the OAuth consent screen (**APIs & Services → OAuth consent screen**). While it is in *Testing*, only accounts you have explicitly added as test users can sign in — everyone else sees an access-denied error.

### 5. Who can sign in

By default, **anyone with a Google account can sign in to your instance** and start using your database. For a private deployment, restrict it:

```
EMAIL_WHITELIST_ENABLED=true
EMAIL_WHITELIST=["you@example.com","colleague@example.com"]
```

Each user still pays for their own model usage with their own API key, but they do use your database and your bandwidth.

## Development

### Backend

1. Install [PDM](https://pdm-project.org/en/latest/#installation), then the exact Python named in
   `backend/.python-version` — `pdm python install cpython@3.13.11`. The Docker image and the deployed
   service run that same version, down to the patch. Other versions are untested.

   Avoid `pdm use`: it rewrites `.python-version` to the major.minor only, which silently drops the
   patch pin and lets a later environment be built on a different 3.13.x.
2. Install the environment:

   ```bash
   cd backend
   pdm install
   ```

Re-run `pdm install` whenever the dependencies in `pyproject.toml` or `pdm.lock` change — an environment
built from an older lock will pass tests that fail in Docker and in production.

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

When the backend API changes, regenerate the typed client with `pnpm generate-openapi` (the backend must be running).

## Known rough edges

- Every toolchain version is pinned to one exact release: Python and Node in `.python-version` / `.node-version` and in the two `dev.Dockerfile`s, pdm and pnpm in those same images, and `PYTHON_VERSION` / `NODE_VERSION` on each deployed service. A version bump means changing all of them together, or the environments quietly diverge again.
- The Node version is written twice — `frontend/.node-version` for Render and `frontend/.nvmrc` for nvm, which does not read the former. They must hold the same value.
- `docker-compose.yml` deliberately tracks `mongo:8.0` rather than an exact patch. Production is MongoDB Atlas, which applies 8.0 patches on its own schedule, so a floating local tag stays closer to production than a frozen one would.
- Nothing runs the test suite automatically. There is no CI, and the deploy build command does not run `pdm test`, so a broken test only shows up when someone runs it by hand.
- The frontend bundle is shipped as a single chunk and is larger than it needs to be.

## License

MIT — see [LICENSE](LICENSE).

Built by [Sage](https://sage-future.org/).
