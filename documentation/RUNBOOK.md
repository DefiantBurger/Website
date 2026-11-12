# Runbook

For deploys and VM access, see [Deployment](./DEPLOYMENT.md#deploying-changes).

## Verify Service Health

Uptime is monitored externally by Better Stack (free plan), with a public status page at <https://status.josephcicalese.com/> (linked from the nav bar). Check it first; it shows when an outage started.

```bash
curl -I https://josephcicalese.com
curl https://josephcicalese.com/api/health/
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

1. Edit or add `frontend/src/content/projects/<slug>.md` ([frontmatter](./IMPLEMENTATION.md#project-frontmatter)).
2. Check it at `http://localhost:5173/projects/<slug>`, and run `pnpm build` to catch slug errors.
3. Push to `main`, then deploy.

## Roll Back a Release

A deploy that fails its health check rolls itself back and fails the workflow. To roll back a release that is healthy but wrong, run this on the VM:

```bash
ls -t /opt/personalwebsite/releases                      # newest first; the last 5 are kept
sudo personalwebsite-deploy --rollback <commit sha>
```

It stays rolled back until the next manual deploy, so revert or fix the bad commit before deploying again. A rollback doesn't change the release bucket, so a VM replaced in the meantime comes back on the bad release; deploy the fix first.

## Update the Nginx Config in Place

Deploys don't touch Nginx. To apply an edited `deployment/nginx.conf.tftpl` without replacing the VM, run this from the repo root:

```bash
sed -e 's|${domain}|josephcicalese.com|' -e 's|${app_path}|/opt/personalwebsite|' \
  deployment/nginx.conf.tftpl > /tmp/nginx-default
gcloud compute scp /tmp/nginx-default flask-vm:/tmp/nginx-default --zone us-central1-a --tunnel-through-iap
gcloud compute ssh flask-vm --zone us-central1-a --tunnel-through-iap --command '
  sudo cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak &&
  sudo install -m 644 -o root -g root /tmp/nginx-default /etc/nginx/sites-available/default &&
  { sudo nginx -t && sudo systemctl reload nginx; } ||
  { sudo cp /etc/nginx/sites-available/default.bak /etc/nginx/sites-available/default; echo "Restored previous config"; exit 1; }'
```

If `nginx -t` fails, the previous config is restored and Nginx keeps running. The `${...}` values are the defaults in `deployment/variables.tf`.

## Incidents

### Deploy workflow fails

- **`google-github-actions/auth` fails:** the `GCP_WIF_PROVIDER` / `GCP_DEPLOYER_SA` repository variables are missing or wrong, or the job didn't run on `main` in the `production` environment (the provider rejects anything else).
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

- **"busy, try again"**: three transfers are already running (`MAX_CONCURRENT_TRANSFERS`). Retry shortly.
- **"Not enough storage"**: eviction couldn't free room under the 1 GB cap. Check `GET /api/fileshare/status/`; wait for files to expire (10 minutes) or delete files from `/var/lib/personalwebsite/fileshare/` on the VM.

### File-share download returns 404

The key is wrong, the files expired (10 minutes), the VM was replaced, or someone uploaded a new batch with the same key, which replaces earlier files.

### Site shows Cloudflare error 1033

`cloudflared` isn't connected. Check `systemctl status cloudflared` and its journal. Right after a VM replacement, the startup script may still be running (`/var/log/startup-script.log`). A replaced VM also serves 502 until its startup script installs the last published release (`Now serving` in the log), or until a deploy if that failed.
