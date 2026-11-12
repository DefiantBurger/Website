# Issues

Items are confirmed issues unless labelled **High** (priority), **Likely**, **Possible** (needs review), or **Minor**. **Cleanup** marks dead or redundant code whose removal shouldn't change behavior. Deliberate behavior that can look like a bug is listed in the [appendix](#appendix-non-issues).

## Frontend

1. **Minor:** The shell's `grep` searches each write-up's `textContent` (`pageLines` in `lib/shell/shell.svelte.ts`), which includes text that isn't visible: every KaTeX equation appears three times (hidden MathML, the LaTeX source annotation, and the HTML), so `grep hbar` prints lines like `UV=e−iV dt/ℏU_V = e^{-iV\,dt/\hbar}UV=e−iVdt/ℏ`, and headings carry the appended anchor glyph (`Overview#`). Nested blocks also match twice, since the selector takes both `li` and the `p` or nested `li` inside it. Fix by dropping `.katex-mathml` and `.heading-anchor` subtrees before reading text and only matching leaf blocks. A cleaner fix is for `plugins/projects.ts` to emit each write-up's text lines at build time (from the hast, before KaTeX and the heading anchors run), which also removes the runtime `DOMParser` and makes `grep` testable with real content.
2. **Cleanup:** HTML string sniffing where a flag or tree walk would do: `ProjectDetail.svelte` loads the KaTeX CSS when the HTML contains `class="katex`, and `renderMarkdown.ts` detects Mermaid and KaTeX failures by regex over the stringified output. A `hasMath` field on the project detail and a hast visitor that checks for `katex-error` before stringify can't false-positive on prose.
3. **Cleanup:** `lib/shell/commands.ts` redeclares the `Theme` type (so tests can load it without the rune module) and hard-codes the About You fact labels `whoami` filters by. Move `Theme` to a rune-free module and export the labels as constants from `lib/aboutYou/facts.ts`, so drift becomes a compile error instead of a missing line.
4. **Cleanup:** `lib/shell/shatterMath.ts` repeats the polygon edge loop (`p` with `polygon[(i + 1) % n]`) in `clipCloser`, `area`, and `centroid`, and `shatterMath.test.ts` twice more; an `edges(polygon)` helper would replace all five. `shatter.ts` also appends the overlay twice (harmless, since `append` moves the node).
5. **Cleanup:** `Shell.svelte` keeps the history-recall cursor and draft as component state while the history list lives in the store (works only because the component never unmounts), and keys its `{#each}` by index, which is the same as no key. `Footer.svelte` also knows about the shell (its `shell-open` margin); the App or Shell could own the bottom spacing instead.
6. **Minor:** `runCommand` joins arguments with single spaces, so `grep` can't match a term containing two spaces.

## Backend

1. **Minor:** `compute_uptime` in `app/uptime.py` trusts the status page's payload shape; a non-dict item in `included` raises inside the loop. That's fine only because `UptimeCache._refresh` catches everything, which deserves a comment.

## Infrastructure

1. **Minor:** Cloudflare Email Routing (and the MX, SPF, and DKIM records it owns) is configured outside Terraform, since provider v4 can't import its settings. Revisit after upgrading to provider v5.
2. **Minor:** `pnpm audit` reports two dev-only advisories with no in-range fix: minimatch 10 (moderate, via ESLint, which hasn't moved to minimatch 11) and deepmerge (low, via the Svelte Vite plugin, no patched release). Neither sees untrusted input.

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

- Uploads need no login, so anyone can upload, and about a dozen 80 MB uploads evict everyone's files. The service is for quick, casual sharing, not permanent storage. Files become inaccessible after 10 minutes, which makes hosting malware on it unrealistic.
- The upload cap is set in both Nginx (`81M`) and `MAX_FILE_BYTES`. Nginx's config only reaches the VM through the startup script, so sharing one Terraform value would mean replacing the VM to change it. `test_app.py` fails if Flask's limit stops fitting under Nginx's.
- Chrome asks before "Download All" saves several files, since each download starts after an `await`. Users expect multiple downloads there, so the prompt is fine.
- Access keys have no minimum length, and `/api/fileshare/list/` does only a fast HMAC before returning filenames, so Nginx's per-IP rate limit is the only limit on guessing. A correct guess also lets someone replace those files. A file is only as secure as the password its owner chooses.
