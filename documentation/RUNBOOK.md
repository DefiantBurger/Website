# Runbook

Procedures against production. How the pieces work is in [Infrastructure](./INFRASTRUCTURE.md).

## Ship a Change

Deploys ship only the release tarball; the VM's config ships through Terraform ([why](./INFRASTRUCTURE.md#releases)).

| Change | How |
| --- | --- |
| App code or project content | Push to `main`, check that *Test* passed, then `./deploy.sh` (needs `gh`; refuses unless local `main` matches `origin/main`, follows the run, exits non-zero on failure). Also retries a failed deploy. |
| Docs only (`documentation/**`, any `README.md`) | Push. *Test* is skipped. |
| Terraform config | `./tf.sh plan`, then `./tf.sh apply`. A change to `vm_spec` (image, machine type, zone) is a zero-downtime [swap](./INFRASTRUCTURE.md#vm-swaps). |
| VM config (startup script, or `vm/`: units, Nginx, firewall rules, deploy script, sudoers, apt, sysctl, rsyslog and guest agent settings) | `./tf.sh apply` updates the VM in place; then [apply the changes](#apply-vm-config-changes). |
| Roll back | [Roll Back a Release](#roll-back-a-release). |

Before applying a change to anything in `infrastructure/` that reaches the VM, run its [local tests](./DEVELOPMENT.md#vm-script-tests).

## Verify Service Health

Uptime is monitored externally by Better Stack (free plan), with a public status page at <https://status.josephcicalese.com/> (linked from the site footer). Check it first; it shows when an outage started.

```bash
curl -I https://josephcicalese.com
curl https://josephcicalese.com/api/health/
curl https://josephcicalese.com/api/fileshare/status/
```

On the VM (`infrastructure/ssh.sh` finds it and opens a shell over IAP; `--vm <name>` picks one during a swap):

```bash
sudo systemctl status flaskapp nginx cloudflared
readlink /opt/personalwebsite/current          # deployed commit
sudo journalctl -u flaskapp -n 200 --no-pager
sudo journalctl -u cloudflared -n 100 --no-pager
sudo tail -n 100 /var/log/startup-script.log
```

Then load `/`, `/projects`, and each `/utilities/*` page in a browser.

If the VM is hung or SSH fails, read its serial console, which carries kernel and journald output. Google captures it outside the guest and copies it to Cloud Logging, kept for 30 days: in Logs Explorer, query `logName="projects/<project>/logs/serial_port_1_output"`. For the live buffer, run `gcloud compute instances get-serial-port-output <VM> --zone <zone>` (the name is the `vm_name` Terraform output, or `gcloud compute instances list`).

## Roll Back a Release

A deploy that fails its health check rolls itself back and fails the workflow. To roll back a release that is healthy but wrong, run this on the VM:

```bash
ls -t /opt/personalwebsite/releases                      # newest first; the last 5 are kept
sudo personalwebsite-deploy --rollback <commit sha>
```

It stays rolled back until the next manual deploy, so revert or fix the bad commit before deploying again. A rollback doesn't change the release bucket, so a [swap](#swap-the-vm) in the meantime brings back the bad release; deploy the fix first.

## Apply VM Config Changes

Deploys don't touch the VM's config. After editing `infrastructure/startup.sh.tftpl` or anything in `infrastructure/vm/` (Nginx, units, the deploy script, sudoers, apt, sysctl, rsyslog or guest agent settings):

1. `./tf.sh plan` should show the VM (`google_compute_instance.default`) updated in place (`~ metadata`). If it shows a replacement, that's a [swap](#swap-the-vm); make sure you meant one.
2. `./tf.sh apply`.
3. Run the new startup script now rather than waiting for a reboot:

   ```bash
   infrastructure/ssh.sh 'sudo google_metadata_script_runner startup'
   ```

It prints each file it updated (also appended to `/var/log/startup-script.log`) and restarts only what those files affect. Unchanged files are left alone, so a rerun is safe. If `nginx -t` fails, it restores the previous Nginx files, leaves Nginx running, and exits with an error; fix the template and repeat. Nginx is reloaded, not restarted, and a reload can't rebind `listen` to another address: after changing it, also run `sudo systemctl restart nginx`.

## Swap the VM

Changing `vm_spec` in `main.tf` swaps the VM ([how it works](./INFRASTRUCTURE.md#vm-swaps)). To swap without changing anything, say to replace a misbehaving VM, run `./tf.sh apply -replace=random_id.vm`. Don't `-replace` the instance itself: the new VM would get the old one's name, which it can't share while the old one exists.

While it runs, watch the site from another terminal. It should stay at `200` throughout:

```bash
while sleep 1; do curl -s -o /dev/null -w '%{http_code} ' https://josephcicalese.com/api/health/; done
```

### If a swap fails

The apply fails after 15 minutes. The old VM keeps serving, and *Deploy* refuses to run until the swap is resolved. `./tf.sh plan` shows the old VM as a deposed object and `terraform_data.vm_ready` as tainted; both clear on the next successful apply.

To find out why, read the new VM's startup log: `gcloud compute instances get-serial-port-output <new VM> --zone us-central1-a | grep startup-script`, or `infrastructure/ssh.sh --vm <new VM>`. Then either:

- **Fix it and retry.** Changes to the startup script or `infrastructure/vm/` reach the new VM through `./tf.sh apply`, followed by `infrastructure/ssh.sh --vm <new VM> 'sudo google_metadata_script_runner startup'` while the apply waits. If the new VM recovered on its own, say the tunnel connected late, rerun its startup script the same way to mark it ready, then apply.
- **Roll back.** Revert the `vm_spec` change and apply. That's another swap: a third VM replaces both once it's ready.

## Update the Kernel

The kernel comes only from the boot image pinned in `main.tf`, since an automatically installed kernel once crashed the VM on every boot (Debian 12 kernel `6.1.0-55`, November 2026). To update it:

1. Find the newest image: `gcloud compute images describe-from-family debian-13 --project debian-cloud --format='value(name)'`.
2. Set it in `vm_spec` in `main.tf`, then `./tf.sh apply`, which [swaps](#swap-the-vm) the VM. A kernel that crashes on boot never marks the new VM ready, so the old one keeps serving.
3. Watch the new VM's serial log (`serial_port_1_output` in Logs Explorer) for at least 30 minutes, since an oops after the swap has no old VM to fall back on. If the kernel oopses, the VM reboots in a loop; pin the previous image and apply again.

## Recurring Maintenance

| Task | When | How |
| --- | --- | --- |
| Update dependencies | On a Dependabot security alert (the only notification), and periodically | [Development](./DEVELOPMENT.md#updating-dependencies) |
| Update the kernel image | Every month or two, or for a kernel security fix | [Update the Kernel](#update-the-kernel) |
| Bump `Expires` in `frontend/public/.well-known/security.txt` | Yearly; it must stay under a year out (next: before 2027-11-10) | Edit, then [ship](#ship-a-change) |
| Regenerate the scheduler catalog | Each term | [Utilities](./UTILITIES.md#updating-the-catalog) |

## First-Time Setup

1. `./tf.sh apply`. With the bucket empty, the VM marks itself ready with no release, so the apply can finish.
2. In GitHub → Settings → Environments, create `production` (no required reviewers).
3. In GitHub → Settings → Variables → Actions, set `GCP_WIF_PROVIDER` and `GCP_DEPLOYER_SA` from the Terraform outputs.
4. Run *Deploy* on `main`. The release bucket is empty until then, so this first deploy is manual.

## Incidents

### Deploy workflow fails

- **`google-github-actions/auth` fails:** the `GCP_WIF_PROVIDER` / `GCP_DEPLOYER_SA` repository variables are missing or wrong, or the job didn't run on `main` in the `production` environment (the provider rejects anything else).
- **"Find the VM" fails with `Found 2 VMs`:** a swap is in progress or failed; see [Swap the VM](#swap-the-vm). With `Found 0 VMs`, the VM is missing its `app=personalwebsite` label.
- **`gcloud compute ssh` fails:** check the deployer's IAP and OS Login roles in `github_deploy.tf`, and that the VM has finished provisioning (`/var/log/startup-script.log`).
- **`gcloud compute ssh` fails with `Permission denied (publickey)`** and the serial log shows `google_authorized_keys` (not `google_authorized_principals`) for the deployer: the legacy `google-guest-agent.service` is running beside the plugin manager, and the two break OS Login's certificate check. Starting it by hand (`systemctl restart google-guest-agent`) does this. Fix with `infrastructure/ssh.sh 'sudo systemctl stop google-guest-agent && sudo systemctl restart google-guest-agent-manager'`.
- **`personalwebsite-deploy` fails its health check:** the step log includes the last 50 `flaskapp` journal lines. The previous release is still serving.

### Frontend reports "Expected JSON" or fails to load data

1. `curl -i` the endpoint (a `308` just means the trailing slash is missing). An HTML body usually means a `502` from Nginx because Flask is down, or a path outside `/api/` that Nginx served as a page or a `404`.
2. Check `journalctl -u flaskapp` for exceptions.
3. Confirm the build's `VITE_BACKEND_URL` matches the site's origin.

### File-share upload returns 503

Three transfers are already running (`MAX_CONCURRENT_TRANSFERS`). Retry shortly.

### File-share download returns 404

The key is wrong, the files expired (10 minutes), the app restarted (a deploy, reboot, or VM swap clears the file share), or someone uploaded a new batch with the same key, which replaces earlier files.

### Site shows Cloudflare error 1033

`cloudflared` isn't connected. Check `systemctl status cloudflared` and its journal. It only starts once a release is active, so on a VM without one (first-time setup, or a failed bootstrap: see `/var/log/startup-script.log`), run *Deploy*.

### Footer shows no uptime

`/api/site-info/` returned `"uptime": null`: the VM couldn't reach `https://status.josephcicalese.com/index.json`, or Better Stack changed its (undocumented) shape. `sudo journalctl -u flaskapp | grep -i uptime` shows the error; the backend retries every 2 minutes. If the shape changed, update `compute_uptime` in `backend/app/uptime.py`.
