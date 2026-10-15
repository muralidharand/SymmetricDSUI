#!/bin/bash
# Full bring-up: SQL Server + restore -> source node -> sync config -> open registration -> target node (auto initial load)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
[ -f .env ] || { echo "create .env from .env.example"; exit 1; }
docker compose up -d mssql mssql-init
docker compose wait mssql-init >/dev/null
docker compose up -d sym-source
echo "waiting for sym_ tables on AW_Source..."
for i in $(seq 1 60); do
  n=$(sql -h -1 -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM AW_Source.sys.tables WHERE name='sym_node_group'" 2>/dev/null | tr -d '[:space:]')
  [ "$n" = "1" ] && break; sleep 3
done
sql -d AW_Source -i /dev/stdin < symds/config/sym-config.sql
echo "waiting for capture triggers on replicated tables (registration before this => empty initial load)..."
for i in $(seq 1 60); do
  n=$(sql -h -1 -d AW_Source -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.triggers WHERE name LIKE 'SYM_ON_%_FOR_W_%'" | tr -d '[:space:]')
  [ "$n" -ge 33 ] && break; sleep 3
done
symadmin sym-source --engine source-000 open-registration target 001 2>&1 | grep -v Stopping
docker compose up -d sym-target
echo "initial load runs automatically; run scripts/verify-parity.sh in ~1 min"
