# Implementation

## Local Development

Setup is in the [README](../README.md#quick-start). `start-dev.sh` runs the backend and the Vite dev server together, stops both on Ctrl+C, and defaults these if unset:

| Variable | Default | Effect |
| --- | --- | --- |
| `FLASK_ENV` | `development` | `development`: Flask debug server + CORS on `/api/*`. `production` (the default when running `main.py` directly): Waitress on `127.0.0.1`. |
| `PORT` | `5000` | Backend port. |
| `SECRET_KEY` | `local-dev-secret` | Required by the backend; also the file-share label pepper. |
| `VITE_BACKEND_URL` | `http://localhost:$PORT` | API base URL. If unset, dev builds use `http://localhost:5000` and production builds use the page's own origin. |

`backend/main.py` also loads `backend/.env` if present.

### Checks

```bash
./test.sh                                # everything below; --no-browser skips smoke + a11y
cd backend && uv run pytest --cov=app
cd backend && uv run ruff check --fix . && uv run ruff format .
cd frontend && pnpm test                 # unit tests (node:test)
cd frontend && pnpm check                # svelte-check + tsc
cd frontend && pnpm lint && pnpm format  # ESLint + Prettier (format:check to verify only)
cd frontend && pnpm smoke                # browser smoke test
cd frontend && pnpm a11y                 # axe-core scan
```

- **`test.sh`** continues past failures and prints a pass/fail summary (exit 1 if any failed). For the browser checks it reuses dev servers already on :5000/:5173, or starts `start-dev.sh` itself (log in `$TMPDIR/test-sh-dev.log`).
- **Config:** Ruff in `backend/pyproject.toml`; Prettier and ESLint in `frontend/.prettierrc.json` and `frontend/eslint.config.js` (`eslint-config-prettier` keeps them from conflicting). Prettier covers all of `frontend/` except `dist/` and the lockfile, project Markdown included.
- **Backend tests** (`backend/tests/`) get a temporary instance directory per test (`conftest.py`), so they never touch real file-share storage.
- **Unit tests** (`frontend/tests/unit/*.test.ts`) use Node's built-in runner and cover pure logic only: code using runes (`.svelte.ts`) or `import.meta.env` can't load outside Vite, so keep testable logic in plain `.ts` modules. `tests/unit/resolve-ts.ts` lets Node resolve the source's extensionless imports. A test marked `{ todo }` documents a known bug without failing the suite.
- **`pnpm smoke`** loads every route and fails on a missing heading, an uncaught exception, a console error, or a 4xx/5xx API response, then checks client-side navigation, trailing-slash redirects, the 404 suggestion, and theme persistence.
- **`pnpm a11y`** runs axe-core (WCAG 2.2 A/AA plus best practices) on every route, one project page, and the 404 page, in both themes at desktop and phone width. Mermaid diagrams are excluded (see Issues); screen-reader flow, focus handling, and drag-and-drop still need a manual check.
- Both browser scripts need the dev servers running, drive the installed Google Chrome through `playwright-core` (or run `pnpm exec playwright-core install chromium`), and accept `TEST_BASE_URL` to target another host.
- **CI** (`test.yaml`) runs everything except `pnpm build` and the browser checks. Lint and format problems only warn.

## Backend

| File | Role |
| --- | --- |
| `main.py` | Loads `.env`, builds the app, logs each request, starts the dev server or Waitress based on `FLASK_ENV`. |
| `app/__init__.py` | `create_app()`: requires `SECRET_KEY`, caps request bodies at 101 MiB, enables CORS in development, registers the `views` blueprint, returns JSON 404s. |
| `app/views.py` | All routes and the client-IP/Cloudflare-header helpers. Turns any `ApiError` into a JSON `{error}` response. |
| `app/errors.py` | `ApiError(message, status_code)`, the base for `FileShareError` and `MessageBoardError`. |
| `app/fileshare.py` | File-share storage, encryption, expiry, and eviction. |
| `app/messageboard.py` | Message sanitizing, in-memory store, rate limiter. |

Data: `app/static/json/course_data.json` and `my_courses.json` (scheduler catalog and default plan). File-share uploads go to `instance/fileshare/` locally (gitignored) and under `PERSONALWEBSITE_INSTANCE_PATH=/var/lib/personalwebsite` in production.

## Frontend

`src/main.ts` mounts `src/App.svelte`. Global styles (theme tokens, typography, buttons, form controls, `.terminal-box`, `.hover-lift`, `.auto-grid`, `.sr-only`) are in `src/app.css`. `App.svelte` renders the current route's page, keyed by path so each navigation mounts a fresh page, and uses the wide layout for pages that export `layout = { wide: true }`.

### Routing

`src/lib/router.svelte.ts` is a small History API router. It strips trailing slashes, exposes reactive `router.path`, `router.route`, and `router.params`, and intercepts left-clicks on same-origin `<a href>` links, so pages use plain links (`navigate(path)` is for programmatic navigation only).

- `src/lib/routeDefinitions.ts` holds paths and route options. It has no Svelte imports so `vite.config.ts` can read it.
- `src/lib/routes.ts` pairs each key with its page component (separate to avoid an import cycle); the type check fails if a key has no page. A route's `accepts(params)` can reject params so they fall through to the 404 page (used for unknown project slugs).
- Derived from those two at build time (`vite.config.ts`): the 404 page's suggestions, the nav's active state, `sitemap.xml`, and a copy of `index.html` per route so Nginx can return real 404s for unknown paths. A new route with a param other than `/projects/:slug` fails the build until `servedPaths()` knows its values.

On client-side navigation, `App.svelte` moves focus to `<main id="main">` and announces the new `document.title` through a polite live region. A skip link also targets `#main`.

### Accessibility Conventions

- Secondary text uses `--color-text-muted`, not `opacity`, so it keeps 4.5:1 contrast in both themes.
- For the terminal `> ` prompt, add `class="prompt"` instead of typing `>`, so screen readers don't read "greater than".
- Keep the `:focus-visible` dashed outline.
- Links that navigate stay `<a>` (styled with `.button` if needed); `<button>` is for actions. Repeated link text (e.g. "View Project") gets an `aria-label` starting with the visible text. In `app.css`, `h2` has no underline; add `.section-title` for section headings that want one.

### Shared Code

- `lib/components/Nav.svelte`: navigation, the status page link, and the theme toggle.
- `lib/theme.svelte.ts`: the current theme (persisted in `localStorage`, applied via `data-theme`).
- `lib/components/PageHeader.svelte`: page title, optional description, and an `actions` snippet.
- `lib/components/LinkCard.svelte`: a card whose whole area links somewhere (Home, Projects, Utilities). Body content goes in its `children` snippet.
- `lib/components/ExternalLink.svelte`: a link that opens in a new tab with a consistent `rel` and a screen-reader "(opens in new tab)" note. Use it for every `target="_blank"` link.
- `lib/components/StatusMessage.svelte`: loading/error/success messages. It's a live region that fills in ~100 ms after mounting, because screen readers ignore content a live region is inserted with. `FormMessages.svelte` shows a form's error and success messages together.
- `lib/asyncTask.svelte.ts`: `AsyncTask`, the `busy`/`error`/`success` state for one async action. `run(fn)` clears messages, ignores calls while running, and turns a throw into `error`. Pass `{ busy: true }` for pages that load on mount.

### API Clients

`src/lib/api.ts` has `apiFetch` (throws `ApiError` with the backend's `{ error }` message on non-2xx), `apiJson` (also rejects non-JSON responses), and `errorMessage`; each feature's client in `src/lib/<feature>/` builds on them. Non-JSON error bodies (e.g. Nginx HTML pages) are never shown; users get a status-based message instead.

Requests go through `fetchWithTimeout` (`lib/fetchTimeout.ts`), which gives up if response headers take over 15 s; bodies aren't timed, so slow downloads finish. `timeoutMs: null` waits forever, which File Share uploads need because the server answers only after the whole body arrives.

### Project Rendering

`plugins/projects.ts` reads `src/content/projects/*.md` ([frontmatter](#project-frontmatter)), drops unpublished ones, and exposes two virtual modules: `virtual:projects` (summaries, highest `priority` first, plus a loader per slug, in the main bundle) and `virtual:project/<slug>` (one project's HTML, its own chunk). `src/lib/projects/content.ts` wraps them. The build fails on a duplicate or invalid slug (lowercase letters, digits, hyphens). In dev, editing a write-up reloads the page.

`plugins/renderMarkdown.ts` runs remark → GFM → rehype → heading anchors → Mermaid fences to `<div class="mermaid">` → `rehype-sanitize`. `ProjectDetail.svelte` injects the HTML, then loads Mermaid on demand (only when the page has a diagram) and renders it in the current theme, re-rendering on theme change. Wide diagrams stop shrinking at 60% of their natural width and scroll horizontally instead.

### About You

`AboutYou.svelte` shows what the site can observe about a visit: request context from `/api/about-you/request-context/` (IP, Cloudflare location headers, request headers), browser properties, and in-session navigation history (`lib/aboutYou/interactionStore.ts`, memory only, never sent to the server).

## API Reference

All routes end in a trailing slash; requests without one get a `308`. Errors are `{"error": "<message>"}`; unknown paths return `404`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health/` | `{"status": "ok"}`; used by deploy health checks |
| GET | `/api/about-you/request-context/` | Request metadata for About You |
| GET | `/api/scheduler/...` | Scheduler data ([Utilities](./UTILITIES.md#class-scheduler)) |
| GET, POST | `/api/fileshare/...` | File share ([Utilities](./UTILITIES.md#file-share)) |
| GET, POST | `/api/messageboard/...` | Message board ([Utilities](./UTILITIES.md#message-board)) |

### Project Frontmatter

```yaml
---
title: "Readable title"        # default: slug in Title Case
slug: "url-slug"               # default: file name without .md
summary: "Short card summary"
priority: 20                   # integer; higher sorts first
tags: ["Tag1", "Tag2"]
repo: "https://..."
demo: "https://..."            # empty string to omit
published: true                # default: true; set false to hide
---
```
