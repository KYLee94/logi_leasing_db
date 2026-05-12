const { buildDashboardPageUrl, chromium, getExecutablePath, resolveDashboardBaseUrl } = require("./playwright-runtime.cjs");
const fs = require("fs");
const path = require("path");

const BASE_URL = resolveDashboardBaseUrl();
const USER_URL = process.env.USER_URL || buildDashboardPageUrl("user", BASE_URL);
const ADMIN_URL = process.env.ADMIN_URL || buildDashboardPageUrl("admin", BASE_URL);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const HEADLESS = !/^false$/i.test(process.env.DASHBOARD_HEADLESS || "true");
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.resolve(
  process.env.QA_OUT_DIR || path.join("qa-artifacts", "iota-live", RUN_STAMP)
);

const ROLE_TABS = {
  user: ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality"],
  admin: ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality", "admin", "admin-data"],
};
const THEMES = ["dark", "light"];
function parseCsvEnv(name, fallback) {
  const raw = process.env[name] || "";
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? values : fallback;
}
const ACTIVE_ROLES = parseCsvEnv("IOTA_LIVE_ROLES", ["user", "admin"]).filter((role) => ROLE_TABS[role]);
const ACTIVE_THEMES = parseCsvEnv("IOTA_LIVE_THEMES", THEMES).filter((theme) => THEMES.includes(theme));
const ACTIVE_TABS = parseCsvEnv("IOTA_LIVE_TABS", []);
const FILTERED_ERROR_PATTERNS = [
  /github\.io/i,
  /raw\.githubusercontent/i,
  /\b404\b/i,
  /ERR_FAILED/i,
  /violates.*report-only Content Security Policy/i,
  /frame-ancestors 'self'/i,
];

const TAB_EXPECTATIONS = {
  weekly: {
    title: "주간 업무",
    selectors: [
      ".weekly-report-page",
      '[data-action^="weekly-summary-"]',
      "#weekly-priority-table",
      "#weekly-maturity-chart",
      ".weekly-ledger-table",
    ],
  },
  home: {
    title: "Home",
    selectors: [
      "#home-view",
      "#home-rent-chart",
      "#home-expiry-chart",
      '[data-action="home-expiry-detail"]',
    ],
  },
  asset: {
    title: "Asset",
    selectors: [
      "#asset-view",
      "#asset-selector",
      ".asset-kpi-strip",
      "#asset-roster-table",
      ".stack-grid",
      ".stack-chip",
    ],
  },
  company: {
    title: "Company",
    selectors: [
      "#company-view",
      "#company-selector",
      ".company-kpi-strip",
      ".company-assets-table, .table-wrap-company-financials, #company-financials",
    ],
  },
  sector: {
    title: "Sector",
    selectors: [
      "#sector-view",
      "#sector-rent-chart",
      ".sector-ranking-table, #sector-expiry-table, .table-wrap",
    ],
  },
  tools: {
    title: "Analysis Tools",
    selectors: [
      "#tools-view",
      "#tools-benchmark-chart, .tools-benchmark-chart",
      ".tools-matrix-table, .table-wrap",
    ],
  },
  playground: {
    title: "Data Playground",
    selectors: [
      "#playground-view",
      ".playground-control-grid, .playground-controls",
      ".playground-table, .table-wrap",
    ],
  },
  quality: {
    title: "Data Quality",
    selectors: [
      "#quality-view",
      ".quality-summary-grid, .data-quality-summary",
      ".quality-table, .table-wrap",
    ],
  },
  admin: {
    title: "Admin",
    selectors: [
      "#admin-view",
      '[data-admin-action="adminRefreshDashboardSnapshot"]',
      "[data-admin-recon-detail]",
      '[data-action="admin-audit-log"]',
    ],
  },
  "admin-data": {
    title: "Admin Data",
    selectors: [
      "#admin-data-view",
      ".admin-data-workspace",
      "[data-admin-data-entity]",
      "#admin-data-search-input",
      ".admin-data-api-note, #admin-data-table",
    ],
  },
};

