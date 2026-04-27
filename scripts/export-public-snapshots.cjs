const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const PUBLIC_APP_URL = process.env.LOGI_DASHBOARD_PUBLIC_BASE
  || "https://script.google.com/macros/s/AKfycbw-MNDdPW19QrdlKOtZ111UY037Ko3z9O9nYWsqCsXj6r8C814ZUzH6wz1UORE1jdwgNg/exec?page=user";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(targetPath, payload) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
}

async function withFrame(page) {
  await page.goto(PUBLIC_APP_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(8000);
  const frame = page.frames().find((item) => item.url().includes("/blank"));
  if (!frame) throw new Error("userHtmlFrame not found");
  return frame;
}

async function callServer(frame, functionName, payload) {
  return frame.evaluate(({ functionName, payload }) => new Promise((resolve, reject) => {
    if (!(window.google && google.script && google.script.run)) {
      reject(new Error("google.script.run unavailable"));
      return;
    }
    let runner = google.script.run
      .withSuccessHandler((result) => resolve(result))
      .withFailureHandler((error) => reject(new Error((error && error.message) || String(error))));
    if (payload === undefined) runner[functionName]();
    else runner[functionName](payload);
  }), { functionName, payload });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    const frame = await withFrame(page);
    const root = process.cwd();
    const outDir = path.join(root, "docs", "data");
    ensureDir(outDir);

    const bootstrap = await callServer(frame, "getBootstrapData");
    const home = await callServer(frame, "getHomeData");
    const assetOptions = await callServer(frame, "getAssetOptions");
    const companyOptions = await callServer(frame, "getCompanyOptions");

    writeJson(path.join(outDir, "bootstrap.json"), bootstrap);
    writeJson(path.join(outDir, "home.json"), home);
    writeJson(path.join(outDir, "asset-options.json"), assetOptions);
    writeJson(path.join(outDir, "company-options.json"), companyOptions);

    for (const asset of assetOptions || []) {
      if (!asset || !asset.assetId) continue;
      const payload = await callServer(frame, "getAssetData", asset.assetId);
      writeJson(path.join(outDir, "asset", `${asset.assetId}.json`), payload);
    }

    for (const company of companyOptions || []) {
      if (!company || !company.tenantId) continue;
      const payload = await callServer(frame, "getCompanyData", company.tenantId);
      writeJson(path.join(outDir, "company", `${company.tenantId}.json`), payload);
    }

    console.log(JSON.stringify({
      outputDir: outDir,
      assetCount: (assetOptions || []).length,
      companyCount: (companyOptions || []).length,
      appUrl: PUBLIC_APP_URL,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
