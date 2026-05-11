const fs = require("fs");
const path = require("path");
const {
  DEFAULT_GITHUB_PAGES_DASHBOARD_URL,
  chromium,
  withChromiumLaunchOptions,
} = require("./playwright-runtime.cjs");
const {
  UI_SECRET_PATTERN,
  USER_EDIT_PATTERN,
  isIgnorableConsole,
} = require("./dashboard-qa-gates.cjs");

const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.resolve(
  process.env.QA_OUT_DIR ||
    path.join("qa-artifacts", "github-pages-post-deploy", RUN_STAMP)
);
const HEADLESS = !/^false$/i.test(process.env.DASHBOARD_HEADLESS || "true");
const BASE_URL =
  process.env.GITHUB_PAGES_URL ||
  process.env.GITHUB_PAGES_BASE_URL ||
  process.env.DASHBOARD_GITHUB_PAGES_URL ||
  process.env.DASHBOARD_STATIC_URL ||
  DEFAULT_GITHUB_PAGES_DASHBOARD_URL;
const APP_READY_SELECTOR = "#app, #app-shell, #admin-auth-root, #admin-auth-password, #admin-password-input, #admin-password";
const ADMIN_PASSWORD_SELECTOR = "#admin-auth-password, #admin-password-input, #admin-password";
const ADMIN_UNLOCKED_SELECTOR = [
  "[data-admin-action]",
  "[data-admin-data-entity]",
  "[data-admin-data-new]",
  "[data-admin-data-open]",
  ".admin-data-workspace",
].join(", ");
const USER_ADMIN_SELECTOR = [
  '[data-tab="admin"]',
  '[data-tab="admin-data"]',
  "[data-admin-action]",
  "[data-admin-data-entity]",
  "[data-admin-data-new]",
  "[data-admin-data-open]",
].join(", ");
const ADMIN_TEXT_PATTERN = /\badmin\b|Admin Console|관리자|관리자 콘솔/i;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildPageUrl(mode) {
  const url = new URL(BASE_URL);
  if (mode) url.searchParams.set("page", mode);
  return url.toString();
}

function consoleEntry(message) {
  const location = typeof message.location === "function" ? message.location() : {};
  return {
    type: typeof message.type === "function" ? message.type() : "",
    text: typeof message.text === "function" ? message.text() : String(message || ""),
    url: location.url || "",
    lineNumber: location.lineNumber || 0,
    columnNumber: location.columnNumber || 0,
  };
}

function pageErrorEntry(error) {
  return {
    type: "pageerror",
    text: error && error.message ? error.message : String(error || ""),
  };
}

function responseEntry(response) {
  return {
    status: response.status(),
    url: response.url(),
  };
}

function requestFailureEntry(request) {
  return {
    method: request.method(),
    url: request.url(),
    resourceType: request.resourceType(),
    failure: request.failure()?.errorText || "",
  };
}

