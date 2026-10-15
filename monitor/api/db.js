// SQL Server connection pools, one per saved connection (the built-in demo connections come from environment variables).
import sql from 'mssql';
import { connectionConfig, seedSystemConnection, getConnection } from './store.js';

const pools = new Map();

function toConfig(c, extra = {}) {
  return {
    server: c.host, port: c.port, user: c.user, password: c.password, database: c.database,
    options: { encrypt: c.encrypt !== false, trustServerCertificate: c.trustCert !== false },
    pool: { max: 4, idleTimeoutMillis: 30000 },
    connectionTimeout: 10000, requestTimeout: 20000,
    ...extra,
  };
}

export function seedDemo() {
  const host = process.env.MSSQL_HOST || 'mssql';
  const port = Number(process.env.MSSQL_PORT || 1433);
  const user = process.env.MONITOR_USER || 'monitor_ro';
  // password for system connections is kept in the environment, not on disk
  for (const [cid, db, name] of [['demo-source', process.env.SOURCE_DB || 'AW_Source', 'Demo source (AdventureWorksLT)'], ['demo-target', process.env.TARGET_DB || 'AW_Target', 'Demo target (AdventureWorksLT)']]) {
    seedSystemConnection({ id: cid, name, host, port, database: db, user, encrypt: true, trustCert: true, notes: 'Built-in read-only demo connection', passwordEnc: '', createdAt: new Date().toISOString() });
  }
}
function cfgFor(cid) {
  const c = getConnection(cid);
  if (!c) throw Object.assign(new Error(`Unknown connection ${cid}`), { statusCode: 404 });
  if (c.system) return { ...c, password: process.env.MONITOR_RO_PASSWORD || '' };
  return connectionConfig(cid);
}

export function pool(cid) {
  if (!pools.has(cid)) {
    const p = new sql.ConnectionPool(toConfig(cfgFor(cid)));
    p.on('error', () => pools.delete(cid));
    pools.set(cid, p.connect().catch((e) => { pools.delete(cid); throw e; }));
  }
  return pools.get(cid);
}
export function dropPool(cid) { const p = pools.get(cid); pools.delete(cid); p?.then((x) => x.close()).catch(() => {}); }

export async function q(cid, text, params = {}) {
  const r = (await pool(cid)).request();
  for (const [k, v] of Object.entries(params)) r.input(k, v);
  return (await r.query(text)).recordset;
}
// run several statements on ONE connection, as a batch (used for DDL / config writes)
export async function exec(cid, text, params = {}) {
  const r = (await pool(cid)).request();
  for (const [k, v] of Object.entries(params)) r.input(k, v);
  return r.batch(text);
}

// Friendly classification of connection failures
export function explain(e) {
  const m = String(e?.message || e);
  const code = e?.code || e?.originalError?.code;
  let hint = '';
  if (/Login failed for user/i.test(m)) hint = 'The user name or password is wrong, or the login has no access to this database.';
  else if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(m)) hint = 'The host name cannot be resolved from the Docker network. For a SQL Server on this Windows PC use host.docker.internal; for Azure use the full server name (xxx.database.windows.net).';
  else if (/ECONNREFUSED|ETIMEDOUT|ESOCKET|Failed to connect|Could not connect/i.test(m) || code === 'ETIMEOUT') hint = 'Nothing answered on that host/port. Check the port, that SQL Server accepts TCP/IP connections, and any firewall (Azure SQL: allow your public IP).';
  else if (/certificate|SSL|TLS/i.test(m)) hint = 'TLS problem. For a self-signed server certificate keep "Trust server certificate" ticked.';
  else if (/Cannot open database/i.test(m)) hint = 'The database name does not exist or the login cannot open it.';
  return hint ? `${m} - ${hint}` : m;
}

// Test a connection config that is not saved yet (or a saved one). Returns facts the wizard needs.
export async function testConnection(cfg) {
  const t0 = Date.now();
  const p = new sql.ConnectionPool(toConfig(cfg, { connectionTimeout: 8000, requestTimeout: 15000, pool: { max: 1 } }));
  try {
    await p.connect();
    const r = await p.request().query(`
      SELECT @@VERSION AS version, CAST(SERVERPROPERTY('Edition') AS nvarchar(100)) AS edition, CAST(SERVERPROPERTY('EngineEdition') AS int) AS engine_edition,
             DB_NAME() AS db, SUSER_SNAME() AS login_name, IS_MEMBER('db_owner') AS is_db_owner,
             HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS can_create_table,
             (SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name = DB_NAME()) AS rcsi,
             CASE WHEN OBJECT_ID('dbo.sym_node') IS NULL THEN 0 ELSE 1 END AS has_sym_tables,
             (SELECT COUNT(*) FROM sys.tables WHERE schema_id NOT IN (SCHEMA_ID('sys'), SCHEMA_ID('INFORMATION_SCHEMA')) AND name NOT LIKE 'sym[_]%') AS user_tables`);
    const x = r.recordset[0];
    const major = Number((x.version.match(/- (\d+)\./) || [])[1] || 0);
    const problems = [];
    if (!x.is_db_owner) problems.push('The login is not db_owner in this database. SymmetricDS must create its own tables and triggers, so db_owner is required.');
    if (!x.can_create_table) problems.push('The login cannot CREATE TABLE in this database.');
    if (x.engine_edition === 5 || x.engine_edition === 8) { /* Azure SQL DB / MI: fine */ }
    return { ok: true, latencyMs: Date.now() - t0, version: x.version.split('\n')[0], edition: x.edition, azure: x.engine_edition === 5 || x.engine_edition === 8,
             database: x.db, login: x.login_name, isDbOwner: !!x.is_db_owner, canCreateTable: !!x.can_create_table, rcsi: !!x.rcsi,
             hasSymTables: !!x.has_sym_tables, userTables: x.user_tables, sqlMajor: major, problems };
  } catch (e) {
    return { ok: false, error: explain(e), latencyMs: Date.now() - t0 };
  } finally { p.close().catch(() => {}); }
}
export { cfgFor };
