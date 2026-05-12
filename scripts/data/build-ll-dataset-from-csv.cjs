#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CSV_DIR = 'C:\\tmp';
const DEFAULT_OUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-dataset-google-sheets.json');

const CSV_FILES = Object.freeze({
  general: 'logi_db_general.csv',
  history: 'logi_db_history.csv',
  asset: 'logi_db_asset.csv',
  company: 'logi_db_company.csv',
  issue: 'logi_issue_list.csv',
});

const CSV_SOURCES = Object.freeze([
  { key: 'general', file: CSV_FILES.general, sheetName: 'DB_일반', sheetId: 'sheet_db_general' },
  { key: 'history', file: CSV_FILES.history, sheetName: 'DB_히스토리 누적', sheetId: 'sheet_db_history' },
  { key: 'asset', file: CSV_FILES.asset, sheetName: 'DB_자산', sheetId: 'sheet_db_asset' },
  { key: 'company', file: CSV_FILES.company, sheetName: 'DB_기업', sheetId: 'sheet_db_company' },
  { key: 'issue', file: CSV_FILES.issue, sheetName: '이슈 리스트', sheetId: 'sheet_issue_list' },
]);

function parseArgs(argv) {
  const args = { csvDir: DEFAULT_CSV_DIR, out: DEFAULT_OUT, snapshots: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--csv-dir') args.csvDir = argv[++index] || args.csvDir;
    else if (arg.startsWith('--csv-dir=')) args.csvDir = arg.slice('--csv-dir='.length);
    else if (arg === '--out') args.out = argv[++index] || args.out;
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else if (arg === '--no-snapshots') args.snapshots = false;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsv(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || '').trim());
  return rows.slice(1).filter((row) => row.some((value) => String(value || '').trim())).map((row, index) => {
    const object = { _rowNumber: index + 2 };
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      object[header] = row[columnIndex] == null ? '' : row[columnIndex];
    });
    return object;
  });
}

function pick(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row || {}, name)) {
      const value = row[name];
      if (value !== null && value !== undefined && String(value).trim() !== '') return String(value).trim();
    }
  }
  return '';
}

