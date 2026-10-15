import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export const PairCtx = createContext('demo');
export const usePair = () => useContext(PairCtx);

async function parse(r, url) {
  if (r.ok) return r.json();
  let msg = `${r.status}`; try { const b = await r.json(); if (b.error) msg = b.error; } catch { /* not json */ }
  if (r.status === 401) window.dispatchEvent(new Event('unauthenticated'));
  const e = new Error(msg); e.status = r.status; e.url = url; throw e;
}
const withPair = (url, pair) => (pair ? `${url}${url.includes('?') ? '&' : '?'}pair=${encodeURIComponent(pair)}` : url);

export const get = (url, pair) => fetch(withPair(url, pair)).then((r) => parse(r, url));
export const send = (method, url, body) => fetch(url, {
  method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'monitor' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => parse(r, url));

// Polls an endpoint; pair-scoped by default (the selected sync), pass scoped=false for global lists
export function useApi(url, ms = 5000, { scoped = true } = {}) {
  const pair = usePair();
  const [data, setData] = useState(null); const [err, setErr] = useState(null);
  const load = useCallback(() => get(url, scoped ? pair : null).then((d) => { setData(d); setErr(null); }).catch((e) => { setErr(e); }), [url, pair, scoped]);
  useEffect(() => { setData(null); load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]);
  return { data, err, reload: load };
}
export const arr = (x) => (Array.isArray(x) ? x : []);
