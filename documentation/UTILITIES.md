# Utilities

## Purpose

This document tracks utility-specific behavior, APIs, and operational notes.

Current utility:

- Class Scheduler (`/utilities/scheduler`)
- File Share (`/utilities/fileshare`)
- Message Board (`/utilities/message-board`)

As more utilities are added, each utility should get its own section under this document.

## Utility Architecture Pattern

Utilities follow the same pattern:

1. Route is mounted under `/utilities/<name>` in frontend router.
2. Utility-specific state and logic live in `frontend/src/lib/<utility>/`.
3. Optional API endpoints are exposed from backend under `/api/<utility>/...`.
4. Utility data contracts are documented in this file.

## Class Scheduler

### Summary

Interactive semester planning with prerequisite validation and dependency graph visualization.

### Route

- `/utilities/scheduler`

### Data Sources

Backend APIs:

- `GET /api/scheduler/default-schedule`
- `GET /api/scheduler/course-data`

### Data Model

Schedule shape:

```json
{
  "semesters": {
    "precollege": ["MATH 221", "E C E 210"],
    "fall24": ["MATH 222", "CHEM 103"]
  }
}
```

Catalog record shape:

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

Course entries may include explicit credits in bracket notation:

- `COURSE NAME[4]`

### Core Behavior

`frontend/src/lib/scheduler/data.ts`:

- validates JSON content type,
- parses optional credit suffix notation,
- expands entries into unique instance IDs,
- builds requirements per course instance.

`frontend/src/lib/scheduler/logic.ts`:

- computes edge status (`valid`, `invalid`, `concurrent`),
- computes requirement progress,
- supports detangling semester order via barycenter sweeps.

Progress model:

$$
\text{progress} = \frac{\text{satisfied requirement groups}}{\text{expected requirement groups}}
$$

### Interaction Model

- drag and drop across semesters,
- drop-above reordering,
- move earlier/later controls,
- remove selected course,
- clear-all with confirmation,
- import/export schedule JSON with validation.

Validation behavior:

- malformed credit syntax raises explicit errors,
- invalid/out-of-range credits are rejected,
- unknown imported course codes fail import.

### Rendering

- SVG edges between course cards,
- invalid edges emphasized,
- selection highlights related edges,
- redraw batching via `requestAnimationFrame`.

### API Checks

```bash
curl -s http://localhost:5000/api/scheduler/default-schedule | jq .
curl -s http://localhost:5000/api/scheduler/course-data | jq .
```

### Known Gaps

1. Seed data may be incomplete/inaccurate.
2. User edits are in-memory unless exported manually.
3. No persistence API or user profile support.

### Next Improvements

1. Add localStorage persistence fallback.
2. Add persistence API design for saved plans.
3. Add scheduler-specific test coverage for parser, validation, and interaction flows.

## Adding a New Utility

When adding another utility:

1. Add route under `/utilities/<name>` in `frontend/src/lib/router.ts`.
2. Add page component in `frontend/src/pages/`.
3. Add utility library folder in `frontend/src/lib/<name>/`.
4. Add backend endpoints under `/api/<name>/...` when needed.
5. Add a new section in this file documenting data contracts, behavior, and checks.

## File Share

### Summary

Access-key-labeled local file sharing with automatic expiration, encryption at rest,
and backend-enforced storage limits.

### Route

- `/utilities/fileshare`

### Data Sources

Backend APIs:

- `GET /api/fileshare/status`
- `POST /api/fileshare/upload`
- `POST /api/fileshare/access`

### Data Model

Upload request fields:

```text
file: multipart file payload
password: share password
```

Upload response shape:

```json
{
  "label": "HMAC-SHA256 of the access key, keyed with SECRET_KEY",
  "originalFilename": "report.pdf",
  "sizeBytes": 123456,
  "uploadedAt": "2026-05-01T12:00:00+00:00",
  "expiresAt": "2026-05-01T12:10:00+00:00",
  "downloadEndpoint": "/api/fileshare/access"
}
```

Status response shape:

```json
{
  "activeFileCount": 3,
  "usedBytes": 8451200,
  "maxFileBytes": 100000000,
  "maxTotalBytes": 1000000000,
  "retentionSeconds": 600,
  "uploadsPaused": false
}
```

### Core Behavior

`backend/app/fileshare.py`:

- derives a deterministic label from the access key with HMAC-SHA256 keyed by `SECRET_KEY`
  (a server-side pepper), so labels on disk can't be brute-forced without the server secret,
- derives a per-file encryption key from the same access key using a random salt and
  a memory-hard KDF,
- encrypts payload bytes with an authenticated cipher before writing them to disk,
- stores uploads on local disk under the backend instance path,
- supports multiple files per label and will replace previous files when an upload
  is performed with the same access key (first file in a batch clears prior files),
