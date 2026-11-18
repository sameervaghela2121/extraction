#!/usr/bin/env bash
# Run on the Dev VM as root (after base packages / bench init from startup script).
# Env: ERP_DEV_HOST, ERP_GIT_URL, ERP_GIT_BRANCH, GCS_BUCKET (optional)
set -euo pipefail

ERP_DEV_HOST="${ERP_DEV_HOST:?ERP_DEV_HOST required}"
ERP_GIT_URL="${ERP_GIT_URL:-https://github.com/sameervaghela2121/extraction.git}"
ERP_GIT_BRANCH="${ERP_GIT_BRANCH:-development}"
ADMIN_PASS="${ADMIN_PASS:-Admin@123}"

for i in $(seq 1 90); do
  [[ -f /var/lib/rt-erpnext-provisioned ]] && break
  echo "Waiting for startup script…"
  sleep 10
done
[[ -f /var/lib/rt-erpnext-provisioned ]] || { echo "Startup script did not finish"; exit 1; }

export PATH="/home/frappe/.local/bin:$PATH"

sudo -u frappe -H env PATH="/home/frappe/.local/bin:$PATH" \
  ERP_DEV_HOST="$ERP_DEV_HOST" ERP_GIT_URL="$ERP_GIT_URL" ERP_GIT_BRANCH="$ERP_GIT_BRANCH" \
  ADMIN_PASS="$ADMIN_PASS" bash <<'EOF'
set -euo pipefail
cd "$HOME/frappe-bench"

if [[ ! -d "sites/${ERP_DEV_HOST}" ]]; then
  bench new-site "$ERP_DEV_HOST" --admin-password "$ADMIN_PASS" || true
fi
bench --site "$ERP_DEV_HOST" install-app erpnext 2>/dev/null || true

mkdir -p "$HOME/src"
if [[ ! -d "$HOME/src/extraction/.git" ]]; then
  git clone --branch "$ERP_GIT_BRANCH" --depth 1 "$ERP_GIT_URL" "$HOME/src/extraction"
else
  git -C "$HOME/src/extraction" fetch origin "$ERP_GIT_BRANCH"
  git -C "$HOME/src/extraction" checkout "$ERP_GIT_BRANCH"
  git -C "$HOME/src/extraction" pull --ff-only "origin" "$ERP_GIT_BRANCH" || true
fi

if [[ ! -e apps/royal_touche ]]; then
  ln -sfn "$HOME/src/extraction/erpnext/royal_touche" apps/royal_touche
  ./env/bin/pip install -e apps/royal_touche
fi
bench --site "$ERP_DEV_HOST" install-app royal_touche 2>/dev/null || bench --site "$ERP_DEV_HOST" migrate

bench --site "$ERP_DEV_HOST" set-config developer_mode 1
bench --site "$ERP_DEV_HOST" set-config rt_environment development
bench --site "$ERP_DEV_HOST" set-config host_name "https://${ERP_DEV_HOST}"
bench --site "$ERP_DEV_HOST" set-config allow_cors "*"
bench --site "$ERP_DEV_HOST" migrate
bench --site "$ERP_DEV_HOST" clear-cache

mkdir -p apps/extraction
ln -sfn "$HOME/src/extraction/docs" apps/extraction/docs 2>/dev/null || true
# Deploy helpers on the VM
mkdir -p "$HOME/bin"
cp -f "$HOME/src/extraction/erpnext/scripts/gce-dev-deploy.sh" "$HOME/bin/" 2>/dev/null || true
cp -f "$HOME/src/extraction/erpnext/scripts/gce-dev-seed.sh" "$HOME/bin/" 2>/dev/null || true
chmod +x "$HOME/bin/"*.sh 2>/dev/null || true
EOF

if [[ ! -f /etc/supervisor/conf.d/frappe-bench.conf ]]; then
  sudo -u frappe -H env PATH="/home/frappe/.local/bin:$PATH" bash -c \
    'cd "$HOME/frappe-bench" && sudo /home/frappe/.local/bin/bench setup production frappe' || true
fi

echo "finish-install complete for $ERP_DEV_HOST"
