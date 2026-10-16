// Same single admin account as the monitor (MONITOR_ADMIN_USER / MONITOR_ADMIN_PASSWORD), own session cookie.
import crypto from 'node:crypto';
const USER = process.env.MONITOR_ADMIN_USER || 'admin';
const PASS = process.env.MONITOR_ADMIN_PASSWORD || '';
const sessions = new Map(); const failures = new Map(); const TTL = 12 * 3600 * 1000;
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookie = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split(/=(.*)/s).slice(0, 2)).filter((p) => p[0]));
export const authConfigured = () => PASS.length > 0;
export function login(req, reply) {
  const f = failures.get(req.ip);
  if (f && f.until > Date.now()) return reply.code(429).send({ error: 'Too many failed attempts. Try again in a few minutes.' });
  if (!authConfigured()) return reply.code(503).send({ error: 'MONITOR_ADMIN_PASSWORD is not set in .env, sign-in is disabled.' });
  const { user, password } = req.body || {};
  if (safeEq(user ?? '', USER) && safeEq(password ?? '', PASS)) {
    failures.delete(req.ip); const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, { user: USER, exp: Date.now() + TTL });
    reply.header('Set-Cookie', `tsid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL / 1000}`); return { user: USER };
  }
  const n = (f?.n || 0) + 1; failures.set(req.ip, { n, until: n >= 5 ? Date.now() + 300000 : 0 });
  return reply.code(401).send({ error: 'Wrong user name or password' });
}
export function logout(req, reply) { const t = cookie(req).tsid; if (t) sessions.delete(t); reply.header('Set-Cookie', 'tsid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok: true }; }
export function sessionOf(req) { const t = cookie(req).tsid; const s = t && sessions.get(t); if (!s) return null; if (s.exp < Date.now()) { sessions.delete(t); return null; } return s; }
export function guard(req, reply, done) {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/') || url === '/api/login' || url === '/api/session') return done();
  const s = sessionOf(req); if (!s) return reply.code(401).send({ error: 'Sign in required' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'tester') return reply.code(403).send({ error: 'Missing X-Requested-With header' });
  req.user = s.user; done();
}