function cleanNumber(value) {
  const text = String(value == null ? '' : value).replace(/,/g, '').replace(/%/g, '').trim();
  if (!text || text === '-') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function cleanDate(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text || text === '-') return null;
  const normalized = text.replace(/\./g, '-').replace(/\//g, '-');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return text;
  return [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
}

function brnDigits(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function idPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function hash(value) {
  return crypto.createHash('sha1').update(String(value == null ? '' : value)).digest('hex');
}

function sourceRef(table, rowNumber) {
  return `${table}!${rowNumber || ''}`;
}

function sourcePayload(row, table, pk) {
  return {
    source: { system: 'google_sheets', table, pk: String(pk || '') },
    source_row_number: row && row._rowNumber ? row._rowNumber : null,
    source_row_hash: pick(row, ['source_row_hash']) || hash(JSON.stringify(row || {})),
    raw_asset_name: pick(row, ['자산명', 'asset_name', '관련 자산']) || null,
    raw_tenant_name: pick(row, ['임차인명', 'tenant_master_name', '표준기업명']) || null,
  };
}

function sourceBase(table, row, pkParts) {
  const pk = pick(row, ['source_row_hash']) || String(pkParts.filter(Boolean).join('|') || row._rowNumber || '');
  return {
    source_system: 'google_sheets',
    source_table: table,
    source_pk: pk,
    source_ref: sourceRef(table, row._rowNumber),
    source_row_hash: pick(row, ['source_row_hash']) || hash(JSON.stringify(row)),
    source_payload: sourcePayload(row, table, pk),
  };
}

function columnLetter(index) {
  let value = Number(index);
  let text = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    text = String.fromCharCode(65 + remainder) + text;
    value = Math.floor((value - 1) / 26);
  }
  return text || 'A';
}

function normalizeHeader(header, columnIndex) {
  const text = String(header == null ? '' : header).trim();
  if (!text) return `blank_col_${String(columnIndex).padStart(3, '0')}`;
  return text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || `col_${String(columnIndex).padStart(3, '0')}`;
}

function inferColumnRole(header) {
  const text = String(header || '').trim();
  if (!text) return 'blank_header';
  if (/review|검증|이슈|확정|가정|결론|질문|처리|반영|해결|상태|note/i.test(text)) return 'quality_review';
  if (/source|hash|id$|_id$|fetched|fetch|DART|corp|sigungu|bjdong|plat|bun|ji/i.test(text)) return 'source_tracking';
  if (/계산|formula|eNOC|NOI|audit|check|status/i.test(text)) return 'derived_check';
  return 'business_value';
}

function inferValueType(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return 'blank';
  if (/^(true|false)$/i.test(text)) return 'boolean_text';
  if (/^-?\d+(,\d{3})*(\.\d+)?%?$/.test(text) || /^-?\d+(\.\d+)?%?$/.test(text)) return 'number_text';
  if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(text)) return 'date_text';
  return 'text';
}

function readRawSheet(csvDir, source) {
  const filePath = path.join(csvDir, source.file);
  const parsedRows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const headers = (parsedRows[0] || []).map((header) => String(header || '').replace(/^\uFEFF/, '').trim());
  const dataRows = parsedRows.slice(1).filter((row) => row.some((value) => String(value || '').trim() !== ''));
  const columnCount = headers.length;
  return {
    source,
    filePath,
    headers,
    dataRows: dataRows.map((row) => {
      const values = [];
      for (let index = 0; index < columnCount; index += 1) {
        values.push(row[index] == null ? '' : String(row[index]));
      }
      return values;
    }),
  };
}

function buildRawSourceTables(csvDir, runId) {
  const sheets = [];
  const columns = [];
  const rows = [];
  const sourceRowUidByRef = new Map();

  CSV_SOURCES.forEach((source) => {
    const raw = readRawSheet(csvDir, source);
    const headerHash = hash(JSON.stringify(raw.headers));
    const dataRowHashes = raw.dataRows.map((values) => hash(JSON.stringify(values)));
    const sheetPayload = {
      source: { system: 'google_sheets', table: source.sheetName, file: source.file },
      header_values: raw.headers,
      note: 'CSV export preserves the current used-range values supplied for migration.',
    };

    sheets.push({
      sheet_id: source.sheetId,
      source_system: 'google_sheets',
      sheet_name: source.sheetName,
      source_file: source.file,
      row_count: raw.dataRows.length,
      column_count: raw.headers.length,
      cell_count: raw.dataRows.length * raw.headers.length,
      header_hash: headerHash,
      data_hash: hash(dataRowHashes.join('|')),
      source_payload: sheetPayload,
      last_etl_run_id: runId,
    });

    raw.headers.forEach((headerName, columnOffset) => {
      const columnIndex = columnOffset + 1;
      const sampleValues = raw.dataRows
        .map((row) => row[columnOffset])
        .filter((value) => String(value || '').trim() !== '')
        .slice(0, 5);
      columns.push({
        column_uid: `${source.sheetId}:c${String(columnIndex).padStart(3, '0')}`,
        sheet_id: source.sheetId,
        source_system: 'google_sheets',
        sheet_name: source.sheetName,
        column_index: columnIndex,
        column_letter: columnLetter(columnIndex),
        header_name: headerName,
        normalized_header: normalizeHeader(headerName, columnIndex),
        column_role: inferColumnRole(headerName),
        value_type_guess: sampleValues.length ? inferValueType(sampleValues[0]) : 'blank',
        is_blank_header: !String(headerName || '').trim(),
        sample_values: sampleValues,
        source_ref: `${source.sheetName}!${columnLetter(columnIndex)}1`,
        last_etl_run_id: runId,
      });
    });

    raw.dataRows.forEach((values, rowOffset) => {
      const rowNumber = rowOffset + 2;
      const cellValues = raw.headers.map((headerName, columnOffset) => {
        const columnIndex = columnOffset + 1;
        const rawValue = values[columnOffset] == null ? '' : String(values[columnOffset]);
        return {
          column_index: columnIndex,
          column_letter: columnLetter(columnIndex),
          column_key: `c${String(columnIndex).padStart(3, '0')}`,
          header_name: headerName,
          normalized_header: normalizeHeader(headerName, columnIndex),
          value: rawValue,
          value_type: inferValueType(rawValue),
          is_blank: rawValue.trim() === '',
          a1_ref: `${source.sheetName}!${columnLetter(columnIndex)}${rowNumber}`,
        };
      });
      const rowHash = hash(JSON.stringify(cellValues.map((cell) => cell.value)));
      rows.push({
        row_uid: `${source.sheetId}:r${String(rowNumber).padStart(6, '0')}`,
        sheet_id: source.sheetId,
        source_system: 'google_sheets',
        sheet_name: source.sheetName,
        row_index: rowOffset + 1,
        row_number: rowNumber,
        source_ref: `${source.sheetName}!${rowNumber}:${rowNumber}`,
        source_row_hash: rowHash,
        non_empty_cell_count: cellValues.filter((cell) => !cell.is_blank).length,
        row_values: cellValues,
        raw_row_payload: {
          source: { system: 'google_sheets', table: source.sheetName, file: source.file, row_number: rowNumber },
          values,
        },
        last_etl_run_id: runId,
      });
      const rowUid = `${source.sheetId}:r${String(rowNumber).padStart(6, '0')}`;
      sourceRowUidByRef.set(`${source.sheetName}!${rowNumber}`, rowUid);
      sourceRowUidByRef.set(`${source.sheetName}!${rowNumber}:${rowNumber}`, rowUid);
    });
  });

  return {
    ll_source_sheets: sheets,
    ll_source_columns: columns,
    ll_source_rows: rows,
    sourceRowUidByRef,
  };
}

function buildNormalizationLinks(tables, sourceRowUidByRef, runId) {
  const linkTables = [
    ['ll_funds', 'fund_id'],
    ['ll_assets', 'asset_id'],
    ['ll_tenants', 'tenant_id'],
    ['ll_leases', 'lease_id'],
    ['ll_lease_spaces', 'lease_space_id'],
    ['ll_rent_history', 'history_event_id'],
    ['ll_issues', 'issue_id'],
  ];
  const links = [];
  linkTables.forEach(([tableName, primaryKey]) => {
    (tables[tableName] || []).forEach((row) => {
      const sourceRef = row.source_ref || '';
      const sourceRowUid = sourceRowUidByRef.get(sourceRef) || null;
      const targetPk = row[primaryKey] || '';
      if (!targetPk) return;
      links.push({
        link_id: `link_${hash(`${sourceRef}|${tableName}|${targetPk}`).slice(0, 24)}`,
        source_system: 'google_sheets',
        source_sheet_name: row.source_table || null,
        source_ref: sourceRef,
        source_row_uid: sourceRowUid,
        target_table: tableName,
        target_pk: String(targetPk),
        target_column: null,
        link_type: 'row_to_entity',
        confidence: sourceRowUid ? 1 : 0.5,
        rule_version: 'csv_import_v1',
        last_etl_run_id: runId,
      });
    });
  });
  return links;
}

function reviewStatus(row) {
  return pick(row, ['review_status']) || 'ok';
}

function reviewNote(row) {
  return pick(row, ['review_note']) || null;
}

function assetIdFrom(row) {
  const explicit = pick(row, ['asset_id']);
  if (explicit) return explicit;
  const assetCode = pick(row, ['자산코드', 'asset_code']);
  if (assetCode) return `asset_${idPart(assetCode)}`;
  const assetName = pick(row, ['자산명', 'asset_name']);
  if (assetName) return `asset_${hash(assetName).slice(0, 12)}`;
  return '';
}

function tenantIdFrom(row) {
  const explicit = pick(row, ['tenant_id']);
  if (explicit) return explicit;
  const brn = brnDigits(pick(row, ['사업자등록번호', '임차인 사업자번호', 'business_registration_no']));
  if (brn) return `tenant_brn_${brn}`;
  return `tenant_name_${idPart(pick(row, ['표준기업명', '임차인명', 'tenant_master_name'])) || hash(JSON.stringify(row)).slice(0, 12)}`;
}

function hasAssetIdentity(row) {
  return !!(pick(row, ['asset_id']) || pick(row, ['자산코드', 'asset_code']) || pick(row, ['자산명', 'asset_name']));
}

function buildDataset(csvDir, includeSnapshots) {
  const now = new Date().toISOString();
  const runId = `ll_google_sheets_${now.replace(/[^0-9]/g, '').slice(0, 14)}`;
  const generalRows = readCsv(path.join(csvDir, CSV_FILES.general));
  const historyRows = readCsv(path.join(csvDir, CSV_FILES.history));
  const assetRows = readCsv(path.join(csvDir, CSV_FILES.asset));
  const companyRows = readCsv(path.join(csvDir, CSV_FILES.company));
  const issueRows = readCsv(path.join(csvDir, CSV_FILES.issue));

  const funds = new Map();
  const assets = new Map();
  const tenants = new Map();
  const leases = new Map();
  const leaseSpaces = [];
  const rentHistory = [];
  const issues = [];
  const leaseSpaceIndex = new Map();
  const assetNameIndex = new Map();
  const rawSourceTables = buildRawSourceTables(csvDir, runId);

  function rememberAssetName(name, id) {
    if (name && id) assetNameIndex.set(String(name).replace(/\s+/g, '').toLowerCase(), id);
  }

  generalRows.forEach((row) => {
    const fundId = pick(row, ['fund_id']) || (pick(row, ['펀드코드']) ? `fund_${idPart(pick(row, ['펀드코드']))}` : '');
    if (fundId && !funds.has(fundId)) {
      funds.set(fundId, Object.assign({
        fund_id: fundId,
        fund_code: pick(row, ['펀드코드', 'fund_code']) || null,
        fund_name: pick(row, ['펀드명', 'fund_name']) || null,
        raw_fund_name: pick(row, ['펀드명', 'fund_name']) || null,
        sector: pick(row, ['섹터']) || null,
        is_active: true,
        review_status: reviewStatus(row),
        last_etl_run_id: runId,
      }, sourceBase('DB_일반', row, [fundId, row._rowNumber])));
    }
  });

  assetRows.forEach((row) => {
    const assetId = assetIdFrom(row);
    const assetCode = pick(row, ['자산코드', 'asset_code']);
    const assetName = pick(row, ['자산명', 'asset_name']);
    if (!assetName) return;
    rememberAssetName(assetName, assetId);
    assets.set(assetId, Object.assign({
      asset_id: assetId,
      asset_code: assetCode || null,
      asset_name: assetName,
      raw_asset_name: assetName,
      fund_id: null,
      sector: '물류센터',
      address: pick(row, ['standardized_address', '도로명주소']) || null,
      latitude: cleanNumber(pick(row, ['latitude'])),
      longitude: cleanNumber(pick(row, ['longitude'])),
      approval_date: cleanDate(pick(row, ['사용승인일'])),
      first_configured_at: cleanDate(pick(row, ['최초 설정일'])),
      gross_floor_area_sqm: cleanNumber(pick(row, ['연면적'])),
      land_area_sqm: cleanNumber(pick(row, ['대지면적'])),
      floor_count: pick(row, ['층수']) || null,
      is_active: true,
      review_status: reviewStatus(row),
      review_note: reviewNote(row),
      last_etl_run_id: runId,
    }, sourceBase('DB_자산', row, [assetId, assetCode, row._rowNumber])));
  });

  companyRows.forEach((row) => {
    const tenantId = tenantIdFrom(row);
    const tenantName = pick(row, ['표준기업명', 'tenant_master_name']);
    if (!tenantName) return;
    tenants.set(tenantId, Object.assign({
      tenant_id: tenantId,
      tenant_master_name: tenantName,
      raw_tenant_name: tenantName,
      business_registration_no: pick(row, ['사업자등록번호', 'business_registration_no']) || null,
      dart_corp_code: pick(row, ['DART_corp_code', 'dart_corp_code']) || null,
      match_status: pick(row, ['match_status', 'DART 매칭 상태']) || null,
      industry_code: pick(row, ['업종', 'industry_code']) || null,
      headquarters_address: pick(row, ['본점소재지', 'headquarters_address']) || null,
      listed_yn: pick(row, ['상장여부', 'listed_yn']) || null,
      group_name: pick(row, ['그룹명', 'group_name']) || null,
      is_active: true,
      review_status: reviewStatus(row),
      review_note: reviewNote(row),
      last_etl_run_id: runId,
    }, sourceBase('DB_기업', row, [tenantId, row._rowNumber])));
  });

  generalRows.forEach((row) => {
    if (!hasAssetIdentity(row)) return;
    const assetId = assetIdFrom(row);
    const assetName = pick(row, ['자산명', 'asset_name']);
    const tenantId = tenantIdFrom(row);
    const tenantName = pick(row, ['tenant_master_name', '임차인명']);
    const fundId = pick(row, ['fund_id']) || (pick(row, ['펀드코드']) ? `fund_${idPart(pick(row, ['펀드코드']))}` : null);
    if (assetName) rememberAssetName(assetName, assetId);
    if (assetName && !assets.has(assetId)) {
      assets.set(assetId, Object.assign({
        asset_id: assetId,
        asset_code: pick(row, ['자산코드', 'asset_code']) || null,
        asset_name: assetName,
        raw_asset_name: assetName,
        fund_id: fundId,
        sector: pick(row, ['섹터']) || null,
        gross_floor_area_sqm: cleanNumber(pick(row, ['전체 연면적'])),
        is_active: true,
        review_status: reviewStatus(row),
        review_note: reviewNote(row),
        last_etl_run_id: runId,
      }, sourceBase('DB_일반', row, [assetId, row._rowNumber])));
    } else if (assets.has(assetId) && fundId && !assets.get(assetId).fund_id) {
      assets.get(assetId).fund_id = fundId;
    }
    if (tenantName && !tenants.has(tenantId)) {
      tenants.set(tenantId, Object.assign({
        tenant_id: tenantId,
        tenant_master_name: pick(row, ['tenant_master_name']) || tenantName,
        raw_tenant_name: pick(row, ['임차인명']) || tenantName,
        business_registration_no: pick(row, ['임차인 사업자번호']) || null,
        match_status: 'from_contract',
        is_active: true,
        review_status: reviewStatus(row),
        review_note: reviewNote(row),
        last_etl_run_id: runId,
      }, sourceBase('DB_일반', row, [tenantId, row._rowNumber])));
    }

    const leaseId = pick(row, ['lease_id']) || `${assetId}|${tenantId}|${cleanDate(pick(row, ['현재 계약개시일'])) || ''}|${cleanDate(pick(row, ['현재 계약만기일'])) || ''}`;
    if (assetId && tenantId && !leases.has(leaseId)) {
      leases.set(leaseId, Object.assign({
        lease_id: leaseId,
        asset_id: assetId,
        tenant_id: tenantId,
        lease_status: pick(row, ['계약 상태']) || null,
        start_date: cleanDate(pick(row, ['현재 계약개시일'])),
        end_date: cleanDate(pick(row, ['현재 계약만기일'])),
        contract_years: cleanNumber(pick(row, ['현재 계약기간'])),
        rf_months: cleanNumber(pick(row, ['RF'])),
        fo_months: cleanNumber(pick(row, ['FO'])),
        ti_amount: cleanNumber(pick(row, ['TI'])),
        deposit_amount: cleanNumber(pick(row, ['임대보증금'])),
        renewal_option: pick(row, ['갱신 옵션']) || null,
        early_termination_right: pick(row, ['중도해지권']) || null,
        special_terms: [pick(row, ['보험 관련 특수 계약 조건']), pick(row, ['기타 각종 특수 계약 조건'])].filter(Boolean).join(' | ') || null,
        source_doc_ref: pick(row, ['source_doc_ref']) || null,
        is_active: pick(row, ['계약 상태']) !== 'N',
        review_status: reviewStatus(row),
        review_note: reviewNote(row),
        last_etl_run_id: runId,
      }, sourceBase('DB_일반', row, [leaseId, row._rowNumber])));
    }

    const leaseSpaceId = pick(row, ['lease_space_id']) || `${leaseId}|${pick(row, ['임차 층'])}|${pick(row, ['임차 세부 구역']) || 'na'}`;
    leaseSpaceIndex.set(leaseSpaceId, { leaseId, assetId, tenantId });
    leaseSpaces.push(Object.assign({
      lease_space_id: leaseSpaceId,
      lease_id: leaseId,
      asset_id: assetId,
      tenant_id: tenantId,
      floor_label: pick(row, ['임차 층']) || null,
      detail_area_label: pick(row, ['임차 세부 구역']) || null,
      temperature_type: pick(row, ['저온창고 여부']) || null,
      leased_area_sqm: cleanNumber(pick(row, ['임대면적'])),
      exclusive_area_sqm: cleanNumber(pick(row, ['전용면적'])),
      exclusive_ratio: cleanNumber(pick(row, ['전용률'])),
      current_monthly_rent_total: null,
      current_monthly_mf_total: null,
      current_monthly_cost_total: null,
      e_noc: null,
      formula_version: null,
      is_active: pick(row, ['계약 상태']) !== 'N',
      review_status: reviewStatus(row),
      review_note: reviewNote(row),
      last_etl_run_id: runId,
    }, sourceBase('DB_일반', row, [leaseSpaceId, row._rowNumber])));
  });

  historyRows.forEach((row) => {
    const rawLeaseSpaceId = pick(row, ['lease_space_id']);
    const linked = leaseSpaceIndex.get(rawLeaseSpaceId) || {};
    if (!linked.assetId && !hasAssetIdentity(row)) return;
    const assetId = linked.assetId || assetIdFrom(row);
    const tenantId = linked.tenantId || tenantIdFrom(row);
    const leaseSpaceId = linked.leaseId ? rawLeaseSpaceId : null;
    const leaseId = linked.leaseId || null;
    const historyId = pick(row, ['history_event_id']) || `${rawLeaseSpaceId || 'unmatched'}|${cleanDate(pick(row, ['기준일자']))}|${row._rowNumber}`;
    rentHistory.push(Object.assign({
      history_event_id: historyId,
      lease_space_id: leaseSpaceId || null,
      lease_id: leaseId || null,
      asset_id: assetId || null,
      tenant_id: tenantId || null,
      effective_date: cleanDate(pick(row, ['기준일자'])),
      leased_area_sqm: cleanNumber(pick(row, ['임대면적'])),
      rent_per_py: cleanNumber(pick(row, ['평당 월임대료'])),
      mf_per_py: cleanNumber(pick(row, ['평당 월관리비'])),
      monthly_rent_total: cleanNumber(pick(row, ['월임대료 총액'])),
      monthly_mf_total: cleanNumber(pick(row, ['월관리비 총액'])),
      is_latest: /^true$/i.test(pick(row, ['is_latest'])),
      review_status: reviewStatus(row),
      review_note: reviewNote(row),
      last_etl_run_id: runId,
    }, sourceBase('DB_히스토리 누적', row, [historyId, row._rowNumber])));
  });

  issueRows.forEach((row, index) => {
    const rawId = pick(row, ['순번']) || String(index + 1);
    const relatedAssetName = pick(row, ['관련 자산']);
    const assetId = assetNameIndex.get(relatedAssetName.replace(/\s+/g, '').toLowerCase()) || null;
    const issueId = `issue_${idPart(rawId)}_${hash(JSON.stringify(row)).slice(0, 8)}`;
    issues.push(Object.assign({
      issue_id: issueId,
      entity_type: pick(row, ['관련 시트']) || 'asset',
      entity_id: assetId,
      asset_id: assetId,
      tenant_id: null,
      issue_type: pick(row, ['구분']) || 'source_issue',
      severity: pick(row, ['우선순위']) || 'review',
      title: pick(row, ['내용']).slice(0, 120) || '데이터 이슈',
      description: pick(row, ['담당자 확인 질문']) || pick(row, ['최종 결론']) || pick(row, ['내용']) || null,
      status: /^true$/i.test(pick(row, ['이슈 해결 여부'])) ? 'resolved' : 'open',
      due_date: null,
      owner: pick(row, ['처리주체']) || null,
      last_etl_run_id: runId,
    }, sourceBase('이슈 리스트', row, [issueId, row._rowNumber])));
  });

  const tables = {
    ll_etl_runs: [{
      run_id: runId,
      source_system: 'google_sheets',
      run_type: 'csv_to_supabase',
      status: 'prepared',
      started_at: now,
      row_counts: {},
      metadata: {
        csvDir,
        sourceFiles: CSV_FILES,
        sourceSystem: 'google_sheets',
      },
    }],
    ll_funds: [...funds.values()],
    ll_assets: [...assets.values()],
    ll_tenants: [...tenants.values()],
    ll_leases: [...leases.values()],
    ll_lease_spaces: leaseSpaces,
    ll_rent_history: rentHistory,
    ll_issues: issues,
    ll_source_sheets: rawSourceTables.ll_source_sheets,
    ll_source_columns: rawSourceTables.ll_source_columns,
    ll_source_rows: rawSourceTables.ll_source_rows,
    ll_normalization_links: [],
    ll_user_permissions: [],
    ll_edit_sessions: [],
    ll_cell_edits: [],
    ll_payload_snapshots: [],
  };
  tables.ll_normalization_links = buildNormalizationLinks(tables, rawSourceTables.sourceRowUidByRef, runId);
  if (includeSnapshots) {
    tables.ll_payload_snapshots = buildSnapshotRows(now, tables);
  }
  tables.ll_etl_runs[0].row_counts = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]));
  return { generatedAt: now, syncRunId: runId, tables };
}

