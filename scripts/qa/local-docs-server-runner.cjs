const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const MODE = String(process.argv[2] || "perf").toLowerCase();
const HOST = process.env.QA_LOCAL_DOCS_HOST || "127.0.0.1";
const PORT = Number(process.env.QA_LOCAL_DOCS_PORT || 0);
const DOCS_DIR = path.resolve(process.env.QA_LOCAL_DOCS_DIR || process.env.QA_STATIC_DOCS_DIR || "docs");

const TARGETS = {
  perf: {
    script: path.resolve(__dirname, "dashboard-perf-check.cjs"),
    env(baseUrl) {
      return {
        DASHBOARD_TARGET: "local-docs",
        DASHBOARD_BASE_URL: baseUrl,
        DASHBOARD_LOCAL_DOCS_URL: baseUrl,
        QA_REQUIRED_DATA_SOURCE_MODE: "static",
        QA_REQUIRED_PAYLOAD_SOURCE: "github_snapshot",
      };
    },
  },
  smoke: {
    script: path.resolve(__dirname, "github-pages-static-qa.cjs"),
    env(baseUrl) {
      return {
        STATIC_BASE_URL: baseUrl,
        QA_REQUIRED_DATA_SOURCE_MODE: "static",
        QA_REQUIRED_PAYLOAD_SOURCE: "github_snapshot",
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || process.env.QA_LOCAL_ADMIN_PASSWORD || "",
      };
    },
  },
  "static-all": {
    script: path.resolve(__dirname, "github-pages-static-qa.cjs"),
    env(baseUrl) {
      return {
        STATIC_BASE_URL: baseUrl,
        QA_STATIC_CHECKS: "capture,source,exposure,admin-preauth,runtime",
        QA_REQUIRED_DATA_SOURCE_MODE: "static",
        QA_REQUIRED_PAYLOAD_SOURCE: "github_snapshot",
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || process.env.QA_LOCAL_ADMIN_PASSWORD || "",
      };
    },
  },
  capture: {
    script: path.resolve(__dirname, "github-pages-static-qa.cjs"),
    env(baseUrl) {
      return {
        STATIC_BASE_URL: baseUrl,
        QA_STATIC_CHECKS: "capture",
        QA_REQUIRED_DATA_SOURCE_MODE: "static",
        QA_REQUIRED_PAYLOAD_SOURCE: "github_snapshot",
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || process.env.QA_LOCAL_ADMIN_PASSWORD || "",
      };
    },
  },
  source: {
    script: path.resolve(__dirname, "github-pages-static-qa.cjs"),
    env(baseUrl) {
      return {
        STATIC_BASE_URL: baseUrl,
        QA_STATIC_CHECKS: "source",
        QA_REQUIRED_DATA_SOURCE_MODE: "static",
        QA_REQUIRED_PAYLOAD_SOURCE: "github_snapshot",
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || process.env.QA_LOCAL_ADMIN_PASSWORD || "",
      };
    },
  },
  exposure: {
    script: path.resolve(__dirname, "github-pages-static-qa.cjs"),
    env(baseUrl) {
      return {
        STATIC_BASE_URL: baseUrl,
        QA_STATIC_CHECKS: "exposure",
        QA_REQUIRED_DATA_SOURCE_MODE: "static",
        QA_REQUIRED_PAYLOAD_SOURCE: "github_snapshot",
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || process.env.QA_LOCAL_ADMIN_PASSWORD || "",
      };
    },
  },
  "admin-preauth": {
    script: path.resolve(__dirname, "github-pages-static-qa.cjs"),
    env(baseUrl) {
      return {
        STATIC_BASE_URL: baseUrl,
        QA_STATIC_CHECKS: "admin-preauth",
        QA_ROLES: "admin",
        QA_REQUIRED_DATA_SOURCE_MODE: "static",
        QA_REQUIRED_PAYLOAD_SOURCE: "github_snapshot",
      };
    },
  },
  "deep-interactions": {
    script: path.resolve(__dirname, "github-pages-deep-interactions-check.cjs"),
    env(baseUrl) {
      const url = new URL(baseUrl);
      url.searchParams.set("page", "user");
      return {
        STATIC_USER_URL: url.toString(),
        QA_DEEP_INTERACTIONS_URL: url.toString(),
      };
    },
  },
  "iota-reference": {
    script: path.resolve(__dirname, "iota-reference-check.cjs"),
    env(baseUrl) {
      return {
        DASHBOARD_TARGET: "local-docs",
        DASHBOARD_BASE_URL: baseUrl,
        DASHBOARD_LOCAL_DOCS_URL: baseUrl,
      };
    },
  },
  "exhaustive-scroll": {
    script: path.resolve(__dirname, "exhaustive-scroll-capture.cjs"),
    env(baseUrl) {
      const userUrl = new URL(baseUrl);
      userUrl.searchParams.set("page", "user");
      const adminUrl = new URL(baseUrl);
      adminUrl.searchParams.set("page", "admin");
      return {
        DASHBOARD_TARGET: "local-docs",
        DASHBOARD_BASE_URL: baseUrl,
        DASHBOARD_LOCAL_DOCS_URL: baseUrl,
        USER_URL: userUrl.toString(),
        ADMIN_URL: adminUrl.toString(),
        CURRENT_URL: userUrl.toString(),
        IOTA_CURRENT_URL: userUrl.toString(),
        QA_CAPTURE_REFERENCE: process.env.QA_CAPTURE_REFERENCE || "false",
      };
    },
  },
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, Object.assign({ "Cache-Control": "no-store" }, headers));
  response.end(body);
}

function resolveRequestPath(requestUrl) {
  const parsed = new URL(requestUrl || "/", "http://local.docs");
  const decoded = decodeURIComponent(parsed.pathname || "/");
  const safePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(DOCS_DIR, safePath);
  if (resolved !== DOCS_DIR && !resolved.startsWith(`${DOCS_DIR}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function createServer() {
  return http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
      return;
    }

    const filePath = resolveRequestPath(request.url || "/");
    if (!filePath) {
      send(response, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }

    fs.stat(filePath, (statError, stat) => {
      const finalPath = !statError && stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
      fs.readFile(finalPath, (readError, body) => {
        if (readError) {
          send(response, 404, "Not Found", { "Content-Type": "text/plain; charset=utf-8" });
          return;
        }
        const contentType = MIME_TYPES[path.extname(finalPath).toLowerCase()] || "application/octet-stream";
        send(response, 200, request.method === "HEAD" ? "" : body, { "Content-Type": contentType });
      });
    });
  });
}

async function main() {
  const target = TARGETS[MODE];
  if (!target) {
    throw new Error(`Unknown local docs QA mode: ${MODE}. Use one of: ${Object.keys(TARGETS).join(", ")}`);
  }
  if (!fs.existsSync(path.join(DOCS_DIR, "index.html"))) {
    throw new Error(`Static docs index was not found: ${path.join(DOCS_DIR, "index.html")}`);
  }

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });

  const address = server.address();
  const baseUrl = `http://${HOST}:${address.port}/`;
  console.log(`Local docs QA server: ${baseUrl}`);
  console.log(`Local docs QA mode: ${MODE}`);

  const child = spawn(process.execPath, [target.script], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, target.env(baseUrl)),
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code == null ? 1 : code)));
  });

  await new Promise((resolve) => server.close(resolve));
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
