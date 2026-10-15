// Row count + checksum comparison of every replicated table (the tables listed in the source's sym_trigger_router).
import { q, explain } from './db.js';
import { fq } from './discovery.js';

export async function computeParity(srcCid, tgtCid) {
  const tables = await q(srcCid, `SELECT DISTINCT t.source_schema_name s, t.source_table_name n FROM sym_trigger t
    JOIN sym_trigger_router r ON r.trigger_id = t.trigger_id WHERE r.enabled = 1 ORDER BY 1, 2`);
  const rows = [];
  for (const { s, n } of tables) {
    const stat = `SELECT COUNT_BIG(*) c, CHECKSUM_AGG(BINARY_CHECKSUM(*)) k FROM ${fq(s, n)}`;
    const side = async (cid) => { try { const r = (await q(cid, stat))[0]; return { c: Number(r.c), k: r.k ?? 0 }; } catch (e) { return { c: -1, k: 0, err: explain(e) }; } };
    const [a, b] = await Promise.all([side(srcCid), side(tgtCid)]);
    rows.push({ table: `${s}.${n}`, source_rows: a.c, target_rows: b.c, match: a.c === b.c && a.k === b.k && a.c >= 0, count_match: a.c === b.c, error: a.err || b.err });
  }
  return { checked_at: new Date().toISOString(), tables: rows, in_sync: rows.length > 0 && rows.every((r) => r.match) };
}
