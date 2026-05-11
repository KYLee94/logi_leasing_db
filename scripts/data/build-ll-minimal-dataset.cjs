#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_LIVE_INPUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-dataset-google-sheets.json');
const DEFAULT_XLSX_INPUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-dataset-xlsx-source.json');
const DEFAULT_OUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-minimal-dataset-google-sheets.json');

const MINIMAL_TABLES = Object.freeze([
  'll_import_runs',
  'll_sheet_rows',
  'll_assets',
  'll_tenants',
  'll_leases',
  'll_lease_spaces',
  'll_rent_history',
  'll_asset_managers',
  'll_issues',
  'll_payload_snapshots',
]);

function parseArgs(argv) {
  const args = {
    liveInput: DEFAULT_LIVE_INPUT,
    xlsxInput: DEFAULT_XLSX_INPUT,
    out: DEFAULT_OUT,
    dryRun: false,
    write: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--live-input') args.liveInput = argv[++i] || args.liveInput;
    else if (arg.startsWith('--live-input=')) args.liveInput = arg.slice('--live-input='.length);
    else if (arg === '--xlsx-input') args.xlsxInput = argv[++i] || args.xlsxInput;
    else if (arg.startsWith('--xlsx-input=')) args.xlsxInput = arg.slice('--xlsx-input='.length);
    else if (arg === '--out') args.out = argv[++i] || args.out;
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--write') args.write = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (args.dryRun === args.write) throw new Error('Choose exactly one mode: --dry-run or --write.');
  args.liveInput = path.resolve(ROOT, args.liveInput);
  args.xlsxInput = path.resolve(ROOT, args.xlsxInput);
  args.out = path.resolve(ROOT, args.out);
  return args;
}

function readDataset(filePath) {
  if (!fs.existsSync(filePath)) return { tables: {} };
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { tables: parsed.tables || parsed };
}

function compactObject(row, columns) {
  const out = {};
  columns.forEach((column) => {
    if (Object.prototype.hasOwnProperty.call(row || {}, column)) out[column] = row[column];
  });
  return out;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value) !== '') return value;
  }
  return null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {}, Object.keys(value || {}).sort()), 'utf8').digest('hex');
}

function parseSourceRef(ref) {
  const text = String(ref || '');
  const match = text.match(/^(.+?)!(\d+)(?::\d+)?$/);
  if (!match) return null;
  return { sheetName: match[1], rowNumber: Number(match[2]) };
}

function buildSheetRowIndex(rows) {
  const index = new Map();
  rows.forEach((row) => {
    const key = `${row.sheet_name}|${row.row_number}`;
    index.set(key, row.sheet_row_id);
  });
  return index;
}

function compactSheetRowValues(rowValues, fallbackPayload) {
  if (!Array.isArray(rowValues) || !rowValues.length) return firstNonEmpty(fallbackPayload, {});
  return {
    format: 'columns_values_v1',
    columns: rowValues.map((cell, index) => ({
      index: Number(cell.column_index || index + 1),
      letter: cell.column_letter || null,
      header: firstNonEmpty(cell.header_name, cell.normalized_header, cell.column_key, null),
    })),
    values: rowValues.map((cell) => firstNonEmpty(cell.value, cell.display_value, cell.raw_value, '')),
  };
}

function sourceSheetRowId(row, index) {
  const parsed = parseSourceRef(row && row.source_ref);
  if (!parsed) return null;
  return index.get(`${parsed.sheetName}|${parsed.rowNumber}`) || null;
}

function normalizeSnapshotSource(row) {
  return Object.assign({}, row, {
    source: 'supabase_snapshot',
    source_system: 'google_sheets',
  });
}

