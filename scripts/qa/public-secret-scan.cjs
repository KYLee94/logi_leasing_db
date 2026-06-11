#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "qa-artifacts", "security");
const OUT_FILE = path.join(OUT_DIR, "public-secret-scan.json");
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "docs/staff",
  "직원 사진",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".csv",
  ".env",
  ".gs",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".lock",
  ".md",
  ".mjs",
  ".py",
  ".sql",
  ".toml",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const STRICT_PATTERNS = [
  { name: "supabase-secret-key", regex: /\bsb_secret_[A-Za-z0-9._-]{20,}\b/g },
  { name: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "openai-api-key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "github-token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g },
  { name: "github-fine-grained-token", regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: "private-key-block", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g },
  { name: "jwt-like-token", regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g },
];

const GENERIC_SECRET_ASSIGNMENT = /\b(api[_-]?key|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization|service[_-]?role(?:[_-]?key)?)\b\s*[:=]\s*["']([^"'\s]{20,})["']/gi;

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function isExcluded(filePath) {
  const relative = rel(filePath);
  return Array.from(EXCLUDED_DIRS).some((dir) => relative === dir || relative.startsWith(`${dir}/`));
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return path.basename(filePath).toLowerCase().startsWith(".env");
}

function redact(value) {
  const text = String(value || "");
  if (text.length <= 12) return "[redacted]";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function allowedGenericValue(name, value, line) {
  const joined = `${name} ${value} ${line}`;
  if (/publishable|anon|redacted|placeholder|example|your_|process\.env|Deno\.env|<.*>|xxxx|dummy|test/i.test(joined)) return true;
  if (/sb_publishable_[A-Za-z0-9._-]+/.test(joined)) return true;
  return false;
}

function lineForIndex(text, index) {
  const start = text.lastIndexOf("\n", Math.max(index - 1, 0)) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}

function scanText(text, filePath) {
  const findings = [];
  for (const pattern of STRICT_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      const line = lineForIndex(text, match.index || 0);
      if (/sb_publishable_[A-Za-z0-9._-]+/.test(match[0])) continue;
      findings.push({
        file: rel(filePath),
        pattern: pattern.name,
        sample: redact(match[0]),
        line: line.trim().slice(0, 220),
      });
    }
  }

  GENERIC_SECRET_ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(GENERIC_SECRET_ASSIGNMENT)) {
    const name = match[1] || "";
    const value = match[2] || "";
    const line = lineForIndex(text, match.index || 0);
    if (allowedGenericValue(name, value, line)) continue;
    findings.push({
      file: rel(filePath),
      pattern: "generic-secret-assignment",
      key: name,
      sample: redact(value),
      line: line.trim().slice(0, 220),
    });
  }
  return findings;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (isExcluded(filePath)) continue;
    if (entry.isDirectory()) {
      walk(filePath, files);
      continue;
    }
    if (!entry.isFile() || !isTextFile(filePath)) continue;
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_SCAN_BYTES) continue;
    files.push(filePath);
  }
  return files;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = walk(ROOT);
  const findings = [];
  for (const file of files) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (_error) {
      continue;
    }
    findings.push(...scanText(text, file));
  }
  const result = {
    ok: findings.length === 0,
    generatedAt: new Date().toISOString(),
    scannedFiles: files.length,
    findings,
    allowedPublicKeys: [
      "Supabase publishable key values such as sb_publishable_* are public client keys, not service-role secrets.",
    ],
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({ ok: result.ok, scannedFiles: result.scannedFiles, findingCount: findings.length, outFile: OUT_FILE, findings }, null, 2));
  if (!result.ok) process.exit(1);
}

main();
