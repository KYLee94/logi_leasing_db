#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LL_TABLES = Object.freeze([
  'll_etl_runs',
  'll_funds',
  'll_assets',
  'll_tenants',
  'll_leases',
  'll_lease_spaces',
  'll_rent_history',
  'll_issues',
  'll_source_sheets',
  'll_source_columns',
  'll_source_rows',
  'll_normalization_links',
  'll_user_permissions',
  'll_edit_sessions',
  'll_cell_edits',
  'll_payload_snapshots',
]);

const PRIMARY_KEYS = Object.freeze({
  ll_etl_runs: 'run_id',
  ll_funds: 'fund_id',
  ll_assets: 'asset_id',
  ll_tenants: 'tenant_id',
  ll_leases: 'lease_id',
  ll_lease_spaces: 'lease_space_id',
  ll_rent_history: 'history_event_id',
  ll_issues: 'issue_id',
  ll_source_sheets: 'sheet_id',
  ll_source_columns: 'column_uid',
  ll_source_rows: 'row_uid',
  ll_normalization_links: 'link_id',
  ll_user_permissions: 'permission_id',
  ll_edit_sessions: 'edit_session_id',
  ll_cell_edits: 'edit_id',
  ll_payload_snapshots: 'snapshot_key',
});

const RESET_ORDER = Object.freeze([
  'll_payload_snapshots',
  'll_cell_edits',
  'll_edit_sessions',
  'll_user_permissions',
  'll_normalization_links',
  'll_source_rows',
  'll_source_columns',
  'll_source_sheets',
  'll_issues',
  'll_rent_history',
  'll_lease_spaces',
  'll_leases',
  'll_tenants',
  'll_assets',
  'll_funds',
  'll_etl_runs',
]);

const UPSERT_ORDER = Object.freeze([
  'll_etl_runs',
  'll_funds',
  'll_assets',
  'll_tenants',
  'll_leases',
  'll_lease_spaces',
  'll_rent_history',
  'll_issues',
  'll_source_sheets',
  'll_source_columns',
  'll_source_rows',
  'll_normalization_links',
  'll_user_permissions',
  'll_edit_sessions',
  'll_cell_edits',
  'll_payload_snapshots',
]);

const REQUIRED_NON_EMPTY = Object.freeze([
  'll_assets',
  'll_tenants',
  'll_leases',
  'll_lease_spaces',
  'll_rent_history',
  'll_source_sheets',
  'll_source_columns',
  'll_source_rows',
  'll_normalization_links',
  'll_payload_snapshots',
]);

const ALLOWED_SOURCE_SYSTEM = 'google_sheets';

const SOURCE_TABLE_RULES = Object.freeze({
  ll_funds: ['DB_일반'],
  ll_assets: ['DB_자산', 'DB_일반'],
  ll_tenants: ['DB_기업', 'DB_일반'],
  ll_leases: ['DB_일반'],
  ll_lease_spaces: ['DB_일반'],
  ll_rent_history: ['DB_히스토리 누적'],
  ll_issues: [
    '이슈 리스트',
    'Audit',
    'Quality',
    'LOG_검증',
    'AUDIT_데이터이상',
  ],
});

const RAW_SOURCE_SHEETS = Object.freeze([
  'DB_일반',
  'DB_히스토리 누적',
  'DB_자산',
  'DB_기업',
  '이슈 리스트',
]);

const RAW_SOURCE_FILES = Object.freeze([
  'logi_db_general.csv',
  'logi_db_history.csv',
  'logi_db_asset.csv',
  'logi_db_company.csv',
  'logi_issue_list.csv',
]);

const SNAPSHOT_ALLOWED_SOURCES = Object.freeze([
  'google_sheets_model_snapshot',
]);

const FORBIDDEN_SOURCE_VALUES = Object.freeze([
  'existing_public_tables',
  'funds',
  'public.funds',
  'asset_master',
  'public.asset_master',
  'asset_fund_links',
  'public.asset_fund_links',
  'fund_assets',
  'public.fund_assets',
]);

