# Talleyrand

A tool for thinking through complex topics rigorously. You work a case as a tree of questions: each question gets a short, focused answer, and depth comes from the follow-up questions you file under it — your own, suggested ones, or questions about a passage you select in an answer. Every answer is written with your whole case as context, and you can turn the finished tree into a report or share it as a read-only page.

## Local Start

This is a web application intended for deployment. Before starting, we need to configure some settings.

1. Clone the repository:

```bash
git clone https://github.com/Sage-Future/Talleyrand.git
```

2. Create the .env file. We will fill it in the following steps.

```bash
cp backend/.env.example backend/.env
```

3. Generate `JWT_SECRET_KEY` for the .env file:

```bash
openssl rand -hex 32
```

4. Set up Google OAuth2 (used for login).
- Open [Google Cloud Console](https://console.cloud.google.com/)
- Select or create a project
- Open "API & Services" -> "Credentials"

If you have already set up the project, you can select an existing OAuth2.0 Client ID. If you haven't, create a new one:
- "+ Create credentials" -> "OAuth2 Client ID"
- Application type: "Web application"
- Authorized JavaScript origins: "http://localhost:8000"
- Authorized redirect URIs: "http://localhost:8000/backend/oauth/google/callback"
- Save.

Now open .env and fill `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`.

5. Run

```bash
docker-compose up
```

or to get rid of MongoDB logs:
```bash
docker-compose up -d
docker-compose logs -f backend frontend
```

Then open [http://localhost:3000](http://localhost:3000) in your browser. This runs the frontend at :3000, the backend at :8000, and MongoDB.

Model API keys (OpenAI, and optionally Anthropic) are not server configuration: each user enters their own keys in the app's Settings, and they are sent with each request.

## Deployment

You can deploy the frontend and backend to Render.

### Backend

Build command: 
```
pip install -U pdm && pdm install --prod --frozen --no-editable
```

Start command:
```
pdm run start
```

### Frontend

Build command:
```
pnpm install --frozen-lockfile; pnpm run build
```

Publish Directory:
```
dist
```


## Development

### Backend
1. Install [PDM](https://pdm-project.org/en/latest/#installation)
2. Install environment:

```bash
cd backend
pdm install
```

Use `pdm install` when you change .toml dependencies.

**VSCode Setup:** After creating the Python virtual environment, set the interpreter path:

1. Press `CMD` + `SHIFT` + `P`
2. Select `Python: Select interpreter`
3. Choose `Enter interpreter path`
4. Press `CMD` + `SHIFT` + `.` to show hidden files
5. Navigate to `./backend/.venv` and select it

We use Ruff for linting and formatting:
```bash
cd backend
pdm lint  # ruff check .
pdm format  # ruff format .
```

We use pre-commit hooks for linting and formatting. They are installed automatically after `pdm install`.

### Frontend
1. Install [PNPM](https://pnpm.io/installation).
2. Install dependencies:

```bash
cd frontend
pnpm install
```

### Notes
Two things I want to keep in mind: we do not lock the pdm and pnpm versions, and there is a difference between the local containerized environment and the deployed environment. It works now, but it might cause unexpected problems later.