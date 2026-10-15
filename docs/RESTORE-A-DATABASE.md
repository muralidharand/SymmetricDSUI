# Restore a .bak (for example AdventureWorks2022) into the Docker SQL Server

Any SQL Server backup you put in the project's **`data`** folder is visible inside the container as `/backup/<file>`
(the folder is mounted read-only), so there is nothing to copy. The restore tool reads the backup, restores every file
into the container's data folder and prints what it created.

## The quick way
**Windows:** double-click **`restore-database.bat`** (it lists the backups and asks), or from a command prompt in the project folder:
```bat
restore-database.bat AdventureWorks2022.bak
restore-database.bat AdventureWorks2022.bak MyCopy        rem different database name
restore-database.bat AdventureWorks2022.bak --replace     rem overwrite if the database already exists
```
**Linux / macOS:** `scripts/restore-bak.sh AdventureWorks2022.bak [DatabaseName] [--replace]`
(= `docker compose run --rm tools restore-bak ...`).

What it does: checks the file, runs `RESTORE HEADERONLY` / `FILELISTONLY`, restores with a `MOVE` for every file (files are prefixed with the
database name so several restores never collide), refuses to overwrite an existing database unless you pass `--replace`, and makes the login
`symds` **db_owner** in the new database so the sync wizard can use it (`--no-grant` skips that). Example output for the full AdventureWorks2022:
```
Files in the backup:   D AdventureWorks2022   L AdventureWorks2022_log
RESTORE DATABASE successfully processed 25378 pages ...
database           compat_level  tables  size_mb  dml_triggers
AdventureWorks2022 160           71      272.0    10
```
Restoring takes seconds to a few minutes depending on the size. Docker needs free disk space of about the backup size times two.

## Then use it
* **SSMS / Azure Data Studio:** `localhost,14330`, SQL authentication, login `sa` (see the SSMS section in [WINDOWS-DOCKER-DESKTOP.md](WINDOWS-DOCKER-DESKTOP.md)). Refresh *Databases*.
* **Monitor → Connections → Add connection:** host `mssql`, port `1433`, database `AdventureWorks2022`, user `symds`, password = `SYMDS_DB_PASSWORD` from `.env`.
* **Sync it to another database:** restore the same file a second time under another name, or create an empty database (the wizard can create the tables),
  add both as connections and run **Sync jobs → New sync** ([ADD-YOUR-OWN-DATABASE.md](ADD-YOUR-OWN-DATABASE.md)).

## Restoring by hand (SSMS or sqlcmd)
The SQL Server runs on Linux, so paths are Linux paths and SSMS' *Restore Database* dialog cannot browse your Windows disk.
Use a query window (Server `localhost,14330`):
```sql
RESTORE FILELISTONLY FROM DISK = N'/backup/AdventureWorks2022.bak';      -- note the two logical names
RESTORE DATABASE AdventureWorks2022 FROM DISK = N'/backup/AdventureWorks2022.bak'
WITH MOVE N'AdventureWorks2022'     TO N'/var/opt/mssql/data/AdventureWorks2022.mdf',
     MOVE N'AdventureWorks2022_log' TO N'/var/opt/mssql/data/AdventureWorks2022_log.ldf', STATS = 10;
```
A backup that is not in `data\`: copy it in with `docker cp "C:\path\file.bak" symds-poc-mssql-1:/var/opt/mssql/backup/` (create the folder first with
`docker compose exec -u 0 mssql mkdir -p /var/opt/mssql/backup`) and restore from `/var/opt/mssql/backup/file.bak`.

## Troubleshooting
| Message | Meaning / fix |
|---|---|
| `file not found in the data folder` | the file must be inside the project's `data` folder; the tool lists what it sees |
| `database ... already exists` | add `--replace`, or give another name |
| `SQL Server cannot read this backup` / *version is not supported* | the backup was made on a **newer** SQL Server than 2022 (the container runs 2022). Restore it on a newer server or ask for a backup from 2022 or older |
| `Operating system error 112` / disk full | free Docker disk space (Docker Desktop → Settings → Resources → Disk image size) |
| backup of a database with FILESTREAM / memory-optimized files | Linux containers do not support memory-optimized files; FILESTREAM folders are restored |
| `Password is wrong` / login failures later | the `sa` password is the one from the first start (see the SSMS section) |

## Syncing the full AdventureWorks2022 with the wizard: what to expect
**Verified with the real backup: all 71 tables (760,838 rows) synced into an empty database in a few minutes**, with the wizard creating the six custom types
(`AccountNumber, Flag, Name, NameStyle, OrderNumber, Phone`), the function `dbo.ufnLeadingZeros` and the tables, parity 71/71, and live changes through the custom-typed columns.
Select **Select all** in step 2 (or a related group) and tick *Create missing tables on the target*. The dependency checks are described in [ADD-YOUR-OWN-DATABASE.md](ADD-YOUR-OWN-DATABASE.md#4b-dependencies-the-wizard-checks-and-what-it-creates).
Tested with the real `AdventureWorks2022.bak` (71 tables, 10 triggers). Discovery works for all tables and the wizard can create the tables on an empty target.
* **Works:** identity, computed columns (also persisted), `hierarchyid`, `xml` (typed XML is created as plain `xml` on a new target table), large `nvarchar(max)/varbinary(max)`, FK-ordered initial load, live changes.
* **`geography` / `geometry` columns are not copied** (SymmetricDS cannot transport them): the table is synced without that column (it stays empty on the target, e.g. `Person.Address.SpatialLocation`). The wizard shows this warning in step 2.
* **Triggers** (some are INSTEAD OF) on source tables should be disabled on the target (step 4 option); new target tables created by the wizard have none.
* The checksum "Parity" ignores spatial and hierarchyid columns.