async function findAppContext(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if ((await page.locator(APP_READY_SELECTOR).count().catch(() => 0)) > 0) return page;
    for (const frame of page.frames()) {
      if ((await frame.locator(APP_READY_SELECTOR).count().catch(() => 0)) > 0) return frame;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Dashboard app shell or admin gate was not found.");
}

async function visitTarget(browser, target) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const consoleErrors = [];
  const pageErrors = [];
  const httpProblems = [];
  const requestFailures = [];

  page.on("console", (message) => {
    const entry = consoleEntry(message);
    if (entry.type === "error" && !isIgnorableConsole(entry)) consoleErrors.push(entry);
  });
  page.on("pageerror", (error) => pageErrors.push(pageErrorEntry(error)));
  page.on("response", (response) => {
    if (response.status() >= 400) httpProblems.push(responseEntry(response));
  });
  page.on("requestfailed", (request) => requestFailures.push(requestFailureEntry(request)));

  const navigation = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const navigationStatus = navigation ? navigation.status() : null;
  const appContext = await findAppContext(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${target.name}.png`), fullPage: false });

  let exposure = null;
  let adminGate = null;

  if (target.name === "user") {
    exposure = await appContext.evaluate(
      ({ adminSelector, adminPatternSource, editPatternSource, secretPatternSource }) => {
        const bodyText = document.body?.innerText || "";
        const adminRegex = new RegExp(adminPatternSource, "i");
        const editRegex = new RegExp(editPatternSource, "i");
        const secretRegex = new RegExp(secretPatternSource, "i");
        return {
          hasAdminSelector: !!document.querySelector(adminSelector),
          hasAdminText: adminRegex.test(bodyText),
          hasEditText: editRegex.test(bodyText),
          hasSecretText: secretRegex.test(bodyText),
        };
      },
      {
        adminSelector: USER_ADMIN_SELECTOR,
        adminPatternSource: ADMIN_TEXT_PATTERN.source,
        editPatternSource: USER_EDIT_PATTERN.source,
        secretPatternSource: UI_SECRET_PATTERN.source,
      }
    );
  }

  if (target.name === "admin") {
    adminGate = await appContext.evaluate(
      ({ passwordSelector, unlockedSelector, secretPatternSource }) => {
        const bodyText = document.body?.innerText || "";
        const secretRegex = new RegExp(secretPatternSource, "i");
        return {
          hasPasswordInput: !!document.querySelector(passwordSelector),
          hasUnlockedAdminUi: !!document.querySelector(unlockedSelector),
          hasSecretText: secretRegex.test(bodyText),
        };
      },
      {
        passwordSelector: ADMIN_PASSWORD_SELECTOR,
        unlockedSelector: ADMIN_UNLOCKED_SELECTOR,
        secretPatternSource: UI_SECRET_PATTERN.source,
      }
    );
  }

  await page.close();
  return {
    name: target.name,
    url: target.url,
    navigationStatus,
    screenshot: `${target.name}.png`,
    consoleErrors,
    pageErrors,
    httpProblems,
    requestFailures,
    exposure,
    adminGate,
  };
}

function buildFailures(results) {
  const failures = [];
  for (const result of results.targets) {
    if (result.navigationStatus !== 200) {
      failures.push({
        scope: result.name,
        type: "navigation-status",
        expected: 200,
        actual: result.navigationStatus,
        url: result.url,
      });
    }
    result.consoleErrors.forEach((entry) => failures.push({ scope: result.name, type: "console-error", entry }));
    result.pageErrors.forEach((entry) => failures.push({ scope: result.name, type: "page-error", entry }));
    result.httpProblems.forEach((entry) => failures.push({ scope: result.name, type: "http-error", entry }));
    result.requestFailures.forEach((entry) => failures.push({ scope: result.name, type: "request-failure", entry }));
  }

  const user = results.targets.find((item) => item.name === "user");
  if (user && user.exposure) {
    if (user.exposure.hasAdminSelector) failures.push({ scope: "user", type: "admin-selector-visible" });
    if (user.exposure.hasAdminText) failures.push({ scope: "user", type: "admin-text-visible" });
    if (user.exposure.hasEditText) failures.push({ scope: "user", type: "edit-text-visible" });
    if (user.exposure.hasSecretText) failures.push({ scope: "user", type: "secret-text-visible" });
  }

  const admin = results.targets.find((item) => item.name === "admin");
  if (admin && admin.adminGate) {
    if (!admin.adminGate.hasPasswordInput) failures.push({ scope: "admin", type: "preauth-password-gate-missing" });
    if (admin.adminGate.hasUnlockedAdminUi) failures.push({ scope: "admin", type: "preauth-admin-ui-visible" });
    if (admin.adminGate.hasSecretText) failures.push({ scope: "admin", type: "preauth-secret-text-visible" });
  }

  return failures;
}

async function main() {
  ensureDir(OUT_DIR);
  const targets = [
    { name: "root", url: buildPageUrl("") },
    { name: "user", url: buildPageUrl("user") },
    { name: "admin", url: buildPageUrl("admin") },
  ];
  const browser = await chromium.launch(withChromiumLaunchOptions({ headless: HEADLESS }));
  const results = {
    generatedAt: new Date().toISOString(),
    outDir: OUT_DIR,
    baseUrl: BASE_URL,
    targets: [],
    failures: [],
    summary: {},
  };

  try {
    for (const target of targets) {
      results.targets.push(await visitTarget(browser, target));
    }
  } finally {
    await browser.close();
  }

  results.failures = buildFailures(results);
  results.summary = {
    targetCount: results.targets.length,
    navigation200Count: results.targets.filter((item) => item.navigationStatus === 200).length,
    consoleErrorCount: results.targets.reduce((sum, item) => sum + item.consoleErrors.length + item.pageErrors.length, 0),
    httpErrorCount: results.targets.reduce((sum, item) => sum + item.httpProblems.length + item.requestFailures.length, 0),
    failureCount: results.failures.length,
  };
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(JSON.stringify({
    outDir: OUT_DIR,
    summary: results.summary,
    failures: results.failures,
  }, null, 2));
  if (results.failures.length) process.exit(1);
}

main().catch((error) => {
  ensureDir(OUT_DIR);
  const payload = {
    generatedAt: new Date().toISOString(),
    outDir: OUT_DIR,
    fatal: error && error.stack ? error.stack : String(error),
  };
  fs.writeFileSync(path.join(OUT_DIR, "fatal.json"), JSON.stringify(payload, null, 2), "utf8");
  console.error(payload.fatal);
  process.exit(1);
});
