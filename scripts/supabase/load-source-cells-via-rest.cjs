#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://qvegpozwrcmspdvjokiz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P";

function argValue(name, fallback) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function normalizeText(value) {
  return value == null ? "" : String(value);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildImportId(extract) {
  const sourceName = normalizeText(extract.source_name || "source");
  const nonEmpty = normalizeText(extract.summary?.non_empty_cell_count || "0");
  const digest = crypto.createHash("sha256").update(sourceName).digest("hex").slice(0, 12);
  const generated = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `xlsx_260414_logistics_leasing_${nonEmpty}_${digest}_${generated}`;
}

function buildRecords(importId, extract) {
  const sourceName = normalizeText(extract.source_name || "");
  const sheets = new Map((extract.sheets || []).map((sheet) => [sheet.sheet_name, sheet]));
  const rows = new Map((extract.rows || []).map((row) => [row.row_id, row]));
  return (extract.cells || []).map((cell) => {
    const sheet = sheets.get(cell.sheet_name) || {};
    const row = rows.get(cell.row_id) || {};
    return {
      source_cell_id: `${importId}:${cell.cell_id}`,
      import_id: importId,
      source_type: "xlsx",
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
        note: cell.note || "",
        number_format: cell.number_format || "",
        source_hash: cell.source_hash || "",
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

async function main() {
  const extractArg = argValue("extract", "qa-artifacts/source-diff/20260512-cell-audit/xlsx-extract.json");
  const chunkSize = Number(argValue("chunk-size", "500"));
  const importId = argValue("import-id", null);
  const extractPath = path.isAbsolute(extractArg) ? extractArg : path.join(ROOT, extractArg);
  const extract = JSON.parse(fs.readFileSync(extractPath, "utf8"));
  const finalImportId = importId || buildImportId(extract);
  const now = new Date().toISOString();
  const importRun = {
    import_id: finalImportId,
    source_type: "xlsx",
    source_name: extract.source_name || "",
    file_name: extract.source_name || "",
    started_at: now,
    finished_at: now,
    status: "loaded",
    row_counts: extract.summary || {},
    memo: "Excel source cell preservation import via publishable-key temporary ll_* policy",
  };
  const records = buildRecords(finalImportId, extract);
  await rest("ll_import_runs?on_conflict=import_id", [importRun]);
  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    await rest("ll_source_cells?on_conflict=source_cell_id", chunk);
    process.stdout.write(
      JSON.stringify({ chunk: Math.floor(index / chunkSize) + 1, inserted: chunk.length, total: records.length }) + "\n"
    );
  }
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        import_id: finalImportId,
        source_cell_rows: records.length,
        non_empty_cell_rows: records.filter((row) => !row.is_blank).length,
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
