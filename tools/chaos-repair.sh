#!/bin/bash
# Removes the artificial constraint created by chaos.sh and waits for the target to catch up.
source /tools/lib.sh
SQL -d AW_Target -Q "IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_poc_block') ALTER TABLE SalesLT.Product DROP CONSTRAINT CK_poc_block"
SQL -d AW_Source -Q "SET NOCOUNT ON; UPDATE SalesLT.Product SET ListPrice=1431.50 WHERE ProductID=680"
bash /tools/wait-parity.sh 24
SQL -d AW_Source -Q "SELECT COUNT(*) AS pending_after_repair FROM sym_outgoing_batch WHERE status<>'OK'"
