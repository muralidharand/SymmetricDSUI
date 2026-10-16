// READ-ONLY access to what the monitor saved (connections with encrypted passwords, syncs). Nothing is ever written here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = process.env.MONITOR_DATA_DIR || '/monitor-data';

function secret() {
  if (process.env.MONITOR_SECRET) return process.env.MONITOR_SECRET;
  try { return fs.readFileSync(path.join(DIR, 'secret.key'), 'utf8').trim(); } catch { return ''; }
}
function decrypt(b64) {
  const key = crypto.createHash('sha256').update(secret()).digest();
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

const cache = new Map();   // file -> { mtime, data }
function readJson(name, dflt) {
  const f = path.join(DIR, name);
  try {
    const m = fs.statSync(f).mtimeMs; const c = cache.get(f);
    if (c && c.mtime === m) return c.data;
    const data = JSON.parse(fs.readFileSync(f, 'utf8')); cache.set(f, { mtime: m, data }); return data;
  } catch { return dflt; }
}

// The monitor's built-in demo connections use a read-only login; the tester needs to write, so it uses its own login for the demo databases.
const demoHost = () => process.env.MSSQL_HOST || 'mssql';
const DEMO = {
  'demo-source': () => ({ id: 'demo-source', name: 'Demo source (AdventureWorksLT)', host: demoHost(), port: Number(process.env.MSSQL_PORT || 1433), database: process.env.SOURCE_DB || 'AW_Source', user: process.env.DEMO_DB_USER || 'symds', password: process.env.DEMO_DB_PASSWORD || '', encrypt: true, trustCert: true }),
  'demo-target': () => ({ id: 'demo-target', name: 'Demo target (AdventureWorksLT)', host: demoHost(), port: Number(process.env.MSSQL_PORT || 1433), database: process.env.TARGET_DB || 'AW_Target', user: process.env.DEMO_DB_USER || 'symds', password: process.env.DEMO_DB_PASSWORD || '', encrypt: true, trustCert: true }),
};

export function connectionConfig(id) {
  if (DEMO[id]) return DEMO[id]();
  const c = readJson('connections.json', {})[id];
  if (!c || c.system) return null;
  let password = '';
  try { password = c.passwordEnc ? decrypt(c.passwordEnc) : ''; } catch { throw Object.assign(new Error('Cannot decrypt the saved password: MONITOR_SECRET differs from the monitor\'s key'), { statusCode: 500 }); }
  return { ...c, password };
}
const connName = (id) => (DEMO[id] ? DEMO[id]().name : readJson('connections.json', {})[id]?.name || id);

export function listSyncs() {
  const out = [{ id: 'demo', name: 'Demo (AdventureWorksLT, docker compose)', system: true, state: 'running', sourceConnId: 'demo-source', targetConnId: 'demo-target' }];
  for (const p of Object.values(readJson('pairs.json', {}))) {
    if (p.system || p.state === 'removed') continue;
    out.push({ id: p.id, name: p.name, system: false, state: p.state, sourceConnId: p.sourceConnId, targetConnId: p.targetConnId });
  }
  return out.map((s) => ({ ...s, sourceName: connName(s.sourceConnId), targetName: connName(s.targetConnId) }));
}
export const getSync = (id) => listSyncs().find((s) => s.id === id) || null;
