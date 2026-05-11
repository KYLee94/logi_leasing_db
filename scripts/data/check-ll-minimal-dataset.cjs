#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-minimal-dataset-google-sheets.json');

const REQUIRED_NON_EMPTY = Object.freeze([
  'll_import_runs',
  'll_sheet_rows',
  'll_assets',
  'll_tenants',
  'll_leases',
  'll_lease_spaces',
  'll_rent_history',
  'll_payload_snapshots',
]);

const ALLOWED_TABLES = Object.freeze([
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

const FORBIDDEN_MARKERS = Object.freeze([
  'existing_public_tables',
  'public.funds',
  'asset_master',
  'public.asset_master',
  'asset_fund_links',
  'public.asset_fund_links',
  'fund_assets',
  'public.fund_assets',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pkSet(rows, key) {
  return new Set((rows || []).map((row) => row && row[key]).filter(Boolean));
}

function hasForbiddenMarker(row) {
  const text = JSON.stringify(row || {}).toLowerCase();
  return FORBIDDEN_MARKERS.some((marker) => text.includes(marker));
}

function checkRef(failures, tableName, row, index, column, allowed) {
  const value = row && row[column];
  if (!value) return;
  if (!allowed.has(value)) {
    failures.push({ table: tableName, rowIndex: index, column, value, reason: 'missing referenced row' });
  }
}

function main() {
  const input = path.resolve(ROOT, process.argv[2] || DEFAULT_INPUT);
  const payload = readJson(input);
  const tables = payload.tables || payload;
  const failures = [];
  const counts = {};

  Object.keys(tables).forEach((tableName) => {
    if (!ALLOWED_TABLES.includes(tableName)) {
      failures.push({ table: tableName, reason: 'table is not in minimal ll_* allowlist' });
    }
    if (!tableName.startsWith('ll_')) {
      failures.push({ table: tableName, reason: 'table does not start with ll_' });
    }
  });

  ALLOWED_TABLES.forEach((tableName) => {
    const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];
    counts[tableName] = rows.length;
    rows.forEach((row, index) => {
      if (hasForbiddenMarker(row)) failures.push({ table: tableName, rowIndex: index, reason: 'forbidden source marker found' });
    });
  });

  REQUIRED_NON_EMPTY.forEach((tableName) => {
    if (!counts[tableName]) failures.push({ table: tableName, reason: 'required table has 0 rows' });
  });

  const imports = pkSet(tables.ll_import_runs, 'import_id');
  const sourceRows = pkSet(tables.ll_sheet_rows, 'sheet_row_id');
  const assets = pkSet(tables.ll_assets, 'asset_id');
  const tenants = pkSet(tables.ll_tenants, 'tenant_id');
  const leases = pkSet(tables.ll_leases, 'lease_id');
  const spaces = pkSet(tables.ll_lease_spaces, 'lease_space_id');

  (tables.ll_sheet_rows || []).forEach((row, index) => checkRef(failures, 'll_sheet_rows', row, index, 'import_id', imports));
  ['ll_assets', 'll_tenants', 'll_leases', 'll_lease_spaces', 'll_rent_history', 'll_asset_managers', 'll_issues'].forEach((tableName) => {
    (tables[tableName] || []).forEach((row, index) => checkRef(failures, tableName, row, index, 'source_sheet_row_id', sourceRows));
  });
  (tables.ll_leases || []).forEach((row, index) => {
    checkRef(failures, 'll_leases', row, index, 'asset_id', assets);
    checkRef(failures, 'll_leases', row, index, 'tenant_id', tenants);
  });
  (tables.ll_lease_spaces || []).forEach((row, index) => {
    checkRef(failures, 'll_lease_spaces', row, index, 'lease_id', leases);
    checkRef(failures, 'll_lease_spaces', row, index, 'asset_id', assets);
    checkRef(failures, 'll_lease_spaces', row, index, 'tenant_id', tenants);
  });
  (tables.ll_rent_history || []).forEach((row, index) => {
    checkRef(failures, 'll_rent_history', row, index, 'lease_space_id', spaces);
    checkRef(failures, 'll_rent_history', row, index, 'lease_id', leases);
    checkRef(failures, 'll_rent_history', row, index, 'asset_id', assets);
    checkRef(failures, 'll_rent_history', row, index, 'tenant_id', tenants);
  });

  const summary = {
    ok: failures.length === 0,
    input,
    counts,
    failureCount: failures.length,
    failures: failures.slice(0, 50),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main();
