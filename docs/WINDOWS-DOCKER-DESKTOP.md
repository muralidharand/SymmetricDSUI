# Run the SymmetricDS sync POC on Windows 11 with Docker Desktop only

**You need only Docker Desktop.** No WSL distro (Ubuntu), no Git, no Node, no SQL Server install, no PowerShell
scripts. Everything runs in Linux containers that Docker Desktop manages: SQL Server 2022, two SymmetricDS 3.16 nodes
and the monitor UI. You start things by double-clicking `.bat` files, which only call `docker compose`.

```
 double-click start.bat ─► docker compose up ─► mssql ─► mssql-init (restore .bak twice: AW_Source, AW_Target)
                                                    └► sym-source ─► sym-config (load sync config) ─► sym-target (registers, initial load)
                                                    └► monitor  http://localhost:18080
```

## 1. Prerequisites (one time)
| Need | Check |
|---|---|
| Docker Desktop running in **Linux containers** mode | Whale icon in the tray says *Engine running*. (Tray menu shows "Switch to Windows containers" = you are correct. If it shows "Switch to Linux containers", click it.) |
| About 6 GB RAM free for Docker | Docker Desktop → Settings → Resources (Hyper-V mode) or `%UserProfile%\.wslconfig` (`[wsl2]` / `memory=6GB`, then `wsl --shutdown` and restart Docker Desktop). SQL Server needs at least 2 GB. |
| Internet for the first start | Downloads ~2.5 GB of images (SQL Server, SymmetricDS) and builds the monitor |
| `AdventureWorksLT2022.bak` | You already have it |
| x64 PC | (SQL Server image is not reliable on Windows-on-ARM) |

### Already running another SQL Server / SymmetricDS in Docker?
That is fine. This project is isolated (its own compose project `symds-poc`, network and volume) and uses **unusual host ports** so it does not
collide with common ones:

| Service | Port on your PC | `.env` variable | Typical clash it avoids |
|---|---|---|---|
| SQL Server | **14330** | `MSSQL_PORT` | 1433 |
| SymmetricDS for UI-created syncs | **41417** | `RUNTIME_PORT` | 31415 |
| SymmetricDS source node | **41415** | `SYM_SOURCE_PORT` | 31415 |
| SymmetricDS target node | **41416** | `SYM_TARGET_PORT` | 31416 |
| Monitor UI | **18080** | `MONITOR_PORT` | 8080 |

`start.bat` checks these ports first and tells you which one is taken; change the number in `.env` and run again. The containers talk to
each other on Docker's internal network, so these ports are only for you (SQL client, browser). The other thing to watch is **memory**:
two SQL Servers need about 2 GB each, so give Docker Desktop 6-8 GB or SQL Server will be killed (exit code 137).

## 2. Get the project
1. Download **https://github.com/muralidharand/symmetricdsui/archive/refs/heads/add-monitor-ui.zip**
2. Extract it to a simple path **under your user folder or C:**, for example `C:\symds` (so that `C:\symds\start.bat` exists; if
   extraction created a nested folder, use the inner one that contains `start.bat`). Avoid paths Docker Desktop cannot share
   (network drives).
3. Copy your `AdventureWorksLT2022.bak` into the **`data`** folder (`C:\symds\data\AdventureWorksLT2022.bak`, about 8.5 MB).
4. *(Optional)* Passwords: `start.bat` creates `.env` from `.env.example` automatically with working default
   passwords. To choose your own, copy `.env.example` to `.env` **before the first start** and edit it in Notepad. Rules: SQL Server
   complexity (8+ chars, upper, lower, digit, symbol), and **no** `$ " ' \ #` or spaces.
   Changing passwords later requires `reset.bat` (they are stored inside the databases).

## 3. Start and begin the sync
Double-click **`start.bat`**. First run takes about 10 minutes (downloads), later runs about a minute. It:

| Step | What happens |
|---|---|
| `mssql` + `mssql-init` | SQL Server starts; the .bak is restored **twice** as `AW_Source` and `AW_Target`; logins are created; the target is emptied |
| `sym-source` | SymmetricDS node 000 starts and creates its `sym_*` tables inside `AW_Source` |
| `sym-config` | loads `symds/config/sym-config.sql` (what is replicated, channel, router, triggers) and waits for the capture triggers |
| `sym-target` | node 001 starts **after** the config is ready, registers automatically and receives the **initial load** |
| `monitor` + `sym-runtime` | UI starts (port 18080, this PC only); `sym-runtime` is the SymmetricDS server for syncs you create in the UI |
| `wait-parity` | waits until every table is identical, prints the per-table counts and `PARITY: all tables match` |

Then your browser opens **http://localhost:18080**. From now on every change committed in `AW_Source` is captured by triggers and
applied to `AW_Target` within seconds (one-way). `dbo.BuildVersion` is not replicated (it has no primary key).

