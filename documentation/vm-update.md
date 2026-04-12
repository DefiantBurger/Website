# VM Update Playbook

This project deploys through a startup-script-driven VM bootstrap.
Because the startup script clones the repo and rebuilds backend/frontend, the most reliable refresh path is to recreate the VM when you want fresh code applied.

## Before You Start

1. Commit and push repository changes you want deployed.
2. Confirm `repo_url` and `repo_branch` in Terraform variables point to the right repo/branch.
3. Run all commands from the `deployment/` directory.

## Scenario A: You Changed Terraform Configuration

Use the standard workflow:

```bash
cd deployment
terraform init
terraform plan
terraform apply
```

Terraform will update only what changed.

## Scenario B: You Did Not Change Terraform (Code-Only Refresh)

If app code changed but Terraform files did not, force VM replacement so startup bootstrap runs again.

Use modern Terraform replacement syntax:

```bash
cd deployment
terraform plan -replace=google_compute_instance.default
terraform apply -replace=google_compute_instance.default
```

This recreates the VM and reruns:

- repo clone
- backend install
- frontend build
- systemd/nginx provisioning

## What to Expect During Replacement

1. Old VM is destroyed and recreated.
2. Public IP may change.
3. Cloudflare A record is updated by Terraform to the new IP.
4. Short downtime is expected during provisioning.

## Post-Deploy Checks

```bash
curl -I https://josephcicalese.com
curl https://josephcicalese.com/api/scheduler/default-schedule
```

If needed, verify app processes on VM:

```bash
sudo systemctl status flaskapp
sudo systemctl status nginx
sudo journalctl -u flaskapp -n 200 --no-pager
```

## Faster Alternative (No VM Recreate)

If you only need a quick hot update and accept manual steps, SSH into the VM and update in place:

1. Pull latest code.
2. Reinstall backend package if dependencies changed.
3. Rebuild frontend assets.
4. Restart `flaskapp` and `nginx`.

Use this carefully because it can drift from Terraform-managed bootstrapping expectations.