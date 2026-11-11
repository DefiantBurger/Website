# Issues

Items are confirmed issues unless labelled **High** (priority), **Likely**, **Possible** (needs review), or **Minor**. Deliberate behavior that can look like a bug is listed in the [appendix](#appendix-non-issues).

## Frontend

### SEO

1. The served HTML has only each page's head tags and a `<noscript>` link list, so clients that don't run JavaScript see none of a page's own content.
2. **Minor:** `apple-touch-icon.png` (180px) and `og-image.png` (512px) are upscaled from the 128px favicon, so they're a little blurry. Replace them if a larger source image turns up.

### Accessibility

`pnpm a11y` (axe-core) reports no violations. It can't judge screen-reader flow or drag-and-drop.

## Infrastructure

1. Terraform state is local to the operator's machine (gitignored): no remote backend, encryption, or locking. It contains the tunnel secret (`random_id.tunnel_secret`). Move it to an encrypted remote backend (e.g. GCS). Low priority while there's only one developer.
2. **Minor:** Cloudflare Email Routing (and the MX, SPF, and DKIM records it owns) is configured outside Terraform, since provider v4 can't import its settings. Revisit after upgrading to provider v5.
3. **Minor:** `pnpm audit` reports three advisories with no in-range fix: KaTeX 0.16.47 (low, pinned to `^0.16` by Mermaid 11), and minimatch 10 (moderate, via ESLint) and deepmerge (low, via the Svelte Vite plugin, no patched release), which are both dev-only. Mermaid 12 would clear KaTeX.

## Utilities

### Class Scheduler

1. Catalog and seed data may be incomplete or outdated. A separate repo grabs and parses the class data; it should be matured and documented here.

### File Share

1. Whole files are held in memory during transfer. Encrypting in fixed-size chunks (e.g. AES-GCM per 1 MB with per-chunk nonces, streamed to disk) would keep memory flat and allow raising the concurrency cap.
2. Expiry is request-driven; idle files linger until the next file-share request.

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
- Access keys have no minimum length, and `/api/fileshare/list/` does only a fast HMAC before returning filenames, so Nginx's per-IP rate limit is the only limit on guessing. A correct guess also lets someone replace those files. A file is only as secure as the password its owner chooses.
