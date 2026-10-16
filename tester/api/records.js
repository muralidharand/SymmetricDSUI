// Generic, catalog-driven record operations. Identifiers come from the catalog (quoted), values are always bound parameters.
import { run, sql } from './db.js';
import { qi, fq, typeText, isSpatial } from './catalog.js';

const INTS = ['tinyint', 'smallint', 'int'];
const DECIMALS = ['decimal', 'numeric', 'money', 'smallmoney', 'float', 'real'];
const TEMPORAL = ['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'];
const STRINGS = ['char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext'];
const BINARY = ['binary', 'varbinary', 'image'];
const bad = (msg) => Object.assign(new Error(msg), { statusCode: 400 });
export const isBinary = (c) => BINARY.includes(c.type);
export const editable = (c) => !c.auto && c.type !== 'sql_variant';

// ---------- reading: every value is returned as text/number/bool so nothing is lost or time-zone shifted by JavaScript ----------
// mode: 'list' (long values truncated), 'full', 'cmp' (like full, but binary compared by hash)
export function colExpr(c, mode = 'full') {
  const n = qi(c.name); const t = c.type;
  const cut = (e) => (mode === 'list' ? `LEFT(${e}, 200)` : e);
  if (INTS.includes(t) || t === 'bit') return n;
  if (t === 'bigint') return `CAST(${n} AS varchar(30))`;
  if (['decimal', 'numeric', 'money', 'smallmoney'].includes(t)) return `CAST(${n} AS varchar(64))`;
  if (['float', 'real'].includes(t)) return `CONVERT(varchar(40), ${n}, 3)`;
  if (t === 'datetimeoffset') return `CONVERT(varchar(40), ${n}, 127)`;
  if (TEMPORAL.includes(t)) return `CONVERT(varchar(40), ${n}, 126)`;
  if (t === 'uniqueidentifier') return `CAST(${n} AS varchar(36))`;
  if (['char', 'varchar', 'nchar', 'nvarchar'].includes(t)) return c.maxLength === -1 || c.maxLength > 200 ? cut(n) : n;
  if (t === 'text' || t === 'ntext' || t === 'xml') return cut(`CAST(${n} AS nvarchar(max))`);
  if (isBinary(c)) return mode === 'cmp' ? `CONVERT(varchar(64), HASHBYTES('SHA2_256', ${n}), 2)` : `CASE WHEN ${n} IS NULL THEN NULL ELSE '<binary ' + CAST(DATALENGTH(${n}) AS varchar(20)) + ' bytes>' END`;
  if (t === 'hierarchyid') return `${n}.ToString()`;
  if (isSpatial(c)) return cut(`${n}.STAsText()`);
  if (t === 'timestamp') return `CONVERT(varchar(20), ${n}, 1)`;
  return cut(`CAST(${n} AS nvarchar(max))`);
}
const selectList = (m, mode) => m.columns.map((c) => `${colExpr(c, mode)} AS ${qi(c.name)}`).join(', ');

// ---------- writing: one value -> { expr, param } ----------
function norm(c, raw) {
  const t = c.type;
  if (TEMPORAL.includes(t)) {
    let s = String(raw).trim().replace(' ', 'T');
    if (t === 'date') return s.slice(0, 10);
    if (t === 'time') { if (/^\d{2}:\d{2}$/.test(s)) s += ':00'; return s; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ':00';
    return s;
  }
  return raw;
}
export function bind(c, raw, i) {
  const name = `p${i}`; const t = c.type;
  if (raw === null || raw === undefined) return { expr: `CAST(NULL AS ${typeText(c)})`, param: null };   // typed NULL (works for hierarchyid, geography, xml, binary ...)
  const v = norm(c, raw);
  const P = (type, value) => ({ name, type, value });
  if (INTS.includes(t)) { if (!/^-?\d+$/.test(String(v))) throw bad(`${c.name}: enter a whole number`); return { expr: `@${name}`, param: P(sql.BigInt, String(v)) }; }
  if (t === 'bigint') { if (!/^-?\d+$/.test(String(v))) throw bad(`${c.name}: enter a whole number`); return { expr: `CAST(@${name} AS bigint)`, param: P(sql.VarChar(30), String(v)) }; }
  if (DECIMALS.includes(t)) { if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(v))) throw bad(`${c.name}: enter a number`); return { expr: `CONVERT(${typeText(c)}, @${name})`, param: P(sql.VarChar(64), String(v)) }; }
  if (t === 'bit') { const s = String(v).toLowerCase(); if (!['true', 'false', '1', '0'].includes(s)) throw bad(`${c.name}: must be true or false`); return { expr: `@${name}`, param: P(sql.Bit, s === 'true' || s === '1') }; }
  if (t === 'datetimeoffset') return { expr: `CONVERT(datetimeoffset(${c.scale}), @${name}, 127)`, param: P(sql.NVarChar(40), String(v)) };
  if (TEMPORAL.includes(t)) return { expr: `CONVERT(${typeText(c)}, @${name}, 126)`, param: P(sql.NVarChar(40), String(v)) };
  if (t === 'uniqueidentifier') { if (!/^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(String(v))) throw bad(`${c.name}: not a valid GUID`); return { expr: `@${name}`, param: P(sql.UniqueIdentifier, String(v)) }; }
  if (['char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext'].includes(t)) {
    if (c.maxLength > 0 && String(v).length > c.maxLength) throw bad(`${c.name}: too long (${String(v).length} > ${c.maxLength})`);
    return { expr: `@${name}`, param: P(sql.NVarChar(sql.MAX), String(v)) };
  }
  if (t === 'xml') return { expr: `CAST(@${name} AS xml)`, param: P(sql.NVarChar(sql.MAX), String(v)) };
  if (t === 'hierarchyid') return { expr: `hierarchyid::Parse(@${name})`, param: P(sql.NVarChar(4000), String(v)) };
  if (t === 'geography') return { expr: `geography::STGeomFromText(@${name}, 4326)`, param: P(sql.NVarChar(sql.MAX), String(v)) };
  if (t === 'geometry') return { expr: `geometry::STGeomFromText(@${name}, 0)`, param: P(sql.NVarChar(sql.MAX), String(v)) };
  if (isBinary(c)) { const b = Buffer.from(String(v), 'base64'); return { expr: `@${name}`, param: P(sql.VarBinary(sql.MAX), b) }; }
  throw bad(`${c.name}: type ${t} cannot be edited here`);
}

