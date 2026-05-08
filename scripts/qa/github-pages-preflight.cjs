const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DOCS_DIR = path.resolve(process.env.QA_STATIC_DOCS_DIR || "docs");
const REQUIRED_FILES = [
  ".nojekyll",
  "index.html",
  path.join("assets", "app.js"),
  path.join("assets", "iota.css"),
  path.join("data", "bootstrap.json"),
  path.join("data", "initial.json"),
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function gitTracked(relativePath) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", relativePath], { stdio: "ignore" });
    return true;
  } catch (_error) {
    return false;
  }
}

function main() {
  const failures = [];
  const files = REQUIRED_FILES.map((relativePath) => {
    const absolutePath = path.join(DOCS_DIR, relativePath);
    const repoPath = toPosix(path.relative(process.cwd(), absolutePath));
    const exists = fs.existsSync(absolutePath);
    const tracked = exists && gitTracked(repoPath);
    if (!exists) {
      failures.push({ type: "missing-file", path: repoPath });
    } else if (!tracked) {
      failures.push({ type: "untracked-file", path: repoPath });
    }
    return { path: repoPath, exists, tracked };
  });

  const indexPath = path.join(DOCS_DIR, "index.html");
  if (fs.existsSync(indexPath)) {
    const html = readText(indexPath);
    for (const asset of ["./assets/iota.css", "./assets/app.js"]) {
      if (!html.includes(asset)) {
        failures.push({ type: "index-reference-missing", path: "docs/index.html", asset });
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    docsDir: DOCS_DIR,
    expectedPagesUrl: process.env.GITHUB_PAGES_URL || "https://kylee94.github.io/logi_leasing_db/",
    files,
    failures,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (failures.length) process.exit(1);
}

main();
