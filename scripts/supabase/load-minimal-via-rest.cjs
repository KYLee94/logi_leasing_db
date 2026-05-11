#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-minimal-dataset-google-sheets.json');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qvegpozwrcmspdvjokiz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P';

const TABLE_ORDER = Object.freeze([
  ['ll_import_runs', 'import_id', [
    'import_id', 'source_type', 'source_name', 'spreadsheet_id', 'file_name', 'started_at', 'finished_at', 'status', 'row_counts', 'memo',
  ]],
  ['ll_sheet_rows', 'sheet_row_id', [
    'sheet_row_id', 'import_id', 'source_type', 'source_name', 'sheet_name', 'row_number', 'header_row_number', 'row_values_json', 'row_hash',
  ]],
  ['ll_assets', 'asset_id', [
    'asset_id', 'asset_code', 'asset_name', 'fund_code', 'fund_name', 'sector', 'address', 'latitude', 'longitude', 'approval_date',
    'first_configured_at', 'gross_floor_area_sqm', 'land_area_sqm', 'floor_count', 'current_manager_name', 'current_manager_team',
    'current_manager_email', 'source_sheet_row_id', 'source_payload', 'review_status', 'review_note',
  ]],
  ['ll_tenants', 'tenant_id', [
    'tenant_id', 'tenant_master_name', 'raw_tenant_name', 'business_registration_no', 'dart_corp_code', 'match_status', 'industry_code',
    'headquarters_address', 'listed_yn', 'group_name', 'source_sheet_row_id', 'source_payload', 'review_status', 'review_note',
  ]],
  ['ll_leases', 'lease_id', [
    'lease_id', 'asset_id', 'tenant_id', 'lease_status', 'first_contract_date', 'first_start_date', 'first_end_date',
    'first_operation_date', 'recent_contract_date', 'current_start_date', 'current_end_date', 'contract_years', 'extension_count',
    'deposit_amount', 'rf_months', 'fo_months', 'ti_amount', 'rent_escalation_rate', 'management_fee_escalation_rate',
    'escalation_cycle_months', 'next_escalation_date', 'tenant_cost_burden', 'early_termination_right', 'renewal_option',
    'insurance_terms_json', 'special_terms', 'source_doc_ref', 'source_sheet_row_id', 'source_payload', 'review_status', 'review_note',
  ]],
  ['ll_lease_spaces', 'lease_space_id', [
    'lease_space_id', 'lease_id', 'asset_id', 'tenant_id', 'floor_label', 'detail_area_label', 'temperature_type', 'is_single_tenant',
    'is_preleased', 'is_3pl', 'goods_type', 'leased_area_sqm', 'exclusive_area_sqm', 'exclusive_ratio', 'current_monthly_rent_total',
    'current_monthly_mf_total', 'current_monthly_cost_total', 'e_noc', 'formula_version', 'area_breakdown_json', 'office_use_yn',
    'sublease_yn', 'facility_specs_json', 'contract_status', 'delinquency_yn', 'source_sheet_row_id', 'source_payload', 'review_status',
    'review_note',
  ]],
  ['ll_rent_history', 'rent_history_id', [
    'rent_history_id', 'lease_space_id', 'lease_id', 'asset_id', 'tenant_id', 'effective_date', 'change_reason', 'leased_area_sqm',
    'exclusive_area_sqm', 'monthly_rent_total', 'monthly_mf_total', 'rent_per_py', 'mf_per_py', 'is_latest', 'match_status',
    'source_sheet_row_id', 'source_payload', 'review_status', 'review_note',
  ]],
  ['ll_asset_managers', 'asset_manager_id', [
    'asset_manager_id', 'asset_id', 'asset_code', 'asset_name', 'fund_code', 'fund_name', 'manager_name', 'manager_team', 'manager_email',
    'source_sheet_row_id', 'source_payload',
  ]],
  ['ll_issues', 'issue_id', [
    'issue_id', 'entity_type', 'entity_id', 'asset_id', 'tenant_id', 'issue_type', 'severity', 'title', 'description', 'status',
    'due_date', 'owner', 'source_sheet_row_id', 'source_payload',
  ]],
  ['ll_payload_snapshots', 'snapshot_key', [
    'snapshot_key', 'page', 'entity_id', 'payload', 'user_safe', 'generated_at', 'schema_version', 'source', 'source_system',
  ]],
]);

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    dryRun: false,
    write: false,
    maxRows: 25,
    maxBytes: 180000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = path.resolve(ROOT, argv[++index] || args.input);
    else if (arg.startsWith('--input=')) args.input = path.resolve(ROOT, arg.slice('--input='.length));
    else if (arg === '--max-rows') args.maxRows = Number(argv[++index] || args.maxRows);
    else if (arg.startsWith('--max-rows=')) args.maxRows = Number(arg.slice('--max-rows='.length));
    else if (arg === '--max-bytes') args.maxBytes = Number(argv[++index] || args.maxBytes);
    else if (arg.startsWith('--max-bytes=')) args.maxBytes = Number(arg.slice('--max-bytes='.length));
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--write') args.write = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (args.dryRun === args.write) throw new Error('Choose exactly one mode: --dry-run or --write.');
  if (!Number.isInteger(args.maxRows) || args.maxRows < 1) throw new Error('--max-rows must be a positive integer.');
  if (!Number.isInteger(args.maxBytes) || args.maxBytes < 10000) throw new Error('--max-bytes must be at least 10000.');
  return args;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function chunkRows(rows, maxRows, maxBytes) {
  const chunks = [];
  let current = [];
  let currentBytes = 2;
  rows.forEach((row) => {
    const rowBytes = byteLength(row) + 1;
    if (current.length && (current.length >= maxRows || currentBytes + rowBytes > maxBytes)) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(row);
    currentBytes += rowBytes;
  });
  if (current.length) chunks.push(current);
  return chunks;
}

function cleanValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(cleanValue);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      const cleaned = cleanValue(value[key]);
      if (cleaned !== undefined) out[key] = cleaned;
    });
    return out;
  }
  return value;
}

function cleanRow(row) {
  const out = {};
  Object.keys(row || {}).forEach((key) => {
    const cleaned = cleanValue(row[key]);
    if (cleaned !== undefined) out[key] = cleaned;
  });
  return out;
}

function normalizeRows(rows, columns) {
  return rows.map((row) => {
    const cleaned = cleanRow(row);
    return Object.fromEntries(columns.map((column) => [column, Object.prototype.hasOwnProperty.call(cleaned, column) ? cleaned[column] : null]));
  });
}

function redact(text) {
  return String(text || '')
    .replace(/sb_publishable_[A-Za-z0-9._-]+/g, '[redacted-publishable-key]')
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, '[redacted-secret-key]')
    .replace(/x-ll-load-token[^\n\r,}]*/gi, 'x-ll-load-token=[redacted]');
}

async function upsertRows(tableName, conflictKey, columns, rows, token) {
  const endpoint = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(tableName)}?on_conflict=${encodeURIComponent(conflictKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
      'x-ll-load-token': token,
    },
    body: JSON.stringify(normalizeRows(rows, columns)),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase REST upsert failed table=${tableName} status=${response.status} body=${redact(text.slice(0, 700))}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.LL_LOAD_TOKEN || '';
  if (args.write && !token) throw new Error('LL_LOAD_TOKEN environment variable is required for --write.');
  const dataset = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const tables = dataset.tables || {};
  const plan = TABLE_ORDER.map(([tableName, conflictKey, columns]) => {
    const rows = tables[tableName] || [];
    const chunks = chunkRows(rows, args.maxRows, args.maxBytes);
    return {
      tableName,
      conflictKey,
      columns,
      rows: rows.length,
      chunks: chunks.length,
      maxChunkBytes: chunks.reduce((max, chunk) => Math.max(max, byteLength(chunk)), 0),
      chunksData: chunks,
    };
  });

  if (args.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'dry-run',
      writesPerformed: false,
      input: args.input,
      plan: plan.map(({ chunksData, ...item }) => item),
    }, null, 2));
    return;
  }

  const summary = [];
  for (const tablePlan of plan) {
    let loaded = 0;
    for (let index = 0; index < tablePlan.chunksData.length; index += 1) {
      const rows = tablePlan.chunksData[index];
      await upsertRows(tablePlan.tableName, tablePlan.conflictKey, tablePlan.columns, rows, token);
      loaded += rows.length;
      console.log(JSON.stringify({
        event: 'upsert',
        tableName: tablePlan.tableName,
        chunk: index + 1,
        chunks: tablePlan.chunks,
        rows: rows.length,
      }));
    }
    summary.push({ tableName: tablePlan.tableName, rows: tablePlan.rows, loaded });
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'write',
    writesPerformed: true,
    input: args.input,
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(redact(error && error.stack ? error.stack : error));
  process.exit(1);
});
