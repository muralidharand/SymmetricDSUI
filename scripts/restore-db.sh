#!/bin/bash
# Drop AW_Source + AW_Target, re-restore from the .bak, re-run initial load. Asks for YES unless --yes.
cd "$(dirname "$0")/.."
if [ "$1" != "--yes" ]; then read -r -p "This DROPS both databases and all sync state. Type YES: " a; [ "$a" = "YES" ] || { echo Aborted; exit 1; }; fi
docker compose rm -sf monitor sym-target sym-config sym-source >/dev/null 2>&1
docker compose up -d mssql && docker compose run --rm tools drop-dbs || exit 1
exec scripts/up.sh
