# Operator checklist — Dev ERPNext provision

Run this once on a machine with GCP access to `sameerv`. Local agent
installs of `gcloud` live at `~/.local/gcloud/google-cloud-sdk` if needed.

```bash
# 0. PATH (if using the user-local SDK)
export PATH="$HOME/.local/gcloud/google-cloud-sdk/bin:$PATH"

# 1. Auth
gcloud auth login
gcloud config set project sameerv

# 2. Choose a public hostname you control and export it:
export ERP_DEV_HOST=erp-dev.YOUR_DOMAIN

# 3. From Royale-Touche-BE/:
./erpnext/scripts/gce-dev-provision.sh
# → note the printed static IP

# 4. Create DNS A record: $ERP_DEV_HOST → that IP (wait for propagation)

# 5. TLS:
./erpnext/scripts/gce-dev-provision.sh --letsencrypt

# 6. Seed:
gcloud compute ssh rt-erpnext-dev --zone=asia-south1-a --project=sameerv --tunnel-through-iap \
  --command="sudo -u frappe ERP_DEV_HOST=$ERP_DEV_HOST bash /tmp/gce-dev-seed.sh"

# 7. GitHub → Settings → Variables → Actions:
#    ERP_DEV_HOST = same hostname (no https://)

# 8. Tablet local.properties:
#    erp.dev.baseUrl=https://$ERP_DEV_HOST/api/
```

## Push / CI notes

- Merges to `development` that touch `erpnext/**` or `frontend/**` deploy
  automatically **after** `.github/workflows/deploy-development.yml` from
  this cut-over is on the branch (includes `deploy-erpnext` + portal
  `VITE_API_BASE_URL=https://$ERP_DEV_HOST/api`).
- Updating that workflow file via `git push` requires a PAT with the
  **`workflow`** scope (or commit the file in the GitHub web UI). Without
  it, GitHub rejects the push of `.github/workflows/*`.

After provision + DNS + `ERP_DEV_HOST` variable + workflow on `development`,
inventory Dev portal/tablet talk only to ERPNext on GCE.
