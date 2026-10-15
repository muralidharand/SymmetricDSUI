import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { q as dq, seedDemo, testConnection, dropPool, cfgFor, explain } from './db.js';
import { listConnections, getConnection, upsertConnection, deleteConnection, listPairs, getPair, savePair, newPairId, audit } from './store.js';
import { login, logout, sessionOf, guard, authConfigured } from './auth.js';
import { listTables, loadOrder, compareSchema, userTriggers } from './discovery.js';
import { analyzeDependencies, markExisting } from './dependencies.js';
import { computeParity } from './parity.js';
import { precheck, startApply, pause, resume, reload, remove, engineFilesPresent, recoverInterrupted } from './wizard.js';

const app = Fastify({ logger: { level: 'warn' } });
const here = path.dirname(fileURLToPath(import.meta.url));
const STALE_HEARTBEAT_MIN = Number(process.env.STALE_HEARTBEAT_MIN || 20 /* default heartbeat job period is 15 min */);
const BACKLOG_WARN = Number(process.env.BACKLOG_WARN || 20);

// Status semantics, see SymmetricDS user guide: NE new, RT routed, QY queried, SE sent, LD loading, ER error, IG ignored, OK done, RQ resend requested
const STATUS_ORDER = ['NE', 'RT', 'QY', 'SE', 'LD', 'RQ', 'ER', 'IG', 'OK'];
// Per-request error collector: a failing query degrades to its fallback (arrays stay arrays) and is reported in `errors`.
const als = new AsyncLocalStorage();
app.addHook('onRequest', (req, reply, done) => {
  const pairId = new URL(req.url, 'http://x').searchParams.get('pair') || 'demo';
  als.run({ errors: [], pairId }, () => guard(req, reply, done));
});
const pairIdNow = () => als.getStore()?.pairId || 'demo';
// q('source'|'target', sql, params): runs on the connection of the pair selected with ?pair= (default: the built-in demo)
const q = (side, text, params) => {
  const p = getPair(pairIdNow());
  if (!p) throw Object.assign(new Error(`Unknown sync "${pairIdNow()}"`), { statusCode: 404 });
  return dq(side === 'source' ? p.sourceConnId : p.targetConnId, text, params);
};
const errorsNow = () => als.getStore()?.errors ?? [];
const PARITY_TTL = 10000;
const safe = async (fn, fallback) => {
  try { return await fn(); }
  catch (e) { const st = als.getStore(); if (st && !st.errors.includes(e.message)) st.errors.push(e.message); return fallback; }
};
// anything not handled becomes a readable JSON error instead of an HTML/opaque 500
app.setErrorHandler((err, req, reply) => reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 503).send({ error: err.message }));

app.get('/api/health', async () => ({
  source: await q('source', 'SELECT 1 AS ok').then(() => 'up').catch((e) => 'down: ' + explain(e)),
  target: await q('target', 'SELECT 1 AS ok').then(() => 'up').catch((e) => 'down: ' + explain(e)),
}));

