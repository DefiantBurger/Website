# Known Issues

Items are confirmed issues unless labelled **High** (priority), **Likely**, **Possible** (needs review), or **Minor**. Deliberate behavior that can look like a bug is listed in the [appendix](#appendix-not-issues).

## Frontend

1. No frontend tests (scheduler logic is the best first target).
2. **Likely:** project heading links are broken. `rehype-sanitize` prefixes ids with `user-content-`, but the links still point to the unprefixed id. It also strips the `heading-anchor` class, so that CSS never applies.
3. **Minor:** links to a section don't scroll on page load, because the content renders after the browser tries to scroll. Fixing the heading links won't fix this.
4. Content is clipped on phones and can't be reached, because `body` sets `overflow-x: hidden`. At 375px, `/utilities/fileshare` is 429px wide (the file input stretches a `1fr` grid column), `/utilities` reaches 382px, and code blocks in project write-ups reach 403px.
5. Every page preloads Mermaid (about 269 KB compressed for all preloaded assets) because `ProjectDetail.svelte` imports it statically and `routes.ts` has no code splitting.
6. **Likely:** back navigation loses the scroll position.

### SEO

1. **High:** every unknown path returns HTTP 200 with the SPA (including `/projects/nope` and `/.env`), so crawlers see soft 404s.
2. No structured data, and Open Graph tags are static (the same for every page) because the HTML is never rendered per route. Trailing-slash paths and the `/utilities/messageboard` alias are served as duplicates with no server-side redirect; only the client-side canonical tag points crawlers at the main path.
3. The served HTML has only a site-wide description, Open Graph tags, and a `<noscript>` link list, so clients that don't run JavaScript see none of a page's own content.
4. The full name appears in page titles and the `<noscript>` content, but nowhere in the rendered page text except the domain and email.
5. `Utilities.svelte` opens each utility with a button, so crawlers find no links to `/utilities/*`.
6. `/favicon.ico` and `/apple-touch-icon.png` return the SPA's HTML (see item 1). `index.html` declares `/favicon.png` for both, so browsers that honor the tags are fine, and a 128px icon is small for Apple touch icons and link-preview images.

### Accessibility

Lighthouse has only been run against the homepage.

1. Low contrast in the light theme: Contact labels (2.13:1) and dividers (white-based), About You `.muted` (3.31:1), and Scheduler `.danger` (4.28:1).
2. **Possible:** one Scheduler `<select>` has no label.
3. No skip link or `aria-current`, and focus isn't moved on navigation.

## Backend

1. **High:** the `/static/` route is documented and tested, but production never reaches it because Nginx serves that path from the SPA.

## Infrastructure

1. Terraform state is local to the operator's machine (gitignored): no remote backend, encryption, or locking. It contains the tunnel secret (`random_id.tunnel_secret`). Move it to an encrypted remote backend (e.g. GCS). Low priority while there's only one developer.
2. Deploys auto-run on every green push to `main` unless it only changes docs, including pushes that don't need one (e.g. changes limited to `deployment/`). There should be a way to review a push and choose whether it deploys to production. Required reviewers on the `production` environment are one option.
3. **Possible:** the `status` CNAME for the Better Stack status page lives outside Terraform (see [Deployment](./DEPLOYMENT.md#resources)), so it won't show up in `plan` and could be lost if the zone is rebuilt. The MX, SPF, and site-verification records are also outside Terraform.
4. The deploy smoke test only checks `/api/health/`, so it can't catch a broken frontend. PRs also run type checks but no frontend build, so build failures only appear on `main`.
5. **Minor:** `pnpm audit` reports DOMPurify 3.4.16 (1 critical, 1 high, 1 low) and KaTeX 0.16.47 (1 low), both through Mermaid. Project Markdown is the only input and only the site owner writes it, so real exposure is low. Whether Mermaid uses the affected paths hasn't been confirmed.
6. The live `robots.txt` combines Cloudflare's managed rules with `frontend/public/robots.txt`, so `User-agent: *` appears twice with different `Content-Signal` values. The managed rules also block Baiduspider, PetalBot, and GoogleOther.
7. **Possible:** no DMARC, CAA, or DNSSEC. HSTS has no `includeSubDomains`, and there's no `security.txt`.

## Utilities

### Class Scheduler

1. Catalog and seed data may be incomplete or outdated. A separate repo grabs and parses the class data; it should be matured and documented here.
2. No tests for the scheduler parser or graph logic.

### File Share

1. Whole files are held in memory during transfer. Encrypting in fixed-size chunks (e.g. AES-GCM per 1 MB with per-chunk nonces, streamed to disk) would keep memory flat and allow raising the concurrency cap.
2. Expiry is request-driven; idle files linger until the next file-share request.

The items below come from code review and function-level tests, not live uploads.

3. **Likely:** the transfer slot is released before the response is sent, so more than two decrypted files can be in memory at once. The VM has 1 GB of RAM, and the Terraform config sets up no swap or `MemoryMax`.
4. **High:** if a later file in a multi-file upload fails, the old batch is already gone (the first file replaces it), and the files that succeeded aren't reported.
5. On Cloudflare plans with a 100 MB upload limit, a file right at the 100 MB cap may be rejected once form overhead is added. The zone's plan hasn't been checked. Lowering the cap to 80 MB may be the safe fix.

### Message Board

1. Sanitizing silently removes characters: `don't` becomes `dont`, and `café ñ 你好 🎉` becomes `caf`. The UI calls the allowlist "URL-safe", yet it strips `&`, `#`, `%`, `+`, and `@`.

## Appendix: Non-Issues

These are deliberate. Don't report or "fix" them without revisiting the decision.

### Frontend

- `Home.svelte` hard-codes "Featured Projects" instead of using `/api/projects/`, so the owner chooses which projects to display.
- A dark system preference is ignored, and first-time visitors always get the light theme, because the site looks better in light mode.
- The About You map requests tiles from `tile.openstreetmap.org`, which shows a third party the visitor's approximate location, while the page says "Nothing here is stored". The page exists to show that this is possible, so the lack of a disclosure or privacy policy isn't treated as an issue.

### Class Scheduler

- Edits live in memory only, and reloading loses them unless exported. This avoids managing users, and cookies could cause unintentional data loss when a schedule isn't exported.

### File Share

- Uploads need no login, so anyone can upload, and ten 100 MB uploads evict everyone's files. The service is for quick, casual sharing, not permanent storage. Files become inaccessible after 10 minutes, which makes hosting malware on it unrealistic.
- Access keys have no minimum length, and `/api/fileshare/list/` does only a fast HMAC before returning filenames, so Nginx's per-IP rate limit is the only limit on guessing. A correct guess also lets someone replace those files. A file is only as secure as the password its owner chooses.