const TAB_READY_SELECTORS = {
  weekly: [".weekly-report-page", "#weekly-priority-table", "#weekly-maturity-chart"],
  home: ["#home-rent-chart", "#home-expiry-chart", ".portfolio-asset-grid, .portfolio-location-grid"],
  asset: [".asset-kpi-strip", "#asset-roster-table", ".stack-grid"],
  company: [".company-kpi-strip", ".company-assets-table, .table-wrap-company-financials, #company-financials"],
  sector: ["#sector-view", "#sector-rent-chart, .table-wrap"],
  tools: ["#tools-view", "#tools-benchmark-chart, .table-wrap"],
  playground: ["#playground-view", ".playground-control-grid, .playground-controls, .table-wrap"],
  quality: ["#quality-view", ".quality-summary-grid, .data-quality-summary, .table-wrap"],
  admin: ['[data-admin-action="adminRefreshDashboardSnapshot"]', "[data-admin-recon-detail]", ".supabase-settings-form"],
  "admin-data": [".admin-data-workspace", ".admin-data-api-note", "#admin-data-table"],
};

const TAB_MIN_TEXT = {
  weekly: 600,
  home: 600,
  asset: 600,
  company: 600,
  sector: 300,
  tools: 300,
  playground: 300,
  quality: 600,
  admin: 600,
  "admin-data": 180,
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeFilename(value) {
  return String(value).replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function filterConsoleErrors(items) {
  return items.filter((text) => !FILTERED_ERROR_PATTERNS.some((pattern) => pattern.test(text)));
}

async function findAppFrame(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const count = await frame.locator("#app-shell, #admin-auth-password, #admin-password-input").count().catch(() => 0);
      if (count > 0) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("dashboard app frame not found");
}

async function loginAdmin(frame) {
  const standaloneInput = frame.locator("#admin-auth-password");
  const inlineInput = frame.locator("#admin-password-input");
  const hasStandaloneGate = (await standaloneInput.count().catch(() => 0)) > 0;
  const passwordInput = hasStandaloneGate ? standaloneInput : inlineInput;
  const submitButton = hasStandaloneGate ? frame.locator("#admin-auth-submit") : frame.locator("#admin-password-submit");
  if ((await passwordInput.count().catch(() => 0)) === 0) return false;
  if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD env is required for admin IOTA live check.");
  await passwordInput.fill(ADMIN_PASSWORD);
  await submitButton.click();
  await frame.waitForFunction(() => {
    const flags = window.APP_FLAGS || {};
    const shell = document.querySelector("#app-shell");
    return !!flags.adminSessionToken && shell && !shell.classList.contains("is-auth-locked");
  }, null, { timeout: 90000 });
  return true;
}

async function switchTheme(frame, theme) {
  await frame.waitForSelector(`[data-theme-choice="${theme}"]`, { state: "attached", timeout: 15000 });
  await frame.evaluate((targetTheme) => {
    const button = document.querySelector(`[data-theme-choice="${targetTheme}"]`);
    if (!button) throw new Error(`theme button not found: ${targetTheme}`);
    button.click();
  }, theme);
  await frame.waitForFunction((expectedTheme) => {
    const body = document.getElementById("app-body") || document.body;
    const root = document.documentElement;
    return body?.dataset?.themeResolved === expectedTheme ||
      body?.classList?.contains(`theme-${expectedTheme}`) ||
      root?.dataset?.theme === expectedTheme ||
      root?.classList?.contains(`theme-${expectedTheme}`);
  }, theme, { timeout: 15000 });
}

async function switchTab(frame, tab) {
  await frame.evaluate((target) => {
    if (window.dashboardApp && typeof window.dashboardApp.switchTab === "function") {
      window.dashboardApp.switchTab(target);
      return;
    }
    document.querySelector(`[data-tab="${target}"]`)?.click();
  }, tab);
  await waitForTabReady(frame, tab);
}

async function waitForTabReady(frame, tab) {
  await frame.waitForFunction(({ target, readySelectors, minText }) => {
    const overlay = document.getElementById("loading-overlay");
    const overlayVisible = overlay && overlay.classList.contains("is-visible");
    const panel = document.querySelector(`.tab-panel[data-panel="${target}"]`);
    const root = document.getElementById(`${target}-view`);
    const text = root ? root.innerText.trim() : "";
    const state = window.dashboardApp && window.dashboardApp.getState && window.dashboardApp.getState();
    const hasReadyNode = (readySelectors || []).some((selector) => {
      try {
        return !!root?.querySelector(selector);
      } catch (_error) {
        return false;
      }
    });
    const stillPreparing = /화면을 준비하고 있습니다|로딩 중|Loading/i.test(text);
    return !overlayVisible &&
      panel &&
      panel.classList.contains("is-active") &&
      state &&
      state.activeTab === target &&
      root &&
      !stillPreparing &&
      (hasReadyNode || text.length >= minText);
  }, {
    target: tab,
    readySelectors: TAB_READY_SELECTORS[tab] || [],
    minText: TAB_MIN_TEXT[tab] || 300,
  }, { timeout: 90000 });
}

async function collectTabDom(frame, tab) {
  const config = TAB_EXPECTATIONS[tab];
  return frame.evaluate((expected) => {
    const bodyText = document.body.innerText || "";
    const selectorResults = expected.selectors.map((selector) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const visible = nodes.filter((node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      }).length;
      return { selector, count: nodes.length, visible };
    });
    const activeTab = document.querySelector(".tab-panel.is-active")?.getAttribute("data-panel") || "";
    const root = document.getElementById(`${expected.tab}-view`);
    return {
      activeTab,
      pageTitle: document.getElementById("page-title")?.textContent?.trim() || "",
      roleChip: document.getElementById("role-chip")?.textContent?.trim() || "",
      rootTextLength: root ? root.innerText.trim().length : 0,
      iotaWorkspaceLayoutCount: root ? root.querySelectorAll(".iota-workspace-layout").length : 0,
      projectRailCount: root ? root.querySelectorAll(".project-rail").length : 0,
      iotaSectionCardCount: root ? root.querySelectorAll(".iota-section-card").length : 0,
      hasErrorShell: bodyText.includes("오류가 발생했습니다"),
      selectorResults,
    };
  }, Object.assign({ tab }, config));
}

async function collectCss(frame) {
  return frame.evaluate(() => {
    const rootStyle = window.getComputedStyle(document.documentElement);
    const body = document.getElementById("app-body") || document.body;
    const bodyStyle = window.getComputedStyle(body);
    const shell = document.querySelector(".app-shell");
    const shellStyle = shell ? window.getComputedStyle(shell) : null;
    const firstCell = document.querySelector("td");
    const cellStyle = firstCell ? window.getComputedStyle(firstCell) : null;
    const rootToken = (name) => rootStyle.getPropertyValue(name).trim();
    const bodyToken = (name) => bodyStyle.getPropertyValue(name).trim();
    return {
      themePreference: body.dataset.themePreference || document.documentElement.dataset.themePreference || "",
      themeResolved: body.dataset.themeResolved || document.documentElement.dataset.theme || "",
      colorScheme: rootStyle.colorScheme,
      bodyBackground: bodyStyle.backgroundColor,
      appGridTemplateColumns: shellStyle ? shellStyle.gridTemplateColumns : "",
      tableCellMinHeight: cellStyle ? cellStyle.minHeight : "",
      rootTokens: {
        background: rootToken("--background"),
        surface: rootToken("--surface"),
        panelBg: rootToken("--panel-bg"),
        primary: rootToken("--primary"),
        primaryRgb: rootToken("--primary-rgb"),
        sidebarWidth: rootToken("--sidebar-width"),
        sidebarCollapsed: rootToken("--sidebar-collapsed"),
        topbarHeight: rootToken("--topbar-height"),
        rowHeight: rootToken("--row-height"),
      },
      effectiveTokens: {
        background: bodyToken("--background"),
        surface: bodyToken("--surface"),
        panelBg: bodyToken("--panel-bg"),
        primary: bodyToken("--primary"),
        primaryRgb: bodyToken("--primary-rgb"),
        sidebarWidth: bodyToken("--sidebar-width"),
        sidebarCollapsed: bodyToken("--sidebar-collapsed"),
        topbarHeight: bodyToken("--topbar-height"),
        rowHeight: bodyToken("--row-height"),
      },
    };
  });
}

async function collectSupabaseSource(frame) {
  return frame.evaluate(() => {
    const note = document.querySelector(".admin-data-api-note");
    const railSource = document.querySelector(".admin-data-rail .date-chip")?.textContent?.trim() || "";
    const tableRows = document.querySelectorAll("#admin-data-table tbody tr").length;
    const summaryText = document.querySelector(".admin-data-summary")?.textContent?.replace(/\s+/g, " ").trim() || "";
    const state = window.dashboardApp && window.dashboardApp.getState && window.dashboardApp.getState();
    const editorState = state && state.adminDataEditor ? state.adminDataEditor : {};
    const bodyText = document.body.innerText || "";
    return {
      apiMissing: !!note,
      apiMissingText: note ? note.textContent.trim() : "",
      railSource,
      tableRows,
      summaryText,
      editorError: editorState.error || "",
      summary: editorState.summary || {},
      hasNewButton: !!document.querySelector("[data-admin-data-new]"),
      hasEditButton: !!document.querySelector("[data-admin-data-open]"),
      hasReadonlyChip: !!document.querySelector(".admin-data-readonly-chip"),
      hasSecretText: /SUPABASE_SERVICE_ROLE_KEY|service_role|Bearer\s+/i.test(bodyText),
    };
  });
}

function evaluateTab(role, theme, tab, dom, css, supabase) {
  const failures = [];
  const expected = TAB_EXPECTATIONS[tab] || { selectors: [] };
  if (dom.activeTab !== tab) failures.push(`active tab mismatch: ${dom.activeTab}`);
  if (dom.hasErrorShell) failures.push("error shell is visible");
  if (dom.rootTextLength < 20) failures.push("tab root has no meaningful text");
  if (tab !== "admin-data") {
    if (dom.iotaWorkspaceLayoutCount < 1) failures.push("missing .iota-workspace-layout");
    if (dom.projectRailCount < 1) failures.push("missing .project-rail");
    if (dom.iotaSectionCardCount < 1) failures.push("missing .iota-section-card");
  }
  dom.selectorResults
    .filter((item) => item.count === 0 || item.visible === 0)
    .forEach((item) => failures.push(`missing or hidden selector: ${item.selector}`));

  const tokens = css.effectiveTokens || css.rootTokens || {};
  if (css.themeResolved !== theme) failures.push(`theme mismatch: ${css.themeResolved}`);
  if (tokens.sidebarWidth !== "273px") failures.push(`IOTA sidebar width mismatch: ${tokens.sidebarWidth}`);
  if (tokens.rowHeight !== "34px") failures.push(`IOTA row height mismatch: ${tokens.rowHeight}`);
  if (!tokens.primary) failures.push("primary token is empty");
  if (!tokens.background) failures.push("background token is empty");
  if (theme === "dark") {
    if (tokens.primary.toLowerCase() !== "#d7de4a") failures.push(`IOTA dark primary token mismatch: ${tokens.primary}`);
    if (tokens.background.toLowerCase() !== "#1f1f1e") failures.push(`IOTA dark background token mismatch: ${tokens.background}`);
  }

  if (tab === "admin-data") {
    if (role !== "admin") failures.push("admin-data tab should only be checked in admin role");
    if (!supabase) failures.push("supabase source info was not collected");
    if (supabase && supabase.apiMissing) {
      failures.push(`Supabase Admin Data is still blocked: ${supabase.apiMissingText || "apiMissing"}`);
      if (supabase.hasNewButton) failures.push("Admin Data blocked state still exposes new-row button");
      if (supabase.hasEditButton) failures.push("Admin Data blocked state still exposes edit button");
    } else {
      if (supabase && !/^Supabase\s+/i.test(supabase.railSource)) failures.push(`Supabase source label mismatch: ${supabase.railSource}`);
      if (supabase && supabase.tableRows < 1) failures.push("Supabase admin-data table has no rows");
    }
    if (supabase && supabase.hasSecretText) failures.push("Supabase secret-like text is visible");
  }

  return {
    ok: failures.length === 0,
    failures,
    expectedSelectors: expected.selectors,
  };
}

async function runRoleTheme(browser, role, theme, results) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message || String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  try {
    const startedAt = Date.now();
    await page.goto(role === "admin" ? ADMIN_URL : USER_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    const frame = await findAppFrame(page);
    const auth = { hadPasswordGate: false };
    if (role === "admin") auth.hadPasswordGate = await loginAdmin(frame);
    await switchTheme(frame, theme);

    const tabs = ACTIVE_TABS.length
      ? ROLE_TABS[role].filter((tab) => ACTIVE_TABS.includes(tab))
      : ROLE_TABS[role];
    for (const tab of tabs) {
      const tabStartedAt = Date.now();
      const screenshotPath = path.join(OUT_DIR, `${safeFilename(`${role}-${theme}-${tab}`)}.png`);
      try {
        await switchTab(frame, tab);
        const dom = await collectTabDom(frame, tab);
        const css = await collectCss(frame);
        const supabase = tab === "admin-data" ? await collectSupabaseSource(frame) : null;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        const evaluation = evaluateTab(role, theme, tab, dom, css, supabase);
        const record = {
          role,
          theme,
          tab,
          durationMs: Date.now() - tabStartedAt,
          screenshot: screenshotPath,
          dom,
          css,
          supabase,
          evaluation,
        };
        results.checks.push(record);
        if (!evaluation.ok) {
          evaluation.failures.forEach((failure) => results.failures.push(`${role}/${theme}/${tab}: ${failure}`));
        }
      } catch (error) {
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        const message = error && error.message ? error.message : String(error);
        results.checks.push({
          role,
          theme,
          tab,
          durationMs: Date.now() - tabStartedAt,
          screenshot: fs.existsSync(screenshotPath) ? screenshotPath : "",
          evaluation: { ok: false, failures: [message] },
        });
        results.failures.push(`${role}/${theme}/${tab}: ${message}`);
      }
    }

    results.roleThemeRuns.push({
      role,
      theme,
      elapsedMs: Date.now() - startedAt,
      auth,
      consoleErrors: filterConsoleErrors(consoleErrors),
    });
    filterConsoleErrors(consoleErrors).forEach((error) => results.failures.push(`${role}/${theme}: console error: ${error}`));
  } catch (error) {
    const screenshotPath = path.join(OUT_DIR, `${safeFilename(`${role}-${theme}-fatal`)}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const message = error && error.message ? error.message : String(error);
    results.roleThemeRuns.push({
      role,
      theme,
      elapsedMs: 0,
      auth: { hadPasswordGate: false },
      consoleErrors: filterConsoleErrors(consoleErrors),
      fatalError: message,
      screenshot: fs.existsSync(screenshotPath) ? screenshotPath : "",
    });
    results.failures.push(`${role}/${theme}: ${message}`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  ensureDir(OUT_DIR);
  const results = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    userUrl: USER_URL,
    adminUrl: ADMIN_URL,
    headless: HEADLESS,
    outputDir: OUT_DIR,
    checks: [],
    roleThemeRuns: [],
    failures: [],
    summary: {},
  };

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: getExecutablePath(),
  });

  try {
    for (const role of ACTIVE_ROLES) {
      for (const theme of ACTIVE_THEMES) {
        await runRoleTheme(browser, role, theme, results);
      }
    }
  } finally {
    await browser.close();
  }

  results.summary = {
    totalChecks: results.checks.length,
    screenshotCount: results.checks.filter((item) => item.screenshot).length,
    failureCount: results.failures.length,
    consoleErrorCount: results.roleThemeRuns.reduce((sum, item) => sum + item.consoleErrors.length, 0),
    supabaseChecks: results.checks.filter((item) => item.tab === "admin-data").length,
  };

  const reportPath = path.join(OUT_DIR, "summary.json");
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), "utf8");
  console.log(JSON.stringify({ outputDir: OUT_DIR, summary: results.summary, failures: results.failures }, null, 2));
  if (results.failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
