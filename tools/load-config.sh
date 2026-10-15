#!/bin/bash
# One-shot job (service sym-config): waits for the source node to finish its own setup, loads symds/config/sym-config.sql,
# then waits until the capture triggers exist. sym-target only starts after this succeeds, so the automatic
# initial load can never run against an empty configuration. Idempotent (skips if already loaded; FORCE=1 reloads).
source /tools/lib.sh
echo -n "waiting for SymmetricDS to create its tables and default data in AW_Source"
for i in $(seq 1 120); do
  n=$(SQLQ -Q "SET NOCOUNT ON; SELECT (SELECT COUNT(*) FROM AW_Source.dbo.sym_channel WHERE channel_id='reload') + (SELECT COUNT(*) FROM AW_Source.dbo.sym_node WHERE node_id='000')" 2>/dev/null)
  [ "$n" = "2" ] && break; echo -n .; sleep 3
done; echo
[ "$n" = "2" ] || { echo "ERROR: source node did not initialise (see: docker compose logs sym-source)"; exit 1; }

have=$(SQLQ -d AW_Source -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sym_trigger WHERE trigger_id LIKE 'aw[_]%'")
if [ "$have" -ge 1 ] && [ -z "$FORCE" ]; then echo "sync config already loaded ($have triggers) - skipping (FORCE=1 to reload)"
else
  SQL -d AW_Source -i /config/sym-config.sql || { echo "ERROR: loading sym-config.sql failed"; exit 1; }
  echo "sync config loaded"
fi

echo -n "waiting for capture triggers (3 per table)"
for i in $(seq 1 100); do
  n=$(SQLQ -d AW_Source -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.triggers WHERE name LIKE 'SYM_ON_%_FOR_W_%'")
  [ "${n:-0}" -ge 33 ] && break; echo -n .; sleep 3
done; echo
[ "${n:-0}" -ge 33 ] || { echo "ERROR: capture triggers missing (found ${n:-0}, expected 33)"; exit 1; }
echo "config ready"
