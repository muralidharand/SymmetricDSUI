import React, { useState } from 'react';
import { send } from './api.js';

export default function Login({ configured, onDone }) {
  const [user, setUser] = useState('admin'); const [password, setPassword] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await send('POST', '/api/login', { user, password }); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return <div className="login"><form className="card" onSubmit={submit}>
    <h2>Sync Tester</h2>
    <p className="sub">Create, edit and delete records on the source database and watch them arrive on the target. Sign in with the monitor's account (<code>MONITOR_ADMIN_USER</code> / <code>MONITOR_ADMIN_PASSWORD</code> in <code>.env</code>).</p>
    {!configured && <div className="alert critical">No password is configured: set <code>MONITOR_ADMIN_PASSWORD</code> in <code>.env</code> and restart (<code>docker compose up -d tester</code>).</div>}
    <label>User<input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" /></label>
    <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus /></label>
    {err && <div className="alert critical">{err}</div>}
    <button className="btn primary" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form></div>;
}
