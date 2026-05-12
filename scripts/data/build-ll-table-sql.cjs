#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-dataset-google-sheets.json');

const PRIMARY_KEYS = Object.freeze({
  ll_source_imports: 'import_id',
  ll_etl_runs: 'run_id',
  ll_funds: 'fund_id',
  ll_assets: 'asset_id',
  ll_tenants: 'tenant_id',
  ll_leases: 'lease_id',
  ll_lease_spaces: 'lease_space_id',
  ll_area_breakdowns: 'area_breakdown_id',
  ll_rent_history: 'history_event_id',
  ll_asset_managers: 'asset_manager_id',
  ll_field_dictionary: 'field_id',
  ll_issues: 'issue_id',
  ll_quality_checks: 'quality_check_id',
  ll_source_sheets: 'sheet_id',
  ll_source_columns: 'column_uid',
  ll_source_rows: 'row_uid',
  ll_source_cells: 'cell_id',
  ll_source_diffs: 'diff_id',
  ll_normalization_links: 'link_id',
  ll_user_permissions: 'permission_id',
  ll_edit_sessions: 'edit_session_id',
  ll_cell_edits: 'edit_id',
  ll_delete_markers: 'delete_marker_id',
  ll_payload_snapshots: 'snapshot_key',
});

const SOURCE_PAYLOAD_TABLES = new Set([
  'll_funds',
  'll_assets',
  'll_tenants',
  'll_leases',
  'll_lease_spaces',
  'll_area_breakdowns',
  'll_rent_history',
  'll_asset_managers',
  'll_field_dictionary',
  'll_issues',
  'll_quality_checks',
]);

const COMPACT_COLUMNS = Object.freeze({
  ll_tenants: [
    'tenant_id',
    'tenant_master_name',
    'raw_tenant_name',
    'is_active',
    'review_status',
    'last_etl_run_id',
    'source_system',
    'source_table',
    'source_pk',
    'source_ref',
    'source_row_hash',
    'source_payload',
  ],
  ll_leases: [
    'lease_id',
    'asset_id',
    'tenant_id',
    'lease_status',
    'start_date',
    'end_date',
    'is_active',
    'review_status',
    'last_etl_run_id',
    'source_system',
    'source_table',
    'source_pk',
    'source_ref',
    'source_row_hash',
    'source_payload',
  ],
  ll_lease_spaces: [
    'lease_space_id',
    'lease_id',
    'asset_id',
    'tenant_id',
    'floor_label',
    'detail_area_label',
    'temperature_type',
    'leased_area_sqm',
    'exclusive_area_sqm',
    'current_monthly_rent_total',
    'current_monthly_mf_total',
    'current_monthly_cost_total',
    'is_active',
    'review_status',
    'last_etl_run_id',
    'source_system',
    'source_table',
    'source_pk',
    'source_ref',
    'source_row_hash',
    'source_payload',
  ],
  ll_rent_history: [
    'history_event_id',
    'lease_space_id',
    'lease_id',
    'asset_id',
    'tenant_id',
    'effective_date',
    'leased_area_sqm',
    'rent_per_py',
    'mf_per_py',
    'monthly_rent_total',
    'monthly_mf_total',
    'is_latest',
    'last_etl_run_id',
    'source_system',
    'source_table',
    'source_pk',
    'source_ref',
    'source_row_hash',
    'source_payload',
  ],
  ll_issues: [
    'issue_id',
    'entity_type',
    'entity_id',
    'asset_id',
    'tenant_id',
    'issue_type',
    'severity',
    'title',
    'status',
    'last_etl_run_id',
    'source_system',
    'source_table',
    'source_pk',
    'source_ref',
    'source_row_hash',
    'source_payload',
  ],
  ll_payload_snapshots: [
    'snapshot_key',
    'page',
    'entity_id',
    'payload',
    'user_safe',
    'generated_at',
    'schema_version',
    'source',
    'source_system',
  ],
});

const RESET_ORDER = Object.freeze([
  'll_payload_snapshots',
  'll_source_diffs',
  'll_source_cells',
  'll_source_rows',
  'll_source_columns',
  'll_source_sheets',
  'll_source_imports',
  'll_cell_edits',
  'll_edit_sessions',
  'll_user_permissions',
  'll_delete_markers',
  'll_normalization_links',
  'll_quality_checks',
  'll_issues',
  'll_rent_history',
  'll_area_breakdowns',
  'll_lease_spaces',
  'll_leases',
  'll_asset_managers',
  'll_field_dictionary',
  'll_tenants',
  'll_assets',
  'll_funds',
  'll_etl_runs',
]);

