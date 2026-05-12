const { buildDashboardPageUrl, chromium, getExecutablePath, resolveDashboardBaseUrl } = require("./playwright-runtime.cjs");
const fs = require("fs");
const path = require("path");

const BASE_DEPLOYMENT = resolveDashboardBaseUrl();
const USER_URL = process.env.USER_URL || buildDashboardPageUrl("user", BASE_DEPLOYMENT);
const ADMIN_URL = process.env.ADMIN_URL || buildDashboardPageUrl("admin", BASE_DEPLOYMENT);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const OUT_DIR = process.env.QA_OUT_DIR || path.join(process.cwd(), "qa-artifacts", "live-home-asset", new Date().toISOString().replace(/[:.]/g, "-"));

async function findDashboardFrame(page) {
  for (const frame of page.frames()) {
    try {
      if ((await frame.locator("#app-shell").count()) > 0) return frame;
      if ((await frame.locator("#admin-password-input").count()) > 0) return frame;
    } catch (error) {
      // Ignore cross-origin frame races.
    }
  }
  return page;
}

async function waitForDashboardFrame(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const frame = await findDashboardFrame(page);
    if ((await frame.locator("#app-shell").count().catch(() => 0)) > 0 ||
        (await frame.locator("#admin-password-input").count().catch(() => 0)) > 0) {
      return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Dashboard frame was not found.");
}

async function waitForNoMainError(frame) {
  await frame.waitForFunction(() => {
    const text = document.body.innerText || "";
    return !text.includes("오류가 발생했습니다.") || document.querySelector("#home-rent-chart") || document.querySelector("#asset-selector");
  }, null, { timeout: 90000 });
}

async function loginAdminIfNeeded(frame) {
  const hasPassword = (await frame.locator("#admin-password-input").count().catch(() => 0)) > 0;
  if (!hasPassword) return frame;
  if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD env is required for admin verification.");
  await frame.locator("#admin-password-input").fill(ADMIN_PASSWORD);
  await frame.locator("#admin-password-submit").click();
  await frame.locator("#app-shell").waitFor({ state: "attached", timeout: 90000 });
  return frame;
}

async function switchTab(frame, tab) {
  const clicked = await frame.locator(`[data-tab="${tab}"]`).first().click({ timeout: 5000 }).then(() => true).catch(() => false);
  if (!clicked) {
    await frame.evaluate((targetTab) => {
      if (window.dashboardApp && typeof window.dashboardApp.switchTab === "function") {
        window.dashboardApp.switchTab(targetTab);
      }
    }, tab);
  }
  await frame.waitForFunction((targetTab) => {
    const state = window.dashboardApp && window.dashboardApp.getState && window.dashboardApp.getState();
    return state && state.activeTab === targetTab;
  }, tab, { timeout: 90000 });
}

async function verifyHome(frame, label) {
  await switchTab(frame, "home");
  await frame.locator("#home-rent-chart").waitFor({ state: "attached", timeout: 90000 });
  await frame.locator("#home-expiry-chart").waitFor({ state: "attached", timeout: 90000 });
  await frame.waitForFunction(() => {
    const state = window.dashboardApp && window.dashboardApp.getState && window.dashboardApp.getState();
    const home = state && (state.lastSuccessfulPayloads.home || state.bootstrap.home);
    return home && Array.isArray(home.rentTrend) && home.rentTrend.length && home.contractSummary && Array.isArray(home.contractSummary.monthlyVacancy);
  }, null, { timeout: 90000 });

  const payloadCheck = await frame.evaluate(() => {
    const state = window.dashboardApp.getState();
    const home = state.lastSuccessfulPayloads.home || state.bootstrap.home;
    const rentTrend = home.rentTrend || [];
    const drops = [];
    for (let i = 1; i < rentTrend.length; i += 1) {
      const prev = Number(rentTrend[i - 1].grossFloorAreaSqm || 0);
      const next = Number(rentTrend[i].grossFloorAreaSqm || 0);
      if (next + 0.01 < prev) drops.push({ from: rentTrend[i - 1].month, to: rentTrend[i].month, prev, next });
    }
    const seriesKeys = ["monthlyRentTotalAdjusted", "monthlyMfTotalAdjusted", "monthlyCostTotalAdjusted", "activeAssetCount"];
    const hasRequiredSeries = rentTrend.some((row) => seriesKeys.every((key) => row[key] != null));
    return {
      rentTrendRows: rentTrend.length,
      monthlyVacancyRows: (home.contractSummary.monthlyVacancy || []).length,
      firstMonthlyVacancy: (home.contractSummary.monthlyVacancy || [])[0] || null,
      grossFloorAreaDrops: drops,
      hasRequiredSeries,
    };
  });

  await frame.evaluate(() => {
    const visibleButton = Array.from(document.querySelectorAll('[data-action="home-expiry-detail"]'))
      .find((node) => node.offsetParent !== null) || document.querySelector('[data-action="home-expiry-detail"]');
    if (visibleButton) visibleButton.click();
  });
  await frame.locator(".surface-frame").last().waitFor({ state: "visible", timeout: 30000 });
  const expiryModalText = await frame.locator(".surface-frame").last().innerText();
  const expiryColumns = ["만기월", "임차인", "자산", "임대면적", "월 임대료", "월 관리비", "월 임관리비", "평당 월 임대료", "평당 월 관리비", "E.NOC"].every((text) => expiryModalText.includes(text));
  await frame.locator('[data-close-surface="true"]').last().click().catch(() => {});

  return Object.assign({ label, expiryColumns }, payloadCheck);
}

async function verifyAsset(frame, label) {
  await switchTab(frame, "asset");
  await frame.locator("#asset-selector").waitFor({ state: "attached", timeout: 90000 });
  await frame.waitForFunction(() => document.querySelectorAll(".stack-chip").length > 0, null, { timeout: 90000 });
  return await frame.evaluate((pageLabel) => {
    const chips = Array.from(document.querySelectorAll(".stack-chip"));
    const text = chips.map((chip) => chip.innerText || "").join("\n");
    const classes = chips.flatMap((chip) => Array.from(chip.classList)).filter((name) => name.indexOf("stack-temp-") === 0);
    return {
      label: pageLabel,
      chipCount: chips.length,
      hasSqmAndPy: /㎡/.test(text) && /평/.test(text),
      hasTemperatureText: ["저온", "상온", "혼합", "사무실"].some((term) => text.includes(term)),
      temperatureClasses: Array.from(new Set(classes)),
    };
  }, label);
}

async function runOne(browser, url, label) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message || String(error)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  let frame = await waitForDashboardFrame(page);
  frame = await loginAdminIfNeeded(frame);
  await waitForNoMainError(frame);
  const home = await verifyHome(frame, label);
  const asset = await verifyAsset(frame, label);
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const screenshot = path.join(OUT_DIR, `${label}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.close();
  return { label, url, home, asset, errors, screenshot };
}

(async () => {
  const executablePath = getExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const results = [];
  results.push(await runOne(browser, USER_URL, "user"));
  results.push(await runOne(browser, ADMIN_URL, "admin"));
  await browser.close();
  const outFile = path.join(OUT_DIR, "summary.json");
  await fs.promises.writeFile(outFile, JSON.stringify({ outDir: OUT_DIR, results }, null, 2), "utf8");
  console.log(JSON.stringify({ outDir: OUT_DIR, results }, null, 2));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
