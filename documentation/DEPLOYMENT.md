# Deployment

## Infrastructure Stack

- Terraform
- Google Cloud Platform (Compute Engine + networking)
- Cloudflare DNS, proxy, and Tunnel (`cloudflared`)
- Nginx reverse proxy
- systemd-managed Flask service

Terraform configuration is in `deployment/`.

## Providers and Versions

From `deployment/versions.tf`:

- Terraform: `>= 1.12.2, < 2.0.0`
- `hashicorp/google` `~> 7.27.0`
- `hashicorp/google-beta` `~> 7.27.0`
- `cloudflare/cloudflare` `~> 4.52.7`
- `hashicorp/random` `~> 3.7` (tunnel secret)

## Provisioned Resources

### GCP Network

- custom VPC: `my-custom-mode-network`
- custom subnet: `10.0.1.0/24`

### GCP VM

- instance: `flask-vm`
- machine type: `e2-micro`
- image: Debian 12
- startup script bootstraps backend/frontend/Nginx/systemd

### Firewall Rules

- SSH via IAP only (`35.235.240.0/20` to port 22)
- no inbound web ports: the VM's external IP is used for outbound traffic only

### Cloudflare

- Cloudflare Tunnel `personal-website` (remotely managed), routing `${domain}` to `http://localhost:80` on the VM
- proxied CNAME for root domain (`@`) to the tunnel's `<id>.cfargotunnel.com` address
- Managed Transform "Add visitor location headers" enabled (used by the About You page)

Because the VM only makes an outbound connection to Cloudflare, the origin can't be
reached directly or through another Cloudflare account. Only requests that pass through
this zone (and its WAF and rate-limit rules) get in.

## Secrets

Provisioning no longer injects plaintext secret values through Terraform templates.
The VM fetches secret values from Google Secret Manager at startup using its runtime service account and least-privilege IAM.

Secret names/versions configured in Terraform variables:

