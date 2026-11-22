#!/usr/bin/env bash
# Runs the rendered startup script in Debian 13 containers with systemd (see image/ for
# what's stubbed): first boot, reruns, config changes, failures, and the new VM in a swap.
# Four VMs run in parallel. KEEP=1 leaves the containers up for poking at.
#
#   infrastructure/test/vm.test.sh <render dir>   # startup.sh and files/, from run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
R="${1:?render dir}"
BASE="$R/startup.sh"
OUT="$R/vm-test"
IMAGE=pw-vm-test
GROUPS_=(main swap broken tunnel)
GOOD=1111111111111111111111111111111111111111
BROKEN=2222222222222222222222222222222222222222
SHA=0123456789abcdef0123456789abcdef01234567
mkdir -p "$OUT"

cleanup() {
	[[ "${KEEP:-}" == 1 ]] && return
	for group in "${GROUPS_[@]}"; do docker rm -f "pw-vm-$group" >/dev/null 2>&1; done
}
trap cleanup EXIT

x() { docker exec "$C" bash -c "$1"; }
start_vm() {
	C="$1"
	docker rm -f "$C" >/dev/null 2>&1
	docker run -d -t --name "$C" --cgroupns=private --cap-add SYS_ADMIN --cap-add NET_ADMIN --security-opt apparmor=unconfined \
		--tmpfs /run --tmpfs /run/lock --add-host metadata.google.internal:127.0.0.2 "$IMAGE" >/dev/null
	local state
	for _ in $(seq 1 30); do
		state="$(docker exec "$C" systemctl is-system-running 2>/dev/null)"
		[[ $state == running || $state == degraded ]] && break
		sleep 1
	done
	x 'mkdir -p /etc/test && echo v1 > /etc/test/suffix'
}
# run <script>: copy it in and run it; sets RC and LOG.
run() {
	docker cp -q "$1" "$C:/root/startup.sh"
	LOG="$(x 'bash /root/startup.sh' 2>&1)"
	RC=$?
}
updated() { grep -c '^Updated ' <<< "$LOG"; }
logged() { grep -q -- "$1" <<< "$LOG"; }
# variant <base> <dest> <content> <out>: the base script with one vm_files entry's content replaced.
variant() {
	local b64
	b64="$(printf '%s' "$3" | base64 -w0)"
	sed "s#^\(\twrite_file $2 [0-9]* root:root < <(base64 --decode <<< '\)[^']*#\1$b64#" "$1" > "$4"
	grep -q "$b64" "$4" || { echo "variant for $2 didn't apply"; exit 1; }
}
invocation() { x "systemctl show -p InvocationID --value $1"; }
leftovers() { x "find /etc/default /etc/nginx /etc/nftables.d /etc/sudoers.d /etc/systemd/system /etc/sysctl.d /etc/apt/apt.conf.d /usr/local/sbin /etc/personalwebsite /etc/cloudflared -name '.*.??????' | wc -l"; }
ready_attr() { x "grep '^personalwebsite/ready ' /var/log/guest-attributes 2>/dev/null | tail -1 | cut -d' ' -f2"; }
started_at() { x "systemctl show -p ActiveEnterTimestampMonotonic --value $1"; }
http_code() { x "curl -s -o /dev/null -w %{http_code} http://127.0.0.1$1"; }
# slow_upload <visitor ip>: an upload throttled so it stays in flight (needs /tmp/body).
slow_upload() { docker exec -d "$C" curl -s -o /dev/null -H "CF-Connecting-IP: $1" --limit-rate 20k --data-binary @/tmp/body http://127.0.0.1/api/fileshare/upload/; }
# upload_code <visitor ip>: a tiny upload's status; the stub app answers 501 to anything Nginx lets through.
upload_code() { x "curl -s -o /dev/null -w %{http_code} -H 'CF-Connecting-IP: $1' --data-binary x http://127.0.0.1/api/fileshare/upload/"; }
# publish <good|broken>: put that release in the stub bucket.
publish() { docker cp -q "$OUT/$1" "$C:/etc/test/release"; }
# install_release <name>: a healthy release on disk, as if deployed earlier.
install_release() {
	docker cp -q "$OUT/src-good" "$C:/opt/personalwebsite/releases/$1"
	x "r=/opt/personalwebsite/releases/$1; mkdir -p \$r/backend/.venv/bin && ln -sf /usr/bin/python3.13 \$r/backend/.venv/bin/python3 && touch \$r/.complete && chown -R root:root \$r"
}

# make_release <name> <commit sha> <main.py>: a tarball and its bucket metadata.
make_release() {
	local src="$OUT/src-$1"
	mkdir -p "$src/backend" "$src/frontend/dist" "$OUT/$1"
	printf '%s\n' "$3" > "$src/backend/main.py"
	: > "$src/backend/requirements.txt" # pip accepts an empty hash-pinned file.
	echo '<!doctype html><title>test release</title>' > "$src/frontend/dist/index.html"
	tar -czf "$OUT/$1/release.tar.gz" -C "$src" backend frontend
	echo "$2 $(sha256sum "$OUT/$1/release.tar.gz" | cut -d' ' -f1) 1" > "$OUT/$1/fields"
}
make_release good "$GOOD" "import http.server, os
class H(http.server.BaseHTTPRequestHandler):
	def do_GET(self):
		self.send_response(200 if self.path == '/api/health/' else 404)
		self.end_headers()
http.server.HTTPServer(('127.0.0.1', int(os.environ['PORT'])), H).serve_forever()"
make_release broken "$BROKEN" "raise SystemExit('broken on purpose')"
(cd "$HERE/../../backend" && uv export --frozen --no-dev --no-emit-project --format requirements-txt -q) > "$OUT/requirements.txt" \
	|| { echo "uv export failed"; exit 1; }

# variant_release <name> <command>: the good release with <command> run in a copy of it.
variant_release() {
	local src="$OUT/src-$1"
	rm -rf "$src" && cp -a "$OUT/src-good" "$src"
	(cd "$src" && eval "$2")
	mkdir -p "$OUT/$1"
	tar -czf "$OUT/$1/release.tar.gz" -C "$src" backend frontend
}
# deploy <name> <commit sha> [dir]: run the deploy script on that release from [dir]; sets RC and LOG.
deploy() {
	docker cp -q "$OUT/$1/release.tar.gz" "$C:/root/$1.tar.gz"
	LOG="$(x "cd ${3:-/root} && personalwebsite-deploy $2 $(sha256sum "$OUT/$1/release.tar.gz" | cut -d' ' -f1) < /root/$1.tar.gz" 2>&1)"
	RC=$?
}

group_main() {
	start_vm pw-vm-main

	echo "A. First boot, no release published yet"
	local mwlid_pid
	mwlid_pid="$(x 'pgrep -x mwlid_extension')"
	run "$BASE"
	check "exit 0 (got $RC)" '[[ $RC == 0 ]]'
	check "13 files + 2 secrets updated (got $(updated))" '[[ $(updated) == 15 ]]'
	# The stub agent relaunches its plugin right away; allow it a moment.
	check "guest agent plugin relaunched on the new config" '(for _ in {1..20}; do p="$(x "pgrep -x mwlid_extension")" && [[ -n "$p" && "$p" != "$mwlid_pid" ]] && exit 0; sleep 0.1; done; exit 1)'
	check "nftables installed" 'logged "Installing nftables" && x "command -v nft" >/dev/null'
	check "metadata firewall loaded even before a release" 'x "systemctl is-active -q flaskapp-firewall && nft list table inet flaskapp_firewall" >/dev/null'
	check "no published release logged" 'logged "No release published"'
	check "Nginx started during install, as on GCE" '(( $(x "journalctl -u nginx -o cat | grep -c \"^Started nginx.service\"") >= 2 )) && ! logged "policy-rc.d"'
	check "sysctl applied" 'logged "sysctl stub: -p /etc/sysctl.d/99-personalwebsite.conf"'
	check "man-db removed" '[[ "$(x "dpkg-query -W -f=\\\${Status} man-db")" != "install ok installed" ]]'
	check "marker written" 'x "test -f /var/lib/personalwebsite/.provisioned"'
	check "modes and owners" '[[ "$(x "stat -c \"%a %U:%G %n\" /etc/sudoers.d/personalwebsite-deploy /usr/local/sbin/personalwebsite-deploy /etc/nginx/sites-available/default /etc/systemd/system/flaskapp.service /etc/personalwebsite/secrets.env /etc/cloudflared/tunnel.env /var/lib/personalwebsite /opt/personalwebsite/releases")" == "440 root:root /etc/sudoers.d/personalwebsite-deploy
755 root:root /usr/local/sbin/personalwebsite-deploy
644 root:root /etc/nginx/sites-available/default
644 root:root /etc/systemd/system/flaskapp.service
640 root:flaskapp /etc/personalwebsite/secrets.env
600 root:root /etc/cloudflared/tunnel.env
700 flaskapp:flaskapp /var/lib/personalwebsite
755 root:root /opt/personalwebsite/releases" ]]'
	check "files match the rendered contents" 'for f in $(cd "$R/files" && find . -type f); do docker exec "$C" cat "${f#.}" | cmp -s - "$R/files/$f" || exit 1; done'
	check "secrets written" '[[ "$(x "cat /etc/personalwebsite/secrets.env /etc/cloudflared/tunnel.env")" == "SECRET_KEY=fake-flask-secret-v1
TUNNEL_TOKEN=fake-cloudflare-tunnel-token-v1" ]]'
	check "units enabled" '[[ "$(x "systemctl is-enabled flaskapp nginx cloudflared cloudflared-restart.path" | sort -u)" == enabled ]]'
	check "nginx and the restart watcher active" 'x "systemctl is-active -q nginx cloudflared-restart.path"'
	check "flaskapp skipped until a release exists" '[[ "$(x "systemctl show -p ConditionResult --value flaskapp")" == no ]]'
	check "tunnel stays down until a release exists" '[[ "$(x "systemctl show -p ConditionResult --value cloudflared")" == no ]] && ! x "systemctl is-active -q cloudflared"'
	check "marked ready with no release" '[[ "$(ready_attr)" == none ]]'
	check "nginx serves our config (404, no release yet)" '[[ "$(http_code /)" == 404 ]]'
	check "sudoers valid" 'x "visudo -c" >/dev/null'
	check "no temp files left" '[[ $(leftovers) == 0 ]]'

	echo "B. Rerun, nothing changed"
	local nginx_pid path_inv agent_inv flask_inv before
	nginx_pid="$(x 'systemctl show -p MainPID --value nginx')"
	path_inv="$(invocation cloudflared-restart.path)"
	agent_inv="$(invocation google-guest-agent)"
	mwlid_pid="$(x 'pgrep -x mwlid_extension')"
	run "$BASE"
	check "exit 0 (got $RC)" '[[ $RC == 0 ]]'
	check "nothing updated (got $(updated))" '[[ $(updated) == 0 ]]'
	check "no sysctl reapply" '! logged "sysctl stub"'
	check "nftables not reinstalled" '! logged "Installing nftables"'
	check "nginx untouched" '[[ "$(x "systemctl show -p MainPID --value nginx")" == "$nginx_pid" ]]'
	check "watcher not restarted" '[[ "$(invocation cloudflared-restart.path)" == "$path_inv" ]]'
	check "guest agent and its plugin untouched" '[[ "$(invocation google-guest-agent)" == "$agent_inv" && "$(x "pgrep -x mwlid_extension")" == "$mwlid_pid" ]]'
	check "no unit looks changed on disk" '[[ "$(x "systemctl show -p NeedDaemonReload --value flaskapp flaskapp-firewall cloudflared cloudflared-restart.path cloudflared-restart.service" | grep . | sort -u)" == no ]]'

	echo "C. Drifted ownership and mode are corrected without counting as changes"
	x 'chmod 600 /etc/systemd/system/flaskapp.service && chown nobody /etc/nginx/api_proxy_params.conf'
	run "$BASE"
	check "exit 0 (got $RC)" '[[ $RC == 0 ]]'
	check "nothing updated (got $(updated))" '[[ $(updated) == 0 ]]'
	check "no unit looks changed on disk" '[[ "$(x "systemctl show -p NeedDaemonReload --value flaskapp")" == no ]]'
	check "mode and owner restored" '[[ "$(x "stat -c \"%a %U\" /etc/systemd/system/flaskapp.service /etc/nginx/api_proxy_params.conf")" == "644 root
644 root" ]]'

	echo "D. Changed unit restarts a running service"
	install_release fake
	x 'ln -sfn /opt/personalwebsite/releases/fake /opt/personalwebsite/current && systemctl start flaskapp'
	flask_inv="$(invocation flaskapp)"
	variant "$BASE" /etc/systemd/system/flaskapp.service "$(cat "$R/files/etc/systemd/system/flaskapp.service")
# changed" "$OUT/unit.sh"
	run "$OUT/unit.sh"
	check "exit 0 (got $RC)" '[[ $RC == 0 ]]'
	check "only the unit updated" '[[ "$(grep "^Updated " <<< "$LOG")" == "Updated /etc/systemd/system/flaskapp.service" ]]'
	check "flaskapp restarted" '[[ "$(invocation flaskapp)" != "$flask_inv" ]] && x "systemctl is-active -q flaskapp"'
	check "daemon reloaded" '[[ "$(x "systemctl show -p NeedDaemonReload --value flaskapp")" == no ]]'
	check "bootstrap skipped (release active)" '! logged "No release published"'
	check "with a release active, the tunnel joins and the VM marks itself ready" 'x "systemctl is-active -q cloudflared" && [[ "$(ready_attr)" == fake ]]'

	echo "E. Rotated secret restarts its service"
	x 'echo v2 > /etc/test/suffix'
	flask_inv="$(invocation flaskapp)"
	run "$OUT/unit.sh"
	check "exit 0 (got $RC)" '[[ $RC == 0 ]]'
	check "both secrets updated" '[[ $(updated) == 2 ]]'
	check "flaskapp restarted" '[[ "$(invocation flaskapp)" != "$flask_inv" ]]'
	check "new secret, same mode" '[[ "$(x "stat -c \"%a %U:%G\" /etc/personalwebsite/secrets.env; cat /etc/personalwebsite/secrets.env")" == "640 root:flaskapp
SECRET_KEY=fake-flask-secret-v2" ]]'

	echo "F. Bad Nginx config is rolled back"
	nginx_pid="$(x 'systemctl show -p MainPID --value nginx')"
	variant "$OUT/unit.sh" /etc/nginx/api_proxy_params.conf "proxy_set_header X-Test 1;" "$OUT/params.sh"
	variant "$OUT/params.sh" /etc/nginx/sites-available/default "this is not nginx config;" "$OUT/bad-nginx.sh"
	run "$OUT/bad-nginx.sh"
	check "exit 1 (got $RC)" '[[ $RC == 1 ]]'
	check "error logged" 'logged "ERROR: nginx -t failed"'
	check "both files restored" 'docker exec "$C" cat /etc/nginx/sites-available/default | cmp -s - "$R/files/etc/nginx/sites-available/default" && docker exec "$C" cat /etc/nginx/api_proxy_params.conf | cmp -s - "$R/files/etc/nginx/api_proxy_params.conf"'
	check "nginx still running the old config" '[[ "$(x "systemctl show -p MainPID --value nginx")" == "$nginx_pid" ]] && x "nginx -t" 2>/dev/null && [[ "$(http_code /api/health/)" == 200 ]]'
	check "no temp files left" '[[ $(leftovers) == 0 ]]'

	echo "G. Bad sudoers rule never goes live"
	variant "$OUT/unit.sh" /etc/sudoers.d/personalwebsite-deploy "this is not sudoers" "$OUT/bad-sudoers.sh"
	before="$(x 'cat /etc/sudoers.d/personalwebsite-deploy')"
	run "$OUT/bad-sudoers.sh"
	check "exit 1 (got $RC)" '[[ $RC == 1 ]]'
	check "error logged" 'logged "ERROR: invalid sudoers rule"'
	check "rule unchanged" '[[ "$(x "cat /etc/sudoers.d/personalwebsite-deploy")" == "$before" ]]'
	check "sudo still works" 'x "sudo -n true"'
	check "no temp files left" '[[ $(leftovers) == 0 ]]'

	echo "H. gcloud failure keeps the old secrets"
	x 'touch /etc/test/fail'
	run "$OUT/unit.sh"
	x 'rm -f /etc/test/fail'
	check "script fails (got $RC)" '[[ $RC != 0 ]]'
	check "secrets untouched" '[[ "$(x "cat /etc/personalwebsite/secrets.env /etc/cloudflared/tunnel.env")" == "SECRET_KEY=fake-flask-secret-v2
TUNNEL_TOKEN=fake-cloudflare-tunnel-token-v2" ]]'

	echo "J. Deploy script's health check passes on our Nginx config"
	install_release "$SHA"
	local out
	out="$(x "personalwebsite-deploy --rollback $SHA" 2>&1)"
	RC=$?
	check "exit 0 (got $RC)" '[[ $RC == 0 ]]'
	check "now serving" 'grep -q "Now serving $SHA" <<< "$out"'

	echo "K. ...and fails on a default-style site that answers / with 200"
	x 'printf "server {\n\tlisten 127.0.0.1:80 default_server;\n\troot /var/www/html;\n\tindex index.nginx-debian.html;\n}\n" > /etc/nginx/sites-available/default && systemctl reload nginx'
	check "/ still answers 200" '[[ "$(http_code /)" == 200 ]]'
	out="$(x "personalwebsite-deploy --rollback $SHA" 2>&1)"
	RC=$?
	check "health check fails (got $RC)" '[[ $RC == 1 ]] && grep -q "failed its health check" <<< "$out"'

	echo "I. Back to the real script"
	run "$BASE"
	check "exit 0 (got $RC)" '[[ $RC == 0 ]]'
	check "only the unit and Nginx site reverted" '[[ "$(grep "^Updated " <<< "$LOG")" == "Updated /etc/nginx/sites-available/default
Updated /etc/systemd/system/flaskapp.service" ]]'
	check "our Nginx config is live again" '[[ "$(http_code /api/health/)" == 200 ]]'
	check "marked ready with the active release" '[[ "$(ready_attr)" == "$SHA" ]]'
	check "log file kept every run" '[[ "$(x "grep -c \"Startup Script Begin\" /var/log/startup-script.log")" == 9 ]]'
}

group_swap() {
	start_vm pw-vm-swap
	publish good
	echo "L. New VM in a swap: installs the published release, then joins the tunnel"
	run "$BASE"
	check "exit 0 (got $RC)" '[[ $RC == 0 ]]'
	check "installs the published release" 'logged "Now serving $GOOD"'
	check "serves it through Nginx" '[[ "$(http_code /api/health/)" == 200 ]]'
	check "joins the tunnel only after the app is up" '(( $(started_at cloudflared) > $(started_at flaskapp) && $(started_at flaskapp) > 0 ))'
	check "marks itself ready with the release" '[[ "$(ready_attr)" == "$GOOD" ]]'

	echo "N. flaskapp can't reach the metadata server over HTTP"
	# A stand-in on the real address, on port 80 and on 53 (DNS, which must stay open).
	x 'ip addr add 169.254.169.254/32 dev lo'
	docker exec -d "$C" python3 -m http.server --bind 169.254.169.254 80
	docker exec -d "$C" python3 -m http.server --bind 169.254.169.254 53
	local metadata='curl -s -o /dev/null -w %{http_code} --max-time 5 http://169.254.169.254'
	x "for _ in \$(seq 1 20); do $metadata/ | grep -q 200 && $metadata:53/ | grep -q 200 && exit; sleep 0.5; done"
	check "root still reaches it" '[[ "$(x "$metadata/")" == 200 ]]'
	check "flaskapp is refused" '[[ "$(x "runuser -u flaskapp -- $metadata/")" == 000 ]]'
	check "flaskapp still reaches port 53" '[[ "$(x "runuser -u flaskapp -- $metadata:53/")" == 200 ]]'
	x 'systemctl stop flaskapp-firewall'
	check "stopping the firewall stops flaskapp" '! x "systemctl is-active -q flaskapp"'
	x 'systemctl start flaskapp'
	check "starting flaskapp brings the firewall back" 'x "systemctl is-active -q flaskapp-firewall" && [[ "$(x "runuser -u flaskapp -- $metadata/")" == 000 ]]'

	echo "P. Concurrent uploads are capped per visitor and in total"
	x 'head -c 1000000 /dev/zero > /tmp/body'
	slow_upload 198.51.100.1
	slow_upload 198.51.100.1
	sleep 2
	check "a visitor's third upload gets 429" '[[ "$(upload_code 198.51.100.1)" == 429 ]]'
	check "another visitor's goes through" '[[ "$(upload_code 198.51.100.2)" == 501 ]]'
	for ip in 3 4 5 6; do slow_upload "198.51.100.$ip"; done
	sleep 2
	check "a seventh upload in total gets 429" '[[ "$(upload_code 198.51.100.7)" == 429 ]]'
	x 'pkill -x curl'
	sleep 1
	check "the slots free up once they end" '[[ "$(upload_code 198.51.100.1)" == 501 ]]'
}

group_broken() {
	start_vm pw-vm-broken
	publish broken
	echo "O. New VM in a swap whose release fails its health check"
	run "$BASE"
	check "script fails (got $RC)" '[[ $RC != 0 ]]'
	check "release failed its health check" 'logged "Release $BROKEN failed its health check"'
	check "no release left active" '! x "test -e /opt/personalwebsite/current"'
	check "never joined the tunnel" '[[ "$(started_at cloudflared)" == 0 ]]'
	check "not marked ready" '[[ -z "$(ready_attr)" ]] && logged "no release is active"'
	x 'systemctl start cloudflared'
	check "a reboot wouldn't join it either" '[[ "$(x "systemctl show -p ConditionResult --value cloudflared")" == no ]]'

	echo "Q. Deploy script refuses tarballs that could run code as root"
	local name sha=3333333333333333333333333333333333333330 n=0
	local -A setups=(
		[symlink]='ln -s /etc/shadow frontend/dist/leak'
		[fifo]='mkfifo backend/fifo'
		[venv]='mkdir -p backend/.venv/lib/python3.13/site-packages && echo "import os; os.system(\"touch /pwned\")" > backend/.venv/lib/python3.13/site-packages/x.pth'
		[pip-option]='printf "%s\n" "--no-binary :all:" > backend/requirements.txt'
		[direct-ref]='printf "%s\n" "flask @ https://example.com/flask.whl" > backend/requirements.txt'
	)
	local -A errors=([symlink]='other than regular files' [fifo]='other than regular files' [venv]='contains backend/.venv' [pip-option]='requirements.txt has lines' [direct-ref]='requirements.txt has lines')
	for name in "${!setups[@]}"; do
		sha="${sha%?}$((++n))"
		variant_release "$name" "${setups[$name]}"
		deploy "$name" "$sha"
		check "$name: refused (got $RC)" '[[ $RC == 1 ]] && grep -q "${errors[$name]}" <<< "$LOG"'
		check "$name: nothing left behind" '! x "test -e /opt/personalwebsite/releases/$sha || test -e /pwned"'
	done

	# A real `uv export` (pip installs it from PyPI), plus a setuid file, deployed from a
	# directory with a planted `venv` module that `python -m venv` would import.
	sha=4444444444444444444444444444444444444444
	variant_release real "cp '$OUT/requirements.txt' backend/requirements.txt && chmod 4755 frontend/dist/index.html"
	x 'mkdir -p /tmp/cwd/venv && touch /tmp/cwd/venv/__init__.py && echo "open(\"/pwned\", \"w\")" > /tmp/cwd/venv/__main__.py'
	deploy real "$sha" /tmp/cwd
	check "real requirements deploy (got $RC)" '[[ $RC == 0 ]] && grep -q "Now serving $sha" <<< "$LOG"'
	check "Flask installed in the venv" 'x "/opt/personalwebsite/current/backend/.venv/bin/python3 -c \"import flask\""'
	check "planted module in the caller's directory not run" '! x "test -e /pwned"'
	check "setuid bit stripped" '[[ "$(x "stat -c %a /opt/personalwebsite/current/frontend/dist/index.html")" == 755 ]]'
}

group_tunnel() {
	start_vm pw-vm-tunnel
	# The real cloudflared, with a well-formed token for a tunnel that doesn't exist.
	x 'rm /etc/systemd/system/cloudflared.service.d/fake.conf && systemctl daemon-reload'
	x "printf '{\"a\":\"%s\",\"t\":\"00000000-0000-0000-0000-000000000000\",\"s\":\"%s\"}' \$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n') \$(head -c 32 /dev/urandom | base64 -w0) | base64 -w0 > /etc/test/tunnel-token"
	publish good
	echo "M. New VM whose tunnel can't connect (the real cloudflared)"
	run "$BASE"
	check "script fails (got $RC)" '[[ $RC != 0 ]]'
	check "release serves locally" 'logged "Now serving $GOOD"'
	check "the real cloudflared's /ready says not connected" '[[ "$(x "curl -s -o /dev/null -w %{http_code} http://127.0.0.1:20241/ready")" == 503 ]]'
	check "not marked ready" '[[ -z "$(ready_attr)" ]] && logged "connected after 2 minutes"'
}

docker build -q -t "$IMAGE" "$HERE/image" >/dev/null || { echo "docker build failed"; exit 1; }
echo "Running ${#GROUPS_[@]} VMs in parallel (about 4 minutes)..."
for group in "${GROUPS_[@]}"; do
	("group_$group"; echo "$FAILS" > "$OUT/$group.fails") > "$OUT/$group.log" 2>&1 &
done
wait
total=0
for group in "${GROUPS_[@]}"; do
	cat "$OUT/$group.log"
	total=$((total + $(cat "$OUT/$group.fails" 2>/dev/null || echo 1)))
done
FAILS=$total
finish
