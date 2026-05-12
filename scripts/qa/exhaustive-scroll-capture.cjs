const {
  buildDashboardPageUrl,
  chromium,
  getExecutablePath,
  resolveDashboardBaseUrl,
  withChromiumLaunchOptions,
} = require("./playwright-runtime.cjs");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  REQUIRED_PAYLOAD_SOURCE,
  UI_SECRET_PATTERN,
  USER_EDIT_PATTERN,
  buildSourceGateFailures,
  collectSourceGateSnapshot,
  isIgnorableConsole,
  isIgnorableRequestProblem,
  scanArtifactDirectoryForSecrets,
  sourceMatchesRequired,
} = require("./dashboard-qa-gates.cjs");

const BASE_URL = resolveDashboardBaseUrl();
const USER_URL = process.env.USER_URL || buildDashboardPageUrl("user", BASE_URL);
const ADMIN_URL = process.env.ADMIN_URL || buildDashboardPageUrl("admin", BASE_URL);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || path.join("qa-artifacts", "exhaustive-scroll", RUN_STAMP));
const HEADLESS = !/^false$/i.test(process.env.DASHBOARD_HEADLESS || "true");
const VIEWPORT = {
  width: Number(process.env.QA_VIEWPORT_WIDTH || 1440),
  height: Number(process.env.QA_VIEWPORT_HEIGHT || 980),
};
const MAX_SCROLL_SHOTS = Math.max(4, Number(process.env.QA_MAX_SCROLL_SHOTS || 18));
const THEMES = parseCsvEnv("QA_THEMES", ["dark", "light"]);
const ROLE_TABS = {
  user: ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality"],
  admin: ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality", "admin", "admin-data"],
};
const ACTIVE_ROLES = parseCsvEnv("QA_ROLES", ["user", "admin"]).filter((role) => ROLE_TABS[role]);
const SOURCE_GATE_ROLES = parseCsvEnv("QA_SOURCE_GATE_ROLES", ["user", "admin"]).filter((role) => ROLE_TABS[role]);
const SOURCE_GATE_TABS = parseCsvEnv("QA_SOURCE_GATE_TABS", ROLE_TABS.user);
const REFERENCE_LOCAL_PATH = process.env.IOTA_REFERENCE_FILE || "C:\\tmp\\IGIS_RA_Report_auto_ref\\docs\\iota-development-workspace.html";
const REFERENCE_URL = process.env.IOTA_REFERENCE_URL || (
  fs.existsSync(REFERENCE_LOCAL_PATH)
    ? pathToFileURL(REFERENCE_LOCAL_PATH).toString()
    : "https://kylee94.github.io/IGIS_RA_Report_auto/iota-development-workspace.html#lfc"
);
const CURRENT_URL = process.env.IOTA_CURRENT_URL || process.env.CURRENT_URL || USER_URL;
const CAPTURE_REFERENCE = !/^false$/i.test(process.env.QA_CAPTURE_REFERENCE || "true");
const CAPTURE_CURRENT = !/^false$/i.test(process.env.QA_CAPTURE_CURRENT || "true");
const ICON_TOKENS = [
  "left_panel_close",
  "article",
  "dashboard",
  "domain",
  "corporate_fare",
  "analytics",
  "query_stats",
  "database",
  "rule_settings",
  "auto_awesome",
  "dock_to_right",
];

function parseCsvEnv(name, fallback) {
  const raw = process.env[name] || "";
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? values : fallback;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeFile(value) {
  return String(value || "capture")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function consoleEntry(message) {
  const location = typeof message.location === "function" ? message.location() : {};
  return {
    type: typeof message.type === "function" ? message.type() : "",
    text: typeof message.text === "function" ? message.text() : String(message || ""),
    url: location.url || "",
    lineNumber: location.lineNumber || 0,
    columnNumber: location.columnNumber || 0,
  };
}

async function findAppFrame(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const count = await frame.locator("#app-shell, #admin-auth-root, #admin-auth-password, #admin-password-input").count().catch(() => 0);
      if (count > 0) return frame;
    }
    await page.waitForTimeout(400);
  }
  throw new Error("dashboard app frame not found");
}