function buildImportRun(liveTables) {
  const oldRun = (liveTables.ll_etl_runs || [])[0] || {};
  const now = new Date().toISOString();
  return {
    import_id: oldRun.run_id || `ll_import_${now.replace(/[^0-9]/g, '').slice(0, 14)}`,
    source_type: 'live_google_sheets',
    source_name: 'IGIS_Logistics_Leasing_Data',
    spreadsheet_id: '1powCa2TV7Pkqi3Un3mz3clJPwJ9xw7lMr1bZ0eLMqVA',
    file_name: null,
    started_at: oldRun.started_at || now,
    finished_at: oldRun.finished_at || now,
    status: oldRun.status || 'prepared',
    row_counts: oldRun.row_counts || {},
    memo: 'Minimal public.ll_* dataset prepared from live Google Sheets artifact.',
  };
}

function buildSheetRows(liveTables, importRun) {
  const sheetsById = new Map();
  (liveTables.ll_source_sheets || []).forEach((sheet) => {
    sheetsById.set(sheet.sheet_id, sheet);
  });
  return (liveTables.ll_source_rows || []).map((row) => {
    const sheet = sheetsById.get(row.sheet_id) || {};
    const rowValues = compactSheetRowValues(row.row_values, firstNonEmpty(row.raw_row_payload, row.source_payload, {}));
    return {
      sheet_row_id: row.row_uid || row.row_id,
      import_id: importRun.import_id,
      source_type: 'live_google_sheets',
      source_name: importRun.source_name,
      sheet_name: row.sheet_name || sheet.sheet_name || '',
      row_number: Number(row.row_number || row.row_index || 0),
      header_row_number: sheet.header_row || null,
      row_values_json: rowValues,
      row_hash: row.source_row_hash || row.row_hash || sha256(rowValues),
    };
  }).filter((row) => row.sheet_row_id && row.sheet_name && row.row_number);
}

function buildAssets(liveTables, sheetRowIndex, managersByAsset) {
  return (liveTables.ll_assets || []).map((row) => {
    const manager = managersByAsset.get(row.asset_id) || {};
    return Object.assign(compactObject(row, [
      'asset_id',
      'asset_code',
      'asset_name',
      'sector',
      'address',
      'latitude',
      'longitude',
      'approval_date',
      'first_configured_at',
      'gross_floor_area_sqm',
      'land_area_sqm',
      'floor_count',
      'source_payload',
      'review_status',
      'review_note',
    ]), {
      fund_code: firstNonEmpty(row.fund_code, row.source_payload && row.source_payload.raw && row.source_payload.raw['펀드코드']),
      fund_name: firstNonEmpty(row.fund_name, row.source_payload && row.source_payload.raw && row.source_payload.raw['펀드명']),
      current_manager_name: manager.manager_name || null,
      current_manager_team: manager.manager_team || manager.organization || null,
      current_manager_email: manager.manager_email || manager.email || null,
      source_sheet_row_id: sourceSheetRowId(row, sheetRowIndex),
    });
  });
}

function buildTenants(liveTables, sheetRowIndex) {
  return (liveTables.ll_tenants || []).map((row) => Object.assign(compactObject(row, [
    'tenant_id',
    'tenant_master_name',
    'raw_tenant_name',
    'business_registration_no',
    'dart_corp_code',
    'match_status',
    'industry_code',
    'headquarters_address',
    'listed_yn',
    'group_name',
    'source_payload',
    'review_status',
    'review_note',
  ]), {
    source_sheet_row_id: sourceSheetRowId(row, sheetRowIndex),
  }));
}

function addMissingTenantPlaceholders(tables) {
  const known = new Set((tables.ll_tenants || []).map((row) => row.tenant_id).filter(Boolean));
  const referenced = [];
  ['ll_leases', 'll_lease_spaces', 'll_rent_history', 'll_issues'].forEach((tableName) => {
    (tables[tableName] || []).forEach((row) => {
      if (row && row.tenant_id && !known.has(row.tenant_id)) referenced.push({ tableName, row });
    });
  });
  referenced.forEach(({ tableName, row }) => {
    if (!row.tenant_id || known.has(row.tenant_id)) return;
    known.add(row.tenant_id);
    const rawName = firstNonEmpty(
      row.source_payload && row.source_payload.raw_tenant_name,
      row.source_payload && row.source_payload.raw && row.source_payload.raw['임차인명'],
      row.tenant_master_name,
      row.tenant_name,
      row.tenant_id
    );
    tables.ll_tenants.push({
      tenant_id: row.tenant_id,
      tenant_master_name: rawName,
      raw_tenant_name: rawName,
      business_registration_no: null,
      dart_corp_code: null,
      match_status: 'missing_master_placeholder',
      industry_code: null,
      headquarters_address: null,
      listed_yn: null,
      group_name: null,
      source_sheet_row_id: row.source_sheet_row_id || null,
      source_payload: {
        generated_from: tableName,
        reason: 'Referenced tenant was missing from ll_tenants source artifact.',
        original_source_payload: row.source_payload || {},
      },
      review_status: 'review_required',
      review_note: '임대료 이력 또는 계약 데이터에서 참조되었으나 임차인 마스터에 없어 자동 placeholder로 생성됨',
    });
  });
}

