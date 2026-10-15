SET NOCOUNT ON;
DECLARE @bak nvarchar(260) = N'/backup/AdventureWorksLT2022.bak';
DECLARE @fl TABLE (LogicalName nvarchar(128), PhysicalName nvarchar(260), [Type] char(1), FileGroupName nvarchar(128),
  [Size] numeric(20,0), MaxSize numeric(20,0), FileId bigint, CreateLSN numeric(25,0), DropLSN numeric(25,0), UniqueId uniqueidentifier,
  ReadOnlyLSN numeric(25,0), ReadWriteLSN numeric(25,0), BackupSizeInBytes bigint, SourceBlockSize int, FileGroupId int,
  LogGroupGUID uniqueidentifier, DifferentialBaseLSN numeric(25,0), DifferentialBaseGUID uniqueidentifier, IsReadOnly bit, IsPresent bit,
  TDEThumbprint varbinary(32), SnapshotUrl nvarchar(360));
INSERT @fl EXEC('RESTORE FILELISTONLY FROM DISK = N''' + @bak + '''');
DECLARE @data sysname = (SELECT LogicalName FROM @fl WHERE [Type]='D');
DECLARE @log  sysname = (SELECT LogicalName FROM @fl WHERE [Type]='L');
PRINT 'Logical data=' + @data + ' log=' + @log;

DECLARE @db sysname, @sql nvarchar(max);
DECLARE c CURSOR FOR SELECT v FROM (VALUES (N'AW_Source'),(N'AW_Target')) x(v);
OPEN c; FETCH NEXT FROM c INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF DB_ID(@db) IS NULL
  BEGIN
    SET @sql = N'RESTORE DATABASE ' + QUOTENAME(@db) + N' FROM DISK = N''' + @bak + N''' WITH '
      + N'MOVE N''' + @data + N''' TO N''/var/opt/mssql/data/' + @db + N'.mdf'', '
      + N'MOVE N''' + @log  + N''' TO N''/var/opt/mssql/data/' + @db + N'_log.ldf'', STATS = 25';
    EXEC (@sql);
  END
  ELSE PRINT @db + ' already exists - skipped';
  FETCH NEXT FROM c INTO @db;
END
CLOSE c; DEALLOCATE c;
