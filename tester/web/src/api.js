async function parse(r, url) {
  if (r.ok) return r.json();
  let msg = `${r.status}`; try { const b = await r.json(); if (b.error) msg = b.error; } catch { /* not json */ }
  if (r.status === 401) window.dispatchEvent(new Event('unauthenticated'));
  const e = new Error(msg); e.status = r.status; e.url = url; throw e;
}
export const get = (url) => fetch(url).then((r) => parse(r, url));
export const send = (method, url, body, { targetWrite = false } = {}) => fetch(url, {
  method,
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'tester', ...(targetWrite ? { 'X-Target-Write': 'yes' } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => parse(r, url));
export const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
export const arr = (x) => (Array.isArray(x) ? x : []);
export const keyOf = (meta, row) => Object.fromEntries(meta.pk.map((k) => [k, row[k]]));
