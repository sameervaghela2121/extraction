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

# Prefer a simple systemd unit over full `bench setup production` (fail2ban/ansible
# often fail on a fresh Ubuntu image; nginx already terminates TLS and proxies :8000).
if [[ ! -f /etc/systemd/system/frappe-bench-serve.service ]]; then
  cat >/etc/systemd/system/frappe-bench-serve.service <<'UNIT'
[Unit]
Description=Frappe bench serve (Dev ERPNext)
After=network.target mariadb.service redis-server.service
Wants=mariadb.service redis-server.service

[Service]
Type=simple
User=frappe
Group=frappe
WorkingDirectory=/home/frappe/frappe-bench
Environment=HOME=/home/frappe
Environment=PATH=/home/frappe/.local/bin:/home/frappe/frappe-bench/env/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/frappe/.local/bin/bench serve --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now frappe-bench-serve.service
fi

# nginx site → 127.0.0.1:8000 if not already configured by letsencrypt/certbot
if [[ ! -f /etc/nginx/sites-enabled/erpnext-dev ]]; then
  cat >/etc/nginx/sites-available/erpnext-dev <<NGX
server {
  listen 80;
  server_name ${ERP_DEV_HOST};
  client_max_body_size 50m;
  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGX
  ln -sfn /etc/nginx/sites-available/erpnext-dev /etc/nginx/sites-enabled/erpnext-dev
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
fi

echo "finish-install complete for $ERP_DEV_HOST"
