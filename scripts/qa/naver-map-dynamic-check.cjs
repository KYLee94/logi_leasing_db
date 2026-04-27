const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = process.env.QA_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.QA_OUTPUT_DIR)
  : path.join(ROOT, "qa-artifacts", "naver-map-dynamic-check");
const BASE_URL = process.env.DASHBOARD_BASE_URL
  || "https://script.google.com/macros/s/AKfycbx9s5xFERgXbvZPaiIswL-Dod-gN4R7nySCEYmqnDwcp2QYpwaG6EGYiNJZieY5PPK0Jg/exec?page=user";

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const consoleMessages = [];
  const requestFailures = [];
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("console", (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on("requestfailed", (request) => requestFailures.push({
    url: request.url(),
    method: request.method(),
    failure: request.failure(),
  }));

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "home-before-map-click.png"), fullPage: true });

  let frame = page.mainFrame();
  for (const candidate of page.frames()) {
    const count = await candidate.locator('[data-action="home-map-detail"]').count().catch(() => 0);
    if (count) {
      frame = candidate;
      break;
    }
  }
  const buttonCount = await frame.locator('[data-action="home-map-detail"]').count();
  if (!buttonCount) {
    await browser.close();
    throw new Error("home-map-detail button not found");
  }
  await frame.locator('[data-action="home-map-detail"]').first().click();
  await page.waitForTimeout(10000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "map-modal-after-click.png"), fullPage: true });

  const result = await frame.evaluate(() => {
    const modal = document.querySelector("#modal-host .surface-frame") || document.querySelector(".modal-card") || document.querySelector(".modal");
    const canvas = modal ? modal.querySelector("[data-portfolio-map-mount='canvas']") : null;
    const markers = modal ? modal.querySelectorAll(".portfolio-map-pin, .leaflet-marker-icon, .gm-style [role='button'], .gm-style gmp-advanced-marker, .map_marker, img[src*='marker']").length : 0;
    const naverLoaded = !!(window.naver && window.naver.maps);
    return {
      modalOpen: !!modal,
      modalTitle: (modal && modal.querySelector(".surface-title, .modal-title, h3, h2") && modal.querySelector(".surface-title, .modal-title, h3, h2").textContent || "").trim(),
      mapMode: canvas ? canvas.getAttribute("data-map-mode") : null,
      canvasText: canvas ? canvas.textContent.trim().slice(0, 500) : "",
      hasNaverObject: naverLoaded,
      hasNaverDom: !!(modal && modal.querySelector(".gm-style")),
      hasLeafletDom: !!(modal && modal.querySelector(".leaflet-container")),
      markerCount: markers,
      canvasChildCount: canvas ? canvas.children.length : 0,
      imageCount: canvas ? canvas.querySelectorAll("img").length : 0,
      imageSrcPreview: canvas ? Array.from(canvas.querySelectorAll("img")).slice(0, 10).map((img) => img.src) : [],
      imageBoxPreview: canvas ? Array.from(canvas.querySelectorAll("img")).slice(0, 5).map((img) => {
        const box = img.getBoundingClientRect();
        const style = window.getComputedStyle(img);
        return { x: box.x, y: box.y, width: box.width, height: box.height, opacity: style.opacity, display: style.display, visibility: style.visibility };
      }) : [],
      canvasHtmlPreview: canvas ? canvas.innerHTML.slice(0, 1000) : "",
      iframeOrigin: window.location.origin,
      referrer: document.referrer,
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    result,
    consoleMessages,
    requestFailures,
    screenshots: [
      path.join(OUTPUT_DIR, "home-before-map-click.png"),
      path.join(OUTPUT_DIR, "map-modal-after-click.png"),
    ],
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