function buildLeases(liveTables, sheetRowIndex) {
  return (liveTables.ll_leases || []).map((row) => Object.assign(compactObject(row, [
    'lease_id',
    'asset_id',
    'tenant_id',
    'lease_status',
    'contract_years',
    'extension_count',
    'deposit_amount',
    'rf_months',
    'fo_months',
    'ti_amount',
    'rent_escalation_rate',
    'management_fee_escalation_rate',
    'escalation_cycle_months',
    'next_escalation_date',
    'tenant_cost_burden',
    'early_termination_right',
    'renewal_option',
    'special_terms',
    'source_doc_ref',
    'source_payload',
    'review_status',
    'review_note',
  ]), {
    first_contract_date: row.first_contract_date || null,
    first_start_date: row.first_start_date || null,
    first_end_date: row.first_end_date || null,
    first_operation_date: row.first_operation_date || null,
    recent_contract_date: row.recent_contract_date || null,
    current_start_date: firstNonEmpty(row.current_start_date, row.start_date),
    current_end_date: firstNonEmpty(row.current_end_date, row.end_date),
    insurance_terms_json: row.insurance_terms_json || row.insurance_terms || {},
    source_sheet_row_id: sourceSheetRowId(row, sheetRowIndex),
  }));
}

function buildLeaseSpaces(liveTables, sheetRowIndex) {
  return (liveTables.ll_lease_spaces || []).map((row) => Object.assign(compactObject(row, [
    'lease_space_id',
    'lease_id',
    'asset_id',
    'tenant_id',
    'floor_label',
    'detail_area_label',
    'temperature_type',
    'leased_area_sqm',
    'exclusive_area_sqm',
    'exclusive_ratio',
    'current_monthly_rent_total',
    'current_monthly_mf_total',
    'current_monthly_cost_total',
    'e_noc',
    'formula_version',
    'contract_status',
    'source_payload',
    'review_status',
    'review_note',
  ]), {
    is_single_tenant: row.is_single_tenant == null ? null : row.is_single_tenant,
    is_preleased: row.is_preleased == null ? null : row.is_preleased,
    is_3pl: row.is_3pl == null ? null : row.is_3pl,
    goods_type: row.goods_type || null,
    area_breakdown_json: row.area_breakdown_json || row.area_breakdown || {},
    office_use_yn: row.office_use_yn || null,
    sublease_yn: row.sublease_yn || null,
    facility_specs_json: row.facility_specs_json || row.facility_specs || {},
    delinquency_yn: row.delinquency_yn || row.is_delinquent || null,
    source_sheet_row_id: sourceSheetRowId(row, sheetRowIndex),
  }));
}

