#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CLIENT_PATH = path.join(ROOT, "Client.html");
const DOCS_APP_PATH = path.join(ROOT, "docs", "assets", "app.js");
const OUT_DIR = path.join(ROOT, "qa-artifacts", "component-audit");
const DOCS_DIR = path.join(ROOT, "docs");

const TAB_CONFIG = [
  {
    key: "weekly",
    label: "주간 업무",
    baselineFunctions: [
      "renderWeeklyReport",
      "renderWeeklyKpiStrip_",
      "openWeeklySummaryModal_",
      "openWeeklyMaturityModal_",
      "openWeeklyAllMaturityModal_",
      "openWeeklyIssueModal_",
      "renderWeeklyProjectDetail_",
      "openWeeklyProjectRawModal_",
      "openWeeklyAssetDetailModal_",
      "openWeeklyEditModal_",
    ],
    docsFunctions: ["renderWeekly"],
    serverFunctions: ["getWeeklyReportData", "adminUpdateWeeklyReportItem"],
  },
  {
    key: "home",
    label: "Home",
    baselineFunctions: ["renderHome", "openTenantDetailModal_", "openPortfolioMapModal_"],
    docsFunctions: ["renderHome", "renderHomeParitySections"],
    serverFunctions: ["getHomeData"],
  },
  {
    key: "asset",
    label: "Asset",
    baselineFunctions: ["renderAsset", "openPortfolioMapModal_"],
    docsFunctions: ["renderAsset", "renderAssetParitySections"],
    serverFunctions: ["getAssetData", "getAssetOptions"],
  },
  {
    key: "company",
    label: "Company",
    baselineFunctions: ["renderCompany", "openTenantDetailModal_", "openPortfolioMapModal_"],
    docsFunctions: ["renderCompany", "renderCompanyParitySections"],
    serverFunctions: ["getCompanyData", "getCompanyOptions"],
  },
  {
    key: "sector",
    label: "Sector",
    baselineFunctions: ["renderSector"],
    docsFunctions: ["renderSector", "renderSectorParitySections"],
    serverFunctions: ["getSectorData"],
  },
  {
    key: "tools",
    label: "Analysis Tools",
    baselineFunctions: ["renderTools", "renderToolsDraftLegacy_"],
    docsFunctions: ["renderTools", "renderToolsParitySections"],
    serverFunctions: ["getToolsData"],
  },
  {
    key: "playground",
    label: "Data Playground",
    baselineFunctions: ["renderPlayground", "renderPlaygroundDraftLegacy_"],
    docsFunctions: ["renderPlayground", "renderPlaygroundParitySections"],
    serverFunctions: ["getPlaygroundData"],
  },
  {
    key: "quality",
    label: "Data Quality",
    baselineFunctions: [
      "renderDataQuality",
      "openQualityIssueModal_",
      "openQualityGroupModal_",
      "openQualityIssueDetailModal_",
    ],
    docsFunctions: ["renderQuality", "renderQualityParitySections"],
    serverFunctions: ["getDataQualityData", "adminUpdateQualityIssueCell"],
  },
  {
    key: "admin",
    label: "Admin",
    baselineFunctions: ["renderAdminLegacy_", "renderAdminDraftLegacy_"],
    docsFunctions: ["renderAdmin", "renderAdminData", "renderAdminParitySections"],
    serverFunctions: [
      "adminRefreshCalculationSheet",
      "adminSyncOpenDartData",
      "adminSyncBuildingRegisterData",
      "adminRunDataAudit",
      "adminRunUiDataReconciliation",
      "adminRefreshDashboardSnapshot",
    ],
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function findFunctionBlock(source, functionName) {
  const pattern = new RegExp(`function\\s+${escapeRegExp(functionName)}\\s*\\(`, "m");
  const match = pattern.exec(source);
  if (!match) return "";
  const braceStart = source.indexOf("{", match.index);
  if (braceStart === -1) return "";
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  return source.slice(match.index);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values) {
  return Array.from(new Set(values.filter((value) => {
    const text = String(value || "").trim();
    if (!text) return false;
    if (text.includes("${") || text.includes("}")) return false;
    if (/escapeHtml_|safeGet_|format[A-Za-z]+_|row\.|card\.|point\./.test(text)) return false;
    return true;
  })));
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQuotedLabels(block) {
  const labels = [];
  const re = /["'`]([^"'`\n]{2,80})["'`]/g;
  let match;
  while ((match = re.exec(block))) {
    const value = clean(match[1]);
    if (!value) continue;
    if (/^[A-Za-z0-9_./:-]+$/.test(value) && value.length < 12) continue;
    if (/^(class|type|button|click|change|data-|aria-|canvas|table|grid|section)$/i.test(value)) continue;
    labels.push(value);
  }
  return unique(labels).slice(0, 120);
}

function extractMatches(block, regex, group = 1) {
  const values = [];
  let match;
  while ((match = regex.exec(block))) {
    values.push(clean(match[group]));
  }
  return unique(values);
}

function extractFunctionInventory(source, functionNames) {
  const blocks = functionNames
    .map((name) => ({ name, block: findFunctionBlock(source, name) }))
    .filter((item) => item.block);
  const combined = blocks.map((item) => item.block).join("\n\n");
  return {
    functionsFound: blocks.map((item) => item.name),
    missingFunctions: functionNames.filter((name) => !blocks.some((item) => item.name === name)),
    sections: unique(
      []
        .concat(extractMatches(combined, /section\(\s*["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /<h[1-6][^>]*>\s*\$\{[^}]+}\s*<\/h[1-6]>|<h[1-6][^>]*>\s*([^<${}]+)\s*<\/h[1-6]>/g))
        .concat(extractMatches(combined, /<span class=["'`]section-kicker["'`][^>]*>\s*([^<]+)\s*<\/span>/g))
    ),
    actionKeys: unique(
      []
        .concat(extractMatches(combined, /["'`]([^"'`]+)["'`]\s*:\s*\([^)]*\)\s*=>\s*open/g))
        .concat(extractMatches(combined, /data-action=["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /["'`]data-action["'`]\s*:\s*["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /data-[a-z0-9-]+=["'`]([^"'`]+)["'`]/gi))
    ),
    dataAttributes: unique(extractMatches(combined, /(data-[a-z0-9-]+)/gi)),
    selectors: unique(
      []
        .concat(extractMatches(combined, /querySelector(?:All)?\(["'`]([^"'`]+)["'`]\)/g))
        .concat(extractMatches(combined, /getElementById\(["'`]([^"'`]+)["'`]\)/g))
    ),
    tables: unique(
      []
        .concat(extractMatches(combined, /renderInteractiveTable_\(["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /bindInteractiveTable_\(["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /render(?:Searchable)?InteractiveTable\(["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /scope:\s*["'`]([^"'`]+)["'`]/g))
    ),
    tableHeaders: unique(extractMatches(combined, /renderTable_\(\s*\[([^\]]+)\]/g)).slice(0, 80),
    charts: unique(
      []
        .concat(extractMatches(combined, /render(?:Line|Bar|Doughnut)Chart_?\(["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /new Chart\(/g, 0))
    ),
    maps: unique(
      []
        .concat(extractMatches(combined, /(openPortfolioMapModal_|renderPortfolioMapPreview_|renderDynamicPortfolioMap_|renderOpenStreetMapPortfolioMap_|renderStaticPortfolioMap_)/g))
        .concat(extractMatches(combined, /(renderMapPanel)/g))
    ),
    modalCalls: unique(
      []
        .concat(extractMatches(combined, /openMetricModal_\(\s*["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /open[A-Za-z]+Modal_\(\s*["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /openDrawer\(\s*["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /actionButton\(\s*["'`]([^"'`]+)["'`]/g))
    ),
    controlIds: unique(
      []
        .concat(extractMatches(combined, /id=["'`]([^"'`]+)["'`]/g))
        .concat(extractMatches(combined, /#([A-Za-z0-9_-]+)/g))
    ),
    labels: extractQuotedLabels(combined),
  };
}

function buildGap(baseline, current) {
  const fields = ["sections", "actionKeys", "dataAttributes", "tables", "charts", "maps", "modalCalls", "controlIds"];
  const gap = {};
  for (const field of fields) {
    const currentSet = new Set(current[field] || []);
    gap[field] = (baseline[field] || []).filter((item) => !currentSet.has(item));
  }
  gap.score = fields.reduce((sum, field) => sum + gap[field].length, 0);
  return gap;
}

function markdownList(values, max = 14) {
  if (!values || !values.length) return "-";
  const shown = values.slice(0, max).map((value) => `\`${String(value).replace(/`/g, "")}\``);
  if (values.length > max) shown.push(`외 ${values.length - max}건`);
  return shown.join("<br>");
}

function renderInventoryMarkdown(result) {
  const rows = result.tabs.map((tab) => {
    return [
      tab.label,
      markdownList(tab.baseline.sections, 10),
      markdownList(tab.baseline.tables, 10),
      markdownList(tab.baseline.charts, 8),
      markdownList(tab.baseline.maps, 8),
      markdownList(tab.baseline.modalCalls, 10),
      markdownList(tab.baseline.actionKeys, 12),
      tab.serverFunctions.map((item) => `\`${item}\``).join("<br>"),
      tab.baseline.missingFunctions.length ? markdownList(tab.baseline.missingFunctions, 8) : "없음",
    ];
  });
  return `# 기준 대시보드 컴포넌트 보존 매트릭스\n\n` +
    `생성일: ${result.generatedAt}\n\n` +
    `이 문서는 기존 정상 Apps Script 코드에서 자동 추출한 1:1 복원 기준입니다. UI 구현은 이 표의 누락 항목을 0건으로 만드는 방식으로 진행합니다.\n\n` +
    `| 탭 | 기존 섹션 후보 | 기존 표/행 클릭 후보 | 기존 차트 후보 | 기존 지도 후보 | 기존 팝업/상세 후보 | 기존 액션/버튼 후보 | 서버 함수 | 추출 누락 함수 |\n` +
    `|---|---|---|---|---|---|---|---|---|\n` +
    rows.map((row) => `| ${row.join(" | ")} |`).join("\n") +
    `\n\n## 차단 조건\n\n` +
    `- 이 문서에서 누락으로 잡힌 항목은 "비슷한 UI"로 대체하지 않습니다.\n` +
    `- 탭별 컴포넌트, 클릭 동작, 팝업 내용, 숫자/표 헤더가 기존 기준과 맞기 전에는 해당 탭 완료로 보지 않습니다.\n` +
    `- Admin 기능은 기존 Apps Script 화면을 그대로 공개하지 않고, 통합 로그인/권한 구조로 이식합니다.\n`;
}

function renderGapMarkdown(result) {
  const rows = result.tabs.map((tab) => [
    tab.label,
    tab.gap.score,
    markdownList(tab.gap.sections, 10),
    markdownList(tab.gap.actionKeys, 12),
    markdownList(tab.gap.tables, 10),
    markdownList(tab.gap.charts, 8),
    markdownList(tab.gap.maps, 8),
    markdownList(tab.gap.modalCalls, 10),
    tab.gap.score === 0 ? "검증 필요" : "미복원",
  ]);
  return `# 현재 docs 구현 대비 기준 대시보드 차이표\n\n` +
    `생성일: ${result.generatedAt}\n\n` +
    `현재 \`docs/assets/app.js\`는 기존 \`Client.html\`의 컴포넌트를 1:1로 옮긴 것이 아니라, snapshot 기반으로 재구성되어 있습니다. 아래 항목은 우선 복원 backlog입니다.\n\n` +
    `| 탭 | 누락 점수 | 누락 섹션 | 누락 액션/버튼 | 누락 표/행 클릭 | 누락 차트 | 누락 지도 | 누락 팝업/상세 | 상태 |\n` +
    `|---|---:|---|---|---|---|---|---|---|\n` +
    rows.map((row) => `| ${row.join(" | ")} |`).join("\n") +
    `\n\n## 즉시 조치 기준\n\n` +
    `1. 누락 점수가 큰 탭부터 기존 함수의 화면 구조와 상호작용을 \`docs/\`로 이식합니다.\n` +
    `2. 지도는 현재 정적 marker panel이므로 기존 Naver/OSM/fallback 흐름과 별도 비교 QA가 필요합니다.\n` +
    `3. Admin은 read-only preview가 아니라 로그인/권한 기반 통합 화면으로 재구성합니다.\n`;
}

function main() {
  ensureDir(OUT_DIR);
  const client = readText(CLIENT_PATH);
  const docsApp = readText(DOCS_APP_PATH);
  const generatedAt = new Date().toISOString();
  const tabs = TAB_CONFIG.map((tab) => {
    const baseline = extractFunctionInventory(client, tab.baselineFunctions);
    const current = extractFunctionInventory(docsApp, tab.docsFunctions);
    return {
      key: tab.key,
      label: tab.label,
      serverFunctions: tab.serverFunctions,
      baseline,
      current,
      gap: buildGap(baseline, current),
    };
  });
  const result = {
    generatedAt,
    sourceFiles: {
      baseline: path.relative(ROOT, CLIENT_PATH),
      current: path.relative(ROOT, DOCS_APP_PATH),
    },
    tabs,
  };
  fs.writeFileSync(path.join(OUT_DIR, "baseline-component-inventory.json"), JSON.stringify(result, null, 2), "utf8");
  fs.writeFileSync(path.join(DOCS_DIR, "component-parity-matrix-20260512.md"), renderInventoryMarkdown(result), "utf8");
  fs.writeFileSync(path.join(DOCS_DIR, "current-vs-baseline-gap-report-20260512.md"), renderGapMarkdown(result), "utf8");
  console.log(JSON.stringify({
    generatedAt,
    tabs: tabs.length,
    gapScore: tabs.reduce((sum, tab) => sum + tab.gap.score, 0),
    outDir: path.relative(ROOT, OUT_DIR),
  }, null, 2));
}

main();
