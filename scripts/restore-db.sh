#!/bin/bash
# Re-restore AdventureWorksLT2022.bak as AW_Source and AW_Target, then re-initialise the sync from scratch.
# DESTROYS current data in both databases AND the SymmetricDS sync state (sym_* tables live inside the DBs).
# The SQL Server container and its other data are kept. Use --yes to skip the confirmation.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
docker info >/dev/null 2>&1 || { echo "ERROR: Docker is not running."; exit 1; }
[ -f data/AdventureWorksLT2022.bak ] || { echo "ERROR: data/AdventureWorksLT2022.bak not found."; exit 1; }
if [ "$1" != "--yes" ]; then
  read -r -p "This DROPS AW_Source and AW_Target and re-restores them from the .bak. Type YES to continue: " a
  [ "$a" = "YES" ] || { echo "Aborted."; exit 1; }
fi
echo "== stopping SymmetricDS + monitor"
docker compose rm -sf monitor sym-source sym-target >/dev/null 2>&1   # recreate => no stale staging/state
docker compose up -d mssql >/dev/null
docker compose wait mssql-init >/dev/null 2>&1 || true
echo -n "waiting for SQL Server"
for i in $(seq 1 40); do sql -h -1 -Q "SELECT 1" >/dev/null 2>&1 && break; echo -n .; sleep 3; done; echo
echo "== dropping databases"
sql -Q "
IF DB_ID('AW_Source') IS NOT NULL BEGIN ALTER DATABASE AW_Source SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE AW_Source; END
IF DB_ID('AW_Target') IS NOT NULL BEGIN ALTER DATABASE AW_Target SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE AW_Target; END" || { echo "ERROR: could not drop databases"; exit 1; }
echo "== restoring + re-initialising sync (scripts/up.sh)"
exec scripts/up.sh
