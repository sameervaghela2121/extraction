# Royal Touche on ERPNext — local development

The ERPNext backend for the Royale Touche roll inventory: ERPNext plus our Frappe app
`royal_touche` (in `royal_touche/`). Design: `docs/superpowers/specs/2026-11-03-erpnext-backend-design.md`.

No Docker. Everything runs as your own user:

| Piece | Where | Port |
|---|---|---|
| MariaDB 11.4 (private copy) | `~/.local/opt/mariadb-*`, data in `~/.local/share/rt-mariadb` | 3307 |
| Frappe bench (Frappe + ERPNext `version-16`) | `~/frappe-bench` | 8000 (web), 9000 (socket.io) |
| Redis (started by `bench start`) | inside the bench | 13000, 11000 |

A system MySQL on 3306, if you have one, is left alone.

## Prerequisites

`git`, `curl`, `uv`, Node 24 + `yarn`, `redis-server` on PATH, `wkhtmltopdf`.
Python comes from `uv` (the version the Frappe branch asks for).

## First-time setup

```bash
erpnext/scripts/local-mariadb.sh init     # downloads MariaDB, creates the data dir and root password
erpnext/scripts/local-mariadb.sh start
erpnext/scripts/local-bench.sh            # bench, ERPNext, both sites, setup wizard, our app
```

Both scripts are safe to re-run. Passwords are generated once and kept in
`~/.config/rt-mariadb/root-password` and `~/.config/rt-erpnext/admin-password`.

If MariaDB stops with a message about a missing library, run the `sudo apt install …` line it
prints, then `init` again.

## Daily use

```bash
erpnext/scripts/local-mariadb.sh start    # after a reboot
cd ~/frappe-bench && bench start          # web, workers, scheduler, redis
```

Open http://rt.localhost:8000 and log in as `Administrator` with the admin password above.

Sites:
- `rt.localhost`: development, developer mode on.
- `rt-test.localhost`: automated tests only (`allow_tests` on). Tests create and roll back
  their own data here.

## Tests

```bash
cd ~/frappe-bench
bench --site rt-test.localhost run-tests --app royal_touche                       # everything
bench --site rt-test.localhost run-tests --app royal_touche --module royal_touche.tests.test_movements
```

## Stopping

`Ctrl+C` in the `bench start` terminal, then `erpnext/scripts/local-mariadb.sh stop`.