app.get('/api/overview', async () => {
  const nodes = await safe(() => q('source', `
    SELECT n.node_id, n.node_group_id, n.sync_url, n.sync_enabled, n.symmetric_version, n.batch_to_send_count, n.batch_in_error_count, n.sym_data_size,
           h.host_name, h.heartbeat_time, h.free_memory_bytes, h.total_memory_bytes, h.max_memory_bytes, h.last_restart_time,
           s.registration_time, s.initial_load_time, DATEDIFF(SECOND, h.heartbeat_time, GETDATE()) AS heartbeat_age_sec
    FROM sym_node n
    LEFT JOIN sym_node_security s ON s.node_id = n.node_id
    OUTER APPLY (SELECT TOP 1 * FROM sym_node_host WHERE node_id = n.node_id ORDER BY heartbeat_time DESC) h
    ORDER BY n.node_id`), []);
  // One-way topology: the target's own heartbeat/host row is only written to the target DB, so merge it in.
  if (Array.isArray(nodes)) {
    const th = await safe(() => q('target', `SELECT node_id, host_name, heartbeat_time, free_memory_bytes, total_memory_bytes, max_memory_bytes, last_restart_time,
        DATEDIFF(SECOND, heartbeat_time, GETDATE()) AS heartbeat_age_sec FROM sym_node_host h WHERE heartbeat_time = (SELECT MAX(heartbeat_time) FROM sym_node_host WHERE node_id = h.node_id)`), []);
    for (const n of nodes) {
      const r = Array.isArray(th) && th.find((x) => x.node_id === n.node_id);
      if (r && (n.heartbeat_time == null || new Date(r.heartbeat_time) > new Date(n.heartbeat_time))) Object.assign(n, r);
      for (const k of ['batch_to_send_count', 'batch_in_error_count', 'sym_data_size']) if (Number(n[k]) < 0) n[k] = null; // -1 = not computed yet
    }
  }
  const outByStatus = await safe(() => q('source', `SELECT status, COUNT(*) n FROM sym_outgoing_batch WHERE node_id <> '-1' GROUP BY status`), []);
  const inByStatus = await safe(() => q('target', `SELECT status, COUNT(*) n FROM sym_incoming_batch GROUP BY status`), []);
  const lat = await safe(() => q('source', `
    SELECT COUNT(*) batches, ISNULL(SUM(data_row_count),0) rows_, ISNULL(AVG(DATEDIFF(MILLISECOND, create_time, last_update_time)),0) avg_ms,
           ISNULL(MAX(DATEDIFF(MILLISECOND, create_time, last_update_time)),0) max_ms
    FROM sym_outgoing_batch WHERE status='OK' AND channel_id NOT IN ('heartbeat','monitor','config','system','reload') AND create_time > DATEADD(HOUR,-1,GETDATE())`), [{}]);
  const p95 = await safe(() => q('source', `
    SELECT TOP 1 PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY DATEDIFF(MILLISECOND, create_time, last_update_time)) OVER () AS p95_ms
    FROM sym_outgoing_batch WHERE status='OK' AND channel_id NOT IN ('heartbeat','monitor','config','system','reload') AND create_time > DATEADD(HOUR,-1,GETDATE())`), [{}]);
  const backlog = outByStatus.filter?.((r) => !['OK', 'IG'].includes(r.status)).reduce((a, r) => a + r.n, 0) ?? 0;
  return { nodes, outByStatus, inByStatus, backlog, latency: { ...(lat[0] || {}), p95_ms: p95[0]?.p95_ms ?? 0 }, statusOrder: STATUS_ORDER, errors: errorsNow() };
});

// rows/min and latency per minute, last N minutes, per channel
app.get('/api/throughput', async (req) => {
  const minutes = Math.min(Number(req.query.minutes || 60), 1440);
  return safe(() => q('source', `
    SELECT DATEADD(MINUTE, DATEDIFF(MINUTE, 0, create_time), 0) AS minute, channel_id,
           SUM(data_row_count) AS rows_, COUNT(*) AS batches, AVG(DATEDIFF(MILLISECOND, create_time, last_update_time)) AS avg_ms
    FROM sym_outgoing_batch
    WHERE create_time > DATEADD(MINUTE, -@m, GETDATE()) AND channel_id NOT IN ('heartbeat','monitor','config','system')
    GROUP BY DATEADD(MINUTE, DATEDIFF(MINUTE, 0, create_time), 0), channel_id ORDER BY minute`, { m: minutes }), []);
});

