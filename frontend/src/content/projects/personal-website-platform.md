---
title: 'Personal Website Platform'
slug: 'personal-website-platform'
summary: 'A full-stack personal site platform with a Svelte frontend, Flask APIs, Terraform-provisioned GCP hosting behind a Cloudflare Tunnel, and GitHub Actions deploys. Serves Markdown write-ups rendered at build time and several interactive utilities, and demonstrates end-to-end ownership from infrastructure to UX.'
priority: 20
tags:
  - 'Svelte'
  - 'Flask'
  - 'Terraform'
  - 'GitHub Actions'
  - 'Cloudflare'
  - 'GCP'
repo: 'https://github.com/DefiantBurger/Website'
demo: ''
published: true
---

## Overview

This project is a full-stack personal website platform built as an engineering sandbox and portfolio vehicle.

It goes beyond static pages by combining:

- a typed Svelte 5 frontend with a small custom router and client-side rendering,
- a Flask backend with API endpoints for the interactive utilities,
- infrastructure-as-code on Google Cloud with Terraform, reachable only through a Cloudflare Tunnel,
- a GitHub Actions pipeline that tests every push and deploys `main` with automatic rollback,
- Markdown project write-ups rendered to HTML at build time,
- and multiple interactive utilities that exercise different problem domains.

The repository serves as one cohesive system where I can design features, iterate on architecture, ship infrastructure changes, and maintain documentation, all in one place.

A key architectural decision was replacing hardcoded project content with Markdown files. Write-ups are edited as content, not as frontend code, and a Vite plugin turns them into pre-rendered HTML during the build.

## Why I Built It

I wanted one repository that could serve several goals at once:

1. Present my work as a portfolio.
2. Demonstrate practical full-stack architecture decisions.
3. Host non-trivial interactive tools that exercise data modeling, security, and UI logic.

I also wanted the project to be inexpensive to operate and easy to reason about end-to-end. That drove the choice of a single small VM with clear responsibilities:

- Cloudflare for DNS, TLS, and edge proxying through a tunnel,
- Nginx for static hosting, security headers, and rate limiting,
- Flask for APIs and content,
- Svelte static output for frontend delivery,
- GitHub Actions for testing and releases.

Another goal was technical transparency. I wanted to be able to answer detailed questions such as:

- How is project content modeled and delivered?
- How is scheduler data validated?
- How does a commit get from GitHub to the running service, and what happens if it's broken?
- What are the known risks and next architecture improvements?

This write-up is intentionally detailed so it can work as both a portfolio explanation and an engineering handoff document.

## Architecture

```mermaid
flowchart TB
    U[User Browser] --> CF[Cloudflare]
    CF -->|Tunnel| CFD[cloudflared on GCP VM]
    CFD --> NX[Nginx on loopback]
    NX -->|/| FE[Svelte static build]
    NX -->|/api/*| BE[Flask / Waitress]
    BE --> PC[Scheduler JSON]
    BE --> FS[File share: encrypted files on disk]
    BE --> MB[Message board: in-memory store]
```

### Request Lifecycle

All traffic enters through Cloudflare, which forwards it over an outbound-only tunnel to the VM. From there, requests follow two paths:

1. Page/navigation requests are served by Nginx from the Svelte build, with SPA fallback to `index.html`.
2. Data requests under `/api/*` are proxied by Nginx to Flask on `127.0.0.1:5000`.

Project pages need no API call: their HTML is rendered at build time and ships as one small JavaScript chunk per write-up.

For utilities, the scheduler's logic runs entirely in the browser, while File Share and Message Board keep their state on the backend.

This split keeps backend logic simple while still enabling complex interaction in the UI.

### Frontend

- Svelte 5 (runes) + TypeScript + Vite
- A small History API router written in-house, replacing page.js
- Shared fetch helpers and UI components used by every page
- Build-time project rendering pipeline:
  - parse, transform, and sanitize Markdown with unified/remark/rehype inside a Vite plugin
  - render Mermaid diagrams client-side, matching the site theme

#### Frontend Responsibilities

- Route rendering and navigation state
- Loading/error states for API-backed pages
- Utility-specific interaction models and state
- Theme persistence and the global visual system

#### Routing

