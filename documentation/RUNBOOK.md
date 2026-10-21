# Runbook

For deploys and VM access, see [Deployment](./DEPLOYMENT.md#deploying-changes).

## Verify Service Health

```bash
curl -I https://josephcicalese.com
curl https://josephcicalese.com/api/projects/
curl https://josephcicalese.com/api/fileshare/status/
```

On the VM:

```bash
sudo systemctl status flaskapp nginx cloudflared
sudo journalctl -u flaskapp -n 200 --no-pager
sudo journalctl -u cloudflared -n 100 --no-pager
sudo tail -n 100 /var/log/startup-script.log
```

Then load `/`, `/projects`, and each `/utilities/*` page in a browser.

## Update Project Content

Project pages fetch Markdown at runtime and Flask rereads the files on every request, so content edits need no rebuild or restart.

1. Edit or add `backend/app/content/projects/<slug>.md` ([frontmatter](./IMPLEMENTATION.md#project-frontmatter)).
2. Check locally: `curl http://localhost:5000/api/projects/<slug>/`.
3. Push, then on the VM `cd /opt/personalwebsite && sudo git pull` (or reboot the VM).

## Incidents

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
- **"Not enough storage"**: eviction couldn't free room under the 1 GB cap. Check `GET /api/fileshare/status/`; wait for files to expire (10 minutes) or delete files from `/opt/personalwebsite/backend/instance/fileshare/` on the VM.

### File-share download returns 404

The key is wrong, the files expired (10 minutes), a VM reboot erased them, or someone uploaded a new batch with the same key, which replaces earlier files.

### Site shows Cloudflare error 1033

`cloudflared` isn't connected. Check `systemctl status cloudflared` and its journal. Right after a reboot or replacement, the startup script may still be running (`/var/log/startup-script.log`).

## Known Issues

### Backend

1. Production installs ignore `uv.lock` (see [Boot-Time Deployment](./DEPLOYMENT.md#known-issue-boot-time-deployment)).
2. No `/api/health` endpoint or uptime monitoring.

### Frontend

1. `Home.svelte` shows hard-coded placeholder "Featured Projects" instead of using `/api/projects/`.
2. `src/app.css` ends with leftover Vite template styles (from `body { margin: 0; }` onward) that reference undefined variables (`--heading`, `--text-h`); `src/lib/Counter.svelte` is unused template code.
3. `NotFound.svelte` route suggestions omit `/utilities/message-board`.
4. `index.html` title is still `personal-website-frontend`.
5. No frontend tests (scheduler logic is the best first target).

### Infrastructure

1. The boot-time clone-and-build model redeploys the tip of `main` as root on every reboot. Details and the planned GitHub Actions fix: [Deployment](./DEPLOYMENT.md#known-issue-boot-time-deployment).
2. Terraform state is local to the operator's machine (gitignored): no remote backend, encryption, or locking. It contains the tunnel secret (`random_id.tunnel_secret`). Move it to an encrypted remote backend (e.g. GCS).
3. No monitoring or alerting.

Utility-specific gaps are listed per utility in [Utilities](./UTILITIES.md).

## Secrets

1. Never commit secrets or secret-bearing files (`.env`, `*.tfstate`).
2. Rotate an exposed secret immediately in Secret Manager, then reboot the VM so it re-reads secrets. Rotating `flask-secret` invalidates current file-share files.
3. Grant the VM access only to the secrets it needs.

## Docs Checklist

When changing behavior, check that:

- [ ] Route and API tables in [Implementation](./IMPLEMENTATION.md) match `router.ts` and `views.py`.
- [ ] Utility contracts and limits in [Utilities](./UTILITIES.md) match the code constants.
- [ ] [Deployment](./DEPLOYMENT.md) matches the Terraform files and `startup.sh.tftpl`.
- [ ] Known issues above are still open.
