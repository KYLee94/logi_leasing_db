#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT_DIR = path.join(ROOT, 'qa-artifacts', 'supabase', 'sql-chunks');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'qa-artifacts', 'supabase', 'sql-load', 'mcp-bundle');
const DEFAULT_MAX_BYTES = 120 * 1024;
const JSON_TAG = '$lljson$';

const FORBIDDEN_SQL = Object.freeze([
  /\bdelete\s+from\b/i,
  /\btruncate\s+table\b/i,
  /\bdrop\s+table\b/i,
  /\balter\s+table\b/i,
  /\bcreate\s+table\b/i,
  /\breset\b/i,
]);

function usage() {
  return [
    'Usage:',
    '  node scripts/supabase/prepare-mcp-sql-bundle.cjs --dry-run [--input-dir <dir>] [--max-bytes <bytes>] [--summary]',
    '  node scripts/supabase/prepare-mcp-sql-bundle.cjs --write [--input-dir <dir>] [--output-dir <dir>] [--max-bytes <bytes>] [--summary]',
    '',
    'Purpose:',
    '  Splits qa-artifacts/supabase/sql-chunks/*.sql into smaller upsert-only SQL files that are easier to paste into Supabase MCP.',
    '',
    'Safety:',
    '  - Does not connect to Supabase and never executes SQL.',
    '  - Rejects reset/delete/truncate/drop/alter/create statements.',
    '  - Rejects mutations outside public.ll_* tables.',
    '  - Verifies source_system values remain google_sheets when present.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    inputDir: DEFAULT_INPUT_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    maxBytes: DEFAULT_MAX_BYTES,
    dryRun: false,
    write: false,
    summary: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--summary') args.summary = true;
    else if (arg === '--input-dir') args.inputDir = argv[++index] || args.inputDir;
    else if (arg.startsWith('--input-dir=')) args.inputDir = arg.slice('--input-dir='.length);
    else if (arg === '--output-dir') args.outputDir = argv[++index] || args.outputDir;
    else if (arg.startsWith('--output-dir=')) args.outputDir = arg.slice('--output-dir='.length);
    else if (arg === '--max-bytes') args.maxBytes = Number(argv[++index] || 0);
    else if (arg.startsWith('--max-bytes=')) args.maxBytes = Number(arg.slice('--max-bytes='.length));
    else throw new Error('Unknown argument: ' + arg);
  }

  if (args.help) return args;
  if (args.dryRun === args.write) throw new Error('Choose exactly one mode: --dry-run or --write.');
  if (!Number.isInteger(args.maxBytes) || args.maxBytes < 8192) {
    throw new Error('--max-bytes must be an integer of at least 8192.');
  }
  args.inputDir = path.resolve(ROOT, args.inputDir);
  args.outputDir = path.resolve(ROOT, args.outputDir);
  return args;
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertSafeSql(sql, label) {
  const stripped = stripSqlComments(sql);
  const forbidden = FORBIDDEN_SQL.find((pattern) => pattern.test(stripped));
  if (forbidden) throw new Error(label + ' contains forbidden SQL: ' + forbidden);

  const mutationPattern = /\b(insert\s+into|merge\s+into)\s+(?:public\.)?"?([a-z0-9_]+)"?|\bupdate\s+public\."?([a-z0-9_]+)"?/gi;
  for (const match of stripped.matchAll(mutationPattern)) {
    const tableName = match[2] || match[3];
    if (!tableName.startsWith('ll_')) {
      throw new Error(label + ' mutates non-ll table: ' + tableName);
    }
  }
}

function parseChunk(sql, label) {
  assertSafeSql(sql, label);

  const tableMatch = /\binsert\s+into\s+public\."?([a-z0-9_]+)"?\s*\(/i.exec(sql);
  if (!tableMatch) throw new Error(label + ' is not a supported public insert chunk.');
  const tableName = tableMatch[1];
  if (!tableName.startsWith('ll_')) throw new Error(label + ' targets non-ll table: ' + tableName);

  const firstTag = sql.indexOf(JSON_TAG);
  const secondTag = firstTag >= 0 ? sql.indexOf(JSON_TAG, firstTag + JSON_TAG.length) : -1;
  if (firstTag < 0 || secondTag < 0) throw new Error(label + ' does not contain the expected $lljson$ payload.');

  const prefix = sql.slice(0, firstTag + JSON_TAG.length);
  const jsonText = sql.slice(firstTag + JSON_TAG.length, secondTag);
  const suffix = sql.slice(secondTag);
  const rows = JSON.parse(jsonText);
  if (!Array.isArray(rows)) throw new Error(label + ' JSON payload is not an array.');

  rows.forEach((row, rowIndex) => {
    if (row && Object.prototype.hasOwnProperty.call(row, 'source_system') && row.source_system !== 'google_sheets') {
      throw new Error(`${label} row ${rowIndex} has source_system=${JSON.stringify(row.source_system)}.`);
    }
  });

  return { tableName, prefix, suffix, rows };
}

function replaceRowsCount(sql, rowCount) {
  return sql.replace(/rows=\d+/i, 'rows=' + rowCount);
}

function sqlForRows(chunk, rows) {
  return replaceRowsCount(chunk.prefix + JSON.stringify(rows) + chunk.suffix, rows.length);
}

function splitRows(chunk, sourceFile, maxBytes) {
  const parts = [];
  let start = 0;
  let part = 1;

  while (start < chunk.rows.length) {
    let low = 1;
    let high = chunk.rows.length - start;
    let bestCount = 0;
    let bestSql = '';

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const sql = sqlForRows(chunk, chunk.rows.slice(start, start + mid));
      const size = byteLength(sql);
      if (size <= maxBytes) {
        bestCount = mid;
        bestSql = sql;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (!bestCount) {
      const singleSql = sqlForRows(chunk, chunk.rows.slice(start, start + 1));
      throw new Error(`${sourceFile} row ${start} is ${byteLength(singleSql)} bytes as a single-row chunk, exceeding --max-bytes=${maxBytes}.`);
    }

    assertSafeSql(bestSql, `${sourceFile} part ${part}`);
    parts.push({
      sourceFile,
      table: chunk.tableName,
      part,
      startRow: start,
      rows: bestCount,
      bytes: byteLength(bestSql),
      sha256: sha256(bestSql),
      sql: bestSql,
    });
    start += bestCount;
    part += 1;
  }

  return parts;
}

function outputName(sourceFile, part, totalParts) {
  const base = sourceFile.replace(/\.sql$/i, '');
  if (totalParts === 1) return sourceFile;
  return `${base}_mcp${String(part).padStart(3, '0')}.sql`;
}

function cleanOutputDir(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.sql') || entry.name === 'manifest.json') {
      fs.rmSync(path.join(outputDir, entry.name));
    }
  }
}

function buildBundle(args) {
  const inputFiles = fs.readdirSync(args.inputDir)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
  if (!inputFiles.length) throw new Error('No .sql files found in ' + args.inputDir);

  const outputFiles = [];
  const tables = {};
  let sequence = 1;

  for (const sourceFile of inputFiles) {
    const sourcePath = path.join(args.inputDir, sourceFile);
    const sourceSql = fs.readFileSync(sourcePath, 'utf8');
    const parsed = parseChunk(sourceSql, sourceFile);
    const parts = splitRows(parsed, sourceFile, args.maxBytes);

    parts.forEach((part) => {
      const file = outputName(sourceFile, part.part, parts.length);
      outputFiles.push({
        sequence,
        file,
        sourceFile,
        table: part.table,
        sourcePart: part.part,
        sourcePartCount: parts.length,
        startRow: part.startRow,
        rows: part.rows,
        bytes: part.bytes,
        sha256: part.sha256,
        sql: part.sql,
      });
      tables[part.table] = (tables[part.table] || 0) + part.rows;
      sequence += 1;
    });
  }

  const manifest = {
    ok: true,
    mode: args.write ? 'write' : 'dry-run',
    dbWritesPerformed: false,
    inputDir: args.inputDir,
    outputDir: args.outputDir,
    maxBytes: args.maxBytes,
    sourceFileCount: inputFiles.length,
    outputFileCount: outputFiles.length,
    totalRows: outputFiles.reduce((total, file) => total + file.rows, 0),
    totalSqlBytes: outputFiles.reduce((total, file) => total + file.bytes, 0),
    tables,
    safetyChecks: {
      noResetDeleteTruncate: true,
      onlyPublicLlTables: true,
      sourceSystemGoogleSheetsWhenPresent: true,
    },
    files: outputFiles.map(({ sql, ...file }) => file),
  };

  return { manifest, outputFiles };
}

function writeBundle(outputDir, manifest, outputFiles) {
  cleanOutputDir(outputDir);
  outputFiles.forEach((file) => {
    fs.writeFileSync(path.join(outputDir, file.file), file.sql, 'utf8');
  });
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage() + '\n');
    return;
  }

  const { manifest, outputFiles } = buildBundle(args);
  if (args.write) writeBundle(args.outputDir, manifest, outputFiles);
  const stdoutPayload = args.summary ? { ...manifest, files: undefined } : manifest;
  process.stdout.write(JSON.stringify(stdoutPayload, null, 2) + '\n');
}

main();
