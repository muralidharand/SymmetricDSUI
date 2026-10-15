import React, { useState } from 'react';
import { send } from './api.js';

export default function Login({ configured, onDone }) {
  const [user, setUser] = useState('admin'); const [password, setPassword] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await send('POST', '/api/login', { user, password }); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return <div className="login"><form className="card" onSubmit={submit}>
    <h2>SymmetricDS Monitor</h2>
    <p className="sub">Sign in. The user name and password are <code>MONITOR_ADMIN_USER</code> / <code>MONITOR_ADMIN_PASSWORD</code> in your <code>.env</code> file.</p>
    {!configured && <div className="alert critical">No password is configured: set <code>MONITOR_ADMIN_PASSWORD</code> in <code>.env</code> and restart the monitor (<code>docker compose up -d monitor</code>).</div>}
    <label>User<input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" /></label>
    <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus /></label>
    {err && <div className="alert critical">{err}</div>}
    <button className="btn primary" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form></div>;
}
