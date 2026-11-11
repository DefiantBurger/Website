# Issues

Items are confirmed issues unless labelled **High** (priority), **Likely**, **Possible** (needs review), or **Minor**. Deliberate behavior that can look like a bug is listed in the [appendix](#appendix-non-issues).

## Frontend

### SEO

1. No structured data, and Open Graph tags are static (the same for every page) because the HTML is never rendered per route. Trailing-slash paths and the `/utilities/messageboard` alias are served as duplicates with no server-side redirect; only the client-side canonical tag points crawlers at the main path.
2. The served HTML has only a site-wide description, Open Graph tags, and a `<noscript>` link list, so clients that don't run JavaScript see none of a page's own content.
3. The full name appears in page titles and the `<noscript>` content, but nowhere in the rendered page text except the domain and email.
4. `/apple-touch-icon.png` returns 404. `index.html` declares `/favicon.png` for it, so browsers that honor the tag are fine, and a 128px icon is small for Apple touch icons and link-preview images.

### Accessibility

`pnpm a11y` (axe-core) reports no violations. It can't judge screen-reader flow or drag-and-drop.

## Infrastructure

1. Terraform state is local to the operator's machine (gitignored): no remote backend, encryption, or locking. It contains the tunnel secret (`random_id.tunnel_secret`). Move it to an encrypted remote backend (e.g. GCS). Low priority while there's only one developer.
2. **Possible:** the `status` CNAME for the Better Stack status page lives outside Terraform (see [Deployment](./DEPLOYMENT.md#resources)), so it won't show up in `plan` and could be lost if the zone is rebuilt. The MX, SPF, and site-verification records are also outside Terraform.
3. **Minor:** `pnpm audit` reports DOMPurify 3.4.16 (1 critical, 1 high, 1 low) and KaTeX 0.16.47 (1 low), both through Mermaid. Project Markdown is the only input and only the site owner writes it, so real exposure is low. Whether Mermaid uses the affected paths hasn't been confirmed.
4. **Possible:** no DMARC, CAA, or DNSSEC. HSTS has no `includeSubDomains`, and there's no `security.txt`.

## Utilities

### Class Scheduler

1. Catalog and seed data may be incomplete or outdated. A separate repo grabs and parses the class data; it should be matured and documented here.

### File Share

1. Whole files are held in memory during transfer. Encrypting in fixed-size chunks (e.g. AES-GCM per 1 MB with per-chunk nonces, streamed to disk) would keep memory flat and allow raising the concurrency cap.
2. Expiry is request-driven; idle files linger until the next file-share request.

## Duplication and Refactoring

Found in a full read of the codebase (2026-11-06). Each item says where the copies are and suggests one shared place for them.

### Frontend components

1. **Minor:** titled panels repeat the same shape (`terminal-box` + heading + body). `UtilityFileShare.svelte` has its `.panel` forms and Storage Info box. The scheduler's `lib/scheduler/components/Panel.svelte` (title + `children` snippet) could move to `lib/components/` and cover them.

### Frontend logic

1. **Minor:** `index.html` can't read `routeDefinitions.ts`, so its `<noscript>` link list repeats the route paths and its title and Open Graph tags repeat the site name. Generating them at build time would fit with per-route HTML (SEO #1).

### Styles

1. **Minor:** smaller styles are repeated that could become classes or variables in `app.css`:
   - Dashed, tinted boxes (`--color-primary-opacity-30` border on `--color-primary-opacity-10`) appear in File Share `.stats div` and `.file-list`, Scheduler `.semester-column`, and Message Board `.pill`.
   - Each form page re-declares the stacked `label` layout.

### Infrastructure and CI

1. **Minor:** some values are hard-coded where Terraform could pass them as template variables. `/var/lib/personalwebsite` appears four times across `startup.sh.tftpl` and `flaskapp.service.tftpl` (`app_path` is already a variable), and port 5000 is in `nginx_api_proxy_params.conf.tftpl`, `deploy.sh.tftpl`, and `main.py`'s default. The three `/api/` locations in `nginx.conf.tftpl` also repeat the same `include` and `limit_req` lines.
2. **Minor:** the site origin is hard-coded in `deploy.yaml`, `vite.config.ts`, `index.html` (Open Graph), `Nav.svelte` (status link), and `robots.txt`, as well as in `variables.tf`.

## Appendix: Non-Issues

These are deliberate. Don't report or "fix" them without revisiting the decision.

### Frontend

- `Home.svelte` hard-codes "Featured Projects" instead of using the project content (`lib/projects/content.ts`), so the owner chooses which projects to display.
- A dark system preference is ignored, and first-time visitors always get the light theme, because the site looks better in light mode.
- Visitors who chose dark see a brief flash of the light theme on load, since `index.html` hard-codes `data-theme="light"` and the saved theme is applied once the bundle runs. A blocking external script in `<head>` that set the theme from `localStorage` was tried (2026-11) and made the flash worse (the CSP rules out an inline script).
- The router doesn't manage scroll position: Back/Forward don't restore it, and a link to a `#section` may not scroll there once the page renders. Restoring it was tried (2026-11) and dropped. Content renders asynchronously (project Markdown, then Mermaid), so the position had to be held while the layout settled, which felt jittery and drifted on pages whose diagrams resize after load.
- The About You map requests tiles from `tile.openstreetmap.org`, which shows a third party the visitor's approximate location, while the page says "Nothing here is stored". The page exists to show that this is possible, so the lack of a disclosure or privacy policy isn't treated as an issue.

### Class Scheduler

- Plans are saved only in the URL fragment, not browser storage or the server, so there are no users to manage. Reaching the scheduler through a site link (no fragment) shows the default plan; Back or the bookmarked URL restores yours.

### File Share

- Uploads need no login, so anyone can upload, and about a dozen 80 MB uploads evict everyone's files. The service is for quick, casual sharing, not permanent storage. Files become inaccessible after 10 minutes, which makes hosting malware on it unrealistic.
- The upload cap is set in both Nginx (`81M`) and `MAX_FILE_BYTES`. Nginx's config only reaches the VM through the startup script, so sharing one Terraform value would mean replacing the VM to change it. `test_app.py` fails if Flask's limit stops fitting under Nginx's.
- Access keys have no minimum length, and `/api/fileshare/list/` does only a fast HMAC before returning filenames, so Nginx's per-IP rate limit is the only limit on guessing. A correct guess also lets someone replace those files. A file is only as secure as the password its owner chooses.