const FORBIDDEN_PAYLOAD_MARKERS = Object.freeze([
  'existing_public_tables',
  'public.funds',
  'asset_master',
  'public.asset_master',
  'asset_fund_links',
  'public.asset_fund_links',
  'fund_assets',
  'public.fund_assets',
]);

function usage() {
  return [
    'Usage:',
    '  node scripts/supabase/ll-clean-reset-reload.cjs --input <canonical-ll-dataset.json> [--snapshots <ll_payload_snapshots.json>] --dry-run',
    '  node scripts/supabase/ll-clean-reset-reload.cjs --input <canonical-ll-dataset.json> [--snapshots <ll_payload_snapshots.json>] --write',
    '  node scripts/supabase/ll-clean-reset-reload.cjs --print-reset-sql',
    '',
    'Input formats:',
    '  { "tables": { "ll_assets": [...], "...": [...] } }',
    '  { "ll_assets": [...], "...": [...] }',
    '  --snapshots may be an array, { "ll_payload_snapshots": [...] }, or { "tables": { "ll_payload_snapshots": [...] } }.',
    '',
    'Required environment for --write:',
    '  SUPABASE_URL=https://PROJECT_REF.supabase.co',
    '  SUPABASE_SERVICE_ROLE_KEY=<server-side key, never pass as a CLI argument>',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    input: '',
    snapshots: '',
    dryRun: false,
    write: false,
    printResetSql: false,
    batchSize: Number(process.env.SUPABASE_REST_BATCH_SIZE || 100),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (/^--(service-role-key|supabase-service-role-key|apikey|api-key|secret|password|key)(=|$)/i.test(arg)) {
      throw new Error('Do not pass Supabase secrets as CLI arguments. Use SUPABASE_SERVICE_ROLE_KEY in the environment.');
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--input') {
      args.input = argv[++index] || '';
    } else if (arg.startsWith('--input=')) {
      args.input = arg.slice('--input='.length);
    } else if (arg === '--snapshots') {
      args.snapshots = argv[++index] || '';
    } else if (arg.startsWith('--snapshots=')) {
      args.snapshots = arg.slice('--snapshots='.length);
    } else if (arg === '--batch-size') {
      args.batchSize = Number(argv[++index] || args.batchSize);
    } else if (arg.startsWith('--batch-size=')) {
      args.batchSize = Number(arg.slice('--batch-size='.length));
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--write') {
      args.write = true;
    } else if (arg === '--print-reset-sql') {
      args.printResetSql = true;
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  if (args.write && args.dryRun) throw new Error('Choose only one of --dry-run or --write.');
  if (!args.write) args.dryRun = true;
  if (!Number.isFinite(args.batchSize) || args.batchSize < 1 || args.batchSize > 500) {
    throw new Error('--batch-size must be between 1 and 500.');
  }
  return args;
}

function readJsonInput(filePath) {
  if (!filePath) throw new Error('--input is required unless --print-reset-sql is used.');
  const raw = filePath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid JSON input: ' + error.message);
  }
}

function normalizeTableMap(payload, label) {
  const source = payload && payload.tables && typeof payload.tables === 'object'
    ? payload.tables
    : payload;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(label + ' must be a JSON object containing ll_* table arrays.');
  }

  const rejectedKeys = [];
  const tables = {};
  Object.keys(source).forEach((key) => {
    if (!LL_TABLES.includes(key)) {
      rejectedKeys.push(key);
      return;
    }
    if (!Array.isArray(source[key])) throw new Error(label + '.' + key + ' must be an array.');
    tables[key] = source[key];
  });
  if (rejectedKeys.length) {
    throw new Error(label + ' contains non-allowlisted table keys. Only public.ll_* arrays are accepted: ' + rejectedKeys.join(', '));
  }

  LL_TABLES.forEach((tableName) => {
    if (!tables[tableName]) tables[tableName] = [];
  });
  return tables;
}

function normalizeSnapshotRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && payload.tables && Array.isArray(payload.tables.ll_payload_snapshots)) return payload.tables.ll_payload_snapshots;
  if (payload && Array.isArray(payload.ll_payload_snapshots)) return payload.ll_payload_snapshots;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  if (payload && Array.isArray(payload.records)) return payload.records;
  throw new Error('--snapshots must contain an ll_payload_snapshots array.');
}

function loadDataset(args) {
  const input = readJsonInput(args.input);
  const tables = normalizeTableMap(input, 'input');
  if (args.snapshots) {
    const snapshotPayload = readJsonInput(args.snapshots);
    tables.ll_payload_snapshots = normalizeSnapshotRows(snapshotPayload);
  }
  return { tables };
}

function rowValue(row, key) {
  const value = row && row[key];
  return value == null ? '' : String(value);
}

function hasOwn(row, key) {
  return Object.prototype.hasOwnProperty.call(row || {}, key);
}

function getNested(value, pathParts) {
  let cursor = value;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sourcePayload(row) {
  return isPlainObject(row && row.source_payload) ? row.source_payload : {};
}

function explicitSourceValues(row) {
  const payload = sourcePayload(row);
  return [
    row && row.source_system,
    row && row.source_table,
    row && row.source_ref,
    row && row.source,
    getNested(payload, ['source', 'system']),
    getNested(payload, ['source', 'table']),
    payload.sourceSystem,
    payload.sourceTable,
  ].map((value) => String(value == null ? '' : value).trim()).filter(Boolean);
}

function containsForbiddenSource(row) {
  const forbiddenSet = new Set(FORBIDDEN_SOURCE_VALUES.map((value) => value.toLowerCase()));
  for (const value of explicitSourceValues(row)) {
    const normalized = value.toLowerCase();
    if (forbiddenSet.has(normalized) || forbiddenSet.has(normalized.replace(/^public\./, ''))) {
      return true;
    }
  }
  const payloadText = JSON.stringify(row || {}).toLowerCase();
  return FORBIDDEN_PAYLOAD_MARKERS.some((marker) => payloadText.includes(marker));
}

function validateOperationalRow(tableName, row, index, failures) {
  const pk = PRIMARY_KEYS[tableName];
  if (!rowValue(row, pk)) failures.push({ table: tableName, rowIndex: index, message: 'Missing primary key: ' + pk });
  if (containsForbiddenSource(row)) {
    failures.push({ table: tableName, rowIndex: index, message: 'Forbidden non-ll public source marker found.' });
  }

  if (tableName === 'll_etl_runs') {
    if (rowValue(row, 'source_system') !== ALLOWED_SOURCE_SYSTEM) {
      failures.push({ table: tableName, rowIndex: index, message: 'source_system must be google_sheets.' });
    }
    return;
  }

  if (tableName === 'll_payload_snapshots') {
    ['snapshot_key', 'page', 'entity_id', 'payload'].forEach((column) => {
      if (!hasOwn(row, column) || row[column] == null || row[column] === '') {
        failures.push({ table: tableName, rowIndex: index, message: 'Missing snapshot column: ' + column });
      }
    });
    const source = rowValue(row, 'source');
    if (!SNAPSHOT_ALLOWED_SOURCES.includes(source)) {
      failures.push({ table: tableName, rowIndex: index, message: 'Snapshot source must be google_sheets_model_snapshot.' });
    }
    if (rowValue(row, 'source_system') && rowValue(row, 'source_system') !== ALLOWED_SOURCE_SYSTEM) {
      failures.push({ table: tableName, rowIndex: index, message: 'snapshot source_system must be google_sheets when present.' });
    }
    if (containsForbiddenSource(row)) {
      failures.push({ table: tableName, rowIndex: index, message: 'Forbidden non-ll source marker found in snapshot.' });
    }
    return;
  }

  if (tableName === 'll_source_sheets') {
    if (rowValue(row, 'source_system') !== ALLOWED_SOURCE_SYSTEM) {
      failures.push({ table: tableName, rowIndex: index, message: 'source_system must be google_sheets.' });
    }
    if (!RAW_SOURCE_SHEETS.includes(rowValue(row, 'sheet_name'))) {
      failures.push({ table: tableName, rowIndex: index, message: 'sheet_name is not an allowed logistics source sheet.' });
    }
    if (!RAW_SOURCE_FILES.includes(rowValue(row, 'source_file'))) {
      failures.push({ table: tableName, rowIndex: index, message: 'source_file is not an allowed logistics CSV export.' });
    }
    ['row_count', 'column_count', 'cell_count', 'header_hash', 'data_hash'].forEach((column) => {
      if (!hasOwn(row, column) || row[column] == null || row[column] === '') {
        failures.push({ table: tableName, rowIndex: index, message: 'Missing source sheet column: ' + column });
      }
    });
    return;
  }

  if (tableName === 'll_source_columns') {
    if (rowValue(row, 'source_system') !== ALLOWED_SOURCE_SYSTEM) {
      failures.push({ table: tableName, rowIndex: index, message: 'source_system must be google_sheets.' });
    }
    if (!RAW_SOURCE_SHEETS.includes(rowValue(row, 'sheet_name'))) {
      failures.push({ table: tableName, rowIndex: index, message: 'sheet_name is not an allowed logistics source sheet.' });
    }
    ['sheet_id', 'column_index', 'column_letter', 'normalized_header', 'column_role', 'value_type_guess', 'source_ref'].forEach((column) => {
      if (!hasOwn(row, column) || row[column] == null || row[column] === '') {
        failures.push({ table: tableName, rowIndex: index, message: 'Missing source column catalog field: ' + column });
      }
    });
    if (!Array.isArray(row.sample_values)) {
      failures.push({ table: tableName, rowIndex: index, message: 'sample_values must be an array.' });
    }
    return;
  }

  if (tableName === 'll_source_rows') {
    if (rowValue(row, 'source_system') !== ALLOWED_SOURCE_SYSTEM) {
      failures.push({ table: tableName, rowIndex: index, message: 'source_system must be google_sheets.' });
    }
    if (!RAW_SOURCE_SHEETS.includes(rowValue(row, 'sheet_name'))) {
      failures.push({ table: tableName, rowIndex: index, message: 'sheet_name is not an allowed logistics source sheet.' });
    }
    ['sheet_id', 'row_index', 'row_number', 'source_ref', 'source_row_hash', 'non_empty_cell_count'].forEach((column) => {
      if (!hasOwn(row, column) || row[column] == null || row[column] === '') {
        failures.push({ table: tableName, rowIndex: index, message: 'Missing source row field: ' + column });
      }
    });
    if (!Array.isArray(row.row_values)) {
      failures.push({ table: tableName, rowIndex: index, message: 'row_values must be an array preserving source cells.' });
    }
    if (!isPlainObject(row.raw_row_payload)) {
      failures.push({ table: tableName, rowIndex: index, message: 'raw_row_payload must be a JSON object.' });
    }
    return;
  }

  if (tableName === 'll_normalization_links') {
    if (rowValue(row, 'source_system') !== ALLOWED_SOURCE_SYSTEM) {
      failures.push({ table: tableName, rowIndex: index, message: 'source_system must be google_sheets.' });
    }
    if (!RAW_SOURCE_SHEETS.includes(rowValue(row, 'source_sheet_name'))) {
      failures.push({ table: tableName, rowIndex: index, message: 'source_sheet_name is not an allowed logistics source sheet.' });
    }
    if (!rowValue(row, 'target_table').startsWith('ll_')) {
      failures.push({ table: tableName, rowIndex: index, message: 'target_table must be an ll_* table.' });
    }
    ['source_ref', 'target_pk', 'link_type', 'rule_version'].forEach((column) => {
      if (!hasOwn(row, column) || row[column] == null || row[column] === '') {
        failures.push({ table: tableName, rowIndex: index, message: 'Missing normalization link field: ' + column });
      }
    });
    return;
  }

  if (['ll_user_permissions', 'll_edit_sessions', 'll_cell_edits'].includes(tableName)) {
    if (rowValue(row, 'source_system') && rowValue(row, 'source_system') !== ALLOWED_SOURCE_SYSTEM) {
      failures.push({ table: tableName, rowIndex: index, message: 'source_system must be google_sheets when present.' });
    }
    return;
  }

  if (rowValue(row, 'source_system') !== ALLOWED_SOURCE_SYSTEM) {
    failures.push({ table: tableName, rowIndex: index, message: 'source_system must be google_sheets.' });
  }
  const allowedSourceTables = SOURCE_TABLE_RULES[tableName] || [];
  if (!allowedSourceTables.includes(rowValue(row, 'source_table'))) {
    failures.push({
      table: tableName,
      rowIndex: index,
      message: 'source_table is not allowed for ' + tableName + ': ' + rowValue(row, 'source_table'),
    });
  }
  ['source_pk', 'source_ref', 'source_row_hash'].forEach((column) => {
    if (!rowValue(row, column)) failures.push({ table: tableName, rowIndex: index, message: 'Missing source column: ' + column });
  });
  if (!isPlainObject(row.source_payload)) {
    failures.push({ table: tableName, rowIndex: index, message: 'source_payload must be a JSON object.' });
  }
  if (tableName === 'll_assets' && !hasOwn(row, 'raw_asset_name')) {
    failures.push({ table: tableName, rowIndex: index, message: 'raw_asset_name column must be preserved.' });
  }
  if (tableName === 'll_tenants' && !hasOwn(row, 'raw_tenant_name')) {
    failures.push({ table: tableName, rowIndex: index, message: 'raw_tenant_name column must be preserved.' });
  }
  if (tableName === 'll_funds' && !rowValue(row, 'fund_code') && !rowValue(row, 'fund_name') && !rowValue(row, 'raw_fund_name')) {
    failures.push({ table: tableName, rowIndex: index, message: 'll_funds rows require DB_일반 fund fields.' });
  }
}

function validateDataset(dataset) {
  const failures = [];
  const counts = {};
  const tables = dataset.tables || {};
  const tableNames = Object.keys(tables);
  const nonLlKeys = tableNames.filter((key) => !key.startsWith('ll_'));
  if (nonLlKeys.length) {
    failures.push({ table: '(input)', message: 'Non-ll table keys are not allowed: ' + nonLlKeys.join(', ') });
  }
  tableNames.filter((key) => key.startsWith('ll_') && !LL_TABLES.includes(key)).forEach((tableName) => {
    failures.push({ table: tableName, message: 'Only the 9 public.ll_* tables are allowed.' });
  });
  LL_TABLES.forEach((tableName) => {
    const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];
    counts[tableName] = rows.length;
    rows.forEach((row, index) => validateOperationalRow(tableName, row, index, failures));
  });
  REQUIRED_NON_EMPTY.forEach((tableName) => {
    if (!counts[tableName]) failures.push({ table: tableName, message: 'Required non-empty table has 0 rows.' });
  });
  return {
    ok: failures.length === 0,
    failures,
    counts,
  };
}

