#!/bin/bash
# DML on the source (insert/update/delete incl. order -> lines), then wait for the target to match.
source /tools/lib.sh
SQL -d AW_Source -Q "
SET NOCOUNT ON;
INSERT SalesLT.Customer (NameStyle,FirstName,LastName,PasswordHash,PasswordSalt) VALUES (0,N'Smoke',N'Test',N'x',N'y');
DECLARE @c int = SCOPE_IDENTITY();
UPDATE SalesLT.Customer SET CompanyName=N'SymDS POC '+CONVERT(varchar(30),GETDATE(),126) WHERE CustomerID=@c;
INSERT SalesLT.SalesOrderHeader (DueDate,CustomerID,ShipMethod) VALUES (DATEADD(day,7,GETDATE()),@c,N'CARGO TRANSPORT 5');
DECLARE @o int = SCOPE_IDENTITY();
INSERT SalesLT.SalesOrderDetail (SalesOrderID,OrderQty,ProductID,UnitPrice,UnitPriceDiscount) VALUES (@o,2,680,100,0),(@o,1,706,50,0.1);
UPDATE SalesLT.SalesOrderDetail SET OrderQty=5 WHERE SalesOrderID=@o AND ProductID=680;
DELETE FROM SalesLT.SalesOrderDetail WHERE SalesOrderID=@o AND ProductID=706;
SELECT @c AS new_customer, @o AS new_order;" || exit 1
echo "waiting for replication (max 60s)..."
for i in $(seq 1 30); do
  bash /tools/parity.sh --quiet >/dev/null 2>&1 && { echo "SMOKE TEST PASSED: target matches source after ~$((i*2))s"; exit 0; }
  sleep 2
done
echo "SMOKE TEST FAILED: parity not reached"; bash /tools/parity.sh; exit 1
