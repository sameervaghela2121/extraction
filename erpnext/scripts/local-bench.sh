#!/usr/bin/env bash
# Local Frappe bench with ERPNext and our royal_touche app — no Docker.
# Needs the private MariaDB from local-mariadb.sh running on 3307.
#
#   local-bench.sh            set everything up (safe to re-run; finished steps are skipped)
#
# Creates ~/frappe-bench with two sites:
#   rt.localhost        for development (http://rt.localhost:8000)
#   rt-test.localhost   for automated tests (allow_tests on)
set -euo pipefail

BRANCH="${RT_FRAPPE_BRANCH:-version-16}"
BENCH="${RT_BENCH_DIR:-$HOME/frappe-bench}"
DB_PORT="${RT_MARIADB_PORT:-3307}"
SITES=(rt.localhost rt-test.localhost)
CONF_DIR="$HOME/.config/rt-erpnext"
ADMIN_PASS_FILE="$CONF_DIR/admin-password"
DB_ROOT_PASS="${RT_MARIADB_ROOT_PASSWORD:-$(cat "$HOME/.config/rt-mariadb/root-password")}"
REPO_APP="$(cd "$(dirname "$0")/.." && pwd)/royal_touche"
# Frappe shells out to the mariadb client for schema restores; use the one that matches our
# server, ahead of any system MySQL client.
MARIADB_BASE=$(ls -d "$HOME"/.local/opt/mariadb-*-linux-systemd-x86_64 2>/dev/null | sort -V | tail -1)
[[ -n "$MARIADB_BASE" ]] && export PATH="$MARIADB_BASE/bin:$PATH" LD_LIBRARY_PATH="$MARIADB_BASE/lib/compat${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

say() { printf '\n== %s\n' "$*"; }

# Python and Node come from the Frappe branch itself, so a new branch can't be paired with
# the wrong interpreter by accident.
PY_SPEC=$(curl -fsSL "https://raw.githubusercontent.com/frappe/frappe/$BRANCH/pyproject.toml" \
  | sed -n 's/^requires-python *= *"\(.*\)"/\1/p')
PY_VERSION=$(echo "$PY_SPEC" | grep -oE '[0-9]+\.[0-9]+' | head -1)
say "Frappe $BRANCH needs Python $PY_SPEC"

say "Python $PY_VERSION via uv"
uv python install "$PY_VERSION" >/dev/null
PYTHON=$(uv python find "$PY_VERSION")
echo "$PYTHON"

say "bench CLI"
command -v bench >/dev/null || uv tool install --python "$PYTHON" frappe-bench
bench --version

if [[ ! -d "$BENCH/apps/frappe" ]]; then
  say "bench init $BENCH ($BRANCH)"
  bench init "$BENCH" --frappe-branch "$BRANCH" --python "$PYTHON"
fi
cd "$BENCH"

if [[ ! -d apps/erpnext ]]; then
  say "get-app erpnext ($BRANCH)"
  bench get-app erpnext --branch "$BRANCH"
fi

# Our app lives in the repo; the bench sees it through a link.
if [[ -d "$REPO_APP" && ! -e apps/royal_touche ]]; then
  say "link royal_touche"
  ln -s "$REPO_APP" apps/royal_touche
  ./env/bin/pip install -q -e apps/royal_touche
  if ! grep -qx royal_touche sites/apps.txt; then
    # apps.txt may lack a final newline; appending blindly would glue two app names together.
    [[ -n "$(tail -c1 sites/apps.txt)" ]] && echo >> sites/apps.txt
    echo royal_touche >> sites/apps.txt
  fi
fi

# Site installs need the bench's own Redis (cache + queue). `bench start` runs them normally;
# for setup we start them here and stop them again at the end, so `bench start` finds the
# ports free.
STARTED_REDIS=()
for conf in config/redis_cache.conf config/redis_queue.conf; do
  port=$(awk '/^port /{print $2}' "$conf")
  if ! redis-cli -p "$port" ping >/dev/null 2>&1; then
    redis-server "$conf" --daemonize yes >/dev/null
    STARTED_REDIS+=("$port")
  fi
done
stop_redis() { for port in "${STARTED_REDIS[@]}"; do redis-cli -p "$port" shutdown nosave >/dev/null 2>&1 || true; done; }
trap stop_redis EXIT

mkdir -p "$CONF_DIR"
[[ -s "$ADMIN_PASS_FILE" ]] || ( umask 077; head -c 12 /dev/urandom | base64 | tr -d '/+=' > "$ADMIN_PASS_FILE" )
ADMIN_PASS=$(cat "$ADMIN_PASS_FILE")

for site in "${SITES[@]}"; do
  if [[ ! -d "sites/$site" ]]; then
    say "new-site $site"
    bench new-site "$site" \
      --db-host 127.0.0.1 --db-port "$DB_PORT" \
      --db-root-username root --db-root-password "$DB_ROOT_PASS" \
      --mariadb-user-host-login-scope='%' \
      --admin-password "$ADMIN_PASS" \
      --install-app erpnext
  fi
done
bench --site rt-test.localhost set-config allow_tests true >/dev/null
bench --site rt.localhost set-config developer_mode 1 >/dev/null
bench use rt.localhost >/dev/null

# ERPNext's setup wizard, answered for Royale Touche.
SETUP_ARGS=$(cat <<JSON
{"language": "English", "country": "India", "timezone": "Asia/Kolkata", "currency": "INR",
 "full_name": "Administrator", "email": "admin@rt.localhost", "password": "$ADMIN_PASS",
 "company_name": "Royale Touche", "company_abbr": "RT", "chart_of_accounts": "Standard",
 "fy_start_date": "2026-04-01", "fy_end_date": "2027-03-31", "setup_demo": 0}
JSON
)
for site in "${SITES[@]}"; do
  done_flag=$(bench --site "$site" execute frappe.db.get_single_value --args "['System Settings','setup_complete']" 2>/dev/null | tail -1)
  if [[ "$done_flag" != "1" ]]; then
    say "setup wizard on $site"
    bench --site "$site" execute frappe.desk.page.setup_wizard.setup_wizard.setup_complete \
      --kwargs "{\"args\": $SETUP_ARGS}"
  fi
  if [[ -e apps/royal_touche ]] && ! bench --site "$site" list-apps | grep -q royal_touche; then
    bench --site "$site" install-app royal_touche
  fi
done

say "done"
echo "Frappe/ERPNext: $BRANCH  Python: $PY_VERSION  bench: $BENCH"
echo "Admin password: $ADMIN_PASS_FILE"
echo "Start:  cd $BENCH && bench start   then open http://rt.localhost:8000"
