# Utilities

## Purpose

This document tracks utility-specific behavior, APIs, and operational notes.

Current utility:

- Class Scheduler (`/utilities/scheduler`)
- File Share (`/utilities/fileshare`)

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

Password-labeled local file sharing with automatic expiration and backend-enforced storage limits.

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
  "label": "sha256 password hash",
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
  "maxFileBytes": 50000000,
  "maxTotalBytes": 1000000000,
  "retentionSeconds": 600,
  "uploadsPaused": false
}
```

### Core Behavior

`backend/app/fileshare.py`:

- hashes passwords with SHA-256 to derive a deterministic active label,
- stores uploads on local disk under the backend instance path,
- rejects duplicate active labels instead of replacing files,
- enforces a 50 MB per-file cap,
- deletes expired files older than 10 minutes,
- pauses uploads when live storage reaches 1 GB or more.

### Interaction Model

- upload a file and password together,
- retrieve a file by entering the same password,
- show live storage status and pause state in the UI,
- surface backend errors for expired files, duplicate labels, and quota limits.

### API Checks

```bash
curl -s http://localhost:5000/api/fileshare/status | jq .
```

### Known Gaps

1. Storage is local to the VM and is not shared across instances.
2. Expiration cleanup is request-driven, so inactive files are removed on the next file-share API call.
3. No authentication or user-scoped ownership model exists yet.

### Next Improvements

1. Add scheduled background cleanup so expiration does not depend on traffic.
2. Add backend tests for upload limits, duplicate-label rejection, and quota pause/resume.
3. Consider a future shared storage backend if multi-VM deployment becomes necessary.