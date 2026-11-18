# Operator checklist — Dev ERPNext provision

The agent environment that added these scripts did **not** have `gcloud` or
`ERP_DEV_HOST`. Run this once on a machine with GCP access to `sameerv`.

```bash
# 1. Install Google Cloud SDK if needed, then:
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

After that, merges to `development` that touch `erpnext/**` or `frontend/**` deploy automatically.