app.get('/api/batches', async (req) => {
  const { side = 'out', status, channel, limit = 100, hideInternal = 'true' } = req.query;
  const lim = Math.min(Number(limit), 500);
  const where = ['1=1']; const params = { lim };
  if (status) { where.push('status = @status'); params.status = status; }
  if (channel) { where.push('channel_id = @channel'); params.channel = channel; }
  if (hideInternal === 'true') where.push("channel_id NOT IN ('heartbeat','monitor','config','system')");
  if (side === 'in') {
    return q('target', `SELECT TOP (@lim) batch_id, node_id, channel_id, status, error_flag, byte_count, statement_count, fallback_insert_count, fallback_update_count,
      network_millis, database_millis, failed_row_number, failed_data_id, sql_state, sql_code, LEFT(sql_message, 2000) sql_message, create_time, end_time AS last_update_time
      FROM sym_incoming_batch WHERE ${where.join(' AND ')} ORDER BY create_time DESC`.replace('statement_count', 'statement_count'), params);
  }
  return q('source', `SELECT TOP (@lim) batch_id, node_id, channel_id, status, error_flag, byte_count, data_row_count, data_insert_row_count, data_update_row_count, data_delete_row_count,
    router_millis, extract_millis, network_millis, load_millis, failed_data_id, sql_state, sql_code, LEFT(sql_message, 2000) sql_message, create_time, last_update_time,
    DATEDIFF(MILLISECOND, create_time, last_update_time) AS total_ms
    FROM sym_outgoing_batch WHERE ${where.join(' AND ')} ORDER BY batch_id DESC`, params);
});

app.get('/api/errors', async () => {
  const out = await safe(() => q('source', `SELECT batch_id, node_id, channel_id, status, LEFT(sql_message,2000) sql_message, failed_data_id, create_time, last_update_time
      FROM sym_outgoing_batch WHERE sql_message IS NOT NULL AND status <> 'OK' ORDER BY batch_id DESC`), []);
  const inc = await safe(() => q('target', `SELECT TOP 50 e.batch_id, e.node_id, e.failed_row_number, e.event_type, e.target_catalog_name, e.target_schema_name, e.target_table_name,
      LEFT(e.row_data, 600) row_data, LEFT(e.old_data, 600) old_data, e.resolve_data, e.resolve_ignore, e.create_time, LEFT(b.sql_message,2000) sql_message
      FROM sym_incoming_error e JOIN sym_incoming_batch b ON b.batch_id=e.batch_id AND b.node_id=e.node_id WHERE b.status <> 'OK' ORDER BY e.create_time DESC`), []);
  // the failing source row, if still identifiable
  for (const o of Array.isArray(out) ? out : []) {
    if (o.failed_data_id > 0) {
      const d = await safe(() => q('source', 'SELECT table_name, event_type, row_data, pk_data, old_data, create_time FROM sym_data WHERE data_id=@id', { id: o.failed_data_id }), []);
      o.failed_row = d[0] || null;
    }
  }
  return { outgoing: out, incoming: inc };
});

app.get('/api/channels', async () => {
  const stats = await q('source', `SELECT channel_id,
      SUM(CASE WHEN status='OK' THEN 1 ELSE 0 END) ok, SUM(CASE WHEN status NOT IN ('OK','IG') THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status='ER' OR sql_message IS NOT NULL AND status<>'OK' THEN 1 ELSE 0 END) errors, SUM(data_row_count) rows_
      FROM sym_outgoing_batch GROUP BY channel_id`);
  const ch = await q('source', 'SELECT channel_id, processing_order, max_batch_size, max_batch_to_send, enabled, batch_algorithm, description FROM sym_channel ORDER BY processing_order');
  return ch.map((c) => ({ ...c, ...(stats.find((s) => s.channel_id === c.channel_id) || { ok: 0, pending: 0, errors: 0, rows_: 0 }) }));
});

app.get('/api/config', async () => ({
  groups: await q('source', 'SELECT node_group_id, description FROM sym_node_group'),
  links: await q('source', 'SELECT source_node_group_id, target_node_group_id, data_event_action FROM sym_node_group_link'),
  routers: await q('source', 'SELECT router_id, source_node_group_id, target_node_group_id, router_type, router_expression, sync_on_insert, sync_on_update, sync_on_delete FROM sym_router'),
  triggers: await q('source', `SELECT t.trigger_id, t.source_schema_name, t.source_table_name, t.channel_id, tr.router_id, tr.initial_load_order, tr.enabled
      FROM sym_trigger t LEFT JOIN sym_trigger_router tr ON tr.trigger_id=t.trigger_id ORDER BY tr.initial_load_order, t.trigger_id`),
}));

