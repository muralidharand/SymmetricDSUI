import React, { useCallback, useEffect, useRef, useState } from 'react';
import { get, send, qs, arr, keyOf } from './api.js';

const keyStr = (meta, row) => JSON.stringify(meta.pk.map((k) => String(row[k])));
const BADGE = {
  replicated: ['ok', '✓ in sync', 'The row is identical on the target'],
  pending: ['warn', '⏳ not on target yet', 'Waiting for replication (or blocked: check the monitor Errors page)'],
  different: ['bad', '≠ differs', 'The row exists on the target but some columns differ'],
  extra: ['bad', 'only on target', 'The row was deleted on the source but still exists on the target'],
};
function Cell({ v }) {
  if (v === null || v === undefined) return <td className="null">NULL</td>;
  if (typeof v === 'boolean') return <td>{v ? '✓' : '✗'}</td>;
  const s = String(v);
  return <td className={typeof v === 'number' ? 'num' : ''} title={s.length > 40 ? s.slice(0, 600) : undefined}>{s.length > 200 ? `${s.slice(0, 200)}…` : s}</td>;
}

export default function RecordList({ meta, ctx, canWrite, onEdit, onDuplicate, onWrite, refreshToken }) {
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState(''); const [dir, setDir] = useState('asc');
  const [qIn, setQIn] = useState(''); const [q, setQ] = useState('');
  const [auto, setAuto] = useState(ctx.side === 'target'); const [data, setData] = useState({ rows: [], total: 0 });
  const [status, setStatus] = useState({}); const [err, setErr] = useState(null); const [msg, setMsg] = useState(null);
  const [fresh, setFresh] = useState(new Set()); const seen = useRef(null);
  const showStatus = ctx.side === 'source' && meta.replicated && meta.pk.length > 0;
  const tableKey = `${ctx.sync}|${ctx.side}|${ctx.schema}|${ctx.table}`;

  useEffect(() => { setPage(1); setSort(''); setDir('asc'); setQIn(''); setQ(''); seen.current = null; setStatus({}); setAuto(ctx.side === 'target'); }, [tableKey]); // eslint-disable-line
  useEffect(() => { const t = setTimeout(() => { setQ(qIn); setPage(1); }, 350); return () => clearTimeout(t); }, [qIn]);

  const load = useCallback(async () => {
    if (meta.schema !== ctx.schema || meta.table !== ctx.table || meta.side !== ctx.side) return;   // metadata of the previous selection: wait for the new one
    try {
      const d = await get(`/api/syncs/${ctx.sync}/records?${qs({ side: ctx.side, schema: ctx.schema, table: ctx.table, page, pageSize, sort, dir, q })}`);
      setData(d); setErr(null);
      if (meta.pk.length) {                                   // highlight rows that appeared since the last refresh
        const keys = d.rows.map((r) => keyStr(meta, r));
        if (seen.current) { const nu = keys.filter((k) => !seen.current.has(k)); if (nu.length) { setFresh(new Set(nu)); setTimeout(() => setFresh(new Set()), 3000); } }
        seen.current = new Set([...(seen.current || []), ...keys]);
      }
      if (showStatus && d.rows.length) {
        const r = await send('POST', `/api/syncs/${ctx.sync}/status`, { schema: ctx.schema, table: ctx.table, keys: d.rows.map((x) => keyOf(meta, x)) });
        setStatus(Object.fromEntries(arr(r.items).map((i) => [JSON.stringify(meta.pk.map((k) => String(i.pk[k]))), i])));
      } else setStatus({});
    } catch (e) { setErr(e.message); }
  }, [ctx.sync, ctx.side, ctx.schema, ctx.table, page, pageSize, sort, dir, q, meta, showStatus]);
  useEffect(() => { load(); }, [load, refreshToken]);
  useEffect(() => { if (!auto) return undefined; const t = setInterval(load, 2000); return () => clearInterval(t); }, [auto, load]);

  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  const sortBy = (name) => { if (sort === name) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(name); setDir('asc'); } setPage(1); };
  const del = async (row) => {
    if (!window.confirm(`Delete this row from the ${ctx.side}?\n${meta.pk.map((k) => `${k} = ${row[k]}`).join(', ')}`)) return;
    setMsg(null);
    try { const key = keyOf(meta, row); const r = await send('POST', `/api/syncs/${ctx.sync}/records/delete`, { side: ctx.side, schema: ctx.schema, table: ctx.table, key }, { targetWrite: ctx.allowTarget }); onWrite({ op: 'delete', key, writtenAt: r.writtenAt }); load(); }
    catch (e) { setMsg(e.message); }
  };

  return <div className="card">
    <div className="row" style={{ marginTop: 0 }}>
      <input placeholder="Search text columns, key or GUID…" value={qIn} onChange={(e) => setQIn(e.target.value)} style={{ minWidth: 260 }} />
      <button className="btn" onClick={load}>Refresh</button>
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', color: 'var(--text)', fontWeight: 400 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto-refresh (2 s)</label>
      <span className="sub">{data.total.toLocaleString()} row(s){q ? ' matching' : ''}</span><span className="sp" />
      <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
      <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button><span className="sub">page {page} / {pages}</span><button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
    </div>
    {err && <div className="alert critical">{err}</div>}{msg && <div className="alert critical">{msg}</div>}
    {meta.pk.length === 0 && <div className="alert warning">This table has no primary key: rows can be created and listed, but not edited or deleted here, and SymmetricDS cannot replicate it.</div>}
    <div className="scroll" style={{ maxHeight: '60vh' }}><table><thead><tr>
      <th className="nosort" />
      {showStatus && <th className="nosort" title="Compared with the target database for the rows on this page">Target</th>}
      {meta.columns.map((c) => <th key={c.name} onClick={() => sortBy(c.name)} title={c.type}>{c.name}{sort === c.name ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}{c.pk ? ' 🔑' : ''}</th>)}
    </tr></thead><tbody>
      {data.rows.map((row, i) => { const ks = meta.pk.length ? keyStr(meta, row) : i; const st = status[ks]; const b = st && BADGE[st.status];
        return <tr key={ks} className={fresh.has(ks) ? 'fresh' : ''}>
          <td style={{ whiteSpace: 'nowrap' }}>{meta.pk.length > 0 && <>
            <button className="btn" onClick={() => onEdit(row)} disabled={!canWrite} title={canWrite ? 'Edit' : 'Writing is disabled on this side'}>Edit</button>{' '}
            <button className="btn" onClick={() => onDuplicate(row)} disabled={!canWrite} title="Create a new record from this one">Copy</button>{' '}
            <button className="btn danger" onClick={() => del(row)} disabled={!canWrite}>Delete</button></>}</td>
          {showStatus && <td>{b ? <span className={`pill ${b[0]}`} title={st.columns ? `${b[2]}: ${st.columns.join(', ')}` : b[2]}>{b[1]}{st.columns ? ` (${st.columns.length})` : ''}</span> : <span className="sub">…</span>}</td>}
          {meta.columns.map((c) => <Cell key={c.name} v={row[c.name]} />)}</tr>; })}
      {!data.rows.length && <tr><td colSpan={meta.columns.length + 2} className="sub">No rows.</td></tr>}
    </tbody></table></div>
  </div>;
}
