#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DIR = path.join(ROOT, 'docs', 'data');

const FORBIDDEN_KEY = /(?:password|secret|authorization|bearer|api[_-]?key|scriptproperty|spreadsheetid|review|audit|calculation|formula|enocaudit|historylinkstatus|calculatedreviewstatus|source_payload|sourcepayload|source_row_hash|sourcerowhash|sourcedocref|opendart|buildingregister|building_register|navermap|naver_map)/i;
const FORBIDDEN_TEXT = /(?:SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE|OPENDART_API_KEY|BUILDING_REGISTER_API_KEY|BUILDING_REGISTER_API_KEY_ENCODED|NAVER_MAPS_CLIENT_SECRET|Script Properties|script properties|missing_api_key|missing_client_secret|api_key|client_secret|review_required|calculatedReviewStatus|eNocAudit|historyLinkStatus|calculationStatus)/i;

function walkJsonFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) return walkJsonFiles(fullPath);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.json') ? [fullPath] : [];
  });
}

function sanitize(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitize(item))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) continue;
      const sanitized = sanitize(child);
      if (sanitized !== undefined) next[key] = sanitized;
    }
    return next;
  }

  if (typeof value === 'string' && FORBIDDEN_TEXT.test(value)) {
    return undefined;
  }

  return value;
}

function main() {
  const targetDir = path.resolve(process.argv[2] || DEFAULT_DIR);
  const files = walkJsonFiles(targetDir);
  let changed = 0;
  for (const filePath of files) {
    const before = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(before);
    const after = JSON.stringify(sanitize(data), null, 2) + '\n';
    if (after !== before) {
      fs.writeFileSync(filePath, after, 'utf8');
      changed += 1;
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, files: files.length, changed }, null, 2) + '\n');
}

main();