The router strips trailing slashes, matches a single route table, and exposes reactive `path`, `route`, and `params` state. It intercepts clicks on same-origin links, so pages use plain `<a href>` elements. The route table also drives the nav's active state and the 404 page, which suggests the closest real route by Levenshtein distance.

I replaced page.js with this router to drop a dependency and keep routing behavior small enough to fully understand.

#### Shared Code

A recent refactor consolidated duplicated logic across pages and removed roughly 1,500 lines net:

- `lib/api.ts`: `apiFetch`/`apiJson` helpers that surface the backend's `{ error }` messages and reject unexpected non-JSON responses. Every feature's API client builds on them.
- `PageHeader`, `LinkCard`, `ExternalLink`, `StatusMessage`, and `TagList` components for consistent page structure and loading/error display.
- A theme store that persists the light/dark choice and lets project pages re-render Mermaid diagrams when it changes.
- A scheduler catalog module shared by the initial load and JSON import, so both paths validate schedules the same way.

#### Markdown Rendering Pipeline

Project detail pages use a pipeline that supports:

- GFM features such as lists, tables, and task syntax,
- heading slug generation and anchor links,
- sanitization before injecting HTML,
- Mermaid code-fence transformation at build time and diagram rendering in the browser.

This enables rich technical write-ups without trusting raw HTML from content files.

#### Frontend Tradeoffs

I intentionally moved logic toward the client for responsiveness and lower backend complexity. The downside is higher UI complexity and more care needed around lifecycle timing, graph recomputation, and safe HTML rendering.

### Backend

- Flask application factory + a single blueprint
- Waitress in production; CORS enabled only in development
- Separate modules for file-share storage/encryption and message-board logic
- A `/api/health/` endpoint used by deploys and smoke tests
- pytest suite with coverage, using a temporary instance directory per test

#### Backend Responsibilities

- Serve scheduler data files as JSON
- Store, encrypt, and expire shared files
- Sanitize, rate-limit, and expire message-board posts
- Return consistent JSON errors (`{"error": "..."}`) for the frontend to display

#### Project Content Contract

Each project file includes frontmatter metadata:

- title, slug, summary
- priority (higher sorts first)
- tags
- repo and optional demo URL
- published flag

The build fails on a duplicate slug or one that isn't plain lowercase letters, digits, and hyphens, so content mistakes surface before a deploy rather than as a broken page.

This keeps content's source of truth in versioned Markdown while the frontend works with typed, pre-rendered data.

#### Backend Tradeoffs

The backend is intentionally lightweight. Most transformation and presentation logic happens in the frontend. This keeps the Python code concise, but limits server-side control over final rendering.

### Infrastructure

- Terraform-managed GCP network, firewall, and e2-micro VM (Debian 12)
- Cloudflare DNS, Tunnel, and a Managed Transform for visitor location headers
- Nginx on loopback for static hosting, security headers, and rate limiting
- systemd services for the backend and `cloudflared`
- Google Secret Manager for runtime secrets

#### Network Model

The VM has no open web ports. `cloudflared` dials out to Cloudflare, and Nginx and Flask listen only on `127.0.0.1`. The only inbound firewall rule allows SSH from Google's IAP range. That means:

- the origin can't be reached directly, so every request passes through Cloudflare's WAF and rate-limit rules,
- there's no origin certificate to manage,
- Cloudflare-set headers such as `CF-Connecting-IP` can be trusted for rate limiting and the About You page.

#### Deployment Pipeline

Provisioning and releases are separate. Terraform builds the VM rarely; GitHub Actions ships code on every push to `main`.

```mermaid
flowchart LR
    P[Push] --> TB[test-backend: pytest]
    P --> TF[test-frontend: svelte-check + tsc + build]
    TB --> PK[package: build + tarball]
    TF --> PK
    PK -->|main only| D[deploy over IAP SSH]
    D --> H{health check}
    H -->|pass| S[smoke test via Cloudflare]
    H -->|fail| R[automatic rollback]
```

1. Pull requests and pushes run backend tests, frontend type checks, and a frontend build.
2. On `main`, CI builds the frontend, exports hash-pinned backend requirements from `uv.lock`, and packages a release tarball.
3. The deploy job authenticates with Workload Identity Federation (no stored keys) and streams the tarball to the VM over IAP SSH.
4. On the VM, the deployer's only sudo right is a deploy script. It verifies the checksum, builds a venv from hash-pinned wheels, swaps the `current` symlink atomically, and restarts the service.
5. If `/api/health/` doesn't come up within about 30 seconds, the script switches back to the previous release and fails the workflow.