function sanitizePublicPayload(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => sanitizePublicPayload(item, key)).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') {
    const text = String(value == null ? '' : value);
    if (/SUPABASE_SERVICE_ROLE_KEY|OPENDART_API_KEY|BUILDING_REGISTER_API_KEY|NAVER_MAPS_CLIENT_SECRET|service role|script properties/i.test(text)) return undefined;
    return value;
  }
  const result = {};
  Object.entries(value).forEach(([childKey, childValue]) => {
    if (/password|secret|authorization|bearer|api.?key|scriptProperty|runtimeInjectionKey|spreadsheetId|review|audit|calculation|formula|eNocAudit|historyLinkStatus|source_payload|sourceRowHash|source_row_hash|sourceDocRef/i.test(childKey)) {
      return;
    }
    const next = sanitizePublicPayload(childValue, childKey);
    if (next !== undefined) result[childKey] = next;
  });
  return result;
}

function staticKey(page, id) {
  const normalizedPage = String(page || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const normalizedId = String(id || 'DEFAULT').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 80);
  return `STATIC_${normalizedPage}_PAYLOAD_${normalizedId}_JSON`;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function snapshotRecord(page, id, payload, generatedAt) {
  const safePayload = sanitizePublicPayload(payload || {});
  return {
    snapshot_key: staticKey(page, id || 'default'),
    page,
    entity_id: id || 'default',
    payload: safePayload,
    user_safe: true,
    generated_at: safePayload.generatedAt || generatedAt,
    schema_version: safePayload.schemaVersion || 'dashboard_payload_v1',
    source: 'google_sheets_model_snapshot',
    source_system: 'google_sheets',
  };
}

function groupBy(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const value = row[key] || '';
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  });
  return map;
}

