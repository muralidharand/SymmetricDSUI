import sql from 'mssql';

// Read-only login (db_datareader) on both databases. One pool per side.
const base = (database) => ({
  server: process.env.MSSQL_HOST || 'mssql',
  port: Number(process.env.MSSQL_PORT || 1433),
  user: process.env.MONITOR_USER || 'monitor_ro',
  password: process.env.MONITOR_RO_PASSWORD,
  database,
  options: { encrypt: true, trustServerCertificate: process.env.TRUST_CERT !== 'false' },
  pool: { max: 4, idleTimeoutMillis: 30000 },
  requestTimeout: 15000,
});
export const sides = { source: null, target: null };
const names = { source: process.env.SOURCE_DB || 'AW_Source', target: process.env.TARGET_DB || 'AW_Target' };

export async function pool(side) {
  if (!sides[side]) {
    const p = new sql.ConnectionPool(base(names[side]));
    p.on('error', () => { sides[side] = null; });
    sides[side] = p.connect().catch((e) => { sides[side] = null; throw e; });
  }
  return sides[side];
}
export async function q(side, text, params = {}) {
  const p = await pool(side);
  const r = p.request();
  for (const [k, v] of Object.entries(params)) r.input(k, v);
  return (await r.query(text)).recordset;
}
export const dbNames = names;
