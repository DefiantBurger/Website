#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
BACKEND_PYTHON="$BACKEND_DIR/.venv/bin/python"

FRONTEND_DIR="$SCRIPT_DIR/frontend"
FRONTEND_CMD=(pnpm run dev)

export FLASK_ENV="${FLASK_ENV:-development}"
export PORT="${PORT:-5000}"
export SECRET_KEY="${SECRET_KEY:-local-dev-secret}"
export VITE_BACKEND_URL="${VITE_BACKEND_URL:-http://localhost:${PORT}}"

echo "Starting backend on http://localhost:${PORT}"
(cd "$BACKEND_DIR" && "$BACKEND_PYTHON" main.py) &
BACKEND_PID=$!

echo "Starting frontend with ${FRONTEND_CMD[*]}"
(cd "$FRONTEND_DIR" && "${FRONTEND_CMD[@]}") &
FRONTEND_PID=$!

cleanup() {
  echo
  echo "Stopping services..."

  if kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi

  if kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi

  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

wait -n "$BACKEND_PID" "$FRONTEND_PID"
