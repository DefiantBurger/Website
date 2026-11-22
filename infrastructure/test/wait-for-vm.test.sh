#!/usr/bin/env bash
# Tests infrastructure/wait-for-vm.sh against a stub gcloud.
#
#   infrastructure/test/wait-for-vm.test.sh <scratch dir>
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
STUB="${1:?scratch dir}"
mkdir -p "$STUB/bin"

# The stub's guest attribute appears after $STUB/polls_left reaches 0, with the value in
# $STUB/value; $STUB/vms lists the labeled VMs; $STUB/error is printed on the first poll.
cat > "$STUB/bin/gcloud" <<EOF
#!/usr/bin/env bash
case "\$3" in
	get-guest-attributes)
		if [[ -f "$STUB/error" ]]; then cat "$STUB/error" >&2; rm "$STUB/error"; exit 1; fi
		left=\$(cat "$STUB/polls_left")
		if ((left > 0)); then
			echo \$((left - 1)) > "$STUB/polls_left"
			echo "ERROR: (gcloud.compute.instances.get-guest-attributes) HTTPError 404: The resource 'personalwebsite/ready' of type 'Guest Attribute' was not found." >&2
			exit 1
		fi
		cat "$STUB/value" ;;
	list) cat "$STUB/vms" ;;
esac
EOF
chmod +x "$STUB/bin/gcloud"

# wait_for <value> <polls before it appears> <labeled VMs>: sets RC, OUT (stdout + stderr).
wait_for() {
	echo "$1" > "$STUB/value"
	echo "$2" > "$STUB/polls_left"
	printf '%s\n' "${@:3}" > "$STUB/vms"
	OUT="$(PATH="$STUB/bin:$PATH" VM=flask-vm-new ZONE=z PROJECT=p TIMEOUT_SECONDS=2 POLL_SECONDS=0.1 \
		"$HERE/../wait-for-vm.sh" 2>&1)"
	RC=$?
}

echo "Ready after a few polls"
wait_for 0123abc 3 flask-vm-old flask-vm-new
check "succeeds (exit $RC)" '[[ $RC == 0 ]]'
check "reports the release" 'grep -q "flask-vm-new is ready, serving 0123abc" <<< "$OUT"'

echo "Never ready"
wait_for 0123abc 999 flask-vm-old flask-vm-new
check "fails (exit $RC)" '[[ $RC == 1 ]]'
check "says the old VM still serves" 'grep -q "Any previous VM is still serving" <<< "$OUT"'
check "points to the serial log" 'grep -q "get-serial-port-output flask-vm-new" <<< "$OUT"'

echo "No release published, first-time setup"
wait_for none 0 flask-vm-new
check "succeeds (exit $RC)" '[[ $RC == 0 ]]'
check "says to run Deploy" 'grep -q "run Deploy" <<< "$OUT"'

echo "No release published, during a swap"
wait_for none 0 flask-vm-old flask-vm-new
check "fails (exit $RC)" '[[ $RC == 1 ]]'
check "names the VM it would replace" 'grep -q "would replace flask-vm-old" <<< "$OUT"'

echo "An unexpected gcloud error"
echo "ERROR: (gcloud.compute.instances.get-guest-attributes) HTTPError 403: Permission denied" > "$STUB/error"
wait_for 0123abc 1 flask-vm-new
check "keeps polling and succeeds (exit $RC)" '[[ $RC == 0 ]]'
check "shows the error" 'grep -q "HTTPError 403" <<< "$OUT"'
check "hides the expected 404s" '! grep -q "HTTPError 404" <<< "$OUT"'

finish
