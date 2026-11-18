#!/usr/bin/env bash
# A private MariaDB for the local ERPNext bench, run as the current user on port 3307.
# It never touches the system MySQL on 3306 and needs no sudo.
#
#   local-mariadb.sh init     download MariaDB, create the data directory, set the root password
#   local-mariadb.sh start    start the server in the background
#   local-mariadb.sh stop     stop it
#   local-mariadb.sh status   say whether it is running
#
# The root password is read from $RT_MARIADB_ROOT_PASSWORD, or from
# ~/.config/rt-mariadb/root-password (created by init, mode 600).
set -euo pipefail

VERSION="${RT_MARIADB_VERSION:-11.4.13}"
PORT="${RT_MARIADB_PORT:-3307}"
OPT="$HOME/.local/opt"
BASE="$OPT/mariadb-$VERSION-linux-systemd-x86_64"
DATA="$HOME/.local/share/rt-mariadb"
RUN="$DATA/run"
CONF_DIR="$HOME/.config/rt-mariadb"
CNF="$CONF_DIR/my.cnf"
PASS_FILE="$CONF_DIR/root-password"
URL="https://archive.mariadb.org/mariadb-$VERSION/bintar-linux-systemd-x86_64/mariadb-$VERSION-linux-systemd-x86_64.tar.gz"

root_password() {
  if [[ -n "${RT_MARIADB_ROOT_PASSWORD:-}" ]]; then echo "$RT_MARIADB_ROOT_PASSWORD"; else cat "$PASS_FILE"; fi
}

# Ubuntu 24.04+ renamed libaio.so.1 to libaio.so.1t64 (same ABI on 64-bit). The generic
# tarball still asks for the old name, so give it a private link instead of a system change.
compat_libs() {
  local compat="$BASE/lib/compat"
  mkdir -p "$compat"
  if ! ldconfig -p | grep -q 'libaio.so.1 '; then
    local t64
    t64=$(ldconfig -p | awk '/libaio.so.1t64 /{print $NF; exit}')
    if [[ -z "$t64" ]]; then
      echo "MariaDB needs libaio. Run:  sudo apt install libaio1t64" >&2
      exit 1
    fi
    ln -sf "$t64" "$compat/libaio.so.1"
  fi
  export LD_LIBRARY_PATH="$compat${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
}

write_cnf() {
  mkdir -p "$CONF_DIR" "$RUN"
  cat > "$CNF" <<CNF
[mysqld]
basedir = $BASE
datadir = $DATA/db
port = $PORT
bind-address = 127.0.0.1
socket = $RUN/mysqld.sock
pid-file = $RUN/mysqld.pid
log-error = $DATA/mysqld.err
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
skip-character-set-client-handshake
innodb-buffer-pool-size = 512M

[client]
port = $PORT
socket = $RUN/mysqld.sock
default-character-set = utf8mb4
CNF
}

is_running() {
  [[ -f "$RUN/mysqld.pid" ]] && kill -0 "$(cat "$RUN/mysqld.pid")" 2>/dev/null
}

wait_up() {
  for _ in $(seq 1 60); do
    "$BASE/bin/mariadb-admin" --defaults-file="$CNF" -uroot ${1:+-p"$1"} ping >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  echo "MariaDB did not come up; see $DATA/mysqld.err" >&2
  return 1
}

cmd_init() {
  mkdir -p "$OPT"
  # The last file the tarball unpacks is under share/, so a run cut off half-way is caught
  # by the install script or share/ being missing, not just bin/.
  if [[ ! -x "$BASE/scripts/mariadb-install-db" || ! -d "$BASE/share" ]]; then
    echo "Downloading MariaDB $VERSION ..."
    rm -rf "$BASE"
    local tmp="$OPT/.mariadb-$VERSION.tar.gz"
    curl -fL --progress-bar -o "$tmp" "$URL"
    tar -xzf "$tmp" -C "$OPT"
    rm -f "$tmp"
  fi
  compat_libs
  write_cnf
  if [[ -d "$DATA/db/mysql" ]]; then
    echo "Data directory already initialised: $DATA/db"
    return 0
  fi
  "$BASE/scripts/mariadb-install-db" --defaults-file="$CNF" --auth-root-authentication-method=normal >/dev/null
  if [[ ! -s "$PASS_FILE" ]]; then
    ( umask 077; head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$PASS_FILE" )
  fi
  cmd_start_nopass
  # Drop the anonymous users mariadb-install-db creates: they match 'localhost' before the
  # '%' account Frappe makes for each site, so the site's own login would be refused.
  "$BASE/bin/mariadb" --defaults-file="$CNF" -uroot \
    -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$(root_password)';
        DROP USER IF EXISTS ''@'localhost'; DROP USER IF EXISTS ''@'$(hostname)';
        DROP DATABASE IF EXISTS test; FLUSH PRIVILEGES;"
  echo "Initialised. Root password is in $PASS_FILE"
}

cmd_start_nopass() {
  "$BASE/bin/mariadbd-safe" --defaults-file="$CNF" >/dev/null 2>&1 &
  wait_up ""
}

cmd_start() {
  compat_libs
  if is_running; then echo "already running on $PORT"; return 0; fi
  "$BASE/bin/mariadbd-safe" --defaults-file="$CNF" >/dev/null 2>&1 &
  wait_up "$(root_password)"
  echo "running on $PORT"
}

cmd_stop() {
  compat_libs
  if ! is_running; then echo "not running"; return 0; fi
  "$BASE/bin/mariadb-admin" --defaults-file="$CNF" -uroot -p"$(root_password)" shutdown
  echo "stopped"
}

cmd_status() {
  if is_running; then echo "running on $PORT (pid $(cat "$RUN/mysqld.pid"))"; else echo "not running"; exit 1; fi
}

case "${1:-}" in
  init) cmd_init ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
