const fs = require("fs");
const path = require("path");
const {
  chromium,
  isDashboardServerRequestUrl,
  withChromiumLaunchOptions,
} = require("./playwright-runtime.cjs");
const {
  REQUIRED_PAYLOAD_SOURCE,
  UI_SECRET_PATTERN,
  USER_EDIT_PATTERN,
  buildSourceGateFailures,
  collectSourceGateSnapshot,
  scanArtifactDirectoryForSecrets,
} = require("./dashboard-qa-gates.cjs");

const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || path.join("qa-artifacts", "github-pages-static", RUN_STAMP));
const HEADLESS = !/^false$/i.test(process.env.DASHBOARD_HEADLESS || "true");
const VIEWPORT = {
  width: Number(process.env.QA_VIEWPORT_WIDTH || 1440),
  height: Number(process.env.QA_VIEWPORT_HEIGHT || 980),
};
const SHELL_READY_MAX_MS = Number(process.env.QA_STATIC_SHELL_READY_MAX_MS || 3000);
const SHELL_FIND_MAX_MS = Number(process.env.QA_STATIC_SHELL_FIND_MAX_MS || Math.max(SHELL_READY_MAX_MS, 5000));
const SHELL_WAIT_MAX_MS = Number(process.env.QA_STATIC_SHELL_WAIT_MAX_MS || Math.max(SHELL_READY_MAX_MS, 10000));
const TAB_READY_MAX_MS = Number(process.env.QA_STATIC_TAB_READY_MAX_MS || 15000);
const MAX_SCROLL_SHOTS = Math.max(4, Number(process.env.QA_MAX_SCROLL_SHOTS || 18));
const MAX_YELLOW_AREA_RATIO = Number(process.env.QA_STATIC_MAX_YELLOW_AREA_RATIO || 0.045);
const MAX_YELLOW_NODE_COUNT = Number(process.env.QA_STATIC_MAX_YELLOW_NODE_COUNT || 16);
const DEFAULT_STATIC_BASE_URL = "https://kylee94.github.io/logi_leasing_db/";
const STATIC_BASE_URL =
  process.env.STATIC_BASE_URL ||
  process.env.GITHUB_PAGES_URL ||
  process.env.GITHUB_PAGES_BASE_URL ||
  process.env.DASHBOARD_STATIC_URL ||
  DEFAULT_STATIC_BASE_URL;
const USER_URL = process.env.STATIC_USER_URL || buildPageUrl("user", STATIC_BASE_URL);
const ADMIN_URL = process.env.STATIC_ADMIN_URL || buildPageUrl("admin", STATIC_BASE_URL);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const CHECKS = parseCsvEnv("QA_STATIC_CHECKS", ["capture", "source", "exposure", "admin-preauth", "runtime"]);
const THEMES = parseCsvEnv("QA_THEMES", ["dark", "light"]);
const ACTIVE_ROLES = parseCsvEnv("QA_ROLES", ["user", "admin"]).filter((role) => role === "user" || role === "admin");
const SOURCE_GATE_ROLES = parseCsvEnv("QA_SOURCE_GATE_ROLES", ["user", "admin"]).filter((role) => role === "user" || role === "admin");
const SOURCE_GATE_TABS = parseCsvEnv("QA_SOURCE_GATE_TABS", ["weekly", "home", "asset", "company", "sector", "tools", "playground"]);
const CAPTURE_LOCKED_ADMIN = !/^false$/i.test(process.env.QA_CAPTURE_LOCKED_ADMIN || "true");
const ROLE_TABS = {
  user: ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality"],
  admin: ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality", "admin", "admin-data"],
};
const APP_READY_SELECTOR = "#app-shell, #app, #admin-auth-root, #admin-auth-password, #admin-password-input, #admin-password";
const ADMIN_PASSWORD_SELECTOR = "#admin-auth-password, #admin-password-input, #admin-password";
const ADMIN_SUBMIT_SELECTOR = "#admin-auth-submit, #admin-password-submit, #admin-auth-form button[type=\"submit\"], button[type=\"submit\"]";
const LEGACY_WEEKLY_ORDER_SELECTORS = parseCsvEnv("QA_LEGACY_WEEKLY_ORDER_SELECTORS", [
  ".summary-strip, .weekly-kpi-strip, [data-action^=\"weekly-summary-\"]",
  ".weekly-priority-panel, #weekly-priority-table",
  ".weekly-maturity-panel, #weekly-maturity-chart",
  ".weekly-main-table-panel, #weekly-assets-table",
  ".weekly-issue-grid",
  "#weekly-new-project-detail",
  "#weekly-management-project-detail",
]);
const WEEKLY_ORDER_TITLES = parseCsvEnv("QA_WEEKLY_ORDER_TITLES", [
  "신규 투자 Projects",
  "관리 Projects",
  "자산현황",
  "기준 및 기타사항",
]);

function parseCsvEnv(name, fallback) {
  const raw = process.env[name] || "";
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? values : fallback;
}

