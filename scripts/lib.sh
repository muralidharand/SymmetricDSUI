#!/bin/bash
# shared helpers
cd "$(dirname "${BASH_SOURCE[0]}")/.."
set -a; . ./.env; set +a
sql()  { docker compose exec -T mssql /opt/mssql-tools18/bin/sqlcmd -C -I -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -W -b "$@"; }
symadmin() { local c=$1; shift; docker compose exec -T "$c" /opt/symmetric-ds/bin/symadmin "$@"; }