function buildRentHistory(liveTables, sheetRowIndex) {
  return (liveTables.ll_rent_history || []).map((row) => ({
    rent_history_id: row.rent_history_id || row.history_event_id,
    lease_space_id: row.lease_space_id || null,
    lease_id: row.lease_id || null,
    asset_id: row.asset_id || null,
    tenant_id: row.tenant_id || null,
    effective_date: row.effective_date,
    change_reason: row.change_reason || null,
    leased_area_sqm: row.leased_area_sqm == null ? null : row.leased_area_sqm,
    exclusive_area_sqm: row.exclusive_area_sqm == null ? null : row.exclusive_area_sqm,
    monthly_rent_total: row.monthly_rent_total == null ? null : row.monthly_rent_total,
    monthly_mf_total: row.monthly_mf_total == null ? null : row.monthly_mf_total,
    rent_per_py: row.rent_per_py == null ? null : row.rent_per_py,
    mf_per_py: row.mf_per_py == null ? null : row.mf_per_py,
    is_latest: row.is_latest == null ? null : row.is_latest,
    match_status: row.match_status || null,
    source_sheet_row_id: sourceSheetRowId(row, sheetRowIndex),
    source_payload: row.source_payload || {},
    review_status: row.review_status || null,
    review_note: row.review_note || null,
  }));
}

function buildAssetManagers(liveTables, xlsxTables, sheetRowIndex) {
  const rows = (liveTables.ll_asset_managers || []).length
    ? liveTables.ll_asset_managers
    : (xlsxTables.ll_asset_managers || []);
  return rows.map((row) => ({
    asset_manager_id: row.asset_manager_id,
    asset_id: row.asset_id || null,
    asset_code: row.asset_code || null,
    asset_name: row.asset_name || null,
    fund_code: row.fund_code || null,
    fund_name: row.fund_name || null,
    manager_name: row.manager_name || null,
    manager_team: row.manager_team || row.organization || null,
    manager_email: row.manager_email || row.email || null,
    source_sheet_row_id: sourceSheetRowId(row, sheetRowIndex),
    source_payload: row.source_payload || {},
  })).filter((row) => row.asset_manager_id);
}

function buildIssues(liveTables, sheetRowIndex) {
  return (liveTables.ll_issues || []).map((row) => Object.assign(compactObject(row, [
    'issue_id',
    'entity_type',
    'entity_id',
    'asset_id',
    'tenant_id',
    'issue_type',
    'severity',
    'title',
    'description',
    'status',
    'due_date',
    'owner',
    'source_payload',
  ]), {
    source_sheet_row_id: sourceSheetRowId(row, sheetRowIndex),
  }));
}

function buildPayloadSnapshots(liveTables) {
  return (liveTables.ll_payload_snapshots || []).map(normalizeSnapshotSource);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const live = readDataset(args.liveInput);
  const xlsx = readDataset(args.xlsxInput);
  const liveTables = live.tables || {};
  const xlsxTables = xlsx.tables || {};
  const importRun = buildImportRun(liveTables);
  const sheetRows = buildSheetRows(liveTables, importRun);
  const sheetRowIndex = buildSheetRowIndex(sheetRows);
  const assetManagers = buildAssetManagers(liveTables, xlsxTables, sheetRowIndex);
  const managersByAsset = new Map(assetManagers.map((row) => [row.asset_id, row]));
  const tables = {
    ll_import_runs: [importRun],
    ll_sheet_rows: sheetRows,
    ll_assets: buildAssets(liveTables, sheetRowIndex, managersByAsset),
    ll_tenants: buildTenants(liveTables, sheetRowIndex),
    ll_leases: buildLeases(liveTables, sheetRowIndex),
    ll_lease_spaces: buildLeaseSpaces(liveTables, sheetRowIndex),
    ll_rent_history: buildRentHistory(liveTables, sheetRowIndex),
    ll_asset_managers: assetManagers,
    ll_issues: buildIssues(liveTables, sheetRowIndex),
    ll_payload_snapshots: buildPayloadSnapshots(liveTables),
  };
  addMissingTenantPlaceholders(tables);
  const counts = Object.fromEntries(MINIMAL_TABLES.map((tableName) => [tableName, (tables[tableName] || []).length]));
  const summary = {
    ok: true,
    mode: args.write ? 'write' : 'dry-run',
    writesPerformed: args.write,
    out: args.out,
    counts,
    sourceFiles: {
      liveInput: args.liveInput,
      xlsxInput: args.xlsxInput,
    },
  };
  if (args.write) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify({ tables, counts, generated_at: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  }
  console.log(JSON.stringify(summary, null, 2));
}

main();
