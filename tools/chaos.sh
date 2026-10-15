#!/bin/bash
# Error injection: CHECK constraint on the TARGET only, then push a violating value from the SOURCE.
# Expect: batch error, later changes queue behind it. Repair: drop the constraint -> batch retries -> OK.
# (An FK violation is not used: SymmetricDS 3.16 auto-reloads missing parent rows, so it self-heals.)
source /tools/lib.sh
SQL -d AW_Source -Q "SET NOCOUNT ON; UPDATE SalesLT.Product SET ListPrice=1431.50 WHERE ProductID=680" ; sleep 6
SQL -d AW_Target -Q "IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_poc_block') ALTER TABLE SalesLT.Product ADD CONSTRAINT CK_poc_block CHECK (ListPrice < 50000)" || exit 1
SQL -d AW_Source -Q "SET NOCOUNT ON; UPDATE SalesLT.Product SET ListPrice=99999 WHERE ProductID=680"
sleep 15
echo "--- 1. expect an error (visible in the monitor under Errors):"
SQL -d AW_Source -Q "SELECT batch_id,status,LEFT(ISNULL(sql_message,''),150) msg FROM sym_outgoing_batch WHERE status<>'OK'"
echo "--- 2. later changes queue behind it:"
SQL -d AW_Source -Q "SET NOCOUNT ON; UPDATE SalesLT.Customer SET CompanyName=N'blocked-behind-error' WHERE CustomerID=1"; sleep 8
SQL -d AW_Source -Q "SELECT COUNT(*) AS pending_batches FROM sym_outgoing_batch WHERE status<>'OK'"
if [ "$1" = "--keep" ]; then echo "--keep: error left in place. Repair later with: docker compose run --rm tools chaos-repair"; exit 0; fi
echo "--- 3. repair"
bash /tools/chaos-repair.sh
