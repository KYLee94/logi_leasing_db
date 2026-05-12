#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUT_DIR = path.join(ROOT, "qa-artifacts", "source-diff", "live-google-sheets");

function parseArgs(argv) {
  const args = {
    outDir: DEFAULT_OUT_DIR,
    includeCells: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++index] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg === "--rows-only") args.includeCells = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readClaspConfig() {
  const project = readJson(path.join(ROOT, ".clasp.json"));
  const rcPath = path.join(os.homedir(), ".clasprc.json");
  const rc = readJson(rcPath);
  const token = rc.tokens && rc.tokens.default;
  if (!project.scriptId) throw new Error(".clasp.json scriptId is missing.");
  if (!token || !token.refresh_token || !token.client_id || !token.client_secret) {
    throw new Error("clasp OAuth token is missing. Run npm run clasp:login first.");
  }
  return { scriptId: project.scriptId, token };
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

function redact(text) {
  return String(text || "")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-google-token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted-token]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]");
}

async function runAppsScript(scriptId, accessToken, functionName, parameters) {
  const response = await fetch(`https://script.googleapis.com/v1/scripts/${scriptId}:run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      function: functionName,
      parameters,
      devMode: true,
    }),
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(redact(`Apps Script API failed: ${JSON.stringify(json)}`));
  }
  if (json.response && json.response.error) {
    throw new Error(redact(`Apps Script function failed: ${JSON.stringify(json.response.error)}`));
  }
  return json.response ? json.response.result : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (!adminPassword) throw new Error("ADMIN_PASSWORD environment variable is required.");
  const { scriptId, token } = readClaspConfig();
  const accessToken = await getAccessToken(token);
  const login = await runAppsScript(scriptId, accessToken, "verifyAdminPassword", [{ password: adminPassword }]);
  if (!login || login.status !== "ok" || !login.adminSessionToken) throw new Error("Admin authentication failed.");
  const extract = await runAppsScript(scriptId, accessToken, "adminExportLiveSheetsSourceExtract", [
    { adminSessionToken: login.adminSessionToken, includeCells: args.includeCells },
  ]);
  if (!extract || !extract.summary) throw new Error("Source extract result is empty.");

  fs.mkdirSync(args.outDir, { recursive: true });
  const outputPath = path.join(args.outDir, "live-google-sheets-extract.json");
  const summaryPath = path.join(args.outDir, "summary.json");
  fs.writeFileSync(outputPath, JSON.stringify(extract, null, 2), "utf8");
  fs.writeFileSync(summaryPath, JSON.stringify({ outputPath, summary: extract.summary, sheets: extract.sheets }, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, outputPath, summary: extract.summary }, null, 2));
}

main().catch((error) => {
  console.error(redact(error && error.stack ? error.stack : error));
  process.exit(1);
});
