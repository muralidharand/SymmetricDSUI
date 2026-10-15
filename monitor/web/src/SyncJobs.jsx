import React, { useEffect, useState } from 'react';
import { send, get, useApi, arr } from './api.js';

const TONE = { running: 'ok', applying: 'warn', error: 'bad', paused: 'mute', draft: 'mute' };
const STEP_ICON = { ok: '✓', running: '…', error: '✗', skipped: '–', pending: '·' };
const fmtT = (s) => (s ? new Date(s).toLocaleString() : '–');

// ---------------- progress of an apply ----------------
function Progress({ id, onClose, onOpenMonitor }) {
  const { data: p, err, reload } = useApi(`/api/pairs/${id}`, 1500, { scoped: false });
  const [msg, setMsg] = useState(null);
  if (err) return <div className="alert critical">{err.message}</div>;
  if (!p) return <p>Loading…</p>;
  const steps = arr(p.steps);
  return <div className="card">
    <h3>{p.name} <span className={`pill ${TONE[p.state] || 'mute'}`}>{p.state}</span></h3>
    <p className="sub">{p.sourceName} → {p.targetName} · {arr(p.tables).length} table(s)</p>
    <ol className="steps">
      {steps.map((s, i) => <li key={i} className={`st-${s.status}`}><span className="ic">{STEP_ICON[s.status]}</span><div><b>{s.name}</b>{s.detail && <div className={s.status === 'error' ? 'err sub' : 'sub'}>{s.detail}</div>}</div></li>)}
      {p.state === 'applying' && <li className="st-pending"><span className="ic">·</span><div className="sub">working… this can take a few minutes the first time (SymmetricDS restarts twice)</div></li>}
    </ol>
    {p.state === 'error' && <div className="alert critical"><b>Stopped:</b> {p.error}<div className="sub">Fix the cause (see the message), then press Retry. Completed steps are safe to repeat.</div></div>}
    {msg && <div className="alert critical">{msg}</div>}
    <div className="row">
      {p.state === 'error' && !p.system && <button className="btn primary" onClick={async () => { try { await send('POST', `/api/pairs/${id}/apply`); reload(); } catch (e) { setMsg(e.message); } }}>Retry apply</button>}
      {p.state === 'running' && <button className="btn primary" onClick={() => onOpenMonitor(id)}>Open in monitor</button>}
      <button className="btn" onClick={onClose}>Back to Sync jobs</button>
    </div>
  </div>;
}

