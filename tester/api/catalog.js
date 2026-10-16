// Catalog discovery (sys.* views). Names coming from the client are only accepted when they exist here.
import { run, sql } from './db.js';

export const qi = (n) => `[${String(n).replace(/]/g, ']]')}]`;
export const fq = (m) => `${qi(m.schema)}.${qi(m.table)}`;
const SPATIAL = ['geography', 'geometry'];
export const isSpatial = (c) => SPATIAL.includes(c.type);

export function typeText(c) {
  const t = c.type;
  if (['char', 'varchar', 'binary', 'varbinary'].includes(t)) return `${t}(${c.maxLength === -1 ? 'max' : c.rawLength})`;
  if (['nchar', 'nvarchar'].includes(t)) return `${t}(${c.maxLength === -1 ? 'max' : c.maxLength})`;
  if (['decimal', 'numeric'].includes(t)) return `${t}(${c.precision},${c.scale})`;
  if (['datetime2', 'time', 'datetimeoffset'].includes(t)) return `${t}(${c.scale})`;
  if (t === 'timestamp') return 'binary(8)';
  return t;
}

export async function tableList(cid) {
  const rows = await run(cid, `SELECT s.name AS [schema], t.name AS [table],
      (SELECT ISNULL(SUM(p.rows), 0) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id < 2) AS row_count,
      CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i WHERE i.object_id = t.object_id AND i.is_primary_key = 1) THEN 1 ELSE 0 END AS has_pk
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0 AND t.name NOT LIKE 'sym[_]%' AND t.name <> 'sysdiagrams' ORDER BY s.name, t.name`);
  return rows.map((r) => ({ schema: r.schema, table: r.table, rows: Number(r.row_count), hasPk: !!r.has_pk }));
}

// tables that SymmetricDS really replicates, with the columns it does not copy
export async function replicatedMap(srcCid) {
  try {
    const rows = await run(srcCid, `SELECT t.source_schema_name AS s, t.source_table_name AS n, t.excluded_column_names AS ex
      FROM sym_trigger t JOIN sym_trigger_router r ON r.trigger_id = t.trigger_id WHERE r.enabled = 1`);
    return new Map(rows.map((r) => [`${r.s}.${r.n}`, { excluded: (r.ex || '').split(',').map((x) => x.trim()).filter(Boolean) }]));
  } catch { return new Map(); }     // no sym_ tables (yet)
}

const cache = new Map();
export async function tableMeta(cid, schema, table) {
  const key = `${cid}|${schema}|${table}`; const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15000) return hit.meta;
  const t = (await run(cid, `SELECT t.object_id AS id FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = @s AND t.name = @t AND t.is_ms_shipped = 0 AND t.name NOT LIKE 'sym[_]%'`,
    [{ name: 's', type: sql.NVarChar(128), value: schema }, { name: 't', type: sql.NVarChar(128), value: table }]))[0];
  if (!t) return null;
  const idp = [{ name: 'id', type: sql.Int, value: t.id }];
  const cols = await run(cid, `SELECT c.column_id, c.name, COALESCE(bt.name, ty.name) AS type, ty.name AS declared, ty.is_user_defined AS is_alias, c.max_length, c.precision, c.scale,
      c.is_nullable, c.is_identity, c.is_computed, dc.definition AS default_def
    FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id LEFT JOIN sys.types bt ON bt.user_type_id = ty.system_type_id
    LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
    WHERE c.object_id = @id ORDER BY c.column_id`, idp);
  const pk = (await run(cid, `SELECT c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id WHERE i.object_id = @id AND i.is_primary_key = 1 ORDER BY ic.key_ordinal`, idp)).map((r) => r.name);
  const fks = await run(cid, `SELECT pc.name AS col, SCHEMA_NAME(rt.schema_id) AS rs, rt.name AS rt, rc.name AS rcol, rt.object_id AS rid
    FROM sys.foreign_key_columns fkc JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
    JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
    WHERE fkc.parent_object_id = @id AND (SELECT COUNT(*) FROM sys.foreign_key_columns x WHERE x.constraint_object_id = fkc.constraint_object_id) = 1`, idp);
  const fkInfo = {};
  for (const f of fks) {
    const lab = (await run(cid, `SELECT TOP 1 c.name FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id LEFT JOIN sys.types bt ON bt.user_type_id = ty.system_type_id
      WHERE c.object_id = @id AND c.is_computed = 0 AND bt.name IN ('varchar','nvarchar','char','nchar') AND c.max_length BETWEEN 1 AND 400
      ORDER BY CASE WHEN c.name LIKE '%Name%' OR c.name LIKE '%Title%' OR c.name LIKE '%Description%' OR c.name LIKE '%Label%' THEN 0 ELSE 1 END, c.column_id`, [{ name: 'id', type: sql.Int, value: f.rid }]))[0];
    fkInfo[f.col] = { schema: f.rs, table: f.rt, column: f.rcol, labelColumn: lab?.name || null };
  }
  const columns = cols.map((c) => {
    const nchar = ['nchar', 'nvarchar'].includes(c.type);
    const rowversion = c.type === 'timestamp';
    return { name: c.name, type: c.type, declared: c.declared, alias: !!c.is_alias, rawLength: c.max_length, maxLength: c.max_length === -1 ? -1 : (nchar ? c.max_length / 2 : c.max_length),
      precision: c.precision, scale: c.scale, nullable: !!c.is_nullable, identity: !!c.is_identity, computed: !!c.is_computed, rowversion, hasDefault: !!c.default_def, defaultDef: c.default_def || null,
      auto: !!c.is_identity || !!c.is_computed || rowversion, pk: pk.includes(c.name), fk: fkInfo[c.name] || null };
  });
  const meta = { schema, table, objectId: t.id, columns, pk };
  cache.set(key, { at: Date.now(), meta });
  return meta;
}
