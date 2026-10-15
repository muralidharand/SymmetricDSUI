// Persistent storage for saved connections, sync pairs and the audit log (JSON files in the monitor-data volume).
// Connection passwords are encrypted at rest with AES-256-GCM and are never returned by the API.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadSecret() {
  if (process.env.MONITOR_SECRET) return process.env.MONITOR_SECRET;
  const f = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const KEY = crypto.createHash('sha256').update(loadSecret()).digest();

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function decrypt(b64) {
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

const file = (n) => path.join(DATA_DIR, n);
function load(name, dflt) { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return dflt; } }
function save(name, obj) { const t = file(name) + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 2)); fs.renameSync(t, file(name)); }

let connections = load('connections.json', {});
let pairs = load('pairs.json', {});
const persistConns = () => save('connections.json', connections);
const persistPairs = () => save('pairs.json', pairs);

export function audit(user, action, detail = {}) {
  try { fs.appendFileSync(file('audit.log'), JSON.stringify({ at: new Date().toISOString(), user, action, ...detail }) + '\n'); } catch { /* best effort */ }
}

const id = (prefix) => `${prefix}-${crypto.randomBytes(3).toString('hex')}`;
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'x';

// ---- connections ----
export const publicConn = (c) => { const { passwordEnc, ...rest } = c; return { ...rest, hasPassword: !!passwordEnc }; };
export const listConnections = () => Object.values(connections).map(publicConn);
export const getConnection = (cid) => connections[cid] || null;
export function connectionConfig(cid) {          // full config incl. decrypted password, for internal use only
  const c = connections[cid]; if (!c) return null;
  return { ...c, password: c.passwordEnc ? decrypt(c.passwordEnc) : '' };
}
export function upsertConnection(input, user) {
  const existing = input.id ? connections[input.id] : null;
  if (existing?.system) throw Object.assign(new Error('The built-in demo connections cannot be edited'), { statusCode: 400 });
  const c = {
    id: existing?.id || id('conn'),
    name: String(input.name || '').trim(),
    host: String(input.host || '').trim(),
    port: Number(input.port || 1433),
    database: String(input.database || '').trim(),
    user: String(input.user || '').trim(),
    encrypt: input.encrypt !== false,
    trustCert: input.trustCert !== false,
    notes: String(input.notes || '').slice(0, 300),
    passwordEnc: input.password ? encrypt(input.password) : existing?.passwordEnc || '',
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  const bad = validateConnection(c);
  if (bad) throw Object.assign(new Error(bad), { statusCode: 400 });
  if (Object.values(connections).some((x) => x.id !== c.id && x.name.toLowerCase() === c.name.toLowerCase())) throw Object.assign(new Error(`A connection named "${c.name}" already exists`), { statusCode: 400 });
  connections[c.id] = c; persistConns();
  audit(user, existing ? 'connection.update' : 'connection.create', { id: c.id, name: c.name, host: c.host, database: c.database });
  return publicConn(c);
}
export function validateConnection(c) {
  if (!c.name) return 'Name is required';
  if (!/^[A-Za-z0-9._-]+$/.test(c.host)) return 'Host may only contain letters, digits, dot, dash, underscore (use the server name or IP; no port or instance path)';
  if (!(c.port > 0 && c.port < 65536)) return 'Port must be 1-65535';
  if (!/^[A-Za-z0-9_$ .-]+$/.test(c.database)) return 'Database name contains unsupported characters';
  if (!c.user) return 'User is required';
  if (!c.passwordEnc) return 'Password is required';
  return null;
}
export function deleteConnection(cid, user) {
  const c = connections[cid]; if (!c) return false;
  if (c.system) throw Object.assign(new Error('The built-in demo connections cannot be deleted'), { statusCode: 400 });
  const used = Object.values(pairs).find((p) => p.sourceConnId === cid || p.targetConnId === cid);
  if (used) throw Object.assign(new Error(`Connection is used by sync "${used.name}". Remove that sync first`), { statusCode: 409 });
  delete connections[cid]; persistConns(); audit(user, 'connection.delete', { id: cid, name: c.name });
  return true;
}
export function seedSystemConnection(c) { connections[c.id] = { ...c, system: true }; persistConns(); }

// ---- pairs ----
export const listPairs = () => Object.values(pairs);
export const getPair = (pid) => pairs[pid] || null;
export function savePair(p) { pairs[p.id] = p; persistPairs(); return p; }
export function deletePair(pid) { delete pairs[pid]; persistPairs(); }
export const newPairId = (name) => `${slug(name)}-${crypto.randomBytes(2).toString('hex')}`;
export { id as newId };
