# Deployment

Provisioning and releases are separate. **Terraform** (`deployment/`) provisions the infrastructure and the VM, rarely. **GitHub Actions** ships releases: `deploy.yaml` runs only by hand on `main`, so pushes and merges never deploy.

Always run Terraform through `./tf.sh` from `deployment/`; it fetches the Cloudflare API token first ([Secrets](#secrets)). Inputs and their defaults are in `variables.tf`; versions are in `versions.tf`.

> **Replacing the VM is a zero-downtime swap.** A new VM starts next to the old one, installs the last release *Deploy* published to the release bucket, and joins the tunnel. Only then does Terraform delete the old VM. If the new VM never gets ready, the apply fails and the old VM keeps serving. See [VM Swaps](#vm-swaps).

## Resources

| Area | Resources |
| --- | --- |
| Network | VPC `my-custom-mode-network`, subnet `my-custom-subnet` (`10.0.1.0/24`) |
| Compute | `flask-vm-<suffix>` (label `app=personalwebsite`; the suffix changes on every [swap](#vm-swaps)): e2-micro, Debian 13, service account `flask-vm-runtime`, OS Login, `startup-script` metadata from `startup.sh.tftpl` |
| Firewall | `allow-iap-ssh`: port 22 from IAP (`35.235.240.0/20`) only. No inbound web ports; the external IP is outbound-only. |
| Cloudflare | Tunnel `personal-website` routing `${domain}` to `http://localhost:80`; proxied `@` CNAME to the tunnel; "Add visitor location headers" Managed Transform (used by About You) |
| DNS | DNSSEC; CAA allowing only `pki.goog`, `letsencrypt.org`, `ssl.com`; `status` CNAME to Better Stack (must stay **DNS only**); Google site-verification TXT; `_dmarc` TXT (`p=reject`, reports to Cloudflare DMARC Management) |
| Secret Manager | `cloudflare-tunnel-token`; VM accessor IAM on it and on `flask-secret` |
| Release bucket (`releases.tf`) | `${project_id}-releases` in `us-central1` (single region, so it stays in the free tier), private, no versioning. Holds only `latest.tar.gz`, the last release that passed its smoke test. VM service account can read; `github-deployer` can write. |
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
- `flask-secret` is also the file-share label pepper. Rotating it takes a restart, which clears the file share anyway.
- GitHub Actions holds no deploy credentials: it authenticates through Workload Identity Federation, and its two repository variables are identifiers. (`CODECOV_TOKEN` is the only Actions secret.)
- **`tf.sh` token lookup:** secret `GSM_CLOUDFLARE_TOKEN_SECRET` (default `cloudflare-api-token`), version `GSM_CLOUDFLARE_TOKEN_VERSION` (default `latest`), project `GSM_CLOUDFLARE_TOKEN_PROJECT`, then `TF_VAR_project_id`, then the `gcloud` default. Needs an authenticated `gcloud` with `secretmanager.secretAccessor` on the secret.
- The Cloudflare API token needs Zone → DNS → Edit, Account → Cloudflare Tunnel → Edit, Zone → Managed headers → Edit, and Account → Account Rulesets → Read. A 403 on one resource during `apply` usually means one is missing.

## VM Bootstrap

`startup.sh.tftpl` is the VM's `startup-script` metadata. It runs as root on every boot (logged to `/var/log/startup-script.log`) and can be [rerun by hand](./RUNBOOK.md#apply-vm-config-changes):

1. **First boot only** (until `/var/lib/personalwebsite/.provisioned` exists): installs Python 3.13, Nginx, curl, `unattended-upgrades`, and `cloudflared` (from Cloudflare's apt repo), and creates the `flaskapp` user, root-owned `/opt/personalwebsite/releases` (`app_path`), and `/var/lib/personalwebsite` (`data_path`; `flaskapp`, mode 700). On every boot, it also installs `nftables` if it's missing, so VMs provisioned before the firewall get it too.
2. Installs the files listed in `vm_files` (`main.tf`, sources in `deployment/vm/`), replacing only those whose contents changed:
   - The Nginx config, and the `flaskapp`, `flaskapp-firewall`, `cloudflared`, and `cloudflared-restart` units.
   - `flaskapp-firewall.nft`, the [metadata block](#runtime-on-the-vm) that `flaskapp-firewall.service` loads.
   - `deploy.sh.tftpl` as `/usr/local/sbin/personalwebsite-deploy`, plus a sudoers rule letting the `github-deployer` OS Login user run that script, and nothing else, as root.
   - `unattended-upgrades.conf`: also install Debian point releases and `cloudflared`, but never kernels (`linux-image-*`; see [Kernel updates](#kernel-updates)), and reboot at 09:17 UTC when an update needs it.
   - `sysctl.conf`: `kernel.panic_on_oops`, so a kernel oops reboots the VM after 10 s instead of leaving it hung, and the larger UDP buffers QUIC wants.
3. Checks a changed Nginx config with `nginx -t`. If it fails, it restores the previous files and stops with an error, so Nginx keeps serving the old config. A changed sudoers rule is checked with `visudo` before it goes live.
4. Refreshes secrets from Secret Manager, using the `gcloud` that ships with Google's Debian images (as the VM's service account). If `gcloud` fails, the script stops and the old secrets stay.
5. Applies what changed, by destination: `daemon-reload` and restart for units, a reload for Nginx and the firewall rules, `sysctl -p` for kernel settings, and a restart for a service whose secret changed. It then enables and starts the units without waiting on them, so a failing `cloudflared` doesn't block the next step. `flaskapp` and `cloudflared` stay idle until a release exists (`ConditionPathExists`): joining the tunnel puts the VM in Cloudflare's rotation.
6. If no release is active (`current` is missing), installs `latest.tar.gz` from the release bucket through `personalwebsite-deploy`, using the commit SHA and checksum from the object's metadata. The deploy script starts `cloudflared` once the release passes its health check. If the check fails with no earlier release to fall back on, it leaves none active. A failure is logged and doesn't stop the boot; reboot to retry, or run *Deploy*.
7. Marks the VM ready for [swaps](#vm-swaps): once `cloudflared`'s `/ready` answers (up to 2 minutes), it sets the guest attribute `personalwebsite/ready` to the active release's commit SHA, or `none` if no release is published yet.

To add a file, put it in `vm/` and list it in `vm_files`. If its directory needs a reload or restart that `apply_changes` in `startup.sh.tftpl` doesn't cover yet, add a case there.

## VM Swaps

Everything that would need a new VM or a stop/start (the image, machine type, and zone) lives in `local.vm_spec` in `main.tf`. Changing it gives the VM a new random name (`random_id.vm`), and the instance's `create_before_destroy` turns the replacement into a swap:

1. Terraform creates the new VM next to the old one. It provisions, installs `latest.tar.gz`, and joins the tunnel as a second replica, so Cloudflare splits traffic between the two.
2. `terraform_data.vm_ready` runs `wait-for-vm.sh`, which polls the new VM's `personalwebsite/ready` guest attribute for up to 15 minutes.
3. Once it's set, Terraform moves the deployer's OS Login and IAP grants to the new VM and deletes the old one. GCE shuts it down gracefully, and `cloudflared` drains in-flight requests for up to 30 s.

A swap takes about 6–8 minutes, and the overlap is its only cost beyond the free tier (a fraction of a cent). If the new VM never marks itself ready (a crash on boot, a release that fails its health check, a tunnel that won't connect), the apply fails and the old VM keeps serving, grants included. See [Swap the VM](./RUNBOOK.md#swap-the-vm) to recover.

- A swap's plan replaces `random_id.vm`, the instance (`+/-`, create before destroy), its two IAM grants, and `terraform_data.vm_ready`. If the instance must be replaced but its name stays the same, the attribute that changed belongs in `vm_spec`; applying anyway fails with "already exists" and leaves the old VM alone.
- During the overlap, file shares and message-board posts live on one VM each, so for a few minutes a share can 404 on the other.
- The new VM installs the bucket's release. After a [rollback](./RUNBOOK.md#roll-back-a-release) on the VM, deploy the fix before swapping.
- *Deploy* refuses to run while two VMs exist. A deploy already past that check when a swap starts can still leave the new VM on the previous release, so don't run both at once.

## Runtime on the VM

- **`cloudflared`** (systemd, `DynamicUser`, `--no-autoupdate`; updated by `unattended-upgrades` instead, and `cloudflared-restart.path` restarts it when the binary changes) holds the tunnel and forwards to Nginx.
- **Nginx** listens only on `127.0.0.1:80` (Cloudflare terminates TLS; no origin certificate). It serves `current/frontend/dist` and proxies `/api/` to `127.0.0.1:5000` (`backend_port`).
  - Page paths with a trailing slash get a `301` to the path without it. (API paths are the reverse: Flask `308`s requests missing the slash.)
  - No SPA fallback: the build writes `<route>/index.html` for every route, so other paths return a real `404` whose body is the SPA shell, and the app renders its not-found page.
  - HTML is `Cache-Control: no-cache`; hashed `/assets/` are cached for a year, and a missing one gets a `404` (never the page shell with a `200`).
  - gzip for HTML, JSON, CSS, JS, and SVG, including API responses (the course catalog is ~3 MB raw).
  - Rate limit 10 req/s per `CF-Connecting-IP`, burst 10 (`/api/fileshare/` with `nodelay`; other `/api/` delays requests past 5 instead), answered with `429`. Body limit 1 MB, except 81 MiB on `/api/fileshare/upload/`.
  - At most 2 uploads in flight per `CF-Connecting-IP` and 6 in total (`limit_conn`, also `429`). Each one can sit on disk about four times while it's in flight, so this keeps uploads from filling the boot disk.
  - Security headers: HSTS (with `includeSubDomains`, so every subdomain, `status` included, must serve HTTPS), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a **report-only** CSP. To enforce it, browse each page with the console open, fix or allow what it reports, then rename the header to `Content-Security-Policy` in `nginx.conf.tftpl`. Cloudflare features that inject scripts (Web Analytics, Rocket Loader, Zaraz) would need their domains allowed.
- `/.well-known/security.txt` is `frontend/public/.well-known/security.txt`. Its `Expires` date must stay under a year out, so bump it yearly (next: before 2027-11-10).
- **`flaskapp`** (systemd, `FLASK_ENV=production`, `PORT=backend_port`) runs Waitress on `127.0.0.1:5000`, sandboxed (`ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `NoNewPrivileges`) with write access only to `/var/lib/personalwebsite`. It `Requires` `flaskapp-firewall.service`, which loads an nftables table that rejects `flaskapp`'s connections to the metadata server's HTTP port (`169.254.169.254:80`). Otherwise any code running as `flaskapp` could get the VM service account's token and read both secrets from Secret Manager. Port 53 stays open, because the metadata server is also the VM's DNS resolver. Stopping the firewall unit stops `flaskapp` too. File-share data lives in `/var/lib/personalwebsite/fileshare/` and survives reboots and deploys.

### Releases

```
/opt/personalwebsite/
├── current -> releases/<commit sha>
└── releases/<commit sha>/          root-owned, read-only to flaskapp; newest 5 kept
    ├── .complete                   written once the release built successfully
    ├── backend/{main.py,app/,requirements.txt,.venv/}
    └── frontend/dist/
```

`personalwebsite-deploy <sha> <sha256> < release.tar.gz` verifies the checksum and extracts the release into a directory only root can open. It refuses a tarball containing anything other than regular files and directories (symlinks, device nodes, FIFOs), a `backend/.venv`, or a `requirements.txt` line that `uv export` wouldn't write (pip options, paths, URLs). Then it installs hash-pinned wheels (`pip install --require-hashes --only-binary :all:`), swaps `current` atomically, restarts `flaskapp`, and polls `/api/health/` through Nginx, and the home page, for ~30 s. If the check fails, it switches back to the previous release and exits 1. A release already on the VM is reactivated without rebuilding. Runs hold a lock, so a workflow deploy during the startup script's bootstrap waits for it.

## Deploying Changes

Only the release tarball (backend app code and `frontend/dist`) ships on deploy. The VM's config (the startup script and `deployment/vm/`) ships through Terraform, never in the tarball: a systemd unit or Nginx `load_module` there would let whoever can deploy run code as root.

| Change | How |
| --- | --- |
| App code or project content | Push to `main`, check that *Test* passed, then `./deploy.sh` (needs `gh`; refuses unless local `main` matches `origin/main`, follows the run, exits non-zero on failure). Also retries a failed deploy. |
| Docs only (`documentation/**`, any `README.md`) | Push. *Test* is skipped. |
| Terraform config | `./tf.sh plan`, then `./tf.sh apply`. A change to `vm_spec` (image, machine type, zone) is a zero-downtime [swap](#vm-swaps). |
| VM config (startup script, or `vm/`: units, Nginx, firewall rules, deploy script, sudoers, apt and sysctl settings) | `./tf.sh apply` updates the VM in place; then [apply the changes](./RUNBOOK.md#apply-vm-config-changes). |
| Roll back | [Runbook](./RUNBOOK.md#roll-back-a-release). |

### Testing VM changes

`deployment/test/run.sh` checks everything that reaches the VM, locally, in about 5 minutes:
- It runs the rendered startup script in Debian 13 containers with systemd, with `gcloud`, `sysctl`, and the metadata server stubbed. The scenarios cover first boot, reruns, config changes and their failure handling, and a new VM in a swap whose release is good, broken, or can't reach the tunnel. They also check the metadata firewall, the upload caps, and that the deploy script refuses tarballs that could run code as root.
- It also tests `wait-for-vm.sh`, and Terraform's swap ordering with a local stand-in config.

It needs Docker, shellcheck, Terraform, uv, and `tf.sh`'s gcloud login (rendering reads Terraform state). Run it after changing anything in `deployment/` that reaches the VM. It can't model GCE itself (the guest environment, IAM, a real tunnel), so watch the first real run of anything new.

### Kernel updates

The kernel comes only from the boot image pinned in `main.tf`, since an automatically installed kernel once crashed the VM on every boot (Debian 12 kernel `6.1.0-55`, November 2026). To update it, every month or two or for a kernel security fix:

1. Find the newest image: `gcloud compute images describe-from-family debian-13 --project debian-cloud --format='value(name)'`.
2. Set it in `vm_spec` in `main.tf`, then `./tf.sh apply`, which [swaps](#vm-swaps) the VM. A kernel that crashes on boot never marks the new VM ready, so the old one keeps serving.
3. Watch the new VM's serial log (`serial_port_1_output` in Logs Explorer) for at least 30 minutes, since an oops after the swap has no old VM to fall back on. If the kernel oopses, the VM reboots in a loop; pin the previous image and apply again.

### Pipeline

Both workflows set up uv, pnpm, and Node through `.github/actions/setup`, and all actions are pinned to commit SHAs.

- ***Test*** (`test.yaml`, on PRs and non-docs pushes to `main`): backend `ruff check`, `ruff format --check`, and `pytest --cov=app` (coverage to Codecov); frontend `lint`, `format:check`, `check`, `test`, and `build`. Lint and format problems only warn.
- ***Deploy*** (`deploy.yaml`, manual, `main` only; doesn't rerun tests):
  1. **package:** build the frontend with `VITE_BACKEND_URL=https://josephcicalese.com`, export hash-pinned requirements (`uv export --frozen --no-dev --no-emit-project`), and upload the tarball as artifact `release-<sha>`.
  2. **deploy** (environment `production`, serialized): authenticate through WIF, find the VM by its label (failing unless exactly one exists, since two mean a [swap](#vm-swaps) is in progress or failed), stream the tarball over `gcloud compute ssh --tunnel-through-iap` into `sudo personalwebsite-deploy`, then `curl` the public `/api/health/`, the home page, and its entry script.
  3. **publish** (same job, only if the smoke test passed): copy the tarball to `gs://<release bucket>/latest.tar.gz` with the commit SHA and checksum as object metadata (`git-sha`, `sha256`). `GCS_RELEASE_BUCKET` in `deploy.yaml` must match the `release_bucket` Terraform output.

### First-time setup

1. `./tf.sh apply`. With the bucket empty, the VM marks itself ready with no release, so the apply can finish.
2. In GitHub → Settings → Environments, create `production` (no required reviewers).
3. In GitHub → Settings → Variables → Actions, set `GCP_WIF_PROVIDER` and `GCP_DEPLOYER_SA` from the Terraform outputs.
4. Run *Deploy* on `main`. The release bucket is empty until then, so this first deploy is manual.
