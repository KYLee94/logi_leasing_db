#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUTPUT_DIR = path.join(ROOT, "qa-artifacts", "data-contract", RUN_STAMP);

const NEW_ASSETS = [
  {
    code: "A190002001",
    docId: "asset_a190002001",
    name: "분당야탑물류센터",
    manager: "류지훈",
    expectedBuildingStatus: "building_register_api_readback_ok",
  },
  {
    code: "A190013001",
    docId: "asset_a190013001",
    name: "포천정교리물류센터",
    manager: "양우영",
    expectedBuildingStatus: "development_asset_not_found_expected",
  },
];

const NEW_STAFF = ["오윤석", "한창형", "류지훈", "양우영"];
const EXISTING_STAFF_WITH_NEW_ASSETS = ["이철승", "이관용", "전기영", "이승훈", "이시정", "윤관식"];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function has(source, pattern) {
  return pattern instanceof RegExp ? pattern.test(source) : source.includes(pattern);
}

function row(id, title, ok, evidence, action = "") {
  return { id, title, status: ok ? "PASS" : "REVIEW", evidence, action };
}

function renderTable(rows) {
  return [
    "| ID | Status | Check | Evidence | Action |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((item) => `| ${item.id} | ${item.status} | ${item.title} | ${String(item.evidence).replace(/\|/g, "/")} | ${item.action || "-"} |`),
  ].join("\n");
}

function assetFile(asset) {
  return readJson(`docs/data/asset/${asset.docId}.json`);
}

function assetPayload(asset) {
  const payload = assetFile(asset);
  return payload.asset || payload;
}

function assetNameOf(payload) {
  return payload.name || payload.assetName || payload.overview?.assetName || payload.meta?.selection?.assetName || "";
}

function assetBuildingStatusOf(payload) {
  return payload.buildingRegister?.status || payload.overview?.buildingRegisterStatus || payload.overview?.buildingHubStatus || "";
}

function includesAll(values, expected) {
  const set = new Set(values || []);
  return expected.every((value) => set.has(value));
}

