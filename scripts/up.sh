#!/bin/bash
# One-command bring-up:
#   SQL Server 2022 + restore (AW_Source, AW_Target) -> source node -> sync config -> open registration
#   -> target node -> automatic initial load -> wait for parity -> monitor UI
# Idempotent: safe to re-run. Use scripts/reset.sh to start from zero.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

docker info >/dev/null 2>&1 || { echo "ERROR: Docker is not running. Start Docker Desktop and retry."; exit 1; }
[ -f data/AdventureWorksLT2022.bak ] || { echo "ERROR: put AdventureWorksLT2022.bak in ./data/ first."; exit 1; }
[ "$(stat -c %s data/AdventureWorksLT2022.bak 2>/dev/null || echo 1)" -gt 1000000 ] || { echo "ERROR: data/AdventureWorksLT2022.bak looks too small (git-lfs pointer / failed download?)."; exit 1; }
for v in MSSQL_SA_PASSWORD SYMDS_DB_PASSWORD MONITOR_RO_PASSWORD; do
  [ -n "${!v}" ] || { echo "ERROR: $v is empty in .env"; exit 1; }
  case "${!v}" in *[\\\"\'\$\ \#]*) echo "ERROR: $v must not contain backslash, quotes, \$, # or spaces (breaks .env / .properties parsing)."; exit 1;; esac
done

# SymmetricDS engine files contain the DB password, so they are generated from .env and are git-ignored.
for e in source-000 target-001; do
  f=symds/engines/$e.properties
  if [ ! -f "$f" ]; then
    t=$(<"$f.example"); printf '%s\n' "${t//CHANGE_ME/"$SYMDS_DB_PASSWORD"}" > "$f"; echo "generated $f"
  fi
done

echo "== SQL Server + restore"
docker compose up -d mssql mssql-init
docker compose wait mssql-init >/dev/null || { echo "ERROR: restore failed:"; docker compose logs mssql-init | tail -20; exit 1; }

echo "== source node"
docker compose up -d sym-source
echo -n "waiting for SymmetricDS to finish creating its tables and default data on AW_Source"
for i in $(seq 1 90); do
  n=$(sql -h -1 -Q "SET NOCOUNT ON; SELECT (SELECT COUNT(*) FROM AW_Source.dbo.sym_channel WHERE channel_id='reload') + (SELECT COUNT(*) FROM AW_Source.dbo.sym_node WHERE node_id='000')" 2>/dev/null | tr -d '[:space:]')
  [ "$n" = "2" ] && break; echo -n .; sleep 3
done; echo
[ "$n" = "2" ] || { echo "ERROR: source node did not initialise. Logs:"; docker compose logs --tail 30 sym-source; exit 1; }
sql -d AW_Source -i /dev/stdin < symds/config/sym-config.sql || { echo "ERROR: loading symds/config/sym-config.sql failed"; exit 1; }

echo -n "waiting for capture triggers (registering before they exist => empty initial load)"
for i in $(seq 1 60); do
  n=$(sql -h -1 -d AW_Source -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.triggers WHERE name LIKE 'SYM_ON_%_FOR_W_%'" | tr -d '[:space:]')
  [ "${n:-0}" -ge 33 ] && break; echo -n .; sleep 3
done; echo
[ "${n:-0}" -ge 33 ] || { echo "ERROR: capture triggers were not created (expected 33, found ${n:-0}). Logs:"; docker compose logs --tail 30 sym-source; exit 1; }

echo "== target node"
already=$(sql -h -1 -d AW_Source -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sym_node WHERE node_id='001'" | tr -d '[:space:]')
[ "$already" = "1" ] || symadmin sym-source --engine source-000 open-registration target 001 2>&1 | grep -v Stopping
docker compose up -d sym-target

echo -n "waiting for initial load to reach parity (usually < 1 min)"
ok=0
for i in $(seq 1 60); do
  if scripts/verify-parity.sh >/dev/null 2>&1; then ok=1; break; fi; echo -n .; sleep 5
done; echo
[ $ok = 1 ] && echo "PARITY OK: source and target match" || echo "WARNING: not in parity yet - run scripts/status.sh and see docs/LOCAL-SETUP-WINDOWS11.md, section 8"

if [ -z "$SKIP_MONITOR" ]; then
  echo "== monitor UI"
  docker compose up -d --build monitor
fi
echo
echo "Monitor UI : http://localhost:${MONITOR_PORT:-8080}"
echo "SQL Server : localhost,${MSSQL_PORT:-14330}  user sa  (password from .env)"
echo "Next       : scripts/smoke-test.sh"