function hasCheck(name) {
  return CHECKS.includes("all") || CHECKS.includes(name);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildPageUrl(mode, baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set("page", mode);
  return url.toString();
}

function safeFile(value) {
  return String(value || "capture")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function errorText(error) {
  return error && error.message ? error.message : String(error);
}

function classifyEntryStatus(status, url) {
  if (status == null) {
    return {
      type: "pages-entry-no-response",
      message: `GitHub Pages entry did not return a navigation response: ${url}`,
    };
  }
  if (status === 404) {
    return {
      type: "pages-entry-404",
      message: `GitHub Pages entry returned 404. Verify Pages is enabled for main /docs and docs/index.html is committed and pushed: ${url}`,
    };
  }
  if (status >= 400) {
    return {
      type: "pages-entry-http-error",
      message: `GitHub Pages entry returned HTTP ${status}: ${url}`,
    };
  }
  return null;
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

function requestProblemEntry(request) {
  return {
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
    failure: request.failure()?.errorText || "",
  };
}

function classifyStaticServerRequest(request) {
  const url = request.url();
  const method = request.method();
  const resourceType = request.resourceType();
  if (isDashboardServerRequestUrl(url, method)) return "apps-script-callback";
  try {
    const parsed = new URL(url);
    const base = new URL(STATIC_BASE_URL);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    const sameStaticOrigin = parsed.origin === base.origin;
    if (/(^|\.)supabase\.co$/.test(host)) return "supabase";
    if (host === "raw.githubusercontent.com") return "raw-github";
    if (sameStaticOrigin && pathname.startsWith(basePath.toLowerCase()) && /\/data\/.*\.json$/i.test(pathname)) {
      return "static-data-json";
    }
    if ((resourceType === "fetch" || resourceType === "xhr") && !/\.(css|js|png|jpe?g|webp|svg|ico|woff2?)$/i.test(pathname)) {
      return "fetch-xhr";
    }
  } catch (_error) {
    if (/\/callback|\/data\/.*\.json/i.test(String(url || ""))) return "unknown-data-or-callback";
  }
  return "";
}

function createStaticServerRecorder(page) {
  const events = [];
  const push = (phase, request, extra = {}) => {
    const method = request.method();
    const url = request.url();
    const serverKind = classifyStaticServerRequest(request);
    if (!serverKind) return;
    events.push(Object.assign({
      phase,
      at: new Date().toISOString(),
      method,
      url,
      serverKind,
      resourceType: request.resourceType(),
    }, extra));
  };
  page.on("request", (request) => push("request", request));
  page.on("requestfinished", async (request) => {
    let status = null;
    try {
      const response = await request.response();
      status = response ? response.status() : null;
    } catch (_error) {
      status = null;
    }
    push("finished", request, { status });
  });
  page.on("requestfailed", (request) => push("failed", request, { failure: request.failure()?.errorText || "" }));
  return {
    events,
    mark(label) {
      return { label, startIndex: events.length };
    },
    summarize(mark) {
      const subset = events.slice(mark.startIndex);
      return {
        requestCount: subset.filter((item) => item.phase === "request").length,
        failureCount: subset.filter((item) => item.phase === "failed").length,
        events: subset,
      };
    },
  };
}

async function findAppContext(page) {
  const deadline = Date.now() + SHELL_FIND_MAX_MS;
  while (Date.now() < deadline) {
    if ((await page.locator(APP_READY_SELECTOR).count().catch(() => 0)) > 0) {
      return page;
    }
    for (const frame of page.frames()) {
      if ((await frame.locator(APP_READY_SELECTOR).count().catch(() => 0)) > 0) {
        return frame;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error("GitHub Pages dashboard shell not found");
}

async function waitForShellReady(context) {
  await context.waitForFunction(() => {
    const shell = document.querySelector("#app-shell, #app");
    const gate = document.querySelector("#admin-auth-root, #admin-auth-password, #admin-password-input, #admin-password");
    if (gate) return true;
    if (!shell) return false;
    const overlay = document.getElementById("loading-overlay");
    const overlayVisible = overlay && overlay.classList.contains("is-visible");
    return !overlayVisible && !!(window.dashboardApp?.getState || document.querySelector(".tab-panel.is-active"));
  }, null, { timeout: SHELL_WAIT_MAX_MS });
}

async function installGoogleScriptRunMonitor(context) {
  await context.evaluate(() => {
    window.__staticQaGoogleScriptRunCalls = window.__staticQaGoogleScriptRunCalls || [];
    if (window.__staticQaGoogleScriptRunInstalled) return;
    window.__staticQaGoogleScriptRunInstalled = true;
    const makeChain = (pathParts) => new Proxy(function qaGoogleScriptRunChain() {}, {
      get(_target, prop) {
        if (prop === "then") return undefined;
        return makeChain(pathParts.concat(String(prop)));
      },
      apply(_target, _thisArg, args) {
        window.__staticQaGoogleScriptRunCalls.push({
          path: pathParts.join("."),
          argCount: args.length,
          at: Date.now(),
        });
        return makeChain(pathParts);
      },
    });
    try {
      if (window.google && window.google.script && window.google.script.run) {
        window.google.script.run = new Proxy(window.google.script.run, {
          get(target, prop) {
            const value = target[prop];
            if (typeof value === "function") {
              return function monitoredGoogleScriptRun(...args) {
                window.__staticQaGoogleScriptRunCalls.push({
                  path: String(prop),
                  argCount: args.length,
                  at: Date.now(),
                });
                return value.apply(this, args);
              };
            }
            return value == null ? makeChain([String(prop)]) : value;
          },
        });
      }
    } catch (_error) {
      // Some browsers mark the Apps Script object as non-configurable. Network gates still catch callbacks.
    }
  });
}

async function getGoogleScriptRunCallCount(context) {
  return context.evaluate(() => Array.isArray(window.__staticQaGoogleScriptRunCalls) ? window.__staticQaGoogleScriptRunCalls.length : 0)
    .catch(() => 0);
}

async function switchTheme(context, theme) {
  await context.evaluate((target) => {
    if (window.dashboardApp?.setThemePreference) {
      window.dashboardApp.setThemePreference(target);
      return;
    }
    const button = document.querySelector(`[data-theme-choice="${target}"]`);
    if (button) {
      button.click();
      return;
    }
    const body = document.getElementById("app-body") || document.body;
    localStorage.setItem("dashboard.themePreference", target);
    sessionStorage.setItem("logi-iota-theme", target);
    body.dataset.themeResolved = target;
    body.dataset.theme = target;
    document.documentElement.dataset.theme = target;
  }, theme);
  await context.waitForFunction((target) => {
    const body = document.getElementById("app-body") || document.body;
    return body?.dataset?.themeResolved === target ||
      body?.dataset?.theme === target ||
      body?.classList?.contains(`theme-${target}`) ||
      document.documentElement.dataset.theme === target ||
      document.documentElement.classList.contains(`theme-${target}`);
  }, theme, { timeout: 15000 }).catch(() => {});
}

async function switchTab(context, tab) {
  await context.waitForFunction(() => !!window.dashboardApp?.getState || !!document.querySelector("[data-tab]"), null, { timeout: 90000 });
  await context.evaluate((target) => {
    if (window.dashboardApp?.switchTab) {
      window.dashboardApp.switchTab(target);
      return;
    }
    document.querySelector(`[data-tab="${target}"]`)?.click();
  }, tab);
  await waitForTabReady(context, tab);
}

async function waitForTabReady(context, tab) {
  await context.waitForFunction((target) => {
    const root = document.getElementById(`${target}-view`) || document.querySelector(`.tab-panel[data-panel="${target}"]`);
    const panel = document.querySelector(`.tab-panel[data-panel="${target}"]`);
    const state = window.dashboardApp?.getState?.() || {};
    const activeTab = state.activeTab || document.querySelector(".tab-panel.is-active")?.getAttribute("data-panel") || "";
    const overlay = document.getElementById("loading-overlay");
    const overlayVisible = overlay && overlay.classList.contains("is-visible");
    if (!root || activeTab !== target || overlayVisible) return false;
    const text = root.innerText.trim();
    const status = root.dataset.renderStatus || "";
    if (panel && !panel.classList.contains("is-active")) return false;
    if (status === "skeleton" || status === "rendering" || status === "selection-shell") return false;
    if (/화면을 준비하고 있습니다|기준 정보와 선택값을 먼저 맞춘 뒤|Loading|로딩 중/i.test(text)) return false;
    if ((target === "admin" || target === "admin-data") && root.querySelector("#admin-auth-form, #admin-password")) {
      return text.length >= 50;
    }
    const hasStaticLayout = !!root.querySelector(".panel-card, .summary-strip, .table-wrap, .info-card");
    if (hasStaticLayout && text.length >= 80) return true;
    const minimumTextLength = {
      weekly: 800,
      home: 700,
      asset: 700,
      company: 700,
      sector: 300,
      tools: 300,
      playground: 300,
      quality: 400,
      admin: 500,
      "admin-data": 250,
    }[target] || 300;
    if (text.length < minimumTextLength) return false;
    if (target === "admin-data") return !!root.querySelector(".admin-data-workspace, .admin-data-api-note, #admin-data-table, .table-wrap table");
    if (target === "admin") return !!root.querySelector(".admin-supabase-panel, [data-admin-action], .admin-password-gate");
    return !!root.querySelector(".iota-workspace-layout, .state-shell, .weekly-report-page, .panel-card, .summary-strip, .table-wrap, .info-card");
  }, tab, { timeout: tab === "admin" || tab === "admin-data" ? Math.max(TAB_READY_MAX_MS, 30000) : TAB_READY_MAX_MS });
}

async function loginAdminIfPossible(context, failures) {
  const hasPasswordInput = (await context.locator(ADMIN_PASSWORD_SELECTOR).count().catch(() => 0)) > 0;
  if (!hasPasswordInput) return false;
  if (!ADMIN_PASSWORD) {
    return false;
  }
  const passwordInput = context.locator(ADMIN_PASSWORD_SELECTOR).first();
  await passwordInput.fill(ADMIN_PASSWORD);
  if ((await context.locator(ADMIN_SUBMIT_SELECTOR).count().catch(() => 0)) > 0) {
    await context.locator(ADMIN_SUBMIT_SELECTOR).first().click();
  } else {
    await passwordInput.press("Enter");
  }
  const unlocked = await context.waitForFunction(() => {
    const shell = document.querySelector("#app-shell, #app");
    const visibleGate = Array.from(document.querySelectorAll("#admin-auth-root, #admin-auth-password, #admin-password-input, #admin-password"))
      .some((node) => {
        const element = node instanceof HTMLElement ? node : node.closest?.("*");
        if (!element) return false;
        if (element.closest("[hidden]")) return false;
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
      });
    return shell && !shell.classList.contains("is-auth-locked") && !visibleGate;
  }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  if (!unlocked) {
    failures.push({
      scope: "admin",
      type: "admin-backend-auth-not-connected",
      message: "Admin gate remained locked after password submit; static shell must not treat a local password as verified without backend auth.",
    });
  }
  return unlocked;
}

async function resetScroll(context) {
  await context.evaluate(() => {
    const target = document.getElementById("canvas") || document.scrollingElement || document.documentElement || document.body;
    if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
      window.scrollTo(0, 0);
    } else {
      target.scrollTop = 0;
    }
  });
  await context.waitForTimeout(120);
}

async function getScrollPositions(context) {
  const info = await context.evaluate(() => {
    const el = document.getElementById("canvas") || document.scrollingElement || document.documentElement || document.body;
    return {
      scrollHeight: Math.max(el.scrollHeight || 0, document.body.scrollHeight || 0),
      viewportHeight: el.clientHeight || window.innerHeight || document.documentElement.clientHeight || 900,
    };
  });
  const maxY = Math.max(0, info.scrollHeight - info.viewportHeight);
  const step = Math.max(360, Math.floor(info.viewportHeight * 0.78));
  const positions = [0];
  for (let y = step; y < maxY; y += step) positions.push(y);
  if (maxY > 0) positions.push(maxY);
  const unique = Array.from(new Set(positions.map((value) => Math.max(0, Math.round(value)))));
  if (unique.length <= MAX_SCROLL_SHOTS) {
    return { positions: unique, scrollHeight: info.scrollHeight, viewportHeight: info.viewportHeight, capped: false };
  }
  const sampled = [];
  for (let index = 0; index < MAX_SCROLL_SHOTS; index += 1) {
    sampled.push(Math.round((maxY * index) / (MAX_SCROLL_SHOTS - 1)));
  }
  return { positions: Array.from(new Set(sampled)), scrollHeight: info.scrollHeight, viewportHeight: info.viewportHeight, capped: true };
}

async function scrollTo(context, y) {
  await context.evaluate((targetY) => {
    const target = document.getElementById("canvas") || document.scrollingElement || document.documentElement || document.body;
    if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
      window.scrollTo(0, targetY);
    } else {
      target.scrollTop = targetY;
    }
  }, y);
  await context.waitForTimeout(160);
}

async function captureTabScroll(page, context, role, theme, tab) {
  await resetScroll(context);
  const scroll = await getScrollPositions(context);
  const screenshots = [];
  for (let index = 0; index < scroll.positions.length; index += 1) {
    const y = scroll.positions[index];
    await scrollTo(context, y);
    const filename = `${safeFile(role)}-${safeFile(theme)}-${safeFile(tab)}-${String(index + 1).padStart(2, "0")}-y${y}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, filename), fullPage: false });
    screenshots.push(filename);
  }
  await resetScroll(context);
  const fullPageScreenshot = `${safeFile(role)}-${safeFile(theme)}-${safeFile(tab)}-fullpage.png`;
  await page.screenshot({ path: path.join(OUT_DIR, fullPageScreenshot), fullPage: true });
  const audit = await auditTab(context, role, tab);
  return Object.assign({}, audit, { theme, scroll, screenshots, fullPageScreenshot });
}

async function auditTab(context, role, tab) {
  return context.evaluate(({ roleName, tabName, secretPatternSource, editPatternSource, legacyWeeklyOrderSelectors, weeklyOrderTitles, maxYellowAreaRatio, maxYellowNodeCount }) => {
    const secretRegex = new RegExp(secretPatternSource, "i");
    const editRegex = new RegExp(editPatternSource, "i");
    const root = document.getElementById(`${tabName}-view`) || document.querySelector(`.tab-panel[data-panel="${tabName}"]`);
    const bodyText = document.body.innerText || "";
    const doc = document.getElementById("canvas") || document.scrollingElement || document.documentElement || document.body;
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const sampleNode = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        className: String(el.className || "").slice(0, 140),
        text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 100),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };
    const nodes = Array.from(document.querySelectorAll("body *")).filter(isVisible);
    const classText = (el) => String(el.className || "");
    const gradientNodes = nodes
      .filter((el) => /gradient/i.test(classText(el)) || /gradient/i.test(window.getComputedStyle(el).backgroundImage || ""))
      .filter((el) => !el.closest("svg, canvas"))
      .slice(0, 25)
      .map(sampleNode);
    const blurNodes = nodes
      .filter((el) => /blur/i.test(classText(el)) || /blur\(/i.test(`${window.getComputedStyle(el).filter || ""} ${window.getComputedStyle(el).backdropFilter || ""}`))
      .filter((el) => !el.closest("svg, canvas"))
      .slice(0, 25)
      .map(sampleNode);
    const glowNodes = nodes
      .filter((el) => {
        const style = window.getComputedStyle(el);
        const shadow = style.boxShadow || "";
        return /glow/i.test(classText(el)) || (/rgba?\(/i.test(shadow) && /(0px\s+0px|0\s+0|24px|28px|32px|36px|40px)/i.test(shadow));
      })
      .filter((el) => !el.closest("svg, canvas"))
      .slice(0, 25)
      .map(sampleNode);
    const legacyCardNodes = Array.from(document.querySelectorAll(".workspace-panel, .metric-tile, .hero-panel, .hero-card, .glass-card, .dashboard-card, .legacy-card, .section-card:not(.iota-section-card), [class*=\"legacy\"]"))
      .filter(isVisible)
      .slice(0, 30)
      .map(sampleNode);
    const rgbToHsl = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h = 0;
      let s = 0;
      const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
          default: h = 0;
        }
        h /= 6;
      }
      return { h: h * 360, s, l };
    };
    const parseRgb = (value) => {
      const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?/i);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] == null ? 1 : Number(match[4]) };
    };
    const isFluorescentYellow = (value) => {
      const rgb = parseRgb(value);
      if (!rgb || rgb.a < 0.25) return false;
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      return hsl.h >= 45 && hsl.h <= 82 && hsl.s >= 0.5 && hsl.l >= 0.42 && rgb.r >= 180 && rgb.g >= 170;
    };
    const viewportArea = Math.max(1, (doc.clientWidth || window.innerWidth || 1) * (doc.clientHeight || window.innerHeight || 1));
    let yellowArea = 0;
    const yellowNodes = [];
    for (const el of nodes) {
      if (el.closest("svg, canvas")) continue;
      const style = window.getComputedStyle(el);
      if (!isFluorescentYellow(style.backgroundColor)) continue;
      const rect = el.getBoundingClientRect();
      const area = Math.max(0, Math.min(rect.width, window.innerWidth || rect.width) * Math.min(rect.height, window.innerHeight || rect.height));
      if (area < 80) continue;
      yellowArea += area;
      if (yellowNodes.length < 25) yellowNodes.push(sampleNode(el));
    }
    const buildOrderResult = (items) => {
      const missing = items.filter((item) => !item.found);
      const visible = items.filter((item) => item.found);
      const outOfOrder = [];
      for (let i = 1; i < visible.length; i += 1) {
        if (visible[i].top < visible[i - 1].top - 8) {
          outOfOrder.push({ before: visible[i - 1], after: visible[i] });
        }
      }
      return { items, missing, outOfOrder, ok: missing.length === 0 && outOfOrder.length === 0 };
    };
    const weeklyOrder = (() => {
      if (tabName !== "weekly" || !root) return null;
      const legacySelectorItems = legacyWeeklyOrderSelectors.map((selector, index) => {
        let node = null;
        try {
          node = root.querySelector(selector);
        } catch (_error) {
          node = null;
        }
        if (!node || !isVisible(node)) return { index, selector, found: false, top: null, text: "" };
        const rect = node.getBoundingClientRect();
        return { index, selector, found: true, top: Math.round(rect.top + (window.scrollY || doc.scrollTop || 0)), text: (node.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) };
      });
      const legacySelectorCheck = buildOrderResult(legacySelectorItems);
      const titleItems = weeklyOrderTitles.map((title, index) => {
        const normalizedTitle = String(title || "").trim();
        const headings = Array.from(root.querySelectorAll(".section-title, h2, h3, h4"));
        const heading = headings.find((node) => (node.textContent || "").trim() === normalizedTitle);
        const node = heading ? (heading.closest("section, article, .panel-card, .iota-section-card") || heading) : null;
        if (!node || !isVisible(node)) {
          return { index, title: normalizedTitle, found: false, top: null, text: "" };
        }
        const rect = node.getBoundingClientRect();
        return { index, title: normalizedTitle, found: true, top: Math.round(rect.top + (window.scrollY || doc.scrollTop || 0)), text: (node.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) };
      });
      const titleCheck = buildOrderResult(titleItems);
      return {
        mode: "title",
        legacySelectorCheck,
        titleCheck,
        ok: titleCheck.ok,
      };
    })();
    return {
      role: roleName,
      tab: tabName,
      activeTab: window.dashboardApp?.getState?.()?.activeTab || document.querySelector(".tab-panel.is-active")?.getAttribute("data-panel") || "",
      renderStatus: root?.dataset?.renderStatus || "",
      rootTextLength: root ? root.innerText.trim().length : 0,
      hasLoadingPlaceholder: root ? /화면을 준비하고 있습니다|기준 정보와 선택값을 먼저 맞춘 뒤|Loading|로딩 중/i.test(root.innerText || "") : false,
      scrollWidth: doc.scrollWidth,
      viewportWidth: doc.clientWidth || window.innerWidth,
      horizontalOverflow: doc.scrollWidth > (doc.clientWidth || window.innerWidth) + 8,
      bodyHasSecret: secretRegex.test(bodyText),
      userHasAdminNav: roleName === "user" && !!document.querySelector('[data-tab="admin"], [data-tab="admin-data"]'),
      userHasAdminAction: roleName === "user" && !!document.querySelector('[data-admin-action], [data-admin-data-entity], [data-admin-data-new], [data-admin-data-open]'),
      userHasEditText: roleName === "user" && editRegex.test(bodyText),
      iotaLayoutCount: root ? root.querySelectorAll(".iota-workspace-layout").length : 0,
      staticPanelCount: root ? root.querySelectorAll(".panel-card, .summary-strip, .table-wrap, .info-card").length : 0,
      sectionCount: root ? root.querySelectorAll(".iota-section-card").length : 0,
      hasAdminAuthForm: root ? !!root.querySelector("#admin-auth-form, #admin-password") : false,
      adminDataState: tabName === "admin-data" ? {
        hasWorkspace: !!document.querySelector(".admin-data-workspace"),
        hasApiNote: !!document.querySelector(".admin-data-api-note"),
        rowCount: document.querySelectorAll("#admin-data-table tbody tr, .tab-panel[data-panel=\"admin-data\"] .table-wrap tbody tr").length,
        hasStaticTable: !!root?.querySelector(".table-wrap table"),
        hasNewButton: !!document.querySelector("[data-admin-data-new]"),
        hasEditButton: !!document.querySelector("[data-admin-data-open]"),
        hasSecretText: secretRegex.test(bodyText),
      } : null,
      visualResidue: {
        gradientNodes,
        blurNodes,
        glowNodes,
        legacyCardNodes,
        yellowAreaRatio: Number((yellowArea / viewportArea).toFixed(4)),
        yellowAreaLimit: maxYellowAreaRatio,
        yellowNodeCount: yellowNodes.length,
        yellowNodeLimit: maxYellowNodeCount,
        yellowNodes,
      },
      weeklyOrder,
    };
  }, {
    roleName: role,
    tabName: tab,
    secretPatternSource: UI_SECRET_PATTERN.source,
    editPatternSource: USER_EDIT_PATTERN.source,
    legacyWeeklyOrderSelectors: LEGACY_WEEKLY_ORDER_SELECTORS,
    weeklyOrderTitles: WEEKLY_ORDER_TITLES,
    maxYellowAreaRatio: MAX_YELLOW_AREA_RATIO,
    maxYellowNodeCount: MAX_YELLOW_NODE_COUNT,
  });
}

async function collectAdminPreAuthState(context) {
  return context.evaluate((secretPatternSource) => {
    const secretRegex = new RegExp(secretPatternSource, "i");
    const bodyText = document.body.innerText || "";
    const isVisible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const sampleNode = (node) => ({
      tag: node.tagName.toLowerCase(),
      id: node.id || "",
      className: String(node.className || "").slice(0, 120),
      text: (node.innerText || node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
    });
    const adminFeatureSelectors = [
      "[data-admin-action]",
      "[data-action^=\"admin-review:\"]",
      "[data-admin-recon-detail]",
      "[data-admin-data-entity]",
      "[data-admin-data-new]",
      "[data-admin-data-open]",
      ".admin-data-workspace",
      ".admin-supabase-panel",
      "#admin-data-table",
      "#supabase-settings-form",
    ];
    const adminFeatureNodes = Array.from(document.querySelectorAll(adminFeatureSelectors.join(",")));
    const visibleAdminFeatures = adminFeatureNodes.filter(isVisible).slice(0, 20).map(sampleNode);
    const visibleAdminTabs = Array.from(document.querySelectorAll('[data-tab="admin"], [data-tab="admin-data"]'))
      .filter(isVisible)
      .slice(0, 20)
      .map(sampleNode);
    return {
      hasPasswordInput: !!document.querySelector("#admin-auth-password, #admin-password-input, #admin-password"),
      hasStandaloneGate: !!document.querySelector("#admin-auth-root, #admin-auth-form"),
      hasUnlockedAdminButtons: visibleAdminFeatures.length > 0,
      hasAdminDataWorkspace: Array.from(document.querySelectorAll(".admin-data-workspace, #admin-data-table")).some(isVisible),
      hasSecretText: secretRegex.test(bodyText),
      adminFeatureNodeCount: adminFeatureNodes.length,
      visibleAdminFeatureCount: visibleAdminFeatures.length,
      visibleAdminFeatures,
      visibleAdminTabs,
    };
  }, UI_SECRET_PATTERN.source);
}

function addConsoleAndHttpListeners(page, bucket) {
  page.on("console", (message) => bucket.consoleMessages.push(consoleEntry(message)));
  page.on("pageerror", (error) => bucket.pageErrors.push(error && error.message ? error.message : String(error)));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      bucket.httpProblems.push({ status: response.status(), url: response.url() });
    }
  });
  page.on("requestfailed", (request) => bucket.requestFailures.push(requestProblemEntry(request)));
}

async function runRole(browser, role, recorderResults) {
  const captureEnabled = hasCheck("capture");
  const sourceEnabled = hasCheck("source");
  const exposureEnabled = hasCheck("exposure");
  const adminPreAuthEnabled = hasCheck("admin-preauth");
  const needsPostAuthTabs = captureEnabled || exposureEnabled || sourceEnabled;
  const page = await browser.newPage({ viewport: VIEWPORT });
  const bucket = {
    role,
    url: role === "admin" ? ADMIN_URL : USER_URL,
    consoleMessages: [],
    pageErrors: [],
    httpProblems: [],
    requestFailures: [],
    entry: null,
    adminPreAuth: null,
    captures: [],
    sourceGateTabs: [],
    sourceGateSnapshot: null,
    revisit: null,
  };
  addConsoleAndHttpListeners(page, bucket);
  const recorder = createStaticServerRecorder(page);
  const startedAt = Date.now();
  const response = await page.goto(bucket.url, { waitUntil: "domcontentloaded", timeout: 90000 });
  const entryScreenshot = `${role}-direct-url.png`;
  await page.screenshot({ path: path.join(OUT_DIR, entryScreenshot), fullPage: false });
  bucket.entry = {
    shellReadyMs: null,
    screenshot: entryScreenshot,
    finalUrl: page.url(),
    navigationStatus: response ? response.status() : null,
  };
  const entryStatusFailure = classifyEntryStatus(bucket.entry.navigationStatus, bucket.entry.finalUrl);

  let context = null;
  try {
    context = await findAppContext(page);
    await waitForShellReady(context);
    await installGoogleScriptRunMonitor(context);
    bucket.entry.shellReadyMs = Date.now() - startedAt;
  } catch (error) {
    bucket.runtimeFailure = [{
      scope: role,
      type: "dashboard-shell-not-found",
      message: error && error.message ? error.message : String(error),
      finalUrl: bucket.entry.finalUrl,
      navigationStatus: bucket.entry.navigationStatus,
      screenshot: entryScreenshot,
    }];
    if (entryStatusFailure) {
      bucket.runtimeFailure.unshift(Object.assign({
        scope: role,
        finalUrl: bucket.entry.finalUrl,
        navigationStatus: bucket.entry.navigationStatus,
        screenshot: entryScreenshot,
      }, entryStatusFailure));
    }
    recorderResults.push({ role, events: recorder.events });
    await page.close();
    return bucket;
  }

  const runFailures = [];
  if (role === "admin") {
    if (adminPreAuthEnabled || needsPostAuthTabs) {
      bucket.adminPreAuth = await collectAdminPreAuthState(context);
      bucket.adminPreAuth.screenshot = "admin-pre-auth.png";
      await page.screenshot({ path: path.join(OUT_DIR, bucket.adminPreAuth.screenshot), fullPage: false });
    }
    if (adminPreAuthEnabled && !bucket.adminPreAuth?.hasPasswordInput && !bucket.adminPreAuth?.hasStandaloneGate) {
      bucket.runtimeFailure = [{
        scope: "admin",
        type: "admin-auth-gate-missing",
        message: "Admin URL did not show an authentication gate before protected QA.",
        screenshot: bucket.adminPreAuth.screenshot,
      }];
      recorderResults.push({ role, events: recorder.events });
      await page.close();
      return bucket;
    }
    if (!needsPostAuthTabs) {
      recorderResults.push({ role, events: recorder.events });
      await page.close();
      return bucket;
    }
    const loggedIn = await loginAdminIfPossible(context, runFailures);
    const shellUnlocked = await context.evaluate(() => {
      const shell = document.querySelector("#app-shell, #app");
      const hasGate = !!document.querySelector("#admin-auth-root, #admin-auth-password, #admin-password-input, #admin-password");
      return !!shell && !shell.classList.contains("is-auth-locked") && !hasGate;
    }).catch(() => false);
    if (!loggedIn && !shellUnlocked) {
      bucket.runtimeFailure = runFailures;
      bucket.adminLocked = true;
      if (!CAPTURE_LOCKED_ADMIN || !needsPostAuthTabs) {
        recorderResults.push({ role, events: recorder.events });
        await page.close();
        return bucket;
      }
      bucket.entry.postAuthScreenshot = "";
    } else {
      await waitForShellReady(context);
      await installGoogleScriptRunMonitor(context);
      const postAuthScreenshot = "admin-post-auth.png";
      await page.screenshot({ path: path.join(OUT_DIR, postAuthScreenshot), fullPage: false });
      bucket.entry.postAuthScreenshot = postAuthScreenshot;
    }
  }

  const tabs = ROLE_TABS[role] || [];
  const sourceTabs = SOURCE_GATE_TABS.filter((tab) => tabs.includes(tab) && tab !== "admin" && tab !== "admin-data");
  const tabsToVisit = captureEnabled || exposureEnabled ? tabs : sourceTabs;
  for (const theme of THEMES) {
    await switchTheme(context, theme);
    for (const tab of tabsToVisit) {
      try {
        await switchTab(context, tab);
        if (captureEnabled) {
          bucket.captures.push(await captureTabScroll(page, context, role, theme, tab));
        } else if (exposureEnabled) {
          bucket.captures.push(Object.assign(await auditTab(context, role, tab), {
            theme,
            scroll: { positions: [], scrollHeight: 0, viewportHeight: 0, capped: false },
            screenshots: [],
            fullPageScreenshot: "",
          }));
        }
      } catch (error) {
        const failureScreenshot = `${safeFile(role)}-${safeFile(theme)}-${safeFile(tab)}-capture-failed.png`;
        await page.screenshot({ path: path.join(OUT_DIR, failureScreenshot), fullPage: false }).catch(() => {});
        runFailures.push({
          scope: role,
          type: "tab-capture-failed",
          theme,
          tab,
          message: errorText(error),
          screenshot: failureScreenshot,
        });
      }
    }
  }

  if (sourceEnabled && SOURCE_GATE_ROLES.includes(role) && sourceTabs.length) {
    for (const tab of sourceTabs) {
      try {
        await switchTab(context, tab);
      } catch (error) {
        runFailures.push({
          scope: role,
          type: "source-tab-visit-failed",
          tab,
          message: errorText(error),
        });
      }
    }
    bucket.sourceGateTabs = sourceTabs;
    bucket.sourceGateSnapshot = await collectSourceGateSnapshot(context, sourceTabs);
  }

  if (hasCheck("runtime")) {
    const revisitMark = recorder.mark(`${role}:tab-revisit`);
    const googleBefore = await getGoogleScriptRunCallCount(context);
    const revisitTabs = role === "admin"
      ? ["weekly", "home", "asset", "company", "admin", "admin-data", "weekly"]
      : ["weekly", "home", "asset", "company", "weekly", "home"];
    for (const tab of revisitTabs) {
      try {
        await switchTab(context, tab);
      } catch (error) {
        runFailures.push({
          scope: role,
          type: "tab-revisit-failed",
          tab,
          message: errorText(error),
        });
      }
    }
    const googleAfter = await getGoogleScriptRunCallCount(context);
    bucket.revisit = {
      tabs: revisitTabs,
      serverRequests: recorder.summarize(revisitMark),
      googleScriptRunCalls: Math.max(0, googleAfter - googleBefore),
    };
  }
  recorderResults.push({ role, events: recorder.events });
  await page.close();
  runFailures.forEach((failure) => {
    bucket.runtimeFailure = bucket.runtimeFailure || [];
    bucket.runtimeFailure.push(failure);
  });
  return bucket;
}

function buildFailures(results) {
  const failures = [];
  const runtimeEnabled = hasCheck("runtime");
  const captureEnabled = hasCheck("capture");
  const sourceEnabled = hasCheck("source");
  const exposureEnabled = hasCheck("exposure");
  const adminPreAuthEnabled = hasCheck("admin-preauth");
  for (const result of results.roles) {
    const whereRole = { role: result.role };
    if (runtimeEnabled && typeof result.entry.shellReadyMs !== "number") {
      failures.push(Object.assign({ type: "shell-ready-missing", entry: result.entry }, whereRole));
    } else if (runtimeEnabled && result.entry.shellReadyMs > SHELL_READY_MAX_MS) {
      failures.push(Object.assign({ type: "shell-ready-time", durationMs: result.entry.shellReadyMs, maxMs: SHELL_READY_MAX_MS }, whereRole));
    }
    if (runtimeEnabled) {
      result.consoleMessages
        .filter((entry) => entry.type === "error")
        .forEach((entry) => failures.push(Object.assign({ type: "console-error", entry }, whereRole)));
      result.pageErrors.forEach((error) => failures.push(Object.assign({ type: "page-error", error }, whereRole)));
      result.httpProblems
        .forEach((item) => failures.push(Object.assign({ type: "http-problem", item }, whereRole)));
      result.requestFailures
        .forEach((item) => failures.push(Object.assign({ type: "request-failure", item }, whereRole)));
      (result.runtimeFailure || []).forEach((failure) => failures.push(Object.assign({}, failure, whereRole)));
    } else {
      (result.runtimeFailure || [])
        .filter((failure) => !/^tab-|^source-tab-/i.test(failure.type || ""))
        .forEach((failure) => failures.push(Object.assign({}, failure, whereRole)));
    }

    if (adminPreAuthEnabled && result.role === "admin") {
      const gate = result.adminPreAuth || {};
      if (!gate.hasPasswordInput) failures.push({ role: "admin", type: "admin-preauth-password-missing" });
      if (gate.hasUnlockedAdminButtons) failures.push({ role: "admin", type: "admin-preauth-buttons-visible" });
      if (gate.hasAdminDataWorkspace) failures.push({ role: "admin", type: "admin-preauth-admin-data-visible" });
      if (gate.hasSecretText) failures.push({ role: "admin", type: "admin-preauth-secret-visible" });
    }

    if (runtimeEnabled && result.revisit) {
      if (result.revisit.serverRequests.requestCount !== 0 || result.revisit.serverRequests.failureCount !== 0) {
        failures.push(Object.assign({ type: "tab-revisit-server-request", revisit: result.revisit }, whereRole));
      }
      if (result.revisit.googleScriptRunCalls !== 0) {
        failures.push(Object.assign({ type: "tab-revisit-google-script-run", calls: result.revisit.googleScriptRunCalls }, whereRole));
      }
    }

    if (sourceEnabled && result.sourceGateSnapshot) {
      buildSourceGateFailures(result.sourceGateSnapshot, {
        scope: `${result.role}:source-gate`,
        tabs: result.sourceGateTabs,
      }).forEach((failure) => failures.push(failure));
    }

    for (const capture of result.captures) {
      const where = { role: capture.role, theme: capture.theme, tab: capture.tab };
      if (captureEnabled) {
        if (capture.activeTab !== capture.tab) failures.push(Object.assign({ type: "active-tab-mismatch", activeTab: capture.activeTab }, where));
        if (capture.renderStatus === "skeleton" || capture.renderStatus === "rendering" || capture.renderStatus === "selection-shell") failures.push(Object.assign({ type: "tab-still-loading", renderStatus: capture.renderStatus }, where));
        if (capture.hasLoadingPlaceholder) failures.push(Object.assign({ type: "loading-placeholder-visible" }, where));
        if (capture.rootTextLength < 80) failures.push(Object.assign({ type: "blank-or-thin-panel", rootTextLength: capture.rootTextLength }, where));
        if (capture.horizontalOverflow) failures.push(Object.assign({ type: "horizontal-overflow", scrollWidth: capture.scrollWidth, viewportWidth: capture.viewportWidth }, where));
        if (capture.tab !== "admin" && capture.tab !== "admin-data" && !capture.iotaLayoutCount && !capture.staticPanelCount) failures.push(Object.assign({ type: "missing-dashboard-layout" }, where));
        if ((capture.tab === "admin" || capture.tab === "admin-data") && !capture.staticPanelCount && !capture.hasAdminAuthForm) failures.push(Object.assign({ type: "missing-dashboard-layout" }, where));
        if (capture.visualResidue.gradientNodes.length) failures.push(Object.assign({ type: "gradient-residue", sample: capture.visualResidue.gradientNodes.slice(0, 5) }, where));
        if (capture.visualResidue.blurNodes.length) failures.push(Object.assign({ type: "blur-residue", sample: capture.visualResidue.blurNodes.slice(0, 5) }, where));
        if (capture.visualResidue.glowNodes.length) failures.push(Object.assign({ type: "glow-residue", sample: capture.visualResidue.glowNodes.slice(0, 5) }, where));
        if (capture.visualResidue.legacyCardNodes.length) failures.push(Object.assign({ type: "legacy-card-residue", sample: capture.visualResidue.legacyCardNodes.slice(0, 5) }, where));
        if (capture.visualResidue.yellowAreaRatio > MAX_YELLOW_AREA_RATIO || capture.visualResidue.yellowNodeCount > MAX_YELLOW_NODE_COUNT) {
          failures.push(Object.assign({
            type: "excessive-fluorescent-yellow",
            yellowAreaRatio: capture.visualResidue.yellowAreaRatio,
            maxYellowAreaRatio: MAX_YELLOW_AREA_RATIO,
            yellowNodeCount: capture.visualResidue.yellowNodeCount,
            maxYellowNodeCount: MAX_YELLOW_NODE_COUNT,
            sample: capture.visualResidue.yellowNodes.slice(0, 5),
          }, where));
        }
        if (capture.weeklyOrder && !capture.weeklyOrder.ok) {
          failures.push(Object.assign({ type: "weekly-section-order", weeklyOrder: capture.weeklyOrder }, where));
        }
      }
      if (exposureEnabled) {
        if (capture.bodyHasSecret) failures.push(Object.assign({ type: "secret-visible" }, where));
        if (capture.role === "user" && capture.userHasAdminNav) failures.push(Object.assign({ type: "user-admin-nav-visible" }, where));
        if (capture.role === "user" && capture.userHasAdminAction) failures.push(Object.assign({ type: "user-admin-action-visible" }, where));
        if (capture.role === "user" && capture.userHasEditText) failures.push(Object.assign({ type: "user-edit-visible" }, where));
        if (capture.tab === "admin-data" && capture.adminDataState?.hasSecretText) {
          failures.push(Object.assign({ type: "admin-data-secret-visible" }, where));
        }
      }
    }
  }
  return failures;
}

async function main() {
  ensureDir(OUT_DIR);
  const browser = await chromium.launch(withChromiumLaunchOptions({ headless: HEADLESS }));
  const recorderResults = [];
  const results = {
    generatedAt: new Date().toISOString(),
    outDir: OUT_DIR,
    staticBaseUrl: STATIC_BASE_URL,
    userUrl: USER_URL,
    adminUrl: ADMIN_URL,
    checks: CHECKS,
    viewport: VIEWPORT,
    shellReadyMaxMs: SHELL_READY_MAX_MS,
    shellFindMaxMs: SHELL_FIND_MAX_MS,
    shellWaitMaxMs: SHELL_WAIT_MAX_MS,
    weeklyOrderMode: "title",
    weeklyOrderTitles: WEEKLY_ORDER_TITLES,
    legacyWeeklyOrderSelectors: LEGACY_WEEKLY_ORDER_SELECTORS,
    sourceGate: {
      requiredPayloadSource: REQUIRED_PAYLOAD_SOURCE,
      roles: SOURCE_GATE_ROLES,
      tabs: SOURCE_GATE_TABS,
    },
    yellowLimits: {
      maxAreaRatio: MAX_YELLOW_AREA_RATIO,
      maxNodeCount: MAX_YELLOW_NODE_COUNT,
    },
    roles: [],
    serverRecorders: recorderResults,
    failures: [],
    summary: {},
  };
  try {
    for (const role of ACTIVE_ROLES) {
      results.roles.push(await runRole(browser, role, recorderResults));
    }
  } finally {
    await browser.close();
  }

  let failures = buildFailures(results);
  const screenshotCount = results.roles.reduce((sum, role) => {
    return sum +
      1 +
      (role.adminPreAuth ? 2 : 0) +
      role.captures.reduce((inner, capture) => inner + capture.screenshots.length + 1, 0);
  }, 0);
  results.summary = {
    roleCount: results.roles.length,
    tabCaptureCount: results.roles.reduce((sum, role) => sum + role.captures.length, 0),
    screenshotCount,
    failureCount: failures.length,
    consoleErrorCount: results.roles.reduce((sum, role) => sum + role.consoleMessages.filter((entry) => entry.type === "error").length, 0),
    httpProblemCount: results.roles.reduce((sum, role) => sum + role.httpProblems.length, 0),
    requestFailureCount: results.roles.reduce((sum, role) => sum + role.requestFailures.length, 0),
    serverRequestEventCount: recorderResults.reduce((sum, item) => sum + item.events.filter((event) => event.phase === "request").length, 0),
  };
  results.failures = failures;
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2), "utf8");

  const secretFindings = hasCheck("exposure") ? scanArtifactDirectoryForSecrets(OUT_DIR) : [];
  if (secretFindings.length) {
    failures = failures.concat(secretFindings.map((finding) => ({ type: "artifact-secret-pattern", finding })));
    results.failures = failures;
    results.secretScan = { findingCount: secretFindings.length, findings: secretFindings };
    results.summary.failureCount = failures.length;
  } else {
    results.secretScan = { findingCount: 0, findings: [] };
  }
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(JSON.stringify({
    outDir: OUT_DIR,
    summary: results.summary,
    failures: failures.slice(0, 30),
  }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((error) => {
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
