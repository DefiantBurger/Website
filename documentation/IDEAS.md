# Ideas

Features and improvements worth building, none of them started. Bugs and tech debt go in [Issues](./ISSUES.md) instead. When an idea ships, delete it here and document the behavior in the relevant doc.

## Content

### Interactive demos in the research write-up

`quantum-scattering-research.md` marks each future demo with a "coming soon" blockquote naming an id (`boundary-conditions`, `tfsf`, `inverse-problem`, `som-vs-fdtd`, `wigner`). Replace those with live demos embedded the same way as `wavepacket-2d` (see [Implementation](./IMPLEMENTATION.md)).

- **1D barrier:** a 1D Gaussian wavepacket hitting a potential barrier, drawn on a canvas, with sliders for barrier height/width and packet energy, so tunneling and reflection play out live. The split-step Fourier method is simple and stable (it needs a small FFT, which is easy to write by hand rather than add as a dependency). Crank–Nicolson is the alternative if a tridiagonal solve is easier to reason about.
- Show transmission/reflection probability next to the analytic result, so the demo also checks itself.

### Robotics hardware showcase (maybe)

For the Wisconsin Robotics electrical work: export boards to SVG and show them in a viewer with toggleable layers (copper, silkscreen, etc.). Not decided yet.

## Site-wide

### Prerendering

The build already writes `<route>/index.html` for every route (`plugins/routeHtml.ts`) with that page's head tags, but the body is the same empty shell plus a `<noscript>` link list, so clients that don't run JavaScript see none of a page's own content. Prerendering would render each page to HTML at build time (`render` from `svelte/server`) and write that into the route's file instead. `main.ts` would then switch from `mount` to `hydrate`.

- **Gains:** visitors without JavaScript and simple crawlers see real content; content appears before the JS loads.
- **Costs:** anything that touches `window`, `localStorage`, or `document` while rendering breaks the build (theme handling, About You, the utilities), so it has to move into `onMount` or be guarded. The browser's render has to match the build's HTML or the page flickers. The theme is the main risk: `index.html` hard-codes `data-theme="light"`, so this needs a small inline script that sets the theme before the first paint. The CSP blocks inline scripts, and a blocking external script was already tried and made the flash worse (Issues appendix), so allow the inline one by hash: add its `'sha256-...'` to `script-src` in `nginx.conf.tftpl`, and have the build fail if the script's hash stops matching. Keep the script tiny and stable, since the Nginx config only reaches the VM through an in-place update or a VM replacement. It's also a second render path, which CI's `pnpm build` now covers.
- **Scope:** start with the static pages (home, about, projects, project detail, contact). Utilities need JS and live data anyway, so they keep the plain shell. Mermaid diagrams stay client-side.

### OG images

Link previews (Discord, Slack, iMessage, LinkedIn) use the page's `og:image`, which is currently the same 512px site icon for every page. Generate a 1200×630 image per project at build time (title + summary in the terminal style) and point each project's `og:image` at it, with a site-wide default for other pages. Turning an SVG template into a PNG needs a renderer, which probably means a build-only dependency (e.g. `@resvg/resvg-js`); the alternative is to make the images by hand once per project.

## Utilities

### Scheduler: catalog as a static asset

The 3 MB course catalog goes through Flask (`/api/scheduler/course-data/`) and is gzipped again by Nginx on every scheduler visit, and browsers revalidate it every time (Flask sends `no-cache` with an ETag). It changes only with a deploy, so it can be a build asset:

- Import it with Vite's `?url` suffix, so the build emits `assets/course_data-<hash>.json`, which Nginx serves from `/assets/` with `expires max`. A plain JSON import would inline 3 MB into a JS chunk. `my_courses.json` (1 KB) can be a plain import.
- Precompress it at build time (a `.gz` next to it, written by a small plugin with `node:zlib`, no dependency) and turn on `gzip_static` in Nginx, so the VM never compresses it per request. The Nginx change reaches the VM only through an in-place update or a replacement.
- Cloudflare doesn't cache `.json` by default; a Cache Rule for `/assets/*` would let the edge serve it.
- The scheduler then needs nothing from the backend. Remove both routes, their tests, and `backend/app/static/json/`. Update the API tables in IMPLEMENTATION.md and UTILITIES.md, UTILITIES.md's catalog update steps (the `cp` target), and the `course_data.json` rule in CLAUDE.md.

### File Share: upload progress

Show a progress bar while uploading. `fetch` can't report upload progress, so this needs `XMLHttpRequest` (`upload.onprogress`). Uploads currently have no timeout (`timeoutMs: null`) because a large upload can legitimately take minutes; with progress events, a stall timeout (no bytes sent for ~30 s) could replace that.

### File Share: encryption in the browser and QR codes

**Encrypt in the browser** so the server only ever stores ciphertext and can't read uploaded files.

- **Why:** today's encryption at rest only protects against a leak of the disk alone. The server sees every access key in its requests, and anyone with `SECRET_KEY` can test key guesses against the labels at HMAC speed, skipping scrypt. So tuning scrypt's cost isn't worth it; this is the real fix.
- Today the server uses the access key both to find a batch (HMAC label) and to encrypt it. With browser encryption, the browser derives two separate values from the access key (e.g. HKDF): a lookup token sent to the server, and an AES-GCM key that never leaves the browser. Otherwise the server still sees what it needs to decrypt.
- Reuse the server's chunk format (1 MiB chunks, nonce = chunk index + last-chunk flag; see [Utilities](./UTILITIES.md#file-share)) so large files never need to fit in memory.
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

### Terraform and shell checks in CI

