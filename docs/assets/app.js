(function () {
  "use strict";

  const DATA_SOURCE_MODE = "static";
  const PAYLOAD_SOURCE = "github_snapshot";
  const CACHE_PREFIX = "ll.static.cache:";
  const DETAIL_PREFIX = "detail_";

  const TAB_ORDER = ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality", "admin", "admin-data"];
  const PUBLIC_TABS = ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality"];
  const TAB_META = {
    weekly: { title: "Weekly", group: "Workspace", file: "data/weekly.json" },
    home: { title: "Home", group: "Workspace", file: "data/home.json" },
    asset: { title: "Asset", group: "Workspace", file: "asset" },
    company: { title: "Company", group: "Workspace", file: "company" },
    sector: { title: "Sector", group: "Workspace", file: "data/sector.json" },
    tools: { title: "Analysis Tools", group: "Analysis", file: "data/tools.json" },
    playground: { title: "Data Playground", group: "Analysis", file: "data/playground.json" },
    quality: { title: "Data Quality", group: "Analysis", file: "virtual" },
    admin: { title: "Admin", group: "Admin", file: "virtual" },
    "admin-data": { title: "Admin Data", group: "Admin", file: "virtual" },
  };

  const state = {
    role: "user",
    activeTab: "weekly",
    activePayload: null,
    pageCache: {},
    lastSuccessfulPayloads: {},
    options: { assets: [], companies: [] },
    selections: {
      assetId: "",
      tenantId: "",
      weeklyAssetView: "core",
    },
    detailStore: {},
    renderCounts: {},
    dataSourceMode: DATA_SOURCE_MODE,
    payloadSource: PAYLOAD_SOURCE,
  };

  const memoryCache = new Map();

  window.RUNTIME_CLIENT_CONFIG = Object.assign({}, window.RUNTIME_CLIENT_CONFIG || {}, {
    dataSourceMode: DATA_SOURCE_MODE,
    payloadSource: PAYLOAD_SOURCE,
    supabaseConfigured: false,
    supabaseUrlConfigured: false,
    supabaseServiceRoleKeyConfigured: false,
  });

  window.dashboardApp = {
    getState: () => state,
    switchTab: (tab) => switchTab(tab),
    setThemePreference: (theme) => setTheme(theme),
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    const params = new URLSearchParams(window.location.search);
    state.role = params.get("page") === "admin" ? "admin" : "user";
    setTheme(localStorage.getItem("ll.static.theme") || "dark");
    bindShellActions();

    if (state.role !== "admin") {
      removeAdminDom();
      showShell();
    } else {
      showAdminGate();
      return;
    }

    await prepareOptions();
    await switchTab("weekly");
  }

  function bindShellActions() {
    document.getElementById("sidebar-toggle")?.addEventListener("click", () => {
      document.getElementById("app-shell")?.classList.toggle("sidebar-collapsed");
    });

    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.addEventListener("click", () => setTheme(button.dataset.themeChoice || "dark"));
    });

    bindNavActions();

    document.getElementById("asset-select")?.addEventListener("change", async (event) => {
      state.selections.assetId = event.target.value || state.selections.assetId;
      await renderCurrentTab(true);
    });

    document.getElementById("company-select")?.addEventListener("change", async (event) => {
      state.selections.tenantId = event.target.value || state.selections.tenantId;
      await renderCurrentTab(true);
    });

    document.getElementById("drawer-close")?.addEventListener("click", closeDrawer);
    document.getElementById("drawer-backdrop")?.addEventListener("click", (event) => {
      if (event.target && event.target.id === "drawer-backdrop") closeDrawer();
    });
  }

  function bindNavActions() {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", () => switchTab(button.dataset.tab || "weekly"));
    });
  }

  function removeAdminDom() {
    document.getElementById("admin-auth-root")?.remove();
    document.querySelectorAll(".nav-admin").forEach((node) => node.remove());
    document.getElementById("admin-view")?.remove();
    document.getElementById("admin-data-view")?.remove();
  }

  function showAdminGate() {
    const shell = document.getElementById("app-shell");
    const gate = document.getElementById("admin-auth-root");
    if (shell) shell.hidden = true;
    if (gate) gate.hidden = false;
    document.getElementById("admin-auth-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("admin-auth-password");
      if (!String(input?.value || "").trim()) return;
      sessionStorage.setItem("ll.static.admin.preview", "1");
      await unlockAdminPreview();
    });
  }

  async function unlockAdminPreview() {
    document.getElementById("admin-auth-root")?.remove();
    ensureAdminDom();
    showShell();
    await prepareOptions();
    await switchTab("weekly");
  }

  function ensureAdminDom() {
    const nav = document.querySelector(".nav");
    if (nav && !nav.querySelector('[data-tab="admin"]')) {
      nav.insertAdjacentHTML("beforeend", `
        <div class="nav-group nav-admin">Admin</div>
        <button class="nav-item nav-admin" type="button" data-tab="admin"><span>M</span><b>Admin</b></button>
        <button class="nav-item nav-admin" type="button" data-tab="admin-data"><span>D</span><b>Admin Data</b></button>
      `);
    }
    const main = document.querySelector(".workspace-main");
    if (main && !document.getElementById("admin-view")) {
      main.insertAdjacentHTML("beforeend", `
        <div id="admin-view" class="tab-panel" data-panel="admin" data-render-status="skeleton" hidden></div>
        <div id="admin-data-view" class="tab-panel" data-panel="admin-data" data-render-status="skeleton" hidden></div>
      `);
    }
    bindNavActions();
  }

  function showShell() {
    const shell = document.getElementById("app-shell");
    if (shell) shell.hidden = false;
    const sourceLabel = document.getElementById("source-label");
    if (sourceLabel) sourceLabel.textContent = PAYLOAD_SOURCE;
    const generatedLabel = document.getElementById("generated-label");
    if (generatedLabel) generatedLabel.textContent = "static frontend";
    buildRailTabs();
  }

  async function prepareOptions() {
    const [assets, companies, bootstrap] = await Promise.all([
      fetchJson("data/asset-options.json").catch(() => []),
      fetchJson("data/company-options.json").catch(() => []),
      fetchJson("data/bootstrap.json").catch(() => ({})),
    ]);
    state.options.assets = Array.isArray(assets) ? assets : [];
    state.options.companies = Array.isArray(companies) ? companies : [];
    state.bootstrap = tagPayload(bootstrap, "bootstrap");

    state.selections.assetId =
      state.selections.assetId ||
      getByPath(bootstrap, ["defaults", "assetId"]) ||
      getByPath(bootstrap, ["defaultAssetPayload", "overview", "assetId"]) ||
      state.options.assets[0]?.assetId ||
      "";
    state.selections.tenantId =
      state.selections.tenantId ||
      getByPath(bootstrap, ["defaults", "tenantId"]) ||
      getByPath(bootstrap, ["defaultCompanyPayload", "profile", "tenantId"]) ||
      state.options.companies[0]?.tenantId ||
      "";

    fillSelect("asset-select", state.options.assets, "assetId", "assetName", state.selections.assetId);
    fillSelect("company-select", state.options.companies, "tenantId", "tenantMasterName", state.selections.tenantId);
  }

  function fillSelect(id, options, valueKey, labelKey, selected) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = (options || []).map((item) => {
      const value = escapeAttr(item[valueKey] || "");
      const label = escapeHtml(item[labelKey] || item[valueKey] || "선택 항목");
      const isSelected = String(item[valueKey] || "") === String(selected || "") ? " selected" : "";
      return `<option value="${value}"${isSelected}>${label}</option>`;
    }).join("");
  }

  function buildRailTabs() {
    const target = document.getElementById("rail-tabs");
    if (!target) return;
    const tabs = state.role === "admin" ? TAB_ORDER : PUBLIC_TABS;
    target.innerHTML = tabs.map((tab) => {
      const meta = TAB_META[tab];
      return `<button class="rail-btn" type="button" data-rail-tab="${escapeAttr(tab)}">${escapeHtml(meta.title)}</button>`;
    }).join("");
    target.querySelectorAll("[data-rail-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.railTab || "weekly"));
    });
  }

  async function switchTab(tab) {
    const requested = normalizeTab(tab);
    if (requested !== state.activeTab) state.activeTab = requested;
    updateShellForTab(requested);
    await renderCurrentTab(false);
  }

  function normalizeTab(tab) {
    const requested = String(tab || "weekly");
    if (state.role !== "admin" && !PUBLIC_TABS.includes(requested)) return "weekly";
    return TAB_META[requested] ? requested : "weekly";
  }

  function updateShellForTab(tab) {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tab);
    });
    document.querySelectorAll("[data-rail-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.railTab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      const active = panel.dataset.panel === tab;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });

    const meta = TAB_META[tab] || TAB_META.weekly;
    setText("page-title", meta.title);
    setText("page-eyebrow", meta.group);
    document.getElementById("asset-select").hidden = tab !== "asset";
    document.getElementById("company-select").hidden = tab !== "company";
  }

  async function renderCurrentTab(force) {
    const tab = state.activeTab;
    const panel = getPanel(tab);
    if (!panel) return;
    const cacheKey = buildCacheKey(tab);
    if (!force && state.pageCache[cacheKey]) {
      renderPayload(tab, state.pageCache[cacheKey]);
      return;
    }
    panel.dataset.renderStatus = "rendering";
    try {
      const payload = await loadTabPayload(tab);
      state.pageCache[cacheKey] = payload;
      state.pageCache[tab] = payload;
      state.lastSuccessfulPayloads[tab] = payload;
      state.activePayload = payload;
      state.renderCounts[tab] = (state.renderCounts[tab] || 0) + 1;
      renderPayload(tab, payload);
    } catch (error) {
      panel.innerHTML = renderSourceLine() + renderEmpty(`화면 데이터를 읽지 못했습니다: ${escapeHtml(error.message || String(error))}`);
      panel.dataset.renderStatus = "error";
    }
  }

  function renderPayload(tab, payload) {
    const panel = getPanel(tab);
    if (!panel) return;
    const renderers = {
      weekly: renderWeekly,
      home: renderHome,
      asset: renderAsset,
      company: renderCompany,
      sector: renderSector,
      tools: renderTools,
      playground: renderPlayground,
      quality: renderQuality,
      admin: renderAdmin,
      "admin-data": renderAdminData,
    };
    panel.innerHTML = renderSourceLine(payload) + (renderers[tab] || renderGeneric)(payload);
    panel.dataset.renderStatus = "ready";
    bindPanelActions(panel, tab, payload);
    updateRailIndex(panel);
  }

  async function loadTabPayload(tab) {
    if (tab === "asset") {
      const assetId = state.selections.assetId || state.options.assets[0]?.assetId;
      const payload = await fetchJson(`data/asset/${encodeURIComponent(assetId)}.json`);
      return tagPayload(payload, tab);
    }
    if (tab === "company") {
      const tenantId = state.selections.tenantId || state.options.companies[0]?.tenantId;
      const payload = await fetchJson(`data/company/${encodeURIComponent(tenantId)}.json`);
      return tagPayload(payload, tab);
    }
    if (tab === "quality") return buildQualityPayload();
    if (tab === "admin") return buildAdminPayload();
    if (tab === "admin-data") return buildAdminDataPayload();
    const payload = await fetchJson(TAB_META[tab].file);
    return tagPayload(payload, tab);
  }

  async function fetchJson(path) {
    if (memoryCache.has(path)) return memoryCache.get(path);
    const storageKey = CACHE_PREFIX + path;
    const cached = sessionStorage.getItem(storageKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      memoryCache.set(path, parsed);
      return parsed;
    }
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    const text = await response.text();
    const parsed = JSON.parse(text);
    memoryCache.set(path, parsed);
    try {
      sessionStorage.setItem(storageKey, text);
    } catch (_error) {
      // Large local snapshots can exceed the browser storage quota. Memory cache still covers tab revisits.
    }
    return parsed;
  }

  function tagPayload(payload, tab) {
    const base = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { value: payload };
    const meta = Object.assign({}, base.meta || {}, {
      payloadSource: PAYLOAD_SOURCE,
      dataSourceMode: DATA_SOURCE_MODE,
      tab,
    });
    return Object.assign({}, base, {
      __payloadSource: PAYLOAD_SOURCE,
      payloadSource: PAYLOAD_SOURCE,
      dataSourceMode: DATA_SOURCE_MODE,
      meta,
    });
  }

  function renderWeekly(report) {
    const summary = report.summary || {};
    const assetRows = report.assetRows || [];
    const kpis = [
      ["총 자산 수", `${formatNumber(summary.assetCount || assetRows.length)}개`, "주간업무자료"],
      ["총 연면적", `${formatNumber(summary.totalGrossAreaPy)}평`, "주간업무자료"],
      ["완전 임대", `${formatNumber(summary.fullyLeasedCount)}개`, "임대율 100%"],
      ["Lease-up", `${formatNumber(summary.leaseUpIssueCount)}건`, "Main Issue"],
      ["Risk 자산", `${formatNumber(summary.riskAssetCount)}개`, "운용/Exit 표시"],
    ];
    const projectHeaders = ["Project", "개요", "투자/자금", "현황", "계획"];
    const projectRows = (items) => items.map((row) => [
      row.projectName || row.no || "-",
      row.overview || "-",
      row.investment || row.funding || row.expectedAum || "-",
      row.status || row.issue || "-",
      row.plan || "-",
    ]);
    const coreHeaders = ["No", "자산명", "펀드", "종류", "연면적(평)", "임대율", "주요 임차사", "Main Issue"];
    const fullHeaders = ["No", "자산명", "펀드", "종류", "원가", "현재시점대비", "준공", "연면적(평)", "저온비율", "임대율", "주요 임차사", "Fund 만기", "Loan 만기", "Main Issue"];
    const full = state.selections.weeklyAssetView === "full";
    const assetTableRows = assetRows.map((row) => full
      ? [row.no, row.assetName, row.fundName, row.assetType, row.costPerPy, row.costTrend, row.completion, row.grossAreaPy, row.coldRatio, row.occupancyRate, row.mainTenant, row.fundMaturity, row.loanMaturity, row.mainIssue]
      : [row.no, row.assetName, row.fundName, row.assetType, row.grossAreaPy, row.occupancyRate, row.mainTenant, row.mainIssue]);

    return `
      <div class="page-stack weekly-report-page">
        ${kpiGrid(kpis)}
        ${section("신규 투자 Projects", "Weekly", renderTable(projectHeaders, projectRows(report.newProjects || []), { compact: true }))}
        ${section("관리 Projects", "Weekly", renderTable(projectHeaders, projectRows(report.managementProjects || []), { compact: true }))}
        ${section("자산현황", "Weekly", `
          <div class="toolbar">
            <div class="segmented" role="tablist" aria-label="자산현황 보기 전환">
              <button class="segment-btn ${full ? "" : "active"}" type="button" data-weekly-view="core">운영 핵심 보기</button>
              <button class="segment-btn ${full ? "active" : ""}" type="button" data-weekly-view="full">원문 전체 보기</button>
            </div>
            <span class="chip">${formatNumber(assetRows.length)} rows</span>
          </div>
          ${renderTable(full ? fullHeaders : coreHeaders, assetTableRows, { compact: true })}
        `)}
        ${section("기준 및 기타사항", "Weekly", `
          ${renderTable(["구분", "내용"], (report.notes || []).map((note) => [note.title, note.body]), { compact: true })}
          ${keyValueGrid({
            reportTitle: report.reportTitle,
            reportDate: report.reportDate,
            schemaVersion: report.schemaVersion,
            source: report.source,
            generatedAt: report.generatedAt,
          })}
        `)}
      </div>
    `;
  }

  function renderHome(home) {
    const occupancy = home.occupancy || {};
    const kpis = normalizeKpis(home.kpis);
    return `
      <div class="page-stack">
        ${kpiGrid(kpis)}
        ${section("Portfolio Snapshot", "Home", `
          <div class="split">
            ${infoCard("Occupancy", keyValueGrid({
              grossFloorAreaSqm: formatArea(occupancy.grossFloorAreaSqm),
              leasedAreaSqm: formatArea(occupancy.leasedAreaSqm),
              vacancyAreaSqm: formatArea(occupancy.vacancyAreaSqm),
              vacancyRate: formatPercent(occupancy.vacancyRate),
            }))}
            ${infoCard("Contract Summary", keyValueGrid(home.contractSummary || {}))}
          </div>
        `)}
        ${section("Top Tenants", "Home", renderTableFromObjects(home.topTenants || home.tenantSummary || [], ["tenantMasterName", "assetCount", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "averageENoc"], 12))}
        ${section("Vacancy", "Home", renderTableFromObjects(home.vacancySummary || [], ["assetName", "grossFloorAreaSqm", "vacancyAreaSqm", "vacancyRate"], 12))}
        ${section("Rent Trend", "Home", renderTableFromObjects((home.rentTrend || []).slice(-18), ["month", "activeAssetCount", "leasedAreaSqm", "grossFloorAreaSqm", "monthlyRentTotal", "monthlyCostTotalAdjusted"], 18))}
        ${section("Map Points", "Home", renderTableFromObjects(home.mapPoints || [], ["assetName", "address", "latitude", "longitude", "issueCount"], 20))}
      </div>
    `;
  }

  function renderAsset(asset) {
    const overview = asset.overview || {};
    const title = overview.assetName || selectedAssetName();
    return `
      <div class="page-stack">
        ${section(title, "Asset", `
          ${kpiGrid(normalizeKpis(asset.kpis))}
          ${keyValueGrid(overview)}
        `)}
        ${section("Leases", "Asset", renderTableFromObjects(asset.rows || [], ["tenantMasterName", "floor", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "monthlyCostTotal", "currentStartDate", "currentEndDate"], 80))}
        ${section("Top Tenants", "Asset", renderTableFromObjects(asset.topTenants || [], ["tenantMasterName", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "averageENoc"], 20))}
        ${section("Stacking Plan", "Asset", renderTableFromObjects(asset.stackingPlan || [], null, 80))}
        ${section("Area Breakdown", "Asset", keyValueGrid(asset.areaBreakdown || {}))}
      </div>
    `;
  }

  function renderCompany(company) {
    const profile = company.profile || {};
    const title = profile.tenantMasterName || selectedCompanyName();
    return `
      <div class="page-stack">
        ${section(title, "Company", `
          ${kpiGrid(normalizeKpis(company.kpis))}
          ${keyValueGrid(profile)}
        `)}
        ${section("Leased Assets", "Company", renderTableFromObjects(company.leasedAssets || [], ["assetName", "leasedAreaSqm", "monthlyCostTotal", "currentEndDate", "sector", "goodsType"], 40))}
        ${section("Lease Rows", "Company", renderTableFromObjects(company.rows || [], ["assetName", "floor", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "monthlyCostTotal", "currentStartDate", "currentEndDate"], 80))}
        ${section("Financials", "Company", renderTableFromObjects(company.financials || [], null, 20))}
        ${section("Operations", "Company", keyValueGrid(company.operations || {}))}
      </div>
    `;
  }

  function renderSector(sector) {
    return `
      <div class="page-stack">
        ${kpiGrid(objectToKpis(sector.kpis || {}))}
        ${section("Region Exposure", "Sector", renderTableFromObjects(sector.regionExposure || [], ["region", "assetCount", "grossFloorAreaSqm", "leasedAreaSqm", "vacancyRate", "monthlyCostTotal"], 20))}
        ${section("Expiry Buckets", "Sector", renderTableFromObjects(sector.expiryBuckets || [], null, 20))}
        ${section("Expiry Rows", "Sector", renderTableFromObjects(sector.expiryRows || [], ["expiryMonth", "tenantMasterName", "assetName", "leasedAreaSqm", "monthlyCostTotal", "eNoc", "monthsToExpiry"], 60))}
        ${section("Rankings", "Sector", renderRankingTables(sector.rankings || {}))}
        ${section("Trends", "Sector", keyValueGrid(sector.trends || {}))}
      </div>
    `;
  }

  function renderTools(tools) {
    return `
      <div class="page-stack">
        ${kpiGrid(objectToKpis(Object.assign({}, tools.deltas || {}, tools.divergence || {})))}
        ${section("Selection", "Analysis Tools", keyValueGrid(tools.selectionMeta || {}))}
        ${section("Assets", "Analysis Tools", renderTableFromObjects(tools.assets || [], ["assetName", "tenantMasterName", "leasedAreaSqm", "monthlyCostTotal", "vacancyRate"], 30))}
        ${section("Companies", "Analysis Tools", renderTableFromObjects(tools.companies || [], ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyCostTotal", "eNoc"], 30))}
        ${section("Contracts", "Analysis Tools", renderTableFromObjects(tools.contracts || [], ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "monthlyCostTotal", "currentEndDate"], 80))}
        ${section("Benchmark", "Analysis Tools", renderTableFromObjects(tools.benchmarkRows || [], null, 20))}
      </div>
    `;
  }

  function renderPlayground(playground) {
    return `
      <div class="page-stack">
        ${kpiGrid(normalizeKpis(playground.summaryCards))}
        ${section("Query", "Data Playground", `
          <div class="split">
            ${infoCard("Current Query", keyValueGrid(playground.query || {}))}
            ${infoCard("Saved Views", renderTableFromObjects(playground.savedViews || [], ["label", "rowDimension", "columnDimension", "valueMetric", "topN"], 10))}
          </div>
        `)}
        ${section("Rows", "Data Playground", renderTableFromObjects(playground.rows || [], null, 80))}
        ${section("Source Rows", "Data Playground", renderTableFromObjects(playground.sourceRows || [], ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyCostTotal", "sector", "goodsType"], 80))}
      </div>
    `;
  }

  function renderQuality(payload) {
    return `
      <div class="page-stack">
        ${kpiGrid(payload.kpis)}
        ${section("Snapshot Files", "Data Quality", renderTableFromObjects(payload.files, ["name", "type", "rows", "status"], 80))}
        ${section("Loaded Payloads", "Data Quality", renderTableFromObjects(payload.loadedTabs, ["tab", "status", "rows", "source"], 20))}
        ${section("Rules", "Data Quality", renderTable(["항목", "상태"], [
          ["화면 서버 호출", "사용 안 함"],
          ["외부 런타임 브리지", "사용 안 함"],
          ["민감 키 노출", "없음"],
          ["데이터 원본", PAYLOAD_SOURCE],
        ]))}
      </div>
    `;
  }

  function renderAdmin(payload) {
    return `
      <div class="page-stack">
        ${section("Static Admin Preview", "Admin", `
          <div class="admin-password-gate">
            ${kpiGrid(payload.kpis)}
            <p class="page-note">이 화면은 정적 프론트 전환 상태를 확인하는 읽기전용 미리보기입니다. 저장, 동기화, 삭제 기능은 연결하지 않았습니다.</p>
          </div>
        `)}
        ${section("Runtime", "Admin", keyValueGrid(payload.runtime))}
        ${section("Available Data", "Admin", renderTableFromObjects(payload.files, ["name", "rows", "status"], 80))}
      </div>
    `;
  }

  function renderAdminData(payload) {
    return `
      <div class="page-stack admin-data-workspace">
        ${section("Admin Data", "Admin", `
          <p class="page-note admin-data-api-note">현재는 GitHub Pages 정적 JSON을 읽기전용으로 표시합니다. 쓰기 작업은 별도 backend 확정 후 연결합니다.</p>
          <div id="admin-data-table">
            ${renderTableFromObjects(payload.files, ["name", "type", "rows", "source", "status"], 120)}
          </div>
        `)}
        ${section("Cache", "Admin", renderTableFromObjects(payload.cache, ["key", "status"], 80))}
      </div>
    `;
  }

  function renderGeneric(payload) {
    return `<div class="page-stack">${section("Payload", "Static", keyValueGrid(payload || {}))}</div>`;
  }

  function buildQualityPayload() {
    const files = buildFileInventory();
    const loadedTabs = PUBLIC_TABS.map((tab) => {
      const payload = state.lastSuccessfulPayloads[tab];
      return {
        tab,
        status: payload ? "ready" : "not visited",
        rows: estimateRows(payload),
        source: payload ? PAYLOAD_SOURCE : "-",
      };
    });
    return tagPayload({
      kpis: [
        ["Snapshot files", formatNumber(files.length), "docs/data"],
        ["Asset files", formatNumber(state.options.assets.length), "asset"],
        ["Company files", formatNumber(state.options.companies.length), "company"],
        ["Loaded tabs", formatNumber(loadedTabs.filter((item) => item.status === "ready").length), "client cache"],
      ],
      files,
      loadedTabs,
    }, "quality");
  }

  function buildAdminPayload() {
    const files = buildFileInventory();
    return tagPayload({
      kpis: [
        ["Mode", "Read only", "static frontend"],
        ["Payload", PAYLOAD_SOURCE, DATA_SOURCE_MODE],
        ["Files", formatNumber(files.length), "docs/data"],
        ["Admin write", "Off", "backend 미연결"],
      ],
      runtime: {
        dataSourceMode: DATA_SOURCE_MODE,
        payloadSource: PAYLOAD_SOURCE,
        screenRuntime: "static files",
        externalRuntimeBridge: "not used",
        frontendSecretKey: "none",
      },
      files,
    }, "admin");
  }

  function buildAdminDataPayload() {
    return tagPayload({
      files: buildFileInventory(),
      cache: Object.keys(state.pageCache).sort().map((key) => ({ key, status: "cached" })),
    }, "admin-data");
  }

  function buildFileInventory() {
    return [
      { name: "weekly.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.weekly), source: PAYLOAD_SOURCE, status: "ready" },
      { name: "home.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.home), source: PAYLOAD_SOURCE, status: "ready" },
      { name: "sector.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.sector), source: PAYLOAD_SOURCE, status: "ready" },
      { name: "tools.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.tools), source: PAYLOAD_SOURCE, status: "ready" },
      { name: "playground.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.playground), source: PAYLOAD_SOURCE, status: "ready" },
      { name: "asset/*.json", type: "entity", rows: state.options.assets.length, source: PAYLOAD_SOURCE, status: "ready" },
      { name: "company/*.json", type: "entity", rows: state.options.companies.length, source: PAYLOAD_SOURCE, status: "ready" },
    ];
  }

  function normalizeKpis(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
      if (Array.isArray(item)) return item;
      return [item.label || item.key || "Metric", item.value != null ? item.value : "-", item.status || item.valueType || ""];
    });
  }

  function objectToKpis(obj) {
    return Object.entries(obj || {}).map(([key, value]) => [labelize(key), formatCell(value), ""]);
  }

  function kpiGrid(items) {
    const rows = (items || []).filter(Boolean);
    if (!rows.length) return "";
    return `
      <div class="kpi-grid summary-strip">
        ${rows.map((item) => `
          <article class="kpi info-card">
            <div class="kpi-label">${escapeHtml(item[0])}</div>
            <div class="kpi-value">${escapeHtml(formatCell(item[1]))}</div>
            ${item[2] ? `<div class="kpi-note">${escapeHtml(formatCell(item[2]))}</div>` : ""}
          </article>
        `).join("")}
      </div>
    `;
  }

  function section(title, kicker, body) {
    return `
      <section class="section iota-section-card panel-card" data-section-title="${escapeAttr(title)}">
        <div class="section-head">
          <div>
            <div class="section-kicker">${escapeHtml(kicker || "")}</div>
            <h2 class="section-title">${escapeHtml(title)}</h2>
          </div>
        </div>
        <div class="section-body">${body || ""}</div>
      </section>
    `;
  }

  function infoCard(title, body) {
    return `
      <article class="info-card">
        <h3>${escapeHtml(title)}</h3>
        ${body || ""}
      </article>
    `;
  }

  function renderSourceLine(payload) {
    const generated = payload?.generatedAt || payload?.meta?.generatedAt || state.bootstrap?.generatedAt || "";
    return `
      <div class="source-line">
        <span class="iota-source-chip">${PAYLOAD_SOURCE}</span>
        <span class="chip">${DATA_SOURCE_MODE}</span>
        ${generated ? `<span class="chip">${escapeHtml(formatDate(generated))}</span>` : ""}
      </div>
    `;
  }

  function renderTableFromObjects(rows, preferredKeys, limit) {
    const list = Array.isArray(rows) ? rows.slice(0, limit || rows.length) : [];
    if (!list.length) return renderEmpty("표시할 행이 없습니다.");
    const keys = preferredKeys && preferredKeys.length ? preferredKeys : inferKeys(list);
    return renderTable(keys.map(labelize), list.map((row) => keys.map((key) => row?.[key])), { compact: true });
  }

  function renderTable(headers, rows, options) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) return renderEmpty("표시할 행이 없습니다.");
    return `
      <div class="table-wrap ${options?.compact ? "compact-table" : ""}">
        <table>
          <thead>
            <tr>${headers.map((header) => `<th>${escapeHtml(formatCell(header))}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${safeRows.map((row) => `<tr>${(Array.isArray(row) ? row : [row]).map((cell) => `<td>${formatCellHtml(cell)}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function keyValueGrid(obj) {
    const entries = Object.entries(obj || {}).filter(([, value]) => value !== undefined);
    if (!entries.length) return renderEmpty("표시할 값이 없습니다.");
    return `
      <div class="key-grid">
        ${entries.map(([key, value]) => `
          <div class="key-item">
            <dt>${escapeHtml(labelize(key))}</dt>
            <dd>${formatCellHtml(value)}</dd>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderRankingTables(rankings) {
    const entries = Object.entries(rankings || {});
    if (!entries.length) return renderEmpty("표시할 랭킹이 없습니다.");
    return entries.map(([key, rows]) => infoCard(labelize(key), renderTableFromObjects(rows || [], null, 12))).join("");
  }

  function renderEmpty(message) {
    return `<div class="empty state-shell">${message}</div>`;
  }

  function bindPanelActions(panel, tab, payload) {
    panel.querySelectorAll("[data-weekly-view]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selections.weeklyAssetView = button.dataset.weeklyView || "core";
        renderPayload(tab, payload);
      });
    });
  }

  function updateRailIndex(panel) {
    const target = document.getElementById("rail-index");
    if (!target || !panel) return;
    const headings = Array.from(panel.querySelectorAll(".section-title"));
    target.innerHTML = headings.map((heading, index) => {
      const id = `rail_section_${index}`;
      heading.id = id;
      return `<button class="rail-link" type="button" data-scroll-target="${id}">${escapeHtml(heading.textContent || `Section ${index + 1}`)}</button>`;
    }).join("");
    target.querySelectorAll("[data-scroll-target]").forEach((button) => {
      button.addEventListener("click", () => document.getElementById(button.dataset.scrollTarget)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    });
  }

  function buildCacheKey(tab) {
    if (tab === "asset") return `page:asset:${state.selections.assetId || "default"}`;
    if (tab === "company") return `page:company:${state.selections.tenantId || "default"}`;
    return `page:${tab}:default`;
  }

  function getPanel(tab) {
    return document.getElementById(`${tab}-view`) || document.querySelector(`.tab-panel[data-panel="${tab}"]`);
  }

  function selectedAssetName() {
    return state.options.assets.find((item) => item.assetId === state.selections.assetId)?.assetName || "Asset";
  }

  function selectedCompanyName() {
    return state.options.companies.find((item) => item.tenantId === state.selections.tenantId)?.tenantMasterName || "Company";
  }

  function inferKeys(rows) {
    const keys = [];
    rows.slice(0, 8).forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        if (!keys.includes(key) && keys.length < 8) keys.push(key);
      });
    });
    return keys;
  }

  function estimateRows(payload) {
    if (!payload || typeof payload !== "object") return 0;
    let count = 0;
    Object.values(payload).forEach((value) => {
      if (Array.isArray(value)) count += value.length;
    });
    return count;
  }

  function formatCellHtml(value) {
    return escapeHtml(formatCell(value));
  }

  function formatCell(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "number") return formatNumber(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return `${formatNumber(value.length)} items`;
    if (typeof value === "object") {
      const entries = Object.entries(value).slice(0, 4);
      if (!entries.length) return "-";
      return entries.map(([key, child]) => `${labelize(key)}: ${formatNested(child)}`).join(" / ");
    }
    return String(value);
  }

  function formatNested(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "number") return formatNumber(value);
    if (Array.isArray(value)) return `${formatNumber(value.length)} items`;
    if (typeof value === "object") return `${formatNumber(Object.keys(value).length)} fields`;
    return String(value);
  }

  function labelize(key) {
    return String(key || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return value == null ? "-" : String(value);
    if (Math.abs(num) > 1000) return Math.round(num).toLocaleString("ko-KR");
    if (!Number.isInteger(num)) return num.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
    return num.toLocaleString("ko-KR");
  }

  function formatPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    const normalized = Math.abs(num) <= 1 ? num * 100 : num;
    return `${normalized.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
  }

  function formatArea(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return `${formatNumber(num)} sqm`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function getByPath(obj, path) {
    return path.reduce((current, key) => current && current[key], obj);
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function setTheme(theme) {
    const selected = theme === "light" ? "light" : "dark";
    document.body.dataset.theme = selected;
    document.body.dataset.themeResolved = selected;
    localStorage.setItem("ll.static.theme", selected);
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.classList.toggle("active", button.dataset.themeChoice === selected);
    });
  }

  function openDrawer(title, body) {
    const backdrop = document.getElementById("drawer-backdrop");
    const content = document.getElementById("drawer-content");
    if (!backdrop || !content) return;
    content.innerHTML = `<h2>${escapeHtml(title)}</h2>${body || ""}`;
    backdrop.hidden = false;
  }

  function closeDrawer() {
    const backdrop = document.getElementById("drawer-backdrop");
    if (backdrop) backdrop.hidden = true;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