async function loginAdmin(frame) {
  const standaloneInput = frame.locator("#admin-auth-password");
  const inlineInput = frame.locator("#admin-password-input");
  const passwordInput = (await standaloneInput.count().catch(() => 0)) > 0 ? standaloneInput : inlineInput;
  const submitButton = (await standaloneInput.count().catch(() => 0)) > 0
    ? frame.locator("#admin-auth-submit")
    : frame.locator("#admin-password-submit");
  if ((await passwordInput.count().catch(() => 0)) === 0) return false;
  if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is required for admin exhaustive capture.");
  await passwordInput.fill(ADMIN_PASSWORD);
  await submitButton.click();
  await frame.waitForFunction(() => {
    const flags = window.APP_FLAGS || {};
    const shell = document.getElementById("app-shell");
    return !!flags.adminSessionToken && shell && !shell.classList.contains("is-auth-locked");
  }, null, { timeout: 90000 });
  return true;
}

async function switchTheme(frame, theme) {
  await frame.evaluate((target) => {
    const button = document.querySelector(`[data-theme-choice="${target}"]`);
    if (button) button.click();
  }, theme);
  await frame.waitForTimeout(400);
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

async function waitForTabReady(frame, tab) {
  await frame.waitForFunction((target) => {
    const state = window.dashboardApp?.getState?.() || {};
    const root = document.getElementById(`${target}-view`);
    const overlay = document.getElementById("loading-overlay");
    const overlayVisible = overlay && overlay.classList.contains("is-visible");
    if (!root || state.activeTab !== target || overlayVisible) return false;
    const text = root.innerText.trim();
    const status = root.dataset.renderStatus || "";
    const isPlaceholder = /화면을 준비하고 있습니다|기준 정보와 선택값을 먼저 맞춘 뒤/.test(text);
    if (status === "skeleton" || status === "rendering" || status === "selection-shell" || isPlaceholder) return false;
    const minimumTextLength = {
      weekly: 1200,
      home: 1000,
      asset: 1000,
      company: 1000,
      sector: 1200,
      tools: 1200,
      playground: 1000,
      quality: 500,
      admin: 1000,
      "admin-data": 450,
    }[target] || 500;
    if (text.length < minimumTextLength) return false;
    if (target === "admin-data") return !!root.querySelector(".admin-data-workspace, .admin-data-api-note, #admin-data-table");
    if (target === "admin") return !!root.querySelector(".admin-supabase-panel, [data-admin-action]");
    return !!root.querySelector(".iota-workspace-layout, .state-shell");
  }, tab, { timeout: tab === "admin" || tab === "admin-data" ? 120000 : 90000 });
  await frame.waitForTimeout(700);
}

async function resetScroll(frame) {
  await frame.evaluate(() => {
    const target = document.getElementById("canvas") || document.scrollingElement || document.documentElement || document.body;
    if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
      window.scrollTo(0, 0);
    } else {
      target.scrollTop = 0;
    }
  });
  await frame.waitForTimeout(120);
}

async function getScrollPositions(frame) {
  const info = await frame.evaluate(() => {
    const el = document.getElementById("canvas") || document.scrollingElement || document.documentElement || document.body;
    return {
      scrollHeight: Math.max(el.scrollHeight || 0, document.body.scrollHeight || 0),
      viewportHeight: el.clientHeight || window.innerHeight || document.documentElement.clientHeight || 900,
      target: el.id || el.tagName || "",
    };
  });
  const maxY = Math.max(0, info.scrollHeight - info.viewportHeight);
  const step = Math.max(360, Math.floor(info.viewportHeight * 0.78));
  const positions = [0];
  for (let y = step; y < maxY; y += step) positions.push(y);
  if (maxY > 0) positions.push(maxY);
  const unique = Array.from(new Set(positions.map((value) => Math.max(0, Math.round(value)))));
  if (unique.length <= MAX_SCROLL_SHOTS) return { positions: unique, scrollHeight: info.scrollHeight, viewportHeight: info.viewportHeight, capped: false };
  const sampled = [];
  for (let index = 0; index < MAX_SCROLL_SHOTS; index += 1) {
    const value = Math.round((maxY * index) / (MAX_SCROLL_SHOTS - 1));
    sampled.push(value);
  }
  return { positions: Array.from(new Set(sampled)), scrollHeight: info.scrollHeight, viewportHeight: info.viewportHeight, capped: true };
}

async function scrollTo(frame, y) {
  await frame.evaluate((targetY) => {
    const target = document.getElementById("canvas") || document.scrollingElement || document.documentElement || document.body;
    if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
      window.scrollTo(0, targetY);
    } else {
      target.scrollTop = targetY;
    }
  }, y);
  await frame.waitForFunction((targetY) => {
    const el = document.getElementById("canvas") || document.scrollingElement || document.documentElement || document.body;
    return Math.abs((el.scrollTop || 0) - targetY) < 12 || targetY <= 0;
  }, y, { timeout: 2000 }).catch(() => {});
  await frame.waitForTimeout(160);
}