- `flask-secret` (created manually)
- `cloudflare-tunnel-token` (created by Terraform from the tunnel; written write-only so it isn't duplicated in state)

`flask-secret` is also the pepper for file-share labels, so rotating it makes any
files currently in the file share unreachable (they expire within 10 minutes anyway).

Cloudflare configuration:

- `cloudflare_zone_id` and `cloudflare_account_id` are Terraform variables with defaults in
  `deployment/variables.tf`. Both are identifiers, not secrets.
- `deployment/tf.sh` fetches `CLOUDFLARE_API_TOKEN` directly from Google Secret Manager using `gcloud`.

The Cloudflare API token stored in `cloudflare-api-token` needs these permissions:

- Zone → DNS → Edit (DNS record)
- Account → Cloudflare Tunnel → Edit (tunnel and its config)
- Zone → Managed headers → Edit, plus Account → Account Rulesets → Read (visitor location headers)

If `apply` fails with a 403 on one resource, check the matching permission above.

### Cloudflare Token Lookup

`deployment/tf.sh` now always retrieves the Cloudflare API token from Secret Manager before invoking Terraform.

Lookup defaults:

- secret name: `cloudflare-api-token`
- secret version: `latest`
- project resolution order:
  1. `GSM_CLOUDFLARE_TOKEN_PROJECT`
  2. `TF_VAR_project_id`
  3. `gcloud` default project

Optional overrides:

- `GSM_CLOUDFLARE_TOKEN_SECRET`
- `GSM_CLOUDFLARE_TOKEN_VERSION`
- `GSM_CLOUDFLARE_TOKEN_PROJECT`

Prerequisites:

1. `gcloud` is installed.
2. You are authenticated (`gcloud auth login` or workload identity/ADC).
3. Your identity has `roles/secretmanager.secretAccessor` for the token secret.

## Startup Bootstrap Flow

`deployment/startup.sh.tftpl` performs:

1. apt prep and package installs,
2. Python 3.11 installation,
3. Node 22 installation + pnpm activation,
4. repository clone from configured branch,
5. backend virtualenv setup and package install,
6. frontend install + production build (`VITE_BACKEND_URL=https://<domain>`),
7. system user creation,
8. systemd unit install/start,
9. Nginx config install/restart,
10. `cloudflared` install (Cloudflare apt repo), tunnel token fetch to `/etc/cloudflared/tunnel.env` (mode 600), and `cloudflared` service start.

## Runtime Topology on VM

- `cloudflared` systemd service holds the tunnel open and forwards requests to Nginx on `127.0.0.1:80`.
- Nginx listens only on `127.0.0.1:80`. Cloudflare terminates visitor TLS, and the tunnel encrypts traffic between Cloudflare and the VM, so no origin certificate is needed.
- Nginx serves `frontend/dist` for `/` and proxies `/api/` to `http://127.0.0.1:5000`.
- Flask app process: systemd service running `backend/main.py` (Waitress bound to `127.0.0.1:5000`).
- Visitors on plain HTTP get a 301 to HTTPS (detected from Cloudflare's `CF-Visitor` header).
- Nginx adds security headers to every response: HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and a Content-Security-Policy that is currently **report-only**.
  To enforce the CSP, open each page with the browser console open, fix or allow anything it reports, then
  rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `deployment/nginx.conf.tftpl`.
  Cloudflare features that inject scripts (Web Analytics, Rocket Loader, Zaraz) would need their domains added.
- `cloudflared` runs with `--no-autoupdate`, so update it with `apt-get upgrade cloudflared`.

### File Share Storage

The file share utility stores uploaded payloads and metadata on the backend instance path under a local `fileshare/` directory.

- uploads are request-validated and stored by the Flask app,
- payloads are encrypted at rest with a key derived from the same access key used for lookup,
- expired files are removed on file-share API requests,
- storage is bounded by a 100 MB per-file cap and a 1 GB live-storage cap,
- quota recovery is handled automatically: when accepting an upload would exceed the
  live-storage cap the backend will evict oldest active files to free space; expired
  files are also removed on subsequent file-share API requests.

## Key Variables

From `deployment/variables.tf`:

- `domain`
- `app_path`
- `repo_url`
- `repo_branch`
- `project_id`
- `project_region`
- `project_zone`
- `cloudflare_zone_id`
- `cloudflare_account_id`

## Standard Terraform Workflow

```bash
cd deployment
./tf.sh init
./tf.sh plan
./tf.sh apply
```

## VM Update Playbook

This stack is startup-script-driven, so VM replacement is the most reliable way to apply fresh app code with full bootstrap parity.

### Before You Start

1. Push the repo changes you want deployed.
2. Confirm `repo_url` and `repo_branch` variables.
3. Run commands from `deployment/`.

### Scenario A: Terraform Configuration Changed

Use standard apply:

```bash
cd deployment
./tf.sh init
./tf.sh plan
./tf.sh apply
```

### Scenario B: Code-Only Refresh

Force VM replacement to rerun startup bootstrap:

```bash
cd deployment
./tf.sh plan -replace=google_compute_instance.default
./tf.sh apply -replace=google_compute_instance.default
```

### Expected Behavior During Replacement

1. Existing VM is destroyed and recreated.
2. Public IP may change. DNS doesn't need to change because it points at the tunnel.
3. Visitors see a Cloudflare tunnel error (1033) until the new VM's `cloudflared` connects.
4. Short downtime occurs while provisioning completes.

### Post-Deploy Checks

```bash
curl -I https://josephcicalese.com
curl https://josephcicalese.com/api/projects
```

On VM:

```bash
sudo systemctl status flaskapp
sudo systemctl status nginx
sudo systemctl status cloudflared
sudo journalctl -u flaskapp -n 200 --no-pager
sudo journalctl -u cloudflared -n 100 --no-pager
```

### Faster Manual Alternative

For quick hot updates (accepting drift risk):

1. SSH to VM.
2. Pull latest code.
3. Reinstall backend dependencies if needed.
4. Rebuild frontend assets.
5. Restart `flaskapp` and `nginx`.

## Deployment Risks and Improvements

1. Terraform local state is in repo and should move to remote encrypted backend.
2. Secrets currently appear in local state and should be rotated/hardened.
3. Startup-script clone/build on boot should evolve toward pinned artifacts. See
   [Known Issue: Boot-Time Deployment](#known-issue-boot-time-deployment-future-fix).
4. Add health checks, monitoring, and CI validation before infra apply.

## Known Issue: Boot-Time Deployment (Future Fix)

**Status:** open. Planned fix: deploy through GitHub Actions.

### What Is Wrong

1. **The startup script runs on every boot, not just the first.** GCE executes
   `metadata_startup_script` at every boot. Each reboot, including GCP host maintenance and crash
   restarts, deletes `app_path` and re-clones the current tip of `repo_branch`. An unplanned reboot
   can therefore deploy untested code. Anyone who compromises the GitHub account or repo gets their
   code running on the VM at the next reboot, with no deploy step involved.
2. **Everything runs as root.** The clone, `pip install .`, `pnpm install` (including package
   install scripts), and `curl https://deb.nodesource.com/setup_22.x | bash` all run as root.
3. **Backend dependencies aren't locked in production.** `pip install .` resolves the `>=` ranges in
   `pyproject.toml` at boot time and ignores `uv.lock`, so production can run dependency versions that
   never ran in tests. (The frontend is fine: it uses `pnpm install --frozen-lockfile`.)
4. **The app user owns its own code.** `chown -R flaskapp ${app_path}/backend` means a compromised
   Flask process can rewrite its own code and keep that change across restarts.
5. **Builds happen on the production VM.** The 1 GB e2-micro needs a full Node toolchain just to
   build static files, boots slowly, and installs an unpinned `pnpm@latest-10`.
6. **No checks gate a deploy.** Nothing runs the tests before code reaches production.
   `.github/workflows/deploy.yaml` is currently a stub with no steps.

### Proposed Fix

Separate *provisioning the machine* (rare, Terraform) from *deploying a release* (every push, GitHub Actions).

1. **Provision once.** Trim the startup script to OS packages, users, Nginx, `cloudflared`, systemd
   units, and secrets. Guard it with a marker file (e.g. `/var/lib/personalwebsite/provisioned`) so later
   boots only start services. No clone or build at boot.
2. **Test and build in GitHub Actions** on push to `main`:
   - `test` job: `uv sync --frozen` + `pytest`; `pnpm install --frozen-lockfile` + `pnpm check`.
   - `package` job: build `frontend/dist`, bundle it with the backend source and `uv.lock` into a
     release tarball named after the commit SHA, and upload it as a workflow artifact.
3. **Deploy from GitHub Actions** (`deploy` job, needs `package`):
   - Authenticate to GCP with Workload Identity Federation (`google-github-actions/auth`), so no
     long-lived JSON key is stored in GitHub.
   - Copy the tarball with `gcloud compute scp --tunnel-through-iap`, which works with the existing IAP
     SSH firewall rule. The deploy identity needs IAP tunnel access (`roles/iap.tunnelResourceAccessor`)
     and OS Login on the instance. (Alternative: upload to a GCS bucket and have the VM pull a pinned version.)
   - On the VM, a root-owned `deploy.sh` extracts to `/opt/personalwebsite/releases/<sha>`, runs
     `uv sync --frozen --no-dev`, points the `/opt/personalwebsite/current` symlink at the release,
     and restarts `flaskapp`. Rolling back means pointing the symlink at the previous release.
   - Optionally, use a GitHub `production` environment with required reviewers for manual approval.
4. **Fix ownership.** Make release directories root-owned and read-only to `flaskapp`. Move runtime
   data (`instance/fileshare`) to `/var/lib/personalwebsite`, the only path `flaskapp` can write, and add
   systemd hardening (`ProtectSystem=strict`, `ReadWritePaths=/var/lib/personalwebsite`, `NoNewPrivileges=yes`).
5. **Tighten the supply chain.** With the frontend built in CI, the VM no longer needs Node at all,
   which removes the `curl | bash` step. Pin GitHub Actions to commit SHAs and pin pnpm with the
   `packageManager` field in `frontend/package.json`.
