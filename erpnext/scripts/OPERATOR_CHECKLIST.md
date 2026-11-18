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

- Feature branch (scripts + seed gate):  
  `feature/macos-bootstrap/javed/20261116`  
  Compare → PR:  
  https://github.com/sameervaghela2121/extraction/compare/development...feature/macos-bootstrap/javed/20261116?expand=1
- Local uncommitted file  
  `.github/workflows/deploy-development.yml`  
  adds `deploy-erpnext` (IAP SSH migrate/restart) and points  
  `deploy-frontend` at `https://$ERP_DEV_HOST/api`.  
  **`git push` of that file needs a PAT with `workflow` scope**, or paste/commit  
  it via the GitHub web UI on the feature branch, then open the PR above.
- Tablet Dev BASE_URL change is on GitLab branch  
  `feature/partial-roll-return-and-sell/javed/20261116`  
  (open MR into `development` from the GitLab UI).

After provision + DNS + `ERP_DEV_HOST` variable + workflow on `development`,
inventory Dev portal/tablet talk only to ERPNext on GCE.
