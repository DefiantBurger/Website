# Issues

Items are confirmed issues unless labelled **High** (priority), **Likely**, **Possible** (needs review), or **Minor**. **Cleanup** marks dead or redundant code whose removal shouldn't change behavior. Deliberate behavior that can look like a bug is listed in the [appendix](#appendix-non-issues).

## Frontend

### SEO

1. **Minor:** `apple-touch-icon.png` (180px) and `og-image.png` (512px) are upscaled from the 128px favicon, so they're a little blurry. Replace them if a larger source image turns up.

### General

1. **Minor:** `Home.svelte` still features a placeholder card ("Project 2", "Description coming soon...") on the live site, though `j-ball-basketball` exists. The page also links About, Utilities, and Contact three times on one screen (nav, header links, Quick Links).
2. **Minor:** The 404 page always shows "Did you mean ...?", since `closest()` returns the nearest path however far it is (e.g. `/zzzzzz` suggests some unrelated page). A distance cutoff would fix it.
3. **Minor:** `App.svelte` builds the canonical link from `window.location.origin`, while the build (`plugins/routeHtml.ts`) uses `SITE_ORIGIN`. They only agree because Cloudflare redirects other hosts; use `SITE_ORIGIN` in both.

## Infrastructure

1. **Minor:** Cloudflare Email Routing (and the MX, SPF, and DKIM records it owns) is configured outside Terraform, since provider v4 can't import its settings. Revisit after upgrading to provider v5.
2. **Minor:** `pnpm audit` reports three advisories with no in-range fix: KaTeX 0.16.47 (low, pinned to `^0.16` by Mermaid 11), and minimatch 10 (moderate, via ESLint) and deepmerge (low, via the Svelte Vite plugin, no patched release), which are both dev-only. Mermaid 12 would clear KaTeX.

## Utilities

### File Share

1. Whole files are held in memory during transfer. Encrypting in fixed-size chunks (e.g. AES-GCM per 1 MB with per-chunk nonces, streamed to disk) would keep memory flat and allow raising the concurrency cap.
2. Expiry is request-driven; idle files linger until the next file-share request.
3. **Possible:** "Download All" starts each download after an `await`, outside the click's user activation, so Chrome may prompt for or block multiple automatic downloads. Needs a manual check.

## Code Quality

Refactors from a code-quality review (2026-11-10). Every item is **Cleanup** (no behavior change) unless it says otherwise. For each one: make the change as written, run `./test.sh --no-browser`, keep the existing tests passing (they pin the behavior), and delete the item here. Don't widen the scope; anything else you notice goes in a separate change. Messages shown to users and returned by the API stay word-for-word the same unless the item says they change.

### Frontend

1. **Cleanup (small wording change, approved by the owner):** `pages/UtilityFileShare.svelte` has `handleDownload` and `handleDownloadAll`, which are the same function for a list of one file versus all of them. Replace both, plus the `downloadFile` helper, with one `startDownloads(files: FileShareRecord[])`: get the key with `requireAccessKey('Enter the access key to retrieve files.')`; if `files` is empty, `access.fail('No files available for download.')` and return; otherwise inside `access.run`, loop over `files` calling `saveBlob(await downloadFileShare(key, file.occurrenceIndex), file.originalFilename)` and collect failures in the same `- name: reason` format as now. Then `const succeeded = files.length - failures.length`; if `succeeded > 0`, `access.success = \`Started ${succeeded} download${succeeded === 1 ? '' : 's'}.\``; if `failures.length > 0`, `access.error = \`${succeeded} succeeded, ${failures.length} failed:\n${failures.join('\n')}\``. The Download button calls `startDownloads(accessFiles.filter((file) => file.occurrenceIndex === selectedFileIndex))` and Download All calls `startDownloads(accessFiles)`. What changes for the user: one download now says "Started 1 download." instead of "Started download for <name>.", and an all-successful batch says "Started N downloads." instead of "N succeeded, 0 failed.".

2. **Cleanup:** same file, the `stats` derived lists the four labels twice (once paired with values, once with `'—'`). Replace it with a table of rows so each label appears once; the template's `{#each stats as [label, value] (label)}` stays as it is:

   ```ts
   const STAT_ROWS: [label: string, value: (status: FileShareStatus) => string][] = [
     ['Active files', (s) => String(s.activeFileCount)],
     ['Retention', (s) => formatDuration(s.retentionSeconds)],
     ['Per-file cap', (s) => formatBytes(s.maxFileBytes)],
     ['Storage used', (s) => `${formatBytes(s.usedBytes)} / ${formatBytes(s.maxTotalBytes)}`],
   ];
   const stats = $derived(STAT_ROWS.map(([label, value]) => [label, status ? value(status) : '—']));
   ```

