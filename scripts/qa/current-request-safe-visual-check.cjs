const { buildDashboardPageUrl, chromium, getExecutablePath, resolveDashboardBaseUrl } = require("./playwright-runtime.cjs");
const {
  REQUIRED_PAYLOAD_SOURCE,
  UI_SECRET_PATTERN,
  USER_EDIT_PATTERN,
  buildSourceGateFailures,
  collectSourceGateSnapshot,
  isIgnorableRequestProblem,
  scanArtifactDirectoryForSecrets,
} = require("./dashboard-qa-gates.cjs");
const fs = require("fs");
const path = require("path");

const BASE_URL = resolveDashboardBaseUrl();
const USER_URL = process.env.USER_URL || buildDashboardPageUrl("user", BASE_URL);
const ADMIN_URL = process.env.ADMIN_URL || buildDashboardPageUrl("admin", BASE_URL);
const OUT_DIR = path.resolve(
  process.env.QA_OUT_DIR ||
    path.join("qa-artifacts", "current-request-safe", new Date().toISOString().replace(/[:.]/g, "-"))
);
const USER_TABS = ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality"];
const THEMES = ["dark", "light"];
const SOURCE_GATE_TABS = (process.env.QA_SOURCE_GATE_TABS || USER_TABS.join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ENTITY_FRAME_SELECTORS = {
  asset: ".iota-workspace-layout .iota-workspace-main .page-stack-asset",
  company: ".iota-workspace-layout .iota-workspace-main .page-stack-company",
};

function toConsoleEntry(message) {
  const location = typeof message.location === "function" ? message.location() : {};
  return {
    source: "console",
    type: typeof message.type === "function" ? message.type() : "",
    text: typeof message.text === "function" ? message.text() : String(message || ""),
    url: location.url || "",
    lineNumber: location.lineNumber || 0,
    columnNumber: location.columnNumber || 0,
  };
}

function toPageErrorEntry(error) {
  return {
    source: "pageerror",
    type: "pageerror",
    text: error && error.message ? error.message : String(error || ""),
    url: "",
    lineNumber: 0,
    columnNumber: 0,
  };
}

function ignoredConsoleWarningReason(entry) {
  const text = String(entry.text || "");
  const haystack = `${text} ${entry.url || ""}`;
  if (
    /content security policy|\bcsp\b/i.test(text) &&
    /report[- ]only|\[report only\]/i.test(text) &&
    /script\.google|googleusercontent|userCodeAppPanel|macros\/s|apps script/i.test(haystack)
  ) {
    return "google-wrapper-report-only-csp";
  }
  return "";
}

function captureConsoleMessage(message, consoleErrors, ignoredConsoleWarnings) {
  const entry = toConsoleEntry(message);
  const ignoredReason = ignoredConsoleWarningReason(entry);
  if (ignoredReason) {
    ignoredConsoleWarnings.push(Object.assign({ reason: ignoredReason }, entry));
    return;
  }
  if (entry.type === "error") consoleErrors.push(entry.text);
}

function capturePageError(error, consoleErrors, ignoredConsoleWarnings) {
  const entry = toPageErrorEntry(error);
  const ignoredReason = ignoredConsoleWarningReason(entry);
  if (ignoredReason) {
    ignoredConsoleWarnings.push(Object.assign({ reason: ignoredReason }, entry));
    return;
  }
  consoleErrors.push(entry.text);
}

async function findAppFrame(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const count = await frame.locator("#app-shell, #admin-auth-root, #admin-auth-password, #admin-password-input").count().catch(() => 0);
      if (count > 0) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("dashboard frame not found");
}

async function waitForTabReady(frame, tab) {
  await frame.waitForFunction((target) => {
    const state = window.dashboardApp?.getState?.();
    const root = document.getElementById(`${target}-view`);
    const overlay = document.getElementById("loading-overlay");
    const overlayVisible = overlay && overlay.classList.contains("is-visible");
    if (!state || state.activeTab !== target || !root || overlayVisible) return false;
    const text = root.innerText.trim();
    const status = root.dataset.renderStatus || "";
    if (status === "skeleton" || status === "rendering" || status === "selection-shell") return false;
    if (/화면을 준비하고 있습니다|기준 정보와 선택값을 먼저 맞춘 뒤/.test(text)) return false;
    const minimumTextLength = {
      weekly: 1200,
      home: 1000,
      asset: 1000,
      company: 1000,
      sector: 1200,
      tools: 1200,
      playground: 1000,
      quality: 500,
    }[target] || 500;
    return text.length >= minimumTextLength;
  }, tab, { timeout: 120000 });
  const isEntityTab = tab === "asset" || tab === "company";
  await frame.waitForFunction(([target, selectors]) => {
    const root = document.getElementById(`${target}-view`);
    const state = window.dashboardApp?.getState?.() || {};
    if (!root || state.activeTab !== target) return false;
    if (selectors[target]) {
      return !!(
        root.querySelector(selectors[target]) &&
        root.querySelector(".iota-workspace-layout .project-rail")
      );
    }
    const payload = state.lastSuccessfulPayloads?.[target];
    return !!(
      root.querySelector(".iota-workspace-layout") ||
      payload
    );
  }, [tab, ENTITY_FRAME_SELECTORS], { timeout: isEntityTab ? 150000 : 120000 });
  await frame.waitForTimeout(800);
}

async function switchTab(frame, tab) {
  await frame.waitForFunction(() => !!window.dashboardApp?.getState, null, { timeout: 90000 });
  await frame.evaluate((target) => {
    if (window.dashboardApp?.switchTab) {
      window.dashboardApp.switchTab(target);
      return;
    }
    document.querySelector(`[data-tab="${target}"]`)?.click();
  }, tab);
  await waitForTabReady(frame, tab);
}

async function switchTheme(frame, theme) {
  const exists = await frame.locator(`[data-theme-choice="${theme}"]`).count().catch(() => 0);
  if (!exists) return false;
  await frame.evaluate((target) => document.querySelector(`[data-theme-choice="${target}"]`)?.click(), theme);
  await frame.waitForTimeout(500);
  return true;
}

async function collectUserState(frame, tab) {
  return frame.evaluate(({ target, secretPatternSource, editPatternSource }) => {
    const secretRegex = new RegExp(secretPatternSource, "i");
    const editRegex = new RegExp(editPatternSource, "i");
    const root = document.getElementById(`${target}-view`);
    const bodyText = document.body.innerText || "";
    const state = window.dashboardApp?.getState?.() || {};
    const payload = state.lastSuccessfulPayloads?.[target] || null;
    return {
      tab: target,
      activeTab: state.activeTab || "",
      renderStatus: root?.dataset?.renderStatus || "",
      rootTextLength: root ? root.innerText.trim().length : 0,
      hasLoadingPlaceholder: root ? /화면을 준비하고 있습니다|기준 정보와 선택값을 먼저 맞춘 뒤/.test(root.innerText || "") : false,
      sourceChip: root?.querySelector(".iota-source-chip")?.textContent?.trim() || "",
      railCount: root ? root.querySelectorAll(".project-rail .rail-btn").length : 0,
      workspaceLayoutCount: root ? root.querySelectorAll(".iota-workspace-layout").length : 0,
      entityFrameReady: target === "asset"
        ? !!root?.querySelector(".iota-workspace-layout .iota-workspace-main .page-stack-asset")
        : target === "company"
          ? !!root?.querySelector(".iota-workspace-layout .iota-workspace-main .page-stack-company")
          : true,
      payloadSource: payload?.payloadSource || payload?.dataSource || payload?.meta?.payloadSource || "",
      hasAdminNav: !!document.querySelector('[data-tab="admin"], [data-tab="admin-data"]'),
      hasAdminAction: !!document.querySelector('[data-admin-action], [data-admin-data-entity], [data-admin-data-new], [data-admin-data-open]'),
      hasEditUi: editRegex.test(bodyText),
      hasSecretText: secretRegex.test(bodyText),
      consoleReady: !!window.dashboardApp,
    };
  }, {
    target: tab,
    secretPatternSource: UI_SECRET_PATTERN.source,
    editPatternSource: USER_EDIT_PATTERN.source,
  });
}

async function runUser(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const consoleErrors = [];
  const ignoredConsoleWarnings = [];
  const requestFailures = [];
  const httpProblems = [];
  page.on("pageerror", (error) => capturePageError(error, consoleErrors, ignoredConsoleWarnings));
  page.on("console", (message) => captureConsoleMessage(message, consoleErrors, ignoredConsoleWarnings));
  page.on("response", (response) => {
    if (response.status() >= 400) httpProblems.push({ status: response.status(), url: response.url() });
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText || "",
    });
  });
  await page.goto(USER_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  const frame = await findAppFrame(page);
  await frame.waitForFunction(() => !!window.dashboardApp?.getState, null, { timeout: 90000 });
  const captures = [];
  for (const theme of THEMES) {
    await switchTheme(frame, theme);
    for (const tab of USER_TABS) {
      await switchTab(frame, tab);
      await page.screenshot({ path: path.join(OUT_DIR, `user-${theme}-${tab}.png`), fullPage: false });
      captures.push(Object.assign({ theme, screenshot: `user-${theme}-${tab}.png` }, await collectUserState(frame, tab)));
    }
  }

  await switchTab(frame, "home");
  const before = await frame.evaluate(() => ({
    loadingCount: window.dashboardApp?.getState?.()?.loadingCount || 0,
    cacheKeys: Object.keys(window.dashboardApp?.getState?.()?.pageCache || {}),
  }));
  await switchTab(frame, "asset");
  await switchTab(frame, "home");
  const after = await frame.evaluate(() => ({
    loadingCount: window.dashboardApp?.getState?.()?.loadingCount || 0,
    cacheKeys: Object.keys(window.dashboardApp?.getState?.()?.pageCache || {}),
  }));
  const sourceGateSnapshot = await collectSourceGateSnapshot(frame, SOURCE_GATE_TABS);
  await page.close();
  return {
    url: USER_URL,
    captures,
    revisit: { before, after },
    sourceGate: {
      requiredSource: REQUIRED_PAYLOAD_SOURCE,
      tabs: SOURCE_GATE_TABS,
      snapshot: sourceGateSnapshot,
      failures: buildSourceGateFailures(sourceGateSnapshot, {
        scope: "current-safe:user-source-gate",
        tabs: SOURCE_GATE_TABS,
      }),
    },
    consoleErrors,
    ignoredConsoleWarnings,
    requestFailures,
    httpProblems,
  };
}

