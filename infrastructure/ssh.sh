#!/usr/bin/env bash
# SSH into the site's VM over IAP. Its name changes on every swap, so this finds it by
# label, like the Deploy workflow. Arguments after the options run as a command.
#
#   infrastructure/ssh.sh                                 # interactive shell
#   infrastructure/ssh.sh 'sudo systemctl status nginx'
#   infrastructure/ssh.sh --vm flask-vm-3fa9c2 'sudo tail /var/log/startup-script.log'
#
# --vm picks a VM by name, e.g. the new one during a failed swap.
set -euo pipefail

ZONE="${ZONE:-us-central1-a}"
vm=''
if [[ "${1:-}" == --vm ]]; then
  vm="${2:?--vm needs a VM name}"
  shift 2
fi

if [[ -z "$vm" ]]; then
  mapfile -t vms < <(gcloud compute instances list --zones "$ZONE" \
    --filter="labels.app=personalwebsite" --format='value(name)' 2>/dev/null)
  if ((${#vms[@]} != 1)); then
    echo "Found ${#vms[@]} VMs (${vms[*]:-none}): a swap is in progress or failed. Pick one with --vm." >&2
    exit 1
  fi
  vm="${vms[0]}"
fi

args=(compute ssh "$vm" --zone "$ZONE" --tunnel-through-iap)
if (($#)); then
  args+=(--command "$*")
fi
exec gcloud "${args[@]}"