function parseArgs(argv) {
  const args = { input: DEFAULT_INPUT, table: '', reset: false, chunkSize: 0, chunkIndex: null, listChunks: false, base64: false, compact: false, values: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index] || args.input;
    else if (arg.startsWith('--input=')) args.input = arg.slice('--input='.length);
    else if (arg === '--table') args.table = argv[++index] || '';
    else if (arg.startsWith('--table=')) args.table = arg.slice('--table='.length);
    else if (arg === '--reset') args.reset = true;
    else if (arg === '--chunk-size') args.chunkSize = Number(argv[++index] || 0);
    else if (arg.startsWith('--chunk-size=')) args.chunkSize = Number(arg.slice('--chunk-size='.length));
    else if (arg === '--chunk-index') args.chunkIndex = Number(argv[++index] || 0);
    else if (arg.startsWith('--chunk-index=')) args.chunkIndex = Number(arg.slice('--chunk-index='.length));
    else if (arg === '--list-chunks') args.listChunks = true;
    else if (arg === '--base64') args.base64 = true;
    else if (arg === '--compact') args.compact = true;
    else if (arg === '--values') args.values = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (args.chunkSize && (!Number.isInteger(args.chunkSize) || args.chunkSize < 1)) {
    throw new Error('--chunk-size must be a positive integer.');
  }
  if (args.chunkIndex != null && (!Number.isInteger(args.chunkIndex) || args.chunkIndex < 0)) {
    throw new Error('--chunk-index must be a zero-based integer.');
  }
  return args;
}

