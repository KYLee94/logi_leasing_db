const fs = require("fs");
const path = require("path");

const REQUIRED_DATA_SOURCE_MODE = process.env.QA_REQUIRED_DATA_SOURCE_MODE || "supabase_snapshot";
const REQUIRED_PAYLOAD_SOURCE = process.env.QA_REQUIRED_PAYLOAD_SOURCE || "supabase_snapshot";
const SOURCE_GATE_REQUIRED = !/^false$/i.test(process.env.QA_SOURCE_GATE_REQUIRED || "true");

const UI_SECRET_PATTERN = /SUPABASE_SERVICE_ROLE_KEY|service_role|Bearer\s+|sb_secret_|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/i;
const USER_EDIT_PATTERN = /새 행 골격|데이터 편집 작업대|수정 사유|저장 요청|Admin Console|Supabase 연결 설정/i;

const ARTIFACT_SECRET_PATTERNS = [
  {
    name: "jwt-like-token",
    pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "supabase-secret-token",
    pattern: /sb_secret_[A-Za-z0-9_-]{20,}/gi,
  },
  {
    name: "bearer-token",
    pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
  },
  {
    name: "service-role-assignment",
    pattern: /(?:SUPABASE_SERVICE_ROLE_KEY|service_role)\s*[:=]\s*["']?[A-Za-z0-9._-]{20,}/gi,
  },
];

function normalizeSourceValue(value) {
  return String(value || "")
    .trim()
    .replace(/^source\s*:\s*/i, "")
    .replace(/\s+/g, "_")
    .replace(/-/g, "_")
    .toLowerCase();
}

function sourceMatchesRequired(value, requiredSource = REQUIRED_PAYLOAD_SOURCE) {
  return normalizeSourceValue(value) === normalizeSourceValue(requiredSource);
}

function extractSourceFromPayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  return (
    payload.__payloadSource ||
    payload.payloadSource ||
    payload.dataSource ||
    payload.source ||
    meta.payloadSource ||
    meta.dataSource ||
    meta.source ||
    ""
  );
}

async function collectSourceGateSnapshot(frame, tabs) {
  return frame.evaluate(({ targetTabs }) => {
    const runtime =
      (typeof RUNTIME_CLIENT_CONFIG !== "undefined" && RUNTIME_CLIENT_CONFIG) ||
      window.RUNTIME_CLIENT_CONFIG ||
      {};
    const state = window.dashboardApp?.getState?.() || {};
    const isStaticApp = !!document.getElementById("app") && !runtime.dataSourceMode;
    const readSource = (payload) => {
      if (!payload || typeof payload !== "object") return "";
      const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
      return (
        payload.__payloadSource ||
        payload.payloadSource ||
        payload.dataSource ||
        payload.source ||
        meta.payloadSource ||
        meta.dataSource ||
        meta.source ||
        ""
      );
    };
    const payloadFor = (tab) => {
      const candidates = [
        state.lastSuccessfulPayloads?.[tab],
        state.pageCache?.[tab],
        state.pageCache?.[`page:${tab}:default`],
        state.pageCache?.[`page:${tab}`],
        state.activeTab === tab ? state.activePayload : null,
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        if (candidate.payload && typeof candidate.payload === "object") return candidate.payload;
        if (typeof candidate === "object") return candidate;
      }
      return null;
    };
    return {
      runtimeConfig: {
        dataSourceMode: runtime.dataSourceMode || (isStaticApp ? "static" : ""),
        supabaseConfigured: runtime.supabaseConfigured === true,
        supabaseUrlConfigured: runtime.supabaseUrlConfigured === true,
        supabaseServiceRoleKeyConfigured: runtime.supabaseServiceRoleKeyConfigured === true,
      },
      activeTab: state.activeTab || "",
      tabs: targetTabs.map((tab) => {
        const root = document.getElementById(`${tab}-view`) || document.querySelector(`.tab-panel[data-panel="${tab}"]`);
        const payload = payloadFor(tab);
        const payloadSource = readSource(payload);
        return {
          tab,
          active: state.activeTab === tab,
          renderStatus: root?.dataset?.renderStatus || "",
          sourceChip: root?.querySelector(".iota-source-chip")?.textContent?.trim() || payloadSource,
          payloadSource,
          hasPayload: !!payload,
        };
      }),
    };
  }, { targetTabs: tabs });
}

