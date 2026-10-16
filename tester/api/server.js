import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { explain } from './db.js';
import { listSyncs, getSync } from './store.js';
import { login, logout, sessionOf, guard, authConfigured } from './auth.js';
import { tableList, replicatedMap, tableMeta } from './catalog.js';
import { listRecords, insertRecord, updateRecord, deleteRecord, lookup, getByPk, editable } from './records.js';
import { statuses, waitReplicated } from './verify.js';

const app = Fastify({ logger: { level: 'warn' } });
const here = path.dirname(fileURLToPath(import.meta.url));
app.addHook('onRequest', (req, reply, done) => guard(req, reply, done));
app.setErrorHandler((err, req, reply) => reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({ error: explain(err) }));
const fail = (code, msg) => Object.assign(new Error(msg), { statusCode: code });
const audit = (user, what) => console.log(JSON.stringify({ at: new Date().toISOString(), user, ...what }));

// ----- sign-in -----
app.get('/api/session', async (req) => { const u = sessionOf(req); return { authenticated: !!u, user: u?.user || null, configured: authConfigured() }; });
app.post('/api/login', (req, reply) => login(req, reply));
app.post('/api/logout', (req, reply) => logout(req, reply));

// ----- context: which sync, which side -----
function ctxOf(req, src = {}) {
  const sync = getSync(req.params.id); if (!sync) throw fail(404, 'Unknown sync');
  const side = (src.side || req.query?.side || 'source') === 'target' ? 'target' : 'source';
  return { sync, side, srcCid: sync.sourceConnId, tgtCid: sync.targetConnId, cid: side === 'target' ? sync.targetConnId : sync.sourceConnId };
}
async function metaOf(c, schema, table) {
  if (!schema || !table) throw fail(400, 'schema and table are required');
  const m = await tableMeta(c.cid, schema, table); if (!m) throw fail(404, `Table ${schema}.${table} not found on the ${c.side}`);
  return m;
}
function writeGuard(req, c) {                       // writes to the target are not replicated back: explicit opt-in per request
  if (c.side === 'target' && req.headers['x-target-write'] !== 'yes') throw fail(403, 'The target is read-only here. Tick "I understand" to write to the target (changes are NOT replicated back to the source).');
}

app.get('/api/meta', async () => ({ writeToTarget: 'opt-in' }));
app.get('/api/syncs', async () => listSyncs());

app.get('/api/syncs/:id/tables', async (req) => {
  const c = ctxOf(req); const rep = await replicatedMap(c.srcCid);
  const tables = await tableList(c.cid);
  return tables.map((t) => ({ ...t, replicated: rep.has(`${t.schema}.${t.table}`), excluded: rep.get(`${t.schema}.${t.table}`)?.excluded || [] }));
});
app.get('/api/syncs/:id/meta', async (req) => {
  const c = ctxOf(req); const m = await metaOf(c, req.query.schema, req.query.table); const rep = (await replicatedMap(c.srcCid)).get(`${m.schema}.${m.table}`);
  return { ...m, side: c.side, replicated: !!rep, excluded: rep?.excluded || [], canEdit: m.pk.length > 0 };
});
app.get('/api/syncs/:id/records', async (req) => {
  const c = ctxOf(req); const m = await metaOf(c, req.query.schema, req.query.table);
  return listRecords(c.cid, m, req.query);
});
app.get('/api/syncs/:id/record', async (req) => {
  const c = ctxOf(req); const m = await metaOf(c, req.query.schema, req.query.table);
  let key; try { key = JSON.parse(req.query.key); } catch { throw fail(400, 'bad key'); }
  const row = await getByPk(c.cid, m, key); if (!row) throw fail(404, 'Row not found'); return row;
});
app.get('/api/syncs/:id/lookup', async (req) => {
  const c = ctxOf(req); const m = await metaOf(c, req.query.schema, req.query.table);
  const col = m.columns.find((x) => x.name === req.query.column); if (!col?.fk) throw fail(400, 'Not a foreign-key column');
  const ref = await tableMeta(c.cid, col.fk.schema, col.fk.table); if (!ref) throw fail(404, 'Referenced table not found');
  return lookup(c.cid, col.fk, col.fk.labelColumn, { q: req.query.q, value: req.query.value });
});

// ----- writes -----
app.post('/api/syncs/:id/records', async (req) => {
  const b = req.body || {}; const c = ctxOf(req, b); writeGuard(req, c); const m = await metaOf(c, b.schema, b.table);
  const r = await insertRecord(c.cid, m, b.values || {});
  audit(req.user, { op: 'insert', sync: c.sync.id, side: c.side, table: `${m.schema}.${m.table}`, key: r.key });
  return { ...r, writtenAt: Date.now() };
});
app.put('/api/syncs/:id/records', async (req) => {
  const b = req.body || {}; const c = ctxOf(req, b); writeGuard(req, c); const m = await metaOf(c, b.schema, b.table);
  const row = await updateRecord(c.cid, m, b.key || {}, b.values || {});
  audit(req.user, { op: 'update', sync: c.sync.id, side: c.side, table: `${m.schema}.${m.table}`, key: b.key });
  return { row, key: b.key, writtenAt: Date.now() };
});
app.post('/api/syncs/:id/records/delete', async (req) => {
  const b = req.body || {}; const c = ctxOf(req, b); writeGuard(req, c); const m = await metaOf(c, b.schema, b.table);
  await deleteRecord(c.cid, m, b.key || {});
  audit(req.user, { op: 'delete', sync: c.sync.id, side: c.side, table: `${m.schema}.${m.table}`, key: b.key });
  return { deleted: true, key: b.key, writtenAt: Date.now() };
});

// ----- replication feedback (source -> target) -----
app.post('/api/syncs/:id/status', async (req) => {
  const b = req.body || {}; const c = ctxOf(req, b); if (!Array.isArray(b.keys)) throw fail(400, 'keys required');
  await metaOf({ ...c, cid: c.srcCid, side: 'source' }, b.schema, b.table);
  return statuses({ srcCid: c.srcCid, tgtCid: c.tgtCid, schema: b.schema, table: b.table }, b.keys.slice(0, 60));
});
app.post('/api/syncs/:id/wait', async (req) => {
  const b = req.body || {}; const c = ctxOf(req, b);
  await metaOf({ ...c, cid: c.srcCid, side: 'source' }, b.schema, b.table);
  return waitReplicated({ srcCid: c.srcCid, tgtCid: c.tgtCid, schema: b.schema, table: b.table }, b.key || {}, { timeoutMs: Math.min(Number(b.timeoutMs) || 30000, 60000) });
});

const web = path.join(here, 'public');
if (fs.existsSync(web)) {
  await app.register(fastifyStatic, { root: web });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
}
if (!authConfigured()) console.warn('WARNING: MONITOR_ADMIN_PASSWORD is not set - sign-in is disabled');
await app.listen({ port: Number(process.env.PORT || 8080), host: '0.0.0.0' });
console.log('tester api listening on', process.env.PORT || 8080);