## 4. Test the sync
| File | What it does |
|---|---|
| **`test.bat`** | inserts a customer + order + lines on the source, updates and deletes some, waits, and proves the target matches (`SMOKE TEST PASSED`) |
| **`test-error.bat`** | breaks the target on purpose, shows the error batch, proves later changes queue behind it, repairs it, proves recovery. Use `test-error.bat keep` to leave the error in place so you can look at the monitor's **Errors** page, then run `test-error-repair.bat` |
| **`status.bat`** | containers, nodes, batch counts, failing batches, per-table parity |

**By hand.** Connect with any SQL client (Azure Data Studio, SSMS, DBeaver): server `localhost,14330`, user `sa`, password from
`.env`, *trust server certificate*. Or from a Windows command prompt in the project folder (replace the password):
```bat
docker compose exec mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "YourPassword" -d AW_Source -Q "UPDATE SalesLT.Customer SET CompanyName='Hello Sync' WHERE CustomerID=1"
docker compose exec mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "YourPassword" -d AW_Target -Q "SELECT CompanyName FROM SalesLT.Customer WHERE CustomerID=1"
```
Run the second command a few seconds after the first. Try INSERT and DELETE on `AW_Source.SalesLT.*` too. Changes made on the
target are **not** sent back.

| Scenario | Expected |
|---|---|
| insert/update/delete on `SalesLT.*` or `dbo.ErrorLog` | on the target in about 2–10 s |
| `docker compose stop sym-target`, change data, `docker compose start sym-target` | monitor shows a backlog, then it drains; nothing lost |
| `stop.bat` then `start.bat` | resumes, replicated data kept |

## 5. Connect with SSMS / Azure Data Studio
The SQL Server in Docker is published on your PC, so SSMS on Windows can open it directly:

| SSMS field | Value |
|---|---|
| Server type | Database Engine |
| **Server name** | **`localhost,14330`** (a **comma**, not a colon; the port is `MSSQL_PORT` in `.env`, default 14330. `127.0.0.1,14330` also works) |
| Authentication | **SQL Server Authentication** |
| Login | `sa` |
| Password | `MSSQL_SA_PASSWORD` from `.env` (default in `.env.example`: `ChangeMe_Str0ng!Pass`) |
| Options → Connection Properties → Encrypt | `Mandatory` or `Optional` |
| Options → Connection Properties | **tick “Trust server certificate”** (the container uses a self-signed certificate; without this SSMS 19/20 says *certificate chain was issued by an authority that is not trusted*) |

Connection strings (replace the password):
```
ADO.NET / ODBC : Server=localhost,14330;User ID=sa;Password=<password>;Encrypt=True;TrustServerCertificate=True;
JDBC           : jdbc:sqlserver://localhost:14330;user=sa;password=<password>;encrypt=true;trustServerCertificate=true
sqlcmd         : sqlcmd -S localhost,14330 -U sa -P "<password>" -C
```
Databases you will see: `AW_Source` and `AW_Target` (the demo), plus `Shop_A` / `Shop_B` after `sample-databases.bat`.
Other logins (all with the passwords from `.env`): `symds` (db_owner on AW_Source/AW_Target, used by SymmetricDS), `monitor_ro` (read-only, used by the demo monitor),
`shopsync` (db_owner on the sample shop databases, password `Shop_Sync_Str0ng!1`).

Two different addresses, do not mix them up: **from Windows** (SSMS, browser) use `localhost,14330`; **from inside Docker** (the Connections tab of the monitor, SymmetricDS) the same server is `mssql`, port `1433`.
The optional second server (`docker compose --profile extra-sql up -d mssql2`) is published as `localhost,14331` (`MSSQL2_PORT`).

## 6. Use your own databases (optional)
In the monitor, **Connections** saves a source and a target database, and **Sync jobs → New sync** sets up SymmetricDS between them (pick tables,
let it create missing target tables, watch the progress). Run **`sample-databases.bat`** first if you just want to try it with two sample databases.
Full guide: [ADD-YOUR-OWN-DATABASE.md](ADD-YOUR-OWN-DATABASE.md). A SQL Server on this Windows PC is reached as host `host.docker.internal`.

## 7. Monitor
**http://localhost:18080**. Sign in with user `admin` and the password `MONITOR_ADMIN_PASSWORD` from `.env` (default in `.env.example`; change it). The **Sync** selector in the header chooses which sync every page shows:
| Page | Use it to |
|---|---|
| Overview | alerts, *Backlog* (batches not yet loaded), *Errors*, latency avg/p95/max, rows per minute, node health |
| Batches | every batch, outgoing (source DB) or incoming (target DB); filter by status or channel; click for details |
| Errors | failing batches with the exact SQL error; the batch retries by itself once the cause is fixed |
| Parity | per-table source vs target rows and checksum (short differences while batches are in flight are normal) |
| Channels & routing | table → channel → router, link direction |
| Live feed | changes as they are captured (I insert · U update · D delete · R reload) |

