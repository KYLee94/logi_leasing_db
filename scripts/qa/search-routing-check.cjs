const { chromium } = require("playwright");

const DEFAULT_URL =
  "https://script.google.com/macros/s/AKfycbx9s5xFERgXbvZPaiIswL-Dod-gN4R7nySCEYmqnDwcp2QYpwaG6EGYiNJZieY5PPK0Jg/exec?page=user";

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
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const frame = await findDashboardFrame(page);
    if ((await frame.locator("#app-shell").count()) > 0) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error("Dashboard frame was not found.");
}

async function searchAndClick(frame, query, targetType) {
  const searchInput = frame.locator("#global-search");
  await searchInput.waitFor({ state: "visible", timeout: 30000 });
  await searchInput.fill(query);
  await frame.locator("#global-search-suggestions .search-suggestion").first().waitFor({ state: "visible", timeout: 30000 });
  const target = frame
    .locator("#global-search-suggestions .search-suggestion")
    .filter({ hasText: targetType === "asset" ? "자산 보기" : "기업 보기" })
    .first();
  await target.waitFor({ state: "visible", timeout: 30000 });
  const label = (await target.locator(".search-suggestion-label").innerText()).trim();
  await target.click();
  const selector = targetType === "asset" ? "#asset-selector" : "#company-selector";
  await frame.locator(selector).waitFor({ state: "attached", timeout: 45000 });
  let matched = true;
  try {
    await frame.waitForFunction(
      ({ selector, label }) => {
        const select = document.querySelector(selector);
        const selected = select && select.options[select.selectedIndex];
        return !!selected && selected.textContent.trim() === label;
      },
      { selector, label },
      { timeout: 45000 }
    );
  } catch (error) {
    matched = false;
  }
  const selectedLabel = await frame.locator(`${selector} option:checked`).innerText().catch(() => "");
  const bodySample = await frame.locator("body").innerText().then((text) => text.slice(0, 1000)).catch(() => "");
  if (!matched) {
    throw new Error(JSON.stringify({
      type: targetType,
      query,
      clickedLabel: label,
      selectedLabel,
      selectedValue: await frame.locator(selector).inputValue().catch(() => ""),
      bodySample,
    }, null, 2));
  }
  return {
    type: targetType,
    query,
    clickedLabel: label,
    selectedLabel,
    selectedValue: await frame.locator(selector).inputValue(),
  };
}

async function main() {
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message || String(error)));
  await page.goto(process.env.DASHBOARD_BASE_URL || DEFAULT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  const frame = await waitForFrame(page);
  const company = await searchAndClick(frame, "쿠팡", "company");
  const asset = await searchAndClick(frame, "경산", "asset");
  await browser.close();
  console.log(JSON.stringify({ company, asset, errors }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
