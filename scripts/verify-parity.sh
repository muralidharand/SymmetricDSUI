#!/bin/bash
# Row-count + checksum parity between AW_Source and AW_Target for every replicated table. Exit 1 on any diff.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
out=$(mktemp)
sql -Q "
SET NOCOUNT ON;
DECLARE @t TABLE (s sysname, n sysname, sc bigint, sk int, tc bigint, tk int);
DECLARE @s sysname, @n sysname, @q nvarchar(max);
DECLARE c CURSOR FOR SELECT s.name, t.name FROM AW_Source.sys.tables t JOIN AW_Source.sys.schemas s ON s.schema_id=t.schema_id
  WHERE t.name NOT LIKE 'sym[_]%' AND t.name IN (SELECT source_table_name FROM AW_Source.dbo.sym_trigger);
OPEN c; FETCH NEXT FROM c INTO @s,@n;
WHILE @@FETCH_STATUS=0 BEGIN
  SET @q = N'SELECT ''' + @s + N''',''' + @n + N''',
   (SELECT COUNT_BIG(*) FROM AW_Source.' + QUOTENAME(@s) + '.' + QUOTENAME(@n) + N'),
   (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM AW_Source.' + QUOTENAME(@s) + '.' + QUOTENAME(@n) + N'),
   (SELECT COUNT_BIG(*) FROM AW_Target.' + QUOTENAME(@s) + '.' + QUOTENAME(@n) + N'),
   (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM AW_Target.' + QUOTENAME(@s) + '.' + QUOTENAME(@n) + N')';
  INSERT @t EXEC (@q);
  FETCH NEXT FROM c INTO @s,@n;
END CLOSE c; DEALLOCATE c;
IF NOT EXISTS (SELECT 1 FROM @t) THROW 50000, 'No replicated tables found (sym_trigger empty): sync config not loaded', 1;
SELECT s+'.'+n AS tbl, sc AS src_rows, tc AS tgt_rows, CASE WHEN sc=tc AND ISNULL(sk,0)=ISNULL(tk,0) THEN 'OK' ELSE 'DIFF' END AS parity FROM @t ORDER BY 1;
" > "$out" 2>&1; rc=$?
cat "$out" >&2
if [ $rc -ne 0 ]; then echo "PARITY: check failed to run (see above)" >&2; rm -f "$out"; exit 2; fi
if grep -q DIFF "$out"; then echo "PARITY: DIFF FOUND" >&2; rm -f "$out"; exit 1; fi
rm -f "$out"; echo "PARITY: all tables match"
