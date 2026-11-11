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
4. **Minor:** An upload body between Flask's `MAX_CONTENT_LENGTH` (`MAX_FILE_BYTES` + 1 MiB, ~81.05 MB) and Nginx's `81M` (~84.9 MB) gets Werkzeug's HTML 413, not JSON, though the comment in `app/__init__.py` says otherwise. The frontend falls back to a status-based message, so users still see an error. An `@app.errorhandler(413)` returning `{'error': ...}` would fix it.

## Code Quality

Refactors from a code-quality review (2026-11-10). Every item is **Cleanup** (no behavior change) unless it says otherwise. For each one: make the change as written, run `./test.sh --no-browser`, keep the existing tests passing (they pin the behavior), and delete the item here. Don't widen the scope; anything else you notice goes in a separate change. Messages shown to users and returned by the API stay word-for-word the same unless the item says they change.

### Backend

1. **Cleanup:** `app/views.py` mixes two error styles. `@views.errorhandler(ApiError)` already turns a raised `ApiError` into `{'error': message}` with its status code, but seven views still `return jsonify({'error': ...}), <code>` by hand: `fileshare_upload` (400), `fileshare_delete` (400), `fileshare_access` (400 and 404), `fileshare_list` (404), and `messageboard_post_message` (429 and 413). Replace each with `raise ApiError(<same message>, <same code>)`. Add one helper next to `_parse_coordinate` and use it in both `fileshare_delete` (inside the list comprehension) and `fileshare_access`, deleting their `try`/`except ValueError` blocks:

   ```python
   def _parse_index(value: str) -> int:
   	try:
   		return int(value)
   	except ValueError:
   		raise ApiError('Invalid occurrence index.') from None
   ```

   Also move the `uploaded_file is None` check out of `fileshare_upload` into `save_upload` (`app/fileshare.py`): type the parameter `FileStorage | None` and fold it into the existing filename check, `if uploaded_file is None or not (uploaded_file.filename or '').strip(): raise FileShareError('A file is required.')`. The view then reads `password = ...`, `with transfer_slot(): record = save_upload(request.files.get('file'), password)`, `return jsonify(record.to_json())`. `tests/test_views.py` and `tests/test_fileshare.py` match on the message texts and status codes.

2. **Cleanup:** `app/fileshare.py` `save_upload()` builds a placeholder record with `occurrence_index=0`, then `replace()`s it, and its `metadata` dict re-lists every field of `FileShareRecord` by hand. Restructure the end of the function: keep `occurrence_index: int | None = None` before the `try`; inside the `try`, call `_write_new_payload` first, then build `record = FileShareRecord(label=label, occurrence_index=occurrence_index, ...)` with the real index (`now = _now_utc()` can move here too), then write the metadata as `{key: value for key, value in asdict(record).items() if key not in ('label', 'occurrence_index')}`; after the `try`, `return record`. Import `asdict` from `dataclasses`; `replace` becomes unused. The `except OSError` branch stays as is (it still needs the `is not None` check, since `_write_new_payload` can be what raised). Leave `_load_record` alone: its per-field coercion and defaults are deliberate validation of files on disk, not duplication.

3. **Cleanup:** `app/messageboard.py`. (a) `RateLimiter.check_and_record` assigns `self._requests[key] = timestamps` on both branches. Assign once up front, `timestamps = self._requests[key] = [t for t in self._requests.get(key, []) if t > cutoff]`, then `if len(timestamps) >= self.max_requests: return False`, then `timestamps.append(current_time)`. The list is shared by reference, so the append is visible through the dict and the second assignment goes away. (b) `datetime.fromtimestamp(x, UTC).isoformat()` appears three times (`add_message` twice, `snapshot` once) and `current_time + self.ttl_seconds` twice. Add `def _iso(epoch: float) -> str: return datetime.fromtimestamp(epoch, UTC).isoformat()` next to `_now`, compute `expires_epoch = current_time + self.ttl_seconds` once in `add_message`, and use `_iso` in all three places (`created_dt`/`expires_dt` go away). `tests/test_messageboard.py` covers both.

