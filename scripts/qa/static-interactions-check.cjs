#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, withChromiumLaunchOptions } = require('./playwright-runtime.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const HOST = '127.0.0.1';
const TABS = ['weekly', 'home', 'asset', 'company', 'sector', 'tools', 'playground', 'quality'];

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, Object.assign({ 'Cache-Control': 'no-store' }, headers));
  response.end(body);
}

function createServer() {
  return http.createServer((request, response) => {
    const urlPath = decodeURIComponent((request.url || '/').split('?')[0]);
    const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.resolve(DOCS_DIR, relative);
    if (filePath !== DOCS_DIR && !filePath.startsWith(`${DOCS_DIR}${path.sep}`)) {
      send(response, 403, 'Forbidden');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        send(response, 404, 'Not Found');
        return;
      }
      send(response, 200, body, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    });
  });
}

async function waitForTab(page, tab) {
  await page.locator(`[data-tab="${tab}"]`).click();
  await page.waitForFunction((target) => {
    const panel = document.querySelector(`.tab-panel[data-panel="${target}"]`);
    return panel && !panel.hidden && panel.dataset.renderStatus === 'ready';
  }, tab, { timeout: 30000 });
}

async function main() {
  const outDir = path.join(ROOT, 'qa-artifacts', 'static-interactions', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(outDir, { recursive: true });

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const baseUrl = `http://${HOST}:${server.address().port}/`;
  const browser = await chromium.launch(withChromiumLaunchOptions({ headless: true }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const failures = [];
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!window.dashboardApp?.getState, null, { timeout: 30000 });

    for (const tab of TABS) {
      await waitForTab(page, tab);
      const panel = page.locator(`.tab-panel[data-panel="${tab}"]`);
      const detailCount = await panel.locator('[data-detail-key]').count();
      if (!detailCount) failures.push({ tab, type: 'missing-detail-actions' });
      else {
        await panel.locator('[data-detail-key]').first().click();
        const drawerVisible = await page.locator('#drawer-backdrop:not([hidden])').count();
        const title = drawerVisible ? await page.locator('#drawer-content h2').first().textContent().catch(() => '') : '';
        if (!drawerVisible || !title) failures.push({ tab, type: 'drawer-not-opened' });
        await page.locator('#drawer-close').click().catch(() => {});
      }

      const search = panel.locator('[data-search-scope]').first();
      if (await search.count()) {
        await search.fill('a');
        await page.waitForTimeout(100);
        await search.fill('');
      }
      await page.screenshot({ path: path.join(outDir, `${tab}.png`), fullPage: true });
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const summary = {
    ok: failures.length === 0 && consoleErrors.length === 0,
    baseUrl,
    outDir,
    tabCount: TABS.length,
    failures,
    consoleErrors,
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