function resetSql() {
  const lines = [
    '-- public.ll_* clean reset only. This script intentionally has no non-ll DDL/DML.',
    'begin;',
  ];
  RESET_ORDER.forEach((tableName) => {
    const pk = PRIMARY_KEYS[tableName];
    lines.push('delete from public.' + tableName + ' where ' + pk + ' is not null;');
  });
  lines.push('commit;');
  return lines.join('\n');
}

function redact(value) {
  let text = String(value == null ? '' : value);
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (secret && secret.length > 6) {
    text = text.split(secret).join('[redacted-supabase-secret]');
    text = text.split(encodeURIComponent(secret)).join('[redacted-supabase-secret]');
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(/apikey["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+/gi, 'apikey=[redacted]')
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, '[redacted-supabase-secret]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .slice(0, 1200);
}

function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url) throw new Error('SUPABASE_URL is required for --write.');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error('SUPABASE_URL must look like https://PROJECT_REF.supabase.co.');
  }
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for --write.');
  return { url, key, restUrl: url + '/rest/v1' };
}

function query(parts) {
  return parts
    .filter(Boolean)
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value))
    .join('&');
}

function inFilter(values) {
  return 'in.(' + values.map((value) => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')';
}

function restHeaders(config, extra) {
  const headers = Object.assign({
    apikey: config.key,
    Accept: 'application/json',
  }, extra || {});
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(config.key)) {
    headers.Authorization = 'Bearer ' + config.key;
  }
  return headers;
}