The newest five releases stay on disk, so rolling back is one command. Actions are pinned to commit SHAs.

#### Hardening

- Releases are root-owned and read-only to the app user.
- The Flask service runs under systemd sandboxing (`ProtectSystem=strict`, `PrivateTmp`, `NoNewPrivileges`) and can write only its data directory.
- Secrets are fetched from Secret Manager at boot, never templated through Terraform.
- Nginx sets HSTS and other security headers, caps body sizes, and rate-limits per visitor IP.

#### Monitoring

Better Stack monitors uptime externally, and a public status page is linked from the site's nav bar.

#### Operational Benefits

- Low hosting cost
- Few moving parts
- Fast debugging thanks to a clear runtime topology
- Safe, repeatable deploys with automatic rollback

#### Operational Risks

- Single failure domain
- Terraform state still lives locally rather than in a remote, encrypted backend
- Less elasticity than managed multi-service environments

## Utilities

The platform hosts several interactive utilities that showcase different engineering challenges:

- **Class Scheduler** (`/utilities/scheduler`): semester-based drag-and-drop planning with prerequisite validation, a dependency graph, variable-credit courses, auto-detangling of graph edges, plans saved and shared through the URL, and JSON import/export.
- **File Share** (`/utilities/fileshare`): temporary file sharing under an access key. Files are encrypted at rest (scrypt + AES-256-GCM), looked up by an HMAC of the key, limited to 80 MB each and 1 GB total, and expire after 10 minutes.
- **Message Board** (`/utilities/message-board`): an anonymous board where posts expire 60 seconds after posting, with control-character filtering, a 280-character limit, and per-IP rate limiting.

There's also an **About You** page that shows what the site can observe about a visit: request headers, Cloudflare's location headers, browser properties, and in-session navigation history (kept in memory, never sent to the server).

Each utility is self-contained under its own route, with frontend logic in `frontend/src/lib/<utility>/` and backend endpoints under `/api/<utility>/`. Adding one means adding a route-table entry, a page, an API client built on the shared helpers, and backend routes with tests. Utility data models, API contracts, and limits are documented in `documentation/UTILITIES.md`.

## Project Content System

A core architectural decision was replacing hardcoded project cards and details with Markdown content files.

### How It Evolved

Originally, editing a project write-up meant changing frontend source code and rebuilding the SPA. At the time a deploy was slow and took the site down, so I moved write-ups into the backend: Flask served the Markdown from an API and the browser rendered it at runtime, which let content change without a frontend rebuild.

Once deploys became fast and zero-downtime, that tradeoff stopped paying for itself. Runtime rendering meant an extra API round trip, a loading state on every project page, and the whole Markdown pipeline shipped to every visitor. So rendering moved to build time:

1. Edit a Markdown file in `frontend/src/content/projects/`. The dev server reloads the page on save.
2. Push to `main` and run the deploy.

### Technical Implementation

Content flow:

1. Project files live in `frontend/src/content/projects/` as Markdown with YAML frontmatter.
2. A Vite plugin parses the frontmatter, drops unpublished projects, sorts by priority, and exposes the result as a virtual module of card metadata.
3. Each project's rendered HTML becomes its own lazily loaded chunk, so the main bundle doesn't grow with each write-up.
4. The same project list drives `sitemap.xml` and the per-route HTML files Nginx serves.

The rendering pipeline:

1. Parse Markdown with GitHub Flavored Markdown (GFM) support.
2. Generate anchor IDs for headings and inject links.
3. Convert Mermaid code fences into placeholder targets.
4. Sanitize HTML to prevent injection attacks.
5. In the browser: mount the pre-rendered HTML.
6. Run Mermaid rendering for diagrams, using the current theme.

### Reliability Lessons

Implementing this surfaced subtle integration issues:

- The sanitization schema needed explicit support for Mermaid container tags to preserve diagram placeholders.
- Mermaid has to run after rendered content is mounted, and again when the theme changes.
- Instrumenting each stage (input validation, parse, sanitize, render) was essential for debugging.

Those lessons are now encoded in the implementation.

## Challenges and Tradeoffs

### 1) Simplicity vs scalability

