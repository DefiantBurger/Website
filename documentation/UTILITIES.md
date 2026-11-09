# Utilities

| Utility | Route | Frontend | Backend |
| --- | --- | --- | --- |
| [Class Scheduler](#class-scheduler) | `/utilities/scheduler` | `lib/scheduler/` (components in `lib/scheduler/components/`), `UtilityScheduler.svelte` | static JSON via `views.py` |
| [File Share](#file-share) | `/utilities/fileshare` | `lib/fileshare/`, `UtilityFileShare.svelte` | `app/fileshare.py` |
| [Message Board](#message-board) | `/utilities/message-board` | `lib/messageboard/`, `UtilityMessageBoard.svelte` | `app/messageboard.py` |

## Class Scheduler

Semester planner that validates prerequisites and draws them as a dependency graph.

### API

- `GET /api/scheduler/default-schedule/` → `backend/app/static/json/my_courses.json`
- `GET /api/scheduler/course-data/` → `backend/app/static/json/course_data.json`

### Data Model

Schedule. Keys are `precollege` (credit already earned) or a term plus a two-digit year: `winter`, `spring`, `summer`, `fall` (`fall24`, `winter25`). Columns are always sorted by date (winter → spring → summer → fall within a year), whatever the key order in the file, and import rejects any other key. An empty `semesters` object is a valid (empty) plan.

```json
{
  "semesters": {
    "precollege": ["MATH 221", "E C E 210"],
    "fall24": ["MATH 222", "CHEM 103", "PHYSICS 499[3]"]
  }
}
```

A `[n]` suffix picks the credit count for a variable-credit course.

Catalog record (`credits`, or `min_credits`/`max_credits` for variable-credit courses):

```json
{
  "PHYS 211": {
    "title": "University Physics: Mechanics",
    "credits": 4,
    "prereqs": [["MATH 221"]],
    "concurrent_prereqs": []
  }
}
```

Each inner list is a group of alternatives (any one satisfies it); every group must be satisfied. `concurrent_prereqs` groups may also be satisfied in the same semester.

### Behavior

- `lib/scheduler/data.ts` loads both files; `catalog.ts` parses credit suffixes and gives each course occurrence a unique ID (`<course>__<n>`, numbered in date order) so repeated courses are distinct.
- `semesters.ts` parses, formats ("Fall 2024"), and sorts term keys. `schedule.ts` holds every edit as a pure function (add/remove/move course, credits, add/remove/rename semester); `history.ts` is the undo/redo stack (100 steps) over those snapshots; `store.svelte.ts` (`SchedulerStore`) is the page state the components share, and every edit goes through `store.apply()` so it can be undone.
- `logic.ts` matches each requirement group to the earliest-scheduled option and checks it: `met` (earlier semester, precollege included), `concurrent` (same semester, allowed), `out-of-order` (scheduled too late), or `missing`. Edges are drawn for every group that has a match, including from precollege. Precollege courses count as earned, so their own requirements aren't checked. Progress is met groups ÷ all groups. `listProblems()` collects the out-of-order and missing groups for the Problems panel; clicking a problem selects the course and scrolls its card into view. Auto-detangle reorders cards within columns using barycenter sweeps to reduce edge crossings.
- UI: precollege is always the first column. Semesters are added from the column after the last one (defaults to the next fall/spring; the first semester of an empty plan defaults to the upcoming one), relabeled with ✎ (columns re-sort), and removed with × (confirms first when the semester has courses, which are deleted). Courses are added by code, dragged between or within columns, moved earlier/later, re-credited, and removed. Repeated courses show `↻`. Clear All empties the whole plan, semesters included; Reset to default plan loads `my_courses.json` again. Both are undoable. Undo/Redo buttons, plus Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y outside text fields. With a course selected (and focus outside text fields), the arrow keys move it (up/down within its semester, left/right across semesters at the same row), Delete/Backspace removes it, and Esc deselects it. Ctrl+S copies the share link, even from a text field. JSON import/export is a secondary way to save a plan.
- Share links (`shareLink.ts`): the plan lives in the URL fragment as `#plan=v1.<base64url(deflate-raw(schedule JSON))>`, using the browser's `CompressionStream`. The fragment never reaches the server. The URL stays bare until the first edit; after that, every change is written with `history.replaceState` (debounced 300 ms), so reloading, Back, and reopening a tab restore the plan. Copy link writes the current URL to the clipboard. Opening a link loads it without auto-detangle, so card order is preserved; pasting a different link into the same tab (`hashchange`) loads it as an undoable step. Decoding is capped at 256 KB of JSON. A new format needs a new version prefix, and the `v1` decoder must be kept so old links still open.
- Validation for links and JSON import is shared (`parseScheduleFile`, then `buildSchedule`). Bad semester keys or a malformed file reject the whole plan; unknown courses and invalid credit values are skipped and listed in a notice, so old links survive catalog changes. A link that can't be decoded on page load shows an error and falls back to the default plan.
- Edges are SVG, redrawn in a `requestAnimationFrame` batch when the schedule changes or a column resizes; selecting a course highlights its edges.

## File Share

Temporary file sharing keyed by an access key: files are encrypted at rest and expire after 10 minutes.

### API

All `POST` bodies are `multipart/form-data`. `password` is the access key.

| Method | Path | Fields | Response |
| --- | --- | --- | --- |
| GET | `/api/fileshare/status/` | | storage status (below) |
| POST | `/api/fileshare/upload/` | `file`, `password`, `clearExisting` (`"true"` deletes the key's existing files first) | upload record (below) |
| POST | `/api/fileshare/list/` | `password` | `{"files": [{occurrenceIndex, originalFilename, sizeBytes, uploadedAt, expiresAt}]}`; 404 if none |
| POST | `/api/fileshare/access/` | `password`, `occurrenceIndex` (default `1`) | file as an `application/octet-stream` attachment |

```json
// status
{ "activeFileCount": 3, "usedBytes": 8451200, "maxFileBytes": 100000000,
  "maxTotalBytes": 1000000000, "retentionSeconds": 600 }

// upload
{ "label": "<hex HMAC>", "originalFilename": "report.pdf", "sizeBytes": 123456,
  "uploadedAt": "2026-05-01T12:00:00+00:00", "expiresAt": "2026-05-01T12:10:00+00:00" }
```

Errors: `400` missing key/file, `403` decryption failed, `404` no matching file, `413` file over 100 MB, `503` storage full or too many concurrent transfers.

### Behavior

`backend/app/fileshare.py`:

- **Lookup.** The label is HMAC-SHA256(access key) keyed with `SECRET_KEY`, so stored labels can't be brute-forced without the server secret. A key can hold several files, stored as `<label>.json`/`.payload`, `<label>__2.json`/`.payload`, and so on, in `instance/fileshare/`.
- **Encryption.** Each file gets a random salt; scrypt (n=2¹⁴, r=8, p=1) derives an AES-256-GCM key from the access key.
- **Limits.** 100 MB per file, 1 GB total. If an upload would exceed the total, the oldest files are evicted; if that still isn't enough, the upload fails with `503`. At most 2 uploads/downloads run at once (`MAX_CONCURRENT_TRANSFERS`), because each holds about 3× the file size in RAM on a 1 GB VM.
- **Expiry.** Expired files are deleted during file-share API requests, not on a schedule.
- **Downloads** ignore the uploader's MIME type and send `X-Content-Type-Options: nosniff`, so uploaded HTML can't execute on the site's origin.

The UI uploads one or more files under one key (the first upload sends `clearExisting=true`, so a new batch replaces the key's previous files), lists the key's files, and downloads them individually or all at once.

## Message Board

Anonymous board where messages expire 60 seconds after posting.

### API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/messageboard/messages/` | | `{messages, retentionSeconds}`, newest first |
| POST | `/api/messageboard/messages/` | JSON or form: `{"text": "..."}` | `201` with the message |
| GET | `/api/messageboard/status/` | | `{activeCount, retentionSeconds, maxMessageLength, maxMessages}` |

Message shape: `{"id": "<uuid4>", "text": "...", "createdAt": "<ISO 8601>", "expiresAt": "<ISO 8601>"}`.

Errors: `400` empty, non-string, or over 280 characters after sanitizing; `413` body over 16 KB; `429` rate limit.

```bash
curl -s -X POST http://localhost:5000/api/messageboard/messages/ \
  -H "Content-Type: application/json" -d '{"text":"Hello from curl!"}'
```

### Behavior

`backend/app/messageboard.py`:

- **Sanitizing.** Keeps only letters, digits, whitespace, and ``,.-!/()=?`*;:_{}[]\|~^``; everything else (including `<>&"'` and most control characters) is removed. Runs of 3+ newlines collapse to 2.
- **Storage.** In-process memory behind a lock: up to 200 messages (oldest evicted), purged of expired messages on every read and write, and lost on restart.
- **Rate limit.** 5 posts per 10 seconds per client IP (sliding window; `CF-Connecting-IP` in production). It is checked before validation, so rejected posts also count.

The page loads messages on mount, after posting, and on "Reload Board" (no polling) and renders text with Svelte interpolation, never `{@html}`.

## Adding a Utility

1. Add the path to `frontend/src/lib/routeDefinitions.ts` and the page to `frontend/src/lib/routes.ts`. The 404 suggestions and the sitemap pick it up automatically. For the wider layout, export `const layout: PageLayout = { wide: true }` from the page's `<script module>`.
2. Add the page in `frontend/src/pages/` and its logic/API client in `frontend/src/lib/<name>/`, using the helpers in `lib/api.ts`.
3. Add a card to the `utilities` list in `Utilities.svelte`.
4. Add backend routes under `/api/<name>/` in `backend/app/views.py` (logic in its own module) with tests in `backend/tests/`.
5. Document it here, and list any gaps in [Issues](./ISSUES.md#utilities).
