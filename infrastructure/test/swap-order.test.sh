#!/usr/bin/env bash
# Checks the Terraform behavior VM swaps depend on, with swap-order/main.tf: the old VM
# and its IAM binding are destroyed only after the new VM's readiness check succeeds,
# and never while it fails. Guards against a Terraform upgrade changing that.
#
#   infrastructure/test/swap-order.test.sh <scratch dir>
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
WORK="${1:?scratch dir}"
mkdir -p "$WORK" && cp "$HERE/swap-order/main.tf" "$WORK/"
cd "$WORK" || exit 1
terraform init -no-color -input=false >/dev/null || { echo "terraform init failed"; exit 1; }

# apply <image> <ready: true|false>: sets RC and OUT (Terraform's progress lines).
apply() {
	OUT="$(terraform apply -auto-approve -no-color -input=false -var "image=$1" -var "ready=$2" 2>&1)"
	RC=$?
}
line() { grep -n -m1 -E "$1" <<< "$OUT" | cut -d: -f1; }
ready_done() { line 'terraform_data\.ready: Creation complete'; }
destroyed() { line "terraform_data\.$1 \(deposed object [0-9a-f]+\): Destroying"; }
# The old vm and iam are destroyed, both after the readiness check passed.
check_swapped() {
	check "succeeds (exit $RC)" '[[ $RC == 0 ]]'
	check "old VM destroyed after the check" '[[ -n "$(destroyed vm)" && "$(destroyed vm)" -gt "$(ready_done)" ]]'
	check "old IAM binding removed after the check" '[[ -n "$(destroyed iam)" && "$(destroyed iam)" -gt "$(ready_done)" ]]'
}
check_kept() {
	check "fails (exit $RC)" '[[ $RC != 0 ]]'
	check "old VM kept" '[[ -z "$(destroyed vm)" ]]'
	check "old IAM binding kept" '[[ -z "$(destroyed iam)" ]]'
}

apply a true
check "baseline applies" '[[ $RC == 0 ]]'
echo "Swap a -> b"
apply b true
check_swapped
echo "Swap b -> c, new VM never ready"
apply c false
check_kept
echo "Retry while c is still broken"
apply c false
check_kept
echo "Retry after c recovered"
apply c true
check_swapped
echo "Swap c -> d fails, then roll back to c"
apply d false
check_kept
apply c true
check_swapped
check "both old VMs destroyed" '[[ $(grep -c -E "terraform_data\.vm \(deposed object [0-9a-f]+\): Destroying" <<< "$OUT") == 2 ]]'

finish
