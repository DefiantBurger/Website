# Known Issues and Recommended Fixes

This page captures issues visible from the current repository state and a practical next fix for each.

## Backend

1. `404.html` template referenced by backend is missing.
	Recommended fix: add a minimal `404.html` template in `backend/app/templates/` and verify the configured error handler renders it.
2. `MONGODB_URI` is injected in deployment service but not used by backend code.
	Recommended fix: either integrate MongoDB usage in backend code (config + data layer) or remove the variable from deployment until it is needed.
3. No automated backend tests are present.
	Recommended fix: add `pytest` with a smoke test for app startup and route-level tests for key endpoints.

## Frontend

1. `src/app.css` contains a duplicated/legacy Vite template style block after custom site theme styles.
	Recommended fix: remove the legacy block and keep one coherent stylesheet organized by base, layout, and component sections.
2. About and Contact pages are placeholders.
	Recommended fix: replace placeholder copy with final content, links, and basic metadata for SEO/social previews.
3. Projects/Home project listings are currently hard-coded placeholders.
	Recommended fix: move project content into a structured data source (JSON or TypeScript module) and render cards from that source.
4. No frontend test suite is present for scheduler logic and interactions.
	Recommended fix: add `vitest` + `@testing-library/svelte` and cover scheduler utilities and critical UI flows.

## Scheduler Feature

1. Data source appears seeded and not guaranteed accurate by in-page disclaimer.
	Recommended fix: define a canonical source-of-truth update workflow and add a data version/date stamp in the UI.
2. User edits are in-memory only unless exported manually.
	Recommended fix: persist local edits to `localStorage` with import/export as a fallback.
3. No persistence API or user profile support exists yet.
	Recommended fix: design a minimal backend persistence API and auth model, then phase migration from local-only state.

## Infrastructure

1. Terraform local state files are present in repository.
	Recommended fix: migrate to a remote encrypted backend (for example GCS backend) and remove local state artifacts from git tracking.
2. Secrets are currently exposed in Terraform state (`terraform.tfstate`).
	Recommended fix: rotate exposed secrets, avoid storing plaintext secret values in Terraform-managed attributes, and retrieve secrets at runtime via Secret Manager references.
3. Deployment currently depends on VM startup script clone/build flow.
	Recommended fix: move to immutable build artifacts (container image or release bundle) and deploy pinned versions instead of cloning live source on boot.
4. Service hardening can be improved beyond current baseline.
	Recommended fix: enforce least-privilege service accounts, tighten firewall/service bindings, and add monitoring/alerting baselines.
