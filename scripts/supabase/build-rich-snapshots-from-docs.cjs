#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOCS_DATA = path.join(ROOT, 'docs', 'data');
const DEFAULT_OUTPUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-rich-snapshots-from-docs.json');
const GENERATED_AT = new Date().toISOString();

const ROOT_PAGE_FILES = Object.freeze([
  ['weekly', 'default', 'weekly.json'],
  ['home', 'default', 'home.json'],
  ['sector', 'default', 'sector.json'],
  ['tools', 'default', 'tools.json'],
  ['playground', 'default', 'playground.json'],
  ['admin', 'shell', 'admin.json'],
  ['admin-data', 'shell', 'admin.json'],
]);
const PRIVATE_PAGES = new Set(['admin', 'admin-data']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function snapshotKey(page, entityId) {
  return `docs_${page}_${entityId}`;
}

function cleanPublicPayload(value) {
  if (Array.isArray(value)) return value.map(cleanPublicPayload);
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (/password|secret|authorization|api[_-]?key|scriptproperty|spreadsheetid|token/i.test(key)) continue;
    next[key] = cleanPublicPayload(child);
  }
  return next;
}

function makeSnapshot(page, entityId, payload) {
  return {
    snapshot_key: snapshotKey(page, entityId),
    page,
    entity_id: entityId,
    payload: cleanPublicPayload(payload),
    user_safe: !PRIVATE_PAGES.has(page),
    generated_at: GENERATED_AT,
    schema_version: 'docs_static_v1',
    source: 'supabase_snapshot',
    source_system: 'google_sheets',
  };
}

function buildBootstrap() {
  const bootstrap = readJson(path.join(DOCS_DATA, 'bootstrap.json'));
  bootstrap.assetOptions = readJson(path.join(DOCS_DATA, 'asset-options.json'));
  bootstrap.companyOptions = readJson(path.join(DOCS_DATA, 'company-options.json'))
    .filter((item) => item && item.tenantId && item.tenantId !== 'tenant_name_');
  return bootstrap;
}

function buildAssetCoordinateIndex() {
  const index = new Map();
  const dirPath = path.join(DOCS_DATA, 'asset');
  fs.readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .forEach((name) => {
      const payload = readJson(path.join(dirPath, name));
      const overview = payload.overview || {};
      const latitude = Number(overview.latitude);
      const longitude = Number(overview.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const coordinate = {
        assetId: path.basename(name, '.json'),
        assetName: overview.assetName,
        address: overview.address || overview.standardizedAddress || '',
        latitude,
        longitude,
      };
      [coordinate.assetId, coordinate.assetName].filter(Boolean).forEach((key) => {
        index.set(String(key).trim(), coordinate);
      });
    });
  return index;
}

function enrichCompanyPayload(payload, assetCoordinates) {
  const existing = Array.isArray(payload.mapPoints) ? payload.mapPoints : [];
  const seeds = existing.length
    ? existing
    : [...(Array.isArray(payload.leasedAssets) ? payload.leasedAssets : []), ...(Array.isArray(payload.rows) ? payload.rows : [])];
  const seen = new Set();
  const mapPoints = seeds.map((item) => {
    const assetName = item?.assetName || item?.asset?.assetName || '';
    const assetId = item?.assetId || item?.asset?.assetId || '';
    const coordinate = assetCoordinates.get(String(assetName).trim()) || assetCoordinates.get(String(assetId).trim()) || {};
    const latitude = item?.latitude ?? item?.asset?.latitude ?? coordinate.latitude;
    const longitude = item?.longitude ?? item?.asset?.longitude ?? coordinate.longitude;
    const key = assetId || assetName || `${latitude},${longitude}`;
    if (!key || seen.has(key)) return null;
    seen.add(key);
    return Object.assign({}, item, {
      assetId: assetId || coordinate.assetId || '',
      assetName: assetName || coordinate.assetName || '',
      address: item?.address || item?.asset?.address || coordinate.address || '',
      latitude,
      longitude,
    });
  }).filter((point) => point && point.latitude != null && point.longitude != null);
  return Object.assign({}, payload, { mapPoints });
}

function collectEntitySnapshots(dirName, page) {
  const dirPath = path.join(DOCS_DATA, dirName);
  const assetCoordinates = page === 'company' ? buildAssetCoordinateIndex() : null;
  return fs.readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, 'ko-KR'))
    .map((name) => {
      const entityId = path.basename(name, '.json');
      const payload = readJson(path.join(dirPath, name));
      return makeSnapshot(page, entityId, page === 'company' ? enrichCompanyPayload(payload, assetCoordinates) : payload);
    });
}

function buildRows() {
  const rows = [
    makeSnapshot('bootstrap', 'shell', buildBootstrap()),
    ...ROOT_PAGE_FILES.map(([page, entityId, fileName]) => (
      makeSnapshot(page, entityId, readJson(path.join(DOCS_DATA, fileName)))
    )),
    ...collectEntitySnapshots('asset', 'asset'),
    ...collectEntitySnapshots('company', 'company'),
  ];
  const seen = new Set();
  return rows.filter((row) => {
    if (seen.has(row.snapshot_key)) return false;
    seen.add(row.snapshot_key);
    return true;
  });
}

function main() {
  const output = path.resolve(process.argv[2] || DEFAULT_OUTPUT);
  const rows = buildRows();
  writeJson(output, { tables: { ll_payload_snapshots: rows } });
  console.log(JSON.stringify({
    ok: true,
    output,
    rows: rows.length,
    pages: rows.reduce((acc, row) => {
      acc[row.page] = (acc[row.page] || 0) + 1;
      return acc;
    }, {}),
  }, null, 2));
}

main();
