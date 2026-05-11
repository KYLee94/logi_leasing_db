#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MUTATION_RE = /\b(create\s+(?:unique\s+)?index|create\s+policy|create\s+table|alter\s+table|drop\s+policy|drop\s+table|truncate\s+table|insert\s+into|update\s+(?!set\b)|delete\s+from|merge\s+into|copy|grant|revoke)\b/gi;
const FORBIDDEN_RE = /\b(cascade|drop\s+schema|drop\s+owned|alter\s+default\s+privileges)\b/i;

function usage() {
  console.error('Usage: node scripts/supabase/check-sql-ll-only.cjs <file.sql>');
}

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function extractObjectName(sql, index) {
  const tail = sql.slice(index, index + 400).replace(/\s+/g, ' ');
  const patterns = [
    /\b(?:create\s+table|alter\s+table|drop\s+table(?:\s+if\s+exists)?|truncate\s+table|insert\s+into|update|delete\s+from|merge\s+into|copy)\s+(?:if\s+not\s+exists\s+)?((?:"?public"?\.)?"?[A-Za-z0-9_]+"?)/i,
    /\b(?:create\s+(?:unique\s+)?index)\s+(?:if\s+not\s+exists\s+)?("?ll_[A-Za-z0-9_]+"?)\s+on\s+((?:"?public"?\.)?"?[A-Za-z0-9_]+"?)/i,
    /\b(?:create\s+policy|drop\s+policy(?:\s+if\s+exists)?)\s+"?[A-Za-z0-9_]+"?\s+on\s+((?:"?public"?\.)?"?[A-Za-z0-9_]+"?)/i,
    /\b(?:grant|revoke)\b[\s\S]{0,120}?\bon\s+(?:table\s+)?((?:"?public"?\.)?"?[A-Za-z0-9_]+"?)/i,
  ];
  for (const pattern of patterns) {
    const match = tail.match(pattern);
    if (!match) continue;
    return (match[2] || match[1] || '').replace(/"/g, '');
  }
  return '';
}

function normalizeObjectName(name) {
  const cleaned = String(name || '').replace(/"/g, '');
  if (!cleaned) return '';
  const parts = cleaned.split('.');
  return parts[parts.length - 1];
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function main() {
  const input = process.argv[2];
  if (!input) {
    usage();
    process.exit(2);
  }
  const filePath = path.resolve(process.cwd(), input);
  const sql = fs.readFileSync(filePath, 'utf8');
  const stripped = stripComments(sql);
  const failures = [];

  if (FORBIDDEN_RE.test(stripped)) {
    failures.push({ line: 1, reason: 'forbidden global SQL pattern', object: null });
  }

  for (const match of stripped.matchAll(MUTATION_RE)) {
    const objectName = extractObjectName(stripped, match.index || 0);
    const tableName = normalizeObjectName(objectName);
    if (!tableName || !tableName.startsWith('ll_')) {
      failures.push({
        line: lineNumberAt(stripped, match.index || 0),
        operation: match[1],
        object: objectName || '(unparsed)',
        reason: 'mutation target is not public.ll_*',
      });
    }
  }

  const references = [...stripped.matchAll(/\breferences\s+((?:"?public"?\.)?"?[A-Za-z0-9_]+"?)/gi)];
  references.forEach((match) => {
    const tableName = normalizeObjectName(match[1]);
    if (!tableName.startsWith('ll_')) {
      failures.push({
        line: lineNumberAt(stripped, match.index || 0),
        operation: 'references',
        object: match[1],
        reason: 'foreign key reference is not public.ll_*',
      });
    }
  });

  const summary = {
    ok: failures.length === 0,
    file: filePath,
    failures,
    checked: {
      mutationsOnlyPublicLl: failures.length === 0,
      noCascadeOrGlobalDrop: !FORBIDDEN_RE.test(stripped),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main();
