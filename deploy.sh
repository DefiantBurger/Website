#!/usr/bin/env bash
# Deploys the tip of origin/main by dispatching the Deploy workflow, then
# follows the run and exits non-zero if it fails. Refuses to run unless local
# main matches origin/main, since the workflow ships GitHub's copy, not yours.
#
#   ./deploy.sh
set -euo pipefail

case "${1:-}" in
  '') ;;
  -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh (GitHub CLI) is required: https://cli.github.com" >&2
  exit 1
fi

git fetch --quiet origin main
local_sha="$(git rev-parse main)"
remote_sha="$(git rev-parse origin/main)"

if [[ "$local_sha" != "$remote_sha" ]]; then
  ahead="$(git rev-list --count origin/main..main)"
  behind="$(git rev-list --count main..origin/main)"
  echo "Local main and origin/main differ (ahead $ahead, behind $behind)." >&2
  echo "Push or pull first so you know exactly what ships." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Note: you have uncommitted changes; they will not be deployed."
fi

echo "Deploying $(git log -1 --format='%h %s' "$remote_sha")"

# Backdated a bit to tolerate clock skew between this machine and GitHub.
started_at="$(date -u -d '-10 seconds' +%Y-%m-%dT%H:%M:%SZ)"
gh workflow run deploy.yaml --ref main

# The new run takes a few seconds to appear; pick the first one created after dispatch.
run_id=''
for _ in $(seq 1 30); do
  run_id="$(gh run list --workflow deploy.yaml --branch main --event workflow_dispatch \
    --limit 1 --json databaseId,createdAt \
    -q ".[] | select(.createdAt >= \"$started_at\") | .databaseId")"
  [[ -n "$run_id" ]] && break
  sleep 2
done

if [[ -z "$run_id" ]]; then
  echo "Dispatched, but couldn't find the run. Check: gh run list --workflow deploy.yaml" >&2
  exit 1
fi

gh run watch "$run_id" --exit-status --interval 10
