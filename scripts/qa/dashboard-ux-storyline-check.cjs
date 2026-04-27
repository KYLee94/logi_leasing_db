const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUTPUT_DIR = path.join(ROOT, "qa-artifacts", "ux-storyline", RUN_STAMP);

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function has(source, pattern) {
  return pattern instanceof RegExp ? pattern.test(source) : source.includes(pattern);
}

function status(ok) {
  return ok ? "PASS" : "REVIEW";
}

function item(tab, order, label, intent, ok, evidence, recommendation) {
  return {
    tab,
    order,
    label,
    intent,
    status: status(ok),
    evidence,
    recommendation: recommendation || "-",
  };
}

function renderTable(rows) {
  return [
    "| Tab | Order | Status | Component | User intent | Evidence | Recommendation |",
    "| --- | ---: | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.tab} | ${row.order} | ${row.status} | ${row.label} | ${row.intent} | ${row.evidence} | ${row.recommendation} |`),
  ].join("\n");
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const client = read("Client.html");
  const style = read("Stylesheet.html");
  const metrics = read("Metrics.gs");
  const server = read("Server.gs");

  const rows = [
    item("Home", 1, "KPI strip", "Portfolio status should be understood immediately.", has(client, "home-kpi-strip") && has(client, "operating_asset_count"), "Home KPI renderer and payload keys found.", "Keep 4-5 KPI max; move detailed basis to modal if visually noisy."),
    item("Home", 2, "Portfolio location", "User should see where assets are and open a map.", has(client, "home-location-panel") && has(client, "home-map-detail") && has(client, "renderOpenStreetMapPortfolioMap_"), "Asset blocks and map fallback found.", "Hide technical Naver diagnostics from user mode; keep in Admin."),
    item("Home", 3, "Snapshot", "User should understand asset/tenant/map coverage.", has(client, "home-snapshot-assets") && has(client, "home-snapshot-mapped"), "Snapshot actions found.", "Reduce duplicate count copy if it repeats KPI values."),
    item("Home", 4, "Rent trend", "User should connect cost movement with asset count and area.", has(client, "home-rent-chart") && has(client, "grossFloorAreaDisplay"), "Dual metric trend implementation found.", "Ensure chart axis labels show units in live QA."),
    item("Home", 5, "Vacancy / expiry / top tenants", "User should drill from risk summaries into rows.", has(client, "home-vacancy-table") && has(client, "home-expiry-detail") && has(client, "home-tenant-table"), "Risk tables and actions found.", "Keep vacancy and top tenants side-by-side on desktop."),
    item("Asset", 1, "Asset selector and summary", "User should know which asset is being inspected.", has(client, "asset-selector") && has(client, "asset-kpi-strip"), "Selector and KPI strip found.", "Keep selector sticky or highly visible during long pages."),
    item("Asset", 2, "Tenant roster", "User should compare tenants without horizontal guesswork.", has(client, "asset-roster-table"), "Roster table found.", "Live screenshot review should verify no hidden important columns."),
    item("Asset", 3, "E.NOC audit", "User should trust or challenge E.NOC values.", has(metrics, "buildAssetENocAudit_") && has(client, "E.NOC"), "E.NOC audit and modal references found.", "Add red/yellow badge for E.NOC outliers after reconciliation."),
    item("Asset", 4, "Floor stacking", "User should see each floor separately.", has(client, "expandClientStackingFloors_") && has(client, "stack-floor-gutter"), "Floor expansion and gutter found.", "Confirm same tenant across multiple floors remains split in live sample assets."),
    item("Asset", 5, "Area / expiry / core tenants", "User should understand space and expiry risk after roster.", has(client, "table-wrap-asset-breakdown") && has(client, "asset-expiry-chart") && has(client, "topCostRows"), "Area, expiry, and tenant summaries found.", "Consider moving floor stacking above cost chart if user focus is physical layout."),
    item("Company", 1, "Company selector and KPI row", "User should identify company exposure quickly.", has(client, "company-selector") && has(client, "company-kpi-strip"), "Company selector and compact KPI strip found.", "KPI cards should share one basis line, not repeated micro text."),
    item("Company", 2, "Leased assets", "User should know which assets the company leases.", has(client, "company-assets-table"), "Company leased assets table found.", "Keep this immediately under KPI row."),
    item("Company", 3, "Company map", "User should see leased asset geography.", has(client, "company-map-detail") && has(client, "companyMapPoints"), "Company map action and points found.", "Use same map fallback and user-facing copy as Home."),
    item("Company", 4, "Exposure and DART", "User should compare area/cost exposure and official company info.", has(client, "company-exposure-chart") && has(client, "buildCompanyDartDetailRows_"), "Exposure chart and DART detail renderer found.", "Split DART into summary + detailed modal if it pushes core leasing table down."),
    item("Sector", 1, "Sector dashboard", "User should understand this as advanced analysis.", has(client, "renderSector(") && has(metrics, "buildSectorPayload_"), "Sector renderer and payload found.", "If not MVP-complete, show advanced/beta label."),
    item("Analysis Tools", 1, "Comparison workflow", "User should choose assets/companies and see benchmark outputs.", has(client, "tools-benchmark-chart") && has(client, "tools-ledger-table"), "Tools benchmark and ledger found.", "Clarify empty selection behavior and selected item count."),
    item("Data Playground", 1, "Ad-hoc builder", "Power user should build a simple pivot without technical words.", has(client, "playground-row-dimension") && has(client, "playground-value-metric"), "Builder controls found.", "Rename English labels to Korean user-facing terms."),
    item("Admin", 1, "Blocker actions", "Admin should see what to fix next.", has(client, "integration-diagnostics") && has(server, "uiDataReconciliation"), "Integration and reconciliation admin data found.", "Add one-click reconciliation run button in Admin after owner authorization."),
  ];

  const styleRows = [
    item("Global UI", 1, "Cards", "Panels should feel consistent.", has(style, ".workspace-panel") && has(style, "--surface"), "Panel and token styles found.", "Audit color contrast after recent Wattle/Bottle Green changes."),
    item("Global UI", 2, "Buttons", "Clickable elements should be obvious.", has(style, ".primary-button") && has(style, ".secondary-button") && has(style, ".summary-button"), "Button styles found.", "Ensure table row buttons use same hover language."),
    item("Global UI", 3, "Modals", "Popups should appear centered and readable.", has(style, ".modal") && has(style, ".modal-card"), "Modal styles found.", "Use large centered modal for all row/detail popups."),
    item("Global UI", 4, "Basis line", "Basis should explain refresh point without noise.", has(client, "renderBasisLine_"), "Basis line renderer found.", "Move repeated basis lines into section-level basis where possible."),
  ];

  const all = rows.concat(styleRows);
  const summary = {
    generatedAt: new Date().toISOString(),
    counts: {
      pass: all.filter((row) => row.status === "PASS").length,
      review: all.filter((row) => row.status === "REVIEW").length,
      total: all.length,
    },
    rows,
    styleRows,
  };

  const markdown = [
    "# UX Storyline Checklist",
    "",
    `Generated at: ${summary.generatedAt}`,
    "",
    `Summary: PASS ${summary.counts.pass} / REVIEW ${summary.counts.review} / TOTAL ${summary.counts.total}`,
    "",
    "## First-user top-to-down journey",
    renderTable(rows),
    "",
    "## Global UI consistency",
    renderTable(styleRows),
    "",
    "## Priority improvement queue",
    "",
    "1. Keep Home / Asset / Company as the primary MVP path and mark Sector / Tools / Playground as advanced if live UX still feels unclear.",
    "2. Add Admin reconciliation run/read buttons so DB-source and payload differences are visible without local tooling.",
    "3. Shorten user-facing technical copy for map fallback; keep Naver iframe origin diagnostics in Admin only.",
    "4. Add E.NOC outlier badges to Asset after reconciliation report is available.",
  ].join("\n");

  fs.writeFileSync(path.join(OUTPUT_DIR, "ux-storyline.md"), markdown, "utf8");
  fs.writeFileSync(path.join(OUTPUT_DIR, "ux-storyline.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify({ outputDir: OUTPUT_DIR, summary: summary.counts }, null, 2));
}

main();
