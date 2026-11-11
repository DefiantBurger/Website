# Ideas

Features and improvements worth building, none of them started. Bugs and tech debt go in [Issues](./ISSUES.md) instead. When an idea ships, delete it here and document the behavior in the relevant doc.

## Content

### Research write-up with interactive demos

Write up the quantum transport simulation research as a project in `frontend/src/content/projects/`, with interactive demos embedded in the text instead of on a separate page.

- **Embedding:** project Markdown is rendered to HTML at build time (`plugins/projects.ts`), so it can't contain Svelte components today. One option is a placeholder block (e.g. `<div data-demo="wavepacket"></div>`) that `ProjectDetail.svelte` finds after rendering and mounts a component into. That keeps the Markdown plain, and the demo code is only loaded on pages that use it.
- **First demo:** a 1D Gaussian wavepacket hitting a potential barrier, drawn on a canvas, with sliders for barrier height/width and packet energy, so tunneling and reflection play out live. The split-step Fourier method is simple and stable (it needs a small FFT, which is easy to write by hand rather than add as a dependency). Crank–Nicolson is the alternative if a tridiagonal solve is easier to reason about.
- Show transmission/reflection probability next to the analytic result, so the demo also checks itself.
- Colors from `--color-*` variables (read them with `getComputedStyle`, since a canvas can't use CSS variables directly), and redraw when the theme changes.

### Robotics hardware showcase (maybe)

For the Wisconsin Robotics electrical work: export KiCad boards to SVG and show them in a viewer with toggleable layers (copper, silkscreen, etc.). Not decided yet.

## Site-wide

### Interactive shell

A terminal prompt that opens over any page and drives the site with commands. It fits the terminal look, and it adds a keyboard way to get around the site.

**Opening and closing**

- `` ` `` or `/` opens it (ignored while typing in an input). `Esc` or `exit` closes it and returns focus to where it was.
- A visible `>_` button in the nav, for phones and for people who don't know the shortcut.
- Opens as a panel docked to the bottom of the page. A full-screen overlay is the alternative, but docked keeps the page visible, so `cd` can change the page underneath while the shell stays open.

**Commands (first pass)**

| Command | Does |
| --- | --- |
| `help` | List commands |
| `ls [path]` | List pages under a path (`ls projects` lists write-ups by slug) |
| `cd <path>` | Navigate (`cd ..`, `cd ~`, relative and absolute paths) |
| `pwd` | Current route |
| `cat <page>` | Print a short text summary (`cat about`, `cat projects/<slug>` prints the summary from frontmatter) |
| `open <slug>` | Open a project's demo/repo link |
| `theme [light\|dark]` | Toggle or set the theme |
| `clear`, `history`, `exit` | The usual |

Ideas for later: `whoami` (pulls from About You), `grep <term>` across project write-ups, `sudo` easter egg.

**Implementation notes**

- Build the virtual filesystem from `routeDefinitions` and the published project list, not a hand-written copy, so new pages show up automatically. `pathFor(key, params)` and each route's `meta` cover what the shell needs.
- Navigate through the existing router, not `location.href`.
- Tab completion on commands and paths; up/down arrows for history (session only).
- Keep the parser and filesystem in plain `.ts` modules so they can be unit tested with `node:test`.
- Accessibility: an output region with `role="log"`, a labeled input, focus kept inside the shell while it's open, and nothing that's only reachable through it.

### Footer with live site info

Add a footer, and move the Status link there from the navbar. It belongs with the other site info, not with page navigation.

- **Last deploy:** git short SHA and build date, injected at build time with Vite `define`. The SHA can link to the commit on GitHub. Only the date and SHA need to be shown.
- **Uptime:** either the backend process uptime (add it to `/api/health/` or a new endpoint), or the uptime percentage from Better Stack. Better Stack is the more honest number, but it needs an API token kept on the backend, and the result should be cached so each page view doesn't call Better Stack.
- Keep it coarse: no memory, load, or other VM details.

### Prerendering

The build already writes `<route>/index.html` for every route (`routeFiles()` in `vite.config.ts`), but each one is a copy of the same empty shell. Prerendering would render each page to HTML at build time (`render` from `svelte/server`) and write that into the route's file instead. `main.ts` would then switch from `mount` to `hydrate`. This would fix SEO #1 and #2 in Issues.

- **Gains:** visitors without JavaScript and simple crawlers see real content; each page gets its own title, description, and OG tags; content appears before the JS loads.
- **Costs:** anything that touches `window`, `localStorage`, or `document` while rendering breaks the build (theme handling, About You, the utilities), so it has to move into `onMount` or be guarded. The browser's render has to match the build's HTML or the page flickers. The theme is the main risk: `index.html` hard-codes `data-theme="light"`, so this needs a small inline script that sets the theme before the first paint. It's also a second render path, which CI's `pnpm build` now covers.
- **Scope:** start with the static pages (home, about, projects, project detail, contact). Utilities need JS and live data anyway, so they keep the plain shell. Mermaid diagrams stay client-side.
- **Cheaper middle step:** write only each route's `<title>`, description, and OG tags into its file at build time, without rendering the body. Link previews get fixed; visitors without JS still see only the `<noscript>` list.

### OG images

Link previews (Discord, Slack, iMessage, LinkedIn) use the page's `og:image`, which is currently the 128px favicon for every page. Generate a 1200×630 image per project at build time (title + summary in the terminal style) and point each project's `og:image` at it, with a site-wide default for other pages. Needs per-route meta tags first (either prerendering option above). Turning an SVG template into a PNG needs a renderer, which probably means a build-only dependency (e.g. `@resvg/resvg-js`); the alternative is to make the images by hand once per project.

## Utilities

### Scheduler: term-offered checks

Warn when a course is placed in a term it isn't offered in (e.g. fall-only courses in a spring column). Semester keys already carry the term, so only the data is missing: the catalog scraper would need to record which terms each course is offered in (e.g. an `offered: ["fall", "spring"]` field), and `logic.ts` would add a problem for a mismatch. Show it in the Problems panel and on the card, separate from prerequisite problems.

### File Share: upload progress

Show a progress bar while uploading. `fetch` can't report upload progress, so this needs `XMLHttpRequest` (`upload.onprogress`). Uploads currently have no timeout (`timeoutMs: null`) because a large upload can legitimately take minutes; with progress events, a stall timeout (no bytes sent for ~30 s) could replace that.

### File Share: encryption in the browser and QR codes

**Encrypt in the browser** so the server only ever stores ciphertext and can't read uploaded files.

- Today the server uses the access key both to find a batch (HMAC label) and to encrypt it. With browser encryption, the browser derives two separate values from the access key (e.g. HKDF): a lookup token sent to the server, and an AES-GCM key that never leaves the browser. Otherwise the server still sees what it needs to decrypt.
- Encrypt in fixed-size chunks with a nonce per chunk. That's the same design as the memory fix in Issues (File Share #1), so the two should be built together.
- File names should be encrypted too, or the server still learns something about the files.
- WebCrypto (`crypto.subtle`) covers all of this without dependencies.

**QR code** for the access key, so a file can go from laptop to phone without typing the key.

- Encode a link with the key in the fragment (`/utilities/fileshare#key=...`), so scanning it opens the page with the key filled in, and the key never reaches the server or its logs.
- QR encoding is a few hundred lines to write by hand. A small, dependency-free library (e.g. `qrcode-generator`) is a reasonable exception to the no-new-dependencies rule.