async function auditFrame(frame, role, tab) {
  return frame.evaluate(({ roleName, tabName, secretPatternSource, editPatternSource, iconTokens }) => {
    const secretRegex = new RegExp(secretPatternSource, "i");
    const editRegex = new RegExp(editPatternSource, "i");
    const root = document.getElementById(`${tabName}-view`);
    const bodyText = document.body.innerText || "";
    const state = window.dashboardApp?.getState?.() || {};
    const runtime =
      (typeof RUNTIME_CLIENT_CONFIG !== "undefined" && RUNTIME_CLIENT_CONFIG) ||
      window.RUNTIME_CLIENT_CONFIG ||
      {};
    const readSource = (payload) => {
      if (!payload || typeof payload !== "object") return "";
      const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
      return (
        payload.payloadSource ||
        payload.dataSource ||
        payload.source ||
        meta.payloadSource ||
        meta.dataSource ||
        meta.source ||
        ""
      );
    };
    const payload =
      state.lastSuccessfulPayloads?.[tabName] ||
      state.pageCache?.[tabName] ||
      state.pageCache?.[`page:${tabName}:default`] ||
      state.pageCache?.[`page:${tabName}`] ||
      (state.activeTab === tabName ? state.activePayload : null);
    const doc = document.getElementById("canvas") || document.scrollingElement || document.documentElement || document.body;
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const isLightRgb = (value) => {
      const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!match) return false;
      return Number(match[1]) > 238 && Number(match[2]) > 238 && Number(match[3]) > 238;
    };
    const overflowNodes = Array.from(document.querySelectorAll("button, .nav-item, .rail-btn, .primary-button, .secondary-button, .table-button, .meta-chip, .status-chip, .badge, .control-input, select"))
      .filter(isVisible)
      .filter((el) => el.scrollWidth > el.clientWidth + 8 || el.scrollHeight > el.clientHeight + 10)
      .filter((el) => !el.closest("td, th, .table-wrap, .table-wrap-report"))
      .slice(0, 40)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          className: String(el.className || "").slice(0, 120),
          text: (el.innerText || el.value || "").trim().slice(0, 90),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
        };
      });
    const lightSurfaces = Array.from(document.querySelectorAll("body *"))
      .filter(isVisible)
      .filter((el) => {
        if (el.closest("svg, canvas")) return false;
        if (el.closest(".naver-dynamic-map-node, .portfolio-map-status")) return false;
        if (el.matches(".meta-chip, .date-chip, .iota-source-chip, .status-chip, .badge")) return false;
        const tag = el.tagName.toLowerCase();
        if (tag === "path" || tag === "use") return false;
        const rect = el.getBoundingClientRect();
        if (rect.width * rect.height < 5200) return false;
        return isLightRgb(window.getComputedStyle(el).backgroundColor);
      })
      .slice(0, 25)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        className: String(el.className || "").slice(0, 120),
        text: (el.innerText || "").trim().slice(0, 80),
      }));
    const legacyNodes = Array.from(document.querySelectorAll(".workspace-panel, .metric-tile"))
      .filter(isVisible)
      .map((el) => ({
        className: String(el.className || "").slice(0, 120),
        text: (el.innerText || "").trim().slice(0, 80),
      }));
    const materialFontIssues = Array.from(document.querySelectorAll(".material-symbols-outlined"))
      .filter(isVisible)
      .filter((el) => !/Material Symbols Outlined/i.test(window.getComputedStyle(el).fontFamily || ""))
      .slice(0, 20)
      .map((el) => (el.innerText || "").trim());
    return {
      role: roleName,
      tab: tabName,
      activeTab: state.activeTab || "",
      renderStatus: root?.dataset?.renderStatus || "",
      rootTextLength: root ? root.innerText.trim().length : 0,
      hasLoadingPlaceholder: root ? /화면을 준비하고 있습니다|기준 정보와 선택값을 먼저 맞춘 뒤/.test(root.innerText || "") : false,
      scrollWidth: doc.scrollWidth,
      viewportWidth: doc.clientWidth || window.innerWidth,
      horizontalOverflow: doc.scrollWidth > (doc.clientWidth || window.innerWidth) + 8,
      bodyHasSecret: secretRegex.test(bodyText),
      userHasAdminNav: roleName === "user" && !!document.querySelector('[data-tab="admin"], [data-tab="admin-data"]'),
      userHasAdminAction: roleName === "user" && !!document.querySelector('[data-admin-action], [data-admin-data-entity], [data-admin-data-new], [data-admin-data-open]'),
      userHasEditText: roleName === "user" && editRegex.test(bodyText),
      overflowNodes,
      lightSurfaces,
      legacyNodes,
      materialFontIssues,
      iconTokenTextInBody: iconTokens.filter((token) => bodyText.includes(token)),
      iotaLayoutCount: root ? root.querySelectorAll(".iota-workspace-layout").length : 0,
      railCount: root ? root.querySelectorAll(".project-rail .rail-btn, .admin-data-rail .rail-btn, .advanced-rail .rail-btn").length : 0,
      sourceChip: root?.querySelector(".iota-source-chip")?.innerText?.trim() || "",
      payloadSource: readSource(payload),
      hasPayload: !!payload,
      runtimeConfig: {
        dataSourceMode: runtime.dataSourceMode || "",
        supabaseConfigured: runtime.supabaseConfigured === true,
        supabaseUrlConfigured: runtime.supabaseUrlConfigured === true,
        supabaseServiceRoleKeyConfigured: runtime.supabaseServiceRoleKeyConfigured === true,
      },
      adminDataState: tabName === "admin-data" ? {
        hasWorkspace: !!document.querySelector(".admin-data-workspace"),
        hasApiNote: !!document.querySelector(".admin-data-api-note"),
        apiNoteText: document.querySelector(".admin-data-api-note")?.textContent?.replace(/\s+/g, " ").trim() || "",
        rowCount: document.querySelectorAll("#admin-data-table tbody tr").length,
        sourceLabel: document.querySelector(".admin-data-rail .date-chip")?.textContent?.trim() || "",
        hasNewButton: !!document.querySelector("[data-admin-data-new]"),
        hasEditButton: !!document.querySelector("[data-admin-data-open]"),
        hasReadonlyChip: !!document.querySelector(".admin-data-readonly-chip"),
        hasSecretText: secretRegex.test(bodyText),
      } : null,
    };
  }, {
    roleName: role,
    tabName: tab,
    secretPatternSource: UI_SECRET_PATTERN.source,
    editPatternSource: USER_EDIT_PATTERN.source,
    iconTokens: ICON_TOKENS,
  });
}