function pkWhere(m, pk, start = 0) {
  if (!m.pk.length) throw bad('This table has no primary key: rows cannot be identified');
  const parts = []; const params = [];
  m.pk.forEach((name, k) => {
    const c = m.columns.find((x) => x.name === name);
    if (pk?.[name] === undefined || pk[name] === null) throw bad(`Missing key value ${name}`);
    const b = bind(c, pk[name], start + k); parts.push(`${qi(name)} = ${b.expr}`); if (b.param) params.push(b.param);
  });
  return { sql: parts.join(' AND '), params };
}
export const keyOf = (m, row) => Object.fromEntries(m.pk.map((k) => [k, row[k]]));

export async function getByPk(cid, m, pk, mode = 'full') {
  const w = pkWhere(m, pk);
  return (await run(cid, `SELECT ${selectList(m, mode)} FROM ${fq(m)} WHERE ${w.sql}`, w.params))[0] || null;
}
export async function rowsByPks(cid, m, pks, mode = 'cmp') {
  if (!pks.length) return [];
  const params = []; const ors = [];
  pks.slice(0, 60).forEach((pk) => { const w = pkWhere(m, pk, params.length); ors.push(`(${w.sql})`); params.push(...w.params); });
  return run(cid, `SELECT ${selectList(m, mode)} FROM ${fq(m)} WHERE ${ors.join(' OR ')}`, params);
}

