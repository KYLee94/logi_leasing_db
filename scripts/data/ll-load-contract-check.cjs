#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LOADER = path.join(ROOT, 'scripts', 'supabase', 'll-clean-reset-reload.cjs');
const SCHEMA = path.join(ROOT, 'scripts', 'supabase', 'public-ll-schema.sql');
const UPSERT_CHUNK_BUILDER = path.join(ROOT, 'scripts', 'data', 'build-ll-upsert-chunks.cjs');
const XLSX_SOURCE_DATASET = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-dataset-xlsx-source.json');

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

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function extractPublicTableMutations(sql) {
  const stripped = stripSqlComments(sql);
  const pattern = /\b(create\s+table\s+(?:if\s+not\s+exists\s+)?|alter\s+table\s+|drop\s+table\s+(?:if\s+exists\s+)?|truncate\s+table\s+|delete\s+from\s+|insert\s+into\s+|update\s+)public\.([a-z0-9_]+)/gi;
  return [...stripped.matchAll(pattern)].map((match) => ({
    operation: match[1].trim().replace(/\s+/g, ' '),
    table: match[2],
  }));
}

function runLoader(args, input) {
  return spawnSync(process.execPath, [LOADER].concat(args), {
    cwd: ROOT,
    input: input == null ? undefined : JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
}

function runUpsertChunkBuilder(args) {
  return spawnSync(process.execPath, [UPSERT_CHUNK_BUILDER].concat(args), {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(label + ' did not return JSON: ' + error.message + '\n' + text);
  }
}

function validDataset() {
  return {
    tables: {
      ll_etl_runs: [{
        run_id: 'll_contract_check_run',
        source_system: 'google_sheets',
        run_type: 'contract_check',
        status: 'prepared',
      }],
      ll_funds: [],
      ll_assets: [{
        asset_id: 'asset_contract_1',
        asset_name: 'Contract Check Asset',
        raw_asset_name: 'Contract Check Asset',
        source_system: 'google_sheets',
        source_table: 'DB_자산',
        source_pk: '2',
        source_ref: 'DB_자산!2',
        source_row_hash: 'asset_hash_1',
        source_payload: { source: { system: 'google_sheets', table: 'DB_자산', pk: '2' } },
      }],
      ll_tenants: [{
        tenant_id: 'tenant_contract_1',
        tenant_master_name: 'Contract Check Tenant',
        raw_tenant_name: 'Contract Check Tenant',
        source_system: 'google_sheets',
        source_table: 'DB_기업',
        source_pk: '2',
        source_ref: 'DB_기업!2',
        source_row_hash: 'tenant_hash_1',
        source_payload: { source: { system: 'google_sheets', table: 'DB_기업', pk: '2' } },
      }],
      ll_leases: [{
        lease_id: 'lease_contract_1',
        asset_id: 'asset_contract_1',
        tenant_id: 'tenant_contract_1',
        source_system: 'google_sheets',
        source_table: 'DB_일반',
        source_pk: '2',
        source_ref: 'DB_일반!2',
        source_row_hash: 'lease_hash_1',
        source_payload: { source: { system: 'google_sheets', table: 'DB_일반', pk: '2' } },
      }],
      ll_lease_spaces: [{
        lease_space_id: 'lease_space_contract_1',
        lease_id: 'lease_contract_1',
        asset_id: 'asset_contract_1',
        tenant_id: 'tenant_contract_1',
        source_system: 'google_sheets',
        source_table: 'DB_일반',
        source_pk: '2',
        source_ref: 'DB_일반!2',
        source_row_hash: 'lease_space_hash_1',
        source_payload: { source: { system: 'google_sheets', table: 'DB_일반', pk: '2' } },
      }],
      ll_rent_history: [{
        history_event_id: 'history_contract_1',
        lease_space_id: 'lease_space_contract_1',
        lease_id: 'lease_contract_1',
        asset_id: 'asset_contract_1',
        tenant_id: 'tenant_contract_1',
        source_system: 'google_sheets',
        source_table: 'DB_히스토리 누적',
        source_pk: '2',
        source_ref: 'DB_히스토리 누적!2',
        source_row_hash: 'history_hash_1',
        source_payload: { source: { system: 'google_sheets', table: 'DB_히스토리 누적', pk: '2' } },
      }],
      ll_issues: [],
      ll_source_sheets: [{
        sheet_id: 'sheet_contract_check',
        source_system: 'google_sheets',
        sheet_name: 'DB_일반',
        source_file: 'logi_db_general.csv',
        row_count: 1,
        column_count: 1,
        cell_count: 1,
        header_hash: 'header_hash_1',
        data_hash: 'data_hash_1',
        source_payload: { source: { system: 'google_sheets', table: 'DB_일반', file: 'logi_db_general.csv' } },
      }],
      ll_source_columns: [{
        column_uid: 'sheet_contract_check:c001',
        sheet_id: 'sheet_contract_check',
        source_system: 'google_sheets',
        sheet_name: 'DB_일반',
        column_index: 1,
        column_letter: 'A',
        header_name: '자산명',
        normalized_header: '자산명',
        column_role: 'business_value',
        value_type_guess: 'text',
        is_blank_header: false,
        sample_values: ['Contract Check Asset'],
        source_ref: 'DB_일반!A1',
      }],
      ll_source_rows: [{
        row_uid: 'sheet_contract_check:r000002',
        sheet_id: 'sheet_contract_check',
        source_system: 'google_sheets',
        sheet_name: 'DB_일반',
        row_index: 1,
        row_number: 2,
        source_ref: 'DB_일반!2:2',
        source_row_hash: 'source_row_hash_1',
        non_empty_cell_count: 1,
        row_values: [{
          column_index: 1,
          column_letter: 'A',
          column_key: 'c001',
          header_name: '자산명',
          normalized_header: '자산명',
          value: 'Contract Check Asset',
          value_type: 'text',
          is_blank: false,
          a1_ref: 'DB_일반!A2',
        }],
        raw_row_payload: { source: { system: 'google_sheets', table: 'DB_일반', row_number: 2 }, values: ['Contract Check Asset'] },
      }],
      ll_normalization_links: [{
        link_id: 'link_contract_check_1',
        source_system: 'google_sheets',
        source_sheet_name: 'DB_일반',
        source_ref: 'DB_일반!2',
        source_row_uid: 'sheet_contract_check:r000002',
        target_table: 'll_assets',
        target_pk: 'asset_contract_1',
        target_column: null,
        link_type: 'row_to_entity',
        confidence: 1,
        rule_version: 'contract_check_v1',
      }],
      ll_user_permissions: [],
      ll_edit_sessions: [],
      ll_cell_edits: [],
      ll_payload_snapshots: [{
        snapshot_key: 'home:default',
        page: 'home',
        entity_id: 'default',
        payload: { ok: true },
        source: 'google_sheets_model_snapshot',
        source_system: 'google_sheets',
      }],
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectLoaderSuccess(dataset) {
  const result = runLoader(['--input', '-', '--dry-run'], dataset);
  assert(result.status === 0, 'valid Google Sheets ll_* fixture must pass dry-run', {
    stdout: result.stdout,
    stderr: result.stderr,
  });
  const summary = parseJson(result.stdout, 'dry-run');
  assert(summary.ok === true, 'dry-run summary must be ok', summary);
  REQUIRED_NON_EMPTY.forEach((tableName) => {
    assert(Number(summary.tables[tableName] || 0) > 0, 'required table must be non-empty: ' + tableName, summary.tables);
  });
}

function expectLoaderFailure(name, dataset) {
  const result = runLoader(['--input', '-', '--dry-run'], dataset);
  assert(result.status !== 0, name + ' must fail dry-run', {
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function checkSchemaSafety() {
  const schema = read(SCHEMA);
  const mutations = extractPublicTableMutations(schema);
  const nonLlMutations = mutations.filter((entry) => !entry.table.startsWith('ll_'));
  assert(nonLlMutations.length === 0, 'schema must not mutate non-ll public tables', nonLlMutations);
  assert(!/\bcascade\b/i.test(stripSqlComments(schema)), 'schema must not use CASCADE');
  LL_TABLES.forEach((tableName) => {
    assert(schema.includes('public.' + tableName), 'schema must reference table: ' + tableName);
  });
  assert(schema.includes("source_system = 'google_sheets'"), 'schema must enforce google_sheets source_system');
  assert(schema.includes("source = 'google_sheets_model_snapshot'"), 'schema must enforce Google Sheets model snapshots');
}

function checkResetSqlSafety() {
  const result = runLoader(['--print-reset-sql'], null);
  assert(result.status === 0, '--print-reset-sql must succeed', {
    stdout: result.stdout,
    stderr: result.stderr,
  });
  const mutations = extractPublicTableMutations(result.stdout);
  const nonLlMutations = mutations.filter((entry) => !entry.table.startsWith('ll_'));
  assert(nonLlMutations.length === 0, 'reset SQL must not mutate non-ll public tables', nonLlMutations);
  assert(mutations.every((entry) => entry.operation.toLowerCase() === 'delete from'), 'reset SQL must only use DELETE', mutations);
  LL_TABLES.forEach((tableName) => {
    assert(result.stdout.includes('delete from public.' + tableName), 'reset SQL must delete table: ' + tableName);
  });
}

function checkLoaderGuards() {
  const base = validDataset();
  expectLoaderSuccess(base);

  const nonLlTable = clone(base);
  nonLlTable.tables[['asset', 'master'].join('_')] = [];
  expectLoaderFailure('non-ll table key', nonLlTable);

  const forbiddenSource = clone(base);
  forbiddenSource.tables.ll_assets[0].source_table = ['public', 'funds'].join('.');
  expectLoaderFailure('forbidden source marker', forbiddenSource);

  const invalidSnapshot = clone(base);
  invalidSnapshot.tables.ll_payload_snapshots[0].source = 'apps_script_snapshot';
  expectLoaderFailure('non-model snapshot source', invalidSnapshot);

  const missingRequired = clone(base);
  missingRequired.tables.ll_rent_history = [];
  expectLoaderFailure('required non-empty table', missingRequired);
}

function writeTempDataset(dataset) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'll-upsert-contract-'));
  const inputPath = path.join(tempDir, 'dataset.json');
  fs.writeFileSync(inputPath, JSON.stringify(dataset), 'utf8');
  return { tempDir, inputPath };
}

function expectUpsertBuilderFailure(name, dataset) {
  const temp = writeTempDataset(dataset);
  const result = runUpsertChunkBuilder(['--input', temp.inputPath, '--dry-run', '--max-bytes', '20000']);
  assert(result.status !== 0, name + ' must fail upsert chunk dry-run', {
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function checkUpsertChunkBuilder() {
  const base = validDataset();
  const temp = writeTempDataset(base);
  const result = runUpsertChunkBuilder([
    '--input',
    temp.inputPath,
    '--output-dir',
    path.join(temp.tempDir, 'sql-chunks'),
    '--write',
    '--max-bytes',
    '20000',
  ]);
  assert(result.status === 0, 'upsert chunk builder must pass valid Google Sheets fixture', {
    stdout: result.stdout,
    stderr: result.stderr,
  });

  const summary = parseJson(result.stdout, 'upsert chunk builder');
  assert(summary.ok === true, 'upsert chunk builder summary must be ok', summary);
  assert(summary.writesPerformed === true, 'upsert chunk builder write mode must report local file writes', summary);
  assert(Array.isArray(summary.tableOrder), 'upsert chunk builder must report fixed table order', summary);
  assert(summary.tableOrder[0] === 'll_etl_runs', 'upsert chunk builder table order must start with ll_etl_runs', summary.tableOrder);
  assert(summary.tableOrder[summary.tableOrder.length - 1] === 'll_payload_snapshots', 'upsert chunk builder table order must end with ll_payload_snapshots', summary.tableOrder);
  assert(!summary.tableOrder.includes('ll_source_diffs'), 'upsert chunk builder must not include out-of-scope ll_source_diffs', summary.tableOrder);

  const sqlFiles = fs.readdirSync(path.join(temp.tempDir, 'sql-chunks')).filter((fileName) => fileName.endsWith('.sql'));
  assert(sqlFiles.length === summary.chunkCount, 'written SQL file count must match summary chunkCount', {
    sqlFiles,
    chunkCount: summary.chunkCount,
  });
  const joinedSql = sqlFiles.map((fileName) => read(path.join(temp.tempDir, 'sql-chunks', fileName))).join('\n');
  assert(/\binsert\s+into\s+public\./i.test(joinedSql), 'upsert chunk SQL must contain insert into public.*');
  assert(/\bon\s+conflict\b/i.test(joinedSql), 'upsert chunk SQL must contain on conflict');
  assert(!/\b(delete\s+from|truncate\s+table|drop\s+table|alter\s+table|create\s+table)\b/i.test(stripSqlComments(joinedSql)), 'upsert chunk SQL must not contain reset/delete/schema statements');

  const forbiddenSource = clone(base);
  forbiddenSource.tables.ll_assets[0].source_table = ['public', 'funds'].join('.');
  expectUpsertBuilderFailure('upsert chunk forbidden marker', forbiddenSource);

  const invalidSourceSystem = clone(base);
  invalidSourceSystem.tables.ll_assets[0].source_system = 'xlsx';
  expectUpsertBuilderFailure('upsert chunk non-google source_system', invalidSourceSystem);
}

function checkXlsxSourceDatasetUpsertPlan() {
  if (!fs.existsSync(XLSX_SOURCE_DATASET)) return;

  const result = runUpsertChunkBuilder([
    '--input',
    XLSX_SOURCE_DATASET,
    '--dry-run',
    '--max-bytes',
    '750000',
  ]);
  assert(result.status === 0, 'xlsx source dataset must pass upsert chunk dry-run', {
    stdout: result.stdout,
    stderr: result.stderr,
  });

  const summary = parseJson(result.stdout, 'xlsx source upsert chunk dry-run');
  assert(summary.ok === true, 'xlsx source upsert chunk summary must be ok', summary);
  assert(summary.writesPerformed === false, 'xlsx source dry-run must not write chunk files', summary);
  assert(summary.rowsByTable.ll_source_cells === 13752, 'xlsx source dataset must include current ll_source_cells count', summary.rowsByTable);
  assert(summary.chunkCount > 1, 'xlsx source dataset should be split into multiple SQL chunks', summary);
  assert(summary.files.every((entry) => entry.bytes <= summary.maxBytes), 'every xlsx source chunk must fit within maxBytes', summary.files);
  assert(summary.files[0].table === 'll_etl_runs', 'xlsx source chunk order must start with ll_etl_runs', summary.files[0]);
  assert(summary.files[summary.files.length - 1].table === 'll_payload_snapshots', 'xlsx source chunk order must end with ll_payload_snapshots', summary.files[summary.files.length - 1]);
}

const checks = [
  ['schema-safety', checkSchemaSafety],
  ['reset-sql-safety', checkResetSqlSafety],
  ['loader-guards', checkLoaderGuards],
  ['upsert-chunk-builder', checkUpsertChunkBuilder],
  ['xlsx-source-upsert-plan', checkXlsxSourceDatasetUpsertPlan],
];

const results = [];
for (const [name, fn] of checks) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({
      name,
      ok: false,
      message: error.message,
      details: error.details || null,
    });
  }
}

const summary = {
  ok: results.every((entry) => entry.ok),
  writesPerformed: false,
  checks: results,
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
