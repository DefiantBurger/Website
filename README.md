# Personal Website

Svelte + Vite frontend, Flask API backend, deployed by Terraform to a single GCP VM behind a Cloudflare Tunnel. Hosts project write-ups (runtime Markdown) and interactive utilities.

## Quick Start

Requires Python 3.11+, [uv](https://docs.astral.sh/uv/), Node.js 22+, and pnpm.

```bash
(cd backend && uv sync)
(cd frontend && pnpm install)
./start-dev.sh   # backend on :5000, Vite dev server on :5173
```

## Documentation

| Document | Covers |
| --- | --- |
| [Architecture](./documentation/ARCHITECTURE.md) | Topology, stack, runtime flows, security boundaries |
| [Implementation](./documentation/IMPLEMENTATION.md) | Local development, testing, backend/frontend structure, API reference |
| [Utilities](./documentation/UTILITIES.md) | Scheduler, File Share, and Message Board behavior and APIs |
| [Deployment](./documentation/DEPLOYMENT.md) | Terraform resources, secrets, VM bootstrap, deploy procedures |
| [Runbook](./documentation/RUNBOOK.md) | Health checks, routine procedures, incidents, known issues |