function sum(rows, key) {
  return rows.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
}

function buildMinimalSnapshots(generatedAt, tables) {
  const assets = tables.ll_assets || [];
  const tenants = tables.ll_tenants || [];
  const leases = tables.ll_leases || [];
  const leaseSpaces = tables.ll_lease_spaces || [];
  const rentHistory = tables.ll_rent_history || [];
  const assetsById = new Map(assets.map((row) => [row.asset_id, row]));
  const tenantsById = new Map(tenants.map((row) => [row.tenant_id, row]));
  const spacesByAsset = groupBy(leaseSpaces, 'asset_id');
  const spacesByTenant = groupBy(leaseSpaces, 'tenant_id');

  const assetOptions = assets.map((asset) => {
    const rows = spacesByAsset.get(asset.asset_id) || [];
    return {
      assetId: asset.asset_id,
      assetName: asset.asset_name,
      monthlyCostTotal: sum(rows, 'current_monthly_cost_total'),
      vacancyRate: 0,
      uniqueTenantCount: new Set(rows.map((row) => row.tenant_id).filter(Boolean)).size,
      fetchedAt: generatedAt,
    };
  }).sort((a, b) => a.assetName.localeCompare(b.assetName, 'ko'));

  const companyOptions = tenants.map((tenant) => {
    const rows = spacesByTenant.get(tenant.tenant_id) || [];
    return {
      tenantId: tenant.tenant_id,
      tenantMasterName: tenant.tenant_master_name,
      assetCount: new Set(rows.map((row) => row.asset_id).filter(Boolean)).size,
      monthlyCostTotal: sum(rows, 'current_monthly_cost_total'),
      latestExpiry: leases.filter((lease) => lease.tenant_id === tenant.tenant_id).map((lease) => lease.end_date).filter(Boolean).sort().slice(-1)[0] || '',
      exposureAvailable: rows.length > 0,
    };
  }).sort((a, b) => a.tenantMasterName.localeCompare(b.tenantMasterName, 'ko'));

  const defaultAsset = assetOptions[0] || {};
  const defaultCompany = companyOptions[0] || {};
  const home = {
    generatedAt,
    schemaVersion: 'github_pages_home_v1',
    kpis: [
      { key: 'operating_asset_count', label: '운영 자산', value: assets.length },
      { key: 'tenant_count', label: '임차인', value: tenants.length },
      { key: 'lease_count', label: '계약', value: leases.length },
      { key: 'lease_space_count', label: '공간', value: leaseSpaces.length },
      { key: 'rent_history_count', label: '이력', value: rentHistory.length },
    ],
    topTenants: companyOptions.slice(0, 12).map((tenant) => ({
      tenantMasterName: tenant.tenantMasterName,
      monthlyCostTotal: tenant.monthlyCostTotal,
      latestExpiry: tenant.latestExpiry,
      area: `${tenant.assetCount} assets`,
    })),
    rentTrendSummary: { title: 'Google Sheets 물류 원본', summary: 'Supabase ll_* 정규화 데이터 기준' },
    occupancy: assetOptions.slice(0, 4).map((asset) => ({ label: asset.assetName, value: `${asset.uniqueTenantCount} tenants` })),
    tenantSummary: companyOptions.slice(0, 4).map((tenant) => ({ label: tenant.tenantMasterName, value: `${tenant.assetCount} assets` })),
    rentTrend: [],
  };

  const sector = {
    generatedAt,
    schemaVersion: 'github_pages_sector_v1',
    kpis: [
      { label: '자산', value: assets.length },
      { label: '임차인', value: tenants.length },
      { label: '계약', value: leases.length },
      { label: '공간', value: leaseSpaces.length },
      { label: '이력', value: rentHistory.length },
    ],
    rankings: {
      assetsByArea: assetOptions.map((asset) => ({
        assetName: asset.assetName,
        leasedAreaSqm: sum(spacesByAsset.get(asset.assetId) || [], 'leased_area_sqm'),
        monthlyCostTotal: asset.monthlyCostTotal,
        vacancyRate: 0,
      })),
    },
    expiryRows: leases.slice(0, 40).map((lease) => ({
      assetName: assetsById.get(lease.asset_id)?.asset_name || lease.asset_id,
      tenantMasterName: tenantsById.get(lease.tenant_id)?.tenant_master_name || lease.tenant_id,
      latestExpiry: lease.end_date || '',
      leasedAreaSqm: sum(leaseSpaces.filter((space) => space.lease_id === lease.lease_id), 'leased_area_sqm'),
    })),
    expiryBuckets: [],
  };

  const tools = {
    generatedAt,
    selectionMeta: { summaryLabel: 'Google Sheets 물류 원본', reason: 'Supabase ll_* normalized tables', isDefaultSelection: true },
    filters: [
      { label: 'Source', value: 'google_sheets' },
      { label: 'Tables', value: 'public.ll_* only' },
    ],
    benchmarkRows: [],
    companies: companyOptions.slice(0, 8),
    assets: assetOptions.slice(0, 8),
    deltas: [],
  };

  const playground = {
    generatedAt,
    summaryCards: [
      { label: 'Assets', value: assets.length, caption: 'll_assets' },
      { label: 'Tenants', value: tenants.length, caption: 'll_tenants' },
      { label: 'Leases', value: leases.length, caption: 'll_leases' },
      { label: 'Spaces', value: leaseSpaces.length, caption: 'll_lease_spaces' },
      { label: 'History', value: rentHistory.length, caption: 'll_rent_history' },
    ],
    metrics: [],
    savedViews: [],
    rows: assets.slice(0, 20).map((asset) => ({ label: asset.asset_name, value: asset.asset_code || asset.asset_id, basis: asset.source_ref })),
  };

  const bootstrap = {
    appName: 'Logistics Leasing Dashboard',
    generatedAt,
    dataVersion: 'github-pages-supabase-v1',
    assetOptions,
    companyOptions,
    defaults: {
      assetId: defaultAsset.assetId || '',
      tenantId: defaultCompany.tenantId || '',
    },
    homeLiteKpis: home.kpis.slice(0, 4),
  };

  return {
    bootstrap,
    home,
    sector,
    tools,
    playground,
    assetOptions,
    companyOptions,
    assetDetail: (asset) => {
      const rows = spacesByAsset.get(asset.asset_id) || [];
      return {
        generatedAt,
        meta: { selection: { assetId: asset.asset_id, assetName: asset.asset_name }, rowCount: rows.length },
        overview: { assetId: asset.asset_id, assetName: asset.asset_name },
        kpis: [
          { label: '임차인', value: new Set(rows.map((row) => row.tenant_id).filter(Boolean)).size },
          { label: '공간', value: rows.length },
          { label: '임대면적', value: sum(rows, 'leased_area_sqm') },
        ],
        analytics: {
          coreTenants: rows.slice(0, 8).map((space) => ({
            tenantMasterName: tenantsById.get(space.tenant_id)?.tenant_master_name || space.tenant_id,
            leasedAreaSqm: space.leased_area_sqm,
            monthlyCostTotal: space.current_monthly_cost_total,
          })),
          rentVsMf: rows.slice(0, 20).map((space) => ({
            tenantMasterName: tenantsById.get(space.tenant_id)?.tenant_master_name || space.tenant_id,
            monthlyRentTotal: space.current_monthly_rent_total,
            monthlyMfTotal: space.current_monthly_mf_total,
            monthlyTotal: space.current_monthly_cost_total,
            leasedAreaPy: Number(space.leased_area_sqm || 0) * 0.3025,
          })),
        },
        areaBreakdown: rows.slice(0, 10).map((space) => ({ label: space.detail_area_label || space.floor_label || space.lease_space_id, leasedAreaSqm: space.leased_area_sqm })),
        rows: rows.slice(0, 10).map((space) => ({ label: space.lease_space_id, value: tenantsById.get(space.tenant_id)?.tenant_master_name || space.tenant_id })),
      };
    },
    companyDetail: (tenant) => {
      const rows = spacesByTenant.get(tenant.tenant_id) || [];
      const tenantLeases = leases.filter((lease) => lease.tenant_id === tenant.tenant_id);
      return {
        generatedAt,
        profile: {
          tenantId: tenant.tenant_id,
          tenantMasterName: tenant.tenant_master_name,
          assetCount: new Set(rows.map((row) => row.asset_id).filter(Boolean)).size,
          monthlyCostTotal: sum(rows, 'current_monthly_cost_total'),
          latestExpiry: tenantLeases.map((lease) => lease.end_date).filter(Boolean).sort().slice(-1)[0] || '',
        },
        financials: { revenue: null },
        operations: {
          exposure: {
            byAsset: rows.slice(0, 8).map((space) => ({
              assetName: assetsById.get(space.asset_id)?.asset_name || space.asset_id,
              leasedAreaSqm: space.leased_area_sqm,
              monthlyCostTotal: space.current_monthly_cost_total,
            })),
          },
        },
        leasedAssets: rows.slice(0, 20).map((space) => ({
          assetName: assetsById.get(space.asset_id)?.asset_name || space.asset_id,
          leasedAreaSqm: space.leased_area_sqm,
          monthlyCostTotal: space.current_monthly_cost_total,
        })),
        rows: [],
      };
    },
  };
}

