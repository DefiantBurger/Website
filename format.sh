#!/usr/bin/env bash
# Formats every file: sorts Python imports and runs Ruff's formatter on the
# backend, and Prettier on the frontend. Only formatting changes; lint fixes
# that change code (unused imports, ESLint rules) are left to you.
#
#   ./format.sh
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

# Load nvm so pnpm can use the correct Node version
[ -s "$HOME/.nvm/nvm.sh" ] && \. "$HOME/.nvm/nvm.sh"

FAILED=0

echo "==> backend"
# Import order is a lint rule in Ruff, so the formatter alone doesn't sort imports.
(cd "$ROOT_DIR/backend" && uv run ruff check --select I --fix --quiet . && uv run ruff format .) || FAILED=1

echo
echo "==> frontend"
(cd "$ROOT_DIR/frontend" && pnpm --silent format --log-level warn) || FAILED=1

[ "$FAILED" -eq 0 ]
