#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const RUNTIME_FILES = [
  "docs/index.html",
  "docs/assets/app.js",
  "docs/assets/app.css",
  "supabase/functions/logistics-admin-api/index.ts",
  "scripts/data/export-supabase-snapshots-to-docs.cjs",
  "scripts/supabase/build-rich-snapshots-from-docs.cjs",
];

const BANNED_RUNTIME_PATTERNS = [
  /google\.script\.run/i,
  /script\.google\.com\/macros/i,
  /\/macros\/s\//i,
  /SpreadsheetApp/i,
  /PropertiesService/i,
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function scanRuntimeFiles() {
  const findings = [];
  for (const relativePath of RUNTIME_FILES) {
    if (!fs.existsSync(path.join(ROOT, relativePath))) continue;
    const text = readText(relativePath);
    for (const pattern of BANNED_RUNTIME_PATTERNS) {
      if (pattern.test(text)) {
        findings.push({ file: relativePath, pattern: String(pattern) });
      }
    }
  }
  return findings;
}

function scanPackageScripts() {
  const pkg = JSON.parse(readText("package.json"));
  const scripts = pkg.scripts || {};
  const findings = [];
  for (const [name, command] of Object.entries(scripts)) {
    const isLegacy = /^legacy:|legacy-apps-script/i.test(name);
    if (isLegacy) continue;
    if (name === "qa:no-apps-script") continue;
    const normalizedCommand = String(command).replace(/qa:no-apps-script/g, "qa:no-legacy-script");
    if (/clasp|apps-script|script\.google\.com|export-public-snapshots\.cjs|selector-switch-check|search-routing-check|admin-live-check|dashboard-perf-check\.cjs/.test(normalizedCommand)) {
      findings.push({ script: name, command });
    }
  }
  return findings;
}

function main() {
  const runtimeFindings = scanRuntimeFiles();
  const scriptFindings = scanPackageScripts();
  const ok = runtimeFindings.length === 0 && scriptFindings.length === 0;
  const result = {
    ok,
    runtimeFindings,
    scriptFindings,
    scannedRuntimeFiles: RUNTIME_FILES.length,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exit(1);
}

main();
