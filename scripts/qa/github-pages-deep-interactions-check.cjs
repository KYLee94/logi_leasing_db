#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_GITHUB_PAGES_DASHBOARD_URL,
  chromium,
  withChromiumLaunchOptions,
} = require("./playwright-runtime.cjs");
const { isIgnorableConsole } = require("./dashboard-qa-gates.cjs");

const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.resolve(
  process.env.QA_OUT_DIR ||
    path.join(ROOT, "qa-artifacts", "github-pages-deep-interactions", RUN_STAMP)
);
const HEADLESS = !/^false$/i.test(process.env.DASHBOARD_HEADLESS || "true");
const VIEWPORT = {
  width: Number(process.env.QA_VIEWPORT_WIDTH || 1440),
  height: Number(process.env.QA_VIEWPORT_HEIGHT || 980),
};
const DEFAULT_USER_URL = buildPageUrl("user", DEFAULT_GITHUB_PAGES_DASHBOARD_URL);
const TARGET_URL =
  process.env.STATIC_USER_URL ||
  process.env.QA_DEEP_INTERACTIONS_URL ||
  DEFAULT_USER_URL;
const TABS = parseCsvEnv("QA_DEEP_TABS", [
  "weekly",
  "home",
  "asset",
  "company",
  "sector",
  "tools",
  "playground",
  "quality",
]);
const STRICT_COVERAGE = /^(1|true|yes)$/i.test(process.env.QA_DEEP_STRICT_COVERAGE || "");
const TAB_READY_MAX_MS = Number(process.env.QA_DEEP_TAB_READY_MAX_MS || 30000);
const SHELL_READY_MAX_MS = Number(process.env.QA_DEEP_SHELL_READY_MAX_MS || 60000);
const REQUEST_IDLE_MS = Number(process.env.QA_DEEP_REQUEST_IDLE_MS || 250);
const DRAWER_CLOSE_METHODS = ["button", "escape", "backdrop"];

const TAB_EXPECTATIONS = {
  weekly: ["kpi", "table-row"],
  home: ["kpi", "table-row", "map-marker", "chart"],
  asset: ["kpi", "table-row", "chart", "select"],
  company: ["kpi", "table-row", "map-marker", "select", "filter"],
  sector: ["kpi", "table-row", "chart"],
  tools: ["kpi", "table-row", "chart", "filter"],
  playground: ["kpi", "table-row", "chart"],
  quality: ["kpi", "table-row"],
};

function parseCsvEnv(name, fallback) {
  const raw = process.env[name] || "";
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? values : fallback;
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
  return String(value || "artifact")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function errorText(error) {
  return error && error.message ? error.message : String(error);
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

function requestEntry(request, extra = {}) {
  return Object.assign({
    method: request.method(),
    url: request.url(),
    resourceType: request.resourceType(),
  }, extra);
}

function isWriteMethod(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "").toUpperCase());
}

function isProtectedWriteHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      /(^|\.)supabase\.co$/.test(host) ||
      /(^|\.)script\.google\.com$/.test(host) ||
      /(^|\.)googleusercontent\.com$/.test(host) ||
      /(^|\.)vercel\.app$/.test(host)
    );
  } catch (_error) {
    return /supabase|script\.google|googleusercontent|vercel/i.test(String(url || ""));
  }
}

async function findAppContext(page) {
  const deadline = Date.now() + SHELL_READY_MAX_MS;
  while (Date.now() < deadline) {
    if ((await page.locator("#app-shell, #app, [data-tab]").count().catch(() => 0)) > 0) return page;
    for (const frame of page.frames()) {
      if ((await frame.locator("#app-shell, #app, [data-tab]").count().catch(() => 0)) > 0) return frame;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("GitHub Pages dashboard shell was not found.");
}

async function waitForShellReady(context) {
  await context.waitForFunction(() => {
    const shell = document.querySelector("#app-shell, #app");
    if (!shell || shell.hidden) return false;
    return !!window.dashboardApp?.getState || !!document.querySelector(".tab-panel.is-active");
  }, null, { timeout: SHELL_READY_MAX_MS });
}

async function switchTab(context, tab) {
  await context.waitForFunction(() => !!window.dashboardApp?.switchTab || !!document.querySelector("[data-tab]"), null, {
    timeout: SHELL_READY_MAX_MS,
  });
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
    const panel = document.querySelector(`.tab-panel[data-panel="${target}"]`);
    const state = window.dashboardApp?.getState?.() || {};
    const activeTab = state.activeTab || document.querySelector(".tab-panel.is-active")?.getAttribute("data-panel") || "";
    return !!panel && !panel.hidden && activeTab === target && panel.dataset.renderStatus === "ready";
  }, tab, { timeout: TAB_READY_MAX_MS });
  await context.waitForTimeout(REQUEST_IDLE_MS);
}

