#!/usr/bin/env bash
# Deploy royal_touche on the Dev GCE bench (run ON the VM, or via CI SSH).
#
# Env:
#   ERP_DEV_HOST   Frappe site name / public hostname (required)
#   GIT_SHA        optional commit to check out (default: origin/development)
#   BENCH_DIR      default /home/frappe/frappe-bench
#   APP_DIR        default $BENCH_DIR/apps/royal_touche
set -euo pipefail

ERP_DEV_HOST="${ERP_DEV_HOST:?ERP_DEV_HOST is required}"
BENCH_DIR="${BENCH_DIR:-/home/frappe/frappe-bench}"
APP_DIR="${APP_DIR:-$BENCH_DIR/apps/royal_touche}"
GIT_SHA="${GIT_SHA:-origin/development}"

if [[ ! -d "$BENCH_DIR" ]]; then
  echo "Bench not found at $BENCH_DIR" >&2
  exit 1
fi
if [[ ! -d "$APP_DIR/.git" && ! -d "$APP_DIR" ]]; then
  echo "App not found at $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"
echo "== Updating royal_touche ($GIT_SHA) =="
# App may be a full git checkout of the BE repo (subdir erpnext/royal_touche) or a
# standalone clone of the app folder. Prefer fetch + checkout when .git exists.
if [[ -d .git ]]; then
  git fetch --prune origin
  git checkout --force "$GIT_SHA"
  git submodule update --init --recursive 2>/dev/null || true
elif [[ -d "$BENCH_DIR/apps/extraction/.git" ]]; then
  # Monorepo clone layout: apps/extraction is the BE repo; royal_touche is a symlink.
  git -C "$BENCH_DIR/apps/extraction" fetch --prune origin
  git -C "$BENCH_DIR/apps/extraction" checkout --force "$GIT_SHA"
else
  echo "No git remote for royal_touche; skipping checkout (files must already be current)" >&2
fi

cd "$BENCH_DIR"
echo "== Migrating site $ERP_DEV_HOST =="
bench --site "$ERP_DEV_HOST" migrate

echo "== Clearing cache =="
bench --site "$ERP_DEV_HOST" clear-cache

echo "== Restarting =="
if command -v supervisorctl >/dev/null 2>&1; then
  sudo supervisorctl restart all || bench restart
else
  bench restart
fi

echo "== Health check =="
curl -fsS -H "Host: $ERP_DEV_HOST" -H "Accept: application/json" \
  "https://$ERP_DEV_HOST/api/method/frappe.ping" \
  || curl -fsS -H "Host: $ERP_DEV_HOST" -H "Accept: application/json" \
  "http://127.0.0.1/api/method/frappe.ping" \
  || echo "WARN: ping failed (nginx may still be starting)"

echo "Deploy complete."
