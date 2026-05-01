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
3. Load any utility route to validate API wiring.

### Quick Health Checks

```bash
curl http://localhost:5000/api/projects
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

- `GET /api/scheduler/*` utility endpoints
- `GET /api/fileshare/status`
- `POST /api/fileshare/upload`
- `POST /api/fileshare/access`
- `GET /api/projects`
- `GET /api/projects/:slug`
- `GET /static/<path:filename>`

### Data Sources

- `backend/app/static/json/*.json`: utility data files.
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
- utility-specific routes under `/utilities/*`

Stores:

- `currentPage`
- `currentRoute`
- `routeParams`

### App Shell and Navigation

`frontend/src/App.svelte` initializes router and supports wider layout for utility-heavy routes.

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
- utility-specific pages (for example `UtilityScheduler.svelte`)

Utility-specific behavior, contracts, and API checks are documented in `UTILITIES.md`.

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
3. Utility endpoint failures return non-2xx and surface in UI.

For utility-specific endpoint contracts and examples, see `UTILITIES.md`.

## Implementation Gaps and Next Fixes

1. Add backend `templates/404.html` to satisfy configured error handler.
2. Add route-level SPA 404 handling.
3. Clean duplicate legacy region in `frontend/src/app.css`.
4. Add backend pytest route tests and frontend Vitest/Svelte Testing Library coverage.
5. Decide whether to integrate or remove currently unused `MONGODB_URI` injection.
