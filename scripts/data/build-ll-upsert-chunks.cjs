#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-dataset-xlsx-source.json');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'qa-artifacts', 'supabase', 'sql-chunks');
const DEFAULT_MAX_BYTES = 750 * 1024;

const TABLE_ORDER = Object.freeze([
  'll_etl_runs',
  'll_source_imports',
  'll_source_sheets',
  'll_source_columns',
  'll_source_rows',
  'll_source_cells',
  'll_funds',
  'll_assets',
  'll_tenants',
  'll_leases',
  'll_lease_spaces',
  'll_area_breakdowns',
  'll_rent_history',
  'll_asset_managers',
  'll_user_permissions',
  'll_staff_profiles',
  'll_fund_beneficiaries',
  'll_fund_lenders',
  'll_login_history',
  'll_field_dictionary',
  'll_issues',
  'll_quality_checks',
  'll_normalization_links',
  'll_payload_snapshots',
]);

const PRIMARY_KEYS = Object.freeze({
  ll_etl_runs: 'run_id',
  ll_source_imports: 'import_id',
  ll_source_sheets: 'sheet_id',
  ll_source_columns: 'column_uid',
  ll_source_rows: 'row_uid',
  ll_source_cells: 'cell_id',
  ll_funds: 'fund_id',
  ll_assets: 'asset_id',
  ll_tenants: 'tenant_id',
  ll_leases: 'lease_id',
  ll_lease_spaces: 'lease_space_id',
  ll_area_breakdowns: 'area_breakdown_id',
  ll_rent_history: 'history_event_id',
  ll_asset_managers: 'asset_manager_id',
  ll_user_permissions: 'permission_id',
  ll_staff_profiles: 'staff_id',
  ll_fund_beneficiaries: 'beneficiary_id',
  ll_fund_lenders: 'lender_id',
  ll_login_history: 'login_event_id',
  ll_field_dictionary: 'field_id',
  ll_issues: 'issue_id',
  ll_quality_checks: 'quality_check_id',
  ll_normalization_links: 'link_id',
  ll_payload_snapshots: 'snapshot_key',
});

const FORBIDDEN_MARKERS = Object.freeze([
  'public.funds',
  'asset_master',
  'existing_public_tables',
]);

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    outputDir: DEFAULT_OUTPUT_DIR,
    maxBytes: DEFAULT_MAX_BYTES,
    dryRun: false,
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index] || args.input;
    else if (arg.startsWith('--input=')) args.input = arg.slice('--input='.length);
    else if (arg === '--output-dir') args.outputDir = argv[++index] || args.outputDir;
    else if (arg.startsWith('--output-dir=')) args.outputDir = arg.slice('--output-dir='.length);
    else if (arg === '--max-bytes') args.maxBytes = Number(argv[++index] || 0);
    else if (arg.startsWith('--max-bytes=')) args.maxBytes = Number(arg.slice('--max-bytes='.length));
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }

  if (args.help) return args;
  if (args.dryRun === args.write) throw new Error('Choose exactly one mode: --dry-run or --write.');
  if (!Number.isInteger(args.maxBytes) || args.maxBytes < 4096) {
    throw new Error('--max-bytes must be an integer of at least 4096.');
  }
  args.input = path.resolve(ROOT, args.input);
  args.outputDir = path.resolve(ROOT, args.outputDir);
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/data/build-ll-upsert-chunks.cjs --dry-run [--input <json>] [--max-bytes <bytes>]',
    '  node scripts/data/build-ll-upsert-chunks.cjs --write [--input <json>] [--output-dir <dir>] [--max-bytes <bytes>]',
    '',
    'The generated SQL is upsert-only. It never emits reset, delete, or truncate statements.',
    '',
  ].join('\n');
}

function quoteIdent(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function hasOwn(row, key) {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function loadDataset(inputPath) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const lowerRaw = raw.toLowerCase();
  const marker = FORBIDDEN_MARKERS.find((entry) => lowerRaw.includes(entry.toLowerCase()));
  if (marker) throw new Error('Forbidden marker found in input JSON: ' + marker);
  return JSON.parse(raw);
}

function assertDatasetSafety(dataset) {
  const tables = dataset && dataset.tables;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    throw new Error('Input JSON must contain a tables object.');
  }

  const tableNames = Object.keys(tables);
  const unknownTables = tableNames.filter((tableName) => {
    const rows = tables[tableName];
    return tableName.startsWith('ll_') && !TABLE_ORDER.includes(tableName) && Array.isArray(rows) && rows.length > 0;
  });
  if (unknownTables.length) {
    throw new Error('Unsupported ll_* table(s) found: ' + unknownTables.join(', '));
  }

  const sourceSystemErrors = [];
  for (const [tableName, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) throw new Error('Table is not an array: ' + tableName);
    rows.forEach((row, rowIndex) => {
      if (row && typeof row === 'object' && hasOwn(row, 'source_system') && row.source_system !== 'google_sheets') {
        sourceSystemErrors.push(`${tableName}[${rowIndex}].source_system=${JSON.stringify(row.source_system)}`);
      }
    });
  }
  if (sourceSystemErrors.length) {
    throw new Error('Only source_system=google_sheets is allowed. First violation: ' + sourceSystemErrors[0]);
  }
}

