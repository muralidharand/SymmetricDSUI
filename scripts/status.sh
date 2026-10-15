#!/bin/bash
# Quick text status: containers, nodes, batch counts, errors, parity.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo; echo "--- nodes (source DB)"
sql -d AW_Source -Q "SELECT node_id, node_group_id, sync_enabled FROM sym_node"
echo "--- outgoing batches by status (source)  OK=done, anything else=pending/error"
sql -d AW_Source -Q "SELECT status, COUNT(*) AS n FROM sym_outgoing_batch GROUP BY status"
echo "--- failing batches"
sql -d AW_Source -Q "SELECT batch_id, channel_id, status, LEFT(ISNULL(sql_message,''),160) AS message FROM sym_outgoing_batch WHERE status <> 'OK'"
echo "--- parity"; scripts/verify-parity.sh 2>&1 | tail -16
