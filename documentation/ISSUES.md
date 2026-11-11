# Issues

Items are confirmed issues unless labelled **High** (priority), **Likely**, **Possible** (needs review), or **Minor**. **Cleanup** marks dead or redundant code whose removal shouldn't change behavior. Deliberate behavior that can look like a bug is listed in the [appendix](#appendix-non-issues).

## Frontend

### SEO

1. **Minor:** `apple-touch-icon.png` (180px) and `og-image.png` (512px) are upscaled from the 128px favicon, so they're a little blurry. Replace them if a larger source image turns up.

### General

1. **Minor:** `Home.svelte` still features a placeholder card ("Project 2", "Description coming soon...") on the live site, though `j-ball-basketball` exists. The page also links About, Utilities, and Contact three times on one screen (nav, header links, Quick Links).
2. **Minor:** The 404 page always shows "Did you mean ...?", since `closest()` returns the nearest path however far it is (e.g. `/zzzzzz` suggests some unrelated page). A distance cutoff would fix it.
3. **Minor:** `App.svelte` builds the canonical link from `window.location.origin`, while the build (`plugins/routeHtml.ts`) uses `SITE_ORIGIN`. They only agree because Cloudflare redirects other hosts; use `SITE_ORIGIN` in both.

## Documentation

Docs that no longer match the code:

1. `IMPLEMENTATION.md` says `create_app()` caps bodies at 101 MiB; it's `MAX_FILE_BYTES` + 1 MiB (~81 MB).
2. `IMPLEMENTATION.md` refers to `servedPaths()`; the function is `pageHeads()` in `plugins/routeHtml.ts`.
3. `IMPLEMENTATION.md` says `pnpm a11y` excludes Mermaid diagrams "(see Issues)"; `a11y.ts` excludes nothing and there's no such issue.
4. `IMPLEMENTATION.md` gives the Markdown pipeline as anchors → Mermaid → sanitize. The real order is Mermaid → sanitize → slug → autolink, and it matters: slugs run after sanitize so anchor hrefs match the ids.
5. `UTILITIES.md` says `UtilityScheduler.svelte` keeps the schedule as state; it lives in `SchedulerStore` (`store.svelte.ts`).
6. `backend/pyproject.toml` still has the template description "Add your description here".

## Infrastructure

1. **Minor:** Cloudflare Email Routing (and the MX, SPF, and DKIM records it owns) is configured outside Terraform, since provider v4 can't import its settings. Revisit after upgrading to provider v5.
2. **Minor:** `pnpm audit` reports three advisories with no in-range fix: KaTeX 0.16.47 (low, pinned to `^0.16` by Mermaid 11), and minimatch 10 (moderate, via ESLint) and deepmerge (low, via the Svelte Vite plugin, no patched release), which are both dev-only. Mermaid 12 would clear KaTeX.

## Utilities

### Class Scheduler

1. **Minor:** `handleImportFile()` in `UtilityScheduler.svelte` awaits `file.text()` outside its `try`. If the file can't be read (moved or deleted since it was picked), the rejection goes unhandled, no notice appears, and the input isn't cleared, so picking the same file again doesn't fire `change`.

### File Share

1. Whole files are held in memory during transfer. Encrypting in fixed-size chunks (e.g. AES-GCM per 1 MB with per-chunk nonces, streamed to disk) would keep memory flat and allow raising the concurrency cap.
2. Expiry is request-driven; idle files linger until the next file-share request.
3. **Minor:** `decrypt_record_payload()` checks `payload_path.exists()` and then reads the file. If a concurrent sweep or eviction deletes it in between, `read_bytes()` raises and the download returns a 500 instead of a 404. Catching `FileNotFoundError` instead of checking first fixes it and is shorter.
4. **Possible:** The selected-files list is keyed by `file.name`. Two picked files with the same name (iOS photo pickers have named every photo `image.jpg`) would make Svelte throw a duplicate-key error. Keying by index avoids it.
5. **Possible:** "Download All" starts each download after an `await`, outside the click's user activation, so Chrome may prompt for or block multiple automatic downloads. Needs a manual check.

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
