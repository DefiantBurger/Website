# Implementation

## Local Development

### Prerequisites

Install:

- Python 3.11+
- Node.js 22+
- pnpm (Corepack recommended)

### Backend Setup

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install .

export SECRET_KEY="change-me"
export FLASK_ENV=development
export PORT=5000
python main.py
```

Notes:

- `SECRET_KEY` is required; app startup fails without it.
- `FLASK_ENV=development` enables Flask debug behavior.
- Production startup path uses Waitress.

### Frontend Setup

```bash
cd frontend
pnpm install
pnpm run dev
```

Optional backend target override:

```bash
export VITE_BACKEND_URL="http://localhost:5000"
pnpm run dev
```

### Recommended Local Run Sequence

1. Start backend on port 5000.
2. Start frontend dev server.
3. Load scheduler route first to validate API wiring.

### Quick Health Checks

```bash
curl http://localhost:5000/api/scheduler/default-schedule
curl http://localhost:5000/api/scheduler/course-data
```

```bash
cd frontend
pnpm run check
```

## Backend

### Stack

- Flask
- Flask-CORS
- Waitress
- python-dotenv

Packaging/dependency metadata lives in `backend/pyproject.toml`.

### Entry and App Factory

`backend/main.py`:

- loads `.env` values,
- builds app via `create_app()`,
- logs request method/path/remote address,
- starts Flask dev server or Waitress depending on environment.

`backend/app/__init__.py`:

- creates app,
- configures CORS for `/api/*`,
- requires `SECRET_KEY`,
- registers routes blueprint,
- defines 404 handler.

### Routes

Implemented in `backend/app/views.py`:

- `GET /api/scheduler/course-data`
- `GET /api/scheduler/default-schedule`
- `GET /api/projects`
- `GET /api/projects/:slug`
- `GET /static/<path:filename>`

### Data Sources

- `backend/app/static/json/course_data.json`: course catalog map keyed by course code.
- `backend/app/static/json/physics_courses.json`: seeded schedule by semester.
- `backend/app/content/projects/*.md`: project metadata/body via frontmatter + Markdown.

## Frontend

### Stack

- Svelte 5
- TypeScript
- Vite
- `page` router

Entry point is `frontend/src/main.ts`; global styles are in `frontend/src/app.css`.

### Routing

`frontend/src/lib/router.ts` routes:

- `/`
- `/projects`
- `/projects/:slug`
- `/about`
- `/contact`
- `/utilities`
- `/utilities/scheduler` and `/utilities/scheduler/`

Stores:

- `currentPage`
- `currentRoute`
- `routeParams`

### App Shell and Navigation

`frontend/src/App.svelte` initializes router and switches to wider layout for scheduler route.

`frontend/src/lib/components/Nav.svelte` provides:

- route-aware active states,
- client-side navigation,
- dark/light theme toggle via `localStorage` + `data-theme`.

### Pages

- `Home.svelte`
- `Projects.svelte`
- `ProjectDetail.svelte`
- `About.svelte`
- `Contact.svelte`
- `Utilities.svelte`
- `UtilityScheduler.svelte`

## Scheduler Feature

### Purpose

Interactive semester planning with prerequisite validation and dependency graph visualization.

Route: `/utilities/scheduler`

### Data Loading and Model

Source APIs:

- `GET /api/scheduler/default-schedule`
- `GET /api/scheduler/course-data`

Loader behavior (`frontend/src/lib/scheduler/data.ts`):

- validates JSON content type,
- parses optional credit suffix notation (`COURSE[4]`),
- expands entries into unique instance IDs,
- builds prerequisite requirements per instance.

Catalog records support:

- fixed `credits` or variable `min_credits`/`max_credits`,
- `prereqs` OR-groups,
- `concurrent_prereqs` OR-groups.

### Core Logic

`frontend/src/lib/scheduler/logic.ts` computes:

- edge status: `valid`, `invalid`, `concurrent`,
- requirement progress per course,
- optional repeated barycenter sweeps for detangling order.

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

### Visual Layer

- SVG edges between course cards,
- invalid edges emphasized,
- selection highlights related edges,
- redraw batching via `requestAnimationFrame`.

## Project Content Rendering

### API Client

`frontend/src/lib/projects/api.ts`:

- fetches project list and detail,
- validates response content type,
- provides useful parse error diagnostics.

### Markdown Pipeline

`frontend/src/lib/projects/renderMarkdown.ts`:

- parses Markdown with GFM,
- adds heading IDs and anchors,
- converts Mermaid code fences into render targets,
- sanitizes HTML before render.

`frontend/src/pages/ProjectDetail.svelte` loads slug-based content and runs Mermaid post-render.

## API Reference

### Base URLs

- Local: `http://localhost:5000`
- Production: `https://<your-domain>`

Frontend expects JSON endpoints to return `Content-Type` including `application/json`.

### Scheduler Endpoints

#### GET `/api/scheduler/default-schedule`

Returns seeded schedule keyed by semester.

```bash
curl -s http://localhost:5000/api/scheduler/default-schedule | jq .
```

Response shape:

```json
{
  "semesters": {
    "precollege": ["MATH 221", "E C E 210"],
    "fall24": ["MATH 222", "CHEM 103"]
  }
}
```

#### GET `/api/scheduler/course-data`

Returns catalog records keyed by course code.

```bash
curl -s http://localhost:5000/api/scheduler/course-data | jq .
```

Response shape:

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

### Project Endpoints

#### GET `/api/projects`

Returns published project metadata for card/index pages.

```bash
curl -s http://localhost:5000/api/projects | jq .
```

#### GET `/api/projects/:slug`

Returns one published project payload including Markdown body.

```bash
curl -s http://localhost:5000/api/projects/frontend-runtime-markdown | jq .
```

### Project Frontmatter Contract

```yaml
---
title: "Readable title"
slug: "url-slug"
summary: "Short card summary"
date: "YYYY-MM-DD"
tags: ["Tag1", "Tag2"]
repo: "https://..."
demo: "https://..."
published: true
---
```

### Error Expectations

1. Unknown slug returns 404.
2. Non-JSON responses should be treated as client errors.
3. Scheduler file failures return non-2xx and surface in UI.

## Implementation Gaps and Next Fixes

1. Add backend `templates/404.html` to satisfy configured error handler.
2. Add route-level SPA 404 handling.
3. Clean duplicate legacy region in `frontend/src/app.css`.
4. Add backend pytest route tests and frontend Vitest/Svelte Testing Library coverage.
5. Decide whether to integrate or remove currently unused `MONGODB_URI` injection.