Status codes: `NE` new · `RT` routed · `QY` queried · `SE` sent · `LD` loading · **`OK` done** · **`ER` error** · `IG` ignored · `RQ` resend.
A failing batch is `LD` + message on the source side and `ER` on the target side. While one batch is in error, later changes on the same channel wait behind it.

Logs: `docker compose logs -f sym-source sym-target` (Ctrl-C to stop watching) or use Docker Desktop → Containers.

## 8. Stop, restore the databases, reset
| File | Does |
|---|---|
| **`stop.bat`** | stops all containers, **keeps all data** |
| **`start.bat`** | starts / resumes (safe to run any time; never wipes replicated data) |
| **`db-restore.bat`** | asks `YES`, then **drops AW_Source and AW_Target**, restores both from the .bak and re-runs the initial load. Use after you have changed the data and want a clean start |
| **`reset.bat`** | asks `YES`, removes all containers **and the SQL Server volume** (everything). Next `start.bat` rebuilds from scratch. Needed after changing passwords |
Docker Desktop restarts the containers automatically after a reboot (SymmetricDS has `restart: unless-stopped`).

## 9. Troubleshooting
| Symptom | Fix |
|---|---|
| `Docker is not running` / start.bat waits long | Start Docker Desktop and wait for *Engine running*; start.bat also tries to start it |
| `no matching manifest` / `image operating system "linux" cannot be used` | Docker Desktop is in Windows containers mode: tray icon → *Switch to Linux containers* |
| SSMS: *A network-related or instance-specific error* / *Cannot connect to localhost* | Check `docker compose ps` shows `mssql` as *healthy*; use `localhost,14330` (comma) not `localhost:14330` or `localhost\SQLEXPRESS`; the port is `MSSQL_PORT` in `.env`; the Docker Desktop container list shows the real mapping (e.g. `14330:1433`) |
| SSMS: *certificate chain was issued by an authority that is not trusted* | Options >> Connection Properties >> tick **Trust server certificate** (or set Encrypt to Optional) |
| SSMS: *Login failed for user 'sa'* | The password is the one in `.env` **from the first start**: it is stored in the database volume. After editing `.env` run `reset.bat` |
| `mssql` unhealthy or exits | Not enough memory: give Docker ≥ 6 GB (see prerequisites). Check `docker compose logs mssql` (password complexity?) |
| `data\AdventureWorksLT2022.bak is missing` | Copy the file into the `data` folder |
| `mssql-init` fails / restore error | `docker compose logs mssql-init`. Make sure the .bak is the full file (about 8.5 MB), not a partial download |
| `port is already allocated` / start.bat says a port is in use | Edit `.env`, change the named port (`MSSQL_PORT`, `SYM_SOURCE_PORT`, `SYM_TARGET_PORT`, `MONITOR_PORT`), then `start.bat`. An existing `.env` keeps its old values: edit it, or delete it to get the new defaults |
| Containers show *Exited* in Docker Desktop (SQL Server / sym-source / monitor stopped) | `docker compose ps -a`, then `docker compose logs mssql` (exit 137 = out of memory: raise Docker memory), `docker compose logs sym-source sym-config`. Then run `start.bat` again. `mssql-init` and `sym-config` showing *Exited (0)* is normal: they are one-shot jobs |
| Monitor shows a red "Database not reachable" banner | SQL Server is stopped or still starting: run `start.bat`, wait a minute, the page recovers by itself. Old monitor versions crashed with `(c \|\| []).filter is not a function`: update the project and `docker compose build monitor` |
| Drive/file sharing error mentioning the project path | Move the folder to `C:\symds` or under `C:\Users\<you>` |
| start.bat ends with `WARNING: ... not identical` | Run `status.bat`. Wait a minute and run it again. If target tables stay empty: `reset.bat` then `start.bat` |
| Monitor build fails (`SELF_SIGNED_CERT`, network) | A corporate proxy is inspecting HTTPS. Use a network without TLS inspection, or ask IT for the proxy CA to be trusted in Docker Desktop |
| Error batch never clears | Open **Errors**, read the SQL message, fix on the **target** (drop the constraint / add the missing row); it retries in seconds |
| Changed a password after the first start | `reset.bat`, then `start.bat` |
| A `.sh` file edited in Notepad stops working | Shell/SQL files must keep Unix (LF) line endings: edit with VS Code/Notepad++ set to LF, or do not edit them |

## 10. What is where
`docker-compose.yml` services and startup order · `mssql/` restore + logins · `symds/config/sym-config.sql` what is replicated ·
`symds/engines/*.properties.example` node settings (password injected from `.env`) · `tools/` scripts that run **inside** a helper container ·
`monitor/` UI + API · `*.bat` Windows launchers · `scripts/*.sh` the same actions for Linux/macOS users · `README.md` design notes and lessons learned.
