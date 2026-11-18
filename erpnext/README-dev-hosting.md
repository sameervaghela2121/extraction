# ERPNext Development hosting (GCE)

Dev inventory runs on a **native Frappe bench** on GCE in GCP project **`sameerv`**
(`asia-south1`). The Node Cloud Run `docflow-backend` is **not** used for inventory
portal or tablet Dev builds.

| Resource | Name |
|---|---|
| VM | `rt-erpnext-dev` |
| Static IP | `rt-erpnext-dev-ip` |
| Runtime SA | `erpnext-dev-runtime@sameerv.iam.gserviceaccount.com` |
| Photos bucket | `sameerv-royaltouch-rolls` |
| Site / URL | `https://$ERP_DEV_HOST` (GitHub Actions variable) |

## One-time provision

```bash
# From Royale-Touche-BE/
export ERP_DEV_HOST=erp-dev.example.com   # your DNS name
./erpnext/scripts/gce-dev-provision.sh
# Create DNS A record: $ERP_DEV_HOST → printed static IP
./erpnext/scripts/gce-dev-provision.sh --letsencrypt

# Seed masters + Dev users (password Admin@123)
gcloud compute ssh rt-erpnext-dev --zone=asia-south1-a --project=sameerv --tunnel-through-iap \
  --command="sudo -u frappe ERP_DEV_HOST=$ERP_DEV_HOST bash /tmp/gce-dev-seed.sh"
```

Set GitHub repo variable **`ERP_DEV_HOST`** to the same hostname.

## Ongoing deploy (no manual bench)

Push/merge to branch **`development`**:

- Changes under `erpnext/**` → job **`deploy-erpnext`** SSHs via IAP and runs
  [`gce-dev-deploy.sh`](scripts/gce-dev-deploy.sh) (`migrate` + restart).
- Changes under `frontend/**` → **`deploy-frontend`** builds the portal with
  `VITE_API_BASE_URL=https://$ERP_DEV_HOST/api` (not Node).

Manual deploy on the VM:

```bash
sudo -u frappe ERP_DEV_HOST=$ERP_DEV_HOST GIT_SHA=origin/development \
  bash /tmp/gce-dev-deploy.sh
```

## Clients

| Client | Points at |
|---|---|
| Cloud Run `docflow-frontend` (Dev) | `https://$ERP_DEV_HOST/api` |
| Tablet **dev** flavor | `https://$ERP_DEV_HOST/api/` |
| Tablet **erp** flavor | `local.properties` `erp.baseUrl` (local/ngrok) |

## Dev logins after seed

See `royal_touche.setup.dev_seed`: `supervisor1@gmail.com`, `operator1@gmail.com`, etc.,
password `Admin@123`. Site has `rt_environment=development` and `developer_mode=1`.
