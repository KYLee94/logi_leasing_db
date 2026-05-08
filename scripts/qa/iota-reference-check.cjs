const { buildDashboardPageUrl, chromium, getExecutablePath, resolveDashboardBaseUrl } = require("./playwright-runtime.cjs");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const BASE_DEPLOYMENT = resolveDashboardBaseUrl();
const REFERENCE_LOCAL_PATH = process.env.IOTA_REFERENCE_FILE || "C:\\tmp\\IGIS_RA_Report_auto_ref\\docs\\iota-development-workspace.html";
const REFERENCE_URL = process.env.IOTA_REFERENCE_URL || (
  fs.existsSync(REFERENCE_LOCAL_PATH)
    ? pathToFileURL(REFERENCE_LOCAL_PATH).toString()
    : "https://kylee94.github.io/IGIS_RA_Report_auto/iota-development-workspace.html#lfc"
);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const URLS = [
  { role: "user", url: process.env.USER_URL || buildDashboardPageUrl("user", BASE_DEPLOYMENT) },
].concat((ADMIN_PASSWORD || process.env.IOTA_QA_ADMIN === "true")
  ? [{ role: "admin", url: process.env.ADMIN_URL || buildDashboardPageUrl("admin", BASE_DEPLOYMENT) }]
  : []);
const OUT_DIR = process.env.QA_OUT_DIR || path.join(process.cwd(), "qa-artifacts", "iota-reference", new Date().toISOString().replace(/[:.]/g, "-"));
const THEMES = (process.env.IOTA_QA_THEMES || "dark,light").split(",").map((item) => item.trim()).filter(Boolean);
const TABS = ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality"].concat(process.env.IOTA_QA_ADMIN === "true" ? ["admin", "admin-data"] : []);
const EXPECTED_WEEKLY_SECTION_IDS = [
  "weekly-summary",
  "weekly-new-projects",
  "weekly-management-projects",
  "weekly-assets",
  "weekly-notes",
];

const EXPECTED_DARK_TOKENS = {
  "--bg": "#1f1f1e",
  "--sidebar": "#1b1b1a",
  "--panel": "#242423",
  "--line": "#373737",
  "--accent": "#d7de4a",
};

async function findAppFrame(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if ((await page.locator("#app, #app-shell").count().catch(() => 0)) > 0 ||
        (await page.locator("#admin-auth-password, #admin-password-input").count().catch(() => 0)) > 0) {
      return page;
    }
    for (const frame of page.frames()) {
      if ((await frame.locator("#app, #app-shell").count().catch(() => 0)) > 0 ||
          (await frame.locator("#admin-auth-password, #admin-password-input").count().catch(() => 0)) > 0) {
        return frame;
      }
    }
    await page.waitForTimeout(500);
  }
  const pageState = await page.evaluate(() => ({
    title: document.title || "",
    url: location.href,
    text: (document.body && document.body.innerText || "").slice(0, 240),
  })).catch(() => ({ title: "", url: page.url(), text: "" }));
  throw new Error(`app frame not found: ${JSON.stringify(pageState)}`);
}

async function loginAdmin(frame) {
  const input = frame.locator("#admin-auth-password, #admin-password-input").first();
  if ((await input.count().catch(() => 0)) === 0) return;
  if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is required for admin QA");
  await input.fill(ADMIN_PASSWORD);
  await frame.locator("#admin-auth-submit, #admin-password-submit").first().click();
  await frame.waitForFunction(() => {
    const shell = document.querySelector("#app-shell");
    return shell && !shell.classList.contains("is-auth-locked");
  }, null, { timeout: 90000 });
}

async function switchTab(frame, tab) {
  await frame.evaluate((target) => {
    if (window.dashboardApp && typeof window.dashboardApp.switchTab === "function") {
      window.dashboardApp.switchTab(target);
      return;
    }
    document.querySelector(`[data-tab="${target}"]`)?.click();
  }, tab);
  await frame.waitForFunction((target) => {
    const state = window.dashboardApp?.getState?.();
    if (state && state.activeTab === target) return true;
    return document.querySelector(`.tab-panel.is-active[data-panel="${target}"]`) ||
      document.querySelector(`[data-tab="${target}"].is-active, [data-tab="${target}"].active`);
  }, tab, { timeout: 90000 });
}

