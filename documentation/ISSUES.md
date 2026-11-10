# Issues

Items are confirmed issues unless labelled **High** (priority), **Likely**, **Possible** (needs review), or **Minor**. Deliberate behavior that can look like a bug is listed in the [appendix](#appendix-non-issues).

## Frontend

1. **Minor:** links to a section don't scroll on page load, because the content renders after the browser tries to scroll.
2. **Likely:** back navigation loses the scroll position.
3. **Minor:** on phones, Mermaid diagrams in project write-ups shrink to fit the content width, so wide ones (e.g. the request-flow diagram in `personal-website-platform`) become too small to read at ~400px. A horizontal-scroll container with a minimum diagram width, or tap-to-expand, would fix it.
4. `/projects/<unknown slug>` renders "Project not found." under the placeholder title "Project Details", because the `{#await}` in `ProjectDetail.svelte`'s `<svelte:head>` has no `:catch` and the route matched. The smoke test only loads `/test-missing-page`, so it can't catch this. Render `NotFound` from the catch branch, or route unknown slugs to the not-found route.
5. **Minor:** visitors who chose dark see a flash of the light theme on every load, since `index.html` hard-codes `data-theme="light"` and the theme is applied once the bundle runs. The CSP (report-only) blocks inline scripts, so the fix is a tiny external script in `<head>` that reads `localStorage` and sets the attribute. The prerendering idea in [Ideas](./IDEAS.md#prerendering) needs this too.
6. **Minor:** a `hashchange` also fires `popstate`, so pasting a new `#plan=` link on the scheduler or clicking a heading anchor re-runs `applyRoute`. That increments the About You visit count and replaces `router.params` with a new object, re-evaluating anything derived from it. Compare the old and new pathname before re-applying.
7. **Possible:** rapid theme toggles on a project page race Mermaid. Each toggle starts an async `runMermaid` that resets the node text and re-renders, and two in flight can make the second read the first's SVG as diagram source and fail. A generation counter that drops stale runs would fix it.
8. **Minor:** `apiFetch` has no timeout or `AbortSignal`, so a hung backend leaves pages at "Loading..." forever.

### SEO

1. No structured data, and Open Graph tags are static (the same for every page) because the HTML is never rendered per route. Trailing-slash paths and the `/utilities/messageboard` alias are served as duplicates with no server-side redirect; only the client-side canonical tag points crawlers at the main path.
2. The served HTML has only a site-wide description, Open Graph tags, and a `<noscript>` link list, so clients that don't run JavaScript see none of a page's own content.
3. The full name appears in page titles and the `<noscript>` content, but nowhere in the rendered page text except the domain and email.
4. `/apple-touch-icon.png` returns 404. `index.html` declares `/favicon.png` for it, so browsers that honor the tag are fine, and a 128px icon is small for Apple touch icons and link-preview images.

### Accessibility

`pnpm a11y` (axe-core) reports no violations. It excludes Mermaid diagrams (item 1) and can't judge screen-reader flow or drag-and-drop.

1. **Minor:** Mermaid edge labels in project diagrams are #ccc on #585858 (4.43:1). The colors come from Mermaid's built-in theme; `themeVariables` in `ProjectDetail.svelte` could override them.
2. **Minor:** links that open a new tab (Status, Contact, project repo/demo, OpenStreetMap) don't say so to screen readers.

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

The items below come from code review and function-level tests, not live uploads.

3. **Likely:** the transfer slot is released before the response is sent, so more than two decrypted files can be in memory at once. The VM has 1 GB of RAM, and the Terraform config sets up no swap or `MemoryMax`.
4. On Cloudflare plans with a 100 MB upload limit, a file right at the 100 MB cap may be rejected once form overhead is added. The zone's plan hasn't been checked. Lowering the cap to 80 MB may be the safe fix.
5. An empty file is listed as 16 bytes. `_load_record` chains `size_bytes or stored_size_bytes or stat()`, and a real 0 is falsy, so it falls through to the ciphertext size (the AES-GCM tag). The upload response says 0, `/api/fileshare/list/` says 16. Use an explicit `is None` check. No test uploads an empty file.
6. **Possible:** two clients uploading under the same key at once can clobber each other. `save_upload` computes the next occurrence index, then writes, with no lock between, so both get the same index and the second `write_bytes` overwrites the first. The two transfer slots allow exactly this pairing. A per-label lock, or opening the payload with `'x'` and retrying on `FileExistsError`, would close it.

### Message Board

1. Sanitizing silently removes characters: `don't` becomes `dont`, and `café ñ 你好 🎉` becomes `caf`. The UI calls the allowlist "URL-safe", yet it strips `&`, `#`, `%`, `+`, and `@`.
2. **Minor:** the 16 KB payload check reads `request.content_length`, so a chunked request (no `Content-Length`) is read in full by `get_json` before any size check. In production Nginx caps `/api/` bodies at 1 MB, so this only matters in development. Checking `len(request.get_data())` would hold everywhere.

## Duplication and Refactoring

Found in a full read of the codebase (2026-11-06). Each item says where the copies are and suggests one shared place for them.

### Shared limits

1. Limits are copied between the backend and the frontend instead of read from the API, and the copies have already drifted.
   - File Share: `RETENTION_SECONDS`, `MAX_FILE_BYTES`, and `MAX_TOTAL_STORAGE_BYTES` (`backend/app/fileshare.py`) appear as text ("10 minutes", "100 MB", "1 GB") in `UtilityFileShare.svelte` (twice) and `Utilities.svelte`. The page also defines its own `MAX_FILE_BYTES`, even though `/api/fileshare/status/` returns `maxFileBytes`. Its storage fallback (`1_073_741_824`) doesn't match the backend's `1_000_000_000`, so the page shows "1.07 GB" until the status loads.
   - The 100 MB upload cap is set in three units in three places: Nginx `100M` (MiB), Flask `MAX_CONTENT_LENGTH` (101 MiB), and `MAX_FILE_BYTES` (decimal MB). `save_upload`'s error message hard-codes "100 MB".
   - Message Board: `MESSAGE_TTL_SECONDS` (`messageboard/api.ts`, with a "must match" comment) and `MAX_LENGTH = 280` (`UtilityMessageBoard.svelte`) copy backend constants. `/api/messageboard/status/` already returns both, but `fetchMessageBoardStatus()` is never called.

### Frontend components

1. Card links are built four separate times: featured projects and quick links in `Home.svelte`, then `Projects.svelte` and `Utilities.svelte`. Each writes `terminal-box hover-lift clickable-card` + title + text + `stretched-link` with its own heading reset and spacing, and `Projects.svelte` overrides the shared hover lift (`-4px` instead of `-2px`). A `<LinkCard title href cta>` component with a `children` snippet (for `TagList`) would replace all four.
2. **Minor:** all 11 pages write out the full `<title>… · JosephCicalese.com</title>` and description, `index.html` repeats the site name three more times, and `ProjectDetail.svelte` repeats its fallback description. A shared `<PageMeta title description>` component would own the suffix.
3. **Minor:** the utility metadata is split up. Each utility's card name and description live in `Utilities.svelte`, the `Utilities / <Name>` header title is hard-coded in each utility page, and the `<title>` is written again. They have already drifted: the File Share card says "password label" while the page says "access key". Each page could export `{ name, description }` from `<script module>` (like its `layout`), and `Utilities.svelte` could read them from `routes`.
4. **Minor:** new-tab links are written by hand with two different `rel` values: `rel="noopener noreferrer"` in `Nav.svelte` and `LocationMap.svelte`, `rel="noreferrer"` in `Contact.svelte` and `ProjectDetail.svelte` (twice). An `<ExternalLink>` component would make them consistent and is the natural fix for Accessibility item 2.
5. **Minor:** the error/success message pair is a snippet (`messages`) in `UtilityFileShare.svelte` and is copied inline in `UtilityMessageBoard.svelte`. The scheduler does the same job with a single `notice` (`SchedulerStore`). A `<FormMessages error success>` component would give the three utilities one pattern.
6. **Minor:** titled panels repeat the same shape (`terminal-box` + heading + body). `AboutYou.svelte` has six identical groups (`h2.prompt`, `p.source`, `FactList`) that could be one `{#each}` over `{ title, source, facts }`. `UtilityFileShare.svelte` has its `.panel` forms and Storage Info box. The scheduler's `lib/scheduler/components/Panel.svelte` (title + `children` snippet) could move to `lib/components/` and cover them.

### Frontend logic

1. **Minor:** route paths are repeated outside `routeDefinitions.ts`: in `Nav.svelte`, in `Home.svelte` (`sectionLinks`, plus `quickLinks`, which link to three of the same pages again on the same page), in `Utilities.svelte`, and in the `<noscript>` list in `index.html`. `/projects/${slug}` is built in `Home.svelte`, `Projects.svelte`, and twice in `vite.config.ts`. A changed path breaks these links silently. Nav labels in `routeDefinitions` plus a `pathFor(key, params)` helper would make a path change one edit.
2. **Minor:** paths are listed by three separate functions: `staticPaths()` in `router.svelte.ts` (used by `NotFound.svelte`), `staticRoutePaths()` in `routeDefinitions.ts`, and `servedPaths()` in `vite.config.ts`. `servedPaths()` also expands aliases the same way `applyRoute` does.
3. Async loading and submitting is hand-rolled eight times, each with its own `loading`/`busy` + error (+ success) state and `try/catch/finally`: `loadStatus`, upload, list, and download in `UtilityFileShare.svelte`, load and post in `UtilityMessageBoard.svelte`, `onMount` in `UtilityScheduler.svelte`, and `refreshServerSnapshot` in `AboutYou.svelte`. A small rune class in a `.svelte.ts` module (`busy`, `error`, `success`, `run(fn)`) would replace them, and one-shot loads could use `{#await}` like `ProjectDetail.svelte` does.
4. **Minor:** formatting helpers are scattered: `formatBytes` (in `fileshare/api.ts`), `formatSeconds` (`UtilityFileShare.svelte`), `formatTimestamp` (`UtilityMessageBoard.svelte`), and `toDisplayValue`, `formatCounts`, and the clock format (`AboutYou.svelte`). The two `toLocaleTimeString` calls use different hour formats. A shared `lib/format.ts` would be unit-testable.
5. **Minor:** `AboutYou.svelte` holds its browser detection (`describeBrowser`, `readBrowser`, `UA_BROWSERS`) and fact building in the component, out of reach of unit tests; a plain `.ts` module would fix that. `getInteractionSnapshot()` in `interactionStore.ts` re-lists every state field to copy it, where `structuredClone(state)` wouldn't need updating when a field is added.
6. **Possible:** Mermaid diagnostics are collected twice, once at build time (`MarkdownRenderDebug` in `plugins/renderMarkdown.ts`, shipped in every project chunk) and again at runtime (`mermaidRun` in `ProjectDetail.svelte`), for the `?debugMermaid=1` panel. If the pipeline is stable, removing both would cut about 80 lines.

### Styles

1. **Minor:** the global `h2` in `app.css` has a bottom border that four components undo: `.project-item h2` (Projects), `.utility-card h2` (Utilities), `.feed-header h2` (Message Board), and `.semester-header h2` (Scheduler). Either move the border onto a section-heading class or add a `.card-title` utility.
2. **Minor:** smaller styles are repeated that could become classes or variables in `app.css`:
   - The error box (error color, border, `--color-error-opacity-05`) appears in `StatusMessage.svelte` and in `.debug-error` (`ProjectDetail.svelte`), and `AboutYou.svelte` styles its own `.error` text.
   - `pre` styling appears twice in `ProjectDetail.svelte` (`.project-content pre` and `.debug-panel pre`).
   - Dashed, tinted boxes (`--color-primary-opacity-30` border on `--color-primary-opacity-10`) appear in File Share `.stats div` and `.file-list`, Scheduler `.semester-column`, and Message Board `.pill`.
   - Each form page re-declares the stacked `label` layout.
3. **Minor:** there are two `blink` keyframes with different timing (`StatusMessage.svelte`, `AboutYou.svelte`). `AboutYou.svelte` and `LocationMap.svelte` also add their own `prefers-reduced-motion` blocks, which the global rule in `app.css` already covers.

### Backend

1. `FileShareError` and `MessageBoardError` are identical classes, and `views.py` turns them into JSON with the same `try/except` → `jsonify({'error': ...}), status` four times. One base error class plus a blueprint `errorhandler` would replace both.
2. Each record type is serialized to camelCase JSON by hand in two places: `FileShareRecord` in `fileshare_upload` and `fileshare_list`, and `BoardMessageRecord` in `messageboard_post_message` and `MessageBoardStore.get_active_messages`. A `to_json()` method on each dataclass would keep each field list in one place.
3. Duplication in `fileshare.py`:
   - `get_record_for_password` and `get_all_records_for_password` run the same `_existing_indices` → `_record_paths` → `_load_record` loop; the first could call the second.
   - The `<label>__<n>` file naming is built in `_record_paths` but parsed separately in `_existing_indices`, `_extract_occurrence_index`, and `_load_record`.
   - `_remove_record` and `cleanup_expired_records` each have their own unlink loop that ignores missing files (`Path.unlink(missing_ok=True)` would replace both), and both `get_storage_status` and `_evict_oldest_records` sum payload sizes.
   - `cleanup_expired_records()` reads every metadata file, yet it runs several times per request: `fileshare_status` calls it, then `get_storage_status` → `iter_active_records` calls it again, and a single upload runs it up to four times.
4. **Minor:** in `messageboard.py`, the expired-message filter is written four times (`cleanup`, `add_message`, `get_active_messages`, `get_status`) and `now if now is not None else time.time()` five times. A `_purge_locked(now)` helper would replace them.
5. **Minor:** `create_app` has two `Flask(...)` calls that differ only by `instance_path` (Flask accepts `None`). It also reads `SECRET_KEY` out of `test_config` and then applies all of `test_config` again.

### Tests

1. Gaps that would have caught items above: a smoke-test route for an unknown project slug (Frontend #4) and a backend test uploading an empty file (File Share #5).
2. `backend/tests/conftest.py` defines `app`, `client`, and `temp_instance_dir` fixtures that no test uses. Instead, the `unittest` classes each build their own `create_app(...)` and temp directory in `setUp` (or inline). `TestMessageBoardAPI` also sets `os.environ['SECRET_KEY']` without restoring it and repeats the autouse store reset. Plain pytest functions using the fixtures would remove this boilerplate.

### Infrastructure and CI

1. **Minor:** `test.yaml` and the `package` job in `deploy.yaml` repeat the same pinned setup steps (checkout, setup-uv, pnpm, setup-node with cache), so bumping an action takes two edits. A local composite action (`.github/actions/setup`) could hold them.
2. **Minor:** some values are hard-coded where Terraform could pass them as template variables. `/var/lib/personalwebsite` appears four times across `startup.sh.tftpl` and `flaskapp.service.tftpl` (`app_path` is already a variable), and port 5000 is in `nginx_api_proxy_params.conf.tftpl`, `deploy.sh.tftpl`, and `main.py`'s default. The three `/api/` locations in `nginx.conf.tftpl` also repeat the same `include` and `limit_req` lines.
3. **Minor:** the site origin is hard-coded in `deploy.yaml`, `vite.config.ts`, `index.html` (Open Graph), `Nav.svelte` (status link), and `robots.txt`, as well as in `variables.tf`.

## Appendix: Non-Issues

These are deliberate. Don't report or "fix" them without revisiting the decision.

### Frontend

- `Home.svelte` hard-codes "Featured Projects" instead of using the project content (`lib/projects/content.ts`), so the owner chooses which projects to display.
- A dark system preference is ignored, and first-time visitors always get the light theme, because the site looks better in light mode.
- The About You map requests tiles from `tile.openstreetmap.org`, which shows a third party the visitor's approximate location, while the page says "Nothing here is stored". The page exists to show that this is possible, so the lack of a disclosure or privacy policy isn't treated as an issue.

### Class Scheduler

- Plans are saved only in the URL fragment, not browser storage or the server, so there are no users to manage. Reaching the scheduler through a site link (no fragment) shows the default plan; Back or the bookmarked URL restores yours.

### File Share

- Uploads need no login, so anyone can upload, and ten 100 MB uploads evict everyone's files. The service is for quick, casual sharing, not permanent storage. Files become inaccessible after 10 minutes, which makes hosting malware on it unrealistic.
- Access keys have no minimum length, and `/api/fileshare/list/` does only a fast HMAC before returning filenames, so Nginx's per-IP rate limit is the only limit on guessing. A correct guess also lets someone replace those files. A file is only as secure as the password its owner chooses.