4. **Cleanup:** `app/__init__.py`. (a) The `with app.app_context():` around `from .views import views` does nothing: importing the blueprint needs no app (verified with `python -c "from app.views import views"`, which works with no app at all). Move the import to the top of the file next to `from .fileshare import MAX_FILE_BYTES` and call `app.register_blueprint(views, url_prefix='/')` directly. (b) The two `if app.config['SECRET_KEY'] is None:` checks read as one: `app.config['SECRET_KEY'] = app.config['SECRET_KEY'] or os.getenv('SECRET_KEY')` followed by `if not app.config['SECRET_KEY']: raise ValueError('SECRET_KEY environment variable is not set')`. Keep that message; `tests/test_app.py` matches it. This also rejects an empty string, which is right for a secret.

5. **Cleanup:** `messageboard_post_message` in `app/views.py` accepts two body formats: JSON (`{"text": ...}`) and HTML form encoding (`text=...`), via a fallback to `request.form` guarded by `hasattr(data, 'get')`. Only the site's frontend posts to it, and it only sends JSON (`lib/messageboard/api.ts`); the owner confirmed nothing else uses the form path. Delete the fallback, the `hasattr` guard, and `test_post_via_form_data` in `tests/test_messageboard.py`, leaving `data = request.get_json(silent=True)` and `text = data.get('text') if isinstance(data, dict) else None`. A form-encoded post then gets the existing "Message text is required." 400 from `sanitize_message_text`, which is fine.

6. **Cleanup:** `app/fileshare.py` `_existing_indices()` uses `path.name.split('.', 1)[0]`; that's `path.stem`. Every stored file has exactly one suffix (`.json` or `.payload`), and the dot-prefixed temp files never match the `<label>*` glob.

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

3. **Cleanup:** `lib/scheduler/catalog.ts` looks the same course up three times per `createCourse()`: `resolveCredits` calls `catalogEntry` only to throw, `getValidCredits` looks it up again, and `createCourse` a third time for the title. Add `function creditOptions(item: CourseCatalogRecord): number[]` holding the body of `getValidCredits` after its lookup (the `typeof item.credits === 'number'` branch and the min/max range). `getValidCredits` becomes `const item = lookupCourse(catalog, courseName); return item ? creditOptions(item) : [];`. Change `resolveCredits` to take `(item: CourseCatalogRecord, courseName: string, requestedCredits?: number)` and use `creditOptions(item)`; `courseName` is only for the error message. `createCourse` does `const item = catalogEntry(catalog, courseName);` once and uses it for both `credits` and `title`. Import `CourseCatalogRecord` from `./types`. `tests/unit/scheduler.test.ts` covers `getValidCredits`, `buildSchedule`, and the credit-validation errors.

4. **Cleanup:** `lib/scheduler/logic.ts` `detangleCourseOrder()` is written in a different style from the rest of the file. (a) The two `if (!neighbors[x]) { neighbors[x] = new Set(); }` blocks plus the two `.add` calls become `(neighbors[edge.toCourseId] ??= new Set()).add(edge.fromCourseId);` and `(neighbors[edge.fromCourseId] ??= new Set()).add(edge.toCourseId);`, the idiom `buildCreditOverlapIndex` in `catalog.ts` already uses. (b) The three-`if` comparator passed to `scored.sort` is `a.barycenter - b.barycenter || a.currentPosition - b.currentPosition || a.courseId.localeCompare(b.courseId)`, the same `||` chain `compareResults` uses higher in the file. (c) The returned object in `scored` can be the shorthand `{ courseId, barycenter, currentPosition }`. The `detangleCourseOrder` test pins the output order.

5. **Cleanup:** `lib/scheduler/catalog.ts` `requirementParts()` evaluates `isComposite(child) && bareGroups && isFlat(child)` twice: once inside the `rendered` map and again for `hasBareGroup`. Define `const isBareGroup = (child: RequirementNode) => bareGroups && isComposite(child) && isFlat(child);` once after `bareGroups`. In the map, the condition `isComposite(child) && !(bareGroups && isFlat(child))` is exactly `isComposite(child) && !isBareGroup(child)`; and `hasBareGroup` becomes `children.some(isBareGroup)`. The `requirementParts` tests pin every output string.

