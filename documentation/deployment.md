# Deployment Documentation

## Infrastructure Stack

- Terraform
- Google Cloud Platform (Compute Engine + networking)
- Cloudflare DNS and proxy
- Nginx reverse proxy
- systemd-managed Flask service

Terraform configuration is in `deployment/`.

## Providers and Versions

From `versions.tf`:

- Terraform: `>= 1.12.2, < 2.0.0`
- `hashicorp/google` `~> 7.27.0`
- `hashicorp/google-beta` `~> 7.27.0`
- `cloudflare/cloudflare` `~> 4.52.7`

## Provisioned Resources

### GCP Network

- custom VPC (`my-custom-mode-network`)
- custom subnet (`10.0.1.0/24`)

### GCP VM

- single instance: `flask-vm`
- machine type: `e2-micro`
- image: Debian 12
- startup script bootstraps full application stack

### Firewall Rules

- SSH via IAP only (`35.235.240.0/20` to port 22)
- HTTP/HTTPS ingress restricted to Cloudflare IP ranges

### Cloudflare

- proxied A record for root domain (`@`) -> VM public IP

## Secrets

Secrets are read from Google Secret Manager via data sources:

- `cloudflare-origin-certificate`
- `cloudflare-private-key`
- `cloudflare-api-token`
- `cloudflare-zone-id`
- `flask-secret`
- `mongodb-uri`

## Startup Bootstrap Flow

Startup template (`startup.sh.tftpl`) performs:

1. apt package prep and installs,
2. Python 3.11 install/verification,
3. Node.js 22 install and pnpm activation,
4. repository clone from configured branch,
5. backend venv setup and package install,
6. frontend `pnpm install` and production build with `VITE_BACKEND_URL=https://<domain>`,
7. `flaskapp` system user creation,
8. systemd unit installation and startup,
9. Cloudflare cert/key install,
10. Nginx config install and restart.

## Runtime Topology on VM

- Flask app process: systemd service -> runs `backend/main.py` (production mode uses Waitress).
- Nginx:
  - serves static frontend from `frontend/dist`,
  - proxies `/api/` to `http://localhost:5000`,
  - redirects HTTP to HTTPS.

## Key Variables

From `variables.tf`:

- `domain`
- `app_path`
- `repo_url`
- `repo_branch`
- `project_id`
- `project_region`
- `project_zone`

## Typical Terraform Workflow

```bash
cd deployment
terraform init
terraform plan
terraform apply
```

## Operational Notes

- VM startup is stateful and performs clone/build at boot.
- Terraform state files currently exist in repo (`terraform.tfstate*`); that is convenient for solo local work but generally avoided for team/security workflows.
- There is a TODO in infra to further harden runtime user model.

## Suggested Deployment Improvements

1. Move Terraform state to remote backend (e.g., GCS bucket).
2. Add VM startup idempotency checks for repeated boots.
3. Add health checks and monitoring/alerts.
4. Add CI pipeline for build/test prior to infra apply.
5. Consider managed cert flow if Cloudflare origin cert approach changes.
