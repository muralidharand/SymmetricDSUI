-- Sample "different database" for trying the sync wizard: schema only (run for Shop_A and Shop_B). sqlcmd var: db
USE [$(db)];
IF SCHEMA_ID('shop') IS NULL EXEC('CREATE SCHEMA shop');
GO
IF OBJECT_ID('shop.Category') IS NULL
CREATE TABLE shop.Category (CategoryID int NOT NULL PRIMARY KEY, Name nvarchar(60) NOT NULL);
IF OBJECT_ID('shop.Customer') IS NULL
CREATE TABLE shop.Customer (CustomerID int IDENTITY(1,1) NOT NULL PRIMARY KEY, Email nvarchar(120) NOT NULL UNIQUE,
  FullName nvarchar(120) NOT NULL, CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
IF OBJECT_ID('shop.Product') IS NULL
CREATE TABLE shop.Product (ProductID int IDENTITY(1,1) NOT NULL PRIMARY KEY, CategoryID int NOT NULL REFERENCES shop.Category(CategoryID),
  Name nvarchar(100) NOT NULL, Price decimal(10,2) NOT NULL, Notes nvarchar(max) NULL);
IF OBJECT_ID('shop.[Order]') IS NULL
CREATE TABLE shop.[Order] (OrderID int IDENTITY(1000,1) NOT NULL PRIMARY KEY, CustomerID int NOT NULL REFERENCES shop.Customer(CustomerID),
  OrderDate datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), Status varchar(20) NOT NULL DEFAULT 'NEW');
IF OBJECT_ID('shop.OrderLine') IS NULL
CREATE TABLE shop.OrderLine (OrderID int NOT NULL REFERENCES shop.[Order](OrderID), [LineNo] int NOT NULL,
  ProductID int NOT NULL REFERENCES shop.Product(ProductID), Qty int NOT NULL, UnitPrice decimal(10,2) NOT NULL,
  LineTotal AS (Qty * UnitPrice) PERSISTED, CONSTRAINT PK_OrderLine PRIMARY KEY (OrderID, [LineNo]));
-- deliberately WITHOUT a primary key: the wizard must refuse it (SymmetricDS needs a PK)
IF OBJECT_ID('shop.AuditNote') IS NULL
CREATE TABLE shop.AuditNote (Note nvarchar(200) NULL, At datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
-- a "business" trigger like AdventureWorks has: replicated row images must not be re-processed on the target
IF OBJECT_ID('shop.trg_Order_Status') IS NOT NULL DROP TRIGGER shop.trg_Order_Status;
GO
CREATE TRIGGER shop.trg_Order_Status ON shop.[Order] AFTER UPDATE AS
BEGIN SET NOCOUNT ON; UPDATE o SET Status = UPPER(i.Status) FROM shop.[Order] o JOIN inserted i ON i.OrderID = o.OrderID WHERE o.Status <> UPPER(i.Status); END
GO
