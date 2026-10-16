# Sync Tester – create / edit rows and watch them replicate

A small second web app (own container) that **generates a create form, a list page and an edit page for any table** of a sync, so you can produce real traffic on the **source** and see it arrive on the **target**.

- URL: **http://localhost:19090** (`TESTER_PORT` in `.env`; bound to this PC only, `TESTER_BIND` to change)
- Sign in with the same user/password as the monitor (`MONITOR_ADMIN_USER` / `MONITOR_ADMIN_PASSWORD` in `.env`)
- Start: `start.bat` (it is part of `docker compose up`) – nothing extra to install.

## How to use
1. Pick the **Sync** (the built-in *Demo*, or any sync you created in the monitor wizard).
2. Pick the **Database**: **Source** (where you write) or **Target** (where you watch).
3. Pick **Schema** and **Table** (tables that are really replicated are marked ✓).
4. Tabs:
   - **List** – paging, search, sort, *Edit*, *Duplicate*, *Delete*. On the source, the **Target** column shows for each visible row: `in sync`, `pending` (not arrived yet), `differs`, or `only on target`. On the target the list auto-refreshes every 2 s.
   - **Create** – a form generated from the table columns (see below).
   - **Edit** – same form, filled from the row; the primary key is read-only.
   - **Recent operations** – every write you made with the time it needed to reach the target.
5. After each save the page shows e.g. *Saved on source · replicated to the target in 3.4 s*. If the row does not arrive within the wait it says *pending* – look at the monitor (Errors / Batches pages).

## What the form does
| Column | Control |
|---|---|
| identity, computed, rowversion | skipped on create, shown read-only |
| column with a default | may be left blank ("use default") |
| int/decimal/money | number input, validated |
| bit | true / false / NULL |
| date, time, datetime2, datetimeoffset | date/time pickers |
| uniqueidentifier | text + *Generate* |
| (n)varchar, text | text / textarea with the max length |
| xml, hierarchyid (`/1/2/`), geography/geometry (WKT) | text |
| varbinary/image | file upload (shown as `<binary N bytes>`, compared by SHA-256) |
| foreign key | searchable drop-down (value + a readable label) |

Alias types (e.g. `dbo.Name`) are resolved to their base type. Tables **without a primary key** are list-only.

## Safety
- Table, schema and column names are only accepted if they exist in the database catalog; values are always bound parameters (an injection string is stored as plain data).
- **Target is read-only by default.** Writing there needs the "I understand" box: the change is **not** replicated back to the source and the two databases will differ.
- The tester mounts the monitor's volume read-only to find your saved connections (passwords stay encrypted on disk and are never sent to the browser).

## Limits
- geography/geometry columns are excluded from replication by the wizard: you can write them on the source, but they stay NULL on the target (a warning is shown).
- Typed XML columns are validated against their schema – the SQL Server error is shown as is.
- Non-Latin text (Japanese, Cyrillic, emoji): SymmetricDS must run with `mssql.use.ntypes.for.sync=true`. New demos and wizard-created syncs have it. A sync created earlier shows `?` on the target and the monitor raises an *unicode_capture* alert: recreate the sync (or, for the demo, run `reset.bat`).
