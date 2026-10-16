import sql from 'mssql';
import crypto from 'node:crypto';
import { connectionConfig } from './store.js';

const pools = new Map();
export { sql };

export function explain(e) {
  const m = String(e?.message || e);
  if (/Login failed/i.test(m)) return `${m} - the saved login/password does not work (open the monitor's Connections tab and test it).`;
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return `${m} - host cannot be resolved from the Docker network.`;
  if (/ECONNREFUSED|ETIMEDOUT|Could not connect|Failed to connect/i.test(m)) return `${m} - nothing answered on that host/port (is SQL Server running?).`;
  return m;
}

export async function pool(cid) {
  const c = connectionConfig(cid);
  if (!c) throw Object.assign(new Error(`Unknown connection ${cid}`), { statusCode: 404 });
  const k = `${cid}:${crypto.createHash('sha1').update(`${c.host}${c.port}${c.database}${c.user}${c.password}`).digest('hex')}`;   // credentials changed in the monitor => new pool
  if (!pools.has(k)) {
    for (const [old] of pools) if (old.startsWith(`${cid}:`)) { pools.get(old).then((p) => p.close()).catch(() => {}); pools.delete(old); }
    const p = new sql.ConnectionPool({ server: c.host, port: c.port, user: c.user, password: c.password, database: c.database,
      options: { encrypt: c.encrypt !== false, trustServerCertificate: c.trustCert !== false }, pool: { max: 6, idleTimeoutMillis: 30000 }, connectionTimeout: 10000, requestTimeout: 30000 });
    p.on('error', () => pools.delete(k));
    pools.set(k, p.connect().catch((e) => { pools.delete(k); throw e; }));
  }
  return pools.get(k);
}

// params: [{ name, type, value }]  (type = an mssql type object, e.g. sql.NVarChar(sql.MAX))
export async function run(cid, text, params = []) {
  const r = (await pool(cid)).request();
  for (const p of params) r.input(p.name, p.type, p.value);
  return (await r.query(text)).recordset || [];
}
