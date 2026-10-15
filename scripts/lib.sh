#!/bin/bash
# shared helpers (sourced by the other scripts)
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ -f .env ] || { echo "ERROR: .env not found. Run: cp .env.example .env  (then edit the passwords)"; exit 1; }
set -a; . ./.env; set +a
sql()  { docker compose exec -T mssql /opt/mssql-tools18/bin/sqlcmd -C -I -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -W -b "$@"; }
symadmin() { local c=$1; shift; docker compose exec -T "$c" /opt/symmetric-ds/bin/symadmin "$@"; }
