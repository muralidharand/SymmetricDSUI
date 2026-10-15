#!/bin/bash
# Restores AdventureWorksLT2022 twice (AW_Source, AW_Target) and prepares logins. Idempotent.
set -euo pipefail
SQLCMD="/opt/mssql-tools18/bin/sqlcmd -C -I -S mssql -U sa -P ${MSSQL_SA_PASSWORD} -b"
for i in $(seq 1 30); do $SQLCMD -Q "SELECT 1" >/dev/null 2>&1 && break; sleep 2; done
echo "== restore"
$SQLCMD -i /init/01-restore.sql
echo "== prepare"
$SQLCMD -v SYMDS_PWD="${SYMDS_DB_PASSWORD}" MONITOR_PWD="${MONITOR_RO_PASSWORD}" -i /init/02-prepare.sql
echo "== done"
