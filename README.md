# Personal Website

[![Better Stack Badge](https://incidents.betterstack.com/status-badges/v3/monitor/31qxn.svg)](https://status.josephcicalese.com/)
[![Test](https://github.com/DefiantBurger/Website/actions/workflows/test.yaml/badge.svg?branch=main)](https://github.com/DefiantBurger/Website/actions/workflows/test.yaml)
[![codecov](https://codecov.io/gh/DefiantBurger/Website/branch/main/graph/badge.svg)](https://codecov.io/gh/DefiantBurger/Website)

Svelte + Vite frontend, Flask API backend, on a single GCP VM (provisioned by Terraform) behind a Cloudflare Tunnel. GitHub Actions tests PRs and pushes to `main`, and deploys `main` when run by hand. Hosts project write-ups (Markdown rendered at build time) and interactive utilities.

![Svelte](https://img.shields.io/badge/Svelte-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-000000?logo=flask&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.13%2B-3776AB?logo=python&logoColor=white)
![Terraform](https://img.shields.io/badge/Terraform-844FBA?logo=terraform&logoColor=white)
![Google Cloud](https://img.shields.io/badge/Google_Cloud-4285F4?logo=googlecloud&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white)

## Quick Start

Requires Python 3.13+, [uv](https://docs.astral.sh/uv/), Node.js 22.18+ (the test scripts run TypeScript directly), pnpm, and [just](https://just.systems).

```bash
(cd backend && uv sync)
(cd frontend && pnpm install)
just dev     # backend on :5000, Vite dev server on :5173
just test    # all tests and checks (--no-browser to skip the browser checks)
```

Run `just` for the other recipes; they're described in [Development](./documentation/DEVELOPMENT.md#scripts).

## Documentation

| Document | Covers |
| --- | --- |
| [Architecture](./documentation/ARCHITECTURE.md) | Topology, stack, runtime flows, security boundaries |
| [Development](./documentation/DEVELOPMENT.md) | Scripts, environment, tests and CI, dependency updates |
| [Implementation](./documentation/IMPLEMENTATION.md) | Backend/frontend code structure, project rendering, API reference |
| [Utilities](./documentation/UTILITIES.md) | Scheduler, File Share, and Message Board behavior and APIs |
| [Infrastructure](./documentation/INFRASTRUCTURE.md) | Terraform resources, secrets, VM bootstrap and swaps, production runtime, deploy workflow |
| [Runbook](./documentation/RUNBOOK.md) | Shipping changes, health checks, maintenance, incidents |
| [Issues](./documentation/ISSUES.md) | Open bugs, gaps, and tech debt across the stack |
| [Ideas](./documentation/IDEAS.md) | Planned features and improvements, not yet started |

## Repo Activity

![Last commit](https://img.shields.io/github/last-commit/DefiantBurger/Website)
![Commit activity](https://img.shields.io/github/commit-activity/m/DefiantBurger/Website)
![Repo size](https://img.shields.io/github/repo-size/DefiantBurger/Website)