// Row count + checksum per replicated table, both sides. Cached 10s per sync: checksums scan the tables.
const parityCache = new Map();
app.get('/api/parity', async (req) => {
  const id = pairIdNow(); const c = parityCache.get(id);
  if (!req.query.fresh && c && Date.now() - c.at < PARITY_TTL) return c.data;
  const p = getPair(id);
  if (!p) throw Object.assign(new Error('Unknown sync'), { statusCode: 404 });
  const data = await computeParity(p.sourceConnId, p.targetConnId);
  parityCache.set(id, { at: Date.now(), data });
  return data;
});

const inner = (req, url) => app.inject({ url: `${url}${url.includes('?') ? '&' : '?'}pair=${encodeURIComponent(pairIdNow())}`, headers: { cookie: req.headers.cookie || '' } }).then((r) => r.json());
app.get('/api/alerts', async (req) => {
  const alerts = [];
  const ov = await inner(req, '/api/overview');
  for (const n of ov.nodes || []) {
    if (n.heartbeat_age_sec != null && n.heartbeat_age_sec > STALE_HEARTBEAT_MIN * 60)
      alerts.push({ severity: 'warning', kind: 'stale_heartbeat', message: `Node ${n.node_id} heartbeat is ${Math.round(n.heartbeat_age_sec / 60)} min old` });
    if (!n.sync_enabled) alerts.push({ severity: 'warning', kind: 'node_disabled', message: `Node ${n.node_id} sync disabled` });
  }
  for (const m of ov.errors || []) alerts.push({ severity: 'critical', kind: 'monitor_query', message: 'Database read failed: ' + m });
  const errs = await inner(req, '/api/errors');
  for (const e of Array.isArray(errs.outgoing) ? errs.outgoing : []) alerts.push({ severity: 'critical', kind: 'batch_error', message: `Batch ${e.batch_id} (${e.channel_id}) → node ${e.node_id}: ${(e.sql_message || '').slice(0, 200)}` });
  if (ov.backlog > BACKLOG_WARN) alerts.push({ severity: 'warning', kind: 'backlog', message: `Backlog of ${ov.backlog} batches not yet loaded` });
  const par = await inner(req, '/api/parity');
  for (const t of Array.isArray(par?.tables) ? par.tables : []) if (!t.match && ov.backlog === 0) alerts.push({ severity: 'warning', kind: 'parity', message: `${t.table}: source ${t.source_rows} vs target ${t.target_rows} rows with no backlog` });
  return alerts;
});

// Live change feed over SSE: new sym_data rows since connect.
app.get('/api/feed', (req, reply) => {
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  let last = null; let closed = false;
  const tick = async () => {
    if (closed) return;
    try {
      if (last === null) last = (await q('source', 'SELECT ISNULL(MAX(data_id),0) m FROM sym_data'))[0].m;
      const rows = await q('source', `SELECT TOP 100 data_id, table_name, event_type, pk_data, LEFT(row_data, 400) row_data, create_time
        FROM sym_data WHERE data_id > @last AND table_name NOT LIKE 'sym[_]%' ORDER BY data_id`, { last });
      const maxAll = (await q('source', 'SELECT ISNULL(MAX(data_id),0) m FROM sym_data'))[0].m;
      for (const r of rows) reply.raw.write(`data: ${JSON.stringify(r)}\n\n`);
      last = rows.length ? rows[rows.length - 1].data_id : Math.max(last, maxAll);
      reply.raw.write(': ping\n\n');
    } catch (e) { reply.raw.write(`event: problem\ndata: ${JSON.stringify(e.message)}\n\n`); }
    setTimeout(tick, 2000);
  };
  tick();
  req.raw.on('close', () => { closed = true; });
});

