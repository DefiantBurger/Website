#!/usr/bin/env bash
# Runs every local check: backend tests, frontend unit tests, type check and
# build, and the browser checks (smoke test and a11y scan). Keeps going after a
# failure so one run shows everything, then exits 1 if anything failed.
#
#   ./test.sh                # all checks
#   ./test.sh --no-browser   # skip the browser checks (faster, no Chrome needed)
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_BROWSER=1

for arg in "$@"; do
  case "$arg" in
    --no-browser) RUN_BROWSER=0 ;;
    -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Load nvm so pnpm can use the correct Node version
[ -s "$HOME/.nvm/nvm.sh" ] && \. "$HOME/.nvm/nvm.sh"

PASSED=()
FAILED=()

run_check() {
  local name="$1" dir="$2"
  shift 2
  echo
  echo "==> $name"
  if (cd "$ROOT_DIR/$dir" && "$@"); then
    PASSED+=("$name")
  else
    FAILED+=("$name")
  fi
}

run_check "backend tests" backend uv run pytest
run_check "frontend unit tests" frontend pnpm test
run_check "frontend check" frontend pnpm check
run_check "frontend build" frontend pnpm build

DEV_PID=""
stop_dev() {
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    # start-dev.sh traps TERM and stops both servers' process groups itself.
    kill "$DEV_PID" 2>/dev/null
    wait "$DEV_PID" 2>/dev/null
  fi
  DEV_PID=""
}
trap stop_dev EXIT
trap 'exit 130' INT TERM

up() { curl -s -o /dev/null --max-time 2 "$1"; }

if [ "$RUN_BROWSER" -eq 1 ]; then
  # The browser checks need both servers. Reuse ones that are already running so this
  # works alongside an open ./start-dev.sh instead of fighting it for ports.
  if up http://localhost:5173 && up http://localhost:5000/api/health/; then
    echo
    echo "==> Using dev servers already running"
  else
    echo
    echo "==> Starting dev servers for browser checks"
    DEV_LOG="${TMPDIR:-/tmp}/test-sh-dev.log"
    echo "    (server output: $DEV_LOG)"
    "$ROOT_DIR/start-dev.sh" >"$DEV_LOG" 2>&1 &
    DEV_PID=$!
    for _ in $(seq 1 60); do
      up http://localhost:5173 && up http://localhost:5000/api/health/ && break
      kill -0 "$DEV_PID" 2>/dev/null || break
      sleep 1
    done
  fi
  run_check "smoke test" frontend pnpm smoke
  run_check "a11y scan" frontend pnpm a11y
  stop_dev
fi

echo
echo "==> Summary"
for name in "${PASSED[@]}"; do echo "  pass  $name"; done
for name in "${FAILED[@]}"; do echo "  FAIL  $name"; done
[ "$RUN_BROWSER" -eq 1 ] || echo "  skip  smoke test, a11y scan"

[ "${#FAILED[@]}" -eq 0 ]
