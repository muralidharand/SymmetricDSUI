#!/bin/bash
source /tools/lib.sh
echo "--- nodes"; SQL -d AW_Source -Q "SELECT node_id, node_group_id, sync_enabled FROM sym_node"
echo "--- outgoing batches by status (OK = done, anything else = pending/error)"; SQL -d AW_Source -Q "SELECT status, COUNT(*) AS n FROM sym_outgoing_batch GROUP BY status"
echo "--- failing batches"; SQL -d AW_Source -Q "SELECT batch_id, channel_id, status, LEFT(ISNULL(sql_message,''),160) AS message FROM sym_outgoing_batch WHERE status <> 'OK'"
echo "--- parity"; bash /tools/parity.sh
