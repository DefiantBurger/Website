#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
BACKEND_PYTHON="$BACKEND_DIR/.venv/bin/python"

FRONTEND_DIR="$SCRIPT_DIR/frontend"
FRONTEND_CMD=(pnpm run dev)

# Load nvm so pnpm can use the correct Node version
[ -s "$HOME/.nvm/nvm.sh" ] && \. "$HOME/.nvm/nvm.sh"

export FLASK_ENV="${FLASK_ENV:-development}"
export PORT="${PORT:-5000}"
export SECRET_KEY="${SECRET_KEY:-local-dev-secret}"
export VITE_BACKEND_URL="${VITE_BACKEND_URL:-http://localhost:${PORT}}"

# Job control gives each background server its own process group, so cleanup
# can signal the whole tree. Killing just the subshell PID orphans whatever it
# spawned (pnpm -> sh -> vite), leaving the port held after a plain `kill`.
set -m

echo "Starting backend on http://localhost:${PORT}"
(cd "$BACKEND_DIR" && "$BACKEND_PYTHON" main.py) &
BACKEND_PID=$!

echo "Starting frontend with ${FRONTEND_CMD[*]}"
(cd "$FRONTEND_DIR" && "${FRONTEND_CMD[@]}") &
FRONTEND_PID=$!

cleanup() {
  echo
  echo "Stopping services..."

  # With set -m, each background job's PID is also its process group ID.
  kill -TERM -- "-$BACKEND_PID" "-$FRONTEND_PID" >/dev/null 2>&1 || true

  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

wait -n "$BACKEND_PID" "$FRONTEND_PID"