function buildSourceGateFailures(snapshot, options = {}) {
  if (!SOURCE_GATE_REQUIRED && options.required !== true) return [];
  const requiredMode = options.requiredMode || REQUIRED_DATA_SOURCE_MODE;
  const requiredSource = options.requiredSource || REQUIRED_PAYLOAD_SOURCE;
  const tabs = options.tabs || (snapshot && snapshot.tabs) || [];
  const scope = options.scope || "source-gate";
  const failures = [];
  const runtime = snapshot && snapshot.runtimeConfig ? snapshot.runtimeConfig : {};

  if (runtime.dataSourceMode !== requiredMode) {
    failures.push({
      scope,
      type: "data-source-mode",
      expected: requiredMode,
      actual: runtime.dataSourceMode || "",
    });
  }
  if (/^supabase$/i.test(requiredMode) && runtime.supabaseConfigured !== true) {
    failures.push({
      scope,
      type: "supabase-configured",
      expected: true,
      actual: runtime.supabaseConfigured === true,
    });
  }

  for (const tab of tabs) {
    const tabInfo = typeof tab === "string"
      ? (snapshot.tabs || []).find((item) => item.tab === tab)
      : tab;
    if (!tabInfo) {
      failures.push({ scope, type: "missing-tab-source", tab });
      continue;
    }
    if (!sourceMatchesRequired(tabInfo.sourceChip, requiredSource)) {
      failures.push({
        scope,
        type: "source-chip",
        tab: tabInfo.tab,
        expected: requiredSource,
        actual: tabInfo.sourceChip || "",
      });
    }
    if (!sourceMatchesRequired(tabInfo.payloadSource, requiredSource)) {
      failures.push({
        scope,
        type: "payload-source",
        tab: tabInfo.tab,
        expected: requiredSource,
        actual: tabInfo.payloadSource || "",
        hasPayload: tabInfo.hasPayload === true,
      });
    }
  }
  return failures;
}

function isIgnorableConsole(entry) {
  const text = `${entry && entry.text ? entry.text : ""} ${entry && entry.url ? entry.url : ""}`;
  if (/Unrecognized feature:/i.test(text)) return true;
  if (/allow-scripts and allow-same-origin/i.test(text)) return true;
  if (/report[- ]only/i.test(text) && /Content Security Policy|frame-ancestors/i.test(text)) return true;
  return false;
}

function isIgnorableRequestProblem(item) {
  const url = String((item && item.url) || "");
  return /fonts\.gstatic|fonts\.googleapis/i.test(url);
}

function scanTextForSecrets(text) {
  const matches = [];
  const source = String(text || "");
  for (const item of ARTIFACT_SECRET_PATTERNS) {
    item.pattern.lastIndex = 0;
    const found = source.match(item.pattern) || [];
    for (const value of found.slice(0, 10)) {
      matches.push({
        pattern: item.name,
        sample: `${value.slice(0, 10)}...${value.slice(-6)}`,
      });
    }
  }
  return matches;
}

function scanArtifactDirectoryForSecrets(outDir) {
  const findings = [];
  const allowedExtensions = new Set([".json", ".txt", ".md", ".html", ".htm", ".log"]);
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      let text = "";
      try {
        text = fs.readFileSync(fullPath, "utf8");
      } catch (_error) {
        continue;
      }
      const matches = scanTextForSecrets(text);
      if (matches.length) {
        findings.push({
          file: path.relative(outDir, fullPath),
          matches,
        });
      }
    }
  };
  visit(outDir);
  return findings;
}

module.exports = {
  REQUIRED_DATA_SOURCE_MODE,
  REQUIRED_PAYLOAD_SOURCE,
  SOURCE_GATE_REQUIRED,
  UI_SECRET_PATTERN,
  USER_EDIT_PATTERN,
  buildSourceGateFailures,
  collectSourceGateSnapshot,
  extractSourceFromPayload,
  isIgnorableConsole,
  isIgnorableRequestProblem,
  normalizeSourceValue,
  scanArtifactDirectoryForSecrets,
  scanTextForSecrets,
  sourceMatchesRequired,
};
