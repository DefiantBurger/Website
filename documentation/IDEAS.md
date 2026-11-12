# Ideas

Features and improvements worth building, none of them started. Bugs and tech debt go in [Issues](./ISSUES.md) instead. When an idea ships, delete it here and document the behavior in the relevant doc.

## Content

### Research write-up with interactive demos

Write up the quantum transport simulation research as a project in `frontend/src/content/projects/`, with interactive demos embedded in the text instead of on a separate page.

- **Embedding:** project Markdown is rendered to HTML at build time (`plugins/projects.ts`), so it can't contain Svelte components today. One option is a placeholder block (e.g. `<div data-demo="wavepacket"></div>`) that `ProjectDetail.svelte` finds after rendering and mounts a component into. That keeps the Markdown plain, and the demo code is only loaded on pages that use it.
- **First demo:** a 1D Gaussian wavepacket hitting a potential barrier, drawn on a canvas, with sliders for barrier height/width and packet energy, so tunneling and reflection play out live. The split-step Fourier method is simple and stable (it needs a small FFT, which is easy to write by hand rather than add as a dependency). Crank–Nicolson is the alternative if a tridiagonal solve is easier to reason about.
- Show transmission/reflection probability next to the analytic result, so the demo also checks itself.
- Colors from `--color-*` variables (read them with `getComputedStyle`, since a canvas can't use CSS variables directly), and redraw when the theme changes.

### Robotics hardware showcase (maybe)

For the Wisconsin Robotics electrical work: export KiCad boards to SVG and show them in a viewer with toggleable layers (copper, silkscreen, etc.). Not decided yet.

## Site-wide

### Interactive shell

A terminal prompt that opens over any page and drives the site with commands. It fits the terminal look, and it adds a keyboard way to get around the site.

**Opening and closing**

- `` ` `` or `/` opens it (ignored while typing in an input). `Esc` or `exit` closes it and returns focus to where it was.
- A visible `>_` button in the nav, for phones and for people who don't know the shortcut.
- Opens as a panel docked to the bottom of the page. A full-screen overlay is the alternative, but docked keeps the page visible, so `cd` can change the page underneath while the shell stays open.

**Commands (first pass)**

| Command | Does |
| --- | --- |
| `help` | List commands |
| `ls [path]` | List pages under a path (`ls projects` lists write-ups by slug) |
| `cd <path>` | Navigate (`cd ..`, `cd ~`, relative and absolute paths) |
| `pwd` | Current route |
| `cat <page>` | Print a short text summary (`cat about`, `cat projects/<slug>` prints the summary from frontmatter) |
| `open <slug>` | Open a project's demo/repo link |
| `theme [light\|dark]` | Toggle or set the theme |
| `clear`, `history`, `exit` | The usual |

Ideas for later: `whoami` (pulls from About You), `grep <term>` across project write-ups, `sudo` easter egg.

**Implementation notes**

- Build the virtual filesystem from `routeDefinitions` and the published project list, not a hand-written copy, so new pages show up automatically. `pathFor(key, params)` and each route's `meta` cover what the shell needs.
- Navigate through the existing router, not `location.href`.
- Tab completion on commands and paths; up/down arrows for history (session only).
- Keep the parser and filesystem in plain `.ts` modules so they can be unit tested with `node:test`.
- Accessibility: an output region with `role="log"`, a labeled input, focus kept inside the shell while it's open, and nothing that's only reachable through it.

### Footer with live site info

Add a footer, and move the Status link there from the navbar. It belongs with the other site info, not with page navigation.

- **Last deploy:** git short SHA and build date, injected at build time with Vite `define`. The SHA can link to the commit on GitHub. Only the date and SHA need to be shown.
- **Uptime:** either the backend process uptime (add it to `/api/health/` or a new endpoint), or the uptime percentage from Better Stack. Better Stack is the more honest number, but it needs an API token kept on the backend, and the result should be cached so each page view doesn't call Better Stack.
- Keep it coarse: no memory, load, or other VM details.

### Prerendering

The build already writes `<route>/index.html` for every route (`plugins/routeHtml.ts`) with that page's head tags, but the body is the same empty shell plus a `<noscript>` link list, so clients that don't run JavaScript see none of a page's own content. Prerendering would render each page to HTML at build time (`render` from `svelte/server`) and write that into the route's file instead. `main.ts` would then switch from `mount` to `hydrate`.

- **Gains:** visitors without JavaScript and simple crawlers see real content; content appears before the JS loads.
- **Costs:** anything that touches `window`, `localStorage`, or `document` while rendering breaks the build (theme handling, About You, the utilities), so it has to move into `onMount` or be guarded. The browser's render has to match the build's HTML or the page flickers. The theme is the main risk: `index.html` hard-codes `data-theme="light"`, so this needs a small inline script that sets the theme before the first paint. The CSP blocks inline scripts, and a blocking external script was already tried and made the flash worse (Issues appendix), so allow the inline one by hash: add its `'sha256-...'` to `script-src` in `nginx.conf.tftpl`, and have the build fail if the script's hash stops matching. Keep the script tiny and stable, since the Nginx config only reaches the VM through an in-place update or a VM replacement. It's also a second render path, which CI's `pnpm build` now covers.
- **Scope:** start with the static pages (home, about, projects, project detail, contact). Utilities need JS and live data anyway, so they keep the plain shell. Mermaid diagrams stay client-side.

### OG images

Link previews (Discord, Slack, iMessage, LinkedIn) use the page's `og:image`, which is currently the same 512px site icon for every page. Generate a 1200×630 image per project at build time (title + summary in the terminal style) and point each project's `og:image` at it, with a site-wide default for other pages. Turning an SVG template into a PNG needs a renderer, which probably means a build-only dependency (e.g. `@resvg/resvg-js`); the alternative is to make the images by hand once per project.

## Utilities

### Scheduler: term-offered checks

Warn when a course is placed in a term it isn't offered in (e.g. fall-only courses in a spring column). Semester keys already carry the term, so only the data is missing: the catalog scraper would need to record which terms each course is offered in (e.g. an `offered: ["fall", "spring"]` field), and `logic.ts` would add a problem for a mismatch. Show it in the Problems panel and on the card, separate from prerequisite problems.

### File Share: upload progress

Show a progress bar while uploading. `fetch` can't report upload progress, so this needs `XMLHttpRequest` (`upload.onprogress`). Uploads currently have no timeout (`timeoutMs: null`) because a large upload can legitimately take minutes; with progress events, a stall timeout (no bytes sent for ~30 s) could replace that.

### File Share: encryption in the browser and QR codes

**Encrypt in the browser** so the server only ever stores ciphertext and can't read uploaded files.

- Today the server uses the access key both to find a batch (HMAC label) and to encrypt it. With browser encryption, the browser derives two separate values from the access key (e.g. HKDF): a lookup token sent to the server, and an AES-GCM key that never leaves the browser. Otherwise the server still sees what it needs to decrypt.
- Encrypt in fixed-size chunks with a nonce per chunk. That's the same design as the memory fix in Issues (File Share #1), so the two should be built together.
- File names should be encrypted too, or the server still learns something about the files.
- WebCrypto (`crypto.subtle`) covers all of this without dependencies.

**QR code** for the access key, so a file can go from laptop to phone without typing the key.

- Encode a link with the key in the fragment (`/utilities/fileshare#key=...`), so scanning it opens the page with the key filled in, and the key never reaches the server or its logs.
- QR encoding is a few hundred lines to write by hand. A small, dependency-free library (e.g. `qrcode-generator`) is a reasonable exception to the no-new-dependencies rule.

## Infrastructure

### Remote Terraform state

Terraform state is local to the operator's machine (gitignored): no remote backend, encryption, or locking, and it contains the tunnel secret (`random_id.tunnel_secret`). Move it to an encrypted remote backend (e.g. a GCS bucket, which also gives locking). Low priority while there's only one developer.

### Cloudflare provider v5

Upgrade `cloudflare/cloudflare` from 4.52 to 5.x. v4 will stop getting updates eventually, and v5 can import Email Routing (Issues, Infrastructure #1).

- **Breaking changes:** `cloudflare_record` becomes `cloudflare_dns_record` (`moved` blocks handle state); nested blocks become attributes (tunnel config, ruleset rules, CAA `data`); `cloudflare_managed_headers` becomes `cloudflare_managed_transforms`; the `cloudflare_record` data sources change shape. Cloudflare's `tf-migrate` tool does most of the rewrite.
- **Main risk:** `tunnel_token` moves off the tunnel resource to the `cloudflare_zero_trust_tunnel_cloudflared_token` data source, and it feeds the Secret Manager version the VM reads. `plan` must show no replacement of the tunnel or the VM, or the site goes down until a redeploy.
- **Email Routing:** import `cloudflare_email_routing_settings` and `cloudflare_email_routing_dns` (both by zone ID). The repo is public, so rule destination addresses either go in a tfvars variable or stay in the dashboard.

### Debian 13 and Python 3.13

Debian 12 left standard support in June 2026 and is on Debian LTS until mid-2028 (confirm at https://wiki.debian.org/LTS before scheduling). Debian 13 (trixie) ships Python 3.13. This replaces the VM.

- `deployment/main.tf`: `image = "debian-cloud/debian-13"`.
- `deployment/startup.sh.tftpl`: `python3.11` and `python3.11-venv` become `python3.13` and `python3.13-venv` (step 2 and the version check in step 3); the cloudflared apt line's `bookworm` becomes `trixie` (check that https://pkg.cloudflare.com/cloudflared has a `trixie` suite; the `bookworm` packages also run on trixie if not). `deployment/deploy.sh.tftpl`: `python3.11 -m venv` becomes `python3.13`.
- Repo: `backend/.python-version` to `3.13`, `requires-python = ">=3.13"` and `target-version = "py313"` in `backend/pyproject.toml`, then `uv lock` and `uv run ruff check --fix .` (the `UP` rules may suggest newer syntax). CI reads `.python-version`, so it follows.
- Docs: Debian 12 in `DEPLOYMENT.md` (Resources table) and `ARCHITECTURE.md` (Stack table); Python 3.11 in `CLAUDE.md`, `README.md` (badge and requirements line), and the *VM Bootstrap* list in `DEPLOYMENT.md`.

### Supply-chain cooldowns in the repo

pnpm's `minimumReleaseAge` (install nothing published in the last N minutes) is currently set only in the owner's `~/.npmrc` (`minimum-release-age=4320`, three days). So the protection exists on one machine. Dependabot has its own equivalent and ignores pnpm's.

- Create `frontend/pnpm-workspace.yaml` with `minimumReleaseAge: 4320`. pnpm reads it for this project only; when a needed release is too new, add a `minimumReleaseAgeExclude` entry and remove it once the release has aged past the window.
- `.github/dependabot.yml`: add `cooldown: { default-days: 3 }` to all three `updates` entries (npm, uv, github-actions). uv itself has no rolling-window option (`exclude-newer` is a fixed date), so the Dependabot cooldown is the backend's only cover.
- Also enable **Dependabot security updates** in GitHub → Settings → Code security (alerts and secret scanning are already on; security updates, which open a PR as soon as an advisory lands, are off). Owner-only, no code.
- Docs: mention both settings in `IMPLEMENTATION.md` wherever dependencies are described.

### Terraform and shell checks in CI

Nothing runs `terraform fmt -check` or `terraform validate`, so a typo in `deployment/` surfaces only at `./tf.sh plan` with a live Cloudflare token. Neither needs credentials: `init -backend=false` downloads the providers from `.terraform.lock.hcl` and `validate` never calls an API.

New workflow `.github/workflows/infra.yaml`, triggered on `push` and `pull_request` with `paths: ['deployment/**', '*.sh', '.github/workflows/infra.yaml']` and `permissions: contents: read`:

1. `actions/checkout` (same SHA pin and `persist-credentials: false` as `test.yaml`).
2. `hashicorp/setup-terraform`, pinned to a commit SHA, with `terraform_version` matching `versions.tf`.
3. In `deployment/`: `terraform fmt -check -recursive -diff` (warn, like the other format checks), then `terraform init -backend=false -input=false` and `terraform validate` (fail: these are build errors, like `pnpm check`).
4. `shellcheck deploy.sh test.sh start-dev.sh format.sh deployment/tf.sh` from the repo root (warn). `shellcheck` is preinstalled on `ubuntu-latest`. Fix any findings locally first (`apt install shellcheck`). The `.tftpl` files can't be linted as-is because of the `$${}` template escapes; leave them out.

Dependabot already scans `/` for action pins, so the new workflow is covered. Docs: add the workflow to the *Pipeline* list in `DEPLOYMENT.md` and the workflows bullet in `ARCHITECTURE.md`.

### Shielded VM

Add to `google_compute_instance.default` in `deployment/main.tf`:

```hcl
shielded_instance_config {
  enable_secure_boot          = true
  enable_vtpm                 = true
  enable_integrity_monitoring = true
}
allow_stopping_for_update = true
```

Debian's GCE images are UEFI and support Shielded VM; e2 machines do too. vTPM and integrity monitoring are already GCP's defaults, so the real change is Secure Boot, which refuses unsigned kernel modules (none are used). It needs a stop/start, not a replacement: `./tf.sh plan` should show an in-place update of `flask-vm`. If it shows a replacement, stop and ask. Docs: the Compute row of the Resources table in `DEPLOYMENT.md`.

### Tighter systemd sandboxing

`flaskapp.service.tftpl` has `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, and `NoNewPrivileges`, but `systemd-analyze security flaskapp` still scores it as exposed. Safe additions for a non-root Python process that only serves HTTP on loopback and writes `data_path`:

```
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
ProcSubset=pid
PrivateDevices=yes
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
SystemCallFilter=@system-service
SystemCallArchitectures=native
UMask=077
```

- Leave out `MemoryDenyWriteExecute`: `cryptography` still depends on cffi, and libffi trampolines can need writable-and-executable memory.
- `UMask=077` makes file-share files mode 600, which is fine because only `flaskapp` reads them.
- `cloudflared.service.tftpl` already gets most of this from `DynamicUser=yes`; the `Protect*`, `Restrict*`, `LockPersonality`, `CapabilityBoundingSet=`, and `SystemCallFilter` lines apply there too. It needs `AF_INET AF_INET6 AF_UNIX` for the QUIC tunnel.
- **Test on the VM first**, the same way `RUNBOOK.md` updates Nginx in place: edit `/etc/systemd/system/flaskapp.service`, `systemctl daemon-reload && systemctl restart flaskapp`, then `systemd-analyze security flaskapp`, `curl http://127.0.0.1:5000/api/health/`, and a file-share upload and download through the site. Only then commit the same lines to the templates. The templates reach the VM only at provisioning, so the live unit and the template diverge until the next VM replacement; say so in the commit message.
- Docs: the `flaskapp` bullet under *Runtime on the VM* in `DEPLOYMENT.md` lists the sandbox directives.

### Cloudflare zone settings in Terraform

Always Use HTTPS, minimum TLS version, TLS 1.3, edge HSTS, and Bot Fight Mode are dashboard state (if set at all), so a zone rebuild loses them silently. Codify them in `deployment/cloudflare.tf`:

```hcl
resource "cloudflare_zone_settings_override" "website" {
  zone_id = var.cloudflare_zone_id

  settings {
    always_use_https         = "on"
    automatic_https_rewrites = "on"
    min_tls_version          = "1.2"
    tls_1_3                  = "on"
    brotli                   = "on"

    security_header {
      enabled            = true
      max_age            = 31536000
      include_subdomains = true
      preload            = false
    }
  }
}
```

- Check the dashboard values first (SSL/TLS → Edge Certificates, Speed → Optimization) and write the same ones, so the first `apply` changes nothing unintended; `plan` can't show that diff because the resource is new. Bot Fight Mode is a separate resource, `cloudflare_bot_management` with `fight_mode = true`, and is optional.
- The API token needs an extra permission, Zone → Zone Settings → Edit; add it to the token list under *Secrets* in `DEPLOYMENT.md`.
- Keep the Nginx `CF-Visitor` redirect and HSTS header: they're redundant once the edge settings are on, but they still work if the zone settings are ever lost.
- Provider v5 replaces this resource with one `cloudflare_zone_setting` per setting, so either do this as part of the v5 upgrade above or accept rewriting it then.
- Docs: a Zone settings row in the Resources table in `DEPLOYMENT.md`.

### Trim the production venv

`flask-cors` and `python-dotenv` only matter under `FLASK_ENV=development`, yet both ship in every release and get Dependabot PRs against production. `backend/pyproject.toml` also still carries the setuptools `[build-system]` block, although `uv export --no-emit-project` means the package is never built.

- **Drop `python-dotenv`.** `start-dev.sh` already exports every variable, the README shows them inline, and uv can load a file itself: `uv run --env-file .env main.py`. Remove `load_dotenv()` from `backend/main.py`, the dependency from `pyproject.toml`, and the "loads `.env`" mentions in `IMPLEMENTATION.md` (the environment table intro and the `main.py` row), replacing them with the `--env-file` form. The alternative, if the owner wants `.env` to keep working with a bare `uv run main.py`, is to move it to the `dev` group and guard the import with `try: from dotenv import load_dotenv / except ImportError`.
- **Move `flask-cors` to the `dev` group** and import it where it's used, inside the `development` branch of `create_app` in `backend/app/__init__.py` (`from flask_cors import CORS`), so production never imports it. Ruff doesn't flag function-level imports with the current rule set.
- **Stop treating the backend as a package:** delete `[build-system]` and `[tool.setuptools.packages.find]`, and add `[tool.uv]` with `package = false`. Tests then no longer get `app` from an installed package, so add `pythonpath = ["."]` to `[tool.pytest.ini_options]`. `main.py` is unaffected: it's run from `backend/`, which puts the script's directory on `sys.path`.
- Run `uv lock` after each manifest change (never hand-edit `uv.lock`), then `uv run pytest` and the Ruff checks. Confirm the release still builds: `uv export --frozen --no-dev --no-emit-project --format requirements-txt` must list neither package.
