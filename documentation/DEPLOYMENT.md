# Deployment

Provisioning and releases are separate:

- **Terraform** in `deployment/` provisions the infrastructure and the VM. That happens rarely.
- **GitHub Actions** (`.github/workflows/deploy.yaml`) tests every push. For pushes to `main`, it builds a release and deploys it to the VM (see [Deploying Changes](#deploying-changes)).

Always run Terraform through `./tf.sh`, which fetches the Cloudflare API token first (see [Secrets](#secrets)).

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
| Compute | `flask-vm`: e2-micro, Debian 12, runtime service account `flask-vm-runtime`, OS Login and guest attributes enabled, startup script from `startup.sh.tftpl` |
| Firewall | `allow-iap-ssh`: port 22 from IAP (`35.235.240.0/20`) only. No inbound web ports; the external IP is for outbound traffic only. |
| Cloudflare | Remotely managed tunnel `personal-website` routing `${domain}` to `http://localhost:80`; proxied `@` CNAME to the tunnel; "Add visitor location headers" Managed Transform (used by About You) |
| Secret Manager | `cloudflare-tunnel-token` secret + version; accessor IAM for the VM on it and on `flask-secret` |
| GitHub deploys (`github_deploy.tf`) | Workload Identity pool `github-deploy` and provider `github-actions` (accepts only `${github_repository}`, `refs/heads/main`, environment `production`); service account `github-deployer` with `iap.tunnelResourceAccessor` and non-admin `compute.osLogin` on the instance, `iam.serviceAccountUser` on `flask-vm-runtime`, project `compute.viewer`; enables the IAM Credentials, IAP, OS Login, and STS APIs |

Not managed by Terraform: the `status` CNAME to `statuspage.betteruptime.com` (Better Stack status page). It was added by hand in the Cloudflare dashboard and must stay **DNS only** (unproxied), or Better Stack can't serve the page.

Outputs `github_wif_provider` and `github_deployer_email` are the values for the GitHub repository variables `GCP_WIF_PROVIDER` and `GCP_DEPLOYER_SA`.

Because the VM only dials out to Cloudflare, the origin can't be reached directly or through another Cloudflare account; every request passes through this zone's WAF and rate-limit rules.

### Variables

All have defaults in `variables.tf`:

| Variable | Default |
| --- | --- |
| `domain` | `josephcicalese.com` |
| `app_path` | `/opt/personalwebsite` |
| `github_repository` | `DefiantBurger/Website` (the repository allowed to deploy) |
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

The VM reads secrets on every boot with its service account, and restarts a service only if its secret changed. No secret values pass through Terraform templates. GitHub Actions holds no secrets: it authenticates through Workload Identity Federation, and its two repository variables are identifiers.

`flask-secret` is also the pepper for file-share labels, so rotating it makes any current file-share files unreachable (they expire within 10 minutes anyway).

**`tf.sh` token lookup.** Secret `GSM_CLOUDFLARE_TOKEN_SECRET` (default `cloudflare-api-token`), version `GSM_CLOUDFLARE_TOKEN_VERSION` (default `latest`), project `GSM_CLOUDFLARE_TOKEN_PROJECT`, falling back to `TF_VAR_project_id` and then the `gcloud` default project. You need `gcloud` installed and authenticated, with `roles/secretmanager.secretAccessor` on the secret.

The Cloudflare API token needs these permissions (a 403 on one resource during `apply` usually means one is missing):

- Zone → DNS → Edit
- Account → Cloudflare Tunnel → Edit
- Zone → Managed headers → Edit, and Account → Account Rulesets → Read

## VM Bootstrap

`startup.sh.tftpl` runs as root at every boot (logged to `/var/log/startup-script.log` and the serial console). It provisions the VM only on the first boot. When that finishes, it writes `/var/lib/personalwebsite/.provisioned`.

First boot:

1. Remove `man-db`, `apt-get update`, install Python 3.11 (with `venv`), Nginx, curl.
2. Create the `flaskapp` system user, `/opt/personalwebsite/releases` (root-owned), and `/var/lib/personalwebsite` (owned by `flaskapp`, mode 700).
3. Install `deploy.sh.tftpl` as `/usr/local/sbin/personalwebsite-deploy`. Install `/etc/sudoers.d/personalwebsite-deploy`, which lets the `github-deployer` OS Login user (`sa_<unique id>`) run that script, and nothing else, as root.
4. Install the Nginx config and the `flaskapp` and `cloudflared` units, and enable them.
5. Install `cloudflared` from Cloudflare's apt repo and raise UDP buffer limits for QUIC (`/etc/sysctl.d/99-cloudflared.conf`).

Every boot:

6. Fetch `SECRET_KEY` and the tunnel token from Secret Manager into `/etc/personalwebsite/secrets.env` and `/etc/cloudflared/tunnel.env`, and restart the matching service if a value changed.

A fresh VM serves no app until a release is deployed (see [VM replacement](#deploying-changes)). `flaskapp.service` has a `ConditionPathExists` on the current release, so it stays idle until then.

Changing `startup.sh.tftpl`, `deploy.sh.tftpl`, or the unit and Nginx templates changes `metadata_startup_script`, which forces Terraform to replace the VM.

## Runtime on the VM

- **`cloudflared`** (systemd, `DynamicUser`, `--no-autoupdate`; update with `apt-get upgrade cloudflared`) holds the tunnel open and forwards to Nginx.
- **Nginx** listens only on `127.0.0.1:80`. Cloudflare terminates visitor TLS and the tunnel encrypts the hop to the VM, so there is no origin certificate. It serves `/opt/personalwebsite/current/frontend/dist` (SPA fallback to `index.html`) and proxies `/api/` to `127.0.0.1:5000`.
  - Caching: `index.html` is sent with `Cache-Control: no-cache` so browsers always pick up the current release's asset names. Hashed files under `/assets/` are cached for a year and return a real `404` when missing instead of the SPA fallback (an HTML response to a CSS/JS request is rejected under `nosniff`, leaving the page unstyled or blank).
  - Redirects plain-HTTP visitors (detected from `CF-Visitor`) to HTTPS.
  - Rate limit: 10 req/s per `CF-Connecting-IP`, burst 10 (no delay on `/api/fileshare/`).
  - Body limit: 1 MB, except 100 MB on `/api/fileshare/upload/`.
  - Headers: HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a **report-only** CSP. To enforce the CSP, browse each page with the console open, fix or allow anything it reports, then rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `nginx.conf.tftpl`. Cloudflare features that inject scripts (Web Analytics, Rocket Loader, Zaraz) would need their domains allowed.
- **`flaskapp`** (systemd, user `flaskapp`, `FLASK_ENV=production`) runs `current/backend/main.py` under Waitress on `127.0.0.1:5000`. It is sandboxed with `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, and `NoNewPrivileges`, and can write only `/var/lib/personalwebsite`.
- **File-share data** lives in `/var/lib/personalwebsite/fileshare/` (`PERSONALWEBSITE_INSTANCE_PATH`). It survives reboots and deploys, and files still expire after 10 minutes.

### Release layout

```
/opt/personalwebsite/
├── current -> releases/<commit sha>
└── releases/<commit sha>/          root-owned, read-only to flaskapp; newest 5 kept
    ├── .complete                   written once the release built successfully
    ├── backend/{main.py,app/,requirements.txt,.venv/}
    └── frontend/dist/
```

`personalwebsite-deploy <sha> <sha256> < release.tar.gz` does the following:

1. Verify the checksum and extract the tarball into `releases/<sha>`.
2. Create a venv and run `pip install --require-hashes --only-binary :all:` from `requirements.txt`, which CI exports from `uv.lock`.
3. Swap `current` atomically and restart `flaskapp`.
4. Poll `/api/health/` and Nginx for about 30 s. If the check fails, switch back to the previous release and exit 1.


## Deploying Changes

The workflow ships only the release tarball (`backend/` app code and `frontend/dist`). Everything under `deployment/` reaches the VM only at provisioning, so a push alone does not apply it.

| Change | How |
| --- | --- |
| App code or content | Push to `main`. The workflow runs `test-backend` and `test-frontend`, then `package` and `deploy`. Pull requests run only the tests. |
| Redeploy the tip of `main` | Actions → *Test and Deploy* → *Run workflow* on `main`. A release that already exists on the VM is reactivated without being rebuilt. |
| Roll back | On the VM: `ls -t /opt/personalwebsite/releases`, then `sudo personalwebsite-deploy --rollback <sha>`. |
| Terraform config | `./tf.sh plan` then `./tf.sh apply` (from `deployment/`) |
| VM provisioning (startup script, units, Nginx, deploy script) | `./tf.sh apply` replaces the VM. Then run the workflow on `main` to deploy a release. Until then the site shows Cloudflare 1033 or 502. |
| Nginx config only, without downtime | Edit `nginx.conf.tftpl`, then apply the same change to the running VM by hand ([Runbook](./RUNBOOK.md#update-the-nginx-config-in-place)). The next `./tf.sh apply` still replaces the VM, with the same result. |

The pipeline:

1. **test-backend:** `uv sync --frozen` and `uv run pytest --cov=app`.
2. **test-frontend:** `pnpm install --frozen-lockfile` and `pnpm check`. The pnpm version comes from `packageManager` in `frontend/package.json`.
3. **package:**
   - Build the frontend with `VITE_BACKEND_URL=https://josephcicalese.com`.
   - Export hash-pinned backend requirements with `uv export --frozen --no-dev`.
   - Tar `backend/{main.py,app,requirements.txt}` and `frontend/dist`, and upload the tarball as artifact `release-<sha>`.
4. **deploy** (only on `main`, in the `production` environment, serialized by `concurrency`):
   - Authenticate through Workload Identity Federation.
   - Stream the tarball over `gcloud compute ssh --tunnel-through-iap` into `sudo personalwebsite-deploy`.
   - Run `curl` against `https://josephcicalese.com/api/health/`.

Actions are pinned to commit SHAs.

Afterwards, if something looks wrong, run the [health checks](./RUNBOOK.md#verify-service-health).

### First-time setup

1. `./tf.sh apply`. This creates the GitHub deploy resources (and replaces the VM when migrating from the old boot-time deploy).
2. In GitHub → Settings → Environments, create `production` with no required reviewers and no branch restriction beyond `main`.
3. In GitHub → Settings → Variables → Actions, set the repository variables `GCP_WIF_PROVIDER` (output `github_wif_provider`) and `GCP_DEPLOYER_SA` (output `github_deployer_email`).
4. Run the workflow on `main`.
