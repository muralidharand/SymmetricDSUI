// Dependency analysis on the SOURCE database for the tables chosen in the wizard:
//  1. foreign keys   - parents that are not selected, self references, cycles
//  2. other objects  - functions (computed columns / defaults / check constraints), alias types, sequences, schemas
//     that must exist on the target before the tables can be created there.
import { q } from './db.js';
import { tableColumns, typeText } from './discovery.js';

const qi = (s) => `[${String(s).replace(/]/g, ']]')}]`;
const lit = (s) => String(s).replace(/'/g, "''");
const isSym = (n) => /^sym_/i.test(n || '');

// ---------------- foreign keys ----------------
function sccs(nodes, edges) {                        // Tarjan; edges: Map(node -> Set(parents))
  let idx = 0; const st = []; const on = new Set(); const index = new Map(); const low = new Map(); const out = [];
  const visit = (v) => {
    index.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
    for (const w of edges.get(v) || []) {
      if (!nodes.has(w)) continue;
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) out.push(c.sort()); }
  };
  for (const n of nodes) if (!index.has(n)) visit(n);
  return out;
}

export async function fkFacts(cid, selected) {
  const sel = new Set(selected);
  const fks = await q(cid, `SELECT OBJECT_SCHEMA_NAME(fk.parent_object_id) + '.' + OBJECT_NAME(fk.parent_object_id) AS child,
      OBJECT_SCHEMA_NAME(fk.referenced_object_id) + '.' + OBJECT_NAME(fk.referenced_object_id) AS parent FROM sys.foreign_keys fk`);
  const parentsOf = new Map();
  for (const f of fks) { if (!parentsOf.has(f.child)) parentsOf.set(f.child, new Set()); parentsOf.get(f.child).add(f.parent); }
  const missing = new Map(); const seen = new Set(sel); const queue = [...sel];
  while (queue.length) {
    const c = queue.shift();
    for (const p of parentsOf.get(c) || []) {
      if (p === c) continue;
      if (!sel.has(p)) { if (!missing.has(p)) missing.set(p, new Set()); missing.get(p).add(c); }
      if (!seen.has(p)) { seen.add(p); queue.push(p); }
    }
  }
  return {
    missingParents: [...missing].map(([table, by]) => ({ table, requiredBy: [...by].sort() })).sort((a, b) => a.table.localeCompare(b.table)),
    selfRefs: [...sel].filter((t) => parentsOf.get(t)?.has(t)).sort(),
    cycles: sccs(sel, parentsOf),
  };
}

// ---------------- other objects ----------------
const DEP_SQL = (ids) => `SELECT d.referencing_id, d.referenced_server_name AS srv, d.referenced_database_name AS db, d.referenced_schema_name AS sch,
    d.referenced_entity_name AS ent, d.referenced_class_desc AS cls, o.object_id AS ref_id, o.type AS ref_type, SCHEMA_NAME(o.schema_id) AS ref_schema, o.name AS ref_name
  FROM sys.sql_expression_dependencies d LEFT JOIN sys.objects o ON o.object_id = d.referenced_id WHERE d.referencing_id IN (${ids.map(Number).join(',')})`;

async function aliasTypeInfo(cid, schema, name) {
  const r = (await q(cid, `SELECT SCHEMA_NAME(ty.schema_id) AS s, ty.name AS n, bt.name AS base, ty.max_length, ty.precision, ty.scale, ty.is_nullable, ty.is_assembly_type, ty.is_table_type
      FROM sys.types ty LEFT JOIN sys.types bt ON bt.user_type_id = ty.system_type_id WHERE ty.schema_id = SCHEMA_ID(@s) AND ty.name = @n`, { s: schema, n: name }))[0];
  return r || null;
}

