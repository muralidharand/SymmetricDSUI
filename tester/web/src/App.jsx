import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { get, send, qs, arr } from './api.js';
import Login from './Login.jsx';
import DynamicForm from './DynamicForm.jsx';
import RecordList from './RecordList.jsx';

const parseHash = () => { const p = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/'); return { sync: p[0] || '', side: p[1] === 'target' ? 'target' : 'source', schema: p[2] || '', table: p[3] || '', tab: ['list', 'create', 'ops'].includes(p[4]) ? p[4] : 'list' }; };

function Shell({ session, onSignedOut }) {
  const h = useMemo(parseHash, []);
  const [syncs, setSyncs] = useState([]); const [sync, setSync] = useState(h.sync); const [side, setSide] = useState(h.side);
  const [tables, setTables] = useState([]); const [schema, setSchema] = useState(h.schema); const [table, setTable] = useState(h.table);
  const [meta, setMeta] = useState(null); const [metaErr, setMetaErr] = useState(null);
  const [tab, setTab] = useState(h.tab); const [editRow, setEditRow] = useState(null); const [copyRow, setCopyRow] = useState(null);
  const [allowTarget, setAllowTarget] = useState(false);
  const [ops, setOps] = useState([]); const [toast, setToast] = useState(null); const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => { const load = () => get('/api/syncs').then((s) => { setSyncs(s); setSync((cur) => (s.some((x) => x.id === cur) ? cur : s[0]?.id || '')); }).catch(() => {}); load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  useEffect(() => { setAllowTarget(false); }, [sync]);
  useEffect(() => {
    if (!sync) return;
    get(`/api/syncs/${sync}/tables?side=${side}`).then((t) => {
      setTables(t);
      setSchema((cur) => (t.some((x) => x.schema === cur) ? cur : (t.find((x) => x.replicated) || t[0])?.schema || ''));
    }).catch(() => setTables([]));
  }, [sync, side]);
  useEffect(() => { setTable((cur) => { const inSchema = tables.filter((x) => x.schema === schema); return inSchema.some((x) => x.table === cur) ? cur : (inSchema.find((x) => x.replicated) || inSchema[0])?.table || ''; }); }, [tables, schema]);
  useEffect(() => {
    setMeta(null); setMetaErr(null); setEditRow(null); setCopyRow(null);
    if (sync && schema && table) get(`/api/syncs/${sync}/meta?${qs({ side, schema, table })}`).then(setMeta).catch((e) => setMetaErr(e.message));
  }, [sync, side, schema, table]);
  useEffect(() => { history.replaceState(null, '', `#/${[sync, side, schema, table, tab].map(encodeURIComponent).join('/')}`); }, [sync, side, schema, table, tab]);

  const fresh = meta && meta.schema === schema && meta.table === table && meta.side === side;   // metadata belongs to the current selection
  const cur = syncs.find((s) => s.id === sync);
  const canWrite = side === 'source' || allowTarget;
  const ctx = { sync, side, schema, table, allowTarget };

  // after every write: show what happened and (source side) wait until the target has it
  const onWrite = useCallback(async ({ op, key, writtenAt }) => {
    const id = `${Date.now()}-${Math.random()}`; const label = `${op} ${schema}.${table}${key ? ` ${JSON.stringify(key)}` : ''}`;
    const upd = (patch) => { setOps((o) => o.map((x) => (x.id === id ? { ...x, ...patch } : x))); setToast((t) => (t && t.id === id ? { ...t, ...patch } : t)); };
    const entry = { id, at: new Date(), op, label, side, status: 'waiting' };
    setOps((o) => [entry, ...o].slice(0, 100)); setToast(entry); setRefreshToken((n) => n + 1); setTab((t) => (t === 'create' || t === 'edit' ? 'list' : t)); setEditRow(null); setCopyRow(null);
    if (side === 'target') { upd({ status: 'target-only' }); return; }
    if (!key) { upd({ status: 'no-key' }); return; }
    try {
      const r = await send('POST', `/api/syncs/${sync}/wait`, { schema, table, key, timeoutMs: 30000 });
      upd({ status: r.status, seconds: r.seconds, columns: r.columns, timedOut: r.timedOut }); setRefreshToken((n) => n + 1);
    } catch (e) { upd({ status: 'error', error: e.message }); }
  }, [sync, side, schema, table]);

  const schemas = [...new Set(tables.map((t) => t.schema))];
  const inSchema = tables.filter((t) => t.schema === schema);
  const label = (o) => (o.status === 'waiting' ? '⏳ waiting for the target…' : o.status === 'replicated' ? `✓ replicated to the target in ${o.seconds?.toFixed(1)} s` : o.status === 'not-replicated' ? 'ℹ saved; this table is not part of the sync' : o.status === 'target-only' ? 'ℹ written on the target (not replicated back)' : o.status === 'no-key' ? 'ℹ saved (no primary key, cannot be tracked)' : o.status === 'different' ? `⚠ on the target but different (${arr(o.columns).join(', ')})` : o.status === 'error' ? `✗ ${o.error}` : `⏳ not on the target after ${o.seconds?.toFixed(0)} s: check the monitor's Errors page`);
  const tone = (o) => (o.status === 'replicated' ? 'ok' : o.status === 'waiting' ? 'info' : ['different', 'error'].includes(o.status) ? 'critical' : o.status === 'pending' ? 'warning' : 'info');

  return <><header><h1>Sync Tester</h1><span className="sub">create records on the source, watch them arrive on the target</span><span className="sp" />
    <span className="sub">{session.user}</span><button className="btn" onClick={async () => { try { await send('POST', '/api/logout'); } catch { /* ignore */ } onSignedOut(); }}>Sign out</button></header>
    <main>
      <div className="bar">
        <label>Sync<select value={sync} onChange={(e) => { setSync(e.target.value); setSchema(''); setTable(''); }}>{syncs.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state !== 'running' ? ` (${s.state})` : ''}</option>)}</select></label>
        <label>Database<span className="seg"><button className={side === 'source' ? 'on' : ''} onClick={() => setSide('source')} title={cur?.sourceName}>Source</button><button className={side === 'target' ? 'on' : ''} onClick={() => setSide('target')} title={cur?.targetName}>Target</button></span></label>
        <label>Schema<select value={schema} onChange={(e) => { setSchema(e.target.value); setTable(''); }}>{schemas.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Table<select value={table} onChange={(e) => setTable(e.target.value)}>{inSchema.map((t) => <option key={t.table} value={t.table}>{t.replicated ? '✓ ' : ''}{t.table} ({t.rows.toLocaleString()}){t.hasPk ? '' : ' – no key'}</option>)}</select></label>
        {cur && <span className="sub" style={{ paddingBottom: 8 }}>{cur.sourceName} → {cur.targetName}</span>}
      </div>
      {side === 'target' && <div className="alert info"><b>You are looking at the target.</b> It receives data from the source, so by default it is read-only here: use it to watch rows arrive (auto-refresh is on).
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, color: 'var(--text)', fontWeight: 400 }}><input type="checkbox" checked={allowTarget} onChange={(e) => setAllowTarget(e.target.checked)} /> I understand: changes made on the target are <b>not</b> sent back to the source and can make the two databases differ.</label></div>}
      {fresh && side === 'source' && !meta.replicated && <div className="alert warning">This table is <b>not part of the sync</b> (no capture trigger on the source): changes stay on the source and will not reach the target.</div>}
      {fresh && meta.replicated && meta.excluded.length > 0 && <div className="alert warning">Columns not copied to the target (type not supported by SymmetricDS): <b>{meta.excluded.join(', ')}</b></div>}
      {metaErr && <div className="alert critical">{metaErr}</div>}
      {!sync && <div className="alert info">No sync found. Create one in the monitor (Sync jobs), or start the demo.</div>}
      <div className="tabs">{[['list', 'List'], ['create', 'Create'], ...(editRow ? [['edit', 'Edit']] : []), ['ops', `Recent operations (${ops.length})`]].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {fresh && tab === 'list' && <RecordList meta={meta} ctx={ctx} canWrite={canWrite} refreshToken={refreshToken} onWrite={onWrite} onEdit={(r) => { setEditRow(r); setTab('edit'); }} onDuplicate={(r) => { setCopyRow(r); setTab('create'); }} />}
      {fresh && tab === 'create' && <DynamicForm key={`c|${sync}|${side}|${schema}|${table}|${copyRow ? JSON.stringify(copyRow) : ''}`} meta={meta} ctx={ctx} mode="create" initial={copyRow ? Object.fromEntries(Object.entries(copyRow).filter(([k]) => !meta.columns.find((c) => c.name === k)?.auto)) : null} canWrite={canWrite} onSaved={onWrite} />}
      {fresh && tab === 'edit' && editRow && <DynamicForm key={`e|${JSON.stringify(editRow)}`} meta={meta} ctx={ctx} mode="edit" initial={editRow} canWrite={canWrite} onSaved={onWrite} onCancel={() => { setEditRow(null); setTab('list'); }} />}
      {tab === 'ops' && <div className="card"><h3 style={{ marginTop: 0 }}>Recent operations</h3>{!ops.length ? <p className="sub">Nothing yet. Create or edit a record: each write is listed here with the time it needed to reach the target.</p> :
        <ul className="ops">{ops.map((o) => <li key={o.id}><span className="sub">{o.at.toLocaleTimeString()}</span> · <span className="pill mute">{o.side}</span> {o.label}<br /><span className={o.status === 'replicated' ? '' : 'sub'}>{label(o)}</span></li>)}</ul>}</div>}
    </main>
    {toast && <div className={`alert ${tone(toast)} toast`}><b>{toast.op === 'insert' ? 'Record created' : toast.op === 'update' ? 'Record updated' : 'Record deleted'}</b> on the {toast.side}<br />{label(toast)}
      <div style={{ marginTop: 6 }}><button className="btn" onClick={() => setToast(null)}>Dismiss</button></div></div>}
  </>;
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const refresh = () => get('/api/session').then(setSession).catch(() => setSession({ authenticated: false, configured: true }));
  useEffect(() => { refresh(); const f = () => setSession((s) => (s?.authenticated ? { ...s, authenticated: false } : s)); window.addEventListener('unauthenticated', f); return () => window.removeEventListener('unauthenticated', f); }, []);
  if (session === undefined) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!session.authenticated) return <Login configured={session.configured} onDone={refresh} />;
  return <Shell session={session} onSignedOut={refresh} />;
}
