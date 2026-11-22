# Development

Setup is in the [README](../README.md#quick-start); how the code is organized is in [Implementation](./IMPLEMENTATION.md).

## Scripts

| Script | Does |
| --- | --- |
| `./start-dev.sh` | Runs the backend on :5000 and the Vite dev server on :5173, stops both on Ctrl+C, and defaults the [environment](#environment). |
| `./test.sh` | Every [check](#checks) except the VM script tests; `--no-browser` skips smoke + a11y. |
| `./format.sh` | Formats every file (Ruff + Prettier). |
| `./doc-test.sh` | Checks that links between docs resolve, and that doc names and headings mentioned in code still exist. |
| `./gen-icons.sh` | Regenerates the PNG/ICO icons from `frontend/public/favicon.svg` ([details](./IMPLEMENTATION.md#routing)). |
| `./deploy.sh` | Deploys `origin/main` ([Runbook](./RUNBOOK.md#ship-a-change)). |

## Environment

`start-dev.sh` defaults these if unset:

| Variable | Default | Effect |
| --- | --- | --- |
| `FLASK_ENV` | `development` | `development`: Flask debug server + CORS on `/api/*`. `production` (the default when running `main.py` directly): Waitress on `127.0.0.1`. |
| `PORT` | `5000` | Backend port. |
| `SECRET_KEY` | `local-dev-secret` | Required by the backend; also the file-share label pepper. |
| `VITE_BACKEND_URL` | `http://localhost:$PORT` | API base URL. If unset, dev builds use `http://localhost:5000` and production builds use the page's own origin. |

`backend/main.py` also loads `backend/.env` if present.

## Checks

```bash
cd backend && uv run pytest --cov=app
cd backend && uv run ruff check --fix . && uv run ruff format .
cd frontend && pnpm test                 # unit tests (node:test)
cd frontend && pnpm check                # svelte-check + tsc
cd frontend && pnpm lint && pnpm format  # ESLint + Prettier (format:check to verify only)
cd frontend && pnpm smoke                # browser smoke test
cd frontend && pnpm a11y                 # axe-core scan
./doc-test.sh                            # doc links
```

- **`test.sh`** continues past failures and prints a pass/fail summary (exit 1 if any failed). For the browser checks it reuses dev servers already on :5000/:5173, or starts `start-dev.sh` itself (log in `$TMPDIR/test-sh-dev.log`).
- **Config:** Ruff in `backend/pyproject.toml`; Prettier and ESLint in `frontend/.prettierrc.json` and `frontend/eslint.config.js` (`eslint-config-prettier` keeps them from conflicting). Prettier covers all of `frontend/` except `dist/` and the lockfile, project Markdown included.
- **Backend tests** (`backend/tests/`) get a temporary instance directory per test (`conftest.py`), so they never touch real file-share storage. A test that builds its own app should pass `instance_path` too, since creating an app empties its file-share directory.
- **Unit tests** (`frontend/tests/unit/*.test.ts`) use Node's built-in runner and cover pure logic only: code using runes (`.svelte.ts`) or `import.meta.env` can't load outside Vite, so keep testable logic in plain `.ts` modules. `tests/unit/resolve-ts.ts` lets Node resolve the source's extensionless imports. A test marked `{ todo }` documents a known bug without failing the suite.
- **`pnpm smoke`** loads every route and fails on a missing heading, an uncaught exception, a console error, or a 4xx/5xx API response, then checks client-side navigation, trailing-slash redirects, the 404 suggestion, theme persistence, the mobile nav menu, and opening the shell to run `cd`.
- **`pnpm a11y`** runs axe-core (WCAG 2.2 A/AA plus best practices) on every route, one project page, and two 404 paths (an unknown page and an unknown project), in both themes at desktop and phone width, with the shell open on the home page. Nothing is excluded, Mermaid diagrams included. Screen-reader flow, focus handling, and drag-and-drop still need a manual check.
- Both browser scripts need the dev servers running, drive the installed Google Chrome through `playwright-core` (or run `pnpm exec playwright-core install chromium`), and accept `TEST_BASE_URL` to target another host.

### VM Script Tests

`infrastructure/test/run.sh` checks everything that reaches the VM, locally, in about 5 minutes:
- It runs the rendered startup script in Debian 13 containers with systemd, with `gcloud`, `sysctl`, and the metadata server stubbed. The scenarios cover first boot, reruns, config changes and their failure handling, and a new VM in a swap whose release is good, broken, or can't reach the tunnel. They also check the metadata firewall, the upload caps, and that the deploy script refuses tarballs that could run code as root.
- It also tests `wait-for-vm.sh`, and Terraform's swap ordering with a local stand-in config.

It needs Docker, shellcheck, Terraform, uv, and `tf.sh`'s gcloud login (rendering reads Terraform state). Run it after changing anything in `infrastructure/` that reaches the VM. It can't model GCE itself (the guest environment, IAM, a real tunnel), so watch the first real run of anything new.

### CI

Both workflows set up uv, pnpm, and Node through `.github/actions/setup`. ***Test*** (`test.yaml`) runs on PRs and on pushes to `main` that change more than docs: backend `ruff check`, `ruff format --check`, and `pytest --cov=app` (coverage to Codecov); frontend `lint`, `format:check`, `check`, `test`, and `build`. Lint and format problems only warn. It skips the browser checks, the VM script tests, and `doc-test.sh`. *Deploy* is described under [Infrastructure](./INFRASTRUCTURE.md#deploy-workflow).

## Updating Dependencies

There's no update bot; GitHub's Dependabot security alerts (Security tab, email) are the only notification. Update by hand, then run `./test.sh`:

```bash
cd frontend && pnpm outdated && pnpm update -i --latest
cd backend && uv tree --outdated --depth 1 && uv lock --upgrade && uv sync
```

Both package managers skip releases younger than three days, so a freshly compromised version can't land in a lockfile: `minimumReleaseAge` in `frontend/pnpm-workspace.yaml` and `exclude-newer` under `[tool.uv]` in `backend/pyproject.toml`. To take an urgent fix sooner, exempt that one package (`minimumReleaseAgeExclude: [<name>]` or `exclude-newer-package = { <name> = false }`) and remove the exemption once the release is three days old.

GitHub Actions are pinned by commit SHA in `.github/workflows/` and `.github/actions/`; bump those by hand too.