function columnsForRows(rows) {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))]
    .filter((column) => column !== 'created_at' && column !== 'updated_at');
}

function projectRowsForColumns(rows, columns) {
  return rows.map((row) => {
    const next = {};
    columns.forEach((column) => {
      if (hasOwn(row, column)) next[column] = row[column];
    });
    return next;
  });
}

function sqlForRows(tableName, rows) {
  if (!rows.length) return '';
  const pk = PRIMARY_KEYS[tableName];
  if (!pk) throw new Error('Unsupported table: ' + tableName);

  const columns = columnsForRows(rows);
  if (!columns.includes(pk)) throw new Error(tableName + ' chunk is missing primary key column: ' + pk);

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
    `-- upsert-only chunk for public.${tableName}; rows=${rows.length}`,
    `insert into public.${quoteIdent(tableName)} (${columnList})`,
    `select ${selectList}`,
    `from jsonb_populate_recordset(null::public.${quoteIdent(tableName)}, $lljson$${json}$lljson$::jsonb) as row_data`,
    `on conflict (${quoteIdent(pk)})${updateSql};`,
    '',
  ].join('\n');
}

function assertUpsertOnly(sql) {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
  const forbidden = /\b(delete\s+from|truncate\s+table|drop\s+table|alter\s+table|create\s+table|update\s+public\.)\b/i.exec(stripped);
  if (forbidden) throw new Error('Generated SQL contains forbidden statement: ' + forbidden[1]);
}

function nextChunkRows(tableName, rows, startIndex, maxBytes) {
  let low = 1;
  let high = rows.length - startIndex;
  let bestCount = 0;
  let bestSql = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const sql = sqlForRows(tableName, rows.slice(startIndex, startIndex + mid));
    const size = byteLength(sql);
    if (size <= maxBytes) {
      bestCount = mid;
      bestSql = sql;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (!bestCount) {
    const singleSql = sqlForRows(tableName, rows.slice(startIndex, startIndex + 1));
    throw new Error(`${tableName}[${startIndex}] is ${byteLength(singleSql)} bytes as a single-row chunk, exceeding --max-bytes=${maxBytes}.`);
  }

  return { count: bestCount, sql: bestSql };
}

function buildChunks(dataset, maxBytes) {
  const chunks = [];
  const tables = dataset.tables || {};
  let sequence = 1;

  TABLE_ORDER.forEach((tableName) => {
    const rows = tables[tableName] || [];
    let startIndex = 0;
    let tablePart = 1;
    while (startIndex < rows.length) {
      const chunk = nextChunkRows(tableName, rows, startIndex, maxBytes);
      assertUpsertOnly(chunk.sql);
      chunks.push({
        sequence,
        tableName,
        tablePart,
        startRow: startIndex,
        rowCount: chunk.count,
        bytes: byteLength(chunk.sql),
        sql: chunk.sql,
      });
      sequence += 1;
      tablePart += 1;
      startIndex += chunk.count;
    }
  });

  return chunks;
}

function fileNameForChunk(chunk) {
  const seq = String(chunk.sequence).padStart(3, '0');
  const part = String(chunk.tablePart).padStart(3, '0');
  return `${seq}_${chunk.tableName}_part${part}.sql`;
}

function writeChunks(outputDir, chunks) {
  fs.mkdirSync(outputDir, { recursive: true });
  chunks.forEach((chunk) => {
    fs.writeFileSync(path.join(outputDir, fileNameForChunk(chunk)), chunk.sql, 'utf8');
  });
}

function summarize(args, dataset, chunks) {
  const rowsByTable = {};
  TABLE_ORDER.forEach((tableName) => {
    rowsByTable[tableName] = (dataset.tables[tableName] || []).length;
  });
  const bytes = chunks.reduce((total, chunk) => total + chunk.bytes, 0);
  return {
    ok: true,
    mode: args.write ? 'write' : 'dry-run',
    writesPerformed: args.write,
    input: args.input,
    outputDir: args.outputDir,
    maxBytes: args.maxBytes,
    tableOrder: TABLE_ORDER,
    rowsByTable,
    chunkCount: chunks.length,
    totalSqlBytes: bytes,
    files: chunks.map((chunk) => ({
      file: fileNameForChunk(chunk),
      table: chunk.tableName,
      rows: chunk.rowCount,
      bytes: chunk.bytes,
    })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const dataset = loadDataset(args.input);
  assertDatasetSafety(dataset);
  const chunks = buildChunks(dataset, args.maxBytes);
  if (args.write) writeChunks(args.outputDir, chunks);
  process.stdout.write(JSON.stringify(summarize(args, dataset, chunks), null, 2) + '\n');
}

main();
