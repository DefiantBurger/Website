# shellcheck shell=bash
# Shared by the infrastructure/test/*.test.sh scripts.
FAILS=0
ok() { echo "  ok:   $1"; }
bad() {
	echo "  FAIL: $1"
	FAILS=$((FAILS + 1))
}
# check <description> <condition>: the condition is a string, evaluated in the caller's scope.
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
finish() {
	echo "$FAILS failure(s)"
	((FAILS == 0))
}