async function setTheme(frame, theme) {
  await frame.evaluate((target) => {
    if (window.dashboardApp?.setThemePreference) {
      window.dashboardApp.setThemePreference(target);
      return;
    }
    sessionStorage.setItem("logi-iota-theme", target);
    localStorage.setItem("dashboard.themePreference", target);
    document.body.dataset.theme = target;
    document.body.dataset.themeResolved = target;
  }, theme);
  await frame.waitForTimeout(500);
}

async function collectCssState(frame) {
  return frame.evaluate((expected) => {
    const doc = document.documentElement;
    const body = document.body;
    const rootStyle = getComputedStyle(doc);
    const bodyStyle = getComputedStyle(body);
    const sidebar = document.querySelector(".sidebar");
    const panel = Array.from(document.querySelectorAll(".section, .tab-panel, .workspace-panel, .section-card, .hero-panel"))
      .find((node) => node.offsetParent !== null);
    const rail = document.querySelector(".project-rail");
    const topbar = document.querySelector(".topbar, .page-head");
    const activeTabPanel = document.querySelector(".tab-panel.is-active");
    const activePanelSections = activeTabPanel ? Array.from(activeTabPanel.querySelectorAll(".section[data-section-id]")) : [];
    const weeklySectionIds = Array.from(document.querySelectorAll('[data-panel="weekly"] .section[data-section-id]'))
      .map((node) => node.dataset.sectionId || node.id || "");
    const visualEffectResidues = Array.from(document.querySelectorAll("body *"))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((node) => {
        const style = getComputedStyle(node);
        return {
          tag: node.tagName.toLowerCase(),
          className: typeof node.className === "string" ? node.className : "",
          id: node.id || "",
          backgroundImage: style.backgroundImage,
          boxShadow: style.boxShadow,
          filter: style.filter,
          backdropFilter: style.backdropFilter || style.webkitBackdropFilter || "",
        };
      })
      .filter((item) => {
        const backgroundHasGradient = /gradient/i.test(item.backgroundImage || "");
        const hasBoxShadow = item.boxShadow && item.boxShadow !== "none";
        const hasFilter = item.filter && item.filter !== "none";
        const hasBackdropFilter = item.backdropFilter && item.backdropFilter !== "none";
        return backgroundHasGradient || hasBoxShadow || hasFilter || hasBackdropFilter;
      })
      .slice(0, 24);
    const tokens = Object.fromEntries(Object.keys(expected).map((key) => [key, rootStyle.getPropertyValue(key).trim()]));
    const tokenMismatches = Object.entries(expected)
      .filter(([key, value]) => String(tokens[key]).toLowerCase() !== value.toLowerCase())
      .map(([key, value]) => ({ key, expected: value, actual: tokens[key] }));
    return {
      tokens,
      tokenMismatches,
      bodyBackground: bodyStyle.backgroundColor,
      sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0,
      sidebarBackground: sidebar ? getComputedStyle(sidebar).backgroundColor : "",
      panelBackground: panel ? getComputedStyle(panel).backgroundColor : "",
      panelBorder: panel ? getComputedStyle(panel).borderTopColor : "",
      railPosition: rail ? getComputedStyle(rail).position : "",
      tableCellPadding: (() => {
        const cell = document.querySelector("th, td");
        return cell ? getComputedStyle(cell).padding : "";
      })(),
      sectionCount: activePanelSections.length,
      weeklySectionIds,
      topbarHeight: topbar ? Math.round(topbar.getBoundingClientRect().height) : 0,
      consoleReady: !!window.dashboardApp || !!document.querySelector("#app, #app-shell"),
      visualEffectResidues,
    };
  }, EXPECTED_DARK_TOKENS);
}

