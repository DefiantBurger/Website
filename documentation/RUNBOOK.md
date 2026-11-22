# Runbook

For deploys and VM access, see [Deployment](./DEPLOYMENT.md#deploying-changes).

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

## Update Project Content

1. Edit or add `frontend/src/content/projects/<slug>.md` ([frontmatter](./IMPLEMENTATION.md#project-frontmatter)).
2. Check it at `http://localhost:5173/projects/<slug>`, and run `pnpm build` to catch slug errors.
3. Push to `main`, then deploy.

## Roll Back a Release

A deploy that fails its health check rolls itself back and fails the workflow. To roll back a release that is healthy but wrong, run this on the VM:

```bash
ls -t /opt/personalwebsite/releases                      # newest first; the last 5 are kept
sudo personalwebsite-deploy --rollback <commit sha>
```

It stays rolled back until the next manual deploy, so revert or fix the bad commit before deploying again. A rollback doesn't change the release bucket, so a [swap](#swap-the-vm) in the meantime brings back the bad release; deploy the fix first.

## Apply VM Config Changes

Deploys don't touch the VM's config. After editing `infrastructure/startup.sh.tftpl` or anything in `infrastructure/vm/` (Nginx, units, the deploy script, sudoers, apt, sysctl or guest agent settings):

1. `./tf.sh plan` should show the VM (`google_compute_instance.default`) updated in place (`~ metadata`). If it shows a replacement, that's a [swap](#swap-the-vm); make sure you meant one.
2. `./tf.sh apply`.
3. Run the new startup script now rather than waiting for a reboot:

   ```bash
   infrastructure/ssh.sh 'sudo google_metadata_script_runner startup'
   ```

It prints each file it updated (also appended to `/var/log/startup-script.log`) and restarts only what those files affect. Unchanged files are left alone, so a rerun is safe. If `nginx -t` fails, it restores the previous Nginx files, leaves Nginx running, and exits with an error; fix the template and repeat. Nginx is reloaded, not restarted, and a reload can't rebind `listen` to another address: after changing it, also run `sudo systemctl restart nginx`.

## Swap the VM

Changing `vm_spec` in `main.tf` swaps the VM ([how it works](./DEPLOYMENT.md#vm-swaps)). To swap without changing anything, say to replace a misbehaving VM, run `./tf.sh apply -replace=random_id.vm`. Don't `-replace` the instance itself: the new VM would get the old one's name, which it can't share while the old one exists.

While it runs, watch the site from another terminal. It should stay at `200` throughout:

```bash
while sleep 1; do curl -s -o /dev/null -w '%{http_code} ' https://josephcicalese.com/api/health/; done
```

### If a swap fails

The apply fails after 15 minutes. The old VM keeps serving, and *Deploy* refuses to run until the swap is resolved. `./tf.sh plan` shows the old VM as a deposed object and `terraform_data.vm_ready` as tainted; both clear on the next successful apply.

To find out why, read the new VM's startup log: `gcloud compute instances get-serial-port-output <new VM> --zone us-central1-a | grep startup-script`, or `infrastructure/ssh.sh --vm <new VM>`. Then either:

- **Fix it and retry.** Changes to the startup script or `infrastructure/vm/` reach the new VM through `./tf.sh apply`, followed by `infrastructure/ssh.sh --vm <new VM> 'sudo google_metadata_script_runner startup'` while the apply waits. If the new VM recovered on its own, say the tunnel connected late, rerun its startup script the same way to mark it ready, then apply.
- **Roll back.** Revert the `vm_spec` change and apply. That's another swap: a third VM replaces both once it's ready.

## Incidents

### Deploy workflow fails

- **`google-github-actions/auth` fails:** the `GCP_WIF_PROVIDER` / `GCP_DEPLOYER_SA` repository variables are missing or wrong, or the job didn't run on `main` in the `production` environment (the provider rejects anything else).
- **"Find the VM" fails with `Found 2 VMs`:** a swap is in progress or failed; see [Swap the VM](#swap-the-vm). With `Found 0 VMs`, the VM is missing its `app=personalwebsite` label.
- **`gcloud compute ssh` fails:** check the deployer's IAP and OS Login roles in `github_deploy.tf`, and that the VM has finished provisioning (`/var/log/startup-script.log`).
- **`personalwebsite-deploy` fails its health check:** the step log includes the last 50 `flaskapp` journal lines. The previous release is still serving.

### Frontend reports "Expected JSON" or fails to load data

1. `curl -i` the endpoint (a `308` just means the trailing slash is missing). An HTML body usually means a `502` from Nginx because Flask is down, or a path outside `/api/` that Nginx served as a page or a `404`.
2. Check `journalctl -u flaskapp` for exceptions.
3. Confirm the build's `VITE_BACKEND_URL` matches the site's origin.

### Project page shows "not found"

1. The file exists in `frontend/src/content/projects/`.
2. Its `slug` (or file name, if no slug) matches the URL.
3. It isn't `published: false`.
4. The deployed build includes it (it was deployed after the file was added).

### File-share upload returns 503

Three transfers are already running (`MAX_CONCURRENT_TRANSFERS`). Retry shortly.

### File-share download returns 404

The key is wrong, the files expired (10 minutes), the app restarted (a deploy, reboot, or VM swap clears the file share), or someone uploaded a new batch with the same key, which replaces earlier files.

### Site shows Cloudflare error 1033

`cloudflared` isn't connected. Check `systemctl status cloudflared` and its journal. It only starts once a release is active, so on a VM without one (first-time setup, or a failed bootstrap: see `/var/log/startup-script.log`), run *Deploy*.

### Footer shows no uptime

`/api/site-info/` returned `"uptime": null`: the VM couldn't reach `https://status.josephcicalese.com/index.json`, or Better Stack changed its (undocumented) shape. `sudo journalctl -u flaskapp | grep -i uptime` shows the error; the backend retries every 2 minutes. If the shape changed, update `compute_uptime` in `backend/app/uptime.py`.