function buildSnapshotRows(generatedAt, tables) {
  const dataDir = path.join(ROOT, 'docs', 'data');
  const minimal = buildMinimalSnapshots(generatedAt, tables);
  const rows = [];
  rows.push(snapshotRecord('bootstrap', 'shell', minimal.bootstrap, generatedAt));
  rows.push(snapshotRecord('weekly', 'default', readJsonIfExists(path.join(dataDir, 'weekly.json')) || { generatedAt }, generatedAt));
  rows.push(snapshotRecord('home', 'default', minimal.home, generatedAt));
  rows.push(snapshotRecord('sector', 'default', minimal.sector, generatedAt));
  rows.push(snapshotRecord('tools', 'default', minimal.tools, generatedAt));
  rows.push(snapshotRecord('playground', 'default', minimal.playground, generatedAt));
  (tables.ll_assets || []).forEach((asset) => {
    rows.push(snapshotRecord('asset', asset.asset_id, minimal.assetDetail(asset), generatedAt));
  });
  (tables.ll_tenants || []).forEach((tenant) => {
    rows.push(snapshotRecord('company', tenant.tenant_id, minimal.companyDetail(tenant), generatedAt));
  });
  return rows;
}

function compactValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => compactValue(item)).filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const next = {};
    Object.entries(value).forEach(([key, child]) => {
      const compacted = compactValue(child);
      if (compacted !== undefined) next[key] = compacted;
    });
    return Object.keys(next).length ? next : undefined;
  }
  if (value === null || value === undefined || value === '') return undefined;
  return value;
}

function compactDataset(dataset) {
  Object.keys(dataset.tables || {}).forEach((tableName) => {
    dataset.tables[tableName] = dataset.tables[tableName].map((row) => compactValue(row) || {});
  });
  return dataset;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/data/build-ll-dataset-from-csv.cjs [--csv-dir C:\\tmp] [--out qa-artifacts/supabase/ll-dataset-google-sheets.json]');
    return;
  }
  const dataset = compactDataset(buildDataset(args.csvDir, args.snapshots));
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(dataset, null, 2), 'utf8');
  const counts = Object.fromEntries(Object.entries(dataset.tables).map(([table, rows]) => [table, rows.length]));
  console.log(JSON.stringify({ ok: true, out: args.out, counts }, null, 2));
}

main();
