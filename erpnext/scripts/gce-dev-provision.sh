#!/usr/bin/env bash
# One-time (safe re-run) provision of Dev ERPNext on GCE in GCP project sameerv.
#
# Prerequisites:
#   gcloud authenticated with rights on sameerv
#   ERP_DEV_HOST = public DNS name (A record → static IP before --letsencrypt)
#
# Usage:
#   export ERP_DEV_HOST=erp-dev.example.com
#   ./erpnext/scripts/gce-dev-provision.sh
#   # after DNS:
#   ./erpnext/scripts/gce-dev-provision.sh --letsencrypt
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_ID="${PROJECT_ID:-sameerv}"
REGION="${REGION:-asia-south1}"
ZONE="${ZONE:-asia-south1-a}"
VM_NAME="${VM_NAME:-rt-erpnext-dev}"
IP_NAME="${IP_NAME:-rt-erpnext-dev-ip}"
SA_NAME="${SA_NAME:-erpnext-dev-runtime}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
FIREWALL_NAME="${FIREWALL_NAME:-allow-erpnext-dev}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-2}"
DISK_SIZE_GB="${DISK_SIZE_GB:-50}"
GCS_BUCKET="${GCS_BUCKET:-sameerv-royaltouch-rolls}"
ERP_GIT_URL="${ERP_GIT_URL:-https://github.com/sameervaghela2121/extraction.git}"
ERP_GIT_BRANCH="${ERP_GIT_BRANCH:-development}"
DO_LETSENCRYPT=0

for arg in "$@"; do
  case "$arg" in
    --letsencrypt) DO_LETSENCRYPT=1 ;;
    --help|-h) sed -n '1,20p' "$0"; exit 0 ;;
  esac
done

ERP_DEV_HOST="${ERP_DEV_HOST:?Set ERP_DEV_HOST to the public hostname (e.g. erp-dev.example.com)}"

echo "== Project $PROJECT_ID / zone $ZONE / host $ERP_DEV_HOST =="
gcloud config set project "$PROJECT_ID" >/dev/null

if ! gcloud compute addresses describe "$IP_NAME" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "== Creating static IP $IP_NAME =="
  gcloud compute addresses create "$IP_NAME" --region="$REGION" --project="$PROJECT_ID"
fi
STATIC_IP=$(gcloud compute addresses describe "$IP_NAME" --region="$REGION" --project="$PROJECT_ID" --format='value(address)')
echo "Static IP: $STATIC_IP"
echo "DNS A record required: $ERP_DEV_HOST -> $STATIC_IP"

if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "== Creating service account $SA_EMAIL =="
  gcloud iam service-accounts create "$SA_NAME" \
    --project="$PROJECT_ID" \
    --display-name="ERPNext Dev runtime"
fi
gcloud storage buckets add-iam-policy-binding "gs://${GCS_BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/storage.objectAdmin" \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "WARN: grant $SA_EMAIL roles/storage.objectAdmin on gs://$GCS_BUCKET manually"

if ! gcloud compute firewall-rules describe "$FIREWALL_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "== Creating firewall $FIREWALL_NAME =="
  gcloud compute firewall-rules create "$FIREWALL_NAME" \
    --project="$PROJECT_ID" \
    --allow=tcp:22,tcp:80,tcp:443 \
    --target-tags=erpnext-dev \
    --description="SSH and HTTPS for rt-erpnext-dev"
fi

STARTUP_LOCAL=$(mktemp)
trap 'rm -f "$STARTUP_LOCAL"' EXIT
cat > "$STARTUP_LOCAL" <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
MARKER=/var/lib/rt-erpnext-provisioned
[[ -f "$MARKER" ]] && exit 0
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl nginx redis-server mariadb-server \
  python3-dev python3-venv python3-pip python3-setuptools pipx \
  libffi-dev libssl-dev libmariadb-dev pkg-config \
  build-essential cron wv wkhtmltopdf software-properties-common
# Frappe v16 needs Node ≥24
if ! command -v node >/dev/null || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
npm install -g yarn
id -u frappe >/dev/null 2>&1 || useradd -m -s /bin/bash frappe
echo "frappe ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/frappe
chmod 440 /etc/sudoers.d/frappe
# MariaDB: allow password auth for site DB users (unix_socket root alone breaks bench new-site)
mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD('root'); FLUSH PRIVILEGES;" 2>/dev/null \
  || mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED BY 'root'; FLUSH PRIVILEGES;" 2>/dev/null || true