async function elementMetrics(context, tab) {
  return context.evaluate((target) => {
    const panel = document.querySelector(`.tab-panel[data-panel="${target}"]`);
    const isVisible = (node) => {
      if (!node || node.hidden) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const visibleCount = (selector, root = panel) => Array.from(root?.querySelectorAll(selector) || []).filter(isVisible).length;
    return {
      tab: target,
      renderStatus: panel?.dataset?.renderStatus || "",
      textLength: (panel?.innerText || "").trim().length,
      kpiCount: visibleCount(".kpi-button[data-detail-key], .kpi[data-detail-key]"),
      tableRowCount: visibleCount(".table-wrap tbody tr[data-detail-key]"),
      rowActionCount: visibleCount(".table-wrap tbody .row-action[data-detail-key]"),
      mapMarkerCount: visibleCount(".map-marker[data-detail-key]"),
      chartActionCount: visibleCount(".bar-row[data-detail-key]"),
      filterCount: visibleCount("[data-search-scope]"),
      visibleAssetSelect: isVisible(document.getElementById("asset-select")),
      visibleCompanySelect: isVisible(document.getElementById("company-select")),
      selectedAsset: document.getElementById("asset-select")?.value || "",
      selectedCompany: document.getElementById("company-select")?.value || "",
      assetOptionCount: document.getElementById("asset-select")?.options?.length || 0,
      companyOptionCount: document.getElementById("company-select")?.options?.length || 0,
    };
  }, tab);
}

async function expectDrawerOpen(context) {
  await context.waitForFunction(() => {
    const backdrop = document.getElementById("drawer-backdrop");
    const title = document.querySelector("#drawer-content h2");
    const content = document.getElementById("drawer-content");
    return !!backdrop && !backdrop.hidden && !!title?.textContent?.trim() && (content?.innerText || "").trim().length > 0;
  }, null, { timeout: 5000 });
  return context.evaluate(() => ({
    title: document.querySelector("#drawer-content h2")?.textContent?.trim() || "",
    textLength: (document.getElementById("drawer-content")?.innerText || "").trim().length,
  }));
}

async function expectDrawerClosed(context) {
  await context.waitForFunction(() => {
    const backdrop = document.getElementById("drawer-backdrop");
    return !backdrop || backdrop.hidden;
  }, null, { timeout: 5000 });
}

async function closeDrawer(page, context, method) {
  if (method === "escape") {
    await page.keyboard.press("Escape");
  } else if (method === "backdrop") {
    await context.locator("#drawer-backdrop").click({ position: { x: 5, y: 5 } });
  } else {
    await context.locator("#drawer-close").click();
  }
  await expectDrawerClosed(context);
}

async function clickAndVerifyDrawer(page, context, tab, name, selector, closeMethod) {
  const panel = context.locator(`.tab-panel[data-panel="${tab}"]`);
  const matches = panel.locator(selector);
  const locator = matches.first();
  const count = await matches.count();
  if (!count) {
    return { name, status: "skipped", reason: "selector-not-found", selector };
  }

  await locator.scrollIntoViewIfNeeded();
  await locator.click({ timeout: 5000 });
  const drawer = await expectDrawerOpen(context);
  await closeDrawer(page, context, closeMethod);
  return {
    name,
    status: "passed",
    selector,
    closeMethod,
    drawerTitle: drawer.title,
    drawerTextLength: drawer.textLength,
  };
}

async function exerciseFilter(context, tab) {
  const filter = context.locator(`.tab-panel[data-panel="${tab}"] [data-search-scope]`).first();
  if (!(await filter.count())) {
    return { name: "filter", status: "skipped", reason: "filter-not-found" };
  }

  const before = await context.evaluate((target) => {
    const input = document.querySelector(`.tab-panel[data-panel="${target}"] [data-search-scope]`);
    const scope = input?.dataset?.searchScope || "";
    const table = Array.from(document.querySelectorAll("[data-table-scope]")).find((node) => node.dataset.tableScope === scope);
    const rows = Array.from(table?.querySelectorAll("tbody tr") || []);
    return {
      scope,
      totalRows: rows.length,
      hiddenRows: rows.filter((row) => row.hidden).length,
      firstCellText: rows[0]?.innerText?.trim() || "",
    };
  }, tab);

  const query = before.firstCellText.split(/\s+/).find((item) => item.length >= 2) || "zz-no-match";
  await filter.fill(query);
  await context.waitForTimeout(150);
  const afterQuery = await context.evaluate((target) => {
    const input = document.querySelector(`.tab-panel[data-panel="${target}"] [data-search-scope]`);
    const scope = input?.dataset?.searchScope || "";
    const table = Array.from(document.querySelectorAll("[data-table-scope]")).find((node) => node.dataset.tableScope === scope);
    const rows = Array.from(table?.querySelectorAll("tbody tr") || []);
    return {
      value: input?.value || "",
      totalRows: rows.length,
      hiddenRows: rows.filter((row) => row.hidden).length,
      visibleRows: rows.filter((row) => !row.hidden).length,
    };
  }, tab);

  await filter.fill("zz-no-match-qa");
  await context.waitForTimeout(150);
  const afterNoMatch = await context.evaluate((target) => {
    const input = document.querySelector(`.tab-panel[data-panel="${target}"] [data-search-scope]`);
    const scope = input?.dataset?.searchScope || "";
    const table = Array.from(document.querySelectorAll("[data-table-scope]")).find((node) => node.dataset.tableScope === scope);
    const rows = Array.from(table?.querySelectorAll("tbody tr") || []);
    return {
      value: input?.value || "",
      totalRows: rows.length,
      hiddenRows: rows.filter((row) => row.hidden).length,
      visibleRows: rows.filter((row) => !row.hidden).length,
    };
  }, tab);

  await filter.fill("");
  await context.waitForTimeout(150);
  const afterClear = await context.evaluate((target) => {
    const input = document.querySelector(`.tab-panel[data-panel="${target}"] [data-search-scope]`);
    const scope = input?.dataset?.searchScope || "";
    const table = Array.from(document.querySelectorAll("[data-table-scope]")).find((node) => node.dataset.tableScope === scope);
    const rows = Array.from(table?.querySelectorAll("tbody tr") || []);
    return {
      value: input?.value || "",
      totalRows: rows.length,
      hiddenRows: rows.filter((row) => row.hidden).length,
      visibleRows: rows.filter((row) => !row.hidden).length,
    };
  }, tab);

  const failures = [];
  if (!before.totalRows) failures.push("filter-table-has-no-rows");
  if (afterQuery.value !== query) failures.push("query-value-not-applied");
  if (afterNoMatch.visibleRows !== 0 && before.totalRows > 0) failures.push("no-match-query-did-not-hide-all-rows");
  if (afterClear.hiddenRows !== 0) failures.push("clear-did-not-restore-all-rows");

  return {
    name: "filter",
    status: failures.length ? "failed" : "passed",
    failures,
    query,
    before,
    afterQuery,
    afterNoMatch,
    afterClear,
  };
}

async function exerciseSelect(context, tab) {
  const selectId = tab === "asset" ? "asset-select" : tab === "company" ? "company-select" : "";
  if (!selectId) return { name: "select", status: "skipped", reason: "not-select-tab" };

  const select = context.locator(`#${selectId}`);
  if (!(await select.count())) return { name: "select", status: "failed", reason: "select-not-found", selectId };

  const visible = await select.evaluate((node) => {
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return !node.hidden && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  });
  if (!visible) return { name: "select", status: "failed", reason: "select-not-visible", selectId };

  const options = await select.evaluate((node) => Array.from(node.options || []).map((option) => option.value).filter(Boolean));
  const beforeValue = await select.inputValue();
  if (options.length < 2) {
    return { name: "select", status: "skipped", reason: "not-enough-options", selectId, optionCount: options.length, beforeValue };
  }

  const nextValue = options.find((value) => value !== beforeValue) || options[0];
  await select.selectOption(nextValue);
  await waitForTabReady(context, tab);
  const afterValue = await select.inputValue();
  const panelState = await elementMetrics(context, tab);
  const restoredValue = beforeValue && beforeValue !== afterValue ? beforeValue : "";
  if (restoredValue) {
    await select.selectOption(restoredValue);
    await waitForTabReady(context, tab);
  }

  return {
    name: "select",
    status: afterValue === nextValue ? "passed" : "failed",
    selectId,
    optionCount: options.length,
    beforeValue,
    nextValue,
    afterValue,
    restoredValue,
    panelState,
  };
}

async function exerciseTab(page, context, tab, closeIndex) {
  await switchTab(context, tab);
  const before = await elementMetrics(context, tab);
  const interactions = [];
  const closeMethod = () => DRAWER_CLOSE_METHODS[closeIndex.count++ % DRAWER_CLOSE_METHODS.length];

  interactions.push(await clickAndVerifyDrawer(
    page,
    context,
    tab,
    "kpi",
    ".kpi-button[data-detail-key], .kpi[data-detail-key]",
    closeMethod()
  ));
  interactions.push(await clickAndVerifyDrawer(
    page,
    context,
    tab,
    "table-row",
    ".table-wrap tbody tr[data-detail-key]",
    closeMethod()
  ));
  interactions.push(await clickAndVerifyDrawer(
    page,
    context,
    tab,
    "map-marker",
    ".map-marker[data-detail-key]",
    closeMethod()
  ));
  interactions.push(await clickAndVerifyDrawer(
    page,
    context,
    tab,
    "chart",
    ".bar-row[data-detail-key]",
    closeMethod()
  ));
  interactions.push(await exerciseFilter(context, tab));
  interactions.push(await exerciseSelect(context, tab));

  const after = await elementMetrics(context, tab);
  const screenshot = `${safeFile(tab)}-deep-interactions.png`;
  await page.screenshot({ path: path.join(OUT_DIR, screenshot), fullPage: true });

  return {
    tab,
    before,
    interactions,
    after,
    screenshot,
  };
}

function buildAssessment(results) {
  const failures = [];
  const coverageGaps = [];

  if (results.navigationStatus !== 200) {
    failures.push({
      scope: "entry",
      type: "navigation-status",
      expected: 200,
      actual: results.navigationStatus,
      url: results.targetUrl,
    });
  }

  results.consoleErrors.forEach((entry) => failures.push({ scope: "runtime", type: "console-error", entry }));
  results.pageErrors.forEach((entry) => failures.push({ scope: "runtime", type: "page-error", entry }));
  results.httpProblems.forEach((entry) => failures.push({ scope: "network", type: "http-problem", entry }));
  results.requestFailures.forEach((entry) => failures.push({ scope: "network", type: "request-failure", entry }));
  results.writeRequests.forEach((entry) => failures.push({ scope: "network", type: "write-request-detected", entry }));

  for (const tabResult of results.tabs) {
    const expected = TAB_EXPECTATIONS[tabResult.tab] || [];
    if (tabResult.error) {
      failures.push({ scope: tabResult.tab, type: "tab-exercise-error", message: tabResult.error, screenshot: tabResult.screenshot });
      continue;
    }
    if (tabResult.before.renderStatus !== "ready") {
      failures.push({ scope: tabResult.tab, type: "tab-not-ready", renderStatus: tabResult.before.renderStatus });
    }
    if (tabResult.before.textLength < 20) {
      failures.push({ scope: tabResult.tab, type: "tab-content-too-short", textLength: tabResult.before.textLength });
    }

    const byName = new Map(tabResult.interactions.map((item) => [item.name, item]));
    for (const name of expected) {
      const result = byName.get(name);
      if (!result || result.status !== "passed") {
        const gap = {
          scope: tabResult.tab,
          type: "expected-interaction-not-available",
          interaction: name,
          result: result || null,
        };
        coverageGaps.push(gap);
        if (STRICT_COVERAGE) failures.push(Object.assign({}, gap, { type: "strict-coverage-missing" }));
      }
    }
    for (const item of tabResult.interactions) {
      if (item.status === "failed") {
        const isDataCoverageGap = item.name === "filter" && item.failures?.length === 1 && item.failures[0] === "filter-table-has-no-rows";
        if (isDataCoverageGap) {
          coverageGaps.push({ scope: tabResult.tab, type: "filter-target-table-empty", interaction: item.name, result: item });
        } else {
          failures.push({ scope: tabResult.tab, type: "interaction-failed", interaction: item.name, result: item });
        }
      }
    }
  }

  return { failures, coverageGaps };
}

async function main() {
  ensureDir(OUT_DIR);
  const browser = await chromium.launch(withChromiumLaunchOptions({ headless: HEADLESS }));
  const page = await browser.newPage({ viewport: VIEWPORT });
  const results = {
    generatedAt: new Date().toISOString(),
    targetUrl: TARGET_URL,
    outDir: OUT_DIR,
    headless: HEADLESS,
    viewport: VIEWPORT,
    navigationStatus: null,
    finalUrl: "",
    tabs: [],
    consoleErrors: [],
    pageErrors: [],
    httpProblems: [],
    requestFailures: [],
    writeRequests: [],
    failures: [],
    coverageGaps: [],
    summary: {},
  };

  page.on("console", (message) => {
    const entry = consoleEntry(message);
    if (entry.type === "error" && !isIgnorableConsole(entry)) results.consoleErrors.push(entry);
  });
  page.on("pageerror", (error) => {
    results.pageErrors.push({ text: errorText(error) });
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400) {
      results.httpProblems.push({ status, url: response.url() });
    }
  });
  page.on("request", (request) => {
    const method = request.method();
    if (isWriteMethod(method) || (isProtectedWriteHost(request.url()) && isWriteMethod(method))) {
      results.writeRequests.push(requestEntry(request));
    }
  });
  page.on("requestfailed", (request) => {
    results.requestFailures.push(requestEntry(request, { failure: request.failure()?.errorText || "" }));
  });

  try {
    const response = await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    results.navigationStatus = response ? response.status() : null;
    results.finalUrl = page.url();

    const context = await findAppContext(page);
    await waitForShellReady(context);
    await page.screenshot({ path: path.join(OUT_DIR, "entry.png"), fullPage: false });

    const closeIndex = { count: 0 };
    for (const tab of TABS) {
      try {
        results.tabs.push(await exerciseTab(page, context, tab, closeIndex));
      } catch (error) {
        const screenshot = `${safeFile(tab)}-failed.png`;
        await page.screenshot({ path: path.join(OUT_DIR, screenshot), fullPage: false }).catch(() => {});
        results.tabs.push({
          tab,
          error: errorText(error),
          screenshot,
          before: {},
          interactions: [],
          after: {},
        });
      }
    }
  } finally {
    await browser.close();
  }

  const assessment = buildAssessment(results);
  results.failures = assessment.failures;
  results.coverageGaps = assessment.coverageGaps;
  results.summary = {
    tabCount: results.tabs.length,
    passedInteractionCount: results.tabs.reduce((sum, tab) => sum + tab.interactions.filter((item) => item.status === "passed").length, 0),
    skippedInteractionCount: results.tabs.reduce((sum, tab) => sum + tab.interactions.filter((item) => item.status === "skipped").length, 0),
    failedInteractionCount: results.tabs.reduce((sum, tab) => sum + tab.interactions.filter((item) => item.status === "failed").length, 0),
    consoleErrorCount: results.consoleErrors.length + results.pageErrors.length,
    httpProblemCount: results.httpProblems.length + results.requestFailures.length,
    writeRequestCount: results.writeRequests.length,
    coverageGapCount: results.coverageGaps.length,
    strictCoverage: STRICT_COVERAGE,
    failureCount: results.failures.length,
  };

  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(JSON.stringify({
    outDir: OUT_DIR,
    targetUrl: TARGET_URL,
    finalUrl: results.finalUrl,
    summary: results.summary,
    failures: results.failures,
    coverageGaps: results.coverageGaps,
  }, null, 2));

  if (results.failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
