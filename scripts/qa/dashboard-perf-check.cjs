const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_BASE_URL =
  "https://script.google.com/macros/s/AKfycbw-MNDdPW19QrdlKOtZ111UY037Ko3z9O9nYWsqCsXj6r8C814ZUzH6wz1UORE1jdwgNg/exec";
const PROFILE_SOURCE = process.env.DASHBOARD_PROFILE_DIR
  ? path.resolve(process.env.DASHBOARD_PROFILE_DIR)
  : null;
const HEADLESS = !/^false$/i.test(process.env.DASHBOARD_HEADLESS || "true");
const BASE_URL = process.env.DASHBOARD_BASE_URL || DEFAULT_BASE_URL;
const DASHBOARD_TARGET = process.env.DASHBOARD_TARGET || "apps-script";
const EXPECTED_INITIAL_TAB =
  process.env.QA_EXPECTED_INITIAL_TAB ||
  (DASHBOARD_TARGET === "local-docs" ? "weekly" : "home");
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUTPUT_DIR = path.resolve(
  process.env.QA_OUTPUT_DIR || path.join("qa-artifacts", "perf", RUN_STAMP)
);

const PROFILE_SKIP_NAMES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "Crashpad",
  "GraphiteDawnCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "component_crx_cache",
  "extensions_crx_cache",
  "Safe Browsing",
  "Safe Browsing Network",
  "LOCK",
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket",
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowMs() {
  return Number(process.hrtime.bigint() / BigInt(1e6));
}

function round(value) {
  return Math.round(Number(value || 0));
}

function buildPageUrl(mode) {
  const url = new URL(BASE_URL);
  url.searchParams.set("page", mode);
  return url.toString();
}

function safeFilename(value) {
  return String(value).replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function copyProfileForRun(sourceDir) {
  if (!sourceDir) {
    const emptyTargetDir = path.join(os.tmpdir(), `logi-dashboard-qa-profile-${Date.now()}`);
    ensureDir(emptyTargetDir);
    return emptyTargetDir;
  }

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`브라우저 프로필 경로를 찾을 수 없습니다: ${sourceDir}`);
  }

  const targetDir = path.join(os.tmpdir(), `logi-dashboard-qa-profile-${Date.now()}`);
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (sourcePath) => {
      const name = path.basename(sourcePath);
      return !PROFILE_SKIP_NAMES.has(name);
    },
  });
  return targetDir;
}

