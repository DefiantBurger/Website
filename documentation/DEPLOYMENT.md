# Deployment

## Infrastructure Stack

- Terraform
- Google Cloud Platform (Compute Engine + networking)
- Cloudflare DNS and proxy
- Nginx reverse proxy
- systemd-managed Flask service

Terraform configuration is in `deployment/`.

## Providers and Versions

From `deployment/versions.tf`:

- Terraform: `>= 1.12.2, < 2.0.0`
- `hashicorp/google` `~> 7.27.0`
- `hashicorp/google-beta` `~> 7.27.0`
- `cloudflare/cloudflare` `~> 4.52.7`

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
- HTTP/HTTPS ingress restricted to Cloudflare IP ranges

### Cloudflare

- proxied A record for root domain (`@`) to VM public IP

## Secrets

Provisioning reads from Google Secret Manager:

- `cloudflare-origin-certificate`
- `cloudflare-private-key`
- `cloudflare-api-token`
- `cloudflare-zone-id`
- `flask-secret`
- `mongodb-uri`

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
9. Cloudflare cert/key install,
10. Nginx config install/restart.

## Runtime Topology on VM

- Flask app process: systemd service, running `backend/main.py`.
- Nginx serves `frontend/dist` for `/`.
- Nginx proxies `/api/` to `http://localhost:5000`.
- HTTP redirects to HTTPS.

### File Share Storage

The file share utility stores uploaded payloads and metadata on the backend instance path under a local `fileshare/` directory.

- uploads are request-validated and stored by the Flask app,
- expired files are removed on file-share API requests,
- storage is bounded by a 50 MB per-file cap and a 1 GB live-storage cap,
- quota recovery depends on expired files being cleaned up or manually removed on the VM.

## Key Variables

From `deployment/variables.tf`:

- `domain`
- `app_path`
- `repo_url`
- `repo_branch`
- `project_id`
- `project_region`
- `project_zone`

## Standard Terraform Workflow

```bash
cd deployment
terraform init
terraform plan
terraform apply
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
terraform init
terraform plan
terraform apply
```

### Scenario B: Code-Only Refresh

Force VM replacement to rerun startup bootstrap:

```bash
cd deployment
terraform plan -replace=google_compute_instance.default
terraform apply -replace=google_compute_instance.default
```

### Expected Behavior During Replacement

1. Existing VM is destroyed and recreated.
2. Public IP may change.
3. Cloudflare DNS updates to new VM IP.
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
sudo journalctl -u flaskapp -n 200 --no-pager
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
3. Startup-script clone/build on boot should evolve toward pinned artifacts.
4. Add health checks, monitoring, and CI validation before infra apply.
