#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium, withChromiumLaunchOptions } = require("./playwright-runtime.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const DOCS_DIR = path.join(ROOT, "docs");
const OUT_ROOT = path.join(ROOT, "qa-artifacts", "parity-smoke");
const TABS = ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality"];
const LEGACY_WEEKLY_SELECTORS = [
  ".summary-strip, .weekly-kpi-strip, [data-action^=\"weekly-summary-\"]",
  ".weekly-priority-panel, #weekly-priority-table",
  ".weekly-maturity-panel, #weekly-maturity-chart",
  ".weekly-main-table-panel, #weekly-assets-table",
  ".weekly-issue-grid",
  "#weekly-new-project-detail",
  "#weekly-management-project-detail",
];
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
};

function startServer() {
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent((request.url || "/").split("?")[0]);
    const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = path.resolve(DOCS_DIR, relative);
    if (filePath !== DOCS_DIR && !filePath.startsWith(`${DOCS_DIR}${path.sep}`)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        response.end("Not Found");
        return;
      }
      response.writeHead(200, {
        "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

async function clickAndCloseDrawer(page, locator, index) {
  await locator.nth(index).click({ timeout: 1500 });
  const drawer = page.locator("#drawer-backdrop:not([hidden])");
  await drawer.waitFor({ state: "visible", timeout: 1500 });
  const title = (await page.locator("#drawer-content h2").first().textContent({ timeout: 1500 })).trim();
  const surfaceKind = await page.locator(".drawer").first().getAttribute("data-surface-kind").catch(() => "");
  await page.keyboard.press("Escape");
  return { title, surfaceKind };
}

async function main() {
  const outDir = path.join(OUT_ROOT, new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(outDir, { recursive: true });
  const { server, url } = await startServer();
  const browser = await chromium.launch(withChromiumLaunchOptions({ headless: true }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const consoleErrors = [];
  const httpErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() });
  });

  const results = [];
  try {
    await page.goto(`${url}?source=github`, { waitUntil: "networkidle" });
    for (const tab of TABS) {
      await page.locator(`[data-tab="${tab}"]`).first().click();
      await page.locator(`#${tab}-view:not([hidden])`).waitFor({ timeout: 8000 });
      await page.waitForTimeout(150);
      const panel = page.locator(`#${tab}-view`);
      const sectionCount = await panel.locator(".section-card, .iota-section-card, section").count();
      const detailLocator = panel.locator("[data-detail-key]");
      const detailCount = await detailLocator.count();
      const legacySelectorChecks = [];
      const surfaceChecks = [];
      if (tab === "weekly") {
        for (const selector of LEGACY_WEEKLY_SELECTORS) {
          legacySelectorChecks.push({
            selector,
            found: await panel.locator(selector).count() > 0,
          });
        }
      }
      if (tab === "home") {
        const targets = [
          ['[data-testid="action-home-map-detail"]', "map-modal"],
          ['[data-testid="action-home-rent-detail"]', "chart-modal"],
          ['[data-testid="action-home-kpi-assets"]', "metric-modal"],
          ['[data-table-scope="home_tenants"] [data-detail-key]', "tenant-panel"],
          ['[data-table-scope="home-vacancy-table"] [data-detail-key]', "asset-panel"],
          ['[data-map-scope="home-map-detail"] .map-marker', "map-modal"],
        ];
        for (const [selector, expected] of targets) {
          const locator = panel.locator(selector).first();
          if (await locator.count()) {
            const result = await clickAndCloseDrawer(page, locator, 0);
            surfaceChecks.push({ selector, expected, actual: result.surfaceKind || "", ok: result.surfaceKind === expected });
          } else {
            surfaceChecks.push({ selector, expected, actual: "", ok: false });
          }
        }
      }
      if (tab === "asset") {
        const targets = [
          ['[data-table-scope="asset-roster-table"] [data-detail-key]', "tenant-panel"],
          ['[data-testid="action-asset-map-detail"]', "map-modal"],
          ['[data-testid="action-asset-expiry-detail"]', "chart-modal"],
        ];
        for (const [selector, expected] of targets) {
          const locator = panel.locator(selector).first();
          if (await locator.count()) {
            const result = await clickAndCloseDrawer(page, locator, 0);
            surfaceChecks.push({ selector, expected, actual: result.surfaceKind || "", ok: result.surfaceKind === expected });
          } else {
            surfaceChecks.push({ selector, expected, actual: "", ok: false });
          }
        }
      }
      if (tab === "company") {
        const targets = [
          ['[data-table-scope="company-assets-table"] [data-detail-key]', "asset-panel"],
          ['[data-testid="action-company-map-detail"]', "map-modal"],
          ['[data-testid="action-company-exposure-detail"]', "chart-modal"],
        ];
        for (const [selector, expected] of targets) {
          const locator = panel.locator(selector).first();
          if (await locator.count()) {
            const result = await clickAndCloseDrawer(page, locator, 0);
            surfaceChecks.push({ selector, expected, actual: result.surfaceKind || "", ok: result.surfaceKind === expected });
          } else {
            surfaceChecks.push({ selector, expected, actual: "", ok: false });
          }
        }
      }
      if (tab === "sector") {
        const targets = [
          ['[data-table-scope="sector-assets-table"] [data-detail-key]', "asset-panel"],
          ['[data-table-scope="sector-tenants-table"] [data-detail-key]', "tenant-panel"],
          ['[data-testid="action-sector-expiry"]', "chart-modal"],
        ];
        for (const [selector, expected] of targets) {
          const locator = panel.locator(selector).first();
          if (await locator.count()) {
            const result = await clickAndCloseDrawer(page, locator, 0);
            surfaceChecks.push({ selector, expected, actual: result.surfaceKind || "", ok: result.surfaceKind === expected });
          } else {
            surfaceChecks.push({ selector, expected, actual: "", ok: false });
          }
        }
      }
      if (tab === "tools") {
        const targets = [
          ['#tools-apply-button', "metric-modal"],
          ['[data-testid="action-tools-benchmark-detail"]', "chart-modal"],
          ['[data-table-scope="tools-selected-assets-table"] [data-detail-key]', "asset-panel"],
          ['[data-table-scope="tools-selected-companies-table"] [data-detail-key]', "tenant-panel"],
        ];
        for (const [selector, expected] of targets) {
          const locator = panel.locator(selector).first();
          if (await locator.count()) {
            const result = await clickAndCloseDrawer(page, locator, 0);
            surfaceChecks.push({ selector, expected, actual: result.surfaceKind || "", ok: result.surfaceKind === expected });
          } else {
            surfaceChecks.push({ selector, expected, actual: "", ok: false });
          }
        }
      }
      if (tab === "playground") {
        const targets = [
          ['#playground-apply-button', "chart-modal"],
          ['[data-testid="action-playground-chart-detail"]', "chart-modal"],
          ['[data-testid="action-playground-detail"]', "chart-modal"],
          ['[data-table-scope="playground-results-table"] [data-detail-key]', "chart-modal"],
        ];
        for (const [selector, expected] of targets) {
          const locator = panel.locator(selector).first();
          if (await locator.count()) {
            const result = await clickAndCloseDrawer(page, locator, 0);
            surfaceChecks.push({ selector, expected, actual: result.surfaceKind || "", ok: result.surfaceKind === expected });
          } else {
            surfaceChecks.push({ selector, expected, actual: "", ok: false });
          }
        }
      }
      if (tab === "quality") {
        const targets = [
          ['[data-testid="action-quality-refresh"]', "quality-panel"],
          ['[data-testid="action-quality-critical"]', "quality-panel"],
          ['[data-testid="action-quality-edit-queue"]', "quality-panel"],
          ['[data-table-scope="quality-all-results"] [data-detail-key]', "quality-panel"],
        ];
        for (const [selector, expected] of targets) {
          const locator = panel.locator(selector).first();
          if (await locator.count()) {
            const result = await clickAndCloseDrawer(page, locator, 0);
            surfaceChecks.push({ selector, expected, actual: result.surfaceKind || "", ok: result.surfaceKind === expected });
          } else {
            surfaceChecks.push({ selector, expected, actual: "", ok: false });
          }
        }
      }
      const opened = [];
      for (let index = 0; index < Math.min(3, detailCount); index += 1) {
        try {
          opened.push(await clickAndCloseDrawer(page, detailLocator, index));
        } catch (error) {
          opened.push({ title: `ERROR:${error.message}`, surfaceKind: "" });
        }
      }
      const text = await panel.textContent();
      await panel.screenshot({ path: path.join(outDir, `${tab}.png`) });
      results.push({
        tab,
        sectionCount,
        detailCount,
        legacySelectorChecks,
        surfaceChecks,
        opened,
        badText: /\[object Object\]|undefined|NaN/.test(text || ""),
      });
    }

    await page.locator("#admin-login-button").click();
    await page.locator("#admin-auth-password").fill("preview-only");
    await page.locator("#admin-auth-submit").click();
    await page.locator('[data-tab="admin"]').waitFor({ timeout: 5000 });
    await page.locator('[data-tab="admin"]').click();
    await page.locator("#admin-view:not([hidden])").waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(outDir, "admin-unified.png"), fullPage: true });
    const role = (await page.locator("#role-label").textContent()).trim();
    const summary = {
      url,
      outDir,
      results,
      role,
      adminVisible: await page.locator('[data-tab="admin"]').isVisible(),
      consoleErrors,
      httpErrors,
      failures: results.flatMap((item) => item.opened.filter((entry) => entry.title.startsWith("ERROR:")).map((entry) => ({ tab: item.tab, error: entry.title }))),
    };
    summary.failures.push(...results.flatMap((item) => (item.legacySelectorChecks || [])
      .filter((check) => !check.found)
      .map((check) => ({ tab: item.tab, error: `MISSING_LEGACY_SELECTOR:${check.selector}` }))));
    summary.failures.push(...results.flatMap((item) => (item.surfaceChecks || [])
      .filter((check) => !check.ok)
      .map((check) => ({ tab: item.tab, error: `SURFACE_KIND:${check.selector}:${check.actual || "missing"}!=${check.expected}` }))));
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
    if (summary.consoleErrors.length || summary.httpErrors.length || summary.failures.length || results.some((item) => item.badText || item.sectionCount === 0 || item.detailCount === 0)) {
      console.error(JSON.stringify(summary, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(summary, null, 2));
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