// ---------------- the wizard ----------------
function Wizard({ onClose, onStarted }) {
  const { data: conns } = useApi('/api/connections', 60000, { scoped: false });
  const [step, setStep] = useState(0);
  const [src, setSrc] = useState(''); const [tgt, setTgt] = useState('');
  const [pre, setPre] = useState(null); const [tables, setTables] = useState([]); const [sel, setSel] = useState(new Set());
  const [schema, setSchema] = useState(null);
  const [opts, setOpts] = useState({ createMissing: false, disableTargetTriggers: true, enableRcsi: false });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const cname = (id) => arr(conns).find((c) => c.id === id)?.name || id;
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };

  const goConnections = () => run(async () => {
    const r = await send('POST', '/api/pairs/precheck', { sourceConnId: src, targetConnId: tgt }); setPre(r);
    if (r.ok) { setTables(await get(`/api/connections/${src}/tables`)); setStep(1); }
  });
  const goSchema = () => run(async () => { setSchema(await send('POST', '/api/pairs/schema-check', { sourceConnId: src, targetConnId: tgt, tables: [...sel] })); setStep(2); });
  const toggle = (n) => setSel((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const valid = tables.filter((t) => !t.blocked.length);
  const missing = arr(schema?.schema).filter((s) => s.status === 'missing'); const mismatch = arr(schema?.schema).filter((s) => s.status === 'mismatch');
  const create = () => run(async () => {
    const p = await send('POST', '/api/pairs', { name: name.trim(), sourceConnId: src, targetConnId: tgt, tables: [...sel], options: opts });
    onStarted(p.id);
  });
  useEffect(() => { if (step === 3 && !name) setName(`${cname(src)} to ${cname(tgt)}`.slice(0, 60)); }, [step]); // eslint-disable-line

  const titles = ['1 Connections', '2 Tables', '3 Target schema', '4 Options', '5 Review'];
  return <div className="card">
    <div className="wiz-head">{titles.map((t, i) => <span key={t} className={`wiz-step ${i === step ? 'on' : i < step ? 'done' : ''}`}>{t}</span>)}</div>
    {err && <div className="alert critical">{err}</div>}

    {step === 0 && <>
      <p className="sub">Pick two saved connections. Rows flow <b>one way</b>, from the source to the target. Add connections on the <b>Connections</b> tab first.</p>
      <div className="form">
        <label>Source database<select value={src} onChange={(e) => { setSrc(e.target.value); setPre(null); }}><option value="">– choose –</option>{arr(conns).filter((c) => !c.system).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.database})</option>)}</select></label>
        <label>Target database<select value={tgt} onChange={(e) => { setTgt(e.target.value); setPre(null); }}><option value="">– choose –</option>{arr(conns).filter((c) => !c.system).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.database})</option>)}</select></label>
      </div>
      {arr(conns).filter((c) => !c.system).length < 2 && <div className="alert warning">You need at least two saved connections (go to the <b>Connections</b> tab and add the source and the target).</div>}
      {pre && !pre.ok && <div className="alert critical"><b>Cannot continue:</b>{pre.problems.map((p, i) => <div key={i}>• {p}</div>)}</div>}
      {pre?.warnings?.map((w, i) => <div key={i} className="alert warning">{w}</div>)}
      <div className="row"><button className="btn primary" disabled={busy || !src || !tgt} onClick={goConnections}>{busy ? 'Checking…' : 'Check and continue'}</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </>}

    {step === 1 && <>
      <p className="sub">Choose the tables to replicate from <b>{cname(src)}</b>. Parents are loaded before children automatically (foreign keys).</p>
      <div className="row"><button className="btn" onClick={() => setSel(new Set(valid.map((t) => t.name)))}>Select all</button><button className="btn" onClick={() => setSel(new Set())}>Select none</button><span className="sub">{sel.size} of {valid.length} selectable tables chosen</span></div>
      <div className="scroll"><table><thead><tr><th /><th>Table</th><th className="num">Rows</th><th>Notes</th></tr></thead><tbody>
        {tables.map((t) => <tr key={t.name} className={t.blocked.length ? 'dim' : ''}>
          <td><input type="checkbox" disabled={!!t.blocked.length} checked={sel.has(t.name)} onChange={() => toggle(t.name)} /></td>
          <td>{t.name}</td><td className="num">{t.rows.toLocaleString()}</td>
          <td className="sub">{t.blocked.map((b, i) => <div key={i} className="err">✗ not supported: {b}</div>)}{t.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</td></tr>)}
      </tbody></table></div>
      <div className="row"><button className="btn" onClick={() => setStep(0)}>Back</button><button className="btn primary" disabled={busy || !sel.size} onClick={goSchema}>{busy ? 'Comparing…' : 'Compare with target'}</button></div>
    </>}

    {step === 2 && schema && <>
      <p className="sub">Comparing the chosen tables with <b>{cname(tgt)}</b>. Load order: {arr(schema.order).join(' → ')}</p>
      <table><thead><tr><th>Table</th><th>On the target</th></tr></thead><tbody>
        {schema.schema.map((s) => <tr key={s.table}><td>{s.table}</td><td>
          {s.status === 'ok' && <span className="pill ok">same structure</span>}
          {s.status === 'missing' && <span className="pill warn">does not exist</span>}
          {s.status === 'mismatch' && <><span className="pill bad">different</span><div className="err sub">{[s.missingCols?.length ? `missing columns: ${s.missingCols.join(', ')}` : '', ...arr(s.typeDiff)].filter(Boolean).join('; ')}</div></>}
        </td></tr>)}
      </tbody></table>
      {missing.length > 0 && <div className="alert warning"><b>{missing.length} table(s) do not exist on the target.</b> The wizard can create them (columns, types, identity, computed columns, defaults, primary key; <i>not</i> foreign keys or other indexes).
        <label className="chk"><input type="checkbox" checked={opts.createMissing} onChange={(e) => setOpts({ ...opts, createMissing: e.target.checked })} /> Create missing tables on the target</label>
        {missing.map((m) => <details key={m.table}><summary>SQL for {m.table}</summary><pre>{m.ddl}</pre></details>)}</div>}
      {mismatch.length > 0 && <div className="alert critical">Some target tables differ from the source. Fix them (or drop them and let the wizard create them), then press Re-check.</div>}
      <div className="row"><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn" disabled={busy} onClick={goSchema}>Re-check</button>
        <button className="btn primary" disabled={mismatch.length > 0 || (missing.length > 0 && !opts.createMissing)} onClick={() => { setOpts((o) => ({ ...o, disableTargetTriggers: arr(schema.targetTriggers).length > 0 })); setStep(3); }}>Continue</button></div>
    </>}

    {step === 3 && <>
      <div className="form"><label style={{ gridColumn: '1 / -1' }}>Name of this sync<input value={name} onChange={(e) => setName(e.target.value)} /></label></div>
      {arr(schema?.targetTriggers).length > 0 && <label className="chk"><input type="checkbox" checked={opts.disableTargetTriggers} onChange={(e) => setOpts({ ...opts, disableTargetTriggers: e.target.checked })} />
        <span><b>Disable existing triggers on the target tables</b> ({schema.targetTriggers.map((t) => t.trigger).join(', ')}). Replicated rows are already final; a business trigger would change them again on the target. They are re-enabled if you remove the sync with “uninstall”. <i>Recommended.</i></span></label>}
      <label className="chk"><input type="checkbox" checked={opts.enableRcsi} onChange={(e) => setOpts({ ...opts, enableRcsi: e.target.checked })} />
        <span>Turn on <code>READ_COMMITTED_SNAPSHOT</code> in both databases (reduces blocking from the SymmetricDS triggers). <b>Rolls back open transactions in those databases once</b>; leave unticked on busy production databases.</span></label>
      <div className="row"><button className="btn" onClick={() => setStep(2)}>Back</button><button className="btn primary" disabled={!name.trim()} onClick={() => setStep(4)}>Review</button></div>
    </>}

    {step === 4 && <>
      <h3>Review</h3>
      <table><tbody>
        <tr><td>Source</td><td>{cname(src)}</td></tr><tr><td>Target</td><td>{cname(tgt)}</td></tr>
        <tr><td>Tables</td><td>{[...sel].join(', ')}</td></tr>
        <tr><td>Create missing tables</td><td>{opts.createMissing ? `yes (${missing.length})` : 'no'}</td></tr>
        <tr><td>Disable target triggers</td><td>{opts.disableTargetTriggers ? 'yes' : 'no'}</td></tr>
        <tr><td>READ_COMMITTED_SNAPSHOT</td><td>{opts.enableRcsi ? 'turn on' : 'unchanged'}</td></tr>
      </tbody></table>
      <div className="alert warning"><b>What happens:</b> SymmetricDS creates its own tables (<code>sym_*</code>) and capture triggers in <b>both</b> databases, then copies all rows from the source to the target (the target tables should be empty) and keeps them in sync. Use <b>Remove → uninstall</b> to take it all out again.</div>
      <div className="row"><button className="btn" onClick={() => setStep(3)}>Back</button><button className="btn primary" disabled={busy} onClick={create}>{busy ? 'Starting…' : 'Create and start sync'}</button></div>
    </>}
  </div>;
}

