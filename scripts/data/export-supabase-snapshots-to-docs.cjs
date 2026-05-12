#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DOCS_DATA = path.join(ROOT, "docs", "data");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://qvegpozwrcmspdvjokiz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P";

const ROOT_FILE_BY_PAGE = Object.freeze({
  bootstrap: ["shell", "bootstrap.json"],
  weekly: ["default", "weekly.json"],
  home: ["default", "home.json"],
  sector: ["default", "sector.json"],
  tools: ["default", "tools.json"],
  playground: ["default", "playground.json"],
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sanitizePublic(value, trail = []) {
  if (Array.isArray(value)) return value.map((item, index) => sanitizePublic(item, trail.concat(String(index))));
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    const joined = trail.concat(key).join(".");
    if (/service[_-]?role|secret|authorization|password|token|api[_-]?key|script[_-]?propert/i.test(joined)) continue;
    next[key] = sanitizePublic(child, trail.concat(key));
  }
  return next;
}

async function fetchRows(offset) {
  const params = new URLSearchParams({
    select: "snapshot_key,page,entity_id,payload,generated_at,schema_version,source,source_system,user_safe",
    source: "eq.supabase_snapshot",
    user_safe: "eq.true",
    order: "page.asc,entity_id.asc",
    limit: "1000",
    offset: String(offset),
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/ll_payload_snapshots?${params}`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`ll_payload_snapshots HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

async function fetchAllRows() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const chunk = await fetchRows(offset);
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return rows;
}

function outputPathFor(row) {
  const page = row.page;
  const entityId = row.entity_id || "default";
  if (ROOT_FILE_BY_PAGE[page] && ROOT_FILE_BY_PAGE[page][0] === entityId) {
    return path.join(DOCS_DATA, ROOT_FILE_BY_PAGE[page][1]);
  }
  if (page === "asset" && entityId) return path.join(DOCS_DATA, "asset", `${entityId}.json`);
  if (page === "company" && entityId) return path.join(DOCS_DATA, "company", `${entityId}.json`);
  return "";
}

async function main() {
  const rows = await fetchAllRows();
  const written = [];
  const skipped = [];
  const rootPayloads = {};
  for (const row of rows) {
    const target = outputPathFor(row);
    if (!target) {
      skipped.push({ page: row.page, entity_id: row.entity_id });
      continue;
    }
    const payload = sanitizePublic(Object.assign({}, row.payload || {}, {
      generatedAt: row.payload?.generatedAt || row.generated_at,
      schemaVersion: row.payload?.schemaVersion || row.schema_version,
      payloadSource: row.source,
      dataSourceMode: "supabase_snapshot",
      sourceSystem: row.source_system,
    }));
    writeJson(target, payload);
    if (ROOT_FILE_BY_PAGE[row.page] && ROOT_FILE_BY_PAGE[row.page][0] === (row.entity_id || "default")) {
      rootPayloads[row.page] = payload;
    }
    written.push(path.relative(ROOT, target));
  }
  if (Object.keys(rootPayloads).length) {
    const initialPath = path.join(DOCS_DATA, "initial.json");
    writeJson(initialPath, { tabPayloads: rootPayloads, generatedAt: new Date().toISOString() });
    written.push(path.relative(ROOT, initialPath));
  }
  console.log(JSON.stringify({
    ok: true,
    rows: rows.length,
    written: written.length,
    skipped,
    pages: rows.reduce((acc, row) => {
      acc[row.page] = (acc[row.page] || 0) + 1;
      return acc;
    }, {}),
  }, null, 2));
}

main().catch((error) => {
  const message = String(error && error.stack ? error.stack : error)
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, "[redacted-supabase-secret]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]");
  console.error(message);
  process.exit(1);
});
