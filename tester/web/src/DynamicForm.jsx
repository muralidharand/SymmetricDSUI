import React, { useEffect, useMemo, useState } from 'react';
import { get, send, qs, arr } from './api.js';

const INTS = ['tinyint', 'smallint', 'int'];
const DEC = ['decimal', 'numeric', 'money', 'smallmoney', 'float', 'real'];
const two = (n) => String(n).padStart(2, '0');
const nowLocal = (sec = true) => { const d = new Date(); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}${sec ? `:${two(d.getSeconds())}` : ''}`; };

export function kindOf(c) {
  const t = c.type;
  if (INTS.includes(t)) return 'int';
  if (t === 'bigint') return 'bigint';
  if (DEC.includes(t)) return 'decimal';
  if (t === 'bit') return 'bit';
  if (t === 'date') return 'date';
  if (['datetime', 'smalldatetime'].includes(t) || (t === 'datetime2' && c.scale <= 3)) return 'datetime';
  if (t === 'datetime2' || t === 'datetimeoffset') return 'datetimeText';
  if (t === 'time') return c.scale <= 3 ? 'time' : 'timeText';
  if (t === 'uniqueidentifier') return 'guid';
  if (['xml', 'text', 'ntext'].includes(t) || (['varchar', 'nvarchar'].includes(t) && (c.maxLength === -1 || c.maxLength > 255))) return 'textarea';
  if (['char', 'varchar', 'nchar', 'nvarchar'].includes(t)) return 'text';
  if (t === 'hierarchyid') return 'hier';
  if (t === 'geography' || t === 'geometry') return 'spatial';
  if (['binary', 'varbinary', 'image'].includes(t)) return 'binary';
  return 'other';
}
const typeLabel = (c) => {
  if (['nvarchar', 'varchar', 'nchar', 'char'].includes(c.type)) return `${c.type}(${c.maxLength === -1 ? 'max' : c.maxLength})`;
  if (['decimal', 'numeric'].includes(c.type)) return `${c.type}(${c.precision},${c.scale})`;
  if (['datetime2', 'datetimeoffset', 'time'].includes(c.type)) return `${c.type}(${c.scale})`;
  return c.alias ? `${c.declared} → ${c.type}` : c.type;
};
const toInput = (c, v) => {            // DB text -> value for the HTML control
  if (v === null || v === undefined) return '';
  const k = kindOf(c);
  if (k === 'bit') return v ? 'true' : 'false';
  if (k === 'datetime') return String(v).slice(0, 23);
  if (k === 'date') return String(v).slice(0, 10);
  if (k === 'time') return String(v).slice(0, 12);
  return String(v);
};

function FkField({ c, ctx, value, onChange, disabled }) {
  const [q, setQ] = useState(''); const [opts, setOpts] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => { get(`/api/syncs/${ctx.sync}/lookup?${qs({ side: ctx.side, schema: ctx.schema, table: ctx.table, column: c.name, q })}`).then(setOpts).catch(() => setOpts([])); }, 250);
    return () => clearTimeout(t);
  }, [q, ctx.sync, ctx.side, ctx.schema, ctx.table, c.name]);
  useEffect(() => {      // make sure the current value has a label even if it is not in the first 50
    if (value && !opts.some((o) => o.value === String(value))) get(`/api/syncs/${ctx.sync}/lookup?${qs({ side: ctx.side, schema: ctx.schema, table: ctx.table, column: c.name, value })}`).then((r) => setOpts((o) => [...r, ...o])).catch(() => {});
  }, [value]); // eslint-disable-line
  return <div style={{ display: 'grid', gap: 4 }}>
    <input placeholder={`search ${c.fk.table}…`} value={q} onChange={(e) => setQ(e.target.value)} disabled={disabled} />
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{c.nullable ? '(none)' : '– choose –'}</option>
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select></div>;
}

function Control({ c, v, set, ctx, disabled }) {
  const k = kindOf(c); const ph = c.hasDefault ? `default: ${c.defaultDef}` : '';
  if (c.fk && !['binary'].includes(k)) return <FkField c={c} ctx={ctx} value={v} onChange={set} disabled={disabled} />;
  switch (k) {
    case 'int': return <input type="number" step="1" value={v ?? ''} onChange={(e) => set(e.target.value)} placeholder={ph} disabled={disabled} />;
    case 'bigint': return <input inputMode="numeric" pattern="-?[0-9]*" value={v ?? ''} onChange={(e) => set(e.target.value)} placeholder={ph} disabled={disabled} />;
    case 'decimal': return <input inputMode="decimal" value={v ?? ''} onChange={(e) => set(e.target.value)} placeholder={ph || '0.00'} disabled={disabled} />;
    case 'bit': return <select value={v ?? ''} onChange={(e) => set(e.target.value)} disabled={disabled}><option value="">{c.nullable ? '(null)' : c.hasDefault ? '(default)' : '– choose –'}</option><option value="true">true (1)</option><option value="false">false (0)</option></select>;
    case 'date': return <input type="date" value={v ?? ''} onChange={(e) => set(e.target.value)} disabled={disabled} />;
    case 'datetime': return <div style={{ display: 'flex', gap: 6 }}><input type="datetime-local" step="1" value={v ?? ''} onChange={(e) => set(e.target.value)} disabled={disabled} style={{ flex: 1 }} /><button type="button" className="btn" onClick={() => set(nowLocal())} disabled={disabled}>Now</button></div>;
    case 'time': return <input type="time" step="1" value={v ?? ''} onChange={(e) => set(e.target.value)} disabled={disabled} />;
    case 'datetimeText': case 'timeText': return <div style={{ display: 'flex', gap: 6 }}><input value={v ?? ''} onChange={(e) => set(e.target.value)} placeholder={ph || (c.type === 'datetimeoffset' ? '2026-10-16T14:30:00+00:00' : k === 'timeText' ? '14:30:00' : '2026-10-16T14:30:00')} disabled={disabled} style={{ flex: 1 }} />{k === 'datetimeText' && <button type="button" className="btn" onClick={() => set(c.type === 'datetimeoffset' ? `${nowLocal()}+00:00` : nowLocal())} disabled={disabled}>Now</button>}</div>;
    case 'guid': return <div style={{ display: 'flex', gap: 6 }}><input value={v ?? ''} onChange={(e) => set(e.target.value)} placeholder={ph || 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'} disabled={disabled} style={{ flex: 1 }} /><button type="button" className="btn" onClick={() => set(crypto.randomUUID())} disabled={disabled}>Generate</button></div>;
    case 'textarea': return <textarea value={v ?? ''} onChange={(e) => set(e.target.value)} placeholder={ph} disabled={disabled} />;
    case 'text': return <input value={v ?? ''} maxLength={c.maxLength > 0 ? c.maxLength : undefined} onChange={(e) => set(e.target.value)} placeholder={ph} disabled={disabled} />;
    case 'hier': return <input value={v ?? ''} onChange={(e) => set(e.target.value)} placeholder="/1/2/" disabled={disabled} />;
    case 'spatial': return <textarea value={v ?? ''} onChange={(e) => set(e.target.value)} placeholder="POINT(-122.35 47.65)" disabled={disabled} />;
    case 'binary': return <div style={{ display: 'grid', gap: 4 }}>
      <input type="file" disabled={disabled} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { alert('Max 5 MB'); return; } const r = new FileReader(); r.onload = () => set({ b64: String(r.result).split(',')[1] || '', name: f.name, size: f.size }); r.readAsDataURL(f); }} />
      {v?.name && <span className="sub">{v.name} ({v.size} bytes) <button type="button" className="btn" onClick={() => set(null)}>clear</button></span>}</div>;
    default: return <input value={v ?? ''} disabled placeholder="not editable here" />;
  }
}

export default function DynamicForm({ meta, ctx, mode, initial, canWrite, onSaved, onCancel }) {
  const editing = mode === 'edit';
  const init = useMemo(() => Object.fromEntries(meta.columns.map((c) => [c.name, initial ? (kindOf(c) === 'binary' ? undefined : toInput(c, initial[c.name])) : undefined])), [meta, initial]);
  const [vals, setVals] = useState(init); const [touched, setTouched] = useState(new Set());
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setVals(init); setTouched(new Set()); setErr(null); }, [init]);
  const set = (name, v) => { setVals((s) => ({ ...s, [name]: v })); setTouched((t) => new Set(t).add(name)); };
  const fields = meta.columns.filter((c) => (editing ? true : !c.auto));
  const spatialExcluded = (c) => meta.replicated && meta.excluded.includes(c.name);

  const build = () => {
    const values = {};
    for (const c of meta.columns) {
      if (c.auto || c.type === 'sql_variant') continue;
      if (editing && c.pk) continue;
      const k = kindOf(c); const v = vals[c.name]; const isTouched = touched.has(c.name);
      if (editing && !isTouched) continue;
      if (!editing && !isTouched) { if (!c.nullable && !c.hasDefault) throw new Error(`${c.name} is required`); continue; }
      if (k === 'binary') { values[c.name] = v ? v.b64 : null; continue; }
      const blank = v === undefined || v === null || v === '';
      if (blank) {
        if (c.nullable) values[c.name] = null;
        else if (!editing && c.hasDefault) continue;
        else if (['text', 'textarea'].includes(k)) values[c.name] = '';
        else throw new Error(`${c.name} cannot be empty`);
      } else values[c.name] = k === 'bit' ? v === 'true' : v;
    }
    return values;
  };
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    let values; try { values = build(); } catch (x) { setErr(x.message); return; }
    setBusy(true);
    try {
      const body = { side: ctx.side, schema: ctx.schema, table: ctx.table };
      const r = editing
        ? await send('PUT', `/api/syncs/${ctx.sync}/records`, { ...body, key: Object.fromEntries(meta.pk.map((k) => [k, initial[k]])), values }, { targetWrite: ctx.allowTarget })
        : await send('POST', `/api/syncs/${ctx.sync}/records`, { ...body, values }, { targetWrite: ctx.allowTarget });
      onSaved({ op: editing ? 'update' : 'insert', key: r.key, row: r.row, writtenAt: r.writtenAt });
      if (!editing) { setVals(init); setTouched(new Set()); }
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return <form className="card" onSubmit={submit}>
    <h3 style={{ margin: '0 0 4px' }}>{editing ? 'Edit' : 'Create'} record — {meta.schema}.{meta.table} <span className="pill mute">{ctx.side}</span></h3>
    <p className="sub" style={{ marginTop: 0 }}>Generated from the table's columns. {editing ? 'Only the fields you change are sent.' : 'Fields with a default can be left blank.'} Identity, computed and rowversion columns are generated by the database.</p>
    <div className="form">
      {fields.map((c) => {
        const k = kindOf(c); const wide = ['textarea', 'spatial'].includes(k); const ro = (editing && (c.pk || c.auto)) || c.auto || c.type === 'sql_variant';
        return <div key={c.name} className={`fld ${wide ? 'wide' : ''}`}>
          <label>
            <span className="meta"><b style={{ color: 'var(--text)' }}>{c.name}</b>{!c.nullable && !c.hasDefault && !c.auto && <span className="req">*</span>}
              <span className="pill mute">{typeLabel(c)}</span>{c.pk && <span className="pill ok">key</span>}{c.identity && <span className="pill mute">identity</span>}{c.computed && <span className="pill mute">computed</span>}{c.rowversion && <span className="pill mute">rowversion</span>}
              {c.fk && <span className="pill mute">→ {c.fk.table}</span>}{spatialExcluded(c) && <span className="pill warn" title="SymmetricDS cannot transport this type: the column is not copied to the target">not replicated</span>}</span>
            {ro ? <input readOnly value={editing ? toInput(c, initial?.[c.name]) : '(generated)'} /> : <Control c={c} v={vals[c.name]} set={(v) => set(c.name, v)} ctx={ctx} disabled={!canWrite || busy} />}
          </label></div>;
      })}
    </div>
    {err && <div className="alert critical" style={{ marginTop: 12 }}>{err}</div>}
    <div className="row"><button className="btn primary" disabled={!canWrite || busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create record'}</button>{onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      {!canWrite && <span className="err sub">Writing is disabled here (see the notice above).</span>}</div>
  </form>;
}
