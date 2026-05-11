const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const HOST = process.env.QA_STATIC_LOCAL_HOST || "127.0.0.1";
const PORT = Number(process.env.QA_STATIC_LOCAL_PORT || 0);
const DOCS_DIR = path.resolve(process.env.QA_STATIC_DOCS_DIR || "docs");
const QA_SCRIPT = path.resolve(__dirname, "github-pages-static-qa.cjs");

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

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
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
  const childEnv = Object.assign({}, process.env, {
    STATIC_BASE_URL: process.env.STATIC_BASE_URL || baseUrl,
    QA_REQUIRED_DATA_SOURCE_MODE: process.env.QA_REQUIRED_DATA_SOURCE_MODE || "static",
    QA_REQUIRED_PAYLOAD_SOURCE: process.env.QA_REQUIRED_PAYLOAD_SOURCE || "github_snapshot",
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || process.env.QA_LOCAL_ADMIN_PASSWORD || "local-qa-only",
  });

  const child = spawn(process.execPath, [QA_SCRIPT], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal) resolve(1);
      else resolve(code == null ? 1 : code);
    });
  });

  await new Promise((resolve) => server.close(resolve));
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
