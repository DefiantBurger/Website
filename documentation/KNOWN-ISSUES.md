# Known Issues

## Backend

1. No uptime monitoring or alerting (`/api/health/` exists, but nothing polls it).

## Frontend

1. `Home.svelte` shows hard-coded placeholder "Featured Projects" instead of using `/api/projects/`.
2. `src/app.css` ends with leftover Vite template styles (from `body { margin: 0; }` onward) that reference undefined variables (`--heading`, `--text-h`); `src/lib/Counter.svelte` is unused template code.
3. No frontend tests (scheduler logic is the best first target).

## Infrastructure

1. Terraform state is local to the operator's machine (gitignored): no remote backend, encryption, or locking. It contains the tunnel secret (`random_id.tunnel_secret`). Move it to an encrypted remote backend (e.g. GCS).
2. Deploys auto-run on every green push to `main`. Adding required reviewers to the `production` environment would gate them.

## Utilities

### Class Scheduler

1. Catalog and seed data may be incomplete or outdated.
2. Edits live in memory only; reloading loses them unless exported.
3. No tests for the scheduler parser or graph logic.

### File Share

1. Whole files are held in memory during transfer. Encrypting in fixed-size chunks (e.g. AES-GCM per 1 MB with per-chunk nonces, streamed to disk) would keep memory flat and allow raising the concurrency cap.
2. Expiry is request-driven; idle files linger until the next file-share request.
