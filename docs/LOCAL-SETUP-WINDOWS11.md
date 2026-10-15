# Run the SymmetricDS sync POC on Windows 11 + Docker Desktop

Everything in this project runs as **Linux**: Linux containers (SQL Server 2022, SymmetricDS, the monitor) and
bash scripts. On Windows 11 you get that with **Docker Desktop (WSL2 backend)** and a **WSL Ubuntu terminal**.
Do not run the scripts from PowerShell/CMD, and do not keep the project on `C:\` (see section 1).

```
 Windows 11 host
 ├─ Docker Desktop (WSL2 engine)
 └─ WSL2 Ubuntu  ── you work here: git clone, scripts/*.sh, docker compose
        └─ containers: mssql (AW_Source + AW_Target) · sym-source :31415 · sym-target :31416 · monitor :8080
```

## 1. One-time prerequisites
| Need | How |
|---|---|
| Windows 11 with virtualization on | Task Manager → Performance → CPU → *Virtualization: Enabled* (else enable in BIOS) |
| WSL2 + Ubuntu | PowerShell (admin): `wsl --install -d Ubuntu`, reboot, create the Linux user |
| Docker Desktop | Install from docker.com. Settings → General → **Use the WSL 2 based engine** ✔ |
| Docker ↔ Ubuntu link | Settings → Resources → WSL integration → enable **Ubuntu** → Apply & restart |
| Memory for SQL Server | SQL Server needs ≥ 2 GB, whole stack ~4 GB. Create `C:\Users\<you>\.wslconfig`:<br>`[wsl2]`<br>`memory=6GB`<br>`processors=4`<br>then PowerShell: `wsl --shutdown`, restart Docker Desktop |
| Architecture | x64 PC. (On Windows-on-ARM the SQL Server image runs under emulation and is unreliable.) |

Check inside the Ubuntu terminal:
```bash
docker version        # shows Client AND Server; if Server is missing, Docker Desktop is not running / WSL integration is off
docker compose version
git --version
```
**Work inside the Linux filesystem** (`~/`), not `/mnt/c/...`: it is much faster, and a checkout from Windows
git may convert line endings to CRLF, which breaks the shell scripts inside containers
(`bad interpreter: /bin/bash^M`).

## 2. Get the code and the database backup
```bash
cd ~
git clone -b add-monitor-ui https://github.com/muralidharand/symmetricdsui.git
cd symmetricdsui

# copy AdventureWorksLT2022.bak from Windows (adjust the path) into ./data
cp "/mnt/c/Users/<your-windows-user>/Downloads/AdventureWorksLT2022.bak" data/
ls -l data/            # ~8.5 MB
```
(The .bak is not in git. Official download: *AdventureWorksLT2022.bak* from Microsoft's sql-server-samples release page.)

## 3. Configure passwords
```bash
cp .env.example .env
nano .env              # change the three passwords (see rules below)
```
Password rules: SQL Server complexity (8+ chars, upper, lower, digit, symbol) and **no** backslash, quotes, `$`, `#`
or spaces (they break `.env` / `.properties` parsing; `up.sh` checks this). Defaults in `.env.example` are fine for a throw-away local POC.
Ports (change only if they clash): SQL Server `14330`, source node `31415`, target node `31416`, monitor `8080`.

## 4. Start everything and begin the sync
```bash
scripts/up.sh
```
First run downloads ~2.5 GB of images and builds the monitor (5–10 min). Later runs take about a minute.
What it does, in order (and what you should see):

| Step | Output / meaning |
|---|---|
| generate `symds/engines/*.properties` | from `.env`; git-ignored because they hold the DB password |
| start `mssql`, run `mssql-init` | restores the .bak **twice** as `AW_Source` and `AW_Target`, creates logins, empties the target |
| start `sym-source` | SymmetricDS creates its `sym_*` tables in `AW_Source` |
| load `symds/config/sym-config.sql` | node groups, link (source → target push), channel, router, 11 table triggers |
| wait for 33 capture triggers | 3 per table (insert/update/delete) |
| open registration + start `sym-target` | target registers with the source node |
| **initial load** | automatic: SymmetricDS copies all rows source → target |
| wait for parity | ends with `PARITY OK: source and target match` |
| start `monitor` | UI at http://localhost:8080 |

The sync is now running continuously: every change committed in `AW_Source` is captured by triggers, routed,
pushed and applied to `AW_Target` within a few seconds.

## 5. Test the sync
**Automated (recommended first):**
```bash
scripts/verify-parity.sh   # per-table row count + checksum, source vs target; exit 0 = identical
scripts/smoke-test.sh      # inserts a customer, order and lines; updates; deletes; waits until target matches (≈ 5–10 s)
scripts/chaos-error.sh     # breaks the target on purpose, shows the error batch, repairs it, proves recovery
```
**By hand** (use any SQL client — Azure Data Studio / SSMS on Windows: server `localhost,14330`, login `sa`,
password from `.env`, tick *Trust server certificate*; or the CLI):
```bash
source .env
Q() { docker compose exec -T mssql /opt/mssql-tools18/bin/sqlcmd -C -I -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -W "$@"; }

# 1) change something on the SOURCE
Q -d AW_Source -Q "UPDATE SalesLT.Customer SET CompanyName = N'Hello Sync' WHERE CustomerID = 1"
# 2) a few seconds later, read it from the TARGET
Q -d AW_Target -Q "SELECT CustomerID, CompanyName FROM SalesLT.Customer WHERE CustomerID = 1"
```
Also try an `INSERT` and a `DELETE` on `AW_Source.SalesLT.*`. Writes on the target are *not* replicated back (one-way).

| Scenario | Expected |
|---|---|
| Insert/update/delete on any `SalesLT.*` table or `dbo.ErrorLog` | appears on target in ~2–10 s |
| Stop target: `docker compose stop sym-target`, change data, `docker compose start sym-target` | changes queue up (Monitor → Overview *Backlog*), then drain; nothing lost |
| `docker compose restart sym-source sym-target` | catches up, no duplicates (`verify-parity.sh`) |
| `scripts/chaos-error.sh` | Monitor shows a red alert and the SQL error; fixed → alert clears |
| `dbo.BuildVersion` | **not** replicated (no primary key) |

## 6. Monitor the sync
Open **http://localhost:8080** (read-only UI):
| Page | Use it to |
|---|---|
| **Overview** | red/green alerts, *Backlog* (batches not yet loaded), *Errors*, latency avg/p95/max, rows per minute, node health (heartbeat age, memory) |
| **Batches** | every batch: *Outgoing* (read from source DB) or *Incoming* (target DB); filter by status/channel; click a row for all counters |
| **Errors** | failing batches, the exact SQL error and the failing row; the batch retries by itself once you fix the cause |
| **Parity** | per-table source vs target rows + checksum; transient differences while batches are in flight are normal |
| **Channels & routing** | which table → which channel/router, and the link direction |
| **Live feed** | changes as they are captured on the source (I insert · U update · D delete · R reload) |

Batch status codes: `NE` new · `RT` routed · `QY` queried · `SE` sent · `LD` loading · **`OK` done** · **`ER` error** · `IG` ignored · `RQ` resend.
A failing batch shows as `LD` + message on the source side and `ER` on the target side. While one batch is in error,
later changes on the same channel wait behind it (this keeps foreign-key order).

Command-line equivalents:
```bash
scripts/status.sh                                   # containers, nodes, batch counts, failing batches, parity
docker compose logs -f sym-source sym-target        # SymmetricDS logs (Ctrl-C to stop)
docker compose logs -f monitor
```

## 7. Stop, start, restore the databases, reset
**Double-click launchers** (they just call the Linux scripts below through WSL; folder `windows/`):

| File | Does |
|---|---|
| `windows\start.bat` | starts Docker Desktop if needed, runs `scripts/up.sh` (first run: full setup; later: resume, data kept), opens the monitor |
| `windows\stop.bat` | `scripts/stop.sh`: stops everything, **keeps all data** |
| `windows\db-restore.bat` | asks for `YES`, then `scripts/restore-db.sh`: **drops AW_Source and AW_Target**, restores both from the .bak and re-runs the initial load |
| `windows\status.bat` | `scripts/status.sh` |

Setup: copy the `windows` folder out of WSL to e.g. `C:\symds\` (in Explorer open `\\wsl$\Ubuntu\home\<linux-user>\symmetricdsui\windows`),
then edit `config.bat`: `DISTRO` (see `wsl -l -q`) and `REPO` (default `~/symmetricdsui`). Keep all the files in that folder together.
The `.bat` files are not required: the same actions from the Ubuntu terminal are:
```bash
scripts/stop.sh                # stop, keep data
scripts/up.sh                  # start again / resume (safe to re-run, never wipes replicated data)
scripts/restore-db.sh          # re-restore both DBs from the .bak + re-init sync (asks YES; --yes skips)
docker compose down            # remove containers, keep database volume
scripts/reset.sh               # DELETE everything incl. databases (docker compose down -v); then run scripts/up.sh
```
After a reboot Docker Desktop restarts the containers by itself (SymmetricDS has `restart: unless-stopped`).

## 8. Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `Cannot connect to the Docker daemon` / `docker: command not found` in Ubuntu | Start Docker Desktop; enable WSL integration for Ubuntu (section 1); `wsl --shutdown` and retry |
| `/bin/bash^M: bad interpreter` or `$'\r': command not found` | Repo was checked out with Windows line endings. Re-clone **inside WSL** (`~/`), not under `/mnt/c` |
| `mssql` unhealthy / exits | Not enough memory: raise `.wslconfig` memory (≥ 6 GB) and `wsl --shutdown`. Check `docker compose logs mssql` (password complexity, EULA) |
| `ERROR: put AdventureWorksLT2022.bak in ./data/` / "looks too small" | Copy the real ~8.5 MB file (section 2) |
| Restore fails ("cannot open backup device") | `ls -l data/`; file must be readable; run `docker compose logs mssql-init` |
| Port already allocated (1433/8080/…) | Change `MSSQL_PORT`, `SYM_SOURCE_PORT`, `SYM_TARGET_PORT`, `MONITOR_PORT` in `.env`, re-run |
| `up.sh` ends with `WARNING: not in parity yet` | Run `scripts/status.sh`. Wait a minute and re-run `scripts/verify-parity.sh`. If target tables stay empty: `docker compose exec -T sym-source /opt/symmetric-ds/bin/symadmin --engine source-000 reload-node 001` (do this once, when no changes are flowing) |
| Monitor build fails (`npm ... SELF_SIGNED_CERT` / network) | Corporate proxy intercepts HTTPS. Build on a network without TLS inspection, or add the proxy's CA to the build |
| Monitor page opens but shows "Failed to load" | `docker compose logs monitor`; check `monitor_ro` password in `.env` equals the one used when the DB was first created (else `scripts/reset.sh`) |
| Error batch that never clears | Open **Errors** page, read the SQL message, fix on the **target** (e.g. drop the constraint / add the missing row), batch retries within seconds |
| Changed a password in `.env` after first run | Passwords are baked into the DB and `symds/engines/*.properties`. Run `scripts/reset.sh`, delete `symds/engines/*.properties`, `scripts/up.sh` |
| Latency 2–10 s | Intentional demo tuning (job intervals 2 s). SymmetricDS default is 10 s |

## 9. Files you may want to know
`docker-compose.yml` (services) · `mssql/` (restore + logins) · `symds/config/sym-config.sql` (what is replicated)
· `symds/engines/*.properties.example` (node config templates) · `scripts/` (up, status, verify-parity, smoke-test, chaos-error, reset)
· `monitor/` (API + UI) · `README.md` (design notes and the problems found while building).
