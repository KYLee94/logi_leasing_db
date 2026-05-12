const { spawn } = require("child_process");
const path = require("path");

const MODE = String(process.argv[2] || "github-pages").toLowerCase();
const PERF_SCRIPT = path.resolve(__dirname, "dashboard-perf-check.cjs");

const TARGET_ENV = {
  "github-pages": {
    DASHBOARD_TARGET: "github-pages",
    DASHBOARD_PERF_TARGET: "github-pages",
    DASHBOARD_BASE_URL: "",
  },
  pages: {
    DASHBOARD_TARGET: "github-pages",
    DASHBOARD_PERF_TARGET: "github-pages",
    DASHBOARD_BASE_URL: "",
  },
  "apps-script": {
    DASHBOARD_TARGET: "apps-script",
    DASHBOARD_PERF_TARGET: "apps-script",
    DASHBOARD_BASE_URL: "",
  },
};

async function main() {
  const envPatch = TARGET_ENV[MODE];
  if (!envPatch) {
    throw new Error(`Unknown dashboard perf target: ${MODE}. Use one of: ${Object.keys(TARGET_ENV).join(", ")}`);
  }

  const child = spawn(process.execPath, [PERF_SCRIPT], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, envPatch),
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code == null ? 1 : code)));
  });
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
