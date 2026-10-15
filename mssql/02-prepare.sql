SET NOCOUNT ON;
-- snapshot isolation reduces blocking between app writes, SymmetricDS triggers and its routing reads
ALTER DATABASE AW_Source SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
ALTER DATABASE AW_Source SET ALLOW_SNAPSHOT_ISOLATION ON;
ALTER DATABASE AW_Target SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
ALTER DATABASE AW_Target SET ALLOW_SNAPSHOT_ISOLATION ON;
GO
-- server-level logins
IF SUSER_ID('symds') IS NULL CREATE LOGIN symds WITH PASSWORD = '$(SYMDS_PWD)', CHECK_POLICY = OFF;
IF SUSER_ID('monitor_ro') IS NULL CREATE LOGIN monitor_ro WITH PASSWORD = '$(MONITOR_PWD)', CHECK_POLICY = OFF;
GO
USE AW_Source;
IF USER_ID('symds') IS NULL CREATE USER symds FOR LOGIN symds;
ALTER ROLE db_owner ADD MEMBER symds;
IF USER_ID('monitor_ro') IS NULL CREATE USER monitor_ro FOR LOGIN monitor_ro;
ALTER ROLE db_datareader ADD MEMBER monitor_ro;
GO
USE AW_Target;
IF USER_ID('symds') IS NULL CREATE USER symds FOR LOGIN symds;
ALTER ROLE db_owner ADD MEMBER symds;
IF USER_ID('monitor_ro') IS NULL CREATE USER monitor_ro FOR LOGIN monitor_ro;
ALTER ROLE db_datareader ADD MEMBER monitor_ro;
GO
-- empty the target: SymmetricDS' initial load populates it. Disable FKs so delete order does not matter.
EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL';
DECLARE @s nvarchar(max) = N'';
SELECT @s += N'DELETE FROM ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name) + N';' FROM sys.tables WHERE SCHEMA_NAME(schema_id) = 'SalesLT' OR name = 'ErrorLog';
EXEC (@s);
EXEC sp_MSforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL';
GO
-- AdventureWorksLT business triggers (they recompute SubTotal / ModifiedDate on SalesOrder*). SymmetricDS replays
-- already-final row images, so these must NOT run again on the target or ModifiedDate/SubTotal diverge.
DISABLE TRIGGER SalesLT.iduSalesOrderDetail ON SalesLT.SalesOrderDetail;
DISABLE TRIGGER SalesLT.uSalesOrderHeader   ON SalesLT.SalesOrderHeader;
GO