async function runAdminGate(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const consoleErrors = [];
  const ignoredConsoleWarnings = [];
  const requestFailures = [];
  const httpProblems = [];
  page.on("pageerror", (error) => capturePageError(error, consoleErrors, ignoredConsoleWarnings));
  page.on("console", (message) => captureConsoleMessage(message, consoleErrors, ignoredConsoleWarnings));
  page.on("response", (response) => {
    if (response.status() >= 400) httpProblems.push({ status: response.status(), url: response.url() });
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText || "",
    });
  });
  await page.goto(ADMIN_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  const frame = await findAppFrame(page);
  await page.screenshot({ path: path.join(OUT_DIR, "admin-auth-gate.png"), fullPage: false });
  const state = await frame.evaluate((secretPatternSource) => {
    const secretRegex = new RegExp(secretPatternSource, "i");
    const bodyText = document.body.innerText || "";
    return {
      hasStandaloneGate: !!document.querySelector("#admin-auth-root"),
      hasPasswordInput: !!document.querySelector("#admin-auth-password, #admin-password-input"),
      hasAppShell: !!document.querySelector("#app-shell"),
      hasUnlockedAdminButtons: !!document.querySelector('[data-admin-action], [data-admin-data-entity]'),
      hasSecretText: secretRegex.test(bodyText),
    };
  }, UI_SECRET_PATTERN.source);
  await page.close();
  return {
    url: ADMIN_URL,
    screenshot: "admin-auth-gate.png",
    state,
    consoleErrors,
    ignoredConsoleWarnings,
    requestFailures,
    httpProblems,
  };
}

