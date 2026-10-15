// Read-only discovery on a SQL Server connection: tables, keys, columns, FK order, schema comparison and DDL generation.
import { q } from './db.js';

const qi = (s) => `[${String(s).replace(/]/g, ']]')}]`;
export const fq = (s, t) => `${qi(s)}.${qi(t)}`;

export async function listTables(cid) {
  const rows = await q(cid, `
    SELECT s.name AS [schema], t.name AS [table],
      (SELECT ISNULL(SUM(p.rows),0) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id < 2) AS row_count,
      CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i WHERE i.object_id = t.object_id AND i.is_primary_key = 1) THEN 1 ELSE 0 END AS has_pk,
      (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS columns,
      (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id AND c.is_computed = 1) AS computed,
      (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id AND c.is_identity = 1) AS identities,
      (SELECT COUNT(*) FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id WHERE c.object_id = t.object_id AND ty.name = 'timestamp') AS rowversion_cols,
      (SELECT COUNT(*) FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id WHERE c.object_id = t.object_id
         AND (ty.name IN ('text','ntext','image','xml','geography','geometry','hierarchyid','sql_variant') OR (ty.name IN ('varchar','nvarchar','varbinary') AND c.max_length = -1))) AS lob_columns,
      (SELECT COUNT(*) FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id WHERE c.object_id = t.object_id AND ty.name = 'hierarchyid') AS hier_cols,
      (SELECT COUNT(*) FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id WHERE c.object_id = t.object_id AND ty.name IN ('geography','geometry')) AS spatial_cols,
      (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id AND c.xml_collection_id <> 0) AS typed_xml_cols,
      (SELECT COUNT(*) FROM sys.triggers tr WHERE tr.parent_id = t.object_id AND tr.name NOT LIKE 'SYM[_]ON[_]%' AND tr.is_disabled = 0) AS user_triggers
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0 AND t.name NOT LIKE 'sym[_]%' AND t.name <> 'sysdiagrams'
    ORDER BY s.name, t.name`);
  return rows.map((r) => {
    const blocked = [];
    if (!r.has_pk) blocked.push('no primary key (SymmetricDS needs one to identify rows)');
    if (r.rowversion_cols) blocked.push('has a rowversion/timestamp column (cannot be copied)');
    const warnings = [];
    if (r.lob_columns) warnings.push(`${r.lob_columns} large-object column(s): slower initial load`);
    if (r.computed) warnings.push(`${r.computed} computed column(s): recomputed on the target`);
    if (r.hier_cols) warnings.push(`${r.hier_cols} hierarchyid column(s): copied`);
    if (r.spatial_cols) warnings.push(`${r.spatial_cols} geography/geometry column(s) are NOT copied (SymmetricDS cannot transport them): the rest of the table is synced, the column stays empty on the target`);
    if (r.typed_xml_cols) warnings.push(`${r.typed_xml_cols} typed XML column(s): created as plain xml on a new target table (the XML schema collection is not copied)`);
    if (r.user_triggers) warnings.push(`${r.user_triggers} trigger(s): disable them on the target (option in step 4)`);
    return { schema: r.schema, table: r.table, name: `${r.schema}.${r.table}`, rows: Number(r.row_count), hasPk: !!r.has_pk, columns: r.columns,
             computed: r.computed, identities: r.identities, lob: r.lob_columns, spatial: r.spatial_cols, hier: r.hier_cols, typedXml: r.typed_xml_cols, userTriggers: r.user_triggers, blocked, warnings };
  });
}

// Order tables so parents come before children (initial_load_order). Cycles / self references do not block, they are appended.
export async function loadOrder(cid, names) {
  const fks = await q(cid, `SELECT OBJECT_SCHEMA_NAME(fk.parent_object_id) + '.' + OBJECT_NAME(fk.parent_object_id) AS child,
      OBJECT_SCHEMA_NAME(fk.referenced_object_id) + '.' + OBJECT_NAME(fk.referenced_object_id) AS parent FROM sys.foreign_keys fk`);
  const set = new Set(names);
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const f of fks) if (set.has(f.child) && set.has(f.parent) && f.child !== f.parent) deps.get(f.child).add(f.parent);
  const out = []; const left = new Set(names);
  while (left.size) {
    const ready = [...left].filter((n) => [...deps.get(n)].every((d) => !left.has(d))).sort();
    if (!ready.length) { out.push(...[...left].sort()); break; }   // cycle: keep going
    for (const n of ready) { out.push(n); left.delete(n); }
  }
  return out;
}

