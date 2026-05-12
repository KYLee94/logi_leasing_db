#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = {
    inputDir: path.join(ROOT, 'qa-artifacts', 'supabase', 'minimal-sql-mcp-bundle'),
    outputDir: path.join(ROOT, 'qa-artifacts', 'supabase', 'minimal-sql-mcp-batches'),
    maxBytes: 120000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input-dir') args.inputDir = path.resolve(ROOT, argv[++i] || args.inputDir);
    else if (arg.startsWith('--input-dir=')) args.inputDir = path.resolve(ROOT, arg.slice('--input-dir='.length));
    else if (arg === '--output-dir') args.outputDir = path.resolve(ROOT, argv[++i] || args.outputDir);
    else if (arg.startsWith('--output-dir=')) args.outputDir = path.resolve(ROOT, arg.slice('--output-dir='.length));
    else if (arg === '--max-bytes') args.maxBytes = Number(argv[++i] || args.maxBytes);
    else if (arg.startsWith('--max-bytes=')) args.maxBytes = Number(arg.slice('--max-bytes='.length));
    else throw new Error('Unknown argument: ' + arg);
  }
  if (!Number.isFinite(args.maxBytes) || args.maxBytes < 10000) throw new Error('--max-bytes is too small.');
  return args;
}

function rowCountFromSql(sql) {
  const match = /rows=(\d+)/i.exec(sql);
  return match ? Number(match[1]) : 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.rmSync(args.outputDir, { recursive: true, force: true });
  fs.mkdirSync(args.outputDir, { recursive: true });

  const sourceFiles = fs.readdirSync(args.inputDir).filter((file) => file.endsWith('.sql')).sort();
  const batches = [];
  let current = [];
  let currentBytes = 0;

  sourceFiles.forEach((file) => {
    const sql = fs.readFileSync(path.join(args.inputDir, file), 'utf8');
    const bytes = Buffer.byteLength(sql) + 64;
    if (current.length && currentBytes + bytes > args.maxBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push({ file, sql, bytes });
    currentBytes += bytes;
  });
  if (current.length) batches.push(current);

  const files = batches.map((batch, index) => {
    const file = `batch_${String(index + 1).padStart(2, '0')}.sql`;
    const sql = batch.map((part) => `-- source: ${part.file}\n${part.sql}`).join('\n\n');
    fs.writeFileSync(path.join(args.outputDir, file), sql, 'utf8');
    return {
      sequence: index + 1,
      file,
      sourceFiles: batch.map((part) => part.file),
      rows: batch.reduce((sum, part) => sum + rowCountFromSql(part.sql), 0),
      bytes: Buffer.byteLength(sql),
    };
  });

  const manifest = {
    ok: true,
    inputDir: args.inputDir,
    outputDir: args.outputDir,
    maxBytes: args.maxBytes,
    batchCount: files.length,
    totalRows: files.reduce((sum, file) => sum + file.rows, 0),
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
  fs.writeFileSync(path.join(args.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
}

main();
