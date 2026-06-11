#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {
  chromium,
  withChromiumLaunchOptions,
} = require("./playwright-runtime.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const DOCS_DIR = path.join(ROOT, "docs");
const HOST = "127.0.0.1";
const PORT = Number(process.env.QA_LOCAL_DOCS_PORT || 0);
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(ROOT, "qa-artifacts", "logistics-supplemental-ui", RUN_STAMP);
const NEW_ASSETS = [
  { id: "asset_a190002001", name: "분당야탑물류센터" },
  { id: "asset_a190013001", name: "포천정교리물류센터" },
];
const NEW_STAFF = ["오윤석", "한창형", "류지훈", "양우영"];
const REQUIRED_COMPANY_COLUMNS = [
  "assetName",
  "floorLabel",
  "detailAreaLabel",
  "leasedAreaPy",
  "averageRentPerPy",
  "averageMfPerPy",
  "monthlyRentTotal",
  "monthlyMfTotal",
  "monthlyCostTotal",
  "areaRatio",
  "monthlyCostRatio",
];

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, Object.assign({ "Cache-Control": "no-store" }, headers));
  response.end(body);
}

function resolveRequestPath(requestUrl) {
  const parsed = new URL(requestUrl || "/", "http://local.docs");
  const decoded = decodeURIComponent(parsed.pathname || "/");
  const safePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(DOCS_DIR, safePath);
  if (resolved !== DOCS_DIR && !resolved.startsWith(`${DOCS_DIR}${path.sep}`)) return null;
  return resolved;
}

function createServer() {
  return http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
      return;
    }
    const filePath = resolveRequestPath(request.url || "/");
    if (!filePath) {
      send(response, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    fs.stat(filePath, (statError, stat) => {
      const finalPath = !statError && stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
      fs.readFile(finalPath, (readError, body) => {
        if (readError) {
          send(response, 404, "Not Found", { "Content-Type": "text/plain; charset=utf-8" });
          return;
        }
        const contentType = MIME_TYPES[path.extname(finalPath).toLowerCase()] || "application/octet-stream";
        send(response, 200, request.method === "HEAD" ? "" : body, { "Content-Type": contentType });
      });
    });
  });
}

async function waitForPanel(page, tab) {
  await page.waitForFunction((tabName) => {
    const panel = document.querySelector(`[data-panel="${tabName}"]`);
    return panel && !panel.hidden && panel.dataset.renderStatus === "ready";
  }, tab, { timeout: 20000 });
}

function pushCheck(checks, id, ok, details = {}) {
  checks.push(Object.assign({ id, status: ok ? "PASS" : "FAIL" }, details));
}

function floorNumber(label) {
  const text = String(label || "").toUpperCase();
  const basement = text.match(/B\s*([0-9]+)/);
  if (basement) return -Number(basement[1]);
  const number = text.match(/-?[0-9]+/);
  return number ? Number(number[0]) : Number.NEGATIVE_INFINITY;
}

function isDefaultCompanySort(rows) {
  const expected = rows.slice().sort((left, right) => {
    const byAsset = String(left.assetName || "").localeCompare(String(right.assetName || ""), "ko-KR");
    if (byAsset) return byAsset;
    return floorNumber(right.floorLabel) - floorNumber(left.floorLabel);
  });
  return rows.every((row, index) => row.assetName === expected[index].assetName && row.floorLabel === expected[index].floorLabel);
}

function isSortedText(values, direction) {
  const sorted = values.slice().sort((left, right) => String(left).localeCompare(String(right), "ko-KR"));
  if (direction === "desc") sorted.reverse();
  return values.every((value, index) => value === sorted[index]);
}

function isAppsScriptUrl(url) {
  return /google\.script\.run|script\.google\.com\/macros|\/macros\/s\//i.test(String(url || ""));
}

