#!/usr/bin/env bash
# Load masters + Dev role users onto the Dev ERPNext site (run ON the VM).
#
# Env:
#   ERP_DEV_HOST   Frappe site (required)
#   BENCH_DIR      default /home/frappe/frappe-bench
#   REPO_DOCS      path to vendors/locations/remarks seed JSON (default: monorepo docs/)
set -euo pipefail

ERP_DEV_HOST="${ERP_DEV_HOST:?ERP_DEV_HOST is required}"
BENCH_DIR="${BENCH_DIR:-/home/frappe/frappe-bench}"

# Prefer monorepo checkout docs/, then apps/royal_touche sibling docs if present.
if [[ -z "${REPO_DOCS:-}" ]]; then
  for candidate in \
    "$BENCH_DIR/apps/extraction/docs" \
    "$BENCH_DIR/apps/royal_touche/../../docs" \
    "/home/frappe/extraction/docs"
  do
    if [[ -f "$candidate/vendors-seed.json" ]]; then
      REPO_DOCS="$candidate"
      break
    fi
  done
fi
REPO_DOCS="${REPO_DOCS:?Could not find docs/ with vendors-seed.json; set REPO_DOCS}"

cd "$BENCH_DIR"
echo "== Seeding $ERP_DEV_HOST from $REPO_DOCS =="
bench --site "$ERP_DEV_HOST" execute royal_touche.setup.dev_seed.load \
  --kwargs "{\"repo_docs\": \"$REPO_DOCS\"}"

echo "Seed complete. Dev users password is Admin@123 (see royal_touche.setup.dev_seed)."
