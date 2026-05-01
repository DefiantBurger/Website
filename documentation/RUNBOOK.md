# Runbook

## Purpose

Operational procedures for routine maintenance, incident response, and documentation quality checks.

## Standard Procedures

### Content-Only Project Update (No Frontend Rebuild)

Use this when editing only project Markdown content.

1. Edit project Markdown in backend content directory.
2. Validate frontmatter and ensure `published: true`.
3. Verify `GET /api/projects` and `GET /api/projects/:slug` responses.
4. Refresh the project page.

Frontend project pages fetch content at runtime; content-only edits do not require a frontend rebuild.

### Full Application Update on VM

1. Pull latest code on VM.
2. Reinstall backend package dependencies.
3. Build frontend with correct `VITE_BACKEND_URL`.
4. Restart `flaskapp`.
5. Reload/restart Nginx if config changed.

For full infrastructure refresh paths, use the deployment guide.

### Verify Service Health

1. `systemctl status flaskapp`
2. `systemctl status nginx`
3. Check project and utility API endpoints with curl.
4. Load root, projects, and utilities routes in browser.

## Incident Playbook

### API Returns Non-JSON

Symptoms:

- frontend parse/load errors,
- console errors for unexpected content type.

Actions:

1. Curl endpoint and inspect headers/body.
2. Validate Flask route behavior and returned file.
3. Check Nginx proxy mapping for `/api/`.

### Project Page Missing

Symptoms:

- `/projects/:slug` renders not found.

Actions:

1. Confirm Markdown file exists.
2. Confirm frontmatter `slug` matches URL.
3. Confirm `published: true`.
4. Re-test project detail API endpoint.

### Utility Data Load Failure

Actions:

1. Confirm utility endpoints return 200 JSON.
2. Validate utility data files are present/readable.
3. Verify frontend backend URL target is correct.

Utility-specific checks are documented in `UTILITIES.md`.

### File Share Storage Saturation

Symptoms:

- upload requests return a 503 response,
- storage status reports live usage at or near 1 GB after eviction.

Actions:

1. Call `GET /api/fileshare/status` to confirm live usage.
2. Confirm the backend has already evicted the oldest active files.
3. Wait for expired files to age out, or manually clear stale files from the backend instance fileshare directory if you need to recover capacity immediately.
4. Re-check status until used storage falls below 1 GB.
5. Retry the upload.

### File Share Missing File

Symptoms:

- password lookup returns 404,
- upload label already exists for another active file.

Actions:

1. Confirm the password is correct.
2. Confirm the upload has not already expired after 10 minutes.
3. If duplicate-label rejection is expected, choose a different password.

## Known Issues and Recommended Fixes

### Backend

1. 404 template is referenced but missing.
   Fix: add `backend/app/templates/404.html`.
2. `MONGODB_URI` is injected but currently unused.
   Fix: either integrate it or remove it until needed.
3. No automated backend tests.
   Fix: add pytest startup smoke + route tests.

### Frontend

1. `frontend/src/app.css` includes a duplicate legacy style region.
   Fix: consolidate to one stylesheet structure.
2. About and Contact are placeholders.
   Fix: replace with final content and metadata.
3. Project cards include placeholder/hard-coded content in some pages.
   Fix: render from canonical data source.
4. No frontend utility/UI test suite.
   Fix: add Vitest + Testing Library tests.

### Utilities

1. Utility-specific data and behavior risks are tracked in `UTILITIES.md`.
   Fix: keep each utility section current with known gaps and mitigations.

### Infrastructure

1. Terraform local state files in repo.
   Fix: migrate to remote encrypted backend and stop tracking local state.
2. Secrets exposed in local state.
   Fix: rotate exposed values and avoid plaintext secret values in state.
3. Boot-time clone/build deployment model.
   Fix: migrate to immutable artifacts.
4. Hardening/observability baseline is incomplete.
   Fix: tighten privileges/firewall and add monitoring/alerts.

## Security and Secrets SOP

1. Never commit secrets or secret-bearing artifacts.
2. Rotate any exposed secret immediately.
3. Re-run relevant deployment/app restart procedure after rotation.
4. Keep service permissions and network access least-privileged.

## Documentation QA Checklist

Use this list when updating docs:

### Case Study Quality

- [ ] Problem and scope are clear.
- [ ] Architecture decisions include tradeoffs.
- [ ] Outcomes are concrete and credible.
- [ ] Next steps are specific and realistic.

### Technical Accuracy

- [ ] Route list matches router behavior.
- [ ] API contracts match backend responses.
- [ ] Utility-specific states and behavior details are correct.
- [ ] Deployment flow matches Terraform/startup behavior.

### Evidence and Artifacts

- [ ] Architecture diagram is present/readable.
- [ ] Utility examples are present for affected features.
- [ ] Runtime Markdown + Mermaid flow is documented.
- [ ] At least one real project Markdown example is represented.

### Operations Readiness

- [ ] Content-only update SOP validated.
- [ ] Incident steps are actionable.
- [ ] Secret rotation guidance is current.
- [ ] Known issues list is reviewed/prioritized.

### Final Editorial Pass

- [ ] Cross-links are current.
- [ ] Terminology is consistent.
- [ ] Dates/commands are current.
- [ ] Obsolete placeholders are removed.
