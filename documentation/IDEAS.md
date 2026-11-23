# Ideas

Features and improvements worth building, none of them started. Bugs and tech debt go in [Issues](./ISSUES.md) instead. When an idea ships, delete it here and document the behavior in the relevant doc.

## Content

### Interactive demos in the research write-up

`quantum-scattering-research.md` marks each future demo with a "coming soon" blockquote naming an id (`boundary-conditions`, `tfsf`, `inverse-problem`, `som-vs-fdtd`, `wigner`). Replace those with live demos embedded the same way as `wavepacket-2d` (see [Demos](./IMPLEMENTATION.md#demos)).

- **1D barrier:** a 1D Gaussian wavepacket hitting a potential barrier, drawn on a canvas, with sliders for barrier height/width and packet energy, so tunneling and reflection play out live. The split-step Fourier method is simple and stable (it needs a small FFT, which is easy to write by hand rather than add as a dependency). Crank–Nicolson is the alternative if a tridiagonal solve is easier to reason about.
- Show transmission/reflection probability next to the analytic result, so the demo also checks itself.

### Robotics hardware showcase (maybe)

For the Wisconsin Robotics electrical work: export boards to SVG and show them in a viewer with toggleable layers (copper, silkscreen, etc.). Not decided yet.

## Site-wide

### Prerendering

The build already writes `<route>/index.html` for every route (`plugins/routeHtml.ts`) with that page's head tags, but the body is the same empty shell plus a `<noscript>` link list, so clients that don't run JavaScript see none of a page's own content. Prerendering would render each page to HTML at build time (`render` from `svelte/server`) and write that into the route's file instead. `main.ts` would then switch from `mount` to `hydrate`.

- **Gains:** visitors without JavaScript and simple crawlers see real content; content appears before the JS loads.
- **Costs:** anything that touches `window`, `localStorage`, or `document` while rendering breaks the build (theme handling, About You, the utilities), so it has to move into `onMount` or be guarded. The browser's render has to match the build's HTML or the page flickers. The theme is the main risk: `index.html` hard-codes `data-theme="light"`, so this needs a small inline script that sets the theme before the first paint. The CSP blocks inline scripts, and a blocking external script was already tried and made the flash worse (Issues appendix), so allow the inline one by hash: add its `'sha256-...'` to `script-src` in `nginx.conf.tftpl`, and have the build fail if the script's hash stops matching. Keep the script tiny and stable: the Nginx config ships through Terraform, not with releases, so a new hash needs a [config apply](./RUNBOOK.md#apply-vm-config-changes) alongside the deploy. It's also a second render path, which CI's `pnpm build` now covers.
- **Scope:** start with the static pages (home, about, projects, project detail, contact). Utilities need JS and live data anyway, so they keep the plain shell. Mermaid diagrams stay client-side.

### OG images

Link previews (Discord, Slack, iMessage, LinkedIn) use the page's `og:image`, which is currently the same 512px site icon for every page. Generate a 1200×630 image per project at build time (title + summary in the terminal style) and point each project's `og:image` at it, with a site-wide default for other pages. Turning an SVG template into a PNG needs a renderer, which probably means a build-only dependency (e.g. `@resvg/resvg-js`); the alternative is to make the images by hand once per project.

## Utilities

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

Upgrade `cloudflare/cloudflare` from 4.52 to 5.x. v4 will stop getting updates eventually, and v5 can import Email Routing, which is configured outside Terraform today ([Infrastructure](./INFRASTRUCTURE.md#resources)).

- **Breaking changes:** `cloudflare_record` becomes `cloudflare_dns_record` (`moved` blocks handle state); nested blocks become attributes (tunnel config, ruleset rules, CAA `data`); `cloudflare_managed_headers` becomes `cloudflare_managed_transforms`; the `cloudflare_record` data sources change shape. Cloudflare's `tf-migrate` tool does most of the rewrite.
- **Main risk:** `tunnel_token` moves off the tunnel resource to the `cloudflare_zero_trust_tunnel_cloudflared_token` data source, and it feeds the Secret Manager version the VM reads. `plan` must show no replacement of the tunnel or the VM, or the site goes down until a redeploy.
- **Email Routing:** import `cloudflare_email_routing_settings` and `cloudflare_email_routing_dns` (both by zone ID). The repo is public, so rule destination addresses either go in a tfvars variable or stay in the dashboard.

### Terraform and shell checks in CI

Nothing runs `terraform fmt -check` or `terraform validate`, so a typo in `infrastructure/` surfaces only at `./tf.sh plan` with a live Cloudflare token. Neither needs credentials: `init -backend=false` downloads the providers from `.terraform.lock.hcl` and `validate` never calls an API.

New workflow `.github/workflows/infra.yaml`, triggered on `push` and `pull_request` with `paths: ['infrastructure/**', '*.sh', '.github/workflows/infra.yaml']` and `permissions: contents: read`:

1. `actions/checkout` (same SHA pin and `persist-credentials: false` as `test.yaml`).
2. `hashicorp/setup-terraform`, pinned to a commit SHA, with `terraform_version` matching `versions.tf`.
3. In `infrastructure/`: `terraform fmt -check -recursive -diff` (warn, like the other format checks), then `terraform init -backend=false -input=false` and `terraform validate` (fail: these are build errors, like `pnpm check`).
4. `shellcheck deploy.sh test.sh start-dev.sh format.sh doc-test.sh infrastructure/*.sh infrastructure/test/*.sh` from the repo root (warn). `shellcheck` is preinstalled on `ubuntu-latest`. Fix any findings locally first (`apt install shellcheck`). The `.tftpl` files can't be linted as-is because of the `$${}` template escapes; `infrastructure/test/run.sh` lints their rendered output instead, but rendering needs Terraform state, so CI can't.
5. `infrastructure/test/swap-order.test.sh` and `wait-for-vm.test.sh` need only Terraform and bash, so they can run here too (fail).

### Shielded VM

In `infrastructure/main.tf`, add `secure_boot = true` to `local.vm_spec`, and to `google_compute_instance.default`:

```hcl
shielded_instance_config {
  enable_secure_boot          = local.vm_spec.secure_boot
  enable_vtpm                 = true
  enable_integrity_monitoring = true
}
```

Debian's GCE images are UEFI and support Shielded VM; e2 machines do too. vTPM and integrity monitoring are already GCP's defaults, so the real change is Secure Boot, which refuses unsigned kernel modules (none are used). Changing it in place would need a stop/start; through `vm_spec` it's a zero-downtime [swap](./INFRASTRUCTURE.md#vm-swaps) instead, and a VM that won't boot with it never replaces the old one. `./tf.sh plan` should show a swap.

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
- `vm/cloudflared.service.tftpl` already gets most of this from `DynamicUser=yes`; the `Protect*`, `Restrict*`, `LockPersonality`, `CapabilityBoundingSet=`, and `SystemCallFilter` lines apply there too. It needs `AF_INET AF_INET6 AF_UNIX` for the QUIC tunnel.
- **Test on the VM first:** edit `/etc/systemd/system/flaskapp.service`, `systemctl daemon-reload && systemctl restart flaskapp`, then `systemd-analyze security flaskapp`, `curl http://127.0.0.1:5000/api/health/`, and a file-share upload and download through the site. Only then commit the same lines to the templates and [apply them](./RUNBOOK.md#apply-vm-config-changes), which overwrites the hand edit.

### Cloudflare zone settings in Terraform

Always Use HTTPS, minimum TLS version, TLS 1.3, edge HSTS, and Bot Fight Mode are dashboard state (if set at all), so a zone rebuild loses them silently. Codify them in `infrastructure/cloudflare.tf`:

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
- The API token needs an extra permission, Zone → Zone Settings → Edit.
- Keep the Nginx `CF-Visitor` redirect and HSTS header: they're redundant once the edge settings are on, but they still work if the zone settings are ever lost.
- Provider v5 replaces this resource with one `cloudflare_zone_setting` per setting, so either do this as part of the v5 upgrade above or accept rewriting it then.

### Edge cache for JSON assets

Cloudflare doesn't cache `.json` by default, so each browser's first scheduler visit fetches the catalog (`assets/course_data-<hash>.json`, ~250 KB precompressed) through the tunnel. A Cache Rule for `/assets/*` (a `cloudflare_ruleset` with phase `http_request_cache_settings`; the API token needs Zone → Cache Rules → Edit) would let the edge serve it. The gain is small, so do it with the provider v5 upgrade, which changes ruleset syntax anyway.

### Edge rate limit for uploads

Cloudflare's free plan includes one rate-limiting rule. Pointing it at `/api/fileshare/upload/` (a few requests per IP per 10 s) would drop upload floods at the edge, before they cross the tunnel. It complements Nginx's per-visitor and total caps on concurrent uploads (`limit_conn`), since the edge counts requests, not concurrent ones.

- In Terraform it's a `cloudflare_ruleset` with phase `http_ratelimit`; like `www_redirect`, a zone gets one ruleset per phase. Check the free plan's limits first (it counts by IP only, with short fixed periods and block times) and pick values that fit.
- The API token needs permission to edit the zone's WAF rules.
- Provider v5 changes ruleset syntax (nested blocks become attributes), so either write it during the v5 upgrade or accept rewriting it then.
