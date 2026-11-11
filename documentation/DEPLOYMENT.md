# Deployment

Provisioning and releases are separate. **Terraform** (`deployment/`) provisions the infrastructure and the VM, rarely. **GitHub Actions** ships releases: `deploy.yaml` runs only by hand on `main`, so pushes and merges never deploy.

Always run Terraform through `./tf.sh` from `deployment/`; it fetches the Cloudflare API token first ([Secrets](#secrets)). Inputs and their defaults are in `variables.tf`; versions are in `versions.tf`.

> **After any apply that creates or replaces `flask-vm`, run *Deploy* on `main`.** A new VM has no release, so the site shows a 404, Cloudflare 1033, or 502 until a deploy lands. Wait a few minutes for the startup script to finish first, or the deploy fails (just rerun it).

## Resources

| Area | Resources |
| --- | --- |
| Network | VPC `my-custom-mode-network`, subnet `my-custom-subnet` (`10.0.1.0/24`) |
| Compute | `flask-vm`: e2-micro, Debian 12, service account `flask-vm-runtime`, OS Login, startup script from `startup.sh.tftpl` |
| Firewall | `allow-iap-ssh`: port 22 from IAP (`35.235.240.0/20`) only. No inbound web ports; the external IP is outbound-only. |
| Cloudflare | Tunnel `personal-website` routing `${domain}` to `http://localhost:80`; proxied `@` CNAME to the tunnel; "Add visitor location headers" Managed Transform (used by About You) |
| DNS | DNSSEC; CAA allowing only `pki.goog`, `letsencrypt.org`, `ssl.com`; `status` CNAME to Better Stack (must stay **DNS only**); Google site-verification TXT; `_dmarc` TXT (`p=reject`, reports to Cloudflare DMARC Management) |
| Secret Manager | `cloudflare-tunnel-token`; VM accessor IAM on it and on `flask-secret` |
| GitHub deploys (`github_deploy.tf`) | Workload Identity pool + provider (accepts only `${github_repository}`, `refs/heads/main`, environment `production`); service account `github-deployer` with IAP tunnel access, non-admin OS Login on the VM, `serviceAccountUser` on `flask-vm-runtime`, and project `compute.viewer` |

Outputs `github_wif_provider` and `github_deployer_email` are the values for the GitHub repository variables `GCP_WIF_PROVIDER` and `GCP_DEPLOYER_SA`.

The `_dmarc` record comes from enabling DMARC Management (Email → DMARC Management); Terraform reads its `rua` address and sets the policy. The site-verification TXT and `_dmarc` must exist before `plan`, since Terraform looks them up.

Not in Terraform: Cloudflare Email Routing (inbound forwarding only), which owns and locks the MX, SPF, and `cf2024-1._domainkey` records. Provider v4 can't import its settings (see [Ideas](./IDEAS.md#cloudflare-provider-v5)). If the zone is rebuilt, re-enable it and recreate the routing rules in the dashboard.

## Secrets

| Secret | Created by | Used by |
| --- | --- | --- |
| `flask-secret` | manually | VM → `SECRET_KEY` in `/etc/personalwebsite/secrets.env` (mode 640, `root:flaskapp`) |
| `cloudflare-tunnel-token` | Terraform (write-only, so not in state) | VM → `TUNNEL_TOKEN` in `/etc/cloudflared/tunnel.env` (mode 600) |
| `cloudflare-api-token` | manually | `tf.sh` → `CLOUDFLARE_API_TOKEN` for the Cloudflare provider |

- The VM reads secrets on every boot and restarts a service only if its secret changed. To rotate, update the secret in Secret Manager and reboot the VM.
- `flask-secret` is also the file-share label pepper, so rotating it orphans current file-share files (they expire within 10 minutes anyway).
- GitHub Actions holds no deploy credentials: it authenticates through Workload Identity Federation, and its two repository variables are identifiers. (`CODECOV_TOKEN` is the only Actions secret.)
- **`tf.sh` token lookup:** secret `GSM_CLOUDFLARE_TOKEN_SECRET` (default `cloudflare-api-token`), version `GSM_CLOUDFLARE_TOKEN_VERSION` (default `latest`), project `GSM_CLOUDFLARE_TOKEN_PROJECT`, then `TF_VAR_project_id`, then the `gcloud` default. Needs an authenticated `gcloud` with `secretmanager.secretAccessor` on the secret.
- The Cloudflare API token needs Zone → DNS → Edit, Account → Cloudflare Tunnel → Edit, Zone → Managed headers → Edit, and Account → Account Rulesets → Read. A 403 on one resource during `apply` usually means one is missing.

## VM Bootstrap

`startup.sh.tftpl` runs as root on every boot (logged to `/var/log/startup-script.log`). On the first boot only, it:

1. Installs Python 3.11, Nginx, curl, and `cloudflared` (with raised UDP buffers for QUIC).
2. Configures `unattended-upgrades` (`/etc/apt/apt.conf.d/52personalwebsite`) to also install Debian point releases and `cloudflared`, and to reboot at 09:00 UTC when an update needs it.
3. Creates the `flaskapp` user, root-owned `/opt/personalwebsite/releases` (`app_path`), and `/var/lib/personalwebsite` (`data_path`; `flaskapp`, mode 700).
4. Installs `deploy.sh.tftpl` as `/usr/local/sbin/personalwebsite-deploy`, plus a sudoers rule letting the `github-deployer` OS Login user run that script, and nothing else, as root.
5. Installs and enables the Nginx config and the `flaskapp` and `cloudflared` units, then writes `/var/lib/personalwebsite/.provisioned`.

On every boot it refreshes secrets from Secret Manager. `flaskapp.service` stays idle until a release exists (`ConditionPathExists`).

Changing `startup.sh.tftpl`, `deploy.sh.tftpl`, or the unit/Nginx templates changes the startup script metadata, which forces Terraform to **replace the VM**.

## Runtime on the VM

- **`cloudflared`** (systemd, `DynamicUser`, `--no-autoupdate`; updated by `unattended-upgrades` instead, and `cloudflared-restart.path` restarts it when the binary changes) holds the tunnel and forwards to Nginx.
- **Nginx** listens only on `127.0.0.1:80` (Cloudflare terminates TLS; no origin certificate). It serves `current/frontend/dist` and proxies `/api/` to `127.0.0.1:5000` (`backend_port`).
  - Trailing-slash paths get a `301` to the path without the slash.
  - No SPA fallback: the build writes `<route>/index.html` for every route, so other paths return a real `404` whose body is the SPA shell, and the app renders its not-found page.
  - HTML is `Cache-Control: no-cache`; hashed `/assets/` are cached for a year and return a plain `404` when missing.
  - gzip for HTML, JSON, CSS, JS, and SVG, including API responses (the course catalog is ~3 MB raw).
  - Rate limit 10 req/s per `CF-Connecting-IP`, burst 10. Body limit 1 MB, except 81 MiB on `/api/fileshare/upload/`.
  - Security headers: HSTS (with `includeSubDomains`, so every subdomain, `status` included, must serve HTTPS), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a **report-only** CSP. To enforce it, browse each page with the console open, fix or allow what it reports, then rename the header to `Content-Security-Policy` in `nginx.conf.tftpl`. Cloudflare features that inject scripts (Web Analytics, Rocket Loader, Zaraz) would need their domains allowed.
- `/.well-known/security.txt` is built from `frontend/site-files/security.txt` (see [Implementation](./IMPLEMENTATION.md)). Its `Expires` date must stay under a year out, so bump it yearly (next: before 2027-11-10).
- **`flaskapp`** (systemd, `FLASK_ENV=production`, `PORT=backend_port`) runs Waitress on `127.0.0.1:5000`, sandboxed (`ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `NoNewPrivileges`) with write access only to `/var/lib/personalwebsite`. File-share data lives in `/var/lib/personalwebsite/fileshare/` and survives reboots and deploys.

### Releases

```
/opt/personalwebsite/
├── current -> releases/<commit sha>
└── releases/<commit sha>/          root-owned, read-only to flaskapp; newest 5 kept
    ├── .complete                   written once the release built successfully
    ├── backend/{main.py,app/,requirements.txt,.venv/}
    └── frontend/dist/
```

`personalwebsite-deploy <sha> <sha256> < release.tar.gz` verifies the checksum, extracts the release, installs hash-pinned wheels (`pip install --require-hashes --only-binary :all:`), swaps `current` atomically, restarts `flaskapp`, and polls `/api/health/` and Nginx for ~30 s. If the check fails, it switches back to the previous release and exits 1. A release already on the VM is reactivated without rebuilding.

## Deploying Changes

Only the release tarball (backend app code and `frontend/dist`) ships on deploy. Everything else under `deployment/` reaches the VM only at provisioning.

| Change | How |
| --- | --- |
| App code or project content | Push to `main`, check that *Test* passed, then `./deploy.sh` (needs `gh`; refuses unless local `main` matches `origin/main`, follows the run, exits non-zero on failure). Also retries a failed deploy. |
| Docs only (`documentation/**`, any `README.md`) | Push. *Test* is skipped. |
| Terraform config | `./tf.sh plan`, then `./tf.sh apply`. If `flask-vm` is replaced, deploy afterwards. |
| VM provisioning (startup script, units, Nginx, deploy script) | `./tf.sh apply` replaces the VM; deploy afterwards. |
| Nginx config without downtime | Edit `nginx.conf.tftpl`, then [update it in place](./RUNBOOK.md#update-the-nginx-config-in-place). |
| Roll back | [Runbook](./RUNBOOK.md#roll-back-a-release). |

### Pipeline

Both workflows set up uv, pnpm, and Node through `.github/actions/setup`, and all actions are pinned to commit SHAs.

- ***Test*** (`test.yaml`, on PRs and non-docs pushes to `main`): backend `ruff` + `pytest --cov=app`; frontend `lint`, `format:check`, `check`, `test`.
- ***Deploy*** (`deploy.yaml`, manual, `main` only; doesn't rerun tests):
  1. **package:** build the frontend with `VITE_BACKEND_URL=https://josephcicalese.com`, export hash-pinned requirements (`uv export --frozen --no-dev`), and upload the tarball as artifact `release-<sha>`.
  2. **deploy** (environment `production`, serialized): authenticate through WIF, stream the tarball over `gcloud compute ssh --tunnel-through-iap` into `sudo personalwebsite-deploy`, then `curl` the public `/api/health/`, the home page, and its entry script.

### First-time setup

1. `./tf.sh apply`.
2. In GitHub → Settings → Environments, create `production` (no required reviewers).
3. In GitHub → Settings → Variables → Actions, set `GCP_WIF_PROVIDER` and `GCP_DEPLOYER_SA` from the Terraform outputs.
4. Run *Deploy* on `main`.
