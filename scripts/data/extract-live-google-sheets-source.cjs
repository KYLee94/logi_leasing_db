#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SPREADSHEET_ID = "1powCa2TV7Pkqi3Un3mz3clJPwJ9xw7lMr1bZ0eLMqVA";
const DEFAULT_OUT_DIR = path.join(ROOT, "qa-artifacts", "source-diff", "live-google-sheets");

const HEADER_ROWS = Object.freeze({
  "meta_DB_일반": { headerRow: 2, dataStartRow: 3 },
  "DB_일반": { headerRow: 9, dataStartRow: 12 },
  "DB_히스토리 누적": { headerRow: 10, dataStartRow: 15 },
  "DB_기업": { headerRow: 1, dataStartRow: 2 },
  "DB_자산": { headerRow: 1, dataStartRow: 2 },
  "DB_계산": { headerRow: 1, dataStartRow: 2 },
  "펀드-자산-담당자 연결": { headerRow: 1, dataStartRow: 2 },
  "이슈 리스트": { headerRow: 1, dataStartRow: 2 },
  AuditLog: { headerRow: 1, dataStartRow: 2 },
});

function parseArgs(argv) {
  const args = {
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID,
    outDir: DEFAULT_OUT_DIR,
    includeHidden: true,
    maxColumns: 220,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--spreadsheet-id") args.spreadsheetId = argv[++index] || args.spreadsheetId;
    else if (arg.startsWith("--spreadsheet-id=")) args.spreadsheetId = arg.slice("--spreadsheet-id=".length);
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++index] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg === "--visible-only") args.includeHidden = false;
    else if (arg === "--max-columns") args.maxColumns = Number(argv[++index] || args.maxColumns);
    else if (arg.startsWith("--max-columns=")) args.maxColumns = Number(arg.slice("--max-columns=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.spreadsheetId) throw new Error("Missing spreadsheet id.");
  if (!Number.isFinite(args.maxColumns) || args.maxColumns < 1) throw new Error("--max-columns must be positive.");
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readClaspToken() {
  const rcPath = path.join(os.homedir(), ".clasprc.json");
  const rc = readJson(rcPath);
  const token = rc.tokens && rc.tokens.default;
  if (!token || !token.refresh_token || !token.client_id || !token.client_secret) {
    throw new Error("Google OAuth token is missing. Run npm run clasp:login first.");
  }
  return token;
}

async function getAccessToken(token) {
  if (token.access_token && Number(token.expiry_date || 0) > Date.now() + 60000) return token.access_token;
  const body = new URLSearchParams({
    client_id: token.client_id,
    client_secret: token.client_secret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error(`Failed to refresh Google OAuth token: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

function a1Quote(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

function colLetter(columnNumber) {
  let value = Math.max(1, columnNumber);
  let text = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    text = String.fromCharCode(65 + remainder) + text;
    value = Math.floor((value - 1) / 26);
  }
  return text || "A";
}

function normalizeText(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function inferType(rawValue, formulaText, displayValue) {
  if (formulaText) return "formula";
  if (!displayValue) return "blank";
  if (typeof rawValue === "number") return "number";
  if (typeof rawValue === "boolean") return "boolean";
  return "text";
}

async function sheetsFetch(accessToken, spreadsheetId, endpoint, params) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${endpoint}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
    else if (value != null) url.searchParams.set(key, value);
  });
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Google Sheets API ${response.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function batchGet(accessToken, spreadsheetId, ranges, valueRenderOption) {
  if (!ranges.length) return new Map();
  const json = await sheetsFetch(accessToken, spreadsheetId, "/values:batchGet", {
    ranges,
    valueRenderOption,
    dateTimeRenderOption: "FORMATTED_STRING",
    majorDimension: "ROWS",
  });
  const result = new Map();
  (json.valueRanges || []).forEach((rangeResult, index) => {
    result.set(ranges[index], rangeResult.values || []);
  });
  return result;
}

function valueAt(rows, rowIndex, columnIndex) {
  const row = rows[rowIndex - 1] || [];
  return row[columnIndex - 1];
}

function rangeMax(rows) {
  let maxRows = rows.length;
  let maxColumns = 0;
  rows.forEach((row) => {
    maxColumns = Math.max(maxColumns, Array.isArray(row) ? row.length : 0);
  });
  return { maxRows, maxColumns };
}

function getSheetSpec(title) {
  return HEADER_ROWS[title] || { headerRow: 1, dataStartRow: 2 };
}

function buildExtract(metadata, formattedByRange, formulaByRange, rawByRange, rangesByTitle) {
  const extractedAt = new Date().toISOString();
  const extract = {
    source_kind: "live_google_sheets",
    source_system: "google_sheets",
    source_name: metadata.properties?.title || "IGIS_Logistics_Leasing_Data",
    spreadsheet_id: metadata.spreadsheetId,
    extracted_at: extractedAt,
    sheets: [],
    columns: [],
    rows: [],
    cells: [],
    summary: {
      sheet_count: 0,
      row_count: 0,
      column_count: 0,
      cell_count: 0,
      formula_cell_count: 0,
      non_empty_cell_count: 0,
    },
  };

  const titleToSheet = new Map((metadata.sheets || []).map((sheet) => [sheet.properties.title, sheet]));
  Object.entries(rangesByTitle).forEach(([title, range], sheetOffset) => {
    const sheet = titleToSheet.get(title);
    const formattedRows = formattedByRange.get(range) || [];
    const formulaRows = formulaByRange.get(range) || [];
    const rawRows = rawByRange.get(range) || [];
    const formattedMax = rangeMax(formattedRows);
    const formulaMax = rangeMax(formulaRows);
    const rawMax = rangeMax(rawRows);
    const rowCount = Math.max(formattedMax.maxRows, formulaMax.maxRows, rawMax.maxRows, 1);
    const columnCount = Math.max(formattedMax.maxColumns, formulaMax.maxColumns, rawMax.maxColumns, 1);
    const spec = getSheetSpec(title);
    const headerRow = Math.min(Math.max(1, Number(spec.headerRow || 1)), rowCount);
    const sheetId = `live_${String(sheetOffset + 1).padStart(2, "0")}_${hash(title).slice(0, 10)}`;
    const headerValues = formattedRows[headerRow - 1] || [];
    const sheetCellCount = rowCount * columnCount;

    extract.sheets.push({
      sheet_id: sheetId,
      import_id: null,
      sheet_name: title,
      source_file: "live_google_sheets",
      row_count: rowCount,
      column_count: columnCount,
      cell_count: sheetCellCount,
      header_row: headerRow,
      data_start_row: Number(spec.dataStartRow || headerRow + 1),
      hidden: Boolean(sheet?.properties?.hidden),
      source_hash: hash({ sheet: title, rows: rowCount, cols: columnCount }),
    });

    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const columnId = `${sheetId}_c${String(columnIndex).padStart(4, "0")}`;
      extract.columns.push({
        column_id: columnId,
        sheet_id: sheetId,
        column_index: columnIndex,
        column_letter: colLetter(columnIndex),
        header_value: normalizeText(headerValues[columnIndex - 1]),
        normalized_header: normalizeText(headerValues[columnIndex - 1]) || `blank_col_${String(columnIndex).padStart(3, "0")}`,
        column_role: normalizeText(headerValues[columnIndex - 1]) ? "business_value" : "blank_header",
      });
    }

    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
      const rowId = `${sheetId}_r${String(rowNumber).padStart(6, "0")}`;
      const rowHashParts = [];
      let nonEmptyCellCount = 0;
      for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
        const displayValue = normalizeText(valueAt(formattedRows, rowNumber, columnIndex));
        const formulaValue = normalizeText(valueAt(formulaRows, rowNumber, columnIndex));
        const rawValue = valueAt(rawRows, rowNumber, columnIndex);
        const formulaText = formulaValue.startsWith("=") ? formulaValue : "";
        const isBlank = !displayValue && !formulaText;
        const columnLetter = colLetter(columnIndex);
        if (!isBlank) nonEmptyCellCount += 1;
        rowHashParts.push(`${displayValue}${formulaText ? `|${formulaText}` : ""}`);
        const cellPayload = {
          sheet_name: title,
          row_number: rowNumber,
          column_index: columnIndex,
          column_letter: columnLetter,
          header_label: normalizeText(headerValues[columnIndex - 1]),
          a1_ref: `${title}!${columnLetter}${rowNumber}`,
          display_value: displayValue,
          raw_value: normalizeText(rawValue),
          formula: formulaText,
          is_blank: isBlank,
          number_format: "",
          note: "",
          value_type: inferType(rawValue, formulaText, displayValue),
          extraction_method: "google_sheets_values_batchGet",
        };
        cellPayload.source_hash = hash(cellPayload);
        cellPayload.cell_id = `${rowId}_c${String(columnIndex).padStart(4, "0")}`;
        cellPayload.row_id = rowId;
        cellPayload.column_id = `${sheetId}_c${String(columnIndex).padStart(4, "0")}`;
        extract.cells.push(cellPayload);
      }
      extract.rows.push({
        row_id: rowId,
        sheet_id: sheetId,
        row_number: rowNumber,
        row_hash: hash(rowHashParts),
        non_empty_cell_count: nonEmptyCellCount,
      });
    }

    extract.summary.row_count += rowCount;
    extract.summary.column_count += columnCount;
    extract.summary.cell_count += sheetCellCount;
  });

  extract.summary.sheet_count = extract.sheets.length;
  extract.summary.formula_cell_count = extract.cells.filter((cell) => cell.formula).length;
  extract.summary.non_empty_cell_count = extract.cells.filter((cell) => !cell.is_blank).length;
  return extract;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = readClaspToken();
  const accessToken = await getAccessToken(token);
  const metadata = await sheetsFetch(accessToken, args.spreadsheetId, "", {
    fields: "spreadsheetId,properties.title,sheets.properties(title,hidden,gridProperties(rowCount,columnCount))",
    includeGridData: "false",
  });
  const sheetTitles = (metadata.sheets || [])
    .map((sheet) => sheet.properties)
    .filter((props) => props && (args.includeHidden || !props.hidden))
    .map((props) => props.title);
  const rangesByTitle = {};
  sheetTitles.forEach((title) => {
    const props = metadata.sheets.find((sheet) => sheet.properties.title === title)?.properties || {};
    const grid = props.gridProperties || {};
    const width = Math.max(1, Math.min(Number(grid.columnCount || 26), args.maxColumns));
    rangesByTitle[title] = `${a1Quote(title)}!A:${colLetter(width)}`;
  });
  const ranges = Object.values(rangesByTitle);
  const formatted = await batchGet(accessToken, args.spreadsheetId, ranges, "FORMATTED_VALUE");
  const formulas = await batchGet(accessToken, args.spreadsheetId, ranges, "FORMULA");
  const raw = await batchGet(accessToken, args.spreadsheetId, ranges, "UNFORMATTED_VALUE");
  const extract = buildExtract(metadata, formatted, formulas, raw, rangesByTitle);

  fs.mkdirSync(args.outDir, { recursive: true });
  const outputPath = path.join(args.outDir, "live-google-sheets-extract.json");
  const summaryPath = path.join(args.outDir, "summary.json");
  fs.writeFileSync(outputPath, JSON.stringify(extract, null, 2), "utf8");
  fs.writeFileSync(summaryPath, JSON.stringify({ outputPath, summary: extract.summary, sheets: extract.sheets }, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, outputPath, summary: extract.summary }, null, 2));
}

main().catch((error) => {
  const message = String(error && error.stack ? error.stack : error)
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-google-token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted-token]");
  console.error(message);
  process.exit(1);
});