// ================= sign-in =================
app.get('/api/session', async (req) => { const u = sessionOf(req); return { authenticated: !!u, user: u?.user || null, configured: authConfigured() }; });
app.post('/api/login', (req, reply) => login(req, reply));
app.post('/api/logout', (req, reply) => logout(req, reply));

// ================= connections =================
const connLabel = (id) => getConnection(id)?.name || id;
const pairView = (p) => ({
  id: p.id, name: p.name, system: !!p.system, state: p.state, error: p.error || null, steps: p.steps || [], tables: p.tables || [],
  sourceConnId: p.sourceConnId, targetConnId: p.targetConnId, sourceName: connLabel(p.sourceConnId), targetName: connLabel(p.targetConnId),
  options: p.options || {}, createdAt: p.createdAt, lastAppliedAt: p.lastAppliedAt || null, engines: p.system ? null : engineFilesPresent(p),
});
app.get('/api/meta', async () => ({ write_actions: true, auth: authConfigured() }));
app.get('/api/connections', async () => listConnections());
app.post('/api/connections', async (req) => {
  const c = upsertConnection(req.body || {}, req.user); dropPool(c.id); return c;
});
app.delete('/api/connections/:id', async (req) => { deleteConnection(req.params.id, req.user); dropPool(req.params.id); return { ok: true }; });
// test either a saved connection (id, blank password = reuse the stored one) or form values that are not saved yet
app.post('/api/connections/test', async (req) => {
  const b = req.body || {};
  const saved = b.id && getConnection(b.id) ? cfgFor(b.id) : {};
  const cfg = { host: b.host ?? saved.host, port: Number(b.port ?? saved.port ?? 1433), database: b.database ?? saved.database, user: b.user ?? saved.user,
                password: b.password || saved.password || '', encrypt: b.encrypt ?? saved.encrypt ?? true, trustCert: b.trustCert ?? saved.trustCert ?? true };
  if (!cfg.host || !cfg.database || !cfg.user) return { ok: false, error: 'Host, database and user are required' };
  if (!/^[A-Za-z0-9._-]+$/.test(cfg.host)) return { ok: false, error: 'Host may only contain letters, digits, dot, dash, underscore' };
  return testConnection(cfg);
});
app.get('/api/connections/:id/tables', async (req) => { if (!getConnection(req.params.id)) throw Object.assign(new Error('Unknown connection'), { statusCode: 404 }); return listTables(req.params.id); });

