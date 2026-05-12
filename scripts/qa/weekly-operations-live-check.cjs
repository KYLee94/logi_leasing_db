const { buildDashboardPageUrl, chromium, getExecutablePath, resolveDashboardBaseUrl } = require("./playwright-runtime.cjs");
const fs = require("fs");
const path = require("path");

const DEPLOYMENT =
  process.env.WEEKLY_DEPLOYMENT ||
  resolveDashboardBaseUrl();
const TARGET_SCOPE = process.env.WEEKLY_TARGET_SCOPE || "all";
const ALL_TARGETS = [
  { label: "user", url: process.env.USER_URL || buildDashboardPageUrl("user", DEPLOYMENT), needsAdmin: false },
  { label: "admin", url: process.env.ADMIN_URL || buildDashboardPageUrl("admin", DEPLOYMENT), needsAdmin: true },
];
const TARGETS = ALL_TARGETS.filter((target) => TARGET_SCOPE === "all" || target.label === TARGET_SCOPE);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const OUT_DIR =
  process.env.QA_OUT_DIR ||
  path.join(process.cwd(), "qa-artifacts", "weekly-operations", new Date().toISOString().replace(/[:.]/g, "-"));

async function findAppFrame(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const hasApp = await frame.locator("#app-shell, #admin-auth-password, #admin-password-input").count().catch(() => 0);
      if (hasApp > 0) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("app frame not found");
}

async function loginAdmin(frame) {
  const standaloneInput = frame.locator("#admin-auth-password");
  const inlineInput = frame.locator("#admin-password-input");
  const hasStandaloneGate = (await standaloneInput.count().catch(() => 0)) > 0;
  const passwordInput = hasStandaloneGate ? standaloneInput : inlineInput;
  const submitButton = hasStandaloneGate ? frame.locator("#admin-auth-submit") : frame.locator("#admin-password-submit");
  if ((await passwordInput.count().catch(() => 0)) === 0) return false;
  if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD env is required for admin weekly live check.");
  await passwordInput.fill(ADMIN_PASSWORD);
  await submitButton.click();
  await frame.waitForFunction(() => {
    const flags = window.APP_FLAGS || {};
    const shell = document.querySelector("#app-shell");
    return !!flags.adminSessionToken && shell && !shell.classList.contains("is-auth-locked");
  }, null, { timeout: 90000 });
  return true;
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
    const state = window.dashboardApp && window.dashboardApp.getState && window.dashboardApp.getState();
    return state && state.activeTab === target && document.querySelector(".weekly-report-page");
  }, tab, { timeout: 90000 });
}

async function closeSurface(frame) {
  await frame.evaluate(() => {
    if (typeof window.closeSurface === "function") {
      window.closeSurface();
      return;
    }
    document.querySelector("[data-surface-close]")?.click();
  }).catch(() => {});
  await frame.waitForTimeout(300);
}

