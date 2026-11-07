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
| `VITE_BACKEND_URL` | `http://localhost:$PORT` | Base URL the frontend uses for API calls. If unset, dev builds use `http://localhost:5000` and production builds use the page's own origin. |

`backend/main.py` also loads a `backend/.env` file if present.

### Checks

```bash
./test.sh                                # all of the below; --no-browser skips smoke + a11y
cd backend && uv run pytest --cov=app    # also runs under python -m unittest
cd frontend && pnpm test                 # unit tests (node:test)
cd frontend && pnpm run check            # svelte-check + tsc
cd frontend && pnpm smoke                # browser smoke test; needs ./start-dev.sh running
cd frontend && pnpm a11y                 # axe-core scan; needs ./start-dev.sh running
curl http://localhost:5000/api/projects/
```

`test.sh` runs backend tests, `pnpm test`, `pnpm check`, `pnpm build`, `pnpm smoke`, and `pnpm a11y`, continuing past failures and printing a pass/fail summary (exit 1 if any failed). For the browser checks it reuses dev servers already on :5000 and :5173, or starts `start-dev.sh` itself (output in `$TMPDIR/test-sh-dev.log`) and stops it afterward.

Backend tests live in `backend/tests/` and use a temporary instance directory per test (`conftest.py`), so they never touch real file-share storage. Frontend test scripts live in `frontend/tests/`.

`pnpm test` runs the unit tests in `frontend/tests/unit/*.test.ts` with Node's built-in runner (`node:test`), so there's no test framework dependency. They cover pure logic only (scheduler, Markdown sanitizing, route matching); code that uses runes (`.svelte.ts`) or `import.meta.env` can't load outside Vite, so keep logic worth testing in plain `.ts` modules. Node won't resolve the source's extensionless imports, so `tests/unit/resolve-ts.ts` is loaded first to retry them with `.ts`. A test marked `{ todo }` documents a known bug: it runs and reports but doesn't fail the suite.

`pnpm smoke` (`frontend/tests/smoke.ts`) loads the same routes as the a11y scan and fails on a missing heading, an uncaught exception, a console error, or a 4xx/5xx API response, then checks client-side navigation, trailing-slash redirects, the 404 suggestion, and theme persistence. It shares browser setup with the a11y scan (`tests/browser.ts`).

