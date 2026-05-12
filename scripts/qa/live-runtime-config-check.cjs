const fs = require("node:fs");
const path = require("node:path");
const { buildDashboardPageUrl, chromium, withChromiumLaunchOptions } = require("./playwright-runtime.cjs");
const {
  REQUIRED_PAYLOAD_SOURCE,
  buildSourceGateFailures,
  collectSourceGateSnapshot,
  isIgnorableRequestProblem,
  scanArtifactDirectoryForSecrets,
} = require("./dashboard-qa-gates.cjs");

const USER_URL =
  process.env.USER_URL ||
  buildDashboardPageUrl("user");

function safeFileStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toConsoleEntry(message) {
  const location = typeof message.location === "function" ? message.location() : {};
  return {
    source: "console",
    type: typeof message.type === "function" ? message.type() : "",
    text: typeof message.text === "function" ? message.text() : String(message || ""),
    url: location.url || "",
    lineNumber: location.lineNumber || 0,
    columnNumber: location.columnNumber || 0,
  };
}

function toPageErrorEntry(error) {
  return {
    source: "pageerror",
    type: "pageerror",
    text: error && error.message ? error.message : String(error || ""),
    url: "",
    lineNumber: 0,
    columnNumber: 0,
  };
}

function ignoredConsoleWarningReason(entry) {
  const text = String(entry.text || "");
  const haystack = `${text} ${entry.url || ""}`;
  if (
    /content security policy|\bcsp\b/i.test(text) &&
    /report[- ]only|\[report only\]/i.test(text) &&
    /script\.google|googleusercontent|userCodeAppPanel|macros\/s|apps script/i.test(haystack)
  ) {
    return "google-wrapper-report-only-csp";
  }
  return "";
}

function captureConsoleMessage(message, consoleErrors, ignoredConsoleWarnings) {
  const entry = toConsoleEntry(message);
  const ignoredReason = ignoredConsoleWarningReason(entry);
  if (ignoredReason) {
    ignoredConsoleWarnings.push(Object.assign({ reason: ignoredReason }, entry));
    return;
  }
  if (entry.type === "error") consoleErrors.push(entry.text);
}

function capturePageError(error, consoleErrors, ignoredConsoleWarnings) {
  const entry = toPageErrorEntry(error);
  const ignoredReason = ignoredConsoleWarningReason(entry);
  if (ignoredReason) {
    ignoredConsoleWarnings.push(Object.assign({ reason: ignoredReason }, entry));
    return;
  }
  consoleErrors.push(entry.text);
}

async function findAppFrame(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const count = await frame.locator("#app-shell, #admin-auth-root, #admin-auth-password, #admin-password-input").count().catch(() => 0);
      if (count > 0) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("dashboard frame not found");
}

async function main() {
  const outDir = path.join(process.cwd(), "qa-artifacts", "live-runtime-config", safeFileStamp());
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch(withChromiumLaunchOptions({ headless: true }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const consoleErrors = [];
  const ignoredConsoleWarnings = [];
  const httpProblems = [];
  page.on("console", (message) => captureConsoleMessage(message, consoleErrors, ignoredConsoleWarnings));
  page.on("pageerror", (error) => capturePageError(error, consoleErrors, ignoredConsoleWarnings));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      httpProblems.push({ status: response.status(), url: response.url() });
    }
  });
  page.on("requestfailed", (request) => {
    httpProblems.push({ status: "failed", url: request.url(), failure: request.failure()?.errorText || "" });
  });

  await page.goto(USER_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  const frame = await findAppFrame(page);
  await frame.waitForFunction(() => !!window.dashboardApp?.getState, null, { timeout: 90000 });
  await frame.waitForTimeout(1500);

  const state = await frame.evaluate(() => {
    const runtime = (typeof RUNTIME_CLIENT_CONFIG !== "undefined" && RUNTIME_CLIENT_CONFIG) || window.RUNTIME_CLIENT_CONFIG || {};
    const appState = window.dashboardApp && window.dashboardApp.getState ? window.dashboardApp.getState() : {};
    const activePayload = appState && appState.activePayload ? appState.activePayload : {};
    const sourceChip = document.querySelector(".iota-source-chip")?.textContent?.trim() || "";
    return {
      appStatus: document.body.dataset.appStatus || "",
      activeTab: appState.activeTab || "",
      runtimeConfig: {
        dataSourceMode: runtime.dataSourceMode || "",
        publicSnapshotBaseUrl: runtime.publicSnapshotBaseUrl || "",
        supabaseConfigured: runtime.supabaseConfigured === true,
        supabaseUrlConfigured: runtime.supabaseUrlConfigured === true,
        supabaseServiceRoleKeyConfigured: runtime.supabaseServiceRoleKeyConfigured === true,
      },
      sourceChip,
      activePayloadSource:
        activePayload.payloadSource ||
        activePayload.dataSource ||
        (activePayload.meta && (activePayload.meta.payloadSource || activePayload.meta.dataSource)) ||
        "",
    };
  });
  const sourceGateTabs = (process.env.QA_RUNTIME_SOURCE_GATE_TABS || state.activeTab || "weekly")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const sourceGateSnapshot = await collectSourceGateSnapshot(frame, sourceGateTabs);

  await page.screenshot({ path: path.join(outDir, "user-runtime-config.png"), fullPage: true });
  await browser.close();

  const failures = [];
  consoleErrors.forEach((error) => failures.push({ type: "console-error", error }));
  httpProblems.filter((item) => !isIgnorableRequestProblem(item)).forEach((item) => failures.push({ type: "http-problem", item }));
  const sourceGate = {
    requiredSource: REQUIRED_PAYLOAD_SOURCE,
    tabs: sourceGateTabs,
    snapshot: sourceGateSnapshot,
    failures: buildSourceGateFailures(sourceGateSnapshot, {
      scope: "live-runtime-source-gate",
      tabs: sourceGateTabs,
    }),
  };
  sourceGate.failures.forEach((failure) => failures.push(failure));

  const result = {
    outDir,
    url: USER_URL,
    state,
    sourceGate,
    consoleErrors,
    ignoredConsoleWarnings,
    httpProblems,
    failures,
    secretScan: { findingCount: 0, findings: [] },
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(result, null, 2), "utf8");
  const secretFindings = scanArtifactDirectoryForSecrets(outDir);
  if (secretFindings.length) {
    secretFindings.forEach((finding) => failures.push({ type: "artifact-secret", finding }));
    result.failures = failures;
    result.secretScan = { findingCount: secretFindings.length, findings: secretFindings };
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(result, null, 2), "utf8");
  }
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
