#!/bin/bash
# Restore any SQL Server backup that is in the project's data folder (visible in the container as /backup).
#   docker compose run --rm tools restore-bak <file.bak> [DatabaseName] [--replace] [--no-grant]
# - DatabaseName defaults to the file name without extension.
# - Existing databases are never overwritten unless --replace is given.
# - Unless --no-grant, the login "symds" becomes db_owner in the restored database so the monitor's sync wizard can use it.
source /tools/lib.sh
file=""; db=""; replace=""; grant=1
for a in "$@"; do
  case "$a" in
    --replace) replace=1;; --no-grant) grant="";;
    *) if [ -z "$file" ]; then file="$a"; elif [ -z "$db" ]; then db="$a"; fi;;
  esac
done
list() { echo "Backups found in the data folder:"; ls -l /backup/*.bak 2>/dev/null | awk '{printf "  %-45s %8.1f MB\n", $9, $5/1048576}' | sed 's#/backup/##'; [ -z "$(ls /backup/*.bak 2>/dev/null)" ] && echo "  (none)"; }
if [ -z "$file" ]; then echo "Usage: restore-bak <file.bak> [DatabaseName] [--replace] [--no-grant]"; list; exit 2; fi
file=${file#/backup/}; path="/backup/$file"
[ -f "$path" ] || { echo "ERROR: $file not found in the data folder."; list; exit 1; }
[ "$(stat -c %s "$path")" -gt 100000 ] || { echo "ERROR: $file is too small to be a backup (incomplete download?)"; exit 1; }
[ -n "$db" ] || db=$(basename "$file" | sed 's/\.[^.]*$//')
db=$(echo "$db" | sed 's/[^A-Za-z0-9_]/_/g')
case "$db" in [0-9]*) db="db_$db";; esac
echo "Backup : $file ($(( $(stat -c %s "$path") / 1048576 )) MB)"; echo "Restore as database: $db"

# --- what is in the backup? ---
hdr=$(SQL -h -1 -s '|' -Q "SET NOCOUNT ON; RESTORE HEADERONLY FROM DISK = N'$path'" 2>&1)
if echo "$hdr" | grep -qiE "^Msg|Sqlcmd: Error"; then echo "ERROR: SQL Server cannot read this backup:"; echo "$hdr" | head -5; exit 1; fi
fl=$(SQL -h -1 -s '|' -W -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$path'" 2>&1)
if echo "$fl" | grep -qiE "^Msg|Sqlcmd: Error"; then echo "ERROR: cannot read the file list of the backup:"; echo "$fl" | head -5; exit 1; fi
echo "Files in the backup:"; echo "$fl" | awk -F'|' 'NF>3{printf "  %-1s %s\n", $3, $1}'

# --- existing database? ---
exists=$(SQLQ -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name = N'$db'")
if [ "$exists" != "0" ]; then
  [ -n "$replace" ] || { echo "ERROR: database '$db' already exists. Use --replace to overwrite it, or give another name (second argument)."; exit 1; }
  echo "Database exists: dropping it first (--replace)"
  SQL -Q "ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$db];" || exit 1
fi

# --- MOVE clause for every file, names prefixed with the database name so restores never collide ---
moves=""; nd=0; ns=0
while IFS='|' read -r logical phys type rest; do
  [ -n "$logical" ] || continue
  safe=$(echo "$logical" | sed 's/[^A-Za-z0-9_]/_/g')
  case "$type" in
    D) if [ $nd -eq 0 ]; then ext=mdf; else ext=ndf; fi; nd=$((nd+1)); target="/var/opt/mssql/data/${db}_${safe}.$ext";;
    L) target="/var/opt/mssql/data/${db}_${safe}.ldf";;
    S) ns=$((ns+1)); target="/var/opt/mssql/data/${db}_${safe}";;
    *) echo "WARNING: skipping file '$logical' of type '$type' (not supported in Linux containers)"; continue;;
  esac
  moves="$moves${moves:+, }MOVE N'${logical//\'/\'\'}' TO N'$target'"
done < <(echo "$fl" | awk -F'|' 'NF>3{gsub(/^ +| +$/,"",$1); gsub(/^ +| +$/,"",$3); print $1"|"$2"|"$3}')
[ -n "$moves" ] || { echo "ERROR: no files to restore"; exit 1; }

echo "Restoring (this can take a few minutes for large backups)..."
SQL -Q "RESTORE DATABASE [$db] FROM DISK = N'$path' WITH $moves, STATS = 20" || { echo "ERROR: restore failed (see messages above). A common cause is a backup made on a NEWER SQL Server than 2022, or too little disk space in Docker."; exit 1; }

if [ -n "$grant" ]; then
  SQL -d "$db" -Q "IF SUSER_ID('symds') IS NOT NULL BEGIN IF USER_ID('symds') IS NULL CREATE USER symds FOR LOGIN symds; ALTER ROLE db_owner ADD MEMBER symds; END" && echo "login 'symds' is now db_owner in $db (for the sync wizard)"
fi
echo; echo "Restored database '$db':"
SQL -d "$db" -Q "SET NOCOUNT ON; SELECT DB_NAME() AS [database], (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compat_level, (SELECT COUNT(*) FROM sys.tables) AS tables, (SELECT CAST(SUM(size)*8/1024.0 AS decimal(10,1)) FROM sys.database_files) AS size_mb, (SELECT COUNT(*) FROM sys.triggers WHERE parent_class = 1) AS dml_triggers"
echo "Connect: SSMS  localhost,14330  (sa)   |   monitor connection: host mssql, port 1433, database $db, user symds"