async function runRole(browser, target) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message || String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 90000 });
  const frame = await findAppFrame(page);
  if (target.role === "admin") await loginAdmin(frame);
  const results = [];
  for (const theme of THEMES) {
    await setTheme(frame, theme);
    for (const tab of TABS) {
      if (target.role !== "admin" && (tab === "admin" || tab === "admin-data")) continue;
      if ((await frame.locator(`[data-tab="${tab}"]`).count().catch(() => 0)) === 0) continue;
      await switchTab(frame, tab);
      await frame.waitForTimeout(1200);
      const cssState = await collectCssState(frame);
      const screenshot = path.join(OUT_DIR, `${target.role}-${theme}-${tab}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      results.push({ role: target.role, theme, tab, screenshot, cssState });
    }
  }
  await page.close();
  return {
    role: target.role,
    url: target.url,
    results,
    consoleErrors: consoleErrors.filter((text) => !/404|ERR_FAILED|kylee94\.github\.io/.test(text)),
  };
}

async function captureReference(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  await page.goto(REFERENCE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1200);
  const screenshot = path.join(OUT_DIR, "reference-iota.png");
  await page.screenshot({ path: screenshot, fullPage: false });
  const state = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar, aside, nav");
    const bodyStyle = getComputedStyle(document.body);
    return {
      title: document.title,
      url: location.href,
      bodyBackground: bodyStyle.backgroundColor,
      sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0,
      textLength: document.body ? document.body.innerText.length : 0,
    };
  });
  await page.close();
  return { url: REFERENCE_URL, screenshot, state };
}

(async () => {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const executablePath = getExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const reference = await captureReference(browser);
  const roles = [];
  for (const target of URLS) roles.push(await runRole(browser, target));
  await browser.close();
  const failures = [];
  if (!reference.state.textLength || reference.state.textLength < 100) {
    failures.push({ role: "reference", type: "referenceLoad", url: reference.url });
  }
  roles.forEach((role) => {
    role.consoleErrors.forEach((error) => failures.push({ role: role.role, type: "console", error }));
    role.results.forEach((result) => {
      if (result.theme === "dark" && result.cssState.tokenMismatches.length) {
        failures.push({ role: result.role, tab: result.tab, type: "tokens", mismatches: result.cssState.tokenMismatches });
      }
      if (result.theme === "dark" && result.cssState.sidebarWidth !== 273 && result.cssState.sidebarWidth !== 72) {
        failures.push({ role: result.role, tab: result.tab, type: "sidebarWidth", actual: result.cssState.sidebarWidth });
      }
      if (result.cssState.railPosition && result.cssState.railPosition !== "sticky") {
        failures.push({ role: result.role, tab: result.tab, type: "railPosition", actual: result.cssState.railPosition });
      }
      if (result.tab === "weekly") {
        const actualOrder = result.cssState.weeklySectionIds || [];
        if (JSON.stringify(actualOrder) !== JSON.stringify(EXPECTED_WEEKLY_SECTION_IDS)) {
          failures.push({ role: result.role, tab: result.tab, type: "weeklyOrder", expected: EXPECTED_WEEKLY_SECTION_IDS, actual: actualOrder });
        }
        if (!/^12px 14px$/i.test(result.cssState.tableCellPadding || "")) {
          failures.push({ role: result.role, tab: result.tab, type: "tableCellPadding", expected: "12px 14px", actual: result.cssState.tableCellPadding });
        }
      }
      if (!result.cssState.sectionCount) {
        failures.push({ role: result.role, tab: result.tab, type: "sectionMissing" });
      }
      if (!result.cssState.consoleReady) failures.push({ role: result.role, tab: result.tab, type: "dashboardAppMissing" });
      if (result.cssState.visualEffectResidues && result.cssState.visualEffectResidues.length) {
        failures.push({
          role: result.role,
          tab: result.tab,
          type: "visualEffectResidues",
          residues: result.cssState.visualEffectResidues,
        });
      }
    });
  });
  const summary = { outDir: OUT_DIR, reference, failures, roles };
  await fs.promises.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