// ---------------- list ----------------
export default function SyncJobs({ onOpenMonitor }) {
  const { data, err, reload } = useApi('/api/pairs', 3000, { scoped: false });
  const [view, setView] = useState({ mode: 'list' }); const [msg, setMsg] = useState(null);
  const [removing, setRemoving] = useState(null); const [uninstall, setUninstall] = useState(true);
  const act = async (fn) => { setMsg(null); try { await fn(); reload(); } catch (e) { setMsg(e.message); } };

  if (view.mode === 'new') return <Wizard onClose={() => setView({ mode: 'list' })} onStarted={(id) => setView({ mode: 'progress', id })} />;
  if (view.mode === 'progress') return <Progress id={view.id} onClose={() => { setView({ mode: 'list' }); reload(); }} onOpenMonitor={onOpenMonitor} />;

  return <>
    <div className="row"><button className="btn primary" onClick={() => setView({ mode: 'new' })}>New sync</button><span className="sub">Replicate tables from one SQL Server database to another. The built-in demo is managed by docker compose.</span></div>
    {err && <div className="alert critical">{err.message}</div>}{msg && <div className="alert critical">{msg}</div>}
    {removing && <div className="alert warning"><b>Remove “{removing.name}”?</b>
      <label className="chk"><input type="checkbox" checked={uninstall} onChange={(e) => setUninstall(e.target.checked)} /> Also remove SymmetricDS tables and triggers from both databases (your own tables and data are never touched)</label>
      <div className="row"><button className="btn primary" onClick={() => act(async () => { const r = await send('DELETE', `/api/pairs/${removing.id}${uninstall ? '?uninstall=1' : ''}`); setMsg(arr(r.log).join(' · ')); setRemoving(null); })}>Remove</button><button className="btn" onClick={() => setRemoving(null)}>Cancel</button></div></div>}
    <div className="card scroll"><table><thead><tr><th>Name</th><th>Source → Target</th><th>Tables</th><th>State</th><th>Last applied</th><th /></tr></thead><tbody>
      {arr(data).map((p) => <tr key={p.id}>
        <td><b>{p.name}</b>{p.system && <span className="pill mute" style={{ marginLeft: 6 }}>built-in</span>}</td>
        <td>{p.sourceName} → {p.targetName}</td><td className="num">{p.system ? '–' : p.tables.length}</td>
        <td><span className={`pill ${TONE[p.state] || 'mute'}`}>{p.state}</span>{p.error && <div className="err sub">{p.error.slice(0, 140)}</div>}</td>
        <td className="sub">{p.system ? '–' : fmtT(p.lastAppliedAt)}</td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button className="btn" onClick={() => onOpenMonitor(p.id)}>Monitor</button>{' '}
          {!p.system && <>
            {(p.state === 'applying' || p.state === 'error') && <><button className="btn" onClick={() => setView({ mode: 'progress', id: p.id })}>Progress</button>{' '}</>}
            {p.state === 'running' && <><button className="btn" onClick={() => act(() => send('POST', `/api/pairs/${p.id}/pause`))}>Pause</button>{' '}<button className="btn" title="Send all rows again" onClick={() => window.confirm('Re-send all rows to the target?') && act(() => send('POST', `/api/pairs/${p.id}/reload`))}>Reload</button>{' '}</>}
            {p.state === 'paused' && <><button className="btn" onClick={() => act(() => send('POST', `/api/pairs/${p.id}/resume`))}>Resume</button>{' '}</>}
            <button className="btn" onClick={() => setRemoving(p)}>Remove</button></>}
        </td></tr>)}
    </tbody></table></div>
  </>;
}
