#!/usr/bin/env bash
# macOS bootstrap for Royale Touche ERPNext local stack.
# The Linux-only local-mariadb.sh does not work on Mac. Run this in Terminal.app
# (needs your Mac password once for Homebrew in /opt/homebrew on Apple Silicon).
set -euo pipefail

# If Terminal is under Rosetta on Apple Silicon, re-exec as native arm64.
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == "1" && "$(uname -m)" != "arm64" ]]; then
  echo "== Re-running as native arm64 (Terminal was under Rosetta) =="
  exec arch -arm64 /bin/bash "$0" "$@"
fi

ARCH="$(uname -m)"
echo "== Host arch: $ARCH =="

if [[ "$ARCH" == "arm64" ]]; then
  BREW_PREFIX="/opt/homebrew"
else
  BREW_PREFIX="/usr/local"
  echo "Note: Intel Homebrew may build MariaDB from source (slow)." >&2
fi

if [[ ! -x "$BREW_PREFIX/bin/brew" ]]; then
  echo "== Installing Homebrew to $BREW_PREFIX =="
  echo "Enter your Mac login password when asked (sudo)."
  # Must be interactive — NONINTERACTIVE=1 cannot collect a sudo password and fails with
  # "Insufficient permissions to install Homebrew".
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
if [[ ! -x "$BREW_PREFIX/bin/brew" ]]; then
  echo "Homebrew still missing at $BREW_PREFIX/bin/brew." >&2
  echo "Your account may lack admin rights. Ask IT to grant admin, or run:" >&2
  echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"" >&2
  exit 1
fi
# shellcheck disable=SC1091
eval "$("$BREW_PREFIX/bin/brew" shellenv)"

echo "== Installing mariadb redis (uv/yarn already ok if present) =="
brew install mariadb redis
command -v uv >/dev/null || brew install uv
command -v yarn >/dev/null || brew install yarn

# Prefer a private instance on 3307 so we don't fight a system MySQL on 3306.
CONF_DIR="$HOME/.config/rt-mariadb"
PASS_FILE="$CONF_DIR/root-password"
DATA="$HOME/.local/share/rt-mariadb-homebrew"
mkdir -p "$CONF_DIR" "$DATA" "$HOME/.local/bin"
[[ -s "$PASS_FILE" ]] || ( umask 077; head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$PASS_FILE" )
ROOT_PASS=$(cat "$PASS_FILE")

# Stop any brew services on default port; we'll run mysqld ourselves on 3307.
brew services stop mariadb 2>/dev/null || true

# Initialize datadir once
if [[ ! -d "$DATA/mysql" ]]; then
  echo "== Initialising MariaDB datadir at $DATA =="
  mariadb-install-db --datadir="$DATA" --auth-root-authentication-method=normal
fi

# Start on 3307 if not already
if ! mariadb-admin --host=127.0.0.1 --port=3307 -uroot -p"$ROOT_PASS" ping >/dev/null 2>&1; then
  if ! mariadb-admin --host=127.0.0.1 --port=3307 -uroot ping >/dev/null 2>&1; then
    mysqld_safe --datadir="$DATA" --port=3307 --bind-address=127.0.0.1 --socket="$DATA/mysql.sock" >/dev/null 2>&1 &
    for _ in $(seq 1 60); do
      mariadb-admin --host=127.0.0.1 --port=3307 -uroot ping >/dev/null 2>&1 && break
      sleep 0.5
    done
    mariadb --host=127.0.0.1 --port=3307 -uroot \
      -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$ROOT_PASS';
          CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '$ROOT_PASS';
          GRANT ALL ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;
          DROP USER IF EXISTS ''@'localhost'; FLUSH PRIVILEGES;"
  else
    mariadb --host=127.0.0.1 --port=3307 -uroot \
      -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$ROOT_PASS'; FLUSH PRIVILEGES;" || true
  fi
fi

# Ensure redis is available
if ! redis-cli ping >/dev/null 2>&1; then
  redis-server --daemonize yes
fi

echo
echo "== Bootstrap done =="
echo "MariaDB root password: $PASS_FILE"
echo "MariaDB: 127.0.0.1:3307"
echo
echo "Next:"
echo "  eval \"\$($BREW_PREFIX/bin/brew shellenv)\""
echo "  cd $(cd "$(dirname "$0")/../.." && pwd)"
echo "  ./erpnext/scripts/local-bench.sh"
echo "  cd ~/frappe-bench && bench start"
