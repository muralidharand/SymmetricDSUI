# SymmetricDS 3.16 Community — SQL Server → SQL Server POC (Phase 1 + 2)

> **Windows 11 + Docker Desktop (nothing else to install): follow [docs/WINDOWS-DOCKER-DESKTOP.md](docs/WINDOWS-DOCKER-DESKTOP.md)**: double-click `start.bat`.

AdventureWorksLT2022 restored twice on one SQL Server 2022 container (`AW_Source`, `AW_Target`).
Two SymmetricDS 3.16 nodes (`jumpmind/symmetricds:3.16`) (`source-000` registration server, `target-001`) replicate `SalesLT.*` + `dbo.ErrorLog`
one-way, source → target (push), over HTTP.

```
mssql (2022 Developer) ── AW_Source ◄─ sym-source :31415 ──push──► sym-target :31416 ─► AW_Target
                           └ sym_* tables                              └ sym_* tables
```

## Run
Windows: see the guide above (`start.bat`, `stop.bat`, `db-restore.bat`, `test.bat`, `test-error.bat`, `status.bat`, `reset.bat`).
Linux/macOS (only Docker needed):
```bash
cp .env.example .env            # change passwords
cp /path/to/AdventureWorksLT2022.bak data/
scripts/up.sh                   # docker compose up -d --build, then waits for parity (SKIP_MONITOR=1 skips the monitor build)
scripts/smoke-test.sh           # insert/update/delete, waits for the target to match
scripts/chaos-error.sh          # forces an error batch on the target, shows it blocks, repairs
scripts/verify-parity.sh        # per-table row count + checksum
scripts/status.sh  scripts/stop.sh  scripts/restore-db.sh  scripts/reset.sh
```
All logic lives in `docker-compose.yml` (startup order) and `tools/` (runs inside a helper container), so the Windows `.bat`
files and the Linux scripts are one-liners around `docker compose`.
SQL Server is on `localhost:14330` (sa / `.env`). Read-only login for the Phase 2 UI: `monitor_ro`.

## Verified (2026-10-15, clean build)
| Test | Result |
|---|---|
| Restore .bak ×2 on `mssql/server:2022-latest` | OK (847 customers, 32 orders, 542 order lines) |
| Initial load, all 11 tables incl. computed cols + XML | parity OK (~25 s) |
| INSERT/UPDATE/DELETE incl. order → detail trigger chain | parity in ~6 s |
| Restart both nodes mid-stream | no loss / no duplicates (parity ~34 s after restart) |
| Error injection (CHECK constraint on target) | error shown, later changes queue behind it, auto-recovers after fix |

## Problems actually hit while building this (and fixes)
1. **`sqlcmd` + computed/indexed objects → "QUOTED_IDENTIFIER" error.** Use `sqlcmd -I`.
2. **Business triggers replay on target.** `iduSalesOrderDetail` / `uSalesOrderHeader` recompute `SubTotal`/`ModifiedDate`;
   SymmetricDS only suppresses *its own* capture triggers. They are `DISABLE`d on the target (`mssql/02-prepare.sql`).
3. **Table without primary key (`dbo.BuildVersion`)** → every reload appends duplicates. Excluded from sync; add a PK or leave out.
4. **Image default command exits 129 on `docker restart`** (daemon wrapper + stale PID). Compose runs `/opt/symmetric-ds/bin/sym` in the foreground + `restart: unless-stopped`.
5. **Registering the target before capture triggers exist → initial load of zero tables**, silently. The compose chain now starts `sym-target` only after the `sym-config` job has loaded the config and the 33 triggers exist.
6. **`initial_load_select` with `ORDER BY` breaks the load.** SymmetricDS wraps it in `COUNT(*)`; the job throws and *no reload batches are created*, no obvious error in the console. Don't.
7. **Repeated `reload-node` while live changes flow** wipes the target tables first; the in-flight batches then fail on FKs and 3.16's automatic *foreign-key correction* re-sends parent rows out of order (ProductCategory is self-referencing) → retry loop with ever-growing batch ids. Rule: one reload at a time, only when the channel is quiet; if stuck, reset target and reload once.
8. **FK violations self-heal** (parent rows auto-reloaded), so they are a bad way to test error handling; a CHECK constraint is deterministic.
9. **Error visibility:** the failing batch shows `LD` + `sql_message` on the *source* `sym_outgoing_batch`, and `ER` on the *target* `sym_incoming_batch`. The Phase 2 UI must read both.
10. **Latency** is ~2–6 s only because job periods are set to 2000 ms (default 10 000 ms).
11. **Credentials:** engine property files contain DB passwords — gitignored; use `symadmin encrypt-text` / secret stores in Phase 3.
12. **Single ordered channel `aw_data`** by design: separate channels (customer vs. orders) can arrive out of order across FKs.

---
# Phase 2 — Monitoring UI (`monitor/`)
Node 22 + Fastify API (`monitor/api`) and React/Vite/Recharts UI (`monitor/web`), served by one container on **http://localhost:8080**.
It connects with the `monitor_ro` login (`db_datareader` only — it cannot modify anything) to both databases and reads the `sym_*` tables.

```bash
docker compose up -d --build monitor      # needs outbound access to the npm registry during build
# or, local dev:  (cd monitor/api && npm i && MSSQL_HOST=localhost MSSQL_PORT=14330 MONITOR_RO_PASSWORD=... node server.js)
#                 (cd monitor/web && npm i && npm run dev)
```
| Page | Shows |
|---|---|
| Overview | alerts, backlog, error count, avg/p95/max latency (live-change channels), rows/min per channel, node health (heartbeat, memory, registration, initial load) |
| Batches | outgoing (source) / incoming (target) batches, filter by status/channel, click for details |
| Errors | failing batches with the SQL error, the incoming error row, retry hint |
| Parity | per-table row count + checksum, source vs target |
| Channels & routing | channel stats, trigger→router config, group links (read-only) |
| Live feed | changes captured on the source (SSE) |

Alerts: failing batch (critical), stale heartbeat (> `STALE_HEARTBEAT_MIN`, default 20 — SymmetricDS heartbeats every 15 min), backlog > `BACKLOG_WARN` (20), persistent table mismatch with no backlog.

Phase 2 findings:
- With a one-way link the target never sends its heartbeat to the source, so node 001's host info exists only in `AW_Target`; the API merges both.
- A failing batch is `LD` + `sql_message` on the source and `ER` on the target — the UI reads both sides.
- `sym_node.batch_to_send_count` etc. are `-1` until computed; shown as blank.
- Latency excludes the `reload` channel (bulk loads would skew it).
- Not built: write actions (retry/ignore batch, request reload). The API is deliberately read-only (`/api/meta` → `write_actions:false`); add them behind a separate login + audit log if wanted.
