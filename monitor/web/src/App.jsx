import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, LineChart, Line } from 'recharts';

import { PairCtx, usePair, useApi, get, send, arr } from './api.js';
import Login from './Login.jsx';
import Connections from './Connections.jsx';
import SyncJobs from './SyncJobs.jsx';

const fmtMs = (n) => (n == null ? '–' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const fmtT = (s) => (s ? new Date(s).toLocaleTimeString() : '–');
const fmtB = (n) => (n == null ? '–' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const STATUS_TONE = { OK: 'ok', IG: 'mute', ER: 'bad', LD: 'warn', NE: 'warn', RT: 'warn', QY: 'warn', SE: 'warn', RQ: 'warn' };
const STATUS_NAME = { NE: 'New', RT: 'Routed', QY: 'Queried', SE: 'Sent', LD: 'Loading', ER: 'Error', IG: 'Ignored', OK: 'Done', RQ: 'Resend requested' };
const Status = ({ s, err }) => <span className={`pill ${err && s !== 'OK' ? 'bad' : STATUS_TONE[s] || 'mute'}`} title={STATUS_NAME[s]}>{s}</span>;
const Err = ({ e }) => e ? <div className="alert critical">Failed to load: {String(e.message || e)}</div> : null;

function Overview() {
  const ov = useApi('/api/overview', 4000); const al = useApi('/api/alerts', 8000); const th = useApi('/api/throughput?minutes=60', 15000);
  if (ov.err) return <Err e={ov.err} />; if (!ov.data) return <p>Loading…</p>;
  const d = ov.data; const sum = (a, f) => arr(a).filter(f).reduce((t, r) => t + r.n, 0);
  const lat = d.latency || {};
  const chart = {}; arr(th.data).forEach((r) => { const k = new Date(r.minute).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); chart[k] = chart[k] || { t: k }; chart[k][r.channel_id] = (chart[k][r.channel_id] || 0) + (r.rows_ || 0); chart[k].ms = r.avg_ms; });
  const rows = Object.values(chart); const keys = [...new Set(arr(th.data).map((r) => r.channel_id))];
  return <>
    {arr(al.data).map((a, i) => <div key={i} className={`alert ${a.severity}`}><b>{a.kind.replace('_', ' ')}</b> — {a.message}</div>)}
    {Array.isArray(al.data) && al.data.length === 0 && <div className="alert" style={{ borderColor: 'var(--ok)', background: 'var(--okbg)' }}>No active alerts.</div>}
    <div className="grid">
      <div className="card"><h3>Backlog (not loaded)</h3><div className="big" style={{ color: d.backlog ? 'var(--warn)' : 'var(--ok)' }}>{d.backlog}</div><div className="sub">outgoing batches not OK/ignored</div></div>
      <div className="card"><h3>Errors</h3><div className="big" style={{ color: sum(d.outByStatus, (r) => r.status === 'ER') + sum(d.inByStatus, (r) => r.status === 'ER') ? 'var(--bad)' : 'var(--ok)' }}>{sum(d.outByStatus, (r) => r.status === 'ER') + sum(d.inByStatus, (r) => r.status === 'ER')}</div><div className="sub">batches in ER state, both sides</div></div>
      <div className="card"><h3>Latency, last hour (live changes)</h3><div className="big">{fmtMs(lat.avg_ms)}</div><div className="sub">avg · p95 {fmtMs(lat.p95_ms)} · max {fmtMs(lat.max_ms)} · {lat.batches || 0} batches</div></div>
      <div className="card"><h3>Rows replicated, last hour</h3><div className="big">{lat.rows_ ?? 0}</div><div className="sub">data channels only (excl. heartbeat/system)</div></div>
    </div>
    <div className="card" style={{ marginBottom: 16 }}><h3>Nodes</h3><div className="scroll"><table><thead><tr><th>Node</th><th>Group</th><th>Host / Sync URL</th><th>Heartbeat</th><th>Registered</th><th>Initial load</th><th className="num">To send</th><th className="num">In error</th><th>Memory</th><th>Version</th></tr></thead><tbody>
      {arr(d.nodes).map((n) => { const stale = n.heartbeat_age_sec > 300; return <tr key={n.node_id}><td><b>{n.node_id}</b></td><td>{n.node_group_id}</td><td className="sub">{n.host_name}<br />{n.sync_url}</td>
        <td><span className={`dot ${n.heartbeat_age_sec == null ? 'warn' : stale ? 'bad' : 'ok'}`} />{n.heartbeat_age_sec == null ? 'none' : `${n.heartbeat_age_sec}s ago`}</td>
        <td>{fmtT(n.registration_time)}</td><td>{n.initial_load_time ? fmtT(n.initial_load_time) : 'no'}</td><td className="num">{n.batch_to_send_count ?? 0}</td><td className="num" style={{ color: n.batch_in_error_count ? 'var(--bad)' : '' }}>{n.batch_in_error_count ?? 0}</td><td className="sub">{n.total_memory_bytes ? `${Math.round((n.total_memory_bytes - n.free_memory_bytes) / 1048576)} / ${Math.round(n.max_memory_bytes / 1048576)} MB` : '–'}</td><td>{n.symmetric_version}</td></tr>; })}
    </tbody></table></div></div>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
      <div className="card"><h3>Outgoing batches by status (source)</h3>{arr(d.outByStatus).map((r) => <span key={r.status} style={{ marginRight: 10 }}><Status s={r.status} /> {r.n}</span>)}</div>
      <div className="card"><h3>Incoming batches by status (target)</h3>{arr(d.inByStatus).map((r) => <span key={r.status} style={{ marginRight: 10 }}><Status s={r.status} /> {r.n}</span>)}</div>
    </div>
    <div className="card" style={{ marginBottom: 16 }}><h3>Rows per minute by channel (last 60 min)</h3>
      {rows.length ? <ResponsiveContainer width="100%" height={220}><BarChart data={rows}><CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="t" stroke="var(--muted)" /><YAxis stroke="var(--muted)" allowDecimals={false} /><Tooltip /><Legend />{keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={['#2b6cb0', '#d98324', '#2f9e6f', '#8e5bb5'][i % 4]} />)}</BarChart></ResponsiveContainer> : <p className="sub">No data traffic in the last hour. Run test.bat (or scripts/smoke-test.sh).</p>}
    </div>
    <div className="card"><h3>Avg end-to-end latency per minute</h3>
      {rows.length ? <ResponsiveContainer width="100%" height={160}><LineChart data={rows}><CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="t" stroke="var(--muted)" /><YAxis stroke="var(--muted)" unit=" ms" /><Tooltip /><Line dataKey="ms" stroke="#2b6cb0" dot={false} /></LineChart></ResponsiveContainer> : <p className="sub">–</p>}
    </div>
  </>;
}