function quoteIdent(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function columnsForRows(tableName, rows, compact) {
  if (compact) {
    if (!COMPACT_COLUMNS[tableName]) throw new Error('--compact is not supported for table: ' + tableName);
    return COMPACT_COLUMNS[tableName];
  }
  return [...new Set(rows.flatMap((row) => Object.keys(row)).concat(SOURCE_PAYLOAD_TABLES.has(tableName) ? ['source_payload'] : []))]
    .filter((column) => column !== 'created_at' && column !== 'updated_at');
}

function projectRowsForColumns(rows, columns) {
  return rows.map((row) => {
    const next = {};
    columns.forEach((column) => {
      if (Object.prototype.hasOwnProperty.call(row, column)) next[column] = row[column];
    });
    return next;
  });
}

function sqlForRows(tableName, rows, options = {}) {
  if (!PRIMARY_KEYS[tableName]) throw new Error('Unsupported table: ' + tableName);
  if (!rows.length) return `-- ${tableName}: no rows\n`;
  const pk = PRIMARY_KEYS[tableName];
  const columns = columnsForRows(tableName, rows, options.compact);
  if (!columns.includes(pk)) throw new Error(tableName + ' missing primary key in row set.');
  const preparedRows = projectRowsForColumns(rows, columns);
  const columnList = columns.map(quoteIdent).join(', ');
  const selectList = columns.map(quoteIdent).join(', ');
  const updateColumns = columns.filter((column) => column !== pk);
  const updateSql = updateColumns.length
    ? ' do update set ' + updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(', ')
    : ' do nothing';
  const json = JSON.stringify(preparedRows);
  if (json.includes('$lljson$')) throw new Error('JSON contains reserved dollar quote tag.');
  return [
    `insert into public.${quoteIdent(tableName)} (${columnList})`,
    `select ${selectList}`,
    `from jsonb_populate_recordset(null::public.${quoteIdent(tableName)}, $lljson$${json}$lljson$::jsonb) as row_data`,
    `on conflict (${quoteIdent(pk)})${updateSql};`,
    '',
  ].join('\n');
}

function sqlForRowsBase64(tableName, rows, options = {}) {
  if (!PRIMARY_KEYS[tableName]) throw new Error('Unsupported table: ' + tableName);
  if (!rows.length) return `-- ${tableName}: no rows\n`;
  const pk = PRIMARY_KEYS[tableName];
  const columns = columnsForRows(tableName, rows, options.compact);
  if (!columns.includes(pk)) throw new Error(tableName + ' missing primary key in row set.');
  const preparedRows = projectRowsForColumns(rows, columns);
  const columnList = columns.join(', ');
  const selectList = columns.join(', ');
  const updateColumns = columns.filter((column) => column !== pk);
  const updateSql = updateColumns.length
    ? ' do update set ' + updateColumns.map((column) => `${column} = excluded.${column}`).join(', ')
    : ' do nothing';
  const encoded = Buffer.from(JSON.stringify(preparedRows), 'utf8').toString('base64');
  return [
    `insert into public.${tableName} (${columnList})`,
    `select ${selectList}`,
    `from jsonb_populate_recordset(null::public.${tableName}, convert_from(decode('${encoded}', 'base64'), 'utf8')::jsonb) as row_data`,
    `on conflict (${pk})${updateSql};`,
    '',
  ].join(' ');
}

function sqlLiteral(value) {
  if (value === null || value === undefined || value === '') return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    return "'" + JSON.stringify(value).replace(/'/g, "''") + "'::jsonb";
  }
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function sqlForRowsValues(tableName, rows, options = {}) {
  if (!PRIMARY_KEYS[tableName]) throw new Error('Unsupported table: ' + tableName);
  if (!rows.length) return `-- ${tableName}: no rows\n`;
  const pk = PRIMARY_KEYS[tableName];
  const columns = columnsForRows(tableName, rows, options.compact);
  if (!columns.includes(pk)) throw new Error(tableName + ' missing primary key in row set.');
  const preparedRows = rows.map((row) => {
    const next = {};
    columns.forEach((column) => {
      if (Object.prototype.hasOwnProperty.call(row, column)) next[column] = row[column];
    });
    return next;
  });
  const columnList = columns.map(quoteIdent).join(', ');
  const updateColumns = columns.filter((column) => column !== pk);
  const updateSql = updateColumns.length
    ? ' do update set ' + updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(', ')
    : ' do nothing';
  function valueForColumn(row, column) {
    return sqlLiteral(row[column]);
  }
  return [
    `insert into public.${quoteIdent(tableName)} (${columnList}) values`,
    preparedRows.map((row) => `  (${columns.map((column) => valueForColumn(row, column)).join(', ')})`).join(',\n'),
    `on conflict (${quoteIdent(pk)})${updateSql};`,
    '',
  ].join('\n');
}

function resetSql() {
  return [
    'begin;',
    ...RESET_ORDER.map((tableName) => `delete from public.${quoteIdent(tableName)} where ${quoteIdent(PRIMARY_KEYS[tableName])} is not null;`),
    'commit;',
    '',
  ].join('\n');
}

function sourceRowNumber(sourceRef) {
  const match = String(sourceRef || '').match(/!(\d+)$/);
  return match ? match[1] : '';
}

function safeIdPart(value) {
  const normalized = String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'unknown';
}

function replaceIdPrefix(value, oldId, newId) {
  if (typeof value !== 'string') return value;
  if (value === oldId) return newId;
  if (value.startsWith(oldId + '|')) return newId + value.slice(oldId.length);
  return value;
}

function cloneJson(value) {
  if (!value || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function applyDuplicateLeaseSpaceIds(tables) {
  const leaseSpaces = Array.isArray(tables.ll_lease_spaces) ? tables.ll_lease_spaces : [];
  const groups = new Map();
  leaseSpaces.forEach((row) => {
    const id = row.lease_space_id;
    if (!id) return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  });
  const duplicateGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  if (!duplicateGroups.length) return tables;

  const bySourceRef = new Map();
  const disambiguatedRowsByOldId = new Map();
  duplicateGroups.forEach(([oldId, rows]) => {
    rows.forEach((row, index) => {
      const rowNo = sourceRowNumber(row.source_ref) || String(index + 1);
      const suffix = `temp_${safeIdPart(row.temperature_type)}_row${rowNo}`;
      const newId = `${oldId}|${suffix}`;
      bySourceRef.set(`${oldId}|${row.source_ref || ''}`, newId);
      if (!disambiguatedRowsByOldId.has(oldId)) disambiguatedRowsByOldId.set(oldId, []);
      disambiguatedRowsByOldId.get(oldId).push({
        newId,
        leasedArea: Number(row.leased_area_sqm),
      });
      row.lease_space_id = newId;
    });
  });

  (tables.ll_rent_history || []).forEach((row) => {
    const candidates = disambiguatedRowsByOldId.get(row.lease_space_id);
    if (!candidates || !candidates.length) return;
    const area = Number(row.leased_area_sqm);
    const selected = candidates
      .map((candidate) => ({ candidate, diff: Math.abs(Number(candidate.leasedArea) - area) }))
      .sort((left, right) => left.diff - right.diff)[0];
    if (!selected || !Number.isFinite(selected.diff)) return;
    const oldId = row.lease_space_id;
    const newId = selected.candidate.newId;
    row.lease_space_id = newId;
    row.history_event_id = replaceIdPrefix(row.history_event_id, oldId, newId);
    row.source_pk = replaceIdPrefix(row.source_pk, oldId, newId);
    row.source_payload = cloneJson(row.source_payload);
    if (row.source_payload && row.source_payload.source) {
      row.source_payload.source.pk = replaceIdPrefix(row.source_payload.source.pk, oldId, newId);
    }
  });

  (tables.ll_normalization_links || []).forEach((row) => {
    if (row.target_table !== 'll_lease_spaces') return;
    const newId = bySourceRef.get(`${row.target_pk}|${row.source_ref || ''}`);
    if (newId) row.target_pk = newId;
  });

  return tables;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.reset) {
    process.stdout.write(resetSql());
    return;
  }
  if (!args.table) throw new Error('--table is required unless --reset is used.');
  const dataset = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  applyDuplicateLeaseSpaceIds(dataset.tables || {});
  const allRows = (dataset.tables && dataset.tables[args.table]) || [];
  if (args.listChunks) {
    const chunkSize = args.chunkSize || allRows.length || 1;
    process.stdout.write(JSON.stringify({
      table: args.table,
      rowCount: allRows.length,
      chunkSize,
      chunkCount: Math.ceil(allRows.length / chunkSize),
    }, null, 2) + '\n');
    return;
  }
  const rows = args.chunkSize
    ? allRows.slice((args.chunkIndex || 0) * args.chunkSize, ((args.chunkIndex || 0) + 1) * args.chunkSize)
    : allRows;
  const options = { compact: args.compact };
  if (args.values) {
    process.stdout.write(sqlForRowsValues(args.table, rows, options));
  } else {
    process.stdout.write(args.base64 ? sqlForRowsBase64(args.table, rows, options) : sqlForRows(args.table, rows, options));
  }
}

main();