async function captureTabScroll(page, frame, role, theme, tab) {
  await resetScroll(frame);
  const scroll = await getScrollPositions(frame);
  const screenshots = [];
  for (let index = 0; index < scroll.positions.length; index += 1) {
    const y = scroll.positions[index];
    await scrollTo(frame, y);
    const filename = `${safeFile(role)}-${safeFile(theme)}-${safeFile(tab)}-${String(index + 1).padStart(2, "0")}-y${y}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, filename), fullPage: false });
    screenshots.push(filename);
  }
  await resetScroll(frame);
  const fullName = `${safeFile(role)}-${safeFile(theme)}-${safeFile(tab)}-fullpage.png`;
  await page.screenshot({ path: path.join(OUT_DIR, fullName), fullPage: true });
  const audit = await auditFrame(frame, role, tab);
  return Object.assign({}, audit, {
    theme,
    scroll,
    screenshots,
    fullPageScreenshot: fullName,
  });
}

async function closeSurface(frame) {
  await frame.evaluate(() => {
    if (window.dashboardApp?.closeSurface) window.dashboardApp.closeSurface();
  }).catch(() => {});
  await frame.waitForTimeout(250);
}

async function captureSurface(page, frame, name, openFn) {
  await closeSurface(frame);
  const result = { name, screenshots: [], ok: false, error: "", audit: null };
  try {
    await openFn();
    await frame.waitForFunction(() => {
      const modal = document.querySelector('#modal-host[aria-hidden="false"] .surface-frame, #detail-panel-host[aria-hidden="false"] .surface-frame, .surface-layer.is-open .surface-frame');
      return !!modal;
    }, null, { timeout: 10000 });
    const info = await frame.evaluate(() => {
      const surface = document.querySelector('#modal-host[aria-hidden="false"] .surface-frame, #detail-panel-host[aria-hidden="false"] .surface-frame, .surface-layer.is-open .surface-frame');
      const body = surface?.querySelector(".surface-frame-body") || surface;
      return {
        scrollHeight: body ? body.scrollHeight : 0,
        clientHeight: body ? body.clientHeight : 0,
      };
    });
    result.audit = await frame.evaluate((secretPatternSource) => {
      const secretRegex = new RegExp(secretPatternSource, "i");
      const surface = document.querySelector('#modal-host[aria-hidden="false"] .surface-frame, #detail-panel-host[aria-hidden="false"] .surface-frame, .surface-layer.is-open .surface-frame');
      const body = surface?.querySelector(".surface-frame-body") || surface;
      const text = body?.innerText || "";
      const rect = body?.getBoundingClientRect?.() || { width: 0, height: 0 };
      return {
        title: surface?.querySelector(".surface-title")?.textContent?.trim() || "",
        textLength: text.trim().length,
        hasLoadingPlaceholder: /화면을 준비하고 있습니다|기준 정보와 선택값을 먼저 맞춘 뒤|Loading/i.test(text),
        hasSecretText: secretRegex.test(text),
        horizontalOverflow: body ? body.scrollWidth > body.clientWidth + 8 : false,
        width: Math.round(rect.width || 0),
        height: Math.round(rect.height || 0),
      };
    }, UI_SECRET_PATTERN.source);
    const positions = [0];
    const maxY = Math.max(0, info.scrollHeight - info.clientHeight);
    if (maxY > 0) positions.push(maxY);
    for (let index = 0; index < positions.length; index += 1) {
      const y = positions[index];
      await frame.evaluate((targetY) => {
        const surface = document.querySelector('#modal-host[aria-hidden="false"] .surface-frame, #detail-panel-host[aria-hidden="false"] .surface-frame, .surface-layer.is-open .surface-frame');
        const body = surface?.querySelector(".surface-frame-body") || surface;
        if (body) body.scrollTop = targetY;
      }, y);
      await frame.waitForTimeout(160);
      const filename = `surface-${safeFile(name)}-${String(index + 1).padStart(2, "0")}-y${y}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, filename), fullPage: false });
      result.screenshots.push(filename);
    }
    result.ok = true;
  } catch (error) {
    result.error = error && error.message ? error.message : String(error);
  } finally {
    await closeSurface(frame);
  }
  return result;
}

