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

async function switchEntity(frame, tabName, selector) {
  await frame.locator(`[data-tab="${tabName}"]`).click();
  await frame.locator(selector).waitFor({ state: "attached", timeout: 30000 });
  const options = await frame.locator(`${selector} option`).evaluateAll((nodes) =>
    nodes.map((node) => ({ value: node.value, label: node.textContent.trim() })).filter((row) => row.value)
  );
  if (options.length < 2) throw new Error(`${selector} needs at least two options.`);
  const target = options[1];
  await frame.locator(selector).selectOption(target.value);
  await frame.waitForFunction(
    ({ selector, value, label }) => {
      const select = document.querySelector(selector);
      if (!select || select.value !== value) return false;
      const text = document.body.innerText || "";
      return text.indexOf(label) !== -1 && !text.includes("오류가 발생했습니다");
    },
    { selector, value: target.value, label: target.label },
    { timeout: 45000 }
  );
  return {
    selector,
    selectedValue: await frame.locator(selector).inputValue(),
    selectedLabel: target.label,
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
  const asset = await switchEntity(frame, "asset", "#asset-selector");
  const company = await switchEntity(frame, "company", "#company-selector");
  await browser.close();
  console.log(JSON.stringify({ asset, company, errors }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
