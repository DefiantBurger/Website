# Known Issues

## Frontend

1. `Home.svelte` shows hard-coded placeholder "Featured Projects" instead of using `/api/projects/`.
2. No frontend tests (scheduler logic is the best first target).
3. Project heading links are broken. `rehype-sanitize` prefixes ids with `user-content-`, but the links still point to the unprefixed id. It also strips the `heading-anchor` class, so that CSS never applies.
4. Links to a section don't scroll on page load, because the content renders after the browser tries to scroll. Fixing the heading links won't fix this.
5. Content is clipped on phones and can't be reached, because `body` sets `overflow-x: hidden`. At 375px, `/utilities/fileshare` is 429px wide (the file input stretches a `1fr` grid column), `/utilities` reaches 382px, and code blocks in project write-ups reach 403px.
6. `readErrorMessage` in `lib/api.ts` shows non-JSON error bodies as text, so users can see raw HTML (Flask's 405, Nginx's 503 and likely its 413).
7. Every page preloads Mermaid (about 269 KB compressed for all preloaded assets) because `ProjectDetail.svelte` imports it statically and `routes.ts` has no code splitting.
8. Back navigation loses the scroll position.
9. A dark system preference is ignored: first-time visitors always get the light theme.
10. `lib/api.ts` defaults `VITE_BACKEND_URL` to `http://localhost:5000`, so a production build without it calls the visitor's own machine.
11. A client-side link with a malformed escape (e.g. `/projects/%ZZ`) throws `URIError` in `matchPattern` and leaves the old page showing. `/index.html` renders the 404 page.

### SEO

1. No `sitemap.xml`, and no `Sitemap` line in `robots.txt`.
2. Every unknown path returns HTTP 200 with the SPA (including `/projects/nope`, `/.env`, and `/sitemap.xml`), so crawlers see soft 404s.
3. No canonical tag, Open Graph or Twitter tags, or structured data. Trailing-slash paths and the `/utilities/messageboard` alias are served as duplicates, with no server-side redirect.
4. The served HTML is an empty shell with no meta description or `<noscript>` content, so anything that doesn't run JavaScript (e.g. link previews) gets nothing.
5. Page titles are bare ("Home", "About"), and the full name appears nowhere in the page text except the domain and email.
6. `Utilities.svelte` opens each utility with a button, so crawlers find no links to `/utilities/*`.
7. The favicon is a PNG declared as `image/svg+xml`. `/favicon.ico` and `/apple-touch-icon.png` return HTML.

### Accessibility

Lighthouse has only been run against the homepage.

1. Low contrast in the light theme: Contact labels (2.13:1) and dividers (white-based), About You `.muted` (3.31:1), and Scheduler `.danger` (4.28:1).
2. One Scheduler `<select>` has no label.
3. The heading order on Projects skips from h1 to h3.
4. No skip link or `aria-current`, and focus isn't moved on navigation.
5. Only the About You page and map respect `prefers-reduced-motion`. The 1 Hz loading blink, page fade, and card hover effects don't.

### Privacy

1. About You says "Nothing here is stored", but its map requests tiles from `tile.openstreetmap.org`, which shows a third party the visitor's approximate location. The page doesn't disclose this, and the site has no privacy policy.

## Backend

1. Production logs add little. `app.logger.info` in `main.py` is dropped at the default log level, and the logged `remote_addr` is always `127.0.0.1` (from code review; not reproduced).
2. Redirects use the wrong scheme: `/api/health` redirects to `http://...`, then to HTTPS, because Flask isn't told the original scheme (no `ProxyFix`).
3. The `/static/` route is documented and tested, but production never reaches it because Nginx serves that path from the SPA.

## Infrastructure