async function captureUserSurfaces(page, frame) {
  const surfaces = [];
  await switchTheme(frame, "dark");
  await switchTab(frame, "weekly");
  surfaces.push(await captureSurface(page, frame, "weekly-summary-assets", async () => {
    await frame.locator('[data-action="weekly-summary-assets"]').first().click();
  }));
  await switchTab(frame, "home");
  surfaces.push(await captureSurface(page, frame, "home-expiry-detail", async () => {
    await frame.locator('[data-action="home-expiry-detail"]').first().click();
  }));
  await switchTab(frame, "asset");
  surfaces.push(await captureSurface(page, frame, "asset-detail", async () => {
    const trigger = frame.locator('#asset-view [data-action="asset-panel"]:visible, #asset-view [data-asset]:visible').first();
    await trigger.click();
  }));
  surfaces.push(await captureSurface(page, frame, "support", async () => {
    await frame.evaluate(() => window.dashboardApp?.openSupport?.());
  }));
  return surfaces;
}

async function runRole(browser, role) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const consoleMessages = [];
  const pageErrors = [];
  const requestFailures = [];
  const httpProblems = [];
  page.on("console", (message) => consoleMessages.push(consoleEntry(message)));
  page.on("pageerror", (error) => pageErrors.push(error && error.message ? error.message : String(error)));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      httpProblems.push({ status: response.status(), url: response.url() });
    }
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText || "",
    });
  });
  await page.goto(role === "admin" ? ADMIN_URL : USER_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  const frame = await findAppFrame(page);
  const gateScreenshot = role === "admin" ? "admin-auth-gate-before-login.png" : "";
  let adminGate = null;
  if (role === "admin") {
    await page.screenshot({ path: path.join(OUT_DIR, gateScreenshot), fullPage: false });
    adminGate = await frame.evaluate((secretPatternSource) => {
      const text = document.body.innerText || "";
      return {
        hasPasswordInput: !!document.querySelector("#admin-auth-password, #admin-password-input"),
        hasStandaloneGate: !!document.querySelector("#admin-auth-root"),
        hasAppShell: !!document.querySelector("#app-shell"),
        hasUnlockedButtons: !!document.querySelector('[data-admin-action], [data-admin-data-entity]'),
        hasSecret: new RegExp(secretPatternSource, "i").test(text),
      };
    }, UI_SECRET_PATTERN.source);
    await loginAdmin(frame);
  }
  await frame.waitForFunction(() => !!window.dashboardApp?.getState, null, { timeout: 90000 });
  const tabs = ROLE_TABS[role];
  const captures = [];
  for (const theme of THEMES) {
    await switchTheme(frame, theme);
    for (const tab of tabs) {
      await switchTab(frame, tab);
      captures.push(await captureTabScroll(page, frame, role, theme, tab));
    }
  }
  const surfaces = role === "user" ? await captureUserSurfaces(page, frame) : [];
  const sourceGateTabs = SOURCE_GATE_TABS.filter((tab) => ROLE_TABS[role].includes(tab) && tab !== "admin" && tab !== "admin-data");
  const sourceGateSnapshot = SOURCE_GATE_ROLES.includes(role) && sourceGateTabs.length
    ? await collectSourceGateSnapshot(frame, sourceGateTabs)
    : null;
  await page.close();
  const filteredConsoleErrors = consoleMessages
    .filter((entry) => entry.type === "error" && !isIgnorableConsole(entry))
    .map((entry) => entry.text);
  const ignoredConsole = consoleMessages.filter(isIgnorableConsole);
  return {
    role,
    url: role === "admin" ? ADMIN_URL : USER_URL,
    gateScreenshot,
    adminGate,
    captures,
    surfaces,
    sourceGateTabs,
    sourceGateSnapshot,
    consoleMessages,
    filteredConsoleErrors,
    ignoredConsole,
    pageErrors,
    requestFailures,
    httpProblems,
  };
}