function main() {
  ensureDir(OUTPUT_DIR);

  const app = readText("docs/assets/app.js");
  const pkg = readJson("package.json");
  const assetOptions = readJson("docs/data/asset-options.json");
  const admin = readJson("docs/data/admin.json");
  const snapshots = exists("qa-artifacts/supabase/ll-rich-snapshots-from-docs.json")
    ? readJson("qa-artifacts/supabase/ll-rich-snapshots-from-docs.json")
    : { tables: { ll_payload_snapshots: [] } };
  const snapshotRows = snapshots.tables?.ll_payload_snapshots || [];
  const edge = readText("supabase/functions/logistics-admin-api/index.ts");
  const schema = readText("scripts/supabase/public-ll-schema.sql");

  const runtimeRows = [
    row(
      "RUN-01",
      "docs app reads Supabase snapshot first",
      has(app, "ll_payload_snapshots") && has(app, "fetchSupabaseSnapshot"),
      "docs/assets/app.js contains ll_payload_snapshots + fetchSupabaseSnapshot",
    ),
    row(
      "RUN-02",
      "GitHub JSON remains fallback, not primary server",
      has(app, "fetchJson") && has(app, "data/asset-options.json"),
      "static docs JSON fallback loader exists",
    ),
    row(
      "RUN-03",
      "runtime has no Apps Script calls",
      !has(app, "google.script.run") && !has(app, "script.google.com"),
      "google.script.run/script.google.com not found in docs app",
    ),
    row(
      "RUN-04",
      "package default QA avoids Apps Script path",
      Object.entries(pkg.scripts || {}).every(([name, command]) => {
        if (/^legacy:/.test(name) || /legacy-apps-script/i.test(name)) return true;
        return !/clasp|script\.google\.com|export-public-snapshots\.cjs|selector-switch-check|search-routing-check|admin-live-check|dashboard-perf-check\.cjs/.test(command);
      }),
      "non-legacy package scripts do not reference clasp or legacy Apps Script QA",
    ),
  ];

  const dataRows = [];
  for (const asset of NEW_ASSETS) {
    const option = assetOptions.find((item) => item.assetId === asset.docId);
    const payload = assetPayload(asset);
    dataRows.push(row(
      `DATA-${asset.code}`,
      `${asset.name} is in docs asset options and asset payload`,
      Boolean(option) && assetNameOf(payload) === asset.name,
      `option=${option?.assetName || "missing"}, payload=${assetNameOf(payload) || "missing"}`,
    ));
    dataRows.push(row(
      `FUND-${asset.code}`,
      `${asset.name} has fund/investment/asset overview`,
      Boolean(payload.fundOverview?.fundName && (payload.investmentOverview || payload.overview?.investmentOverview) && payload.overview),
      `fund=${payload.fundOverview?.fundName || "missing"}`,
    ));
    dataRows.push(row(
      `BREG-${asset.code}`,
      `${asset.name} has server-side building-register status`,
      assetBuildingStatusOf(payload) === asset.expectedBuildingStatus,
      `status=${assetBuildingStatusOf(payload) || "missing"}`,
    ));
  }

  const staffRows = [];
  const permissionRows = admin.userPermissions || [];
  const staffNames = permissionRows.map((item) => item.staffName);
  const sortedStaffNames = [...staffNames].sort((left, right) => String(left).localeCompare(String(right), "ko-KR"));
  staffRows.push(row(
    "PERM-01",
    "feature permissions are sorted by Korean staff name",
    staffNames.every((name, index) => name === sortedStaffNames[index]),
    `first=${staffNames.slice(0, 5).join(", ")}, count=${staffNames.length}`,
  ));

  for (const name of NEW_STAFF) {
    const person = permissionRows.find((item) => item.staffName === name);
    staffRows.push(row(
      `PERM-${name}`,
      `${name} exists in permissions and has a staff photo`,
      Boolean(person && person.photoUrl && exists(`docs/${person.photoUrl}`)),
      `assets=${(person?.assetNames || []).join(", ") || "missing"}, photo=${person?.photoUrl || "missing"}`,
    ));
  }

  for (const name of EXISTING_STAFF_WITH_NEW_ASSETS) {
    const person = permissionRows.find((item) => item.staffName === name);
    staffRows.push(row(
      `PERM-ASSET-${name}`,
      `${name} has both new asset permissions`,
      Boolean(person && includesAll(person.assetCodes, NEW_ASSETS.map((asset) => asset.code))),
      `assetCodes=${(person?.assetCodes || []).filter((code) => code.startsWith("A1900")).join(", ") || "missing"}`,
    ));
  }

  const uiRows = [
    row(
      "ASSET-01",
      "ASSET KPI strip replaces monthly total cost with per-pyeong averages",
      has(app, "buildAssetKpis") && has(app, "averageRentPerPy") && has(app, "averageMfPerPy") && has(app, "key !== \"monthly_total_cost\"") && has(app, "label !== \"월 임관리비 총액\""),
      "buildAssetKpis filters monthly total and appends average rent/maintenance per py",
    ),
    row(
      "COMPANY-01",
      "company tenant asset table is collapsible and sortable",
      has(app, "renderCompanyAssetStatus")
        && has(app, "compareCompanyAssetStatusRows")
        && has(app, "data-toggle-company-contract-details")
        && has(app, "table-width-toggle")
        && has(app, "table-sort-button")
        && has(app, "sortTableRows"),
      "renderCompanyAssetStatus + contract detail toggle + sortable header handling present",
    ),
    row(
      "COMPANY-02",
      "company table includes average rent/maintenance and split ratios",
      has(app, "averageRentPerPy") && has(app, "averageMfPerPy") && has(app, "areaRatio") && has(app, "monthlyCostRatio"),
      "averageRentPerPy/averageMfPerPy/areaRatio/monthlyCostRatio fields present",
    ),
    row(
      "TAB-01",
      "tab switching guards stale payload races",
      has(app, "renderSeq") && has(app, "payloadMatchesSelection") && has(app, "refreshTab"),
      "render sequence and payload selection guard present",
    ),
  ];

  const adminRows = [
    row(
      "ADMIN-01",
      "admin data JSON contains beneficiary/lender data for new assets",
      (admin.fundBeneficiaries || []).filter((item) => NEW_ASSETS.some((asset) => asset.docId === item.assetId)).length === 4
        && (admin.fundLenders || []).filter((item) => item.assetId === "asset_a190002001").length === 4,
      `beneficiaries=${(admin.fundBeneficiaries || []).length}, lenders=${(admin.fundLenders || []).length}`,
    ),
    row(
      "ADMIN-02",
      "login history routes are backed by Supabase Edge Function",
      has(edge, "/login-history/list") && has(edge, "/login-history/record") && has(edge, "ll_login_history") && has(app, "/login-history/list") && has(app, "/login-history/record"),
      "login-history/list and login-history/record routes present in Edge Function and called by docs app",
    ),
    row(
      "ADMIN-03",
      "building-register lookup is routed through Edge Function",
      has(edge, "/building-register/summary") && has(edge, "apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo"),
      "building-register route and public data endpoint present in Edge Function only",
    ),
    row(
      "ADMIN-04",
      "admin snapshots are not marked user_safe",
      snapshotRows.filter((item) => item.page === "admin" || item.page === "admin-data").every((item) => item.user_safe === false),
      `adminSnapshots=${snapshotRows.filter((item) => item.page === "admin" || item.page === "admin-data").map((item) => `${item.page}:${item.user_safe}`).join(", ")}`,
    ),
    row(
      "SCHEMA-01",
      "new Supabase tables exist in public schema",
      ["ll_staff_profiles", "ll_fund_beneficiaries", "ll_fund_lenders", "ll_login_history"].every((table) => has(schema, `create table if not exists public.${table}`)),
      "staff, beneficiary, lender, login-history tables present",
    ),
  ];

  const allRows = [...runtimeRows, ...dataRows, ...staffRows, ...uiRows, ...adminRows];
  const summary = {
    generatedAt: new Date().toISOString(),
    counts: {
      pass: allRows.filter((item) => item.status === "PASS").length,
      review: allRows.filter((item) => item.status === "REVIEW").length,
      total: allRows.length,
    },
    runtimeRows,
    dataRows,
    staffRows,
    uiRows,
    adminRows,
  };

  const markdown = [
    "# Dashboard Data Contract Check",
    "",
    `Generated at: ${summary.generatedAt}`,
    "",
    `Summary: PASS ${summary.counts.pass} / REVIEW ${summary.counts.review} / TOTAL ${summary.counts.total}`,
    "",
    "## Runtime",
    renderTable(runtimeRows),
    "",
    "## New Asset Data",
    renderTable(dataRows),
    "",
    "## Permissions And Staff",
    renderTable(staffRows),
    "",
    "## UI Contracts",
    renderTable(uiRows),
    "",
    "## Admin And Supabase",
    renderTable(adminRows),
  ].join("\n");

  const mdPath = path.join(OUTPUT_DIR, "checklist.md");
  const jsonPath = path.join(OUTPUT_DIR, "checklist.json");
  fs.writeFileSync(mdPath, markdown, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify({ outputDir: OUTPUT_DIR, markdown: mdPath, json: jsonPath, summary: summary.counts }, null, 2));
  if (summary.counts.review > 0) process.exit(1);
}

main();
