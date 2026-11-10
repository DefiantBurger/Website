# Issues

Items are confirmed issues unless labelled **High** (priority), **Likely**, **Possible** (needs review), or **Minor**. Deliberate behavior that can look like a bug is listed in the [appendix](#appendix-non-issues).

## Frontend

1. **Minor:** visitors who chose dark see a flash of the light theme on every load, since `index.html` hard-codes `data-theme="light"` and the theme is applied once the bundle runs. The CSP (report-only) blocks inline scripts, so the fix is a tiny external script in `<head>` that reads `localStorage` and sets the attribute. The prerendering idea in [Ideas](./IDEAS.md#prerendering) needs this too.
2. **Minor:** `apiFetch` has no timeout or `AbortSignal`, so a hung backend leaves pages at "Loading..." forever.

### SEO

1. No structured data, and Open Graph tags are static (the same for every page) because the HTML is never rendered per route. Trailing-slash paths and the `/utilities/messageboard` alias are served as duplicates with no server-side redirect; only the client-side canonical tag points crawlers at the main path.
2. The served HTML has only a site-wide description, Open Graph tags, and a `<noscript>` link list, so clients that don't run JavaScript see none of a page's own content.
3. The full name appears in page titles and the `<noscript>` content, but nowhere in the rendered page text except the domain and email.
4. `/apple-touch-icon.png` returns 404. `index.html` declares `/favicon.png` for it, so browsers that honor the tag are fine, and a 128px icon is small for Apple touch icons and link-preview images.

### Accessibility

`pnpm a11y` (axe-core) reports no violations. It can't judge screen-reader flow or drag-and-drop.

1. **Minor:** links that open a new tab (Status, Contact, project repo/demo, OpenStreetMap) don't say so to screen readers.

## Infrastructure

1. Terraform state is local to the operator's machine (gitignored): no remote backend, encryption, or locking. It contains the tunnel secret (`random_id.tunnel_secret`). Move it to an encrypted remote backend (e.g. GCS). Low priority while there's only one developer.
2. **Possible:** the `status` CNAME for the Better Stack status page lives outside Terraform (see [Deployment](./DEPLOYMENT.md#resources)), so it won't show up in `plan` and could be lost if the zone is rebuilt. The MX, SPF, and site-verification records are also outside Terraform.
3. The deploy smoke test only checks `/api/health/`, so it can't catch a broken frontend. PRs also run type checks but no frontend build, so build failures only appear on `main`.
4. **Minor:** `pnpm audit` reports DOMPurify 3.4.16 (1 critical, 1 high, 1 low) and KaTeX 0.16.47 (1 low), both through Mermaid. Project Markdown is the only input and only the site owner writes it, so real exposure is low. Whether Mermaid uses the affected paths hasn't been confirmed.
5. **Possible:** no DMARC, CAA, or DNSSEC. HSTS has no `includeSubDomains`, and there's no `security.txt`.

## Utilities

### Class Scheduler

1. Catalog and seed data may be incomplete or outdated. A separate repo grabs and parses the class data; it should be matured and documented here.
2. **Minor:** a plan whose last semester is `fall99` crashes the board. `nextSemesterKey` in `SchedulerBoard.svelte` is a `$derived` that calls `semesterKey`, which throws for years past 2099, and a thrown derived takes the component down. A shared link can carry that key. Clamp or catch there.
3. **Minor:** `upcomingMainTerm` (`semesters.ts`) returns the current year's fall for June through December, so in December the "Add first semester" default is a term that is nearly over. Suggest spring of the next year from about October on.

### File Share

1. Whole files are held in memory during transfer. Encrypting in fixed-size chunks (e.g. AES-GCM per 1 MB with per-chunk nonces, streamed to disk) would keep memory flat and allow raising the concurrency cap.
2. Expiry is request-driven; idle files linger until the next file-share request.

### Message Board

1. Sanitizing silently removes characters: `don't` becomes `dont`, and `café ñ 你好 🎉` becomes `caf`. The UI calls the allowlist "URL-safe", yet it strips `&`, `#`, `%`, `+`, and `@`.
2. **Minor:** the 16 KB payload check reads `request.content_length`, so a chunked request (no `Content-Length`) is read in full by `get_json` before any size check. In production Nginx caps `/api/` bodies at 1 MB, so this only matters in development. Checking `len(request.get_data())` would hold everywhere.

## Duplication and Refactoring

Found in a full read of the codebase (2026-11-06). Each item says where the copies are and suggests one shared place for them.

### Shared limits

1. The 80 MB upload cap is set twice, in different units: Nginx `81M` (MiB) and `MAX_FILE_BYTES` (decimal MB, which Flask's `MAX_CONTENT_LENGTH` derives from).

### Frontend components

1. Card links are built four separate times: featured projects and quick links in `Home.svelte`, then `Projects.svelte` and `Utilities.svelte`. Each writes `terminal-box hover-lift clickable-card` + title + text + `stretched-link` with its own heading reset and spacing, and `Projects.svelte` overrides the shared hover lift (`-4px` instead of `-2px`). A `<LinkCard title href cta>` component with a `children` snippet (for `TagList`) would replace all four.
2. **Minor:** all 11 pages write out the full `<title>… · JosephCicalese.com</title>` and description, `index.html` repeats the site name three more times, and `ProjectDetail.svelte` repeats its fallback description. A shared `<PageMeta title description>` component would own the suffix.
3. **Minor:** the utility metadata is split up. Each utility's card name and description live in `Utilities.svelte`, the `Utilities / <Name>` header title is hard-coded in each utility page, and the `<title>` is written again. Each page could export `{ name, description }` from `<script module>` (like its `layout`), and `Utilities.svelte` could read them from `routes`.
4. **Minor:** new-tab links are written by hand with two different `rel` values: `rel="noopener noreferrer"` in `Nav.svelte` and `LocationMap.svelte`, `rel="noreferrer"` in `Contact.svelte` and `ProjectDetail.svelte` (twice). An `<ExternalLink>` component would make them consistent and is the natural fix for Accessibility item 1.
5. **Minor:** the error/success message pair is a snippet (`messages`) in `UtilityFileShare.svelte` and is copied inline in `UtilityMessageBoard.svelte`. The scheduler does the same job with a single `notice` (`SchedulerStore`). A `<FormMessages error success>` component would give the three utilities one pattern.
6. **Minor:** titled panels repeat the same shape (`terminal-box` + heading + body). `AboutYou.svelte` has six identical groups (`h2.prompt`, `p.source`, `FactList`) that could be one `{#each}` over `{ title, source, facts }`. `UtilityFileShare.svelte` has its `.panel` forms and Storage Info box. The scheduler's `lib/scheduler/components/Panel.svelte` (title + `children` snippet) could move to `lib/components/` and cover them.

### Frontend logic

1. **Minor:** route paths are repeated outside `routeDefinitions.ts`: in `Nav.svelte`, in `Home.svelte` (`sectionLinks`, plus `quickLinks`, which link to three of the same pages again on the same page), in `Utilities.svelte`, and in the `<noscript>` list in `index.html`. `/projects/${slug}` is built in `Home.svelte`, `Projects.svelte`, and twice in `vite.config.ts`. A changed path breaks these links silently. Nav labels in `routeDefinitions` plus a `pathFor(key, params)` helper would make a path change one edit.
2. **Minor:** paths are listed by three separate functions: `staticPaths()` in `router.svelte.ts` (used by `NotFound.svelte`), `staticRoutePaths()` in `routeDefinitions.ts`, and `servedPaths()` in `vite.config.ts`. `servedPaths()` also expands aliases the same way `applyRoute` does.
3. Async loading and submitting is hand-rolled eight times, each with its own `loading`/`busy` + error (+ success) state and `try/catch/finally`: `loadStatus`, upload, list, and download in `UtilityFileShare.svelte`, load and post in `UtilityMessageBoard.svelte`, `onMount` in `UtilityScheduler.svelte`, and `refreshServerSnapshot` in `AboutYou.svelte`. A small rune class in a `.svelte.ts` module (`busy`, `error`, `success`, `run(fn)`) would replace them, and one-shot loads could use `{#await}` like `ProjectDetail.svelte` does.
4. **Minor:** formatting helpers are scattered: `formatBytes` (in `fileshare/api.ts`), `formatSeconds` (`UtilityFileShare.svelte`), `formatTimestamp` (`UtilityMessageBoard.svelte`), and `toDisplayValue`, `formatCounts`, and the clock format (`AboutYou.svelte`). The two `toLocaleTimeString` calls use different hour formats. A shared `lib/format.ts` would be unit-testable.
5. **Minor:** `AboutYou.svelte` holds its browser detection (`describeBrowser`, `readBrowser`, `UA_BROWSERS`) and fact building in the component, out of reach of unit tests; a plain `.ts` module would fix that. `getInteractionSnapshot()` in `interactionStore.ts` re-lists every state field to copy it, where `structuredClone(state)` wouldn't need updating when a field is added.

### Styles

1. **Minor:** the global `h2` in `app.css` has a bottom border that four components undo: `.project-item h2` (Projects), `.utility-card h2` (Utilities), `.feed-header h2` (Message Board), and `.semester-header h2` (Scheduler). Either move the border onto a section-heading class or add a `.card-title` utility.
2. **Minor:** smaller styles are repeated that could become classes or variables in `app.css`:
   - `StatusMessage.svelte` draws an error box (error color, border, `--color-error-opacity-05`), but `AboutYou.svelte` styles its own `.error` text.
   - Dashed, tinted boxes (`--color-primary-opacity-30` border on `--color-primary-opacity-10`) appear in File Share `.stats div` and `.file-list`, Scheduler `.semester-column`, and Message Board `.pill`.
   - Each form page re-declares the stacked `label` layout.
3. **Minor:** there are two `blink` keyframes with different timing (`StatusMessage.svelte`, `AboutYou.svelte`). `AboutYou.svelte` and `LocationMap.svelte` also add their own `prefers-reduced-motion` blocks, which the global rule in `app.css` already covers.

### Backend

1. `FileShareError` and `MessageBoardError` are identical classes, and `views.py` turns them into JSON with the same `try/except` → `jsonify({'error': ...}), status` four times. One base error class plus a blueprint `errorhandler` would replace both.
2. Each record type is serialized to camelCase JSON by hand in two places: `FileShareRecord` in `fileshare_upload` and `fileshare_list`, and `BoardMessageRecord` in `messageboard_post_message` and `MessageBoardStore.get_active_messages`. A `to_json()` method on each dataclass would keep each field list in one place.
3. **Minor:** in `messageboard.py`, the expired-message filter is written four times (`cleanup`, `add_message`, `get_active_messages`, `get_status`) and `now if now is not None else time.time()` five times. A `_purge_locked(now)` helper would replace them.
4. **Minor:** `create_app` has two `Flask(...)` calls that differ only by `instance_path` (Flask accepts `None`). It also reads `SECRET_KEY` out of `test_config` and then applies all of `test_config` again.

### Tests

1. `backend/tests/conftest.py` defines `app`, `client`, and `temp_instance_dir` fixtures that no test uses. Instead, the `unittest` classes each build their own `create_app(...)` and temp directory in `setUp` (or inline). `TestMessageBoardAPI` also sets `os.environ['SECRET_KEY']` without restoring it and repeats the autouse store reset. Plain pytest functions using the fixtures would remove this boilerplate.

### Infrastructure and CI

1. **Minor:** some values are hard-coded where Terraform could pass them as template variables. `/var/lib/personalwebsite` appears four times across `startup.sh.tftpl` and `flaskapp.service.tftpl` (`app_path` is already a variable), and port 5000 is in `nginx_api_proxy_params.conf.tftpl`, `deploy.sh.tftpl`, and `main.py`'s default. The three `/api/` locations in `nginx.conf.tftpl` also repeat the same `include` and `limit_req` lines.
2. **Minor:** the site origin is hard-coded in `deploy.yaml`, `vite.config.ts`, `index.html` (Open Graph), `Nav.svelte` (status link), and `robots.txt`, as well as in `variables.tf`.

## Appendix: Non-Issues

These are deliberate. Don't report or "fix" them without revisiting the decision.

### Frontend

- `Home.svelte` hard-codes "Featured Projects" instead of using the project content (`lib/projects/content.ts`), so the owner chooses which projects to display.
- A dark system preference is ignored, and first-time visitors always get the light theme, because the site looks better in light mode.
- The router doesn't manage scroll position: Back/Forward don't restore it, and a link to a `#section` may not scroll there once the page renders. Restoring it was tried (2026-11) and dropped. Content renders asynchronously (project Markdown, then Mermaid), so the position had to be held while the layout settled, which felt jittery and drifted on pages whose diagrams resize after load.
- The About You map requests tiles from `tile.openstreetmap.org`, which shows a third party the visitor's approximate location, while the page says "Nothing here is stored". The page exists to show that this is possible, so the lack of a disclosure or privacy policy isn't treated as an issue.

### Class Scheduler

- Plans are saved only in the URL fragment, not browser storage or the server, so there are no users to manage. Reaching the scheduler through a site link (no fragment) shows the default plan; Back or the bookmarked URL restores yours.

### File Share

- Uploads need no login, so anyone can upload, and about a dozen 80 MB uploads evict everyone's files. The service is for quick, casual sharing, not permanent storage. Files become inaccessible after 10 minutes, which makes hosting malware on it unrealistic.
- Access keys have no minimum length, and `/api/fileshare/list/` does only a fast HMAC before returning filenames, so Nginx's per-IP rate limit is the only limit on guessing. A correct guess also lets someone replace those files. A file is only as secure as the password its owner chooses.
