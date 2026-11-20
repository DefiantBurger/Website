# Issues

Items are confirmed issues unless labelled **High** (priority), **Likely**, **Possible** (needs review), or **Minor**. **Cleanup** marks dead or redundant code whose removal shouldn't change behavior. Deliberate behavior that can look like a bug is listed in the [appendix](#appendix-non-issues).

## Infrastructure

1. **Minor:** Cloudflare Email Routing (and the MX, SPF, and DKIM records it owns) is configured outside Terraform, since provider v4 can't import its settings. Revisit after upgrading to provider v5.
2. **Minor:** `pnpm audit` reports three advisories with no in-range fix: minimatch 10 (moderate, via ESLint, which hasn't moved to minimatch 11), deepmerge (low, via the Svelte Vite plugin, no patched release), and KaTeX (low, prototype pollution, fixed in 0.18.2, outside `^0.16`). None sees untrusted input: the first two are dev tooling, and KaTeX runs only at build time on the project write-ups (the browser gets just its CSS). The KaTeX bump needs checking that `rehype-katex` accepts 0.18 and the math renders the same.
3. **High:** The deploy script's root boundary doesn't hold. `deploy.sh.tftpl` creates the venv and runs `pip` as root inside the extracted tarball, and Python runs any `.pth` file already in the venv's `site-packages`. So a tarball that ships `backend/.venv/lib/python3.13/site-packages/x.pth` runs code as root (reproduced locally: `python -m venv` on such a tree ran the hook). A device node in the tarball is also left world-readable by `chmod -R go+rX`, exposing the raw disk, and `requirements.txt` can add `--index-url` or `--find-links`. Only the deployer identity (a push to `main` plus a dispatch) can run the script, but until this is fixed, ARCHITECTURE.md's "its one root action is the deploy script" promises more than it delivers. Fix in `deploy.sh.tftpl`:
   - `mkdir -m 700 "$release"`, so other users can't reach anything in it before the final `chmod`.
   - After extracting, `die` if `find "$release" ! -type f ! -type d` prints anything or `backend/.venv` exists.
   - Reject `requirements.txt` lines that start with `-` (options) or contain ` @ ` (direct URL or path references). `uv export` writes neither; its `--hash` lines are indented.
   - The VM gets the script only at provisioning: replace the VM, or install the new copy at `/usr/local/sbin/personalwebsite-deploy` by hand.
4. Code running as any user on the VM can read both secrets. The metadata server hands the `flask-vm-runtime` service account's token to every local process, and that account can read `flask-secret` and the tunnel token from Secret Manager. Making `tunnel.env` root-only therefore doesn't stop code running as `flaskapp` (or the non-root deployer login). An RCE in Flask would leak a tunnel token that can serve the domain from anywhere until the tunnel is rotated. Fix: have the startup script install `nftables` with a rule rejecting `tcp dport 80` to `169.254.169.254` for `meta skuid flaskapp`. Block only port 80: the metadata server is also the VM's DNS resolver, so blocking the whole address (e.g. systemd's `IPAddressDeny=`) would break the uptime fetch. Leaving the deployer's access is fine, since it already controls the code.
5. File-share uploads can fill the disk. Nothing limits concurrent uploads before Flask's `transfer_slot`, and while a request is in flight its 80 MB body sits on disk three times (Nginx's request buffer, Waitress's body buffer, Werkzeug's multipart spool), plus the encrypted copy. On the default 10 GB boot disk, roughly two dozen uploads at once fill it, which also breaks journald and everything else that writes. This is separate from the appendix's eviction entry, which only costs other people's files. Fix: `limit_conn` on `/api/fileshare/upload/`, per `CF-Connecting-IP` (~2) and in total (~6, a second zone keyed on `$server_name`), with `limit_conn_status 429`. Keep `proxy_request_buffering` on: turning it off would drop one copy, but Nginx's buffering is what keeps slow uploads from holding Waitress's 100 connections. An [edge rate limit](./IDEAS.md#edge-rate-limit-for-uploads) would stop floods even earlier.
6. The CSP is report-only and has no `report-uri`, so it blocks nothing and nobody receives its reports. The build has no inline scripts and no `eval` or `new Function` (checked in `dist/` on 2026-11-17), so enforcing it should break nothing. To check first, run `TEST_BASE_URL=https://josephcicalese.com pnpm smoke`: it's read-only and fails on console errors, which should catch report-only violations. When switching, narrow `img-src https:` to `https://tile.openstreetmap.org` and add `Cross-Origin-Opener-Policy: same-origin`. The steps are under [Runtime on the VM](./DEPLOYMENT.md#runtime-on-the-vm).
7. **Minor:** Per-IP rate limits use the full `CF-Connecting-IP`, so an IPv6 client can rotate through its /64 and get around Nginx's `limit_req` and the message board's `RateLimiter`. That also weakens the guessing limit in the appendix's access-key entry. In Python, bucket IPv6 by /64 (`ipaddress.ip_network(f'{ip}/64', strict=False)`). In Nginx it takes a `map` with a regex, which is fiddly with compressed (`::`) addresses.
8. **Cleanup:** `nginx_api_proxy_params.conf.tftpl` sets `X-Real-IP $remote_addr`, which is always `127.0.0.1` because only cloudflared connects. Nothing reads it except About You's "Via Proxy" check, which `X-Forwarded-For` already makes true. Remove it with Backend #3.

## Backend

1. In production, `main.py` logs every request's path and visitor IP to journald, while the About You page says "Nothing here is stored". This is separate from the appendix's map-tile entry. Either drop the IP from the access log line, truncate it, or reword the page.
2. **Minor:** Only 404 and 413 have JSON handlers, so other errors (a 405, or the 500 from an unhandled exception) return Flask's HTML page. The frontend copes (`readErrorMessage` shows a status-based message), but one `HTTPException` handler in `create_app` would keep the API's `{"error": ...}` shape everywhere.
3. **Cleanup:** The visitor's IP is worked out three times. Nginx sets `X-Forwarded-For` to `CF-Connecting-IP`, and Waitress (with `trusted_proxy` and `trusted_proxy_headers` set) already puts it in `REMOTE_ADDR`, takes the scheme from `X-Forwarded-Proto`, and strips `Forwarded` and the other untrusted headers (checked with Waitress 3.0.2). Then `ProxyFix` in `create_app` parses the same `X-Forwarded-For` again, and `_resolve_client_ip` in `views.py` reads `CF-Connecting-IP` itself, getting the value `request.remote_addr` already holds. Fix: remove `ProxyFix` (and its tests in `test_app.py` and its mention in IMPLEMENTATION.md) and replace `_resolve_client_ip` with `request.remote_addr`. Dev has no proxy, so its `remote_addr` doesn't change. About You's `ipSource` (always "CF-Connecting-IP") and `hasForwardedHeaders` (always "Via Proxy: Yes") are constant in production and can go too, along with its Request fact (always `GET /api/about-you/request-context/`). Do it with Infrastructure #8.

## File Share

1. **Minor:** Download uses whatever is in the Access Key box when it's clicked, not the key the list was fetched with (`startDownloads` in `UtilityFileShare.svelte`). Edit the key after listing, and every download fails with "No active file matched that password." File ids are random and checked against the key, so it can't fetch another key's file; the error is just confusing. Fix: keep the key the list came from, or clear the list when the key field changes.

## Message Board

1. **Minor:** UTILITIES.md says the POST accepts "JSON or form", but the view reads only JSON, so a form post gets a 400 "Message text is required." JSON-only is the better behavior, since a cross-site form can't send `application/json` without a CORS preflight, so fix the doc, not the code.
2. **Minor:** The POST's 16 KB check (`len(request.get_data()) > 16384`) reads the whole body first, up to Nginx's 1 MB cap. Setting `request.max_content_length = 16_384` at the top of the view (Flask 3.1 allows it per request) rejects a larger body while it's being read, chunked ones included, and replaces the manual check. The resulting 413 goes through the app-wide handler, whose message is about the file-share limit, so that handler would need to word its message per route.

## Appendix: Non-Issues

These are deliberate. Don't report or "fix" them without revisiting the decision.

### Frontend

- `Home.svelte` hard-codes "Featured Projects" instead of using the project content (`lib/projects/content.ts`), so the owner chooses which projects to display.
- A dark system preference is ignored, and first-time visitors always get the light theme, because the site looks better in light mode.
- Visitors who chose dark see a brief flash of the light theme on load, since `index.html` hard-codes `data-theme="light"` and the saved theme is applied once the bundle runs. A blocking external script in `<head>` that set the theme from `localStorage` was tried (2026-11) and made the flash worse (the CSP rules out an inline script).
- The router doesn't manage scroll position: Back/Forward don't restore it, and a link to a `#section` may not scroll there once the page renders. Restoring it was tried (2026-11) and dropped. Content renders asynchronously (project Markdown, then Mermaid), so the position had to be held while the layout settled, which felt jittery and drifted on pages whose diagrams resize after load.
- The About You map requests tiles from `tile.openstreetmap.org`, which shows a third party the visitor's approximate location, while the page says "Nothing here is stored". The page exists to show that this is possible, so the lack of a disclosure or privacy policy isn't treated as an issue.

### Infrastructure

- The three `/api/` locations in `nginx.conf.tftpl` each repeat `include api_proxy_params.conf` and a `limit_req` line. Nested locations don't inherit `proxy_pass`, and the `limit_req` lines differ (`delay=5` vs `nodelay`), so there's nothing worth sharing.

### Class Scheduler

- Plans are saved only in the URL fragment, not browser storage or the server, so there are no users to manage. Reaching the scheduler through a site link (no fragment) shows the default plan; Back or the bookmarked URL restores yours.

### File Share

- Uploads need no login, so anyone can upload, and about a dozen 80 MB uploads (or 1,000 tiny ones) evict everyone's files. The service is for quick, casual sharing, not permanent storage. Files become inaccessible after 10 minutes, which makes hosting malware on it unrealistic.
- The upload cap is set in both Nginx (`81M`) and `MAX_FILE_BYTES`. Nginx's config only reaches the VM through the startup script, so sharing one Terraform value would mean replacing the VM to change it. `test_app.py` fails if Flask's limit stops fitting under Nginx's.
- Chrome asks before "Download All" saves several files, since each download starts after an `await`. Users expect multiple downloads there, so the prompt is fine.
- Access keys have no minimum length, and `/api/fileshare/list/` does only a fast HMAC before returning filenames, so Nginx's per-IP rate limit is the only limit on guessing. A correct guess also lets someone replace those files. A file is only as secure as the password its owner chooses.