export async function tableColumns(cid, schema, table) {
  const full = fq(schema, table);
  const cols = await q(cid, `
    SELECT c.column_id, c.name, COALESCE(bt.name, ty.name) AS type, ty.is_user_defined AS is_alias, ty.is_assembly_type AS is_assembly, SCHEMA_NAME(ty.schema_id) AS type_schema, ty.name AS type_name, c.xml_collection_id, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed,
           CAST(ic.seed_value AS bigint) AS seed, CAST(ic.increment_value AS bigint) AS inc,
           cc.definition AS computed_def, cc.is_persisted AS computed_persisted, dc.definition AS default_def
    FROM sys.columns c
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.types bt ON bt.user_type_id = ty.system_type_id   -- LEFT: CLR types (hierarchyid, geography, geometry) have no base row
    LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
    LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
    WHERE c.object_id = OBJECT_ID(@t) ORDER BY c.column_id`, { t: full });
  const pk = await q(cid, `SELECT c.name, ic.is_descending_key AS desc_ FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID(@t) AND i.is_primary_key = 1 ORDER BY ic.key_ordinal`, { t: full });
  return { columns: cols, pk };
}

export const SPATIAL = ['geography', 'geometry'];
// columns SymmetricDS cannot transport: they are excluded from the sync (left NULL on the target)
export async function spatialColumns(cid, schema, table) { return (await tableColumns(cid, schema, table)).columns.filter((c) => SPATIAL.includes(c.type)).map((c) => c.name); }

export function typeText(c) {
  const t = c.type;
  if (['char', 'varchar', 'binary', 'varbinary'].includes(t)) return `${t}(${c.max_length === -1 ? 'max' : c.max_length})`;
  if (['nchar', 'nvarchar'].includes(t)) return `${t}(${c.max_length === -1 ? 'max' : c.max_length / 2})`;
  if (['decimal', 'numeric'].includes(t)) return `${t}(${c.precision},${c.scale})`;
  if (['datetime2', 'time', 'datetimeoffset'].includes(t)) return `${t}(${c.scale})`;
  if (t === 'timestamp') return 'rowversion';
  if (t === 'xml') return 'xml';   // typed XML is compared/created as plain xml (schema collection is not copied)
  return t;
}

export function createTableSql(schema, table, info) {
  const lines = info.columns.map((c) => {
    if (c.is_computed) return `  ${qi(c.name)} AS ${c.computed_def}${c.computed_persisted ? ' PERSISTED' : ''}`;
    let s = `  ${qi(c.name)} ${c.is_alias && !c.is_assembly ? fq(c.type_schema, c.type_name) : typeText(c)}`;   // alias types (dbo.Name ...) are created on the target first
    if (c.is_identity) s += ` IDENTITY(${c.seed ?? 1},${c.inc ?? 1})`;
    s += c.is_nullable || SPATIAL.includes(c.type) ? ' NULL' : ' NOT NULL';   // spatial columns are not copied, so they must allow NULL
    if (c.default_def) s += ` DEFAULT ${c.default_def}`;
    return s;
  });
  if (info.pk.length) lines.push(`  CONSTRAINT ${qi('PK_' + table)} PRIMARY KEY (${info.pk.map((p) => qi(p.name) + (p.desc_ ? ' DESC' : '')).join(', ')})`);
  return `${schema === 'dbo' ? '' : `IF SCHEMA_ID(N'${schema.replace(/'/g, "''")}') IS NULL EXEC(N'CREATE SCHEMA ${qi(schema).replace(/'/g, "''")}');\n`}CREATE TABLE ${fq(schema, table)} (\n${lines.join(',\n')}\n);`;
}

// Compare chosen tables of source against the target. Returns per table: missing | ok | mismatch (+ details) and the DDL for missing ones.
export async function compareSchema(srcCid, tgtCid, tables) {
  const out = [];
  for (const t of tables) {
    const [schema, ...rest] = t.split('.'); const table = rest.join('.');
    const src = await tableColumns(srcCid, schema, table);
    const exists = (await q(tgtCid, 'SELECT OBJECT_ID(@t) AS id', { t: fq(schema, table) }))[0].id;
    if (!exists) { out.push({ table: t, status: 'missing', ddl: createTableSql(schema, table, src) }); continue; }
    const tgt = await tableColumns(tgtCid, schema, table);
    const tmap = new Map(tgt.columns.map((c) => [c.name.toLowerCase(), c]));
    const missingCols = []; const typeDiff = [];
    for (const c of src.columns) {
      const o = tmap.get(c.name.toLowerCase());
      if (!o) { missingCols.push(c.name); continue; }
      if (!c.is_computed && !o.is_computed && typeText(c) !== typeText(o)) typeDiff.push(`${c.name}: source ${typeText(c)}, target ${typeText(o)}`);
    }
    out.push({ table: t, status: missingCols.length || typeDiff.length ? 'mismatch' : 'ok', missingCols, typeDiff });
  }
  return out;
}

export async function userTriggers(cid, tables) {
  const found = [];
  for (const t of tables) {
    const [schema, ...rest] = t.split('.'); const table = rest.join('.');
    const r = await q(cid, `SELECT SCHEMA_NAME(o.schema_id) AS s, tr.name AS n FROM sys.triggers tr JOIN sys.objects o ON o.object_id = tr.object_id
      WHERE tr.parent_id = OBJECT_ID(@t) AND tr.name NOT LIKE 'SYM[_]ON[_]%' AND tr.is_disabled = 0`, { t: fq(schema, table) });
    for (const x of r) found.push({ table: t, schema: x.s, trigger: x.n });
  }
  return found;
}
