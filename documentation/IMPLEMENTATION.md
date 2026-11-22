# Implementation

How the code is organized. Running and testing it is in [Development](./DEVELOPMENT.md).

## Backend

| File | Role |
| --- | --- |
| `main.py` | Loads `.env`, builds the app, and starts the dev server or Waitress based on `FLASK_ENV`. In production Waitress trusts only Nginx's `X-Forwarded-For`/`-Proto`, so `request.remote_addr` is the visitor's IP; `main.py` also logs each request (Waitress has no access log) and starts the file-share expiry sweeper. |
| `app/__init__.py` | `create_app()`: requires `SECRET_KEY`, caps request bodies at `MAX_FILE_BYTES` + 1 MiB (~81 MB), enables CORS in development, registers the `views` blueprint, returns JSON 404s and 413s. |
| `app/views.py` | All routes and the client-IP/Cloudflare-header helpers. Turns any `ApiError` into a JSON `{error}` response. |
| `app/errors.py` | `ApiError(message, status_code)`, the base for `FileShareError` and `MessageBoardError`. |
| `app/fileshare.py` | File-share storage, encryption, expiry, and eviction. |
| `app/messageboard.py` | Message sanitizing, in-memory store, rate limiter. |
| `app/uptime.py` | Footer uptime: fetches the public status page's `index.json` (undocumented, no token), sums the last 30 days of downtime, caches 15 min (2 min after a failure, keeping the last good value). |

Data: `app/static/json/course_data.json` and `my_courses.json` (scheduler catalog and default plan). File-share uploads go to `instance/fileshare/` locally (gitignored) and under `PERSONALWEBSITE_INSTANCE_PATH=/var/lib/personalwebsite` in production; the directory is emptied whenever the app starts.

## Frontend

`src/main.ts` mounts `src/App.svelte`. Global styles (theme tokens, typography, buttons, form controls, `.terminal-box`, `.hover-lift`, `.auto-grid`, `.sr-only`) are in `src/app.css`. `App.svelte` renders the current route's page, keyed by path so each navigation mounts a fresh page, and uses the wide layout for pages that export `layout = { wide: true }`.

### Routing

`src/lib/router.svelte.ts` is a small History API router. It strips trailing slashes, exposes reactive `router.path`, `router.route`, and `router.params`, and intercepts left-clicks on same-origin `<a href>` links, so pages use plain links (`navigate(path)` is for programmatic navigation only).

- `src/lib/routeDefinitions.ts` holds each route's path and page metadata (tab title and description), plus the helpers built on them. Link with `pathFor(key, params)` instead of writing paths out. It has no Svelte imports so the build plugins can read it.
- `src/lib/routes.ts` pairs each key with its page component (separate to avoid an import cycle); the type check fails if a key has no page. A route's `accepts(params)` can reject params so they fall through to the 404 page (used for unknown project slugs).
- Derived from those two: the 404 page's suggestions, plus, at build time (`plugins/routeHtml.ts`), `sitemap.xml` and a copy of `index.html` per route with that page's title, description, canonical link, and Open Graph tags filled in, so link previews are per page and Nginx can return real 404s for unknown paths (with `404.html` as the body). Each copy also gets a `<noscript>` list of links to the static pages, and the home page gets JSON-LD structured data (`WebSite` + `Person`). `main.ts` removes the static description and canonical tags once the app renders its own. The dev server fills in the same tags for the requested path. A new route with a param other than `/projects/:slug` fails the build until `pageHeads()` knows its values.
- The site origin, owner name, and profile links live in `src/lib/site.ts`. `robots.txt` and `.well-known/security.txt` are plain files in `public/`, with the origin and email written out.
- `public/favicon.svg` is the source for every site icon. After editing it, run `./gen-icons.sh` (needs `rsvg-convert` and ImageMagick 7) to regenerate `favicon.png`, `favicon.ico`, `apple-touch-icon.png`, and `og-image.png`, and commit the results.

`App.svelte` renders `<PageMeta>` (the `<title>` with the site-name suffix, and the meta description) from the current route's `meta`, plus the canonical link. A route without `meta` renders its own `<PageMeta>`, as project pages do once their content loads.

On client-side navigation, `App.svelte` moves focus to `<main id="main">` (unless the shell is open, so a `cd` keeps focus in its input) and announces the new `document.title` through a polite live region. A skip link also targets `#main`.

### Interactive Shell