function Batches() {
  const [side, setSide] = useState('out'); const [status, setStatus] = useState(''); const [channel, setChannel] = useState(''); const [internal, setInternal] = useState(false);
  const { data, err } = useApi(`/api/batches?side=${side}&status=${status}&channel=${channel}&hideInternal=${!internal}&limit=150`, 4000);
  const [open, setOpen] = useState(null);
  return <>
    <div className="row">
      <select value={side} onChange={(e) => setSide(e.target.value)}><option value="out">Outgoing (source)</option><option value="in">Incoming (target)</option></select>
      <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.keys(STATUS_NAME).map((s) => <option key={s} value={s}>{s} – {STATUS_NAME[s]}</option>)}</select>
      <input placeholder="channel" value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 120 }} />
      <label><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> include internal channels</label>
    </div>
    <Err e={err} />
    <div className="card scroll"><table><thead><tr><th>Batch</th><th>Node</th><th>Channel</th><th>Status</th><th className="num">Rows</th><th className="num">Size</th><th className="num">Total</th><th>Created</th><th>Updated</th></tr></thead><tbody>
      {arr(data).map((b) => [<tr key={b.batch_id + b.node_id} onClick={() => setOpen(open === b.batch_id ? null : b.batch_id)} style={{ cursor: 'pointer' }}>
        <td>{b.batch_id}</td><td>{b.node_id}</td><td>{b.channel_id}</td><td><Status s={b.status} err={b.sql_message} /></td>
        <td className="num">{b.data_row_count ?? b.statement_count ?? '–'}</td><td className="num">{fmtB(b.byte_count)}</td><td className="num">{fmtMs(b.total_ms ?? b.database_millis)}</td><td>{fmtT(b.create_time)}</td><td>{fmtT(b.last_update_time)}</td></tr>,
        open === b.batch_id && <tr key={b.batch_id + 'd'}><td colSpan={9}><pre>{JSON.stringify(b, null, 2)}</pre></td></tr>])}
    </tbody></table>{Array.isArray(data) && data.length === 0 && <p className="sub">No batches match.</p>}</div>
  </>;
}

