#!/usr/bin/env bash
# Tests the VM's scripts and the swap mechanism locally (see "Testing VM changes" in
# documentation/DEPLOYMENT.md). Only rendering the startup script reads anything remote:
# Terraform state, through tf.sh. Needs Docker, shellcheck, Terraform, and tf.sh's gcloud
# login. Takes about 5 minutes.
#
#   deployment/test/run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failed=()

section() { printf '\n=== %s\n' "$1"; }

section "Terraform swap ordering"
"$HERE/swap-order.test.sh" "$WORK/swap-order" || failed+=("swap ordering")

section "wait-for-vm.sh"
"$HERE/wait-for-vm.test.sh" "$WORK/wait" || failed+=("wait-for-vm.sh")

section "Render and lint"
R="$WORK/render"
mkdir -p "$R"
# The exact script main.tf ships, and the files embedded in it.
if echo 'base64encode(local.startup_script)' | "$HERE/../tf.sh" console | tr -d '"\n' | base64 -d > "$R/startup.sh" \
	&& [[ -s "$R/startup.sh" ]]; then
	grep -oP "^\twrite_file \K\S+ \S+ root:root < <\(base64 --decode <<< '[^']+" "$R/startup.sh" |
		while read -r dest _ _ _ _ _ _ b64; do
			mkdir -p "$(dirname "$R/files$dest")"
			base64 -d <<< "${b64#\'}" > "$R/files$dest"
		done
	echo "Rendered startup.sh with $(find "$R/files" -type f | wc -l) files"
	shellcheck -s bash "$R/startup.sh" "$R/files/usr/local/sbin/personalwebsite-deploy" \
		"$HERE/../wait-for-vm.sh" "$HERE/../ssh.sh" "$HERE"/*.sh "$HERE/image/gcloud" \
		&& echo "shellcheck clean" || failed+=("shellcheck")

	section "VM scenarios"
	"$HERE/vm.test.sh" "$R" || failed+=("VM scenarios")
else
	echo "Rendering failed; skipping the VM scenarios."
	failed+=("render")
fi

echo
if ((${#failed[@]})); then
	echo "FAILED: ${failed[*]}"
	exit 1
fi
echo "All passed."
