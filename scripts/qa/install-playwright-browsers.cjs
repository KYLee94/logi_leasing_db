const { spawnSync } = require("child_process");

process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || "0";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npxCommand, ["playwright", "install", "chromium"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status == null ? 1 : result.status);
