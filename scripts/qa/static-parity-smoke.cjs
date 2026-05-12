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
  await page.keyboard.press("Escape");
  return title;
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
      const opened = [];
      for (let index = 0; index < Math.min(3, detailCount); index += 1) {
        try {
          opened.push(await clickAndCloseDrawer(page, detailLocator, index));
        } catch (error) {
          opened.push(`ERROR:${error.message}`);
        }
      }
      const text = await panel.textContent();
      await panel.screenshot({ path: path.join(outDir, `${tab}.png`) });
      results.push({
        tab,
        sectionCount,
        detailCount,
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
      failures: results.flatMap((item) => item.opened.filter((title) => title.startsWith("ERROR:")).map((error) => ({ tab: item.tab, error }))),
    };
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
