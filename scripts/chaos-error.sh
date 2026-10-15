#!/bin/bash
# Error injection: add a CHECK constraint on the TARGET only, then push a violating value from the SOURCE.
# Expect: outgoing batch -> ER, channel blocked, incoming error recorded. Repair: drop constraint -> batch retries -> OK.
# (An FK violation is NOT used: 3.16 auto-reloads missing parent rows, so it self-heals.)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
sql -d AW_Target -Q "ALTER TABLE SalesLT.Product ADD CONSTRAINT CK_poc_block CHECK (ListPrice < 50000)"
sql -d AW_Source -Q "SET NOCOUNT ON; UPDATE SalesLT.Product SET ListPrice=99999 WHERE ProductID=680"
sleep 15
echo "--- expect ER:";   sql -d AW_Source -Q "SELECT batch_id,status,error_flag,LEFT(ISNULL(sql_message,''),150) msg FROM sym_outgoing_batch WHERE status<>'OK'"
echo "--- later changes queue behind it:"
sql -d AW_Source -Q "SET NOCOUNT ON; UPDATE SalesLT.Customer SET CompanyName=N'blocked-behind-error' WHERE CustomerID=29485"; sleep 8
sql -d AW_Source -Q "SELECT COUNT(*) AS pending_batches FROM sym_outgoing_batch WHERE status<>'OK'"
echo "--- repair"
sql -d AW_Target -Q "ALTER TABLE SalesLT.Product DROP CONSTRAINT CK_poc_block"; sleep 25
sql -d AW_Source -Q "SELECT COUNT(*) AS pending_after_repair FROM sym_outgoing_batch WHERE status<>'OK'"
"$(dirname "${BASH_SOURCE[0]}")/verify-parity.sh" 2>&1 | grep -E "DIFF|PARITY"