async function restRequest(config, tableName, queryString, options) {
  if (!LL_TABLES.includes(tableName)) throw new Error('REST request blocked for non-allowlisted table: ' + tableName);
  const requestOptions = options || {};
  const response = await fetch(config.restUrl + '/' + tableName + (queryString ? '?' + queryString : ''), {
    method: requestOptions.method || 'GET',
    headers: restHeaders(config, requestOptions.headers),
    body: requestOptions.body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error('Supabase REST ' + tableName + ' failed (' + response.status + '): ' + redact(text));
  }
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }
  return { response, data, text };
}

async function countRows(config, tableName) {
  const pk = PRIMARY_KEYS[tableName];
  const result = await restRequest(config, tableName, query([
    ['select', pk],
    ['limit', '1'],
  ]), {
    method: 'GET',
    headers: { Prefer: 'count=exact' },
  });
  const contentRange = result.response.headers.get('content-range') || '';
  const match = contentRange.match(/\/(\d+)$/);
  if (match) return Number(match[1]);
  return Array.isArray(result.data) ? result.data.length : 0;
}

async function deleteAllRows(config, tableName) {
  const pk = PRIMARY_KEYS[tableName];
  await restRequest(config, tableName, query([[pk, 'not.is.null']]), {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  return { table: tableName, deletedBy: pk + ' not null' };
}

async function upsertRows(config, tableName, rows, batchSize) {
  if (!rows.length) return { table: tableName, rowCount: 0, batchCount: 0, skipped: true };
  const pk = PRIMARY_KEYS[tableName];
  let batchCount = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize).map((row) => (
      tableName === 'll_payload_snapshots' && !rowValue(row, 'source_system')
        ? Object.assign({}, row, { source_system: ALLOWED_SOURCE_SYSTEM })
        : row
    ));
    await restRequest(config, tableName, query([['on_conflict', pk]]), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    batchCount += 1;
  }
  return { table: tableName, rowCount: rows.length, batchCount };
}

async function readInvalidSourceRows(config, tableName) {
  if (!SOURCE_TABLE_RULES[tableName]) return [];
  const pk = PRIMARY_KEYS[tableName];
  const select = [pk, 'source_system', 'source_table', 'source_pk', 'source_ref', 'source_row_hash'].join(',');
  const probes = [
    [['source_system', 'is.null']],
    [['source_system', 'neq.' + ALLOWED_SOURCE_SYSTEM]],
    [['source_table', 'is.null']],
    [['source_table', 'not.' + inFilter(SOURCE_TABLE_RULES[tableName])]],
    [['source_pk', 'is.null']],
    [['source_ref', 'is.null']],
    [['source_row_hash', 'is.null']],
  ];
  const rows = [];
  for (const probe of probes) {
    const result = await restRequest(config, tableName, query([
      ['select', select],
      probe[0],
      ['limit', '5'],
    ]), { method: 'GET' });
    rows.push(...(Array.isArray(result.data) ? result.data : []));
  }
  return rows;
}

async function readInvalidSnapshotRows(config) {
  const select = ['snapshot_key', 'source_system', 'source'].join(',');
  const probes = [
    [['source_system', 'is.null']],
    [['source_system', 'neq.' + ALLOWED_SOURCE_SYSTEM]],
    [['source', 'is.null']],
    [['source', 'neq.google_sheets_model_snapshot']],
  ];
  const rows = [];
  for (const probe of probes) {
    const result = await restRequest(config, 'll_payload_snapshots', query([
      ['select', select],
      probe[0],
      ['limit', '5'],
    ]), { method: 'GET' });
    rows.push(...(Array.isArray(result.data) ? result.data : []));
  }
  return rows;
}

async function writeDataset(dataset, args) {
  const config = getSupabaseConfig();
  const resetResults = [];
  const upsertResults = [];

  for (const tableName of RESET_ORDER) {
    resetResults.push(await deleteAllRows(config, tableName));
  }
  for (const tableName of UPSERT_ORDER) {
    upsertResults.push(await upsertRows(config, tableName, dataset.tables[tableName] || [], args.batchSize));
  }

  const readbackCounts = {};
  for (const tableName of LL_TABLES) {
    readbackCounts[tableName] = await countRows(config, tableName);
  }

  const sourceFailures = [];
  for (const tableName of Object.keys(SOURCE_TABLE_RULES)) {
    const invalidRows = await readInvalidSourceRows(config, tableName);
    if (invalidRows.length) sourceFailures.push({ table: tableName, invalidRows });
  }
  const invalidSnapshotRows = await readInvalidSnapshotRows(config);
  if (invalidSnapshotRows.length) sourceFailures.push({ table: 'll_payload_snapshots', invalidRows: invalidSnapshotRows });

  return {
    resetResults,
    upsertResults,
    readbackCounts,
    sourceFailures,
  };
}

function buildSummary(dataset, validation, args, writeResult) {
  const expectedCounts = validation.counts;
  const exactCountFailures = [];
  if (writeResult && writeResult.readbackCounts) {
    LL_TABLES.forEach((tableName) => {
      if (Number(writeResult.readbackCounts[tableName] || 0) !== Number(expectedCounts[tableName] || 0)) {
        exactCountFailures.push({
          table: tableName,
          expected: Number(expectedCounts[tableName] || 0),
          actual: Number(writeResult.readbackCounts[tableName] || 0),
        });
      }
    });
  }
  return {
    ok: validation.ok && exactCountFailures.length === 0 && !(writeResult && writeResult.sourceFailures && writeResult.sourceFailures.length),
    mode: args.write ? 'write' : 'dry-run',
    writesPerformed: args.write === true,
    tables: expectedCounts,
    requiredNonEmpty: REQUIRED_NON_EMPTY,
    resetOrder: RESET_ORDER,
    upsertOrder: UPSERT_ORDER,
    validation: {
      ok: validation.ok,
      failureCount: validation.failures.length,
      failures: validation.failures.slice(0, 30),
    },
    readback: writeResult ? {
      counts: writeResult.readbackCounts,
      exactCountFailures,
      sourceFailures: writeResult.sourceFailures,
    } : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.printResetSql && !args.input) {
    console.log(resetSql());
    return;
  }
  const dataset = loadDataset(args);
  const validation = validateDataset(dataset);
  if (!validation.ok) {
    const summary = buildSummary(dataset, validation, args, null);
    console.error(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
    return;
  }
  if (args.printResetSql) {
    console.log(resetSql());
  }
  if (!args.write) {
    console.log(JSON.stringify(buildSummary(dataset, validation, args, null), null, 2));
    return;
  }
  const writeResult = await writeDataset(dataset, args);
  const summary = buildSummary(dataset, validation, args, writeResult);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(redact(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
