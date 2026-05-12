const { buildDashboardPageUrl, chromium, getExecutablePath, resolveDashboardBaseUrl } = require("./playwright-runtime.cjs");
const fs = require("fs");
const path = require("path");

const BASE_DEPLOYMENT = resolveDashboardBaseUrl();
const URLS = [
  { label: "user", url: process.env.USER_URL || buildDashboardPageUrl("user", BASE_DEPLOYMENT) },
  { label: "admin", url: process.env.ADMIN_URL || buildDashboardPageUrl("admin", BASE_DEPLOYMENT) },
];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const OUT_DIR = process.env.QA_OUT_DIR || path.join(process.cwd(), "qa-artifacts", "current-request", new Date().toISOString().replace(/[:.]/g, "-"));
const EXPECTED_EXPIRY_COLUMNS = [
  "\uB9CC\uAE30\uC6D4", // 만기월
  "\uC784\uCC28\uC778", // 임차인
  "\uC790\uC0B0", // 자산
  "\uC784\uB300\uBA74\uC801", // 임대면적
  "\uC6D4 \uC784\uB300\uB8CC", // 월 임대료
  "\uC6D4 \uAD00\uB9AC\uBE44", // 월 관리비
  "\uC6D4 \uC784\uAD00\uB9AC\uBE44", // 월 임관리비
  "\uD3C9\uB2F9 \uC6D4 \uC784\uB300\uB8CC", // 평당 월 임대료
  "\uD3C9\uB2F9 \uC6D4 \uAD00\uB9AC\uBE44", // 평당 월 관리비
  "E.NOC",
];
const TEMPERATURE_LABELS = [
  "\uC800\uC628", // 저온
  "\uC0C1\uC628", // 상온
  "\uD63C\uD569", // 혼합
  "\uC0AC\uBB34\uC2E4", // 사무실
];

async function findAppFrame(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if ((await frame.locator("#app-shell").count().catch(() => 0)) > 0 ||
          (await frame.locator("#admin-auth-password, #admin-password-input").count().catch(() => 0)) > 0) {
        return frame;
      }
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
  if ((await passwordInput.count().catch(() => 0)) === 0) return;
  if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is required");
  await passwordInput.fill(ADMIN_PASSWORD);
  await submitButton.click();
  await frame.waitForFunction(() => {
    const flags = window.APP_FLAGS || {};
    const shell = document.querySelector("#app-shell");
    return !!flags.adminSessionToken && shell && !shell.classList.contains("is-auth-locked");
  }, null, { timeout: 90000 });
}

async function switchTab(frame, tab) {
  await frame.evaluate((target) => {
    if (window.dashboardApp && typeof window.dashboardApp.switchTab === "function") {
      window.dashboardApp.switchTab(target);
    } else {
      const button = document.querySelector(`[data-tab="${target}"]`);
      if (button) button.click();
    }
  }, tab);
  await frame.waitForFunction((target) => {
    const state = window.dashboardApp && window.dashboardApp.getState && window.dashboardApp.getState();
    return state && state.activeTab === target;
  }, tab, { timeout: 90000 });
}

async function screenshotElement(frame, selector, outputPath) {
  const scrolled = await frame.evaluate((targetSelector) => {
    const nodes = Array.from(document.querySelectorAll(targetSelector));
    const target = nodes.find((node) => node.offsetParent !== null) || nodes[0];
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "nearest" });
    return true;
  }, selector);
  if (!scrolled) throw new Error(`selector not found: ${selector}`);
  await frame.waitForTimeout(800);
  await frame.page().screenshot({ path: outputPath, fullPage: false });
}

async function getChartDatasetInfo(frame, canvasId) {
  return frame.evaluate((id) => {
    const state = window.dashboardApp && window.dashboardApp.getState && window.dashboardApp.getState();
    const chart = state && state.charts && state.charts[id];
    if (!chart) return null;
    return {
      labels: chart.data.labels,
      datasets: chart.data.datasets.map((dataset) => ({
        label: dataset.label,
        yAxisID: dataset.yAxisID || "y",
        count: Array.isArray(dataset.data) ? dataset.data.length : 0,
      })),
    };
  }, canvasId);
}

