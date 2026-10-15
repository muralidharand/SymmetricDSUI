import React, { useState } from 'react';
import { send, useApi, arr } from './api.js';

const EMPTY = { name: '', host: '', port: 1433, database: '', user: '', password: '', encrypt: true, trustCert: true, notes: '' };

function TestResult({ r }) {
  if (!r) return null;
  if (r.testing) return <div className="alert">Testing…</div>;
  if (!r.ok) return <div className="alert critical"><b>Connection failed.</b> {r.error}</div>;
  return <div className={`alert ${r.problems?.length ? 'warning' : 'ok'}`}>
    <b>Connected</b> in {r.latencyMs} ms as <code>{r.login}</code> to <code>{r.database}</code>{r.azure ? ' (Azure SQL)' : ''}.<br />
    <span className="sub">{r.version} · {r.userTables} user table(s) · {r.hasSymTables ? 'contains SymmetricDS tables' : 'no SymmetricDS tables'} · READ_COMMITTED_SNAPSHOT {r.rcsi ? 'on' : 'off'}</span>
    {arr(r.problems).map((p, i) => <div key={i} className="err">⚠ {p}</div>)}
  </div>;
}

export default function Connections() {
  const { data, err, reload } = useApi('/api/connections', 8000, { scoped: false });
  const { data: pairs } = useApi('/api/pairs', 8000, { scoped: false });
  const [form, setForm] = useState(null); const [test, setTest] = useState(null); const [msg, setMsg] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const usedBy = (id) => arr(pairs).filter((p) => p.sourceConnId === id || p.targetConnId === id).map((p) => p.name);

  const doTest = async (body) => { setTest({ testing: true }); try { setTest(await send('POST', '/api/connections/test', body)); } catch (e) { setTest({ ok: false, error: e.message }); } };
  const save = async () => {
    setMsg(null);
    try { await send('POST', '/api/connections', form); setForm(null); setTest(null); reload(); } catch (e) { setMsg(e.message); }
  };
  const del = async (c) => {
    if (!window.confirm(`Delete the connection "${c.name}"? (Only the saved connection is removed, not the database.)`)) return;
    try { await send('DELETE', `/api/connections/${c.id}`); reload(); } catch (e) { setMsg(e.message); }
  };

  return <>
    <div className="row"><button className="btn primary" onClick={() => { setForm({ ...EMPTY }); setTest(null); setMsg(null); }}>Add connection</button>
      <span className="sub">Saved connections are used by the <b>Sync jobs</b> wizard. Passwords are encrypted and never shown again.</span></div>
    {err && <div className="alert critical">{err.message}</div>}
    {msg && <div className="alert critical">{msg}</div>}
    {form && <div className="card" style={{ marginBottom: 16 }}>
      <h3>{form.id ? 'Edit connection' : 'New connection (SQL Server / Azure SQL / RDS for SQL Server)'}</h3>
      <div className="form">
        <label>Name<input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Orders production" /></label>
        <label>Host<input value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="mssql · host.docker.internal · myserver.database.windows.net" /></label>
        <label>Port<input type="number" value={form.port} onChange={(e) => set('port', e.target.value)} /></label>
        <label>Database<input value={form.database} onChange={(e) => set('database', e.target.value)} /></label>
        <label>User<input value={form.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" /></label>
        <label>Password<input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder={form.id ? 'leave blank to keep the saved password' : ''} autoComplete="new-password" /></label>
        <label className="chk"><input type="checkbox" checked={form.encrypt} onChange={(e) => set('encrypt', e.target.checked)} /> Encrypt connection (TLS)</label>
        <label className="chk"><input type="checkbox" checked={form.trustCert} onChange={(e) => set('trustCert', e.target.checked)} /> Trust server certificate (needed for self-signed certificates, e.g. Docker SQL Server)</label>
        <label style={{ gridColumn: '1 / -1' }}>Notes<input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      </div>
      <p className="sub">The login needs <b>db_owner</b> in this database (SymmetricDS creates its own tables and triggers). From inside Docker, a SQL Server running on this Windows PC is reachable as <code>host.docker.internal</code>; Azure SQL needs your public IP allowed in its firewall.</p>
      <TestResult r={test} />
      <div className="row"><button className="btn" onClick={() => doTest(form)}>Test connection</button>
        <button className="btn primary" onClick={save} disabled={!form.name || !form.host || !form.database || !form.user || (!form.id && !form.password)}>Save</button>
        <button className="btn" onClick={() => { setForm(null); setTest(null); }}>Cancel</button></div>
    </div>}
    <div className="card scroll"><table><thead><tr><th>Name</th><th>Server</th><th>Database</th><th>User</th><th>TLS</th><th>Used by</th><th /></tr></thead><tbody>
      {arr(data).map((c) => <tr key={c.id}>
        <td><b>{c.name}</b>{c.system && <span className="pill mute" style={{ marginLeft: 6 }}>built-in</span>}<div className="sub">{c.notes}</div></td>
        <td>{c.host}:{c.port}</td><td>{c.database}</td><td>{c.user}</td><td>{c.encrypt ? 'on' : 'off'}{c.encrypt && c.trustCert ? ' (trust cert)' : ''}</td>
        <td className="sub">{usedBy(c.id).join(', ') || '–'}</td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button className="btn" onClick={() => { setTest(null); doTest({ id: c.id }); setForm(null); setMsg(null); window.scrollTo(0, 0); }} title="Test with the saved settings">Test</button>{' '}
          {!c.system && <><button className="btn" onClick={() => { setForm({ ...c, password: '' }); setTest(null); window.scrollTo(0, 0); }}>Edit</button>{' '}
            <button className="btn" onClick={() => del(c)}>Delete</button></>}
        </td></tr>)}
    </tbody></table></div>
    {!form && <TestResult r={test} />}
  </>;
}