async function main() {
  ensureDir(OUT_DIR);
  const checks = [];
  const consoleErrors = [];
  const pageErrors = [];
  const badRequests = [];
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });
  const address = server.address();
  const baseUrl = `http://${HOST}:${address.port}/?page=user&source=github`;

  const browser = await chromium.launch(withChromiumLaunchOptions({ headless: true }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message || String(error)));
  page.on("request", (request) => {
    if (isAppsScriptUrl(request.url())) badRequests.push(request.url());
  });

  try {
    const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    pushCheck(checks, "entry-http-200", response && response.ok(), { statusCode: response ? response.status() : null, url: page.url() });
    await page.waitForFunction(() => window.dashboardApp?.getState?.()?.options?.assets?.length > 0, null, { timeout: 20000 });
    await waitForPanel(page, "weekly");

    const optionAudit = await page.evaluate((newAssets) => {
      const state = window.dashboardApp.getState();
      return {
        assets: newAssets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          inOptions: state.options.assets.some((item) => item.assetId === asset.id && item.assetName === asset.name),
        })),
        payloadSource: state.payloadSource,
        dataSourceMode: state.dataSourceMode,
      };
    }, NEW_ASSETS);
    pushCheck(checks, "new-assets-in-selector-options", optionAudit.assets.every((asset) => asset.inOptions), optionAudit);

    const homeMapAudit = await page.evaluate(async () => {
      const app = window.dashboardApp;
      await app.switchTab("home");
      await app.refreshTab();
      const state = app.getState();
      const map = document.querySelector('[data-map-scope="home-map-detail"]');
      const table = document.querySelector('[data-table-scope="home-portfolio-map-points"]');
      const layerButtons = Array.from(document.querySelectorAll('[data-map-layer-scope="home-map-detail"]'));
      const toolButtons = Array.from(document.querySelectorAll('[data-map-tool-scope="home-map-detail"]'));
      const enabledRow = table?.querySelector('[data-map-focus-scope="home-map-detail"]:not(.is-disabled)');
      const disabledBundangRow = table?.querySelector('[data-map-focus-id="asset_a190002001"]');
      const enabledFocusId = enabledRow?.getAttribute("data-map-focus-id") || "";
      enabledRow?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      document.querySelector('[data-map-layer-scope="home-map-detail"][data-map-layer="satellite"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      document.querySelector('[data-map-tool-scope="home-map-detail"][data-map-tool="distance"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const focusedMap = document.querySelector('[data-map-scope="home-map-detail"]');
      return {
        mapExists: !!map,
        tableExists: !!table,
        layerButtonCount: layerButtons.length,
        toolButtonCount: toolButtons.length,
        focusedId: state.mapFocus?.["home-map-detail"] || "",
        enabledFocusId,
        satelliteLayer: focusedMap?.classList.contains("map-layer-satellite") || false,
        distanceStatus: focusedMap?.querySelector(".map-tool-status")?.textContent.trim() || "",
        disabledBundang: disabledBundangRow?.classList.contains("is-disabled") || false,
        disabledBundangText: disabledBundangRow?.textContent || "",
      };
    });
    await waitForPanel(page, "home");
    pushCheck(checks, "home-map-controls-visible", homeMapAudit.mapExists && homeMapAudit.tableExists && homeMapAudit.layerButtonCount === 3 && homeMapAudit.toolButtonCount >= 10, homeMapAudit);
    pushCheck(checks, "home-map-row-focus", !!homeMapAudit.enabledFocusId && homeMapAudit.focusedId === homeMapAudit.enabledFocusId, homeMapAudit);
    pushCheck(checks, "home-map-layer-and-tool-toggle", homeMapAudit.satelliteLayer && /거리|distance/i.test(homeMapAudit.distanceStatus), homeMapAudit);
    pushCheck(checks, "home-map-bundang-coordinate-disabled", homeMapAudit.disabledBundang && /좌표 재확인 필요/.test(homeMapAudit.disabledBundangText), homeMapAudit);

    for (const asset of NEW_ASSETS) {
      const audit = await page.evaluate(async (assetId) => {
        const app = window.dashboardApp;
        const state = app.getState();
        state.selections.assetId = assetId;
        const select = document.getElementById("asset-select");
        if (select) select.value = assetId;
        await app.switchTab("asset");
        await app.refreshTab();
        const panel = document.querySelector('[data-panel="asset"]');
        const labels = Array.from(panel.querySelectorAll(".kpi-label")).map((node) => node.textContent.trim());
        const payload = state.activePayload || {};
        return {
          activeAssetId: state.selections.assetId,
          payloadAssetId: payload.overview?.assetId || payload.meta?.selection?.assetId || "",
          text: panel.innerText,
          labels,
          kpiKeys: (payload.kpis || []).map((item) => item.key || item[0] || ""),
          renderStatus: panel.dataset.renderStatus,
        };
      }, asset.id);
      await waitForPanel(page, "asset");
      pushCheck(checks, `asset-render-${asset.id}`, audit.activeAssetId === asset.id && audit.payloadAssetId === asset.id && audit.text.includes(asset.name), audit);
      const rentLabelCount = audit.labels.filter((label) => label === "평당 임대료 평균").length;
      const mfLabelCount = audit.labels.filter((label) => label === "평당 관리비 평균").length;
      pushCheck(checks, `asset-kpi-per-py-${asset.id}`, rentLabelCount === 1 && mfLabelCount === 1, { labels: audit.labels, rentLabelCount, mfLabelCount });
      pushCheck(checks, `asset-kpi-no-monthly-total-${asset.id}`, !audit.labels.includes("월 임관리비 총액") && !audit.kpiKeys.includes("monthly_total_cost"), { labels: audit.labels, kpiKeys: audit.kpiKeys });
    }

    const companyAudit = await page.evaluate(async (requiredColumns) => {
      const app = window.dashboardApp;
      const state = app.getState();
      const target = state.options.companies.find((item) => item.tenantMasterName === "쿠팡(주)")
        || state.options.companies.find((item) => item.assetCount > 1)
        || state.options.companies[0];
      state.selections.tenantId = target?.tenantId || state.selections.tenantId;
      const select = document.getElementById("company-select");
      if (select) select.value = state.selections.tenantId;
      await app.switchTab("company");
      await app.refreshTab();
      const table = document.querySelector('[data-table-scope="company_assets"]');
      const exposureTable = document.querySelector('[data-table-scope="company-exposure-table"]');
      const details = table?.closest("details");
      const headers = Array.from(table?.querySelectorAll("[data-sort-key]") || []).map((node) => node.getAttribute("data-sort-key"));
      const exposureHeaders = Array.from(exposureTable?.querySelectorAll("[data-sort-key]") || []).map((node) => node.getAttribute("data-sort-key"));
      const readRows = () => Array.from(table?.querySelectorAll("tbody tr") || []).map((tr) => {
        const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim());
        return { assetName: cells[0] || "", floorLabel: cells[1] || "", detailAreaLabel: cells[2] || "" };
      });
      const rows = readRows();
      const beforeOpen = details ? details.open : false;
      if (details) details.open = false;
      const collapsed = details ? !details.open : false;
      if (details) details.open = true;
      const assetSortButton = table?.querySelector('[data-sort-key="assetName"]');
      if (assetSortButton) assetSortButton.click();
      const assetNameAscRows = readRows();
      if (assetSortButton) assetSortButton.click();
      const assetNameDescRows = readRows();
      return {
        tenantName: target?.tenantMasterName || "",
        tenantId: state.selections.tenantId,
        rowCount: rows.length,
        headers,
        exposureHeaders,
        missingColumns: requiredColumns.filter((column) => !headers.includes(column)),
        missingExposureColumns: ["averageRentPerPy", "averageMfPerPy", "areaRatio", "monthlyCostRatio"].filter((column) => !exposureHeaders.includes(column)),
        detailsTag: details?.tagName || "",
        beforeOpen,
        collapsed,
        hasSortButtons: headers.length > 0,
        rows,
        assetNameAscRows,
        assetNameDescRows,
      };
    }, REQUIRED_COMPANY_COLUMNS);
    await waitForPanel(page, "company");
    pushCheck(checks, "company-main-table-columns", companyAudit.missingColumns.length === 0, companyAudit);
    pushCheck(checks, "company-exposure-table-columns", companyAudit.missingExposureColumns.length === 0, companyAudit);
    pushCheck(checks, "company-main-table-collapsible", companyAudit.detailsTag === "DETAILS" && companyAudit.beforeOpen && companyAudit.collapsed, companyAudit);
    pushCheck(checks, "company-main-table-sortable", companyAudit.hasSortButtons && companyAudit.rowCount > 0, companyAudit);
    pushCheck(checks, "company-main-table-default-sort", companyAudit.rowCount < 2 || isDefaultCompanySort(companyAudit.rows), { rows: companyAudit.rows });
    pushCheck(checks, "company-main-table-sort-clicks", isSortedText(companyAudit.assetNameAscRows.map((row) => row.assetName), "asc") && isSortedText(companyAudit.assetNameDescRows.map((row) => row.assetName), "desc"), {
      asc: companyAudit.assetNameAscRows.map((row) => row.assetName),
      desc: companyAudit.assetNameDescRows.map((row) => row.assetName),
    });

    const raceAudit = await page.evaluate(async () => {
      const app = window.dashboardApp;
      const first = app.switchTab("asset");
      const second = app.switchTab("company");
      await Promise.allSettled([first, second]);
      const state = app.getState();
      const panel = document.querySelector('[data-panel="company"]');
      return {
        activeTab: state.activeTab,
        companyHidden: panel?.hidden,
        renderStatus: panel?.dataset.renderStatus,
        title: document.getElementById("page-title")?.textContent || "",
      };
    });
    pushCheck(checks, "tab-switch-race-final-company", raceAudit.activeTab === "company" && raceAudit.companyHidden === false && raceAudit.renderStatus === "ready", raceAudit);

    await page.click("#admin-login-button");
    await page.fill("#admin-auth-password", process.env.ADMIN_PASSWORD || "local-preview");
    await page.click("#admin-auth-submit");
    await page.waitForFunction(() => window.dashboardApp?.getState?.()?.role === "admin", null, { timeout: 15000 });
    await page.evaluate(async () => window.dashboardApp.switchTab("admin"));
    await waitForPanel(page, "admin");
    await page.waitForFunction((newStaff) => {
      const images = Array.from(document.querySelectorAll('[data-table-scope="admin-permissions"] img.staff-avatar'));
      return newStaff.every((name) => {
        const image = images.find((img) => img.getAttribute("alt") === name);
        return image && image.complete && image.naturalWidth > 0;
      });
    }, NEW_STAFF, { timeout: 10000 });
    const adminAudit = await page.evaluate((newStaff) => {
      const permissionsTable = document.querySelector('[data-table-scope="admin-permissions"]');
      const names = Array.from(permissionsTable?.querySelectorAll("tbody tr") || []).map((tr) => tr.querySelectorAll("td")[1]?.textContent.trim() || "");
      const sorted = names.slice().sort((left, right) => String(left).localeCompare(String(right), "ko-KR"));
      const images = Array.from(permissionsTable?.querySelectorAll("img.staff-avatar") || []).map((img) => ({
        alt: img.getAttribute("alt") || "",
        src: img.getAttribute("src") || "",
        complete: img.complete,
        naturalWidth: img.naturalWidth,
      }));
      const loginRows = Array.from(document.querySelectorAll('[data-table-scope="admin-login-history"] tbody tr')).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim()));
      return {
        nameCount: names.length,
        names,
        missingStaff: newStaff.filter((name) => !names.includes(name)),
        sorted: names.every((name, index) => name === sorted[index]),
        newStaffImages: images.filter((img) => newStaff.includes(img.alt)),
        loginRows,
      };
    }, NEW_STAFF);
    pushCheck(checks, "admin-permissions-name-sort", adminAudit.sorted && adminAudit.nameCount >= NEW_STAFF.length, { first: adminAudit.names.slice(0, 8), last: adminAudit.names.slice(-8) });
    pushCheck(checks, "admin-new-staff-visible", adminAudit.missingStaff.length === 0, adminAudit);
    pushCheck(checks, "admin-new-staff-photos", adminAudit.newStaffImages.length === NEW_STAFF.length && adminAudit.newStaffImages.every((img) => img.src.endsWith(".webp") && img.complete && img.naturalWidth > 0), adminAudit.newStaffImages);
    pushCheck(checks, "admin-login-history-immediate", adminAudit.loginRows.some((row) => row.includes("login") && row.some((cell) => /local_preview|supabase_edge|edge_pending/.test(cell))), { loginRows: adminAudit.loginRows.slice(0, 5) });

    pushCheck(checks, "no-apps-script-network", badRequests.length === 0, { badRequests });
    pushCheck(checks, "no-browser-page-errors", pageErrors.length === 0, { pageErrors });
    pushCheck(checks, "no-browser-console-errors", consoleErrors.length === 0, { consoleErrors });

    await page.screenshot({ path: path.join(OUT_DIR, "final-admin.png"), fullPage: false });
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }

  const failures = checks.filter((check) => check.status !== "PASS");
  const result = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    outDir: OUT_DIR,
    checks,
    failures,
  };
  fs.writeFileSync(path.join(OUT_DIR, "result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({ ok: result.ok, outDir: OUT_DIR, pass: checks.length - failures.length, fail: failures.length, failures }, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
