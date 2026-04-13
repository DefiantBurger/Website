# Architecture

## Project Snapshot

This repository is a full-stack personal website with:

- a Svelte + Vite frontend,
- a Flask backend API,
- Terraform-managed deployment on a single GCP VM behind Cloudflare,
- a utilities area for interactive tools.

A major architectural improvement moved project write-ups to backend-hosted Markdown so project content can be updated without rebuilding frontend assets.

## Goals

1. Present a clear, public portfolio and project narrative.
2. Support multiple utilities under a shared site platform.
3. Keep operations simple and low-cost.
4. Support content-only updates without frontend rebuild/redeploy.

## System Topology

```mermaid
flowchart LR
    User[Browser User] --> CF[Cloudflare]
    CF --> Nginx[Nginx on GCE VM]
    Nginx -->|/| FE[Svelte static build]
    Nginx -->|/api/*| Flask[Flask app on :5000]
    Flask --> JSON[Utility JSON files]
    Flask --> MD[Project Markdown files]
```

## Stack by Layer

### Frontend

- Svelte 5
- TypeScript
- Vite
- page.js client-side router

Responsibilities:

1. Render site routes and page content.
2. Host utility experiences under `/utilities/*` routes.
3. Fetch and render runtime Markdown project content.

### Backend

- Flask app factory + blueprint routing
- Flask-CORS scoped to `/api/*`
- Waitress in production

Responsibilities:

1. Serve project and utility APIs.
2. Serve published project metadata and Markdown body content.
3. Enforce required environment configuration (`SECRET_KEY`).

### Infrastructure

- Terraform for network/VM/firewall/DNS resources
- Nginx for TLS, static hosting, API proxying
- systemd-managed Flask service
- Cloudflare DNS + proxy

## Repository Layout

- `frontend/`: SPA shell, router, utility logic, project rendering pipeline.
- `backend/`: API routes, utility/project data, project content files.
- `deployment/`: Terraform and startup/service templates.
- `documentation/`: architecture, implementation, deployment, and runbook docs.

## Core Runtime Flows

### Page Navigation

1. Router maps URL to page component.
2. Data-heavy routes (utility/project detail) trigger async loads.
3. Components switch among loading, error, and ready states.

### Utility Flow

1. Frontend loads utility-specific data and state based on the route.
2. Utility logic runs in-browser for responsive interactions.
3. UI updates utility cards, controls, and visual overlays.
4. Utility-specific details and contracts are documented in `UTILITIES.md`.

### Project Content Flow

1. Frontend fetches `/api/projects` for card/index content.
2. Detail route fetches `/api/projects/:slug` for Markdown payload.
3. Renderer applies GFM parsing, heading anchors, and sanitization.
4. Mermaid diagrams render client-side after DOM update.

## Data and Content Strategy

### Utility Data

- Utility datasets and contracts are versioned per utility.
- Frontend consumes utility data on demand via API.
- Utility-specific persistence support is documented per utility.

### Project Write-Ups

- Source of truth is Markdown with YAML frontmatter in backend content directory.
- `published` frontmatter controls public visibility.
- Enables rapid editorial iteration without rebuilding frontend.

## Security and Trust Boundaries

1. CORS is scoped to `/api/*` routes.
2. Markdown output is sanitized before frontend injection.
3. Infra secrets are pulled from Secret Manager during provisioning.
4. HTTPS is enforced through Cloudflare + Nginx configuration.

## Notable Tradeoffs

1. Single VM simplicity vs managed-service scalability.
2. Runtime Markdown flexibility vs additional client rendering complexity.
3. Frontend-heavy utility logic for responsive UX vs increased client complexity.

## Constraints

1. Single-VM topology is a single failure domain.
2. Some utility datasets may be static and drift without a refresh workflow.
3. Utility persistence/auth is not yet standardized across tools.
4. Test coverage is limited across backend and frontend.

## Next Iterations

1. Add `/api/health` and basic uptime monitoring.
2. Add backend and frontend automated tests for critical flows.
3. Introduce a shared persistence pattern for applicable utilities.
4. Improve Terraform state/secrets posture for production hardening.
