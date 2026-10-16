# Sync your own databases from the monitor UI

The monitor can set up a sync between **any two SQL Server databases** (another SQL Server instance, SQL Server on your PC, Azure SQL
Database, Azure SQL Managed Instance, AWS RDS for SQL Server). You do it entirely in the browser: save two connections, run the
**New sync** wizard, watch the progress, then monitor it like the built-in demo.

```
 browser ── monitor (UI + API) ──► your source DB ─┐             ┌─► your target DB
                 │   writes engine files           │ triggers    │ rows applied
                 └──────────► sym-runtime (SymmetricDS 3.16, one JVM for all UI-created syncs)
```
The AdventureWorks demo keeps running unchanged (shown as the built-in sync "Demo").

## 1. What the databases need
| Requirement | Why |
|---|---|
| SQL Server 2012 or newer (incl. Azure SQL / RDS) | trigger-based capture |
| A SQL login that is **`db_owner` in both databases** | SymmetricDS creates its own tables (`sym_*`) and triggers in each database. The wizard tests this and tells you what is missing |
| Each table you replicate has a **primary key** | SymmetricDS identifies rows by key. Tables without one are greyed out in the wizard |
| The target is reachable from Docker | see section 2 |
| Target tables **exist** (same columns/types) or you tick “Create missing tables” | the wizard can create them for you (not foreign keys / other indexes) |
| A database can be used in **one** sync only | the `sym_*` objects live inside it |

Need a database to try? Restore a backup into the Docker SQL Server first: [RESTORE-A-DATABASE.md](RESTORE-A-DATABASE.md).

## 2. How to address your server from inside Docker
The containers connect, so use a name that works *from the Docker network*, not from your browser:
| Where the SQL Server runs | Host to enter | Port |
|---|---|---|
| The SQL Server container of this project | `mssql` | `1433` |
| Optional second container (`docker compose --profile extra-sql up -d mssql2`) | `mssql2` | `1433` |
| SQL Server installed on **this Windows PC** | `host.docker.internal` | its port (usually 1433). TCP/IP must be enabled and the Windows firewall must allow it |
| Another PC / server on your network | its name or IP | its port |
| Azure SQL Database | `yourserver.database.windows.net` | `1433`. In the Azure portal allow your PC's **public IP** under Networking, and tick Encrypt; untick “Trust server certificate” |
| AWS RDS for SQL Server | the endpoint name | `1433`. The security group must allow your public IP |

## 3. Try it with the sample databases (5 minutes)
1. Run **`sample-databases.bat`** (Linux/macOS: `docker compose run --rm tools sample-shop`). It creates `Shop_A` (with data:
   customers, products, orders, order lines, an identity key, a computed column, a table without primary key, and a business trigger)
   and an empty-schema `Shop_B`, plus a login `shopsync` / `Shop_Sync_Str0ng!1`.
   *Second server variant:* `docker compose --profile extra-sql up -d mssql2`, then `docker compose run --rm tools sample-shop --second-instance`
   puts `Shop_B` on the second SQL Server.
2. Open the monitor, sign in (user `admin`, password = `MONITOR_ADMIN_PASSWORD` in `.env`).
3. **Connections → Add connection**: name `Shop A`, host `mssql`, port `1433`, database `Shop_A`, user `shopsync`, password above, **Test connection**, **Save**.
   Repeat for `Shop_B` (host `mssql`, or `mssql2` for the second server).
4. **Sync jobs → New sync** and follow the five steps (below). After 1–2 minutes the sync shows **running**.
5. Change data in `Shop_A` (any SQL client, or `docker compose exec mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "<pwd>" -d Shop_A -Q "UPDATE shop.Customer SET FullName='Hi' WHERE CustomerID=1"`)
   and watch it arrive in `Shop_B`. The **Sync** selector in the header switches every monitor page (Overview, Batches, Errors, Parity, Live feed…) to your sync.

## 4. The wizard
| Step | What you do | What the tool checks |
|---|---|---|
| 1 Connections | choose source and target | both reachable, different databases, `db_owner`, version, no leftover `sym_*` tables, not used by another sync |
| 2 Tables | tick tables | shows row counts; blocks tables without primary key; warns about large columns, computed columns, triggers |
| 3 Target schema | review | compares columns/types with the target; offers to **create missing tables** (preview of the SQL); blocks on differences |
| 4 Options | name; disable target triggers (recommended); READ_COMMITTED_SNAPSHOT (optional) | triggers on target tables would re-process replicated rows |
| 5 Review → Create | start | live progress: check → prepare → start source node → load config → start target node & register → initial load until both sides are identical |

Every step can be **retried** if it fails; finished steps are safe to repeat. Pause / Resume / Reload / Remove are on the Sync jobs page.
**Remove** can also “uninstall”: it drops the `sym_*` tables and capture triggers from both databases and re-enables the target triggers it disabled.
Your own tables and data are never dropped.

## 4b. Dependencies the wizard checks (and what it creates)
**Foreign keys (parent / child)**
| Check | Behaviour |
|---|---|
| Load order | the selected tables are sorted parents first by foreign key (`initial_load_order`), so child rows never arrive before their parents |
| Parent tables you did not select | step 2 lists them (also parents of parents, with "needed by") and offers **Add required parent tables**. They do not stop the sync (tables the wizard creates have no foreign keys) but an existing target with foreign keys would reject the rows: in that case the apply refuses and tells you which table to add |
| Self-references, circular keys | reported in step 2 (rows of a self-referencing table are loaded in key order); a cycle has no strict order, which is fine for wizard-made target tables |
| Primary key | required for every table (greyed out otherwise) |

