# Operations Runbook

## Purpose

This runbook captures practical maintenance procedures for the site in production and local staging workflows.

## Standard Operating Procedures

### 1. Content-Only Project Update (No Frontend Rebuild)

Use this flow when changing only project write-up content:

1. Edit markdown in backend project content directory.
2. Ensure frontmatter is valid and `published: true`.
3. Verify endpoint response with `curl /api/projects` and `curl /api/projects/:slug`.
4. Refresh browser page.

Notes:

- Frontend fetches content at runtime.
- A frontend rebuild is not required for markdown-only updates.

### 2. Full Application Update on VM

1. Pull latest code on VM.
2. Reinstall backend package dependencies.
3. Build frontend with correct `VITE_BACKEND_URL`.
4. Restart `flaskapp` service.
5. Reload Nginx if config changed.

Reference full infra sequence in [deployment.md](./deployment.md) and VM procedure notes in [vm-update.md](./vm-update.md).

### 3. Verify Service Health

1. Check systemd status: `systemctl status flaskapp`.
2. Check Nginx status: `systemctl status nginx`.
3. Check API responses for scheduler and projects endpoints.
4. Load site root, projects page, and scheduler route in browser.

## Incident Playbook

### API Returns Non-JSON

Symptoms:

- Frontend shows parse/load errors.
- Browser console reports unexpected content-type.

Actions:

1. Curl endpoint and inspect headers/body.
2. Validate Flask route path and returned file.
3. Check Nginx proxy path behavior for `/api/`.

### Project Page Missing

Symptoms:

- `/projects/:slug` displays not found error.

Actions:

1. Verify markdown file exists in backend project content directory.
2. Verify frontmatter `slug` matches URL.
3. Verify `published` is true.
4. Re-check API response for `/api/projects/:slug`.

### Scheduler Data Load Failure

Actions:

1. Validate both scheduler endpoints return 200 JSON.
2. Verify scheduler JSON files on VM are present and readable.
3. Confirm frontend `VITE_BACKEND_URL` points to correct host.

## Security and Secrets SOP

1. Do not commit secrets or generated secret-bearing state files.
2. Rotate any exposed secret immediately in Secret Manager and dependent services.
3. Re-run deployment/app restart procedures after secret rotation.
4. Keep principle of least privilege for service users and firewall rules.

## Documentation Hygiene

1. Add verification date to sections when behavior changes.
2. Update API examples when schema fields change.
3. Keep known issues synced with observed production gaps.