async function screenshot(page, name, results) {
  const filePath = path.join(OUTPUT_DIR, `${safeFilename(name)}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  results.screenshots.push(filePath);
  return filePath;
}

async function readBodyPreview(page) {
  try {
    const text = await page.locator("body").innerText();
    return text.slice(0, 400);
  } catch (error) {
    return "";
  }
}

async function findDashboardFrame(page) {
  for (const frame of page.frames()) {
    try {
      if ((await frame.locator("#app-shell").count()) > 0) return frame;
    } catch (error) {
      // Cross-origin or transient frames are ignored while the Apps Script panel boots.
    }
  }
  return null;
}

async function dashboardContext(page) {
  return (await findDashboardFrame(page)) || page;
}

async function detectPageState(page) {
  const currentUrl = page.url();
  const title = await page.title();
  const dashboardFrame = await findDashboardFrame(page);
  const hasDashboardShell = !!dashboardFrame;
  const hasEmailInput =
    (await page.locator('input[type="email"], input[autocomplete="username"]').count()) > 0;

  if (currentUrl.includes("accounts.google.com") || hasEmailInput) {
    return {
      status: "login_required",
      title,
      finalUrl: currentUrl,
      bodyPreview: await readBodyPreview(page),
    };
  }

  if (hasDashboardShell) {
    return {
      status: "dashboard_shell",
      title,
      finalUrl: currentUrl,
      dashboardFrameUrl: dashboardFrame.url(),
      bodyPreview: (await dashboardFrame.locator("body").innerText()).slice(0, 400),
    };
  }

  return {
    status: "unknown",
    title,
    finalUrl: currentUrl,
    bodyPreview: await readBodyPreview(page),
  };
}

async function waitForDashboardReady(page, expectedTab) {
  const target = await dashboardContext(page);
  await target.waitForSelector("#app-shell", { timeout: 30000 });
  await target.waitForFunction(
    (tab) => {
      const overlay = document.getElementById("loading-overlay");
      const overlayVisible = overlay && overlay.classList.contains("is-visible");
      const pageTitle = document.getElementById("page-title")?.textContent?.trim();
      const panel = document.querySelector(`.tab-panel[data-panel="${tab}"]`);
      const root = document.getElementById(`${tab}-view`);
      const hasMeaningfulContent = !!root && root.innerText.trim().length > 30;
      return !!pageTitle && !overlayVisible && !!panel && panel.classList.contains("is-active") && hasMeaningfulContent;
    },
    expectedTab,
    { timeout: 30000 }
  );
}

async function waitForDashboardReadyAny(page, expectedTabs) {
  const target = await dashboardContext(page);
  await target.waitForSelector("#app-shell", { timeout: 30000 });
  await target.waitForFunction(
    (tabs) => {
      const overlay = document.getElementById("loading-overlay");
      const overlayVisible = overlay && overlay.classList.contains("is-visible");
      const activeTab = document.querySelector(".tab-panel.is-active")?.getAttribute("data-panel");
      const root = activeTab ? document.getElementById(`${activeTab}-view`) : null;
      const hasMeaningfulContent = !!root && root.innerText.trim().length > 30;
      return !overlayVisible && !!activeTab && tabs.includes(activeTab) && hasMeaningfulContent;
    },
    expectedTabs,
    { timeout: 30000 }
  );
}

async function getDashboardSnapshot(page) {
  const target = await dashboardContext(page);
  return target.evaluate(() => {
    const navEntry = performance.getEntriesByType("navigation")[0];
    return {
      bodyIsAdmin: document.body?.dataset?.isAdmin || "false",
      roleChip: document.getElementById("role-chip")?.textContent?.trim() || "",
      pageTitle: document.getElementById("page-title")?.textContent?.trim() || "",
      activeTab:
        document.querySelector(".tab-panel.is-active")?.getAttribute("data-panel") || "",
      viewerEmail: window.APP_FLAGS?.viewerEmail || "",
      appFlags: window.APP_FLAGS || {},
      perfLogs: Array.isArray(window.__dashboardPerf) ? window.__dashboardPerf.slice() : [],
      navigation: navEntry
        ? {
            domContentLoadedMs: Math.round(Number(navEntry.domContentLoadedEventEnd || 0)),
            loadMs: Math.round(Number(navEntry.loadEventEnd || 0)),
            responseEndMs: Math.round(Number(navEntry.responseEnd || 0)),
          }
        : null,
    };
  });
}

async function measureAction(name, results, action) {
  const startedAt = nowMs();
  try {
    const data = await action();
    const durationMs = nowMs() - startedAt;
    const measurement = Object.assign({ name, durationMs, status: "ok" }, data || {});
    results.measurements.push(measurement);
    return measurement;
  } catch (error) {
    const durationMs = nowMs() - startedAt;
    const measurement = {
      name,
      durationMs,
      status: "error",
      error: error && error.message ? error.message : String(error),
    };
    results.measurements.push(measurement);
    return measurement;
  }
}

async function gotoAndCheck(page, mode, results) {
  const url = buildPageUrl(mode);
  const startedAt = nowMs();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  const state = await detectPageState(page);
  const durationMs = nowMs() - startedAt;
  const screenshotPath = await screenshot(page, `${mode}-entry`, results);
  const entry = Object.assign({ requestedUrl: url, durationMs, screenshot: screenshotPath }, state);

  if (state.status === "dashboard_shell") {
    if (mode === "admin") {
      const target = await dashboardContext(page);
      const authLocked = await target.evaluate(() => {
        return document.getElementById("admin-auth-root") != null
          || document.getElementById("app-shell")?.classList.contains("is-auth-locked");
      });
      if (authLocked) {
        entry.dashboard = await getDashboardSnapshot(page);
        entry.status = "admin_auth_gate";
        entry.screenshot = await screenshot(page, `${mode}-auth-gate`, results);
        results.entryChecks[mode] = entry;
        return entry;
      }
      await waitForDashboardReadyAny(page, ["admin", "home"]);
    } else {
      await waitForDashboardReady(page, EXPECTED_INITIAL_TAB);
    }
    entry.dashboard = await getDashboardSnapshot(page);
    entry.status =
      mode === "admin" && entry.dashboard.bodyIsAdmin !== "true"
        ? "dashboard_but_not_admin"
        : "dashboard_ready";
    entry.screenshot = await screenshot(page, `${mode}-ready`, results);
  }

  results.entryChecks[mode] = entry;
  return entry;
}

async function clickTab(page, tab, results) {
  return measureAction(`tab:${tab}`, results, async () => {
    const target = await dashboardContext(page);
    const selector = `.nav-item[data-tab="${tab}"]`;
    await target.waitForSelector(selector, { timeout: 10000 });
    await target.click(selector);
    await waitForDashboardReady(page, tab);
    return {
      pageTitle: await target.locator("#page-title").innerText(),
      screenshot: await screenshot(page, `tab-${tab}`, results),
    };
  });
}

async function openSupportModal(page, results) {
  return measureAction("modal:support", results, async () => {
    const target = await dashboardContext(page);
    await target.click("#support-button");
    await target.waitForSelector('#modal-host[aria-hidden="false"] .surface-title', { timeout: 10000 });
    const title = await target.locator("#modal-host .surface-title").innerText();
    const shot = await screenshot(page, "support-modal", results);
    await target.click('#modal-host [data-close-surface="true"]');
    await target.waitForFunction(() => {
      const host = document.getElementById("modal-host");
      return !host || host.getAttribute("aria-hidden") === "true";
    });
    return { modalTitle: title, screenshot: shot };
  });
}

async function openFirstAssetPanel(page, results) {
  return measureAction("panel:asset-detail", results, async () => {
    const target = await dashboardContext(page);
    const candidate = target
      .locator('#asset-view [data-action="asset-panel"]:visible, #asset-view [data-asset]:visible')
      .first();
    if ((await candidate.count()) === 0) {
      return { status: "skipped", reason: "asset detail trigger not found" };
    }

    await candidate.click();
    await target.waitForSelector('#detail-panel-host[aria-hidden="false"] .surface-title', { timeout: 10000 });
    const title = await target.locator("#detail-panel-host .surface-title").innerText();
    const shot = await screenshot(page, "asset-detail-panel", results);
    await target.click('#detail-panel-host [data-close-surface="true"]');
    await target.waitForFunction(() => {
      const host = document.getElementById("detail-panel-host");
      return !host || host.getAttribute("aria-hidden") === "true";
    });
    return { panelTitle: title, screenshot: shot };
  });
}

async function runUserFlow(page, results) {
  const userEntry = results.entryChecks.user;
  if (!userEntry || userEntry.status !== "dashboard_ready") {
    results.blockers.push("user URL에서 대시보드 본문에 진입하지 못해 성능 플로우 측정을 건너뛰었습니다.");
    return;
  }

  results.flow.prefetchedTabs = userEntry.dashboard.perfLogs
    .filter((item) => /^tab:/.test(item.name))
    .map((item) => item.name);

  await openSupportModal(page, results);
  await clickTab(page, "asset", results);
  await openFirstAssetPanel(page, results);
  await clickTab(page, "company", results);
  await clickTab(page, "home", results);
  results.flow.finalDashboard = await getDashboardSnapshot(page);
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const results = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    adminUrl: buildPageUrl("admin"),
    userUrl: buildPageUrl("user"),
    headless: HEADLESS,
    profileSource: PROFILE_SOURCE || "temporary-empty-profile",
    outputDir: OUTPUT_DIR,
    entryChecks: {},
    measurements: [],
    flow: {},
    blockers: [],
    screenshots: [],
    consoleMessages: [],
    pageErrors: [],
    requestFailures: [],
  };

  let tempProfileDir = null;
  let browserContext = null;

  try {
    tempProfileDir = copyProfileForRun(PROFILE_SOURCE);
    results.profileRunCopy = tempProfileDir;

    browserContext = await chromium.launchPersistentContext(tempProfileDir, {
      channel: "msedge",
      headless: HEADLESS,
      viewport: { width: 1440, height: 1024 },
    });

    const page = browserContext.pages()[0] || (await browserContext.newPage());
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        results.consoleMessages.push({
          type: message.type(),
          text: message.text(),
        });
      }
    });
    page.on("pageerror", (error) => {
      results.pageErrors.push(error.message || String(error));
    });
    page.on("requestfailed", (request) => {
      results.requestFailures.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure(),
      });
    });

    const userEntry = await gotoAndCheck(page, "user", results);
    if (userEntry.status === "login_required") {
      results.blockers.push("복사된 Edge 프로필에 Google 로그인 세션이 없어 user URL이 로그인 화면으로 이동했습니다.");
    }

    await runUserFlow(page, results);

    const adminEntry = await gotoAndCheck(page, "admin", results);
    if (adminEntry.status === "admin_auth_gate") {
      results.flow.adminAuthGate = "ok";
    } else if (adminEntry.status === "login_required") {
      results.blockers.push("복사된 Edge 프로필에 Google 로그인 세션이 없어 admin URL도 로그인 화면으로 이동했습니다.");
    } else if (adminEntry.status === "dashboard_but_not_admin") {
      results.blockers.push("admin URL은 열렸지만 현재 계정이 관리자 권한이 아니어서 Admin 본문으로 들어가지 못했습니다.");
    }

    results.summary = {
      userStatus: results.entryChecks.user?.status || "not_checked",
      adminStatus: results.entryChecks.admin?.status || "not_checked",
      measurementCount: results.measurements.length,
      blockerCount: results.blockers.length,
    };
  } catch (error) {
    results.fatalError = error && error.message ? error.message : String(error);
    results.blockers.push(`측정 스크립트 실행 중 예외가 발생했습니다: ${results.fatalError}`);
  } finally {
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    if (tempProfileDir) {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    }
  }

  const reportPath = path.join(OUTPUT_DIR, "summary.json");
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`QA summary written to ${reportPath}`);
  console.log(
    JSON.stringify(
      {
        summary: results.summary || null,
        blockers: results.blockers,
        outputDir: results.outputDir,
      },
      null,
      2
    )
  );

  if ((results.entryChecks.user && results.entryChecks.user.status !== "dashboard_ready") ||
      (results.entryChecks.admin &&
        !["dashboard_ready", "dashboard_but_not_admin", "admin_auth_gate"].includes(results.entryChecks.admin.status))) {
    process.exitCode = 2;
  }
}

main();
