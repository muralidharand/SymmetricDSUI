// Compares a written row on the source with the target: this is how "replicated in N seconds" is measured.
import { tableMeta, replicatedMap, isSpatial } from './catalog.js';
import { rowsByPks, getByPk, keyOf } from './records.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// columns that are really comparable: both sides have them, not rowversion/spatial, not excluded from the sync
export function comparable(srcMeta, tgtMeta, excluded = []) {
  const t = new Set(tgtMeta.columns.map((c) => c.name));
  return srcMeta.columns.filter((c) => t.has(c.name) && !c.rowversion && !isSpatial(c) && !excluded.includes(c.name)).map((c) => c.name);
}
export function diff(a, b, cols) { return cols.filter((c) => String(a?.[c] ?? '\u0000') !== String(b?.[c] ?? '\u0000')); }

// status of a set of keys: replicated | pending (not there yet) | different | extra (still on target but deleted on source)
export async function statuses(ctx, pks) {
  const { srcCid, tgtCid, schema, table } = ctx;
  const sm = await tableMeta(srcCid, schema, table); const tm = await tableMeta(tgtCid, schema, table);
  if (!sm || !tm) return { error: 'table does not exist on both sides', items: [] };
  const rep = (await replicatedMap(srcCid)).get(`${schema}.${table}`);
  const cols = comparable(sm, tm, rep?.excluded || []);
  const srcRows = await rowsByPks(srcCid, sm, pks, 'cmp'); const tgtRows = await rowsByPks(tgtCid, tm, pks, 'cmp');
  const idx = (m, rows) => new Map(rows.map((r) => [JSON.stringify(m.pk.map((k) => String(r[k]))), r]));
  const sIdx = idx(sm, srcRows); const tIdx = idx(tm, tgtRows);
  const items = pks.map((pk) => {
    const key = JSON.stringify(sm.pk.map((k) => String(pk[k])));
    const s = sIdx.get(key); const t = tIdx.get(key);
    let status;
    if (s && !t) status = 'pending'; else if (!s && t) status = 'extra'; else if (!s && !t) status = 'replicated';   // gone on both
    else { const d = diff(s, t, cols); status = d.length ? 'different' : 'replicated'; if (d.length) return { pk, status, columns: d }; }
    return { pk, status };
  });
  return { items, replicated: !!rep, excluded: rep?.excluded || [] };
}

// wait until the row (or its deletion) reached the target
export async function waitReplicated(ctx, pk, { timeoutMs = 30000 } = {}) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await statuses(ctx, [pk]); last = r.items?.[0];
    if (r.error) return { status: 'error', error: r.error, seconds: (Date.now() - t0) / 1000 };
    if (last?.status === 'replicated') return { status: 'replicated', seconds: (Date.now() - t0) / 1000, replicatedTable: r.replicated };
    if (!r.replicated) return { status: 'not-replicated', seconds: (Date.now() - t0) / 1000 };
    await sleep(700);
  }
  return { status: last?.status || 'pending', columns: last?.columns, seconds: (Date.now() - t0) / 1000, timedOut: true };
}
export { getByPk, keyOf };