(async () => {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: getExecutablePath() });
  const user = await runUser(browser);
  const adminGate = await runAdminGate(browser);
  await browser.close();
  const failures = [];
  user.consoleErrors.forEach((error) => failures.push({ scope: "user", type: "console", error }));
  adminGate.consoleErrors.forEach((error) => failures.push({ scope: "admin", type: "console", error }));
  user.requestFailures.filter((item) => !isIgnorableRequestProblem(item)).forEach((item) => failures.push({ scope: "user", type: "request-failure", item }));
  user.httpProblems.filter((item) => !isIgnorableRequestProblem(item)).forEach((item) => failures.push({ scope: "user", type: "http-problem", item }));
  adminGate.requestFailures.filter((item) => !isIgnorableRequestProblem(item)).forEach((item) => failures.push({ scope: "admin", type: "request-failure", item }));
  adminGate.httpProblems.filter((item) => !isIgnorableRequestProblem(item)).forEach((item) => failures.push({ scope: "admin", type: "http-problem", item }));
  user.sourceGate.failures.forEach((failure) => failures.push(failure));
  user.captures.forEach((capture) => {
    if (capture.activeTab !== capture.tab) failures.push({ scope: "user", type: "active-tab", capture });
    if (!capture.consoleReady) failures.push({ scope: "user", type: "dashboardAppMissing", tab: capture.tab });
    if (capture.renderStatus === "skeleton" || capture.renderStatus === "rendering" || capture.renderStatus === "selection-shell") failures.push({ scope: "user", type: "tab-still-loading", tab: capture.tab, renderStatus: capture.renderStatus });
    if (capture.hasLoadingPlaceholder) failures.push({ scope: "user", type: "loading-placeholder-visible", tab: capture.tab });
    if (!capture.workspaceLayoutCount) failures.push({ scope: "user", type: "missing-iota-layout", tab: capture.tab });
    if (!capture.entityFrameReady) failures.push({ scope: "user", type: "missing-entity-frame", tab: capture.tab });
    if (!capture.railCount) failures.push({ scope: "user", type: "missing-action-rail", tab: capture.tab });
    if (capture.hasAdminNav) failures.push({ scope: "user", type: "admin-nav-visible", tab: capture.tab });
    if (capture.hasAdminAction) failures.push({ scope: "user", type: "admin-action-visible", tab: capture.tab });
    if (capture.hasEditUi) failures.push({ scope: "user", type: "edit-ui-visible", tab: capture.tab });
    if (capture.hasSecretText) failures.push({ scope: "user", type: "secret-text-visible", tab: capture.tab });
  });
  if (!adminGate.state.hasPasswordInput) failures.push({ scope: "admin", type: "password-gate-missing" });
  if (adminGate.state.hasUnlockedAdminButtons) failures.push({ scope: "admin", type: "admin-buttons-before-auth" });
  if (adminGate.state.hasSecretText) failures.push({ scope: "admin", type: "secret-text-before-auth" });
  const ignoredConsoleWarnings = []
    .concat(user.ignoredConsoleWarnings || [])
    .concat(adminGate.ignoredConsoleWarnings || []);
  const summary = { outDir: OUT_DIR, failures, ignoredConsoleWarnings, user, adminGate, secretScan: { findingCount: 0, findings: [] } };
  await fs.promises.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  const secretFindings = scanArtifactDirectoryForSecrets(OUT_DIR);
  if (secretFindings.length) {
    secretFindings.forEach((finding) => failures.push({ scope: "artifact", type: "secret-pattern", finding }));
    summary.failures = failures;
    summary.secretScan = { findingCount: secretFindings.length, findings: secretFindings };
    await fs.promises.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