async function captureStandaloneTarget(browser, target) {
  if (!target || !target.url) return { name: target?.name || "unknown", status: "skipped", reason: "url missing" };
  const page = await browser.newPage({ viewport: VIEWPORT });
  const consoleMessages = [];
  const pageErrors = [];
  const requestFailures = [];
  const httpProblems = [];
  page.on("console", (message) => consoleMessages.push(consoleEntry(message)));
  page.on("pageerror", (error) => pageErrors.push(error && error.message ? error.message : String(error)));
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
  const startedAt = Date.now();
  const filename = `${safeFile(target.name)}-capture-fullpage.png`;
  try {
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT_DIR, filename), fullPage: true });
    const state = await page.evaluate(() => {
      const bodyStyle = window.getComputedStyle(document.body);
      return {
        title: document.title,
        url: location.href,
        textLength: document.body ? document.body.innerText.trim().length : 0,
        bodyBackground: bodyStyle.backgroundColor,
        iotaLayoutCount: document.querySelectorAll(".iota-workspace-layout").length,
        legacyPanelCount: document.querySelectorAll(".workspace-panel, .metric-tile").length,
      };
    });
    await page.close();
    return {
      name: target.name,
      url: target.url,
      status: "ok",
      durationMs: Date.now() - startedAt,
      screenshot: filename,
      state,
      filteredConsoleErrors: consoleMessages.filter((entry) => entry.type === "error" && !isIgnorableConsole(entry)).map((entry) => entry.text),
      pageErrors,
      requestFailures,
      httpProblems,
    };
  } catch (error) {
    await page.screenshot({ path: path.join(OUT_DIR, filename), fullPage: true }).catch(() => {});
    await page.close().catch(() => {});
    return {
      name: target.name,
      url: target.url,
      status: "error",
      durationMs: Date.now() - startedAt,
      screenshot: fs.existsSync(path.join(OUT_DIR, filename)) ? filename : "",
      error: error && error.message ? error.message : String(error),
      filteredConsoleErrors: consoleMessages.filter((entry) => entry.type === "error" && !isIgnorableConsole(entry)).map((entry) => entry.text),
      pageErrors,
      requestFailures,
      httpProblems,
    };
  }
}