A single VM keeps operations straightforward, but it concentrates failure risk. File-share and message-board state live on one disk and in one process, which rules out horizontal scaling.

### 2) Rich client behavior vs complexity

The scheduler computes everything in-browser for responsiveness, which increases frontend state management and complexity.

### 3) Fast content publishing vs rendering surface area

Markdown files make publishing easy, but rendering them still requires careful sanitization and renderer maintenance, even at build time.

### 4) Security vs convenience

The tunnel-only network, keyless CI credentials, and a single-purpose sudo rule make the deployment much harder to abuse, but they add setup steps and make debugging access more deliberate.

### 5) Full-stack breadth vs maintenance cost

Owning the frontend, backend, infrastructure, and pipeline in one repo improves learning and control, but increases maintenance burden. Clear docs, shared code, and conventions keep it sustainable.

### 6) Debugging the pipeline

Moving deploys to GitHub Actions surfaced a non-obvious stall: from the runner, the end of the release tarball reached the VM exactly 240 seconds late (two of sshd's 120-second keepalive intervals), while the same transfer took about three seconds locally. Client-side SSH keepalives every five seconds push the stalled data through, bringing deploys back to normal speed.

## Portfolio Value

This project demonstrates full-stack architecture in a cohesive, deployable system:

**Frontend Architecture**: Route-driven SPA design with a custom router, shared API and UI primitives, state management across multiple utilities, safe HTML rendering, and build-time Markdown rendering with diagram support.

**Backend Design**: API-first thinking, frontmatter-based content modeling, encryption and expiry for user uploads, input sanitization and rate limiting, and a tested API surface.

**Infrastructure as Code**: A tunnel-only VM topology, deterministic first-boot provisioning, runtime secret retrieval, and least-privilege service configuration.

**CI/CD**: Tested, reproducible releases with hash-pinned dependencies, keyless authentication, atomic activation, and automatic rollback.

**Content Platform**: Decoupling content from frontend code, a practical pattern for portfolio sites, blogs, documentation, and product platforms.

**Integration**: Connecting frontend, backend, infrastructure, and delivery into a working system that can be deployed, iterated on, and understood end-to-end.

The project prioritizes clarity and coherence over feature breadth. Every component has a clear responsibility, making it straightforward to follow a request from the browser to the running service.

## Results

- One cohesive repository demonstrating frontend, backend, infrastructure, and CI/CD capability.
- Push-to-deploy releases with tests as a gate and automatic rollback on failed health checks.
- Multiple interactive utilities showcasing different problem domains and interaction patterns.
- A content platform where write-ups are published by editing Markdown.
- Public uptime monitoring and a status page.
- Documentation covering architecture, implementation, deployment, operations, and known issues.

## Performance and Operational Notes

The architecture emphasizes predictable behavior over aggressive optimization.

Observed strengths:

- simple request path,
- low coordination overhead,
- fast local iteration with a single `start-dev.sh` script.

Current constraints:

- no horizontal scaling strategy,
- the file share holds whole files in memory during transfer, so it caps concurrent transfers at two on a 1 GB VM,
- scheduler edits live only in browser memory unless exported.

These are acceptable for the current scope and are tracked as known issues.

## Security and Trust Model

Key practices in the current implementation:

- no open web ports: all traffic arrives through the Cloudflare Tunnel
- HTTPS enforced by Cloudflare, plus an Nginx redirect and HSTS
- CORS enabled only in development; production is same-origin
- Markdown sanitized before HTML injection; message-board text stripped of control and invisible characters and rendered as plain text
- file-share downloads always served as `application/octet-stream` with `nosniff`
- secrets fetched from Secret Manager at boot
- deploy credentials issued only to `main` in the `production` environment through Workload Identity Federation
- releases verified by checksum, with hash-pinned dependencies

Areas to strengthen:

- enforce the Content Security Policy (currently report-only)
- move Terraform state to an encrypted remote backend
- optionally gate production deploys behind a required reviewer

## What I Would Improve Next

1. Run the browser smoke test and accessibility scan in CI, not just locally.
2. Add saved schedule persistence (local first, then optional backend storage).
3. Stream file-share encryption in fixed-size chunks to keep memory flat and allow more concurrent transfers.
4. Move Terraform state to a remote encrypted backend and bring the status-page DNS record under Terraform.
5. Expand write-ups with screenshots and deeper implementation notes per project.
