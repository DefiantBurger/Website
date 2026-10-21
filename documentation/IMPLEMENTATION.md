# Implementation

## Local Development

Prerequisites: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node.js 22+, pnpm (Corepack recommended).

```bash
(cd backend && uv sync)          # creates backend/.venv with app + dev dependencies
(cd frontend && pnpm install)
./start-dev.sh
```

`start-dev.sh` runs the backend (`backend/.venv/bin/python main.py`) and the Vite dev server together, stops both on Ctrl+C, and defaults these variables if unset:

| Variable | Default | Effect |
| --- | --- | --- |
| `FLASK_ENV` | `development` | `development`: Flask debug server + CORS on `/api/*`. `production` (the default when running `main.py` directly): Waitress on `127.0.0.1`. |
| `PORT` | `5000` | Backend port. |
| `SECRET_KEY` | `local-dev-secret` | Required by the backend; also the file-share label pepper. |
| `VITE_BACKEND_URL` | `http://localhost:$PORT` | Base URL the frontend uses for API calls. |

`backend/main.py` also loads a `backend/.env` file if present.

### Checks

```bash
cd backend && uv run pytest --cov=app    # also runs under python -m unittest
cd frontend && pnpm run check            # svelte-check + tsc
curl http://localhost:5000/api/projects/
```

Backend tests use a temporary instance directory per test (`tests/conftest.py`), so they never touch real file-share storage. There are no frontend tests yet.

## Backend

Dependencies (`backend/pyproject.toml`): Flask, Flask-CORS, Waitress, python-dotenv, PyYAML, cryptography.

| File | Role |
| --- | --- |
| `main.py` | Loads `.env`, builds the app, logs each request, starts the dev server or Waitress based on `FLASK_ENV`. |
| `app/__init__.py` | `create_app()`: requires `SECRET_KEY`, caps request bodies at 101 MiB, enables CORS in development, registers the `views` blueprint, returns JSON 404s. |
| `app/views.py` | All routes, project Markdown parsing, client-IP and Cloudflare-header helpers. |
| `app/fileshare.py` | File-share storage, encryption, expiry, and eviction. |
| `app/messageboard.py` | Message sanitization, in-memory store, rate limiter. |

Data sources:

- `app/content/projects/*.md`: project write-ups (frontmatter + Markdown).
- `app/static/json/course_data.json`, `physics_courses.json`: scheduler catalog and default plan.
- `instance/fileshare/`: file-share uploads (created at runtime, gitignored).

## Frontend

Entry is `src/main.ts`, which mounts `src/App.svelte`; global styles are in `src/app.css`. `App.svelte` uses a wider layout for utility pages.

### Routing

`src/lib/router.ts` is a small History API router (no library). It strips trailing slashes, maps paths to page components, and exposes the stores `currentPage`, `currentRoute`, and `routeParams`. Use `navigate(path)` for client-side links.

| Path | Page |
| --- | --- |
| `/` | `Home.svelte` |
| `/projects` | `Projects.svelte` |
| `/projects/:slug` | `ProjectDetail.svelte` |
| `/about` | `About.svelte` |
| `/about-you` | `AboutYou.svelte` |
| `/contact` | `Contact.svelte` |
| `/utilities` | `Utilities.svelte` |
| `/utilities/scheduler` | `UtilityScheduler.svelte` |
| `/utilities/fileshare` | `UtilityFileShare.svelte` |
| `/utilities/message-board` (alias `/utilities/messageboard`) | `UtilityMessageBoard.svelte` |
| anything else | `NotFound.svelte` (suggests the closest route by Levenshtein distance) |

### Shared Components

- `lib/components/Nav.svelte`: navigation with active states and a light/dark toggle (persisted in `localStorage`, applied via `data-theme`).
- `lib/components/PageHeader.svelte`, `lib/components/StatusMessage.svelte`: page header and loading/error states.

### API Clients

Each feature has its own client under `src/lib/<feature>/`, all using `VITE_BACKEND_URL` (default `http://localhost:5000`) as the base URL. The production build sets it to `https://<domain>`.

### Project Rendering

`lib/projects/renderMarkdown.ts` runs remark-parse → GFM → rehype → heading slugs and `#` anchors → Mermaid fences to `<div class="mermaid">` → `rehype-sanitize` → HTML. `ProjectDetail.svelte` injects the HTML, then renders Mermaid diagrams with a theme matching the site theme.

### About You

`AboutYou.svelte` shows what the site can observe about a visit: server-side request context from `/api/about-you/request-context/` (IP, Cloudflare location headers, request headers), browser properties, and in-session navigation history from `lib/aboutYou/interactionStore.ts`. That history is kept in memory only and is never sent to the server.

## API Reference

All routes are defined with a trailing slash; requests without one get a `308` redirect. JSON errors have the shape `{"error": "<message>"}`, and unknown paths return `404 {"error": "Not Found"}`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/projects/` | Published project metadata, highest `priority` first |
| GET | `/api/projects/<slug>/` | One published project, including `markdown`; 404 if missing or unpublished |
| GET | `/api/about-you/request-context/` | Request metadata for the About You page |
| GET | `/api/scheduler/course-data/`, `/api/scheduler/default-schedule/` | Scheduler data ([Utilities](./UTILITIES.md#class-scheduler)) |
| GET, POST | `/api/fileshare/...` | File share ([Utilities](./UTILITIES.md#file-share)) |
| GET, POST | `/api/messageboard/...` | Message board ([Utilities](./UTILITIES.md#message-board)) |
| GET | `/static/<path>` | Files under `backend/app/static/` |

### Project Frontmatter

```yaml
---
title: "Readable title"        # default: slug in Title Case
slug: "url-slug"               # default: file name without .md
summary: "Short card summary"
priority: 20                   # integer; higher sorts first; not returned by the API
tags: ["Tag1", "Tag2"]
repo: "https://..."
demo: "https://..."            # empty string to omit
published: true                # default: true; set false to hide
---
```

API responses contain `slug`, `title`, `summary`, `tags`, `repo`, `demo`, `published`, plus `markdown` on the detail route.