function buildFailures(results) {
  const failures = [];
  for (const result of results) {
    result.filteredConsoleErrors.forEach((text) => failures.push({ role: result.role, type: "console-error", text }));
    result.pageErrors.forEach((text) => failures.push({ role: result.role, type: "page-error", text }));
    result.requestFailures
      .filter((item) => !isIgnorableRequestProblem(item))
      .forEach((item) => failures.push({ role: result.role, type: "request-failure", item }));
    result.httpProblems
      .filter((item) => !isIgnorableRequestProblem(item))
      .forEach((item) => failures.push({ role: result.role, type: "http-problem", item }));
    if (result.sourceGateSnapshot) {
      buildSourceGateFailures(result.sourceGateSnapshot, {
        scope: `${result.role}:source-gate`,
        tabs: result.sourceGateTabs,
      }).forEach((failure) => failures.push(failure));
    }
    if (result.adminGate) {
      if (!result.adminGate.hasPasswordInput) failures.push({ role: result.role, type: "admin-gate-password-missing" });
      if (result.adminGate.hasUnlockedButtons) failures.push({ role: result.role, type: "admin-gate-buttons-visible" });
      if (result.adminGate.hasSecret) failures.push({ role: result.role, type: "admin-gate-secret-visible" });
    }
    for (const capture of result.captures) {
      const where = { role: result.role, theme: capture.theme, tab: capture.tab };
      if (capture.activeTab !== capture.tab) failures.push(Object.assign({ type: "active-tab-mismatch", activeTab: capture.activeTab }, where));
      if (capture.renderStatus === "skeleton" || capture.renderStatus === "rendering" || capture.renderStatus === "selection-shell") failures.push(Object.assign({ type: "tab-still-loading", renderStatus: capture.renderStatus, rootTextLength: capture.rootTextLength }, where));
      if (capture.hasLoadingPlaceholder) failures.push(Object.assign({ type: "loading-placeholder-visible", rootTextLength: capture.rootTextLength }, where));
      if (capture.horizontalOverflow) failures.push(Object.assign({ type: "horizontal-overflow", scrollWidth: capture.scrollWidth, viewportWidth: capture.viewportWidth }, where));
      if (capture.bodyHasSecret) failures.push(Object.assign({ type: "secret-visible" }, where));
      if (capture.userHasAdminNav) failures.push(Object.assign({ type: "user-admin-nav-visible" }, where));
      if (capture.userHasAdminAction) failures.push(Object.assign({ type: "user-admin-action-visible" }, where));
      if (capture.userHasEditText) failures.push(Object.assign({ type: "user-edit-text-visible" }, where));
      if (capture.materialFontIssues.length) failures.push(Object.assign({ type: "material-font-missing", materialFontIssues: capture.materialFontIssues }, where));
      if (capture.legacyNodes.length) failures.push(Object.assign({ type: "legacy-workspace-nodes", count: capture.legacyNodes.length, sample: capture.legacyNodes.slice(0, 4) }, where));
      if (capture.lightSurfaces.length) failures.push(Object.assign({ type: "light-surface-visible", count: capture.lightSurfaces.length, sample: capture.lightSurfaces.slice(0, 4) }, where));
      if (capture.overflowNodes.length) failures.push(Object.assign({ type: "text-overflow", count: capture.overflowNodes.length, sample: capture.overflowNodes.slice(0, 6) }, where));
      if (!capture.iotaLayoutCount && capture.tab !== "admin") failures.push(Object.assign({ type: "missing-iota-layout" }, where));
      if (SOURCE_GATE_ROLES.includes(capture.role) && SOURCE_GATE_TABS.includes(capture.tab) && capture.tab !== "admin" && capture.tab !== "admin-data") {
        if (!sourceMatchesRequired(capture.sourceChip, REQUIRED_PAYLOAD_SOURCE)) failures.push(Object.assign({ type: "source-chip", expected: REQUIRED_PAYLOAD_SOURCE, actual: capture.sourceChip }, where));
        if (!sourceMatchesRequired(capture.payloadSource, REQUIRED_PAYLOAD_SOURCE)) failures.push(Object.assign({ type: "payload-source", expected: REQUIRED_PAYLOAD_SOURCE, actual: capture.payloadSource, hasPayload: capture.hasPayload }, where));
      }
    }
    for (const surface of result.surfaces || []) {
      if (!surface.ok) failures.push({ role: result.role, type: "surface-open-failed", name: surface.name, error: surface.error });
      if (surface.audit?.hasSecretText) failures.push({ role: result.role, type: "surface-secret-visible", name: surface.name });
      if (surface.audit?.hasLoadingPlaceholder) failures.push({ role: result.role, type: "surface-loading-placeholder", name: surface.name });
      if (surface.audit?.horizontalOverflow) failures.push({ role: result.role, type: "surface-horizontal-overflow", name: surface.name });
    }
  }
  return failures;
}

