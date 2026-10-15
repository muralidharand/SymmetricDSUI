-- Seed rows for Shop_A only.
USE Shop_A;
SET NOCOUNT ON;
IF NOT EXISTS (SELECT 1 FROM shop.Category)
BEGIN
  INSERT shop.Category VALUES (1,N'Books'),(2,N'Games'),(3,N'Music'),(4,N'Garden'),(5,N'Tools');
  INSERT shop.Customer (Email, FullName)
    SELECT CONCAT('user', n, '@example.com'), CONCAT(N'Customer ', n) FROM (SELECT TOP 50 ROW_NUMBER() OVER (ORDER BY (SELECT 1)) n FROM sys.all_objects) x;
  INSERT shop.Product (CategoryID, Name, Price, Notes)
    SELECT 1 + (n % 5), CONCAT(N'Product ', n), 5 + n * 1.25, CASE WHEN n % 4 = 0 THEN REPLICATE(N'long note ', 50) END FROM (SELECT TOP 20 ROW_NUMBER() OVER (ORDER BY (SELECT 1)) n FROM sys.all_objects) x;
  INSERT shop.[Order] (CustomerID) SELECT 1 + (n % 50) FROM (SELECT TOP 30 ROW_NUMBER() OVER (ORDER BY (SELECT 1)) n FROM sys.all_objects) x;
  INSERT shop.OrderLine (OrderID, [LineNo], ProductID, Qty, UnitPrice)
    SELECT o.OrderID, l.n, 1 + ((o.OrderID + l.n) % 20), 1 + (l.n % 4), 10 + l.n FROM shop.[Order] o CROSS JOIN (VALUES (1),(2),(3)) l(n);
  INSERT shop.AuditNote (Note) VALUES (N'seed row without a primary key');
END
GO