async function screenshotCurrent(page, frame, label, suffix, selector) {
  if (selector) {
    await frame.evaluate((targetSelector) => {
      const nodes = Array.from(document.querySelectorAll(targetSelector));
      const target = nodes.find((node) => node.offsetParent !== null) || nodes[0];
      if (target) target.scrollIntoView({ block: "start", inline: "nearest" });
    }, selector);
    await frame.waitForTimeout(650);
  }
  const file = path.join(OUT_DIR, `${label}-${suffix}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function assertModalOpens(frame, action, expectedText) {
  await frame.locator(`[data-action="${action}"]`).first().click();
  await frame.waitForFunction((text) => (document.body.innerText || "").includes(text), expectedText, { timeout: 15000 });
  await closeSurface(frame);
}

async function runTarget(browser, target) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message || String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 90000 });
  const frame = await findAppFrame(page);
  const hadPasswordGate = target.needsAdmin ? await loginAdmin(frame) : false;
  await switchTab(frame, "weekly");
  await frame.locator(".weekly-report-page").waitFor({ state: "attached", timeout: 90000 });
  await frame.waitForTimeout(1600);

  const screenshots = [];
  screenshots.push(await screenshotCurrent(page, frame, target.label, "01-top-kpi-priority", ".weekly-report-page"));
  screenshots.push(await screenshotCurrent(page, frame, target.label, "02-maturity-assets", ".weekly-maturity-panel"));
  screenshots.push(await screenshotCurrent(page, frame, target.label, "03-risk", ".weekly-issue-grid"));
  screenshots.push(await screenshotCurrent(page, frame, target.label, "04-new-project", "#weekly-new-project-detail"));
  screenshots.push(await screenshotCurrent(page, frame, target.label, "05-management-project", "#weekly-management-project-detail"));

  const beforeText = await frame.evaluate(() => document.body.innerText || "");
  const forbidden = [
    "User 화면은 읽기 전용",
    "원문 세부조건",
    "원문 세부조건 분리 보기",
    "기타 원문",
  ].filter((text) => beforeText.includes(text));

  const cssCheck = await frame.evaluate(() => {
    const cell = document.querySelector(".weekly-ledger-table td");
    const projectCell = document.querySelector("#weekly-new-project-detail .weekly-ledger-table td");
    const style = cell ? window.getComputedStyle(cell) : null;
    const projectStyle = projectCell ? window.getComputedStyle(projectCell) : null;
    return {
      kpiCount: document.querySelectorAll('[data-action^="weekly-summary-"]').length,
      rawButtonCount: document.querySelectorAll("[data-weekly-raw-id]").length,
      hasPriorityTable: !!document.querySelector("#weekly-priority-table"),
      hasMonthlyButtons: document.querySelectorAll(".weekly-maturity-buttons, .weekly-maturity-button").length,
      firstBorderBottom: style && style.borderBottomWidth,
      firstBorderStyle: style && style.borderBottomStyle,
      projectBorderBottom: projectStyle && projectStyle.borderBottomWidth,
      hasProjectSourceBlock: !!document.querySelector(".weekly-project-source-details"),
    };
  });

  await assertModalOpens(frame, "weekly-summary-assets", "총 자산 수 상세");
  await assertModalOpens(frame, "weekly-summary-area", "총 연면적 상세");
  await assertModalOpens(frame, "weekly-summary-risk", "상세");
  await assertModalOpens(frame, "weekly-summary-maturity12", "12개월 내 만기 상세");
  await assertModalOpens(frame, "weekly-summary-maturity24", "24개월 내 만기 상세");

  const canvas = frame.locator("#weekly-maturity-chart").first();
  await canvas.click({ position: { x: 260, y: 120 } });
  await frame.waitForFunction(() => /만기 캘린더/.test(document.body.innerText || ""), null, { timeout: 15000 });
  await closeSurface(frame);

  await frame.locator("[data-weekly-row-detail]").first().click();
  await frame.waitForFunction(() => (document.body.innerText || "").includes("주간 업무 자산 상세"), null, { timeout: 15000 });
  const detailTableHasLines = await frame.evaluate(() => {
    const cell = document.querySelector(".surface-body .weekly-ledger-table td");
    const style = cell ? window.getComputedStyle(cell) : null;
    return !!style && style.borderBottomWidth !== "0px" && style.borderBottomStyle !== "none";
  });
  await closeSurface(frame);

  await frame.locator("[data-weekly-raw-id]").first().click();
  await frame.waitForFunction(() => (document.body.innerText || "").includes("상세 원문"), null, { timeout: 15000 });
  await closeSurface(frame);

  await page.close();
  const filteredErrors = consoleErrors.filter((text) => !/github\.io|raw\.githubusercontent|404|ERR_FAILED/.test(text));
  return { target: target.label, hadPasswordGate, screenshots, forbidden, cssCheck, detailTableHasLines, consoleErrors: filteredErrors };
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: getExecutablePath() });
  const results = [];
  for (const target of TARGETS) {
    results.push(await runTarget(browser, target));
  }
  await browser.close();
  const resultFile = path.join(OUT_DIR, "result.json");
  await fs.promises.writeFile(resultFile, JSON.stringify({ outDir: OUT_DIR, results }, null, 2), "utf8");
  console.log(JSON.stringify({ outDir: OUT_DIR, results }, null, 2));

  const failures = [];
  for (const result of results) {
    if (result.forbidden.length) failures.push(`${result.target}: forbidden text ${result.forbidden.join(", ")}`);
    if (result.cssCheck.kpiCount < 5) failures.push(`${result.target}: weekly KPI buttons not found`);
    if (!result.cssCheck.hasPriorityTable) failures.push(`${result.target}: priority ledger table missing`);
    if (result.cssCheck.hasMonthlyButtons) failures.push(`${result.target}: maturity monthly buttons still visible`);
    if (result.cssCheck.hasProjectSourceBlock) failures.push(`${result.target}: legacy project source block visible`);
    if (result.cssCheck.firstBorderBottom === "0px" || result.cssCheck.firstBorderStyle === "none") failures.push(`${result.target}: weekly table row separators not visible`);
    if (!result.detailTableHasLines) failures.push(`${result.target}: asset detail table borders not visible`);
    if (result.consoleErrors.length) failures.push(`${result.target}: console errors ${result.consoleErrors.join(" | ")}`);
  }
  if (failures.length) {
    console.error(JSON.stringify({ failures }, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