Nothing runs `terraform fmt -check` or `terraform validate`, so a typo in `deployment/` surfaces only at `./tf.sh plan` with a live Cloudflare token. Neither needs credentials: `init -backend=false` downloads the providers from `.terraform.lock.hcl` and `validate` never calls an API.

New workflow `.github/workflows/infra.yaml`, triggered on `push` and `pull_request` with `paths: ['deployment/**', '*.sh', '.github/workflows/infra.yaml']` and `permissions: contents: read`:

1. `actions/checkout` (same SHA pin and `persist-credentials: false` as `test.yaml`).
2. `hashicorp/setup-terraform`, pinned to a commit SHA, with `terraform_version` matching `versions.tf`.
3. In `deployment/`: `terraform fmt -check -recursive -diff` (warn, like the other format checks), then `terraform init -backend=false -input=false` and `terraform validate` (fail: these are build errors, like `pnpm check`).
4. `shellcheck deploy.sh test.sh start-dev.sh format.sh deployment/tf.sh` from the repo root (warn). `shellcheck` is preinstalled on `ubuntu-latest`. Fix any findings locally first (`apt install shellcheck`). The `.tftpl` files can't be linted as-is because of the `$${}` template escapes; leave them out.

Docs: add the workflow to the *Pipeline* list in `DEPLOYMENT.md` and the workflows bullet in `ARCHITECTURE.md`.

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

`flask-cors` and `python-dotenv` only matter under `FLASK_ENV=development`, yet both ship in every release. `backend/pyproject.toml` also still carries the setuptools `[build-system]` block, although `uv export --no-emit-project` means the package is never built.

- **Drop `python-dotenv`.** `start-dev.sh` already exports every variable, the README shows them inline, and uv can load a file itself: `uv run --env-file .env main.py`. Remove `load_dotenv()` from `backend/main.py`, the dependency from `pyproject.toml`, and the "loads `.env`" mentions in `IMPLEMENTATION.md` (the environment table intro and the `main.py` row), replacing them with the `--env-file` form. The alternative, if the owner wants `.env` to keep working with a bare `uv run main.py`, is to move it to the `dev` group and guard the import with `try: from dotenv import load_dotenv / except ImportError`.
- **Move `flask-cors` to the `dev` group** and import it where it's used, inside the `development` branch of `create_app` in `backend/app/__init__.py` (`from flask_cors import CORS`), so production never imports it. Ruff doesn't flag function-level imports with the current rule set.
- **Stop treating the backend as a package:** delete `[build-system]` and `[tool.setuptools.packages.find]`, and add `[tool.uv]` with `package = false`. Tests then no longer get `app` from an installed package, so add `pythonpath = ["."]` to `[tool.pytest.ini_options]`. `main.py` is unaffected: it's run from `backend/`, which puts the script's directory on `sys.path`.
- Run `uv lock` after each manifest change (never hand-edit `uv.lock`), then `uv run pytest` and the Ruff checks. Confirm the release still builds: `uv export --frozen --no-dev --no-emit-project --format requirements-txt` must list neither package.

### Config changes without replacing the VM

The startup script writes the Nginx config, systemd units, and deploy script only on first boot. It's set through `metadata_startup_script`, which forces a new VM whenever it changes. So each config change means either a VM replacement or a hand-applied update like the runbook's Nginx one, and the live VM drifts from the templates in between. The `startup-script` key in `metadata` can be updated in place instead.

- Move the script to `metadata = { startup-script = templatefile(...) }`, next to the existing metadata keys.
- Have it rewrite the templated files on every boot, not just the first:
  - Nginx: keep the old config, restore it if `nginx -t` fails, otherwise reload.
  - Units: `daemon-reload` and `try-restart` only when a file changed, the way `install_secret_file` handles secrets.
  - The deploy script and sudoers rule: rewrite them (sudoers still through `visudo -cf`).
  - Package installs and user creation stay first-boot only.
- A config change then becomes `./tf.sh apply` plus a reboot, or `sudo google_metadata_script_runner startup` over SSH. `plan` should show an in-place update of `flask-vm`; if it shows a replacement, stop and ask. This is also how the fixes for the deploy script, metadata access, and upload limits in [Issues](./ISSUES.md#infrastructure) would reach the VM.
- Switching from `metadata_startup_script` to the key replaces the VM once. Do it alongside the next [kernel update](./DEPLOYMENT.md#kernel-updates), which replaces it anyway.
- Don't ship these configs in the release tarball instead. Nginx's `load_module`, or any systemd unit, would let whoever can deploy run code as root, which is the boundary the deploy script exists to keep.
- Docs: DEPLOYMENT.md (*VM Bootstrap*, the *Deploying Changes* table, and the line saying template changes replace the VM), RUNBOOK.md (the in-place Nginx update becomes a fallback), and the "templates reach the VM only at provisioning" note in *Tighter systemd sandboxing* above.

### Edge rate limit for uploads

Cloudflare's free plan includes one rate-limiting rule. Pointing it at `/api/fileshare/upload/` (a few requests per IP per 10 s) would drop upload floods at the edge, before they cross the tunnel and fill Nginx's buffers (the disk-fill entry in [Issues](./ISSUES.md#infrastructure)). Nginx's `limit_conn` is still needed, since the edge counts requests, not concurrent ones.

- In Terraform it's a `cloudflare_ruleset` with phase `http_ratelimit`; like `www_redirect`, a zone gets one ruleset per phase. Check the free plan's limits first (it counts by IP only, with short fixed periods and block times) and pick values that fit.
- The API token needs permission to edit the zone's WAF rules; add it to the token list under *Secrets* in DEPLOYMENT.md.
- Provider v5 changes ruleset syntax (nested blocks become attributes), so either write it during the v5 upgrade or accept rewriting it then.
- Docs: a row in the Resources table in DEPLOYMENT.md.