`pnpm a11y` (`frontend/tests/a11y.ts`) runs [axe-core](https://github.com/dequelabs/axe-core) (WCAG 2.2 A/AA plus best practices) on every route in `routeDefinitions.ts`, one project page, and the 404 page, in both themes at desktop and phone width, and exits 1 on any violation. It drives the installed Google Chrome through `playwright-core`, so nothing extra is downloaded; without Chrome, run `pnpm exec playwright-core install chromium`. Set `TEST_BASE_URL` to point either browser script at another host. Mermaid diagrams are excluded (see Known Issues). axe can't judge screen-reader flow, focus handling, or drag-and-drop, so check those by hand. CI doesn't run the browser checks yet, because they need the backend running. CI runs `pnpm check` and `pnpm test` on every pull request and every push to `main` that isn't docs-only, and a failure blocks deploys ([Deployment](./DEPLOYMENT.md#deploying-changes)).

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
- `app/static/json/course_data.json`, `my_courses.json`: scheduler catalog and default plan.
- `instance/fileshare/`: file-share uploads in local development (created at runtime, gitignored). Production sets `PERSONALWEBSITE_INSTANCE_PATH=/var/lib/personalwebsite`.

## Frontend

Entry is `src/main.ts`, which mounts `src/App.svelte`; global styles (theme tokens, typography, buttons, form controls, `.terminal-box`, `.hover-lift`, `.sr-only`) are in `src/app.css`. Components use Svelte 5 runes throughout. `App.svelte` renders the current route's page, keyed by path so each navigation mounts a fresh page with the fade-in, and uses a wider layout for pages that export `layout = { wide: true }` from `<script module>`.

### Routing

`src/lib/router.svelte.ts` is a small History API router (no library). It strips trailing slashes, matches the route table, and exposes reactive state `router.path`, `router.route`, and `router.params`. It also intercepts left-clicks on same-origin `<a href>` links, so pages use plain links; `navigate(path)` is only needed for programmatic navigation (e.g. buttons). Paths and route options live in `src/lib/routeDefinitions.ts`, which has no Svelte imports so `vite.config.ts` can read it too. `src/lib/routes.ts` pairs each key with its page component (separate so pages can import the router without an import cycle), and TypeScript fails the check if a key has no page. To add a page, add its path to `routeDefinitions.ts` and its component to `routes.ts`; the 404 page's suggestions, the nav's active state, `sitemap.xml`, and the per-route copies of `index.html` that let Nginx return real 404s for unknown paths (all generated at build time in `vite.config.ts`, with project pages read from `backend/app/content/projects/`) derive from them. A new route with a param other than `/projects/:slug` fails the build until `servedPaths()` knows its values.

On each client-side navigation (not the first load), `App.svelte` moves focus to `<main id="main">` and announces the new `document.title` through a polite live region, so screen readers notice the page change. A skip link (`Skip to content`) also targets `#main`.

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

### Accessibility Conventions

- Secondary text uses `--color-text-muted`, not `opacity`, so it stays at 4.5:1 in both themes (stacked opacities were the main contrast failure).
- For the terminal `> ` prompt, add `class="prompt"` (defined in `app.css`) instead of typing `>`, so screen readers don't read headings as "greater than …".
- Keyboard focus shows a dashed outline (`:focus-visible` in `app.css`); don't remove outlines.
- Links that navigate stay `<a>` (styled with `.button` if needed); use `<button>` for actions only. Repeated generic link text (e.g. "View Project") gets an `aria-label` that starts with the visible text.

### Shared Code

- `lib/components/Nav.svelte`: navigation with active states, a link to the external status page, and the light/dark toggle.
- `lib/theme.svelte.ts`: the current theme (persisted in `localStorage`, applied via `data-theme`); `ProjectDetail` re-renders Mermaid diagrams when it changes.
- `lib/components/PageHeader.svelte`: page title with optional description, extra content, and an `actions` snippet for header buttons.
- `lib/components/StatusMessage.svelte`: loading, error, and success messages (`compact` for sidebars and forms). It's a live region that renders empty and fills in ~100 ms after mounting, because screen readers ignore content a live region is inserted with.
- `lib/components/TagList.svelte`: project tags.
- `lib/download.ts`: `saveBlob` for client-side file downloads.

### API Clients

`src/lib/api.ts` holds the shared fetch helpers: `apiFetch` (throws `ApiError` with the backend's `{ error }` message on non-2xx), `apiJson` (also rejects non-JSON responses with a preview of the body), and `errorMessage`. Each feature's client under `src/lib/<feature>/` builds on them. The base URL is `VITE_BACKEND_URL` (default `http://localhost:5000` in dev and same-origin in production builds); the production build sets it to `https://<domain>`. Non-JSON error bodies (e.g. Nginx's HTML error pages) are never shown; users get a status-based message instead.

### Scheduler

`lib/scheduler/catalog.ts` converts between schedule files and course instances (`buildSchedule`, `exportSchedule`), validates credits, and searches the catalog; both the initial load (`data.ts`) and JSON import use it. `logic.ts` computes prerequisite edges and progress and the detangle ordering. `UtilityScheduler.svelte` keeps only the schedule (`semesterOrder`, `coursesById`, `columnCourseIds`) as state; requirements, the prerequisite graph, and credit totals are derived from it.

### Project Rendering

`lib/projects/renderMarkdown.ts` runs remark-parse → GFM → rehype → heading slugs and `#` anchors → Mermaid fences to `<div class="mermaid">` → `rehype-sanitize` → HTML. `ProjectDetail.svelte` injects the HTML, then renders Mermaid diagrams with a theme matching the site theme.

### About You

`AboutYou.svelte` shows what the site can observe about a visit: server-side request context from `/api/about-you/request-context/` (IP, Cloudflare location headers, request headers), browser properties, and in-session navigation history from `lib/aboutYou/interactionStore.ts`. That history is kept in memory only and is never sent to the server.

## API Reference

All routes are defined with a trailing slash; requests without one get a `308` redirect. JSON errors have the shape `{"error": "<message>"}`, and unknown paths return `404 {"error": "Not Found"}`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health/` | `{"status": "ok"}`; used by the deploy script and CI smoke test |
| GET | `/api/projects/` | Published project metadata, highest `priority` first |
| GET | `/api/projects/<slug>/` | One published project, including `markdown`; 404 if missing or unpublished |
| GET | `/api/about-you/request-context/` | Request metadata for the About You page |
| GET | `/api/scheduler/course-data/`, `/api/scheduler/default-schedule/` | Scheduler data ([Utilities](./UTILITIES.md#class-scheduler)) |
| GET, POST | `/api/fileshare/...` | File share ([Utilities](./UTILITIES.md#file-share)) |
| GET, POST | `/api/messageboard/...` | Message board ([Utilities](./UTILITIES.md#message-board)) |

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
