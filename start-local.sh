#!/usr/bin/env bash
# Start a local Talleyrand session: MongoDB in Docker, the backend and frontend
# on this machine, and every model call on your own signed-in agent CLI and its
# subscription. No accounts, no API keys. Ctrl-C stops the session.
#
#   ./start-local.sh                       # Claude Code (your Claude plan)
#   AGENT_BACKEND=hermes ./start-local.sh  # Hermes (by default your ChatGPT plan)
#
# The agent named here runs the kickstart, suggestions, summaries, reports and
# naming; each question can still be answered by either one in the model picker.
#
# One-time setup: Docker, pnpm, uv (or pdm), and a signed-in agent:
# `claude auth login`, or Hermes signed in to its provider (`hermes setup`).
set -euo pipefail
cd "$(dirname "$0")"

die() {
  echo "start-local: $*" >&2
  exit 1
}

# --- preflight ---------------------------------------------------------------
docker info >/dev/null 2>&1 || die "Docker is not running. Start your Docker runtime (Docker Desktop, OrbStack, ...) and try again."
command -v pnpm >/dev/null || die "pnpm is not installed."
AGENT_BACKEND="${AGENT_BACKEND:-claude_code}"
case "$AGENT_BACKEND" in
  claude_code)
    command -v claude >/dev/null || die "Claude Code is not installed (https://claude.com/claude-code)."
    ;;
  hermes)
    command -v hermes >/dev/null || die "Hermes is not installed."
    ;;
  *) die "AGENT_BACKEND must be claude_code or hermes, not '$AGENT_BACKEND'." ;;
esac
if command -v pdm >/dev/null; then
  PDM="pdm"
elif command -v uvx >/dev/null; then
  PDM="uvx pdm@2.29.0" # pinned, so every machine reads pdm.lock the same way
else
  die "Neither pdm nor uv is installed."
fi
for port in 8000 3000; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    die "Port $port is already in use. Is another Talleyrand session running?"
  fi
done
if [ "$AGENT_BACKEND" = claude_code ]; then
  # Refused, not warned: a Console or API-key login would bill every call to
  # the API. The backend also stops such runs, but only once they have started.
  if ! claude auth status --json 2>/dev/null | grep -Eq '"authMethod": *"claude.ai"'; then
    die "Claude Code is not signed in with a Claude subscription. Run: claude auth login"
  fi
else
  provider="${HERMES_PROVIDER:-openai-codex}"
  if ! hermes auth status "$provider" 2>/dev/null | grep -q "logged in"; then
    echo "start-local: warning: Hermes is not signed in to $provider." >&2
    echo "start-local: model calls will fail until you sign in (hermes setup)." >&2
  fi
fi

# The backend never passes these to an agent CLI anyway; this is a second guard
# against a run landing on API billing instead of the subscription.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OPENAI_API_KEY

# --- MongoDB -----------------------------------------------------------------
docker compose up -d mongodb >/dev/null
echo "start-local: waiting for MongoDB..."
# A port check, not `docker compose exec`: exec refuses to run without
# backend/.env, which a local session doesn't need. The port only answers once
# the real server is up (first-run initialization listens inside the container).
for i in $(seq 60); do
  nc -z localhost 27017 >/dev/null 2>&1 && break
  [ "$i" = 60 ] && die "MongoDB did not come up. See: docker compose logs mongodb"
  sleep 1
done

# --- dependencies (first run only) -------------------------------------------
[ -x backend/.venv/bin/uvicorn ] || (cd backend && $PDM install)
[ -x frontend/node_modules/.bin/vite ] || (cd frontend && pnpm install --frozen-lockfile)

# --- backend and frontend ----------------------------------------------------
BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
  # Every step must run whatever state the two halves are in: under errexit a
  # failed kill (a half that already exited) would end the trap early and
  # leave the other half running.
  set +e
  trap - EXIT
  echo
  echo "start-local: stopping..."
  # The backend's shutdown kills any agent run still in flight.
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  wait 2>/dev/null
  echo "start-local: stopped. MongoDB keeps running; stop it with: docker compose stop mongodb"
}
trap cleanup EXIT
# Ctrl-C, TERM and a closed terminal (HUP) end the script, which runs cleanup
# exactly once on the way out.
trap 'exit 130' INT TERM
trap 'exit 129' HUP

# Loopback only: there is no sign-in, so the network is the boundary.
(
  cd backend
  # A closed terminal sends HUP to everything in it, and uvicorn dies on HUP
  # without shutting down, orphaning any agent run in flight. Ignoring it
  # leaves the stop to cleanup, whose TERM gets the orderly shutdown.
  trap '' HUP
  export AGENT_BACKEND
  export MONGODB_URL=mongodb://admin:admin@localhost:27017
  exec .venv/bin/uvicorn talleyrand.main:app --host 127.0.0.1 --port 8000 \
    --timeout-graceful-shutdown 10
) &
BACKEND_PID=$!

echo "start-local: waiting for the backend..."
until curl -sf http://127.0.0.1:8000/backend/health >/dev/null; do
  kill -0 "$BACKEND_PID" 2>/dev/null || die "The backend failed to start (see the output above)."
  sleep 0.5
done

(
  cd frontend
  export VITE_BACKEND_URL=localhost:8000 VITE_IS_SECURE=false VITE_AGENT_BACKEND="$AGENT_BACKEND"
  exec node_modules/.bin/vite --host 127.0.0.1 --port 3000 --strictPort
) &
FRONTEND_PID=$!

until curl -sf http://127.0.0.1:3000 >/dev/null; do
  kill -0 "$FRONTEND_PID" 2>/dev/null || die "The frontend failed to start (see the output above)."
  sleep 0.5
done

echo
echo "start-local: Talleyrand is running at http://localhost:3000 on $AGENT_BACKEND (Ctrl-C to stop)"
open http://localhost:3000/research 2>/dev/null || true

# Stop the whole session as soon as either half exits.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
