#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is required to fetch CLOUDFLARE_API_TOKEN from Secret Manager." >&2
  exit 1
fi

GSM_CLOUDFLARE_TOKEN_SECRET="${GSM_CLOUDFLARE_TOKEN_SECRET:-cloudflare-api-token}"
GSM_CLOUDFLARE_TOKEN_VERSION="${GSM_CLOUDFLARE_TOKEN_VERSION:-latest}"
GSM_CLOUDFLARE_TOKEN_PROJECT="${GSM_CLOUDFLARE_TOKEN_PROJECT:-${TF_VAR_project_id:-}}"

if [[ -z "$GSM_CLOUDFLARE_TOKEN_PROJECT" ]]; then
  GSM_CLOUDFLARE_TOKEN_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
fi

if [[ -z "$GSM_CLOUDFLARE_TOKEN_PROJECT" ]]; then
  echo "Unable to determine GCP project for Secret Manager token lookup." >&2
  echo "Set GSM_CLOUDFLARE_TOKEN_PROJECT, TF_VAR_project_id, or gcloud default project." >&2
  exit 1
fi

export CLOUDFLARE_API_TOKEN
CLOUDFLARE_API_TOKEN="$(gcloud secrets versions access "$GSM_CLOUDFLARE_TOKEN_VERSION" --secret="$GSM_CLOUDFLARE_TOKEN_SECRET" --project="$GSM_CLOUDFLARE_TOKEN_PROJECT")"

if [[ -z "$CLOUDFLARE_API_TOKEN" ]]; then
  echo "Fetched CLOUDFLARE_API_TOKEN is empty." >&2
  exit 1
fi

cd "$SCRIPT_DIR"
exec terraform "$@"