# Operator checklist — Dev ERPNext provision

Run this once on a machine with GCP access to `sameerv`. Local agent
installs of `gcloud` live at `~/.local/gcloud/google-cloud-sdk` if needed.

```bash
# 0. PATH (if using the user-local SDK)
export PATH="$HOME/.local/gcloud/google-cloud-sdk/bin:$PATH"

# 1. Auth (use a real Terminal.app — Workspace reauth often fails in agent shells)
gcloud auth login
gcloud config set project sameerv

# 1b. REQUIRED once: enable Compute Engine
# https://console.cloud.google.com/apis/api/compute.googleapis.com/overview?project=sameerv
gcloud services enable compute.googleapis.com iap.googleapis.com oslogin.googleapis.com --project=sameerv

# 1c. REQUIRED once: give Actions deployer permission to create the VM
# (Cloud Run deployer alone cannot allocate IPs / create GCE instances)
gcloud projects add-iam-policy-binding sameerv \
  --member="serviceAccount:deployer@sameerv.iam.gserviceaccount.com" \
  --role="roles/compute.admin"
gcloud projects add-iam-policy-binding sameerv \
  --member="serviceAccount:deployer@sameerv.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
gcloud projects add-iam-policy-binding sameerv \
  --member="serviceAccount:deployer@sameerv.iam.gserviceaccount.com" \
  --role="roles/iap.tunnelResourceAccessor"

# 2. Prefer GitHub Actions (after API enable):
#    Actions → "Deploy to Cloud Run (development)" → Run workflow
#    provision_erpnext=true, letsencrypt=true, seed=true
#    Default host: erp-dev.<static-ip>.sslip.io (no corporate DNS needed)
#    Then set Actions variable ERP_DEV_HOST from the job summary.

# 2-alt. Or provision locally:
export ERP_DEV_HOST=erp-dev.YOUR_DOMAIN   # or erp-dev.<ip>.sslip.io after IP allocate
./erpnext/scripts/gce-dev-provision.sh
./erpnext/scripts/gce-dev-provision.sh --letsencrypt
gcloud compute ssh rt-erpnext-dev --zone=asia-south1-a --project=sameerv --tunnel-through-iap \
  --command="sudo -u frappe ERP_DEV_HOST=\$ERP_DEV_HOST REPO_DOCS=/path/to/docs bash /tmp/gce-dev-seed.sh"

# 3. Tablet local.properties:
#    erp.dev.baseUrl=https://$ERP_DEV_HOST/api/
```

## Push / CI notes

- Feature branch (scripts + seed gate):  
  `feature/macos-bootstrap/javed/20261116`  
  Compare → PR:  
  https://github.com/sameervaghela2121/extraction/compare/development...feature/macos-bootstrap/javed/20261116?expand=1
- Full workflow YAML also lives at `erpnext/ci/deploy-development.yml`
  (see `erpnext/ci/README.md`). Paste that into
  `.github/workflows/deploy-development.yml` via the GitHub web UI, or
  push with a PAT that has **`workflow`** scope. It adds `deploy-erpnext`
  and points the portal at `https://$ERP_DEV_HOST/api`.
- Tablet Dev BASE_URL change is on GitLab branch  
  `feature/partial-roll-return-and-sell/javed/20261116`  
  (open MR into `development` from the GitLab UI).

After provision + DNS + `ERP_DEV_HOST` variable + workflow on `development`,
inventory Dev portal/tablet talk only to ERPNext on GCE.

## Live Dev status (2026-11-18)

| Item | Value |
|---|---|
| VM | `rt-erpnext-dev` / `34.100.188.35` |
| Host | `erp-dev.34.100.188.35.sslip.io` |
| GitHub var | `ERP_DEV_HOST` set |
| HTTPS / ping | OK (`frappe.ping` → pong) |
| Seed | vendors 74, materials 3, locations 6, users 4 |
| Serve | systemd `frappe-bench-serve` → nginx → `:8000` |
| Login smoke | `operator1@gmail.com` (seeded operator password) OK |

Deployer IAM used for provision: `roles/compute.admin`,
`roles/iap.tunnelResourceAccessor`, `roles/iam.serviceAccountUser` (+ SA Admin
when creating `erpnext-dev-runtime`).