function Errors() {
  const { data, err } = useApi('/api/errors', 4000);
  if (err) return <Err e={err} />; if (!data) return <p>Loading…</p>;
  const none = !arr(data.outgoing).length && !arr(data.incoming).length;
  return <>
    {none && <div className="alert" style={{ borderColor: 'var(--ok)', background: 'var(--okbg)' }}>No failing batches.</div>}
    {arr(data.outgoing).map((e) => <div key={e.batch_id} className="card" style={{ marginBottom: 12, borderColor: 'var(--bad)' }}>
      <b>Batch {e.batch_id}</b> · channel {e.channel_id} → node {e.node_id} · <Status s={e.status} err /> · since {fmtT(e.create_time)}
      <pre className="err">{e.sql_message}</pre>
      {e.failed_row && <><div className="sub">Failing change (sym_data #{e.failed_data_id}): {e.failed_row.event_type} on {e.failed_row.table_name}</div><pre>{`pk: ${e.failed_row.pk_data}\nnew: ${e.failed_row.row_data}\nold: ${e.failed_row.old_data ?? ''}`}</pre></>}
      <div className="sub">Fix the cause on the target; the batch retries automatically. Changes on the same channel queue behind it until then.</div></div>)}
    {arr(data.incoming).map((e, i) => <div key={i} className="card" style={{ marginBottom: 12 }}><b>Incoming error</b> batch {e.batch_id} · {e.event_type} {e.target_schema_name}.{e.target_table_name} row {e.failed_row_number}<pre className="err">{e.sql_message}</pre><pre>{e.row_data}</pre></div>)}
  </>;
}

function Parity() {
  const [fresh, setFresh] = useState(0); const { data, err } = useApi(`/api/parity${fresh ? '?fresh=1' : ''}`, 10000);
  return <><div className="row"><button className="btn" onClick={() => setFresh(Date.now())}>Recheck now</button>
    {data && <span className={`pill ${data.in_sync ? 'ok' : 'warn'}`}>{data.in_sync ? 'All tables in sync' : 'Differences found'}</span>}{data && <span className="sub">checked {fmtT(data.checked_at)} · row count + checksum</span>}</div>
    <Err e={err} /><div className="card scroll"><table><thead><tr><th>Table</th><th className="num">Source rows</th><th className="num">Target rows</th><th className="num">Δ</th><th>Result</th></tr></thead><tbody>
      {arr(data?.tables).map((t) => <tr key={t.table}><td>{t.table}</td><td className="num">{t.source_rows}</td><td className="num">{t.target_rows}</td><td className="num">{t.target_rows - t.source_rows}</td>
        <td><span className={`pill ${t.match ? 'ok' : 'warn'}`}>{t.match ? 'match' : t.count_match ? 'checksum differs' : 'count differs'}</span></td></tr>)}
    </tbody></table></div><p className="sub">A difference is normal for a few seconds while batches are in flight; persistent differences with no backlog raise an alert.</p></>;
}

function Channels() {
  const ch = useApi('/api/channels', 5000); const cfg = useApi('/api/config', 30000);
  return <><Err e={ch.err || cfg.err} />
    <div className="card scroll" style={{ marginBottom: 16 }}><h3>Channels</h3><table><thead><tr><th>Channel</th><th className="num">Order</th><th className="num">Max batch</th><th>Enabled</th><th className="num">Done</th><th className="num">Pending</th><th className="num">Errors</th><th className="num">Rows</th></tr></thead><tbody>
      {arr(ch.data).map((c) => <tr key={c.channel_id}><td>{c.channel_id}</td><td className="num">{c.processing_order}</td><td className="num">{c.max_batch_size}</td><td>{c.enabled ? 'yes' : 'no'}</td><td className="num">{c.ok}</td><td className="num">{c.pending}</td><td className="num" style={{ color: c.errors ? 'var(--bad)' : '' }}>{c.errors}</td><td className="num">{c.rows_ ?? 0}</td></tr>)}</tbody></table></div>
    <div className="card scroll"><h3>Triggers → routers (read-only)</h3><table><thead><tr><th>Table</th><th>Channel</th><th>Router</th><th className="num">Load order</th><th>Enabled</th></tr></thead><tbody>
      {arr(cfg.data?.triggers).map((t) => <tr key={t.trigger_id}><td>{t.source_schema_name}.{t.source_table_name}</td><td>{t.channel_id}</td><td>{t.router_id}</td><td className="num">{t.initial_load_order}</td><td>{t.enabled ? 'yes' : 'no'}</td></tr>)}</tbody></table>
      <p className="sub">Links: {arr(cfg.data?.links).map((l) => `${l.source_node_group_id} → ${l.target_node_group_id} (${l.data_event_action === 'P' ? 'push' : l.data_event_action === 'W' ? 'target pulls' : l.data_event_action})`).join(', ')}</p></div></>;
}

function Feed() {
  const pair = usePair();
  const [items, setItems] = useState([]); const [live, setLive] = useState(true); const [problem, setProblem] = useState(null);
  useEffect(() => {
    if (!live) return; setItems([]); const es = new EventSource(`/api/feed?pair=${encodeURIComponent(pair)}`);
    es.onmessage = (m) => setItems((p) => [JSON.parse(m.data), ...p].slice(0, 300));
    es.addEventListener('problem', (m) => setProblem(m.data)); es.onerror = () => setProblem('connection lost, retrying…'); es.onopen = () => setProblem(null);
    return () => es.close();
  }, [live, pair]);
  const tone = { I: 'ok', U: 'warn', D: 'bad', R: 'mute' };
  return <><div className="row"><button className="btn" onClick={() => setLive(!live)}>{live ? 'Pause' : 'Resume'}</button><button className="btn" onClick={() => setItems([])}>Clear</button>{problem && <span className="err">{problem}</span>}<span className="sub">changes captured on the source after you opened this page (I insert, U update, D delete, R reload)</span></div>
    <div className="card feed">{items.length === 0 && <div className="sub">Waiting for changes… run scripts/smoke-test.sh</div>}
      {items.map((r) => <div key={r.data_id}><span className={`pill ${tone[r.event_type] || 'mute'}`}>{r.event_type}</span> #{r.data_id} <b>{r.table_name}</b> {fmtT(r.create_time)} <span className="sub">pk {r.pk_data} · {r.row_data}</span></div>)}</div></>;
}

class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.k !== this.props.k && this.state.err) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="alert critical"><b>This page hit an error:</b> {String(this.state.err.message || this.state.err)}
      <div style={{ marginTop: 8 }}><button className="btn" onClick={() => this.setState({ err: null })}>Retry</button></div></div>;
  }
}

const MONITOR_TABS = { Overview, Batches, Errors, Parity, 'Channels & routing': Channels, 'Live feed': Feed };
const ALL_TABS = ['Overview', 'Batches', 'Errors', 'Parity', 'Channels & routing', 'Live feed', 'Sync jobs', 'Connections'];

function Shell({ session, onSignedOut }) {
  const [tab, setTab] = useState(() => { try { return ALL_TABS.includes(localStorage.getItem('tab')) ? localStorage.getItem('tab') : 'Overview'; } catch { return 'Overview'; } });
  const [pair, setPair] = useState(() => { try { return localStorage.getItem('pair') || 'demo'; } catch { return 'demo'; } });
  const { data: pairs } = useApi('/api/pairs', 5000, { scoped: false });
  const go = (t) => { setTab(t); try { localStorage.setItem('tab', t); } catch { /* storage unavailable */ } };
  const pick = (id) => { setPair(id); try { localStorage.setItem('pair', id); } catch { /* ignore */ } };
  useEffect(() => { if (pairs && !arr(pairs).some((p) => p.id === pair)) pick('demo'); }, [pairs]); // eslint-disable-line
  return <PairCtx.Provider value={pair}><ShellBody tab={tab} go={go} pair={pair} pick={pick} pairs={arr(pairs)} session={session} onSignedOut={onSignedOut} /></PairCtx.Provider>;
}

function ShellBody({ tab, go, pair, pick, pairs, session, onSignedOut }) {
  const health = useApi('/api/health', 10000);
  const up = (s) => s === 'up';
  const monitorTab = MONITOR_TABS[tab];
  const cur = pairs.find((p) => p.id === pair);
  return <><header><h1>SymmetricDS Monitor</h1>
    <nav>{ALL_TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => go(t)}>{t}</button>)}</nav>
    <span className="sp" />
    <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} title="All monitor pages show this sync">Sync
      <select className="pairsel" value={pair} onChange={(e) => pick(e.target.value)}>{pairs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.state})</option>)}{!pairs.length && <option value="demo">demo</option>}</select></label>
    <span className="sub"><span className={`dot ${up(health.data?.source) ? 'ok' : 'bad'}`} />source</span>
    <span className="sub"><span className={`dot ${up(health.data?.target) ? 'ok' : 'bad'}`} />target</span>
    <button className="btn" onClick={async () => { try { await send('POST', '/api/logout'); } catch { /* ignore */ } onSignedOut(); }} title={`Signed in as ${session.user}`}>Sign out</button></header>
    <main>
      {monitorTab && cur && cur.state === 'error' && <div className="alert critical"><b>{cur.name} is in error:</b> {cur.error} <button className="btn" onClick={() => go('Sync jobs')}>Open Sync jobs</button></div>}
      {monitorTab && cur && cur.state === 'applying' && <div className="alert warning"><b>{cur.name} is being set up.</b> Data appears here once the initial load finishes. <button className="btn" onClick={() => go('Sync jobs')}>Show progress</button></div>}
      {monitorTab && cur && cur.state === 'paused' && <div className="alert warning"><b>{cur.name} is paused.</b> Changes queue up on the source until you resume it. <button className="btn" onClick={() => go('Sync jobs')}>Open Sync jobs</button></div>}
      {monitorTab && health.data && (!up(health.data.source) || !up(health.data.target)) && <div className="alert critical"><b>Database not reachable.</b> Source: {String(health.data.source)} · Target: {String(health.data.target)}.
        For the built-in demo check <code>docker compose ps -a</code> and <code>docker compose logs mssql</code>; for your own databases check the connection on the Connections tab.</div>}
      {health.err && health.err.status !== 401 && <div className="alert critical"><b>Monitor API not reachable:</b> {String(health.err.message)}</div>}
      <Boundary k={tab + pair}>
        {monitorTab ? React.createElement(monitorTab) : tab === 'Sync jobs' ? <SyncJobs onOpenMonitor={(id) => { pick(id); go('Overview'); }} /> : <Connections />}
      </Boundary>
    </main></>;
}

export default function App() {
  const [session, setSession] = useState(undefined);       // undefined = loading
  const refresh = () => get('/api/session').then(setSession).catch(() => setSession({ authenticated: false, configured: true }));
  useEffect(() => { refresh(); const f = () => setSession((s) => (s?.authenticated ? { ...s, authenticated: false } : s)); window.addEventListener('unauthenticated', f); return () => window.removeEventListener('unauthenticated', f); }, []);
  if (session === undefined) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!session.authenticated) return <Login configured={session.configured} onDone={refresh} />;
  return <Shell session={session} onSignedOut={refresh} />;
}
