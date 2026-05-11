#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-minimal-dataset-google-sheets.json');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'qa-artifacts', 'supabase', 'minimal-sql-chunks');
const JSON_TAG = '$lljson$';

const TABLES = Object.freeze([
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
  const args = { input: DEFAULT_INPUT, outputDir: DEFAULT_OUTPUT_DIR, write: false, dryRun: false, maxRows: 25 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i] || args.input;
    else if (arg.startsWith('--input=')) args.input = arg.slice('--input='.length);
    else if (arg === '--output-dir') args.outputDir = argv[++i] || args.outputDir;
    else if (arg.startsWith('--output-dir=')) args.outputDir = arg.slice('--output-dir='.length);
    else if (arg === '--max-rows') args.maxRows = Number(argv[++i] || args.maxRows);
    else if (arg.startsWith('--max-rows=')) args.maxRows = Number(arg.slice('--max-rows='.length));
    else if (arg === '--write') args.write = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (args.write === args.dryRun) throw new Error('Choose exactly one mode: --dry-run or --write.');
  args.input = path.resolve(ROOT, args.input);
  args.outputDir = path.resolve(ROOT, args.outputDir);
  if (!Number.isInteger(args.maxRows) || args.maxRows < 1) throw new Error('--max-rows must be a positive integer.');
  return args;
}

function compactRows(rows, columns) {
  return (rows || []).map((row) => {
    const out = {};
    columns.forEach((column) => {
      if (Object.prototype.hasOwnProperty.call(row || {}, column)) out[column] = row[column];
    });
    return out;
  });
}

function sqlForRows(table, pk, columns, rows) {
  const columnList = columns.map((column) => `"${column}"`).join(', ');
  const updateList = columns
    .filter((column) => column !== pk)
    .map((column) => `"${column}" = excluded."${column}"`)
    .join(', ');
  const json = JSON.stringify(rows);
  return [
    `-- table=${table} rows=${rows.length}`,
    `insert into public.${table} (${columnList})`,
    `select ${columnList}`,
    `from jsonb_populate_recordset(null::public.${table}, ${JSON_TAG}${json}${JSON_TAG}::jsonb) as src`,
    `on conflict ("${pk}") do update set ${updateList};`,
    '',
  ].join('\n');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function cleanOutputDir(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.sql') || entry.name === 'manifest.json')) {
      fs.rmSync(path.join(outputDir, entry.name));
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const tables = payload.tables || payload;
  const files = [];
  let sequence = 1;
  TABLES.forEach(([table, pk, columns]) => {
    const rows = compactRows(tables[table] || [], columns);
    for (let offset = 0; offset < rows.length; offset += args.maxRows) {
      const chunk = rows.slice(offset, offset + args.maxRows);
      if (!chunk.length) continue;
      const sql = sqlForRows(table, pk, columns, chunk);
      const file = `${String(sequence).padStart(3, '0')}_${table}.sql`;
      files.push({ sequence, file, table, rows: chunk.length, offset, bytes: Buffer.byteLength(sql), sha256: sha256(sql), sql });
      sequence += 1;
    }
  });
  const manifest = {
    ok: true,
    mode: args.write ? 'write' : 'dry-run',
    writesPerformed: args.write,
    input: args.input,
    outputDir: args.outputDir,
    fileCount: files.length,
    totalRows: files.reduce((sum, file) => sum + file.rows, 0),
    tables: Object.fromEntries(TABLES.map(([table]) => [table, (tables[table] || []).length])),
    files: files.map(({ sql, ...file }) => file),
  };
  if (args.write) {
    cleanOutputDir(args.outputDir);
    files.forEach((file) => fs.writeFileSync(path.join(args.outputDir, file.file), file.sql, 'utf8'));
    fs.writeFileSync(path.join(args.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
  console.log(JSON.stringify(manifest, null, 2));
}

main();