export async function listRecords(cid, m, { page = 1, pageSize = 25, sort, dir = 'asc', q = '' }) {
  pageSize = Math.min(Math.max(Number(pageSize) || 25, 1), 200); page = Math.max(Number(page) || 1, 1);
  const params = [{ name: 'off', type: sql.Int, value: (page - 1) * pageSize }, { name: 'n', type: sql.Int, value: pageSize }];
  let where = '';
  if (q) {
    const esc = String(q).replace(/[\\%_[]/g, '\\$&'); const ors = [];
    params.push({ name: 'q', type: sql.NVarChar(400), value: `%${esc}%` });
    for (const c of m.columns.filter((x) => ['char', 'varchar', 'nchar', 'nvarchar'].includes(x.type)).slice(0, 15)) ors.push(`${qi(c.name)} LIKE @q ESCAPE '\\'`);
    if (/^-?\d+$/.test(q)) { params.push({ name: 'qi', type: sql.BigInt, value: String(q) }); for (const c of m.columns.filter((x) => [...INTS, 'bigint'].includes(x.type)).slice(0, 10)) ors.push(`${qi(c.name)} = @qi`); }
    if (/^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(q)) { params.push({ name: 'qg', type: sql.UniqueIdentifier, value: q }); for (const c of m.columns.filter((x) => x.type === 'uniqueidentifier')) ors.push(`${qi(c.name)} = @qg`); }
    where = ors.length ? `WHERE ${ors.join(' OR ')}` : 'WHERE 1 = 0';
  }
  const sortable = (c) => !['xml', 'text', 'ntext', 'image', 'geography', 'geometry', 'sql_variant'].includes(c.type) && !(['varchar', 'nvarchar', 'varbinary'].includes(c.type) && c.maxLength === -1);
  const sc = m.columns.find((c) => c.name === sort && sortable(c));
  const d = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const order = sc ? `${qi(sc.name)} ${d}${m.pk.length ? ', ' + m.pk.map(qi).join(', ') : ''}` : (m.pk.length ? m.pk.map((k) => `${qi(k)} ${d}`).join(', ') : '(SELECT NULL)');
  const rows = await run(cid, `SELECT ${selectList(m, 'list')} FROM ${fq(m)} ${where} ORDER BY ${order} OFFSET @off ROWS FETCH NEXT @n ROWS ONLY`, params);
  const total = q
    ? Number((await run(cid, `SELECT COUNT_BIG(*) AS n FROM ${fq(m)} ${where}`, params.filter((p) => !['off', 'n'].includes(p.name))))[0].n)
    : Number((await run(cid, 'SELECT ISNULL(SUM(p.rows), 0) AS n FROM sys.partitions p WHERE p.object_id = @id AND p.index_id < 2', [{ name: 'id', type: sql.Int, value: m.objectId }]))[0].n);
  return { rows, total, page, pageSize };
}

function noUnknown(m, values) {   // only real catalog columns are accepted
  for (const k of Object.keys(values || {})) if (!m.columns.some((c) => c.name === k)) throw bad(`Unknown column "${k}"`);
}
function required(m, values) {
  for (const c of m.columns) if (!c.auto && !c.nullable && !c.hasDefault && (values[c.name] === undefined || values[c.name] === null)) throw bad(`${c.name} is required`);
}
export async function insertRecord(cid, m, values) {
  noUnknown(m, values); required(m, values);
  const cols = []; const exprs = []; const params = [];
  for (const c of m.columns) {
    if (!editable(c) || !(c.name in values)) continue;       // identity/computed/rowversion are generated; omitted columns use their default
    const b = bind(c, values[c.name], params.length); cols.push(qi(c.name)); exprs.push(b.expr); if (b.param) params.push(b.param);
  }
  const body = cols.length ? `(${cols.join(', ')}) ${m.pk.length ? 'OUTPUT {OUT} ' : ''}VALUES (${exprs.join(', ')})` : `${m.pk.length ? 'OUTPUT {OUT} ' : ''}DEFAULT VALUES`;
  if (!m.pk.length) { await run(cid, `INSERT INTO ${fq(m)} ${body.replace('{OUT} ', '')}`, params); return { key: null, row: null }; }
  // OUTPUT ... INTO a table variable works even when the table has triggers
  const pkCols = m.pk.map((k) => m.columns.find((c) => c.name === k));
  const decl = pkCols.map((c) => `${qi(c.name)} ${typeText(c)}`).join(', ');
  const out = `inserted.${pkCols.map((c) => qi(c.name)).join(', inserted.')} INTO @o`;
  const sel = pkCols.map((c) => `${colExpr(c, 'full')} AS ${qi(c.name)}`).join(', ');
  const rec = (await run(cid, `DECLARE @o TABLE (${decl}); INSERT INTO ${fq(m)} ${body.replace('{OUT}', out)}; SELECT ${sel} FROM @o;`, params))[0];
  const key = rec ? keyOf(m, rec) : null;
  return { key, row: key ? await getByPk(cid, m, key) : null };
}
export async function updateRecord(cid, m, pk, values) {
  noUnknown(m, values); const sets = []; const params = [];
  for (const c of m.columns) {
    if (!editable(c) || c.pk || !(c.name in values)) continue;
    if (!c.nullable && (values[c.name] === null)) throw bad(`${c.name} cannot be empty`);
    const b = bind(c, values[c.name], params.length); sets.push(`${qi(c.name)} = ${b.expr}`); if (b.param) params.push(b.param);
  }
  if (!sets.length) throw bad('Nothing to change');
  const w = pkWhere(m, pk, params.length);
  const r = await run(cid, `UPDATE ${fq(m)} SET ${sets.join(', ')} WHERE ${w.sql}; SELECT @@ROWCOUNT AS n`, [...params, ...w.params]);
  if (!r[0].n) throw Object.assign(new Error('Row not found (deleted meanwhile?)'), { statusCode: 404 });
  return getByPk(cid, m, pk);
}
export async function deleteRecord(cid, m, pk) {
  const w = pkWhere(m, pk);
  const r = await run(cid, `DELETE FROM ${fq(m)} WHERE ${w.sql}; SELECT @@ROWCOUNT AS n`, w.params);
  if (!r[0].n) throw Object.assign(new Error('Row not found (deleted meanwhile?)'), { statusCode: 404 });
  return { deleted: true };
}

// lookup values for foreign-key dropdowns
export async function lookup(cid, ref, labelCol, { q = '', value }) {
  const key = qi(ref.column); const lab = labelCol ? qi(labelCol) : null; const params = []; let where = '';
  if (value !== undefined && value !== null && value !== '') { params.push({ name: 'v', type: sql.NVarChar(200), value: String(value) }); where = `WHERE CAST(${key} AS nvarchar(200)) = @v`; }
  else if (q) { params.push({ name: 'q', type: sql.NVarChar(300), value: `%${String(q).replace(/[\\%_[]/g, '\\$&')}%` }); where = `WHERE CAST(${key} AS nvarchar(200)) LIKE @q ESCAPE '\\'${lab ? ` OR ${lab} LIKE @q ESCAPE '\\'` : ''}`; }
  const rows = await run(cid, `SELECT TOP 50 CAST(${key} AS nvarchar(200)) AS value${lab ? `, ${lab} AS label` : ''} FROM ${qi(ref.schema)}.${qi(ref.table)} ${where} ORDER BY ${lab || key}`, params);
  return rows.map((r) => ({ value: r.value, label: r.label ? `${r.label} (${r.value})` : r.value }));
}