6. **Cleanup:** use type guards instead of casts. (a) `lib/aboutYou/facts.ts` `hasCoordinates()` returns `boolean`, so `pages/AboutYou.svelte` needs `geo.latitude as number` and `geo.longitude as number` when rendering `LocationMap`. Add `type Geolocation = RequestContextSnapshot['geolocation'];` and change the signature to `export function hasCoordinates(geo: Geolocation): geo is Geolocation & { latitude: number; longitude: number }` (same body), then drop both casts; TypeScript narrows inside `{#if geo && hasCoordinates(geo)}`. (b) `lib/scheduler/components/CourseDetails.svelte` builds `overlaps` with a `scheduledId` and the template then looks the course up again in `{@const scheduled = ...}`. Store the course instead: `scheduled: store.overlapPartners(course.id).map((id) => store.schedule.coursesById[id]).find((partner) => partner?.name === name)`, use `overlap.scheduled` in the template, and delete the `{@const}`.

7. **Cleanup:** `lib/router.svelte.ts` `navigate()` recovers the query/hash with `path.slice(path.split(/[?#]/)[0].length)`, and `normalizePath` in `lib/routeMatching.ts` splits the same way. Add to `routeMatching.ts`:

   ```ts
   /** `/a/b?x#y` -> `['/a/b', '?x#y']`. */
   export function splitPath(path: string): [pathname: string, suffix: string] {
     const end = path.search(/[?#]/);
     return end < 0 ? [path, ''] : [path.slice(0, end), path.slice(end)];
   }
   ```

   Use it in `normalizePath` (`const [pathname] = splitPath(path);`) and in `navigate` (`const [pathname, suffix] = splitPath(path); const canonicalPath = normalizePath(pathname);`). Add a `splitPath` case to `tests/unit/routeMatching.test.ts` (no query, query only, hash only, both).

8. **Cleanup (owner approved ES2024):** two hand-rolled groupings can use `Object.groupBy`. Set `"target": "es2024"` in `frontend/tsconfig.json` (the `lib` default follows `target`, and the base `@tsconfig/svelte` sets neither; `tsconfig.node.json` stays on ES2023). Then: (a) `lib/scheduler/logic.ts` `buildCourseIdsByName()`: `const bySemester = (course: { semester: string }) => indexOf(semesterToIndex, course.semester);` then `return Object.fromEntries(Object.entries(Object.groupBy(Object.values(coursesById), (course) => course.name)).map(([name, courses = []]) => [name, courses.toSorted((a, b) => bySemester(a) - bySemester(b)).map((course) => course.id)]));`. `Object.groupBy` returns `Partial<Record<string, T[]>>`, hence the `= []` default in the destructuring. (b) `lib/scheduler/schedule.ts` `repeatPositions()`: build the board-ordered course list first, `boardColumns(schedule).flatMap((semester) => (schedule.columnCourseIds[semester] ?? []).map((id) => schedule.coursesById[id]).filter((course) => !!course))`, group it with `Object.groupBy(..., (course) => course.name)`, and fill `positions` from every group with more than one entry as now. Runtime note: Vite doesn't polyfill `Object.groupBy`, so Safari before 17.4 and Chrome before 117 would throw on the scheduler page; the owner accepted that. `scheduleGraph` and `repeatPositions` tests in `scheduler.test.ts` pin the results.

9. **Cleanup:** one-line items.
    - `lib/scheduler/semesters.ts` `parseSemesterKey` hardcodes `2000 + Number(match[2])` a few lines below `MIN_YEAR = 2000`; use `MIN_YEAR`.
    - `sortSemesters` in the same file: `keys.toSorted((a, b) => rank(a) - rank(b))` instead of `[...keys].sort(...)`.
    - `lib/scheduler/store.svelte.ts` `overlapPartners()` is a nested ternary inside `flatMap`; write it as `.filter((overlap) => overlap.courseId === courseId || overlap.otherCourseId === courseId).map((overlap) => (overlap.courseId === courseId ? overlap.otherCourseId : overlap.courseId))`.
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
