const { buildDashboardPageUrl, chromium } = require("./playwright-runtime.cjs");

async function findDashboardFrame(page) {
  for (const frame of page.frames()) {
    try {
      if ((await frame.locator("#app-shell").count()) > 0) return frame;
    } catch (error) {
      // Ignore transient cross-origin frames.
    }
  }
  return page;
}

async function waitForFrame(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const frame = await findDashboardFrame(page);
    if ((await frame.locator("#app-shell").count()) > 0) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error("Dashboard frame was not found.");
}

async function unlockAdminIfNeeded(frame) {
  const password = process.env.ADMIN_PASSWORD || "";
  const gate = frame.locator("#admin-auth-password, #admin-password-input").first();
  if (!(await gate.count())) return;
  if (!password) throw new Error("Admin password is required. Set ADMIN_PASSWORD.");
  await gate.fill(password);
  const button = frame.locator("#admin-auth-submit, #admin-password-submit").first();
  await button.click();
  await frame.locator("#admin-auth-password, #admin-password-input").first().waitFor({ state: "detached", timeout: 45000 }).catch(() => {});
}

async function tabClick(frame, tab) {
  await frame.locator(`[data-tab="${tab}"]`).click();
  await frame.waitForTimeout(250);
}

async function waitNoLoading(frame, selector, timeout = 45000) {
  await frame.locator(selector).waitFor({ state: "attached", timeout });
  await frame.waitForFunction(
    () => !(document.body.innerText || "").includes("오류가 발생했습니다."),
    null,
    { timeout: 1000 }
  ).catch(() => {});
}

async function checkPlayground(frame) {
  const startedAt = Date.now();
  await tabClick(frame, "playground");
  await waitNoLoading(frame, "#playground-apply-button");
  const defaultRows = await frame.locator("#playground-result-table tbody tr, [data-playground-row]").count();
  const filterDimension = frame.locator("#playground-filter-dimension");
  const filterValue = frame.locator("#playground-filter-value");
  if ((await filterDimension.count()) > 0) {
    const options = await filterDimension.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
    if (options.length) {
      await filterDimension.selectOption(options[0]);
      await frame.waitForTimeout(250);
      const values = await filterValue.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
      if (values.length) await filterValue.selectOption(values[0]);
    }
  }
  const metric = frame.locator("#playground-metric");
  if ((await metric.count()) > 0) {
    const metrics = await metric.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
    const nextMetric = metrics.find((value) => value !== (process.env.DEFAULT_PLAYGROUND_METRIC || "leasedAreaSqm"));
    if (nextMetric) await metric.selectOption(nextMetric);
  }
  await frame.locator("#playground-apply-button").click();
  await waitNoLoading(frame, "#playground-apply-button");
  const text = await frame.locator("body").innerText();
  return {
    durationMs: Date.now() - startedAt,
    defaultRows,
    hasError: text.includes("오류가 발생했습니다."),
    hasPreparingOnly: text.includes("데이터 분석 화면을 준비하고 있습니다.") && defaultRows === 0,
  };
}

async function checkTools(frame) {
  const startedAt = Date.now();
  await tabClick(frame, "tools");
  await waitNoLoading(frame, "#tools-apply-button");
  const assetSelect = frame.locator("#tools-asset-quick-select");
  const companySelect = frame.locator("#tools-company-quick-select");
  const assetCheckboxes = await frame.locator("[data-tools-asset]").count();
  const companyCheckboxes = await frame.locator("[data-tools-company]").count();
  if (!(await assetSelect.count()) || !(await companySelect.count())) {
    throw new Error("Tools quick select dropdowns were not rendered.");
  }

  const options = await assetSelect.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => node.value).filter(Boolean)
  );
  if (options.length > 3) {
    await assetSelect.selectOption(options[options.length - 1]);
  }
  await frame.locator("#tools-apply-button").click();
  await waitNoLoading(frame, "#tools-apply-button");
  const selectedAfterDropdown = await frame.locator("[data-tools-asset]:checked").count();

  await frame.locator("#tools-clear-button").click();
  await waitNoLoading(frame, "#tools-apply-button");
  const selectedAfterClear = {
    assets: await frame.locator("[data-tools-asset]:checked").count(),
    companies: await frame.locator("[data-tools-company]:checked").count(),
  };
  const text = await frame.locator("body").innerText();
  return {
    durationMs: Date.now() - startedAt,
    assetSelect: true,
    companySelect: true,
    assetCheckboxes,
    companyCheckboxes,
    selectedAfterDropdown,
    selectedAfterClear,
    hasError: text.includes("오류가 발생했습니다."),
  };
}

async function checkPage(pageName) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message || String(error)));
  const url = pageName === "admin"
    ? (process.env.ADMIN_URL || buildDashboardPageUrl("admin"))
    : pageName === "user"
      ? (process.env.USER_URL || buildDashboardPageUrl("user"))
      : buildDashboardPageUrl(pageName);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const frame = await waitForFrame(page);
  await unlockAdminIfNeeded(frame);
  const playground = await checkPlayground(frame);
  const tools = await checkTools(frame);
  await page.screenshot({ path: `qa-artifacts/perf/${pageName}-playground-tools-v177.png`, fullPage: true });
  await browser.close();
  return { pageName, playground, tools, errors };
}

async function main() {
  const pages = (process.env.CHECK_PAGES || "user,admin").split(",").map((value) => value.trim()).filter(Boolean);
  const results = [];
  for (const pageName of pages) {
    results.push(await checkPage(pageName));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