async function runOne(browser, target) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message || String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 90000 });
  const frame = await findAppFrame(page);
  await loginAdmin(frame);
  await fs.promises.mkdir(OUT_DIR, { recursive: true });

  await switchTab(frame, "home");
  await frame.locator("#home-rent-chart").waitFor({ state: "attached", timeout: 90000 });
  await frame.locator("#home-expiry-chart").waitFor({ state: "attached", timeout: 90000 });
  await frame.waitForTimeout(1200);
  await screenshotElement(frame, "#home-rent-chart", path.join(OUT_DIR, `${target.label}-home-rent-chart.png`));
  await screenshotElement(frame, "#home-expiry-chart", path.join(OUT_DIR, `${target.label}-home-expiry-chart.png`));
  const homeData = await frame.evaluate(() => {
    const state = window.dashboardApp.getState();
    const home = state.lastSuccessfulPayloads.home || state.bootstrap.home;
    const rows = home.rentTrend || [];
    const detailRows = (home.contractSummary && home.contractSummary.monthlyVacancy) || [];
    const grossDrops = [];
    for (let index = 1; index < rows.length; index += 1) {
      const before = Number(rows[index - 1].grossFloorAreaSqm || 0);
      const after = Number(rows[index].grossFloorAreaSqm || 0);
      if (after + 0.01 < before) {
        grossDrops.push({ from: rows[index - 1].month, to: rows[index].month, before, after });
      }
    }
    const targetMonths = rows.filter((row) => row.month === "2018-04" || row.month === "2019-03").map((row) => ({
      month: row.month,
      grossFloorAreaSqm: row.grossFloorAreaSqm,
      activeAssetCount: row.activeAssetCount,
      monthlyRentTotalAdjusted: row.monthlyRentTotalAdjusted,
      monthlyMfTotalAdjusted: row.monthlyMfTotalAdjusted,
      monthlyCostTotalAdjusted: row.monthlyCostTotalAdjusted,
    }));
    return {
      rentTrendRows: rows.length,
      grossDrops,
      targetMonths,
      monthlyVacancyRows: detailRows.length,
      firstMonthlyVacancy: detailRows[0] || null,
    };
  });
  const rentChart = await getChartDatasetInfo(frame, "home-rent-chart");
  const expiryChart = await getChartDatasetInfo(frame, "home-expiry-chart");

  await frame.evaluate(() => {
    const button = Array.from(document.querySelectorAll('[data-action="home-expiry-detail"]'))
      .find((node) => node.offsetParent !== null) || document.querySelector('[data-action="home-expiry-detail"]');
    if (button) button.click();
  });
  await frame.locator(".surface-frame").last().waitFor({ state: "visible", timeout: 30000 });
  const expiryModalText = await frame.locator(".surface-frame").last().innerText();
  await frame.locator(".surface-frame").last().screenshot({ path: path.join(OUT_DIR, `${target.label}-expiry-modal.png`) });
  await frame.locator('[data-close-surface="true"]').last().click().catch(() => {});
  const missingExpiryColumns = EXPECTED_EXPIRY_COLUMNS.filter((column) => !expiryModalText.includes(column));

  await switchTab(frame, "asset");
  await frame.locator("#asset-selector").waitFor({ state: "attached", timeout: 90000 });
  await frame.waitForFunction(() => document.querySelectorAll(".stack-chip").length > 0, null, { timeout: 90000 });
  await screenshotElement(frame, ".stack-grid", path.join(OUT_DIR, `${target.label}-asset-stack.png`));
  const assetStack = await frame.evaluate((temperatureLabels) => {
    const chips = Array.from(document.querySelectorAll(".stack-chip"));
    const text = chips.map((chip) => chip.innerText || "").join("\n");
    return {
      chipCount: chips.length,
      hasSqm: text.includes("\u33A1"),
      hasPy: text.includes("\uD3C9"),
      labelsPresent: temperatureLabels.filter((label) => text.includes(label)),
      classesPresent: Array.from(new Set(chips.flatMap((chip) => Array.from(chip.classList)).filter((name) => name.indexOf("stack-temp-") === 0))),
      sampleText: text.split("\n").slice(0, 12),
    };
  }, TEMPERATURE_LABELS);

  await page.screenshot({ path: path.join(OUT_DIR, `${target.label}-full.png`), fullPage: true });
  await page.close();
  return {
    label: target.label,
    url: target.url,
    homeData,
    rentChart,
    expiryChart,
    missingExpiryColumns,
    assetStack,
    consoleErrors: consoleErrors.filter((text) => !/kylee94\.github\.io|404|ERR_FAILED/.test(text)),
  };
}

(async () => {
  const executablePath = getExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const results = [];
  for (const target of URLS) results.push(await runOne(browser, target));
  await browser.close();
  await fs.promises.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify({ outDir: OUT_DIR, results }, null, 2), "utf8");
  console.log(JSON.stringify({ outDir: OUT_DIR, results }, null, 2));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
