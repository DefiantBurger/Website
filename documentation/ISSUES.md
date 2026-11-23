# Issues

Items are confirmed issues unless labelled **High** (priority), **Likely**, **Possible** (needs review), or **Minor**. **Cleanup** marks dead or redundant code whose removal shouldn't change behavior. Deliberate behavior that can look like a bug is listed in the [appendix](#appendix-non-issues).

## Infrastructure

1. **Minor:** `pnpm audit` reports three advisories with no in-range fix: minimatch 10 (moderate, via ESLint, which hasn't moved to minimatch 11), deepmerge (low, via the Svelte Vite plugin, no patched release), and KaTeX (low, prototype pollution, fixed in 0.18.2, outside `^0.16`). None sees untrusted input: the first two are dev tooling, and KaTeX runs only at build time on the project write-ups (the browser gets just its CSS). The KaTeX bump needs checking that `rehype-katex` accepts 0.18 and the math renders the same.
2. **Minor:** Nginx's per-IP rate limits use the full `CF-Connecting-IP`, so an IPv6 client can rotate through its /64 and get around `limit_req`. That also weakens the guessing limit in the appendix's access-key entry. Bucketing by /64 takes a `map` with a regex, which is fiddly with compressed (`::`) addresses.

## Appendix: Non-Issues

These are deliberate. Don't report or "fix" them without revisiting the decision.

### Frontend

- `Home.svelte` hard-codes "Featured Projects" instead of using the project content (`lib/projects/content.ts`), so the owner chooses which projects to display.
- A dark system preference is ignored, and first-time visitors always get the light theme, because the site looks better in light mode.
- Visitors who chose dark see a brief flash of the light theme on load, since `index.html` hard-codes `data-theme="light"` and the saved theme is applied once the bundle runs. A blocking external script in `<head>` that set the theme from `localStorage` was tried (2026-11) and made the flash worse (the CSP rules out an inline script).
- The router doesn't manage scroll position: Back/Forward don't restore it, and a link to a `#section` may not scroll there once the page renders. Restoring it was tried (2026-11) and dropped. Content renders asynchronously (project Markdown, then Mermaid), so the position had to be held while the layout settled, which felt jittery and drifted on pages whose diagrams resize after load.
- The About You map requests tiles from `tile.openstreetmap.org`, which shows a third party the visitor's approximate location, while the page says there are no trackers. The page exists to show that this is possible, so the lack of a disclosure or privacy policy isn't treated as an issue.

### Backend

- Production logs each request's path and visitor IP to journald, so the owner can tell their own requests from visitors and bots.

### Infrastructure

- The three `/api/` locations in `nginx.conf.tftpl` each repeat `include api_proxy_params.conf` and a `limit_req` line. Nested locations don't inherit `proxy_pass`, and the `limit_req` lines differ (`delay=5` vs `nodelay`), so there's nothing worth sharing.

### Class Scheduler

- Plans are saved only in the URL fragment, not browser storage or the server, so there are no users to manage. Reaching the scheduler through a site link (no fragment) shows the default plan; Back or the bookmarked URL restores yours.

### File Share

- Uploads need no login, so anyone can upload, and about a dozen 80 MB uploads (or 1,000 tiny ones) evict everyone's files. The service is for quick, casual sharing, not permanent storage. Files become inaccessible after 10 minutes, which makes hosting malware on it unrealistic.
- The upload cap is set in both Nginx (`81M`) and `MAX_FILE_BYTES`. Nginx's config ships through Terraform and Flask's limit with each release, so one shared value would tie a config apply to every deploy that changes it. `test_app.py` fails if Flask's limit stops fitting under Nginx's.
- Chrome asks before "Download All" saves several files, since each download starts after an `await`. Users expect multiple downloads there, so the prompt is fine.
- Access keys have no minimum length, and `/api/fileshare/list/` does only a fast HMAC before returning filenames, so Nginx's per-IP rate limit is the only limit on guessing. A correct guess also lets someone replace those files. A file is only as secure as the password its owner chooses.