- enforces a 100 MB per-file cap,
- allows at most 2 uploads/downloads at a time (`MAX_CONCURRENT_TRANSFERS`); further requests get
  `503` "busy, try again" instead of running the 1 GB VM out of memory,
- always serves downloads as `application/octet-stream` with `nosniff`, ignoring the MIME type the
  uploader supplied, so an uploaded HTML file can never render on the site's origin,
- deletes expired files older than 10 minutes,
- when accepting an upload would exceed the 1 GB live-storage cap the backend will
  evict oldest active files (by upload time) until enough space is freed; if eviction
  cannot free sufficient space the upload is rejected.

### Interaction Model

- upload one or more files with an access key together,
- retrieve files by entering the same access key,
- keep payloads encrypted at rest while still allowing label-based lookup by access key,
- show live storage status in the UI; the backend will evict oldest files as needed
  to accommodate new uploads when storage is near capacity,
- surface backend errors for expired files and quota failures when eviction cannot
  free enough space.

### API Checks

```bash
curl -s http://localhost:5000/api/fileshare/status | jq .
```

### Known Gaps

1. Storage is local to the VM and is not shared across instances.
2. Expiration cleanup is request-driven, so inactive files are removed on the next file-share API call.
3. No authentication or user-scoped ownership model exists yet.

### Next Improvements

1. Stream uploads and downloads instead of holding whole files in memory. Today a transfer
   reads the full file, then encrypts or decrypts it in one piece, using roughly 3x the file size
   in RAM. That is why concurrent transfers are capped at 2. Encrypting in fixed-size chunks
   (e.g. AES-GCM per 1 MB chunk with per-chunk nonces, written straight to disk) would keep memory
   near-constant per transfer and allow raising or removing the cap.
2. Add scheduled background cleanup so expiration does not depend on traffic.
3. Add backend tests for upload limits, eviction behavior, and quota recovery.
4. Consider a future shared storage backend if multi-VM deployment becomes necessary.

## Message Board

### Summary

Anonymous ephemeral message board where messages automatically expire after around 30 seconds. Uses a strict URL-safe character allowlist for positive input sanitization to eliminate HTML, script, and server injection.

### Route

- `/utilities/message-board` (alias: `/utilities/messageboard`)

### Data Sources

Backend APIs:

- `GET /api/messageboard/messages/`
- `POST /api/messageboard/messages/`
- `GET /api/messageboard/status/`

### Data Model

Post request payload:

```json
{
  "text": "Hello, world!"
}
```

Post response shape:

```json
{
  "id": "c7a80fa4-1f7c-473d-9d48-6a56f916c68b",
  "text": "Hello, world!",
  "createdAt": "2026-09-11T20:45:00.000000+00:00",
  "expiresAt": "2026-09-11T20:45:30.000000+00:00"
}
```

Messages list response shape:

```json
{
  "messages": [
    {
      "id": "c7a80fa4-1f7c-473d-9d48-6a56f916c68b",
      "text": "Hello, world!",
      "createdAt": "2026-09-11T20:45:00.000000+00:00",
      "expiresAt": "2026-09-11T20:45:30.000000+00:00"
    }
  ],
  "serverTime": "2026-09-11T20:45:05.123456+00:00",
  "retentionSeconds": 30,
  "totalActive": 1
}
```

### Core Behavior

`backend/app/messageboard.py`:

- Enforces a positive character allowlist: `^0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,.-!/()=?`*;:_{}[]\|~` plus standard spaces and newlines.
- Strips any character outside the allowlist (specifically `<, >, &, ", '` and any non-printable control characters or null bytes).
- Collapses excessive blank lines and enforces a 280-character limit.
- Rejects empty messages with HTTP 400.
- Thread-safe in-memory store protected by `threading.Lock()` for Waitress multi-threaded production execution.
- Messages automatically expire 30 seconds after creation (`MESSAGE_TTL_SECONDS = 30.0`). Expired messages are purged on every read and write.
- Enforces an in-memory storage cap of 200 messages (evicts oldest when full).
- Implements per-IP rate limiting (sliding window: max 5 messages per 10 seconds per IP) returning HTTP 429 when exceeded.

`frontend/src/lib/messageboard/api.ts` & `frontend/src/pages/UtilityMessageBoard.svelte`:

- Fetches active messages on page load or when the user clicks "Reload Board".
- Terminal aesthetic matching the site's dark/light muted terminal theme.
- Displays post timestamp and message text.
- Safe rendering using standard Svelte text interpolation (never `{@html}`).

### API Checks

```bash
curl -s http://localhost:5000/api/messageboard/status/ | jq .
curl -s http://localhost:5000/api/messageboard/messages/ | jq .
curl -s -X POST http://localhost:5000/api/messageboard/messages/ \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from curl!"}' | jq .
```