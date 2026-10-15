import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { q, dbNames } from './db.js';

const app = Fastify({ logger: { level: 'warn' } });
const here = path.dirname(fileURLToPath(import.meta.url));
const STALE_HEARTBEAT_MIN = Number(process.env.STALE_HEARTBEAT_MIN || 20 /* default heartbeat job period is 15 min */);
const BACKLOG_WARN = Number(process.env.BACKLOG_WARN || 20);

// Status semantics, see SymmetricDS user guide: NE new, RT routed, QY queried, SE sent, LD loading, ER error, IG ignored, OK done, RQ resend requested
const STATUS_ORDER = ['NE', 'RT', 'QY', 'SE', 'LD', 'RQ', 'ER', 'IG', 'OK'];
// Per-request error collector: a failing query degrades to its fallback (arrays stay arrays) and is reported in `errors`.
const als = new AsyncLocalStorage();
app.addHook('onRequest', (req, reply, done) => als.run({ errors: [] }, done));
const errorsNow = () => als.getStore()?.errors ?? [];
const safe = async (fn, fallback) => {
  try { return await fn(); }
  catch (e) { const st = als.getStore(); if (st && !st.errors.includes(e.message)) st.errors.push(e.message); return fallback; }
};
// anything not handled becomes a readable JSON error instead of an HTML/opaque 500
app.setErrorHandler((err, req, reply) => reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 503).send({ error: err.message }));

app.get('/api/health', async () => ({
  source: await q('source', 'SELECT 1 AS ok').then(() => 'up').catch((e) => 'down: ' + e.message),
  target: await q('target', 'SELECT 1 AS ok').then(() => 'up').catch((e) => 'down: ' + e.message),
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

// Row count + checksum per replicated table, both sides. Cached 10s: checksums scan the tables.
let parityCache = { at: 0, data: null };
app.get('/api/parity', async (req) => {
  if (!req.query.fresh && Date.now() - parityCache.at < 10000 && parityCache.data) return parityCache.data;
  const tables = await q('source', `SELECT DISTINCT source_schema_name s, source_table_name n FROM sym_trigger t JOIN sym_trigger_router r ON r.trigger_id=t.trigger_id WHERE r.enabled=1 ORDER BY 1,2`);
  const rows = [];
  for (const { s, n } of tables) {
    if (!/^[\w]+$/.test(s) || !/^[\w]+$/.test(n)) continue; // identifiers come from config; still validate before interpolating
    const t = `[${s}].[${n}]`;
    const stat = `SELECT COUNT_BIG(*) c, CHECKSUM_AGG(BINARY_CHECKSUM(*)) k FROM ${t}`;
    const [a, b] = await Promise.all([safe(() => q('source', stat), [{}]), safe(() => q('target', stat), [{}])]);
    const sc = Number(a[0]?.c ?? -1), tc = Number(b[0]?.c ?? -1);
    rows.push({ table: `${s}.${n}`, source_rows: sc, target_rows: tc, match: sc === tc && (a[0]?.k ?? 0) === (b[0]?.k ?? 0), count_match: sc === tc });
  }
  parityCache = { at: Date.now(), data: { checked_at: new Date().toISOString(), tables: rows, in_sync: rows.every((r) => r.match) } };
  return parityCache.data;
});

app.get('/api/alerts', async () => {
  const alerts = [];
  const ov = await app.inject({ url: '/api/overview' }).then((r) => r.json());
  for (const n of ov.nodes || []) {
    if (n.heartbeat_age_sec != null && n.heartbeat_age_sec > STALE_HEARTBEAT_MIN * 60)
      alerts.push({ severity: 'warning', kind: 'stale_heartbeat', message: `Node ${n.node_id} heartbeat is ${Math.round(n.heartbeat_age_sec / 60)} min old` });
    if (!n.sync_enabled) alerts.push({ severity: 'warning', kind: 'node_disabled', message: `Node ${n.node_id} sync disabled` });
  }
  for (const m of ov.errors || []) alerts.push({ severity: 'critical', kind: 'monitor_query', message: 'Database read failed: ' + m });
  const errs = await app.inject({ url: '/api/errors' }).then((r) => r.json());
  for (const e of Array.isArray(errs.outgoing) ? errs.outgoing : []) alerts.push({ severity: 'critical', kind: 'batch_error', message: `Batch ${e.batch_id} (${e.channel_id}) → node ${e.node_id}: ${(e.sql_message || '').slice(0, 200)}` });
  if (ov.backlog > BACKLOG_WARN) alerts.push({ severity: 'warning', kind: 'backlog', message: `Backlog of ${ov.backlog} batches not yet loaded` });
  const par = await app.inject({ url: '/api/parity' }).then((r) => r.json());
  for (const t of Array.isArray(par.tables) ? par.tables : []) if (!t.match && ov.backlog === 0) alerts.push({ severity: 'warning', kind: 'parity', message: `${t.table}: source ${t.source_rows} vs target ${t.target_rows} rows with no backlog` });
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

app.get('/api/meta', async () => ({ source_db: dbNames.source, target_db: dbNames.target, write_actions: false }));

const webDir = path.join(here, 'public');
if (fs.existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
}
await app.listen({ port: Number(process.env.PORT || 8080), host: '0.0.0.0' });
console.log('monitor api listening on', process.env.PORT || 8080);
