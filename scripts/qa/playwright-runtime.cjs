process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || "0";

const { chromium } = require("playwright");

const DEFAULT_GITHUB_PAGES_DASHBOARD_URL =
  "https://kylee94.github.io/logi_leasing_db/";

const DEFAULT_LOCAL_DOCS_DASHBOARD_URL = "http://127.0.0.1:4173/";

const LEGACY_APPS_SCRIPT_DASHBOARD_URL =
  "https://script.google.com/macros/s/AKfycbysQM-YbQ0hacBjtcrIk9Nu40AsfD115T8mFrPskO2ayXJFAGWXPpcnmrJFhcKY-5MeWw/exec";

const DEFAULT_DASHBOARD_DEPLOYMENT_URL = DEFAULT_GITHUB_PAGES_DASHBOARD_URL;

function getExecutablePath() {
  return process.env.PLAYWRIGHT_CHROME_PATH || undefined;
}

function withChromiumLaunchOptions(options = {}) {
  const executablePath = getExecutablePath();
  return executablePath ? Object.assign({}, options, { executablePath }) : options;
}

function wantsAppsScriptTarget() {
  return /^apps-script$/i.test(process.env.DASHBOARD_TARGET || process.env.DASHBOARD_PERF_TARGET || "")
    || /^(1|true|yes)$/i.test(process.env.DASHBOARD_USE_APPS_SCRIPT || "");
}

function wantsLocalDocsTarget() {
  return /^local-docs$/i.test(process.env.DASHBOARD_TARGET || process.env.DASHBOARD_PERF_TARGET || "");
}

function resolveDashboardBaseUrl(fallbackUrl = DEFAULT_DASHBOARD_DEPLOYMENT_URL) {
  if (process.env.DASHBOARD_BASE_URL) {
    return process.env.DASHBOARD_BASE_URL;
  }

  if (wantsLocalDocsTarget()) {
    return (
      process.env.DASHBOARD_LOCAL_DOCS_URL ||
      process.env.LOCAL_DOCS_URL ||
      DEFAULT_LOCAL_DOCS_DASHBOARD_URL
    );
  }

  if (wantsAppsScriptTarget()) {
    return (
      process.env.DASHBOARD_APPS_SCRIPT_URL ||
      process.env.DASHBOARD_LIVE_URL ||
      process.env.IOTA_BASE_URL ||
      LEGACY_APPS_SCRIPT_DASHBOARD_URL
    );
  }

  return (
    process.env.DASHBOARD_GITHUB_PAGES_URL ||
    process.env.GITHUB_PAGES_URL ||
    process.env.GITHUB_PAGES_BASE_URL ||
    process.env.DASHBOARD_STATIC_URL ||
    fallbackUrl
  );
}

function buildDashboardPageUrl(mode, baseUrl = resolveDashboardBaseUrl()) {
  const url = new URL(baseUrl);
  url.searchParams.set("page", mode);
  return url.toString();
}

function getQaNumberEnv(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

function getDashboardQaThresholds() {
  return {
    tabServerRequestMax: getQaNumberEnv("QA_TAB_SERVER_CALL_MAX", 0),
    revisitServerRequestMax: getQaNumberEnv("QA_REVISIT_SERVER_CALL_MAX", 0),
    modalServerRequestMax: getQaNumberEnv("QA_MODAL_SERVER_CALL_MAX", 0),
    modalOpenMaxMs: getQaNumberEnv("QA_MODAL_OPEN_MAX_MS", 700),
    drawerOpenMaxMs: getQaNumberEnv("QA_DRAWER_OPEN_MAX_MS", 900),
    tabReadyMaxMs: getQaNumberEnv("QA_TAB_READY_MAX_MS", 12000),
    reloadReadyMaxMs: getQaNumberEnv("QA_RELOAD_READY_MAX_MS", 15000),
  };
}

function isDashboardServerRequestUrl(url, method = "GET") {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.includes("/callback")) return true;
    if (String(method || "GET").toUpperCase() !== "POST") return false;
    if (!/(^|\.)script\.google\.com$|(^|\.)googleusercontent\.com$/.test(host)) return false;
    return /\/macros\/(s|echo|d)\//.test(pathname) || pathname.includes("/callback");
  } catch (_error) {
    return String(url || "").toLowerCase().includes("/callback");
  }
}

function createDashboardRequestRecorder(page) {
  const events = [];
  const push = (phase, request, extra = {}) => {
    const method = request.method();
    const url = request.url();
    if (!isDashboardServerRequestUrl(url, method)) return;
    events.push(Object.assign({
      phase,
      at: new Date().toISOString(),
      method,
      url,
      resourceType: request.resourceType(),
    }, extra));
  };

  page.on("request", (request) => push("request", request));
  page.on("requestfinished", async (request) => {
    let status = null;
    try {
      const response = await request.response();
      status = response ? response.status() : null;
    } catch (_error) {
      status = null;
    }
    push("finished", request, { status });
  });
  page.on("requestfailed", (request) => {
    push("failed", request, { failure: request.failure()?.errorText || "" });
  });

  return {
    events,
    mark(label) {
      const startIndex = events.length;
      return {
        label,
        startIndex,
        summarize() {
          return summarizeDashboardServerRequests(events.slice(startIndex));
        },
      };
    },
    summarizeAll() {
      return summarizeDashboardServerRequests(events);
    },
  };
}

function summarizeDashboardServerRequests(events) {
  const requests = events.filter((event) => event.phase === "request");
  const failures = events.filter((event) => event.phase === "failed");
  return {
    requestCount: requests.length,
    failureCount: failures.length,
    requests: requests.map((event) => ({
      method: event.method,
      url: event.url,
      resourceType: event.resourceType,
      at: event.at,
    })),
    failures: failures.map((event) => ({
      method: event.method,
      url: event.url,
      failure: event.failure || "",
      at: event.at,
    })),
  };
}

module.exports = {
  chromium,
  DEFAULT_DASHBOARD_DEPLOYMENT_URL,
  DEFAULT_GITHUB_PAGES_DASHBOARD_URL,
  DEFAULT_LOCAL_DOCS_DASHBOARD_URL,
  LEGACY_APPS_SCRIPT_DASHBOARD_URL,
  buildDashboardPageUrl,
  createDashboardRequestRecorder,
  getDashboardQaThresholds,
  getExecutablePath,
  isDashboardServerRequestUrl,
  resolveDashboardBaseUrl,
  withChromiumLaunchOptions,
};
