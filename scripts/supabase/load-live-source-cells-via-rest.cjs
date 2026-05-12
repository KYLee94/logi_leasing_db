#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://qvegpozwrcmspdvjokiz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P";

function parseArgs(argv) {
  const args = {
    extract: path.join(ROOT, "qa-artifacts", "source-diff", "live-google-sheets", "live-google-sheets-extract.json"),
    importId: "",
    chunkSize: 500,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--extract") args.extract = path.resolve(ROOT, argv[++index] || args.extract);
    else if (arg.startsWith("--extract=")) args.extract = path.resolve(ROOT, arg.slice("--extract=".length));
    else if (arg === "--import-id") args.importId = argv[++index] || "";
    else if (arg.startsWith("--import-id=")) args.importId = arg.slice("--import-id=".length);
    else if (arg === "--chunk-size") args.chunkSize = Number(argv[++index] || args.chunkSize);
    else if (arg.startsWith("--chunk-size=")) args.chunkSize = Number(arg.slice("--chunk-size=".length));
    else if (arg === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(args.chunkSize) || args.chunkSize < 1) throw new Error("--chunk-size must be positive.");
  return args;
}

function normalizeText(value) {
  if (value == null) return "";
  return String(value);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildImportId(extract) {
  const nonEmpty = normalizeText(extract.summary?.non_empty_cell_count || "0");
  const digest = crypto.createHash("sha256").update(normalizeText(extract.spreadsheet_id || extract.source_name)).digest("hex").slice(0, 12);
  const generated = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `live_google_sheets_logistics_leasing_${nonEmpty}_${digest}_${generated}`;
}

function buildSheetRows(importId, extract) {
  const sourceName = normalizeText(extract.source_name || "");
  const sheets = new Map((extract.sheets || []).map((sheet) => [sheet.sheet_id, sheet]));
  const cellsByRow = new Map();
  (extract.cells || []).forEach((cell) => {
    if (!cellsByRow.has(cell.row_id)) cellsByRow.set(cell.row_id, []);
    cellsByRow.get(cell.row_id).push(cell);
  });
  return (extract.rows || []).map((row) => {
    const sheet = sheets.get(row.sheet_id) || {};
    const rowCells = (cellsByRow.get(row.row_id) || []).sort((a, b) => Number(a.column_index || 0) - Number(b.column_index || 0));
    const rowValues = rowCells.map((cell) => ({
      column_number: Number(cell.column_index || 0),
      column_letter: normalizeText(cell.column_letter),
      display_value: normalizeText(cell.display_value),
      raw_value: normalizeText(cell.raw_value),
      formula: normalizeText(cell.formula),
      is_blank: Boolean(cell.is_blank),
    }));
    return {
      sheet_row_id: `${importId}:${row.row_id}`,
      import_id: importId,
      source_type: "live_google_sheets",
      source_name: sourceName,
      sheet_name: normalizeText(sheet.sheet_name),
      row_number: Number(row.row_number || 0),
      header_row_number: sheet.header_row ? Number(sheet.header_row) : null,
      row_values_json: rowValues,
      row_hash: normalizeText(row.row_hash || stableHash(rowValues)),
    };
  });
}

function buildCellRows(importId, extract) {
  const sourceName = normalizeText(extract.source_name || "");
  const sheets = new Map((extract.sheets || []).map((sheet) => [sheet.sheet_name, sheet]));
  const rows = new Map((extract.rows || []).map((row) => [row.row_id, row]));
  return (extract.cells || []).map((cell) => {
    const sheet = sheets.get(cell.sheet_name) || {};
    const row = rows.get(cell.row_id) || {};
    return {
      source_cell_id: `${importId}:${cell.cell_id}`,
      import_id: importId,
      source_type: "live_google_sheets",
      source_name: sourceName,
      sheet_name: normalizeText(cell.sheet_name),
      row_number: Number(cell.row_number || 0),
      column_number: Number(cell.column_index || 0),
      column_letter: normalizeText(cell.column_letter),
      header_row_number: sheet.header_row ? Number(sheet.header_row) : null,
      header_label: normalizeText(cell.header_label),
      a1_ref: normalizeText(cell.a1_ref),
      raw_value_text: normalizeText(cell.raw_value),
      display_value_text: normalizeText(cell.display_value),
      formula_text: normalizeText(cell.formula),
      value_type: normalizeText(cell.value_type),
      is_blank: Boolean(cell.is_blank),
      row_hash: normalizeText(row.row_hash),
      cell_hash: normalizeText(cell.source_hash || stableHash(cell)),
      source_payload: {
        a1_ref: cell.a1_ref,
        column_id: cell.column_id,
        row_id: cell.row_id,
        extraction_method: cell.extraction_method || "google_sheets_values_batchGet",
      },
    };
  });
}

async function rest(pathname, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${pathname} HTTP ${response.status}: ${text}`);
  }
}

async function postChunks(tablePath, rows, chunkSize) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    await rest(tablePath, chunk);
    console.log(JSON.stringify({ tablePath, chunk: Math.floor(index / chunkSize) + 1, rows: chunk.length, total: rows.length }));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const extract = JSON.parse(fs.readFileSync(args.extract, "utf8"));
  const importId = args.importId || buildImportId(extract);
  const importRun = {
    import_id: importId,
    source_type: "live_google_sheets",
    source_name: extract.source_name || "IGIS_Logistics_Leasing_Data",
    file_name: extract.spreadsheet_id || "",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: args.dryRun ? "prepared" : "loaded",
    row_counts: extract.summary || {},
    memo: "Live Google Sheets cell-by-cell source preservation import via publishable-key temporary ll_* policy",
  };
  const sheetRows = buildSheetRows(importId, extract);
  const cellRows = buildCellRows(importId, extract);
  const summary = {
    ok: true,
    dryRun: args.dryRun,
    import_id: importId,
    source: extract.source_name,
    sheets: extract.summary?.sheet_count || 0,
    sheet_rows: sheetRows.length,
    source_cells: cellRows.length,
    non_empty_cells: cellRows.filter((row) => !row.is_blank).length,
    formula_cells: cellRows.filter((row) => row.formula_text).length,
  };
  if (args.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  await rest("ll_import_runs?on_conflict=import_id", [importRun]);
  await postChunks("ll_sheet_rows?on_conflict=sheet_row_id", sheetRows, args.chunkSize);
  await postChunks("ll_source_cells?on_conflict=source_cell_id", cellRows, args.chunkSize);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  const message = String(error && error.stack ? error.stack : error)
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, "[redacted-supabase-secret]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]");
  console.error(message);
  process.exit(1);
});
