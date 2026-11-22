#!/usr/bin/env bash
# Run by Terraform after it creates a VM (terraform_data.vm_ready in main.tf): waits for
# the VM's startup script to mark it ready, meaning it serves a release through the
# tunnel. On a swap, Terraform destroys the old VM only if this succeeds. See "VM swaps"
# in documentation/INFRASTRUCTURE.md.
#
#   VM=<name> ZONE=<zone> PROJECT=<project> infrastructure/wait-for-vm.sh
set -euo pipefail

: "${VM:?}" "${ZONE:?}" "${PROJECT:?}"
# Overridable for infrastructure/test/; a first boot takes about 4 minutes.
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-900}"
POLL_SECONDS="${POLL_SECONDS:-10}"

fail() {
  echo "wait-for-vm: $*" >&2
  echo "  Startup log: gcloud compute instances get-serial-port-output $VM --zone $ZONE --project $PROJECT | grep startup-script" >&2
  echo "  Then see \"Swap the VM\" in documentation/RUNBOOK.md." >&2
  exit 1
}

# The guest attribute the startup script sets (mark_ready): a commit SHA, `none` before
# the first release, or empty while it isn't set yet.
ready_value() {
  local out
  if out="$(gcloud compute instances get-guest-attributes "$VM" --zone "$ZONE" --project "$PROJECT" \
    --query-path=personalwebsite/ready --format='value(value)' 2>&1)"; then
    echo "$out"
  elif [[ "$out" != *"HTTPError 404"* ]]; then
    echo "wait-for-vm: $out" >&2 # Worth seeing, but may be transient, so keep polling.
  fi
}

other_vms() {
  gcloud compute instances list --project "$PROJECT" --filter="labels.app=personalwebsite" \
    --format='value(name)' 2>/dev/null | grep -vx "$VM" || true
}

echo "Waiting up to $((TIMEOUT_SECONDS / 60)) min for $VM to serve through the tunnel..."
deadline=$((SECONDS + TIMEOUT_SECONDS))
next_progress=$((SECONDS + 60))
while ((SECONDS < deadline)); do
  value="$(ready_value)"
  case "$value" in
    '') ;;
    none)
      # Only fine on first-time setup: in a swap it would replace a serving VM with an empty one.
      others="$(other_vms)"
      [[ -z "$others" ]] || fail "$VM found no published release, so it would replace $others with an empty site."
      echo "$VM is ready, but no release is published yet: run Deploy."
      exit 0
      ;;
    *)
      echo "$VM is ready, serving $value."
      exit 0
      ;;
  esac
  if ((SECONDS >= next_progress)); then
    echo "  still waiting ($((SECONDS / 60)) min)"
    next_progress=$((SECONDS + 60))
  fi
  sleep "$POLL_SECONDS"
done
fail "$VM didn't mark itself ready within $((TIMEOUT_SECONDS / 60)) min. Any previous VM is still serving."