A terminal panel docked to the bottom of every page, opened with `` ` `` or `/` (outside text fields) or the nav's `>_` button, and closed with `Esc`, `exit`, or the button. `help` lists the commands. It isn't modal: `cd` navigates the page underneath through the router while the shell stays open, and closing returns focus to whatever opened it.

- `lib/shell/filesystem.ts` builds the virtual filesystem from `routeDefinitions` plus the published projects, one entry per page, so new pages show up on their own.
- `lib/shell/commands.ts` holds the commands as pure functions over a `ShellHost`, unit-tested with a fake host. `grep` and `whoami` get their data through the host. `grep` searches only the project write-ups, since the static pages' text lives in Svelte components, not in data.
- `sudo` (with or without a command) is an easter egg left out of `help` on purpose: the whole page, shell included, breaks and falls off the screen, then shows a fake segfault until any key or click, and the shell is cleared and closed. `lib/shell/shatterMath.ts` is the pure geometry and physics (unit-tested); `lib/shell/shatter.ts` runs the effect, and its comments explain how it stays fast on long pages.
- `lib/shell/shell.svelte.ts` keeps the state (open, scrollback, history; they survive closing the panel) and builds the real host. `lib/components/Shell.svelte` is the panel and the global hotkey.

### Accessibility Conventions

- Secondary text uses `--color-text-muted`, not `opacity`, so it keeps 4.5:1 contrast in both themes.
- For the terminal `> ` prompt, add `class="prompt"` instead of typing `>`, so screen readers don't read "greater than".
- Keep the `:focus-visible` dashed outline.
- Links that navigate stay `<a>` (styled with `.button` if needed); `<button>` is for actions. Repeated link text (e.g. "View Project") gets an `aria-label` starting with the visible text. In `app.css`, `h2` has no underline; add `.section-title` for section headings that want one.

### Shared Code

- `lib/components/Nav.svelte`: navigation, the shell button, and the theme toggle. Below 768px the links and theme toggle move into a `[menu]` dropdown drawn over the page, so the sticky bar stays one row.
- `lib/components/Footer.svelte`: build commit and date (`__BUILD_SHA__`/`__BUILD_DATE__`, from `define` in `vite.config.ts`; CI's `GITHUB_SHA`, else `git rev-parse HEAD`), and uptime from `/api/site-info/`, which links to the status page (a plain "status" link if uptime is unavailable).
- `lib/theme.svelte.ts`: the current theme (persisted in `localStorage`, applied via `data-theme`).
- `lib/components/PageHeader.svelte`: page title, optional description, and an `actions` snippet.
- `lib/components/Panel.svelte`: a titled `.terminal-box` section (or `<form>` via `element`); `compact` makes a smaller nested panel with an `h3`.
- `lib/components/LinkCard.svelte`: a card whose whole area links somewhere (Home, Projects, Utilities). Body content goes in its `children` snippet.
- `lib/components/ExternalLink.svelte`: a link that opens in a new tab with a consistent `rel` and a screen-reader "(opens in new tab)" note. Use it for every `target="_blank"` link.
- `lib/components/StatusMessage.svelte`: loading/error/success messages. It's a live region that fills in ~100 ms after mounting, because screen readers ignore content a live region is inserted with. `FormMessages.svelte` shows a form's error and success messages together.
- `lib/asyncTask.svelte.ts`: `AsyncTask`, the `busy`/`error`/`success` state for one async action. `run(fn)` clears messages, ignores calls while running, and turns a throw into `error`. Pass `{ busy: true }` for pages that load on mount.

### API Clients

`src/lib/api.ts` has `apiFetch` (throws `ApiError` with the backend's `{ error }` message on non-2xx), `apiJson` (also rejects non-JSON responses), and `errorMessage`; each feature's client in `src/lib/<feature>/` builds on them. Non-JSON error bodies (e.g. Nginx HTML pages) are never shown; users get a status-based message instead.

Requests go through `fetchWithTimeout` (`lib/fetchTimeout.ts`), which gives up if response headers take over 15 s; bodies aren't timed, so slow downloads finish. `timeoutMs: null` waits forever, which File Share uploads need because the server answers only after the whole body arrives.

### Project Rendering

`plugins/projects.ts` reads `src/content/projects/*.md` ([frontmatter](#adding-a-write-up)), drops unpublished ones, and exposes two virtual modules: `virtual:projects` (summaries, highest `priority` first, plus a loader per slug, in the main bundle) and `virtual:project/<slug>` (one project's HTML and grep text, its own chunk). `src/lib/projects/content.ts` wraps them. The build fails on a duplicate or invalid slug (lowercase letters, digits, hyphens). In dev, editing a write-up reloads the page.

`plugins/renderMarkdown.ts` turns each write-up into sanitized HTML; the stage order, and why it matters, is in its comments. What that means for write-ups and `ProjectDetail.svelte`:

- **Math** is written as `$…$` inline and `$$…$$` on its own lines, so a literal dollar sign in prose needs escaping (`\$`). KaTeX renders it at build time, and the build fails if a math block has invalid LaTeX. `ProjectDetail.svelte` loads KaTeX's CSS and fonts on demand, only for pages with math (`hasMath`), so they stay out of the global stylesheet.
- **Mermaid** fences become `<div class="mermaid">`, and unit tests check that they survive sanitizing. `ProjectDetail.svelte` loads Mermaid on demand (only when the page has a diagram) and renders it in the current theme, re-rendering on theme change. Wide diagrams stop shrinking at 60% of their natural width and scroll horizontally instead.
- **The shell's `grep` text** (one line per heading, paragraph, list item, table cell, or code line) is collected before KaTeX and the heading anchors run, so an equation appears once, as LaTeX, and headings carry no `#`.
- **Tables** get a `.table-scroll` wrapper, and tables and display equations both become focusable regions (`tabindex="0"`, `role="region"`), so keyboard users can scroll them when they overflow on a phone.

#### Adding a Write-Up

1. Edit or add `frontend/src/content/projects/<slug>.md`, starting with this frontmatter:

   ```yaml
   ---
   title: "Readable title"        # default: slug in Title Case
   slug: "url-slug"               # default: file name without .md
   summary: "Short card summary"
   priority: 20                   # integer, default 0; higher sorts first (ties by slug)
   tags: ["Tag1", "Tag2"]
   repo: "https://..."            # omit or leave empty for no link
   demo: "https://..."            # omit or leave empty for no link
   published: true                # default: true; set false to hide
   ---
   ```

2. Check it at `http://localhost:5173/projects/<slug>`, and run `pnpm build` to catch slug errors.
3. Push to `main`, then [deploy](./RUNBOOK.md#ship-a-change).

If a project page shows "not found", check that:

1. The file exists in `frontend/src/content/projects/`.
2. Its `slug` (or file name, if no slug) matches the URL.
3. It isn't `published: false`.
4. The deployed build includes it (it was deployed after the file was added).

#### Demos

Interactive demos live in `src/lib/demos/`.

- **Embedding.** A write-up embeds one with a fence whose body is the demo id (` ```demo ` / `wavepacket-2d` / ` ``` `). The pipeline turns it into `<div class="project-demo" data-demo="…">` (the build fails on an id missing from `demos/ids.ts`), and `ProjectDetail.svelte` mounts the component from `demos/registry.ts` into it, imported on demand so the demo code loads only on that page.
- **Adding one.** Add its id to `ids.ts` and its loader to `registry.ts`; the type check fails if one is missing. Keep the simulation math in plain `.ts` modules so it can be unit-tested.
- **Colors.** Build canvas colors from the `--color-*` variables with `demos/colormap.ts`, redrawing when `theme.current` changes. The `--color-*` variables a demo reads must be written as hex or `rgb()` in `app.css`: `colormap.ts` parses them as written, and throws on anything else.
- **`wavepacket-2d`** (`Wavepacket2D.svelte`) is a 2D split-operator Schrödinger solver (`demos/wavepacket.ts`) on a 128×128 grid with a hand-written FFT (`demos/fft.ts`). It plays once when first scrolled into view (not under `prefers-reduced-motion`) and pauses while offscreen. The reasoning behind its numerics is in those files' comments.

### About You

`AboutYou.svelte` shows what the site can observe about a visit: request context from `/api/about-you/request-context/` (IP, Cloudflare location headers, request headers), browser properties, and in-session navigation history (`lib/aboutYou/interactionStore.ts`, memory only, never sent to the server). Browser detection and the fact lists are in `lib/aboutYou/facts.ts` (no DOM access, so unit-tested); shared display formatting (bytes, durations, times) is in `lib/format.ts`.

## API Reference

All routes end in a trailing slash; requests without one get a `308`. Errors are `{"error": "<message>"}`; unknown paths return `404`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health/` | `{"status": "ok"}`; used by deploy health checks |
| GET | `/api/site-info/` | `{"uptime": {"percent", "days"} \| null}` for the footer; `days` counts only monitored days in the 30-day window |
| GET | `/api/about-you/request-context/` | Request metadata for About You |
| GET | `/api/scheduler/...` | Scheduler data ([Utilities](./UTILITIES.md#class-scheduler)) |
| GET, POST | `/api/fileshare/...` | File share ([Utilities](./UTILITIES.md#file-share)) |
| GET, POST | `/api/messageboard/...` | Message board ([Utilities](./UTILITIES.md#message-board)) |