# Frappe v16 wants a modern CPython (3.14 via uv); system python3 may be too old/new for bench
su - frappe -c 'curl -fsSL https://astral.sh/uv/install.sh | sh'
su - frappe -c 'export PATH="$HOME/.local/bin:$PATH"; uv python install 3.14; uv python find 3.14 > /tmp/rt-python'
RT_PYTHON=$(cat /tmp/rt-python 2>/dev/null || echo python3)
# PEP 668: install bench with pipx, not pip --user
su - frappe -c 'export PATH="$HOME/.local/bin:$PATH"; pipx ensurepath; pipx install frappe-bench || pipx upgrade frappe-bench'
su - frappe -c "export PATH=\"\$HOME/.local/bin:\$PATH\"; cd \$HOME; [[ -d frappe-bench ]] || bench init --frappe-branch version-16 --python '$RT_PYTHON' frappe-bench"
su - frappe -c 'export PATH="$HOME/.local/bin:$PATH"; cd $HOME/frappe-bench; bench get-app --branch version-16 erpnext || true'
# Point redis queues at system redis (6379) if bench left defaults pointing at missing 11000
su - frappe -c 'python3 - <<"PY"
import json, pathlib
p = pathlib.Path.home() / "frappe-bench/sites/common_site_config.json"
if p.exists():
    c = json.loads(p.read_text())
    c.setdefault("redis_cache", "redis://127.0.0.1:6379")
    c.setdefault("redis_queue", "redis://127.0.0.1:6379")
    c.setdefault("redis_socketio", "redis://127.0.0.1:6379")
    p.write_text(json.dumps(c, indent=1))
PY'
touch "$MARKER"
EOS

if ! gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "== Creating VM $VM_NAME =="
  gcloud compute instances create "$VM_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family=ubuntu-2404-lts-amd64 \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size="${DISK_SIZE_GB}GB" \
    --address="$IP_NAME" \
    --tags=erpnext-dev \
    --service-account="$SA_EMAIL" \
    --scopes=https://www.googleapis.com/auth/cloud-platform \
    --metadata-from-file=startup-script="$STARTUP_LOCAL"
else
  echo "== VM $VM_NAME already exists =="
fi

echo "== Waiting for SSH / startup marker =="
for i in $(seq 1 90); do
  if gcloud compute ssh "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" --tunnel-through-iap \
    --command="test -f /var/lib/rt-erpnext-provisioned && echo READY" 2>/dev/null | grep -q READY; then
    echo "Startup ready"
    break
  fi
  echo "  … ($i)"
  sleep 10
done

echo "== Upload finish-install + run =="
gcloud compute scp --zone="$ZONE" --project="$PROJECT_ID" --tunnel-through-iap \
  "$SCRIPT_DIR/gce-dev-finish-install.sh" "$SCRIPT_DIR/gce-dev-deploy.sh" "$SCRIPT_DIR/gce-dev-seed.sh" \
  "$VM_NAME:/tmp/"

gcloud compute ssh "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" --tunnel-through-iap --command="
  sudo chmod +x /tmp/gce-dev-*.sh
  sudo ERP_DEV_HOST='${ERP_DEV_HOST}' ERP_GIT_URL='${ERP_GIT_URL}' ERP_GIT_BRANCH='${ERP_GIT_BRANCH}' \
    GCS_BUCKET='${GCS_BUCKET}' /tmp/gce-dev-finish-install.sh
"

if [[ "$DO_LETSENCRYPT" -eq 1 ]]; then
  echo "== Let's Encrypt =="
  gcloud compute ssh "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" --tunnel-through-iap --command="
    sudo -u frappe -H bash -c 'export PATH=\$HOME/.local/bin:\$PATH; cd \$HOME/frappe-bench; sudo bench setup lets-encrypt ${ERP_DEV_HOST} --yes' \
      || sudo certbot --nginx -d '${ERP_DEV_HOST}' --non-interactive --agree-tos --register-unsafely-without-email || true
  "
fi

echo
echo "== Provision summary =="
echo "VM:    $VM_NAME ($ZONE)"
echo "IP:    $STATIC_IP"
echo "Site:  https://$ERP_DEV_HOST"
echo "DNS:   A $ERP_DEV_HOST -> $STATIC_IP"
echo
echo "Next:"
echo "  1. DNS A record, then: ERP_DEV_HOST=$ERP_DEV_HOST $0 --letsencrypt"
echo "  2. Seed: gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID --tunnel-through-iap --command=\"sudo -u frappe ERP_DEV_HOST=$ERP_DEV_HOST bash /tmp/gce-dev-seed.sh\""
echo "  3. GitHub variable ERP_DEV_HOST=$ERP_DEV_HOST"
echo "  4. Merge to development for CI deploy"