export async function analyzeDependencies(cid, selected, { objectTables = selected } = {}) {
  const facts = await fkFacts(cid, selected);
  const blockers = []; const warnings = [];
  const fns = new Map();       // key -> {schema,name,id,def,deps:Set(keys)}
  const types = new Map();     // key -> info
  const seqs = new Map();
  const schemas = new Set();
  const key = (s, n) => `${s}.${n}`;

  const noteType = async (s, n, who) => {
    const k = key(s, n); if (types.has(k) || s === 'sys') return;
    const info = await aliasTypeInfo(cid, s, n);
    if (!info) return;
    if (info.is_assembly_type) { blockers.push(`${who} uses the CLR type ${qi(s)}.${qi(n)}, which cannot be copied automatically. Create it on the target yourself (CREATE TYPE ... EXTERNAL NAME) or exclude the table.`); return; }
    if (info.is_table_type) { blockers.push(`${who} uses the table type ${qi(s)}.${qi(n)}, which is not supported.`); return; }
    types.set(k, info); if (s !== 'dbo') schemas.add(s);
  };

  // handle one dependency row found while analysing `who`
  const handleRow = async (r, who, fromFunction) => {
    if (r.srv || r.db) { blockers.push(`${who} references ${[r.srv, r.db, r.sch, r.ent].filter(Boolean).map(qi).join('.')} in another database or server. Cross-database objects cannot be created on the target automatically.`); return; }
    if (r.cls === 'TYPE') { await noteType(r.sch || 'dbo', r.ent, who); return; }
    if (r.cls !== 'OBJECT_OR_COLUMN' || !r.ref_id) return;
    if (isSym(r.ref_name)) return;
    const s = r.ref_schema, n = r.ref_name, k = key(s, n);
    if (['FN', 'IF', 'TF'].includes(r.ref_type)) { if (!fns.has(k)) fns.set(k, { schema: s, name: n, id: r.ref_id, deps: new Set(), todo: true }); return; }
    if (['FS', 'FT', 'AF', 'AT'].includes(r.ref_type)) { blockers.push(`${who} uses the CLR function ${qi(s)}.${qi(n)}, which cannot be copied automatically.`); return; }
    if (r.ref_type === 'SN') { blockers.push(`${who} uses the synonym ${qi(s)}.${qi(n)}, which is not supported.`); return; }
    if (r.ref_type === 'SO') { if (!seqs.has(k)) seqs.set(k, { schema: s, name: n, id: r.ref_id }); if (s !== 'dbo') schemas.add(s); return; }
    if (fromFunction && ['U', 'V'].includes(r.ref_type)) warnings.push(`${who} reads ${qi(s)}.${qi(n)}: that table/view must exist on the target (and hold data) for the function to work there.`);
  };

  // 1) tables that will be created: their computed columns, defaults and check constraints; their column alias types
  const ids = [];
  for (const t of objectTables) { const id = (await q(cid, 'SELECT OBJECT_ID(@t) AS id', { t: t.split('.').map(qi).join('.') }))[0].id; if (id) ids.push(id); }
  if (ids.length) {
    const sub = await q(cid, `SELECT object_id FROM sys.objects WHERE parent_object_id IN (${ids.join(',')}) AND type IN ('D','C')`);
    const rows = await q(cid, DEP_SQL([...ids, ...sub.map((x) => x.object_id)]));
    const names = new Map((await q(cid, `SELECT object_id AS id, SCHEMA_NAME(schema_id) + '.' + name AS n FROM sys.objects WHERE object_id IN (${ids.join(',')})`)).map((x) => [x.id, x.n]));
    for (const r of rows) await handleRow(r, `Table ${names.get(r.referencing_id) || 'definition'}`, false);
  }
  for (const t of objectTables) {            // alias types (dbo.Name, dbo.Flag ...) used by the columns; CLR alias types become blockers
    const [schema, ...rest] = t.split('.');
    for (const c of (await tableColumns(cid, schema, rest.join('.'))).columns) if (c.is_alias) await noteType(c.type_schema, c.type_name, `Table ${t}`);
  }

  // 2) functions: transitive closure (functions calling functions, alias types in their parameters)
  for (let guard = 0; guard < 200; guard++) {
    const f = [...fns.values()].find((x) => x.todo); if (!f) break; f.todo = false;
    const who = `Function ${qi(f.schema)}.${qi(f.name)}`;
    f.def = (await q(cid, 'SELECT OBJECT_DEFINITION(@id) AS d', { id: f.id }))[0].d;
    if (!f.def) { blockers.push(`${who} is encrypted or its definition cannot be read, so it cannot be copied to the target.`); continue; }
    if (f.schema !== 'dbo') schemas.add(f.schema);
    for (const r of await q(cid, DEP_SQL([f.id]))) {
      await handleRow(r, who, true);
      if (r.cls === 'OBJECT_OR_COLUMN' && ['FN', 'IF', 'TF'].includes(r.ref_type) && !isSym(r.ref_name)) f.deps.add(key(r.ref_schema, r.ref_name));
    }
    for (const p of await q(cid, `SELECT SCHEMA_NAME(ty.schema_id) AS s, ty.name AS n FROM sys.parameters p JOIN sys.types ty ON ty.user_type_id = p.user_type_id WHERE p.object_id = @id AND ty.is_user_defined = 1`, { id: f.id })) await noteType(p.s, p.n, who);
  }

  // 3) statements in creation order: schemas -> alias types -> sequences -> functions (callee first)
  const statements = [];
  for (const s of [...schemas].sort()) statements.push({ kind: 'schema', name: s, sql: `IF SCHEMA_ID(N'${lit(s)}') IS NULL EXEC(N'CREATE SCHEMA ${lit(qi(s))}')` });
  for (const t of [...types.values()].sort((a, b) => key(a.s, a.n).localeCompare(key(b.s, b.n)))) {
    const base = typeText({ type: t.base, max_length: t.max_length, precision: t.precision, scale: t.scale });
    statements.push({ kind: 'type', name: key(t.s, t.n), sql: `IF TYPE_ID(N'${lit(qi(t.s) + '.' + qi(t.n))}') IS NULL EXEC(N'CREATE TYPE ${lit(qi(t.s) + '.' + qi(t.n))} FROM ${base} ${t.is_nullable ? 'NULL' : 'NOT NULL'}')` });
  }
  for (const sq of [...seqs.values()]) {
    const r = (await q(cid, `SELECT TYPE_NAME(user_type_id) AS tn, CAST(start_value AS nvarchar(50)) AS sv, CAST(increment AS nvarchar(50)) AS inc, CAST(minimum_value AS nvarchar(50)) AS mn,
        CAST(maximum_value AS nvarchar(50)) AS mx, is_cycling, is_cached, cache_size FROM sys.sequences WHERE object_id = @id`, { id: sq.id }))[0];
    if (!r) continue;
    const ddl = `CREATE SEQUENCE ${qi(sq.schema)}.${qi(sq.name)} AS ${r.tn} START WITH ${r.sv} INCREMENT BY ${r.inc} MINVALUE ${r.mn} MAXVALUE ${r.mx} ${r.is_cycling ? 'CYCLE' : 'NO CYCLE'} ${r.is_cached ? `CACHE ${r.cache_size || ''}` : 'NO CACHE'}`;
    statements.push({ kind: 'sequence', name: key(sq.schema, sq.name), sql: `IF OBJECT_ID(N'${lit(qi(sq.schema) + '.' + qi(sq.name))}') IS NULL EXEC(N'${lit(ddl)}')` });
  }
  const done = new Set(); const orderedFns = [];
  const visit = (k, path = []) => { if (done.has(k) || path.includes(k)) return; const f = fns.get(k); if (!f) return; for (const d of f.deps) visit(d, [...path, k]); done.add(k); orderedFns.push(f); };
  for (const k of [...fns.keys()].sort()) visit(k);
  for (const f of orderedFns) if (f.def) statements.push({ kind: 'function', name: key(f.schema, f.name), sql: `IF OBJECT_ID(N'${lit(qi(f.schema) + '.' + qi(f.name))}') IS NULL EXEC(N'${lit(f.def)}')`, preview: f.def });

  return { ...facts, objects: { statements }, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}

// mark which objects already exist on the target (informational; the statements are idempotent anyway)
export async function markExisting(tgtCid, statements) {
  for (const st of statements) {
    if (st.kind === 'schema') st.exists = !!(await q(tgtCid, 'SELECT SCHEMA_ID(@n) AS id', { n: st.name }))[0].id;
    else if (st.kind === 'type') { const [s, n] = st.name.split('.'); st.exists = !!(await q(tgtCid, 'SELECT TYPE_ID(@n) AS id', { n: `${qi(s)}.${qi(n)}` }))[0].id; }
    else { const [s, n] = st.name.split('.'); st.exists = !!(await q(tgtCid, 'SELECT OBJECT_ID(@n) AS id', { n: `${qi(s)}.${qi(n)}` }))[0].id; }
  }
  return statements;
}

// existing target tables with a foreign key to a table that is not part of the sync and is empty on the target
export async function targetFkProblems(tgtCid, selected) {
  const sel = new Set(selected); const out = [];
  const rows = await q(tgtCid, `SELECT OBJECT_SCHEMA_NAME(fk.parent_object_id) + '.' + OBJECT_NAME(fk.parent_object_id) AS child,
      OBJECT_SCHEMA_NAME(fk.referenced_object_id) + '.' + OBJECT_NAME(fk.referenced_object_id) AS parent, fk.name AS fk_name,
      (SELECT ISNULL(SUM(p.rows), 0) FROM sys.partitions p WHERE p.object_id = fk.referenced_object_id AND p.index_id < 2) AS parent_rows FROM sys.foreign_keys fk`);
  for (const r of rows) if (sel.has(r.child) && !sel.has(r.parent) && r.child !== r.parent && Number(r.parent_rows) === 0) out.push(`${r.child} has the foreign key ${r.fk_name} to ${r.parent}, which is not part of this sync and is empty on the target`);
  return out;
}
