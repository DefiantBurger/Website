# Runbook

For deploys and VM access, see [Deployment](./DEPLOYMENT.md#deploying-changes).

## Verify Service Health

Uptime is monitored externally by Better Stack (free plan), with a public status page at <https://status.josephcicalese.com/> (linked from the nav bar). Check it first; it shows when an outage started.

```bash
curl -I https://josephcicalese.com
curl https://josephcicalese.com/api/health/
curl https://josephcicalese.com/api/projects/
curl https://josephcicalese.com/api/fileshare/status/
```

On the VM:

```bash
sudo systemctl status flaskapp nginx cloudflared
readlink /opt/personalwebsite/current          # deployed commit
sudo journalctl -u flaskapp -n 200 --no-pager
sudo journalctl -u cloudflared -n 100 --no-pager
sudo tail -n 100 /var/log/startup-script.log
```

Then load `/`, `/projects`, and each `/utilities/*` page in a browser.

## Update Project Content

Project pages fetch Markdown at runtime, and Flask rereads the files on every request.

1. Edit or add `backend/app/content/projects/<slug>.md` ([frontmatter](./IMPLEMENTATION.md#project-frontmatter)).
2. Check locally: `curl http://localhost:5000/api/projects/<slug>/`.
3. Push to `main`; GitHub Actions deploys it ([Deploying Changes](./DEPLOYMENT.md#deploying-changes)).

## Roll Back a Release

A deploy that fails its health check rolls itself back and fails the workflow. To roll back a release that is healthy but wrong, run this on the VM:

```bash
ls -t /opt/personalwebsite/releases                      # newest first; the last 5 are kept
sudo personalwebsite-deploy --rollback <commit sha>
```

The next push to `main` deploys forward again. To stop that, revert the bad commit instead.

## Incidents

### Deploy workflow fails

- **`google-github-actions/auth` fails:** the `GCP_WIF_PROVIDER` / `GCP_DEPLOYER_SA` repository variables are missing or wrong, or the job didn't run on `main` in the `production` environment (the provider rejects anything else).
- **`gcloud compute ssh` fails:** check the deployer's IAP and OS Login roles in `github_deploy.tf`, and that the VM has finished provisioning (`/var/log/startup-script.log`).
- **`personalwebsite-deploy` fails its health check:** the step log includes the last 50 `flaskapp` journal lines. The previous release is still serving.

### Frontend reports "Expected JSON" or fails to load data

1. `curl -i` the endpoint (a `308` just means the trailing slash is missing). An HTML body usually means a `502` from Nginx because Flask is down, or a path outside `/api/` that hit the SPA fallback.
2. Check `journalctl -u flaskapp` for exceptions.
3. Confirm the build's `VITE_BACKEND_URL` matches the site's origin.

### Project page shows "not found"

1. The file exists in `backend/app/content/projects/`.
2. Its `slug` (or file name, if no slug) matches the URL.
3. It isn't `published: false`.

### File-share upload returns 503

- **"busy, try again"**: two transfers are already running (`MAX_CONCURRENT_TRANSFERS`). Retry shortly.
- **"Not enough storage"**: eviction couldn't free room under the 1 GB cap. Check `GET /api/fileshare/status/`; wait for files to expire (10 minutes) or delete files from `/var/lib/personalwebsite/fileshare/` on the VM.

### File-share download returns 404

The key is wrong, the files expired (10 minutes), the VM was replaced, or someone uploaded a new batch with the same key, which replaces earlier files.

### Site shows Cloudflare error 1033

`cloudflared` isn't connected. Check `systemctl status cloudflared` and its journal. Right after a VM replacement, the startup script may still be running (`/var/log/startup-script.log`). A replaced VM also serves 502 until a release is deployed.

## Secrets

1. Never commit secrets or secret-bearing files (`.env`, `*.tfstate`).
2. Rotate an exposed secret immediately in Secret Manager, then reboot the VM so it re-reads secrets. Rotating `flask-secret` invalidates current file-share files.
3. Grant the VM access only to the secrets it needs.

## Docs Checklist

When changing behavior, check that:

- [ ] Route and API tables in [Implementation](./IMPLEMENTATION.md) match `router.ts` and `views.py`.
- [ ] Utility contracts and limits in [Utilities](./UTILITIES.md) match the code constants.
- [ ] [Deployment](./DEPLOYMENT.md) matches the Terraform files, `startup.sh.tftpl`, `deploy.sh.tftpl`, and `.github/workflows/deploy.yaml`.
- [ ] [Known Issues](./KNOWN-ISSUES.md) are still open.
