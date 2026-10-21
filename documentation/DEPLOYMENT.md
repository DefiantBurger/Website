# Deployment

Terraform in `deployment/` provisions everything. Always run it through `./tf.sh`, which fetches the Cloudflare API token first (see [Secrets](#secrets)).

```bash
cd deployment
./tf.sh init
./tf.sh plan
./tf.sh apply
```

Versions (`versions.tf`): Terraform `>= 1.12.2, < 2.0.0`; providers `hashicorp/google` and `google-beta` `~> 7.27.0`, `cloudflare/cloudflare` `~> 4.52.7`, `hashicorp/random` `~> 3.7`.

## Resources

| Area | Resources |
| --- | --- |
| Network | VPC `my-custom-mode-network`, subnet `my-custom-subnet` (`10.0.1.0/24`) |
| Compute | `flask-vm`: e2-micro, Debian 12, runtime service account `flask-vm-runtime`, startup script from `startup.sh.tftpl` |
| Firewall | `allow-iap-ssh`: port 22 from IAP (`35.235.240.0/20`) only. No inbound web ports; the external IP is for outbound traffic only. |
| Cloudflare | Remotely managed tunnel `personal-website` routing `${domain}` to `http://localhost:80`; proxied `@` CNAME to the tunnel; "Add visitor location headers" Managed Transform (used by About You) |
| Secret Manager | `cloudflare-tunnel-token` secret + version; accessor IAM for the VM on it and on `flask-secret` |

Because the VM only dials out to Cloudflare, the origin can't be reached directly or through another Cloudflare account; every request passes through this zone's WAF and rate-limit rules.

### Variables

All have defaults in `variables.tf`:

| Variable | Default |
| --- | --- |
| `domain` | `josephcicalese.com` |
| `app_path` | `/opt/personalwebsite` |
| `repo_url`, `repo_branch` | `https://github.com/DefiantBurger/Website`, `main` |
| `project_id`, `project_region`, `project_zone` | `personal-website-453120`, `us-central1`, `us-central1-a` |
| `cloudflare_zone_id`, `cloudflare_account_id` | identifiers, not secrets |
| `secret_name_flask`, `secret_version_flask` | `flask-secret`, `latest` |
| `secret_name_cloudflare_tunnel_token` | `cloudflare-tunnel-token` |

## Secrets

| Secret | Created by | Used by |
| --- | --- | --- |
| `flask-secret` | manually | VM → `SECRET_KEY` in `/etc/personalwebsite/secrets.env` (mode 640, `root:flaskapp`) |
| `cloudflare-tunnel-token` | Terraform (write-only, so not duplicated in state) | VM → `TUNNEL_TOKEN` in `/etc/cloudflared/tunnel.env` (mode 600) |
| `cloudflare-api-token` | manually | `tf.sh` → `CLOUDFLARE_API_TOKEN` for the Cloudflare provider |

The VM reads secrets at boot with its service account; no secret values pass through Terraform templates.

`flask-secret` is also the pepper for file-share labels, so rotating it makes any current file-share files unreachable (they expire within 10 minutes anyway).

**`tf.sh` token lookup.** Secret `GSM_CLOUDFLARE_TOKEN_SECRET` (default `cloudflare-api-token`), version `GSM_CLOUDFLARE_TOKEN_VERSION` (default `latest`), project `GSM_CLOUDFLARE_TOKEN_PROJECT`, falling back to `TF_VAR_project_id` and then the `gcloud` default project. You need `gcloud` installed and authenticated, with `roles/secretmanager.secretAccessor` on the secret.

The Cloudflare API token needs these permissions (a 403 on one resource during `apply` usually means one is missing):

- Zone → DNS → Edit
- Account → Cloudflare Tunnel → Edit
- Zone → Managed headers → Edit, and Account → Account Rulesets → Read

## VM Bootstrap

`startup.sh.tftpl` runs as root on **every** boot (logged to `/var/log/startup-script.log` and the serial console):

1. Remove `man-db`, `apt-get update`, install build tools, Python 3.11, git, Nginx, curl.
2. Install Node 22 (NodeSource) and activate `pnpm@latest-10` via Corepack.
3. Delete `app_path` and clone `repo_branch` of `repo_url` into it.
4. Create `backend/.venv` and `pip install .`.
5. `pnpm install --frozen-lockfile` and `pnpm build` with `VITE_BACKEND_URL=https://<domain>`.
6. Create the `flaskapp` system user and give it ownership of `backend/`.
7. Fetch `SECRET_KEY` from Secret Manager; install and start `flaskapp.service`.
8. Install the Nginx config and restart Nginx.
9. Install `cloudflared` from Cloudflare's apt repo, fetch the tunnel token, raise UDP buffer limits for QUIC (`/etc/sysctl.d/99-cloudflared.conf`), and start `cloudflared.service`.

## Runtime on the VM

- **`cloudflared`** (systemd, `DynamicUser`, `--no-autoupdate`; update with `apt-get upgrade cloudflared`) holds the tunnel open and forwards to Nginx.
- **Nginx** listens only on `127.0.0.1:80`. Cloudflare terminates visitor TLS and the tunnel encrypts the hop to the VM, so there is no origin certificate. It serves `frontend/dist` (SPA fallback to `index.html`) and proxies `/api/` to `127.0.0.1:5000`.
  - Redirects plain-HTTP visitors (detected from `CF-Visitor`) to HTTPS.
  - Rate limit: 10 req/s per `CF-Connecting-IP`, burst 10 (no delay on `/api/fileshare/`).
  - Body limit: 1 MB, except 100 MB on `/api/fileshare/upload/`.
  - Headers: HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a **report-only** CSP. To enforce the CSP, browse each page with the console open, fix or allow anything it reports, then rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `nginx.conf.tftpl`. Cloudflare features that inject scripts (Web Analytics, Rocket Loader, Zaraz) would need their domains allowed.
- **`flaskapp`** (systemd, user `flaskapp`, `FLASK_ENV=production`) runs `backend/main.py` under Waitress on `127.0.0.1:5000`.
- **File-share data** lives in `${app_path}/backend/instance/fileshare/`, so it is erased on every boot when the startup script deletes `app_path`.

## Deploying Changes

| Change | Command (from `deployment/`) |
| --- | --- |
| Terraform config | `./tf.sh plan` then `./tf.sh apply` |
| App code, full re-provision | `./tf.sh apply -replace=google_compute_instance.default` |
| App code, keep the VM | Reboot it (`sudo reboot` over IAP SSH); the startup script re-clones and rebuilds. |

Push the commits first; the VM always deploys the tip of `repo_branch`. During either code deploy the site shows Cloudflare error 1033 until the startup script finishes and `cloudflared` reconnects. The VM's external IP may change on replacement; DNS doesn't depend on it.

Afterwards, run the [health checks](./RUNBOOK.md#verify-service-health).

For a quick hot fix without a reboot (the next boot overwrites it), on the VM:

```bash
cd /opt/personalwebsite && sudo git pull
sudo backend/.venv/bin/pip install ./backend                 # if dependencies changed
(cd frontend && sudo VITE_BACKEND_URL=https://josephcicalese.com pnpm build)   # if frontend changed
sudo systemctl restart flaskapp
```

## Known Issue: Boot-Time Deployment

**Status:** open. Planned fix: deploy through GitHub Actions.

### Problems

1. **Every boot redeploys.** GCE runs `metadata_startup_script` at every boot, so any reboot (including host maintenance and crash restarts) deletes `app_path` and re-clones the tip of `repo_branch`. An unplanned reboot can ship untested code, and anyone who compromises the GitHub repo gets code running on the VM at the next reboot.
2. **Everything runs as root**, including the clone, `pip install .`, `pnpm install` (with package install scripts), and `curl https://deb.nodesource.com/setup_22.x | bash`.
3. **Backend dependencies aren't locked in production.** `pip install .` resolves the `>=` ranges in `pyproject.toml` and ignores `uv.lock`. (The frontend uses `--frozen-lockfile`.)
4. **The app user owns its code.** `chown -R flaskapp ${app_path}/backend` lets a compromised Flask process rewrite its own code.
5. **Builds happen on the 1 GB production VM**, which needs a full Node toolchain, boots slowly, and installs an unpinned `pnpm@latest-10`.
6. **Nothing runs tests before deploy.** `.github/workflows/deploy.yaml` is an incomplete, uncommitted stub.

### Proposed Fix

Separate provisioning the machine (rare, Terraform) from deploying a release (every push, GitHub Actions).

1. **Provision once.** Trim the startup script to OS packages, users, Nginx, `cloudflared`, systemd units, and secrets, guarded by a marker file (e.g. `/var/lib/personalwebsite/provisioned`) so later boots only start services.
2. **Test and build in CI** on push to `main`: a `test` job (`uv sync --frozen` + `pytest`; `pnpm install --frozen-lockfile` + `pnpm check`) and a `package` job that bundles `frontend/dist`, the backend source, and `uv.lock` into a tarball named after the commit SHA.
3. **Deploy from CI.** Authenticate with Workload Identity Federation (`google-github-actions/auth`; no stored JSON key). Copy the tarball with `gcloud compute scp --tunnel-through-iap`, which needs `roles/iap.tunnelResourceAccessor` and OS Login (alternative: have the VM pull a pinned version from GCS). A root-owned `deploy.sh` on the VM extracts to `/opt/personalwebsite/releases/<sha>`, runs `uv sync --frozen --no-dev`, repoints the `/opt/personalwebsite/current` symlink, and restarts `flaskapp`; rollback is repointing the symlink. Optionally gate with a GitHub `production` environment requiring approval.
4. **Fix ownership.** Make releases root-owned and read-only to `flaskapp`. Move runtime data to `/var/lib/personalwebsite` (the only path `flaskapp` can write) and add systemd hardening (`ProtectSystem=strict`, `ReadWritePaths=/var/lib/personalwebsite`, `NoNewPrivileges=yes`).
5. **Tighten the supply chain.** With the frontend built in CI, the VM no longer needs Node, which removes `curl | bash`. Pin GitHub Actions to commit SHAs and pnpm via `packageManager` in `frontend/package.json`.
