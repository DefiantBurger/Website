# Personal Website

[![Better Stack Badge](https://incidents.betterstack.com/status-badges/v3/monitor/31qxn.svg)](https://incidents.betterstack.com/?utm_source=status_badge)
[![Test and Deploy](https://github.com/DefiantBurger/Website/actions/workflows/deploy.yaml/badge.svg?branch=main)](https://github.com/DefiantBurger/Website/actions/workflows/deploy.yaml)
[![codecov](https://codecov.io/gh/DefiantBurger/Website/branch/main/graph/badge.svg)](https://codecov.io/gh/DefiantBurger/Website)

Svelte + Vite frontend, Flask API backend, on a single GCP VM (provisioned by Terraform) behind a Cloudflare Tunnel. GitHub Actions tests every push and deploys `main`. Hosts project write-ups (runtime Markdown) and interactive utilities.

![Svelte](https://img.shields.io/badge/Svelte-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-000000?logo=flask&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)
![Terraform](https://img.shields.io/badge/Terraform-844FBA?logo=terraform&logoColor=white)
![Google Cloud](https://img.shields.io/badge/Google_Cloud-4285F4?logo=googlecloud&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white)

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
| [Runbook](./documentation/RUNBOOK.md) | Health checks, routine procedures, incidents |
| [Known Issues](./documentation/KNOWN-ISSUES.md) | Open bugs, gaps, and tech debt across the stack |

## Repo Activity

![Last commit](https://img.shields.io/github/last-commit/DefiantBurger/Website)
![Commit activity](https://img.shields.io/github/commit-activity/m/DefiantBurger/Website)
![Top language](https://img.shields.io/github/languages/top/DefiantBurger/Website)
![Repo size](https://img.shields.io/github/repo-size/DefiantBurger/Website)
![Open issues](https://img.shields.io/github/issues/DefiantBurger/Website)