3. **Cleanup:** use type guards instead of casts. (a) `lib/aboutYou/facts.ts` `hasCoordinates()` returns `boolean`, so `pages/AboutYou.svelte` needs `geo.latitude as number` and `geo.longitude as number` when rendering `LocationMap`. Add `type Geolocation = RequestContextSnapshot['geolocation'];` and change the signature to `export function hasCoordinates(geo: Geolocation): geo is Geolocation & { latitude: number; longitude: number }` (same body), then drop both casts; TypeScript narrows inside `{#if geo && hasCoordinates(geo)}`. (b) `lib/scheduler/components/CourseDetails.svelte` builds `overlaps` with a `scheduledId` and the template then looks the course up again in `{@const scheduled = ...}`. Store the course instead: `scheduled: store.overlapPartners(course.id).map((id) => store.schedule.coursesById[id]).find((partner) => partner?.name === name)`, use `overlap.scheduled` in the template, and delete the `{@const}`.

4. **Cleanup:** `lib/router.svelte.ts` `navigate()` recovers the query/hash with `path.slice(path.split(/[?#]/)[0].length)`, and `normalizePath` in `lib/routeMatching.ts` splits the same way. Add to `routeMatching.ts`:

   ```ts
   /** `/a/b?x#y` -> `['/a/b', '?x#y']`. */
   export function splitPath(path: string): [pathname: string, suffix: string] {
     const end = path.search(/[?#]/);
     return end < 0 ? [path, ''] : [path.slice(0, end), path.slice(end)];
   }
   ```

   Use it in `normalizePath` (`const [pathname] = splitPath(path);`) and in `navigate` (`const [pathname, suffix] = splitPath(path); const canonicalPath = normalizePath(pathname);`). Add a `splitPath` case to `tests/unit/routeMatching.test.ts` (no query, query only, hash only, both).

5. **Cleanup (owner approved ES2024):** two hand-rolled groupings can use `Object.groupBy`. Set `"target": "es2024"` in `frontend/tsconfig.json` (the `lib` default follows `target`, and the base `@tsconfig/svelte` sets neither; `tsconfig.node.json` stays on ES2023). Then: (a) `lib/scheduler/logic.ts` `buildCourseIdsByName()`: `const bySemester = (course: { semester: string }) => indexOf(semesterToIndex, course.semester);` then `return Object.fromEntries(Object.entries(Object.groupBy(Object.values(coursesById), (course) => course.name)).map(([name, courses = []]) => [name, courses.toSorted((a, b) => bySemester(a) - bySemester(b)).map((course) => course.id)]));`. `Object.groupBy` returns `Partial<Record<string, T[]>>`, hence the `= []` default in the destructuring. (b) `lib/scheduler/schedule.ts` `repeatPositions()`: build the board-ordered course list first, `boardColumns(schedule).flatMap((semester) => (schedule.columnCourseIds[semester] ?? []).map((id) => schedule.coursesById[id]).filter((course) => !!course))`, group it with `Object.groupBy(..., (course) => course.name)`, and fill `positions` from every group with more than one entry as now. Runtime note: Vite doesn't polyfill `Object.groupBy`, so Safari before 17.4 and Chrome before 117 would throw on the scheduler page; the owner accepted that. `scheduleGraph` and `repeatPositions` tests in `scheduler.test.ts` pin the results.

6. **Cleanup:** one-line items.
    - `lib/api.ts` computes `response.headers.get('content-type')?.toLowerCase() ?? ''` in both `readErrorMessage` and `apiJson`; add `const contentTypeOf = (response: Response) => response.headers.get('content-type')?.toLowerCase() ?? '';` and call it from both.
    - `plugins/renderMarkdown.ts` `rehypeMermaid`'s visitor is four sequential early returns; fold them into one: `const code = node.children?.[0]; if (!parent?.children || index === undefined || node.tagName !== 'pre' || code?.tagName !== 'code') { return; }`.
    - `pages/AboutYou.svelte` has two separate `.hero { ... }` rules inside the same `@media (max-width: 768px)` block; merge them.
    - Exports nothing imports: drop `export` from `deleteFileShareFiles` (`lib/fileshare/api.ts`), `BACKEND_BASE_URL` (`lib/api.ts`), and `HISTORY_LIMIT` (`lib/scheduler/history.ts`), and inline `FileShareListResult` as `Promise<{ files: FileShareRecord[] }>`. (`pnpm dlx knip` finds these without adding a dependency.)

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