**Other objects the new target tables need** (only for tables the wizard creates; found from computed columns, default and check constraints, column types)
| Object | Behaviour |
|---|---|
| Scalar / inline / table functions (e.g. `dbo.ufnLeadingZeros` used by `Sales.Customer.AccountNumber`) | created on the target first, including functions they call (callee first) |
| Custom (alias) types (`dbo.Name`, `dbo.Flag`, `dbo.Phone`, `dbo.AccountNumber`, ...) | created on the target and used by the columns, so the target mirrors the source |
| Sequences used by defaults (`NEXT VALUE FOR`), non-`dbo` schemas | created first |
| Encrypted functions, CLR functions/types, synonyms, references to **another user database** | cannot be copied: the wizard stops with a clear message (create them on the target yourself, or leave the table out). References to system objects (`master.sys...`) are fine |
| Functions that read other tables | allowed, with a warning that those tables must exist on the target |
Order of creation: schemas → alias types → sequences → functions → tables. All statements are idempotent (skipped if the object already exists). Views, procedures, triggers, indexes and foreign keys are **not** copied.

## 4c. Test it: Sync Tester
Open **http://localhost:19090**, pick your sync, create or edit rows on the source and watch them arrive on the target ([docs/SYNC-TESTER.md](SYNC-TESTER.md)).

**Unicode:** the wizard writes `mssql.use.ntypes.for.sync=true` into the engine files so nchar/nvarchar text (Japanese, Cyrillic, emoji) replicates intact. It only takes effect when the SymmetricDS tables are created: a sync created with an older version shows `?` on the target (the monitor raises an *unicode_capture* alert) – recreate the sync.

## 5. What changes in your databases
* In **both** databases: ~45 `sym_*` tables and ~80 triggers named `SYM_ON_…` (SymmetricDS' own configuration, queue and capture).
* On each replicated source table: three triggers (insert/update/delete) that record changes. Expect a little write overhead.
* On the target, only if you ticked it: your existing triggers on replicated tables are disabled; missing tables are created.
* With READ_COMMITTED_SNAPSHOT ticked: that database setting is switched on (open transactions in it are rolled back once).

## 6. Limits to know about
* **One-way** (source → target). Changes made directly on the target are not sent back and can make the databases drift.
* Tables need a primary key; `rowversion/timestamp` columns are not supported; `geography`/`geometry` columns are skipped (not copied). XML / large text columns work but slow the initial load.
* The target tables should be **empty** before the first sync; the initial load copies everything from the source.
* **Schema changes** (new column) are not replicated: add the column to the target first, then the source.
* Created target tables have no foreign keys, secondary indexes, views or procedures (the data is already consistent from the source). Only objects that the created tables depend on are copied (section 4b).
* Row-level “Parity” uses row count + `CHECKSUM_AGG(BINARY_CHECKSUM(*))`: fast, but under a case-insensitive collation a change that only alters letter case is not detected.
* Applying a sync restarts the shared `sym-runtime` SymmetricDS server twice (a few seconds each); other UI-created syncs pause briefly and catch up. The demo is unaffected.
* Only SQL Server family databases are supported by the wizard (SymmetricDS itself also supports PostgreSQL/MySQL/Oracle; not wired into the UI).

## 7. Security
* The UI can write to databases, so it requires sign-in, and listens on **127.0.0.1 only** by default (`MONITOR_BIND` in `.env`). Change `MONITOR_ADMIN_PASSWORD` before first use. Sessions end when the monitor restarts.
* Connection passwords are stored **encrypted** (AES-256-GCM) in the `monitor-data` Docker volume and are never returned to the browser. The key is `MONITOR_SECRET` (auto-generated into the volume when empty). Back the key up if you set your own.
* SymmetricDS needs the DB password in its engine file, so the `runtime-engines` volume holds it in plain text. Keep the Docker host private.
* Use a dedicated login with `db_owner` only on the databases to sync. Every create/pause/remove action is written to `audit.log` in the `monitor-data` volume.

## 8. Troubleshooting
| Symptom | Fix |
|---|---|
| Test connection: *host name cannot be resolved* | wrong host for Docker (see section 2). For the PC itself use `host.docker.internal` |
| *Nothing answered on that host/port* | SQL Server not listening on TCP/IP, wrong port, firewall (Azure/RDS: allow your public IP) |
| *Login failed* | user/password, or the login has no user in that database |
| *not db_owner* warning | `ALTER ROLE db_owner ADD MEMBER [user]` in that database |
| Wizard stops at “Check tables and target schema” | read the message: missing tables (tick Create), or column differences (fix the target) |
| Step “Start source node” times out | `docker compose logs sym-runtime`; check the database login can create tables |
| Step “Load sync configuration” times out | `docker compose logs sym-runtime`; press **Retry apply** |
| Initial load never finishes | the Errors page for that sync shows the SQL error (usually a constraint or a data difference on the target). Fix it on the target; it retries by itself |
| Sync shows *error* after `docker compose down` mid-apply | open it and press **Retry apply** |
| Sign-in impossible | set `MONITOR_ADMIN_PASSWORD` in `.env`, then `docker compose up -d monitor` |
