# Known Gaps and Technical Debt

This page captures issues visible from the current repository state.

## Backend

1. `404.html` template referenced by backend is missing.
2. `MONGODB_URI` is injected in deployment service but not used by backend code.
3. No automated backend tests are present.

## Frontend

1. `src/app.css` contains a duplicated/legacy Vite template style block after custom site theme styles.
2. About and Contact pages are placeholders.
3. Projects/Home project listings are currently hard-coded placeholders.
4. No frontend test suite is present for scheduler logic and interactions.

## Scheduler Feature

1. Data source appears seeded and not guaranteed accurate by in-page disclaimer.
2. User edits are in-memory only unless exported manually.
3. No persistence API or user profile support exists yet.

## Infrastructure

1. Terraform local state files are present in repository.
2. Deployment currently depends on VM startup script clone/build flow.
3. Service hardening can be improved beyond current baseline.

## Suggested Priority Order

1. Fix backend missing 404 template.
2. Clean `app.css` to one coherent stylesheet.
3. Add basic backend and scheduler unit tests.
4. Add persistent storage design for scheduler state.
5. Move Terraform state to remote backend with locking.