1. Terraform state is local to the operator's machine (gitignored): no remote backend, encryption, or locking. It contains the tunnel secret (`random_id.tunnel_secret`). Move it to an encrypted remote backend (e.g. GCS).
2. Deploys auto-run on every green push to `main`. Adding required reviewers to the `production` environment would gate them.
3. The `status` CNAME for the Better Stack status page lives outside Terraform (see [Deployment](./DEPLOYMENT.md#resources)), so it won't show up in `plan` and could be lost if the zone is rebuilt. The MX, SPF, and site-verification records are also outside Terraform.
4. **High:** the Nginx rate limit also covers `/assets/`, and a page load requests about 20 assets at once, so a cold Cloudflare cache can blank the site. With the cache bypassed by query strings, 5 assets returned 503 in all 3 test loads, and 1 load rendered a blank page. This probably affects the first visitor at each Cloudflare location after a deploy or cache eviction. Limit only `/api/`.
5. Rate-limited requests get 503 instead of 429 (`limit_req_status` isn't set), which looks like an outage.
6. The deploy smoke test only checks `/api/health/`, so it can't catch a broken frontend. PRs also run type checks but no frontend build, so build failures only appear on `main`.
7. `pnpm audit` reports DOMPurify 3.4.16 (1 critical, 1 high, 1 low) and KaTeX 0.16.47 (1 low), both through Mermaid. Project Markdown is the only input, so real exposure looks lower than "critical", but whether Mermaid uses the affected paths hasn't been confirmed.
8. No Dependabot or Renovate config, so nothing flags vulnerable or outdated dependencies.
9. The live `robots.txt` combines Cloudflare's managed rules with `frontend/public/robots.txt`, so `User-agent: *` appears twice with different `Content-Signal` values. The managed rules also block Baiduspider, PetalBot, and GoogleOther.
10. No DMARC, CAA, or DNSSEC. HSTS has no `includeSubDomains`, and there's no `security.txt`.

## Utilities

### Class Scheduler

1. Catalog and seed data may be incomplete or outdated.
2. Edits live in memory only; reloading loses them unless exported.
3. No tests for the scheduler parser or graph logic.
4. Adding a course named `constructor` throws a `TypeError` and adds nothing, because `catalog[code]` in `resolveCourseQuery` matches inherited object properties.

### File Share

1. Whole files are held in memory during transfer. Encrypting in fixed-size chunks (e.g. AES-GCM per 1 MB with per-chunk nonces, streamed to disk) would keep memory flat and allow raising the concurrency cap.
2. Expiry is request-driven; idle files linger until the next file-share request.

The items below come from code review and function-level tests, not live uploads, except the expiry text, which is a direct comparison of the UI copy and the code.

3. **High:** uploads need no login, so ten 100 MB uploads evict everyone's files. The service could also be used to host malware.
4. **High:** access keys are easy to guess. There's no minimum length, and `/api/fileshare/list/` does only a fast HMAC before returning filenames, so Nginx's per-IP rate limit is the only limit on guessing. A correct guess also lets someone replace those files.
5. The transfer slot is released before the response is sent, so more than two decrypted files can be in memory at once. The VM has 1 GB of RAM, and the Terraform config sets up no swap or `MemoryMax`.
6. If a later file in a multi-file upload fails, the old batch is already gone (the first file replaces it), and the files that succeeded aren't reported.
7. The file picker still shows the old file after a successful upload.
8. `secure_filename` mangles non-ASCII names: `日本語.pdf` becomes `pdf`, and `файл.txt` becomes `txt`.
9. The page says "All files expire together after 10 minutes of inactivity", but each file expires 10 minutes after its own upload.
10. Cleanup deletes an unreadable metadata file but not its payload, so the payload stays on disk and doesn't count toward the quota.
11. On Cloudflare plans with a 100 MB upload limit, a file right at the 100 MB cap may be rejected once form overhead is added. The zone's plan hasn't been checked.

### Message Board

1. Sanitizing silently removes characters: `don't` becomes `dont`, and `café ñ 你好 🎉` becomes `caf`. The UI calls the allowlist "URL-safe", yet it strips `&`, `#`, `%`, `+`, and `@`.
2. [Utilities](./UTILITIES.md#message-board) says messages expire after 30 seconds, but the code uses 60.
