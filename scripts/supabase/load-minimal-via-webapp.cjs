#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'qa-artifacts', 'supabase', 'll-minimal-dataset-google-sheets.json');
const TABLE_ORDER = Object.freeze([
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
    input: DEFAULT_INPUT,
    webappUrl: process.env.APPS_SCRIPT_WEBAPP_URL || '',
    dryRun: false,
    write: false,
    maxRows: 25,
    maxBytes: 180000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') args.input = path.resolve(ROOT, argv[++i] || args.input);
    else if (arg.startsWith('--input=')) args.input = path.resolve(ROOT, arg.slice('--input='.length));
    else if (arg === '--webapp-url') args.webappUrl = argv[++i] || args.webappUrl;
    else if (arg.startsWith('--webapp-url=')) args.webappUrl = arg.slice('--webapp-url='.length);
    else if (arg === '--max-rows') args.maxRows = Number(argv[++i] || args.maxRows);
    else if (arg.startsWith('--max-rows=')) args.maxRows = Number(arg.slice('--max-rows='.length));
    else if (arg === '--max-bytes') args.maxBytes = Number(argv[++i] || args.maxBytes);
    else if (arg.startsWith('--max-bytes=')) args.maxBytes = Number(arg.slice('--max-bytes='.length));
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--write') args.write = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (args.dryRun === args.write) throw new Error('Choose exactly one mode: --dry-run or --write.');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[-_A-Za-z0-9]+\/exec/.test(args.webappUrl || '') && args.write) {
    throw new Error('--webapp-url or APPS_SCRIPT_WEBAPP_URL must be an Apps Script /exec URL.');
  }
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

function redact(text) {
  return String(text || '')
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, '[redacted-supabase-secret]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]')
    .replace(/(\"password\"\s*:\s*\")[^\"]+/gi, '$1[redacted]');
}

function readAdminRouteKeyHash() {
  const configText = fs.readFileSync(path.join(ROOT, 'Config.gs'), 'utf8');
  const match = /adminRouteKeyHash:\s*'([a-f0-9]{64})'/i.exec(configText);
  if (!match) throw new Error('adminRouteKeyHash was not found in Config.gs.');
  return match[1];
}

function makeLoaderEnvelope(payload, secret) {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64');
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const proof = crypto
    .createHash('sha256')
    .update(`${secret}\n${timestamp}\n${nonce}\n${payloadB64}`, 'utf8')
    .digest('hex');
  return {
    api: 'll-minimal-loader',
    timestamp,
    nonce,
    payloadB64,
    proof,
  };
}

async function callLoader(webappUrl, payload) {
  const response = await fetch(webappUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error('Loader returned non-JSON status=' + response.status + ', body=' + redact(text.slice(0, 500)));
  }
  if (!response.ok || json.status === 'error') {
    throw new Error('Loader failed status=' + response.status + ', body=' + redact(JSON.stringify(json)));
  }
  return json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const tables = dataset.tables || {};
  const plan = TABLE_ORDER.map((tableName) => {
    const rows = tables[tableName] || [];
    const chunks = chunkRows(rows, args.maxRows, args.maxBytes);
    return {
      tableName,
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

  const password = process.env.ADMIN_PASSWORD || '';
  const proofSecret = password ? null : readAdminRouteKeyHash();
  const summary = [];
  for (const tablePlan of plan) {
    let loaded = 0;
    for (let i = 0; i < tablePlan.chunksData.length; i += 1) {
      const rows = tablePlan.chunksData[i];
      const payload = {
        action: 'upsert',
        tableName: tablePlan.tableName,
        rows,
      };
      const result = await callLoader(args.webappUrl, password ? Object.assign({ api: 'll-minimal-loader', password }, payload) : makeLoaderEnvelope(payload, proofSecret));
      loaded += rows.length;
      console.log(JSON.stringify({
        event: 'upsert',
        tableName: tablePlan.tableName,
        chunk: i + 1,
        chunks: tablePlan.chunksData.length,
        rows: rows.length,
        status: result.status,
      }));
    }
    summary.push({ tableName: tablePlan.tableName, rows: tablePlan.rows, loaded });
  }
  const countPayload = { action: 'count' };
  const countResult = await callLoader(args.webappUrl, password ? { api: 'll-minimal-loader', action: 'count', password } : makeLoaderEnvelope(countPayload, proofSecret));
  console.log(JSON.stringify({
    ok: true,
    mode: 'write',
    writesPerformed: true,
    input: args.input,
    summary,
    readback: countResult.counts,
  }, null, 2));
}

main().catch((error) => {
  console.error(redact(error && error.stack ? error.stack : error));
  process.exit(1);
});
