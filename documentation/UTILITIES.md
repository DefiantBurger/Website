# Utilities

| Utility | Route | Frontend | Backend |
| --- | --- | --- | --- |
| [Class Scheduler](#class-scheduler) | `/utilities/scheduler` | `lib/scheduler/`, `UtilityScheduler.svelte` | static JSON via `views.py` |
| [File Share](#file-share) | `/utilities/fileshare` | `lib/fileshare/`, `UtilityFileShare.svelte` | `app/fileshare.py` |
| [Message Board](#message-board) | `/utilities/message-board` | `lib/messageboard/`, `UtilityMessageBoard.svelte` | `app/messageboard.py` |

## Class Scheduler

Semester planner that validates prerequisites and draws them as a dependency graph.

### API

- `GET /api/scheduler/default-schedule/` → `backend/app/static/json/physics_courses.json`
- `GET /api/scheduler/course-data/` → `backend/app/static/json/course_data.json`

### Data Model

Schedule (semester key order is display order; `precollege` holds credit already earned and is not shown as a column):

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

- `lib/scheduler/data.ts` loads both files, parses credit suffixes, and gives each course occurrence a unique ID (`<course>__<n>`) so repeated courses are distinct.
- `lib/scheduler/logic.ts` matches each requirement group to the earliest-scheduled option and marks the edge `valid` (earlier semester), `concurrent` (same semester, allowed), or `invalid`. A course's progress is satisfied groups ÷ groups not already met by `precollege`. Auto-detangle reorders cards within semesters using barycenter sweeps to reduce edge crossings.
- UI: add courses by code, drag and drop between or within semesters, move the selected course earlier/later, edit its credits, remove it, clear all, and import/export the plan as JSON. Import rejects unknown courses and invalid credit values.
- Edges are SVG, redrawn in a `requestAnimationFrame` batch; selecting a course highlights its edges.

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
  "maxTotalBytes": 1000000000, "retentionSeconds": 600, "uploadsPaused": false }

// upload
{ "label": "<hex HMAC>", "originalFilename": "report.pdf", "sizeBytes": 123456,
  "uploadedAt": "2026-05-01T12:00:00+00:00", "expiresAt": "2026-05-01T12:10:00+00:00",
  "downloadEndpoint": "/api/fileshare/access/" }
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

Anonymous board where messages expire 30 seconds after posting.

### API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/messageboard/messages/` | | `{messages, serverTime, retentionSeconds, totalActive}`, newest first |
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

1. Add the route to `frontend/src/lib/routes.ts` (with `wide: true` for the wider layout). The 404 suggestions pick it up automatically.
2. Add the page in `frontend/src/pages/` and its logic/API client in `frontend/src/lib/<name>/`, using the helpers in `lib/api.ts`.
3. Add a card to the `utilities` list in `Utilities.svelte`.
4. Add backend routes under `/api/<name>/` in `backend/app/views.py` (logic in its own module) with tests in `backend/tests/`.
5. Document it here, and list any gaps in [Known Issues](./KNOWN-ISSUES.md#utilities).
