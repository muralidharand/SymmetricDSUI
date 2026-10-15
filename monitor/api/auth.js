// Single admin account (from environment) with a cookie session. The UI can write to databases, so everything requires login.
import crypto from 'node:crypto';

const USER = process.env.MONITOR_ADMIN_USER || 'admin';
const PASS = process.env.MONITOR_ADMIN_PASSWORD || '';
const sessions = new Map();               // token -> { user, exp }
const failures = new Map();               // ip -> { n, until }
const TTL = 12 * 3600 * 1000;

const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookie = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split(/=(.*)/s).slice(0, 2)).filter((p) => p[0]));

export const authConfigured = () => PASS.length > 0;

export function login(req, reply) {
  const ip = req.ip; const f = failures.get(ip);
  if (f && f.until > Date.now()) return reply.code(429).send({ error: 'Too many failed attempts. Try again in a few minutes.' });
  const { user, password } = req.body || {};
  if (!authConfigured()) return reply.code(503).send({ error: 'MONITOR_ADMIN_PASSWORD is not set in .env, sign-in is disabled.' });
  if (safeEq(user ?? '', USER) && safeEq(password ?? '', PASS)) {
    failures.delete(ip);
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { user: USER, exp: Date.now() + TTL });
    reply.header('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL / 1000}`);
    return { user: USER };
  }
  const n = (f?.n || 0) + 1; failures.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
  return reply.code(401).send({ error: 'Wrong user name or password' });
}
export function logout(req, reply) {
  const t = cookie(req).sid; if (t) sessions.delete(t);
  reply.header('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return { ok: true };
}
export function sessionOf(req) {
  const t = cookie(req).sid; const s = t && sessions.get(t);
  if (!s) return null; if (s.exp < Date.now()) { sessions.delete(t); return null; }
  return s;
}
// Fastify preHandler-style guard
export function guard(req, reply, done) {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/') || url === '/api/login' || url === '/api/session') return done();
  const s = sessionOf(req);
  if (!s) return reply.code(401).send({ error: 'Sign in required' });
  // CSRF defence in depth (cookie is SameSite=Strict): state-changing calls must carry a custom header
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'monitor') return reply.code(403).send({ error: 'Missing X-Requested-With header' });
  req.user = s.user; done();
}
