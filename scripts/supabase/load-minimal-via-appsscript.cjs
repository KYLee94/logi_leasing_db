#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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
    dryRun: false,
    write: false,
    maxRows: 25,
    maxBytes: 180000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') args.input = path.resolve(ROOT, argv[++i] || args.input);
    else if (arg.startsWith('--input=')) args.input = path.resolve(ROOT, arg.slice('--input='.length));
    else if (arg === '--max-rows') args.maxRows = Number(argv[++i] || args.maxRows);
    else if (arg.startsWith('--max-rows=')) args.maxRows = Number(arg.slice('--max-rows='.length));
    else if (arg === '--max-bytes') args.maxBytes = Number(argv[++i] || args.maxBytes);
    else if (arg.startsWith('--max-bytes=')) args.maxBytes = Number(arg.slice('--max-bytes='.length));
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--write') args.write = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (args.dryRun === args.write) throw new Error('Choose exactly one mode: --dry-run or --write.');
  if (!Number.isFinite(args.maxRows) || args.maxRows < 1) throw new Error('--max-rows must be positive.');
  if (!Number.isFinite(args.maxBytes) || args.maxBytes < 10000) throw new Error('--max-bytes must be at least 10000.');
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readClaspConfig() {
  const project = readJson(path.join(ROOT, '.clasp.json'));
  const rcPath = path.join(os.homedir(), '.clasprc.json');
  const rc = readJson(rcPath);
  const token = rc.tokens && rc.tokens.default;
  if (!project.scriptId) throw new Error('.clasp.json scriptId is missing.');
  if (!token || !token.refresh_token || !token.client_id || !token.client_secret) {
    throw new Error('clasp OAuth token is missing. Run npm run clasp:login first.');
  }
  return { scriptId: project.scriptId, token };
}

async function getAccessToken(token) {
  if (token.access_token && Number(token.expiry_date || 0) > Date.now() + 60000) return token.access_token;
  const body = new URLSearchParams({
    client_id: token.client_id,
    client_secret: token.client_secret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error('Failed to refresh Google OAuth token: ' + JSON.stringify(json));
  }
  return json.access_token;
}

function redact(text) {
  return String(text || '')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[redacted-google-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted-token]')
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, '[redacted-supabase-secret]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]');
}

async function runAppsScript(scriptId, accessToken, functionName, parameters) {
  const response = await fetch(`https://script.googleapis.com/v1/scripts/${scriptId}:run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      function: functionName,
      parameters,
      devMode: true,
    }),
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(redact('Apps Script API failed: ' + JSON.stringify(json)));
  }
  if (json.response && json.response.error) {
    throw new Error(redact('Apps Script function failed: ' + JSON.stringify(json.response.error)));
  }
  return json.response ? json.response.result : null;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = readJson(args.input);
  const tables = dataset.tables || {};
  const plan = TABLE_ORDER.map((tableName) => {
    const rows = tables[tableName] || [];
    const chunks = chunkRows(rows, args.maxRows, args.maxBytes);
    return {
      tableName,
      rows: rows.length,
      chunks: chunks.length,
      maxChunkBytes: chunks.reduce((max, chunk) => Math.max(max, byteLength(chunk)), 0),
      chunkRows: chunks.map((chunk) => chunk.length),
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

  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminPassword) throw new Error('ADMIN_PASSWORD environment variable is required for --write.');
  const { scriptId, token } = readClaspConfig();
  const accessToken = await getAccessToken(token);
  const login = await runAppsScript(scriptId, accessToken, 'verifyAdminPassword', [{ password: adminPassword }]);
  if (!login || login.status !== 'ok' || !login.adminSessionToken) throw new Error('Admin authentication failed.');

  const summary = [];
  for (const tablePlan of plan) {
    let loaded = 0;
    for (let i = 0; i < tablePlan.chunksData.length; i += 1) {
      const rows = tablePlan.chunksData[i];
      const result = await runAppsScript(scriptId, accessToken, 'adminSupabaseMinimalUpsert', [{
        adminSessionToken: login.adminSessionToken,
        tableName: tablePlan.tableName,
        rows,
      }]);
      loaded += rows.length;
      console.log(JSON.stringify({
        event: 'upsert',
        tableName: tablePlan.tableName,
        chunk: i + 1,
        chunks: tablePlan.chunksData.length,
        rows: rows.length,
        status: result && result.status,
      }));
    }
    summary.push({ tableName: tablePlan.tableName, rows: tablePlan.rows, loaded });
  }

  const countResult = await runAppsScript(scriptId, accessToken, 'adminSupabaseMinimalCount', [{
    adminSessionToken: login.adminSessionToken,
  }]);
  console.log(JSON.stringify({
    ok: true,
    mode: 'write',
    writesPerformed: true,
    input: args.input,
    summary,
    readback: countResult && countResult.counts,
  }, null, 2));
}

main().catch((error) => {
  console.error(redact(error && error.stack ? error.stack : error));
  process.exit(1);
});