(async () => {
  ensureDir(OUT_DIR);
  const browser = await chromium.launch(withChromiumLaunchOptions({ headless: HEADLESS }));
  const results = [];
  const comparison = {
    reference: CAPTURE_REFERENCE ? await captureStandaloneTarget(browser, { name: "reference", url: REFERENCE_URL }) : { name: "reference", status: "skipped", reason: "QA_CAPTURE_REFERENCE=false" },
    current: CAPTURE_CURRENT ? await captureStandaloneTarget(browser, { name: "current", url: CURRENT_URL }) : { name: "current", status: "skipped", reason: "QA_CAPTURE_CURRENT=false" },
  };
  try {
    for (const role of ACTIVE_ROLES) {
      results.push(await runRole(browser, role));
    }
  } finally {
    await browser.close();
  }
  let failures = buildFailures(results);
  if (comparison.reference.status !== "ok") failures.push({ type: "reference-capture-failed", target: comparison.reference });
  if (comparison.current.status !== "ok") failures.push({ type: "current-capture-failed", target: comparison.current });
  for (const target of [comparison.reference, comparison.current]) {
    (target.filteredConsoleErrors || []).forEach((text) => failures.push({ type: `${target.name}-console-error`, text }));
    (target.pageErrors || []).forEach((text) => failures.push({ type: `${target.name}-page-error`, text }));
    (target.requestFailures || []).filter((item) => !isIgnorableRequestProblem(item)).forEach((item) => failures.push({ type: `${target.name}-request-failure`, item }));
    (target.httpProblems || []).filter((item) => !isIgnorableRequestProblem(item)).forEach((item) => failures.push({ type: `${target.name}-http-problem`, item }));
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    outDir: OUT_DIR,
    baseUrl: BASE_URL,
    viewport: VIEWPORT,
    themes: THEMES,
    roles: ACTIVE_ROLES,
    sourceGate: {
      requiredSource: REQUIRED_PAYLOAD_SOURCE,
      roles: SOURCE_GATE_ROLES,
      tabs: SOURCE_GATE_TABS,
    },
    comparison,
    captureMatrix: {
      reference: comparison.reference.status === "ok" ? [comparison.reference.screenshot] : [],
      current: comparison.current.status === "ok" ? [comparison.current.screenshot] : [],
      live: results.flatMap((role) => role.captures.map((capture) => ({
        role: capture.role,
        theme: capture.theme,
        tab: capture.tab,
        screenshots: capture.screenshots,
        fullPageScreenshot: capture.fullPageScreenshot,
      }))),
      surfaces: results.flatMap((role) => (role.surfaces || []).map((surface) => ({
        role: role.role,
        name: surface.name,
        screenshots: surface.screenshots,
        ok: surface.ok,
      }))),
    },
    screenshotCount: results.reduce((sum, role) => sum + role.captures.reduce((inner, capture) => inner + capture.screenshots.length + 1, 0) + (role.adminGate ? 1 : 0) + (role.surfaces || []).reduce((inner, surface) => inner + surface.screenshots.length, 0), 0)
      + (comparison.reference.status === "ok" ? 1 : 0)
      + (comparison.current.status === "ok" ? 1 : 0),
    failureCount: failures.length,
    failures,
    results,
  };
  await fs.promises.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  const secretFindings = scanArtifactDirectoryForSecrets(OUT_DIR);
  if (secretFindings.length) {
    secretFindings.forEach((finding) => failures.push({ type: "artifact-secret", finding }));
    summary.secretScan = { findingCount: secretFindings.length, findings: secretFindings };
    summary.failureCount = failures.length;
    summary.failures = failures;
    await fs.promises.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  } else {
    summary.secretScan = { findingCount: 0, findings: [] };
    await fs.promises.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  }
  console.log(JSON.stringify({
    outDir: OUT_DIR,
    screenshotCount: summary.screenshotCount,
    failureCount: summary.failureCount,
    failures: failures.slice(0, 20),
  }, null, 2));
  if (failures.length) process.exit(1);
})().catch((error) => {
  ensureDir(OUT_DIR);
  const payload = {
    generatedAt: new Date().toISOString(),
    outDir: OUT_DIR,
    fatal: error && error.stack ? error.stack : String(error),
  };
  fs.writeFileSync(path.join(OUT_DIR, "fatal.json"), JSON.stringify(payload, null, 2), "utf8");
  console.error(payload.fatal);
  process.exit(1);
});