// ================= sync pairs =================
app.get('/api/pairs', async () => listPairs().filter((p) => p.state !== 'removed').map(pairView));
app.get('/api/pairs/:id', async (req) => { const p = getPair(req.params.id); if (!p) throw Object.assign(new Error('Unknown sync'), { statusCode: 404 }); return pairView(p); });
app.post('/api/pairs/precheck', async (req) => precheck(req.body || {}));
app.post('/api/pairs/schema-check', async (req) => {
  const { sourceConnId, targetConnId, tables = [] } = req.body || {};
  if (!getConnection(sourceConnId) || !getConnection(targetConnId)) throw Object.assign(new Error('Choose source and target'), { statusCode: 400 });
  const ordered = await loadOrder(sourceConnId, tables);
  const schema = await compareSchema(sourceConnId, targetConnId, ordered);
  const missing = schema.filter((s) => s.status === 'missing').map((s) => s.table);
  const deps = await analyzeDependencies(sourceConnId, ordered, { objectTables: missing });
  await markExisting(targetConnId, deps.objects.statements);
  return { order: ordered, schema, targetTriggers: await userTriggers(targetConnId, ordered), deps };
});
// dependency facts for the selection (step 2 of the wizard): FK parents not selected, self references, cycles, blockers
app.post('/api/pairs/deps', async (req) => {
  const { sourceConnId, tables = [] } = req.body || {};
  if (!getConnection(sourceConnId)) throw Object.assign(new Error('Choose a source'), { statusCode: 400 });
  if (!tables.length) return { missingParents: [], selfRefs: [], cycles: [], objects: { statements: [] }, blockers: [], warnings: [] };
  const d = await analyzeDependencies(sourceConnId, tables);
  const info = new Map((await listTables(sourceConnId)).map((t) => [t.name, t]));
  d.missingParents = d.missingParents.map((m) => ({ ...m, blocked: info.get(m.table)?.blocked || [] }));
  return d;
});
app.post('/api/pairs', async (req) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) throw Object.assign(new Error('Give the sync a name'), { statusCode: 400 });
  if (listPairs().some((p) => p.name.toLowerCase() === name.toLowerCase() && p.state !== 'removed')) throw Object.assign(new Error(`A sync named "${name}" already exists`), { statusCode: 400 });
  const chk = await precheck(b);
  if (!chk.ok) throw Object.assign(new Error(chk.problems.join(' | ')), { statusCode: 400 });
  const avail = new Map((await listTables(b.sourceConnId)).map((t) => [t.name, t]));
  const tables = [...new Set(b.tables || [])];
  if (!tables.length) throw Object.assign(new Error('Select at least one table'), { statusCode: 400 });
  for (const t of tables) {
    const info = avail.get(t);
    if (!info) throw Object.assign(new Error(`Table ${t} not found in the source database`), { statusCode: 400 });
    if (info.blocked.length) throw Object.assign(new Error(`Table ${t} cannot be synced: ${info.blocked.join('; ')}`), { statusCode: 400 });
  }
  const pair = savePair({ id: newPairId(name), name, sourceConnId: b.sourceConnId, targetConnId: b.targetConnId, tables, state: 'draft', steps: [],
    options: { createMissing: !!b.options?.createMissing, disableTargetTriggers: b.options?.disableTargetTriggers !== false, enableRcsi: !!b.options?.enableRcsi }, createdAt: new Date().toISOString() });
  audit(req.user, 'sync.create', { id: pair.id, name, tables: tables.length });
  startApply(pair, req.user);
  return pairView(pair);
});
const own = (req) => { const p = getPair(req.params.id); if (!p) throw Object.assign(new Error('Unknown sync'), { statusCode: 404 }); if (p.system) throw Object.assign(new Error('The built-in demo sync is managed by docker compose and cannot be changed here'), { statusCode: 400 }); return p; };
app.post('/api/pairs/:id/apply', async (req) => { const p = own(req); audit(req.user, 'sync.apply', { id: p.id }); startApply(p, req.user); return pairView(p); });
app.post('/api/pairs/:id/pause', async (req) => { const p = own(req); pause(p); audit(req.user, 'sync.pause', { id: p.id }); return pairView(p); });
app.post('/api/pairs/:id/resume', async (req) => { const p = own(req); resume(p); audit(req.user, 'sync.resume', { id: p.id }); return pairView(p); });
app.post('/api/pairs/:id/reload', async (req) => { const p = own(req); await reload(p); audit(req.user, 'sync.reload', { id: p.id }); return { ok: true }; });
app.delete('/api/pairs/:id', async (req) => {
  const p = own(req); const uninstall = req.query.uninstall === '1';
  const log = await remove(p, { uninstall }); p.state = 'removed'; savePair(p); parityCache.delete(p.id);
  audit(req.user, 'sync.remove', { id: p.id, uninstall }); return { ok: true, log };
});

// ================= startup =================
seedDemo();
if (!getPair('demo')) savePair({ id: 'demo', name: 'Demo (AdventureWorksLT, docker compose)', system: true, sourceConnId: 'demo-source', targetConnId: 'demo-target', tables: [], state: 'running', steps: [], options: {}, createdAt: new Date().toISOString() });
recoverInterrupted();
if (!authConfigured()) console.warn('WARNING: MONITOR_ADMIN_PASSWORD is not set - sign-in is disabled and the UI cannot be used. Set it in .env');


const webDir = path.join(here, 'public');
if (fs.existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
}
await app.listen({ port: Number(process.env.PORT || 8080), host: '0.0.0.0' });
console.log('monitor api listening on', process.env.PORT || 8080);
