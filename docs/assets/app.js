(function () {
  "use strict";

  const DATA_SOURCE_MODE = "supabase_snapshot";
  const PAYLOAD_SOURCE = "supabase_snapshot";
  const FALLBACK_PAYLOAD_SOURCE = "github_snapshot";
  const FALLBACK_DATA_SOURCE_MODE = "static";
  const SUPABASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P";
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

  const LABELS = {
    activeAssetCount: "운영 자산 수",
    address: "주소",
    assetCount: "자산 수",
    assetId: "자산 ID",
    assetName: "자산명",
    assetType: "자산 유형",
    averageENoc: "평균 E.NOC",
    businessRegistrationNo: "사업자등록번호",
    coldRatio: "저온 비중",
    coldStorageType: "저온/상온",
    completion: "준공",
    contractActiveAssetCount: "계약 반영 자산 수",
    currentEndDate: "계약만기일",
    currentMonthlyCostTotal: "월 임관리비",
    currentStartDate: "계약시작일",
    detailAreaLabel: "세부 구역",
    eNoc: "E.NOC",
    exclusiveAreaSqm: "전용면적(㎡)",
    expiryMonth: "만기월",
    floor: "층",
    floorLabel: "층",
    fundCode: "펀드 코드",
    fundMaturity: "펀드 만기",
    fundName: "펀드명",
    goodsType: "화물 유형",
    grossAreaPy: "연면적(평)",
    grossFloorAreaSqm: "연면적(㎡)",
    issueCount: "이슈 수",
    latestExpiry: "최근 만기",
    leaseId: "계약 ID",
    leaseSpaceCount: "임대 구역 수",
    leasedAreaPy: "임대면적(평)",
    leasedAreaSqm: "임대면적(㎡)",
    loanMaturity: "대출 만기",
    mainIssue: "주요 이슈",
    mainTenant: "주요 임차인",
    monthlyCostTotal: "월 임관리비",
    monthlyCostTotalAdjusted: "월 임관리비(RF/FO 반영)",
    monthlyMfTotal: "월 관리비",
    monthlyRentTotal: "월 임대료",
    monthlyRentTotalAdjusted: "월 임대료(RF/FO 반영)",
    monthsToExpiry: "잔여 개월",
    no: "No.",
    occupancyRate: "임대율",
    region: "권역",
    rentPerPy: "평당 임대료",
    rowCount: "행 수",
    rowNumber: "원본 행",
    sector: "섹터",
    tenantId: "임차인 ID",
    tenantMasterName: "임차인명",
    totalFloorAreaSqm: "총 면적(㎡)",
    totalGrossAreaSqm: "총 연면적(㎡)",
    vacancyAreaSqm: "공실면적(㎡)",
    vacancyRate: "공실률",
    value: "값",
    valueMetric: "집계 지표",
    recordCount: "건수",
    dimension: "차원",
    month: "월",
    label: "구분",
    count: "건수",
    status: "상태",
    source: "원본",
    source_system: "원본 시스템",
    generatedAt: "생성 시각",
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
    dataSourceMode: FALLBACK_DATA_SOURCE_MODE,
    payloadSource: FALLBACK_PAYLOAD_SOURCE,
  };

  const memoryCache = new Map();

  window.RUNTIME_CLIENT_CONFIG = Object.assign({}, window.RUNTIME_CLIENT_CONFIG || {}, {
    dataSourceMode: FALLBACK_DATA_SOURCE_MODE,
    payloadSource: FALLBACK_PAYLOAD_SOURCE,
    preferredDataSourceMode: DATA_SOURCE_MODE,
    preferredPayloadSource: PAYLOAD_SOURCE,
    supabaseConfigured: true,
    supabaseUrlConfigured: true,
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
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDrawer();
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
    if (sourceLabel) sourceLabel.textContent = state.payloadSource || FALLBACK_PAYLOAD_SOURCE;
    const generatedLabel = document.getElementById("generated-label");
    if (generatedLabel) generatedLabel.textContent = state.dataSourceMode || FALLBACK_DATA_SOURCE_MODE;
    buildRailTabs();
  }

  async function prepareOptions() {
    const bootstrap = await loadSnapshotWithFallback("bootstrap", "shell", "data/bootstrap.json").catch(() => ({}));
    const bootstrapAssets = Array.isArray(bootstrap.assetOptions) && bootstrap.assetOptions.length ? bootstrap.assetOptions : null;
    const bootstrapCompanies = Array.isArray(bootstrap.companyOptions) && bootstrap.companyOptions.length ? bootstrap.companyOptions : null;
    const [assets, companies] = await Promise.all([
      bootstrapAssets ? [] : fetchJson("data/asset-options.json").catch(() => []),
      bootstrapCompanies ? [] : fetchJson("data/company-options.json").catch(() => []),
    ]);
    state.options.assets = bootstrapAssets || (Array.isArray(assets) ? assets : []);
    state.options.companies = bootstrapCompanies || (Array.isArray(companies) ? companies : []);
    state.bootstrap = bootstrap && bootstrap.meta ? bootstrap : tagPayload(bootstrap, "bootstrap", FALLBACK_PAYLOAD_SOURCE, FALLBACK_DATA_SOURCE_MODE);

    const assetCandidate =
      state.selections.assetId ||
      getByPath(bootstrap, ["defaults", "assetId"]) ||
      getByPath(bootstrap, ["defaultAssetPayload", "overview", "assetId"]);
    state.selections.assetId = optionExists(state.options.assets, "assetId", assetCandidate)
      ? assetCandidate
      : (state.options.assets.find((item) => item.assetId)?.assetId || assetCandidate || "");

    const tenantCandidate =
      state.selections.tenantId ||
      getByPath(bootstrap, ["defaults", "tenantId"]) ||
      getByPath(bootstrap, ["defaultCompanyPayload", "profile", "tenantId"]);
    state.selections.tenantId = optionExists(state.options.companies, "tenantId", tenantCandidate) && isUsableTenantId(tenantCandidate)
      ? tenantCandidate
      : (state.options.companies.find((item) => isUsableTenantId(item.tenantId))?.tenantId || state.options.companies[0]?.tenantId || tenantCandidate || "");

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
    state.detailStore = {};
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
    setText("source-label", payload?.payloadSource || state.payloadSource || FALLBACK_PAYLOAD_SOURCE);
    setText("generated-label", payload?.dataSourceMode || state.dataSourceMode || FALLBACK_DATA_SOURCE_MODE);
    bindPanelActions(panel, tab, payload);
    updateRailIndex(panel);
  }

  async function loadTabPayload(tab) {
    if (tab === "asset") {
      const assetId = state.selections.assetId || state.options.assets[0]?.assetId;
      return loadSnapshotWithFallback(tab, assetId, `data/asset/${encodeURIComponent(assetId)}.json`);
    }
    if (tab === "company") {
      const tenantId = state.selections.tenantId || state.options.companies[0]?.tenantId;
      return loadSnapshotWithFallback(tab, tenantId, `data/company/${encodeURIComponent(tenantId)}.json`);
    }
    if (tab === "quality") return buildQualityPayload();
    if (tab === "admin") return buildAdminPayload();
    if (tab === "admin-data") return buildAdminDataPayload();
    return loadSnapshotWithFallback(tab, "default", TAB_META[tab].file);
  }

  async function loadSnapshotWithFallback(tab, entityId, fallbackPath) {
    try {
      if (!shouldUseSupabaseSnapshots()) {
        throw new Error("supabase snapshot disabled for local static QA");
      }
      return await fetchSupabaseSnapshot(tab, entityId);
    } catch (error) {
      const payload = await fetchJson(fallbackPath);
      const tagged = tagPayload(payload, tab, FALLBACK_PAYLOAD_SOURCE, FALLBACK_DATA_SOURCE_MODE);
      tagged.supabaseFallbackReason = error && error.message ? error.message : String(error);
      return tagged;
    }
  }

  function shouldUseSupabaseSnapshots() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("source") === "supabase") return true;
    if (params.get("source") === "github") return false;
    const host = window.location.hostname.toLowerCase();
    if (host === "127.0.0.1" || host === "localhost") return false;
    return true;
  }

  async function fetchSupabaseSnapshot(tab, entityId) {
    const page = encodeURIComponent(tab);
    const entity = encodeURIComponent(entityId || "default");
    const query = [
      "select=payload,generated_at,source,source_system,schema_version,page,entity_id,snapshot_key",
      "user_safe=eq.true",
      `page=eq.${page}`,
      `entity_id=eq.${entity}`,
      "order=generated_at.desc",
      "limit=1",
    ].join("&");
    const url = `${SUPABASE_URL}/rest/v1/ll_payload_snapshots?${query}`;
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`supabase snapshot HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows.length || !rows[0].payload) {
      throw new Error(`supabase snapshot empty: ${tab}/${entityId || "default"}`);
    }
    const row = rows[0];
    const payload = Object.assign({}, row.payload || {}, {
      generatedAt: row.payload?.generatedAt || row.generated_at,
      schemaVersion: row.payload?.schemaVersion || row.schema_version,
    });
    return tagPayload(payload, tab, row.source || PAYLOAD_SOURCE, DATA_SOURCE_MODE, row);
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

  function tagPayload(payload, tab, payloadSource, dataSourceMode, sourceRow) {
    const source = payloadSource || PAYLOAD_SOURCE;
    const mode = dataSourceMode || DATA_SOURCE_MODE;
    const base = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { value: payload };
    const meta = Object.assign({}, base.meta || {}, {
      payloadSource: source,
      dataSourceMode: mode,
      tab,
      supabaseSnapshotKey: sourceRow?.snapshot_key,
      sourceSystem: sourceRow?.source_system,
    });
    state.payloadSource = source;
    state.dataSourceMode = mode;
    window.RUNTIME_CLIENT_CONFIG = Object.assign({}, window.RUNTIME_CLIENT_CONFIG || {}, {
      dataSourceMode: mode,
      payloadSource: source,
      supabaseConfigured: true,
      supabaseUrlConfigured: true,
      supabaseServiceRoleKeyConfigured: false,
    });
    return Object.assign({}, base, {
      __payloadSource: source,
      payloadSource: source,
      dataSourceMode: mode,
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
    const rentTrend = (home.rentTrend || []).slice(-18);
    const mapPoints = home.mapPoints || [];
    return `
      <div class="page-stack">
        ${kpiGrid(kpis, "home_kpi")}
        ${section("포트폴리오 스냅샷", "Home", `
          <div class="split">
            ${infoCard("임대 현황", keyValueGrid({
              grossFloorAreaSqm: formatArea(occupancy.grossFloorAreaSqm),
              leasedAreaSqm: formatArea(occupancy.leasedAreaSqm),
              vacancyAreaSqm: formatArea(occupancy.vacancyAreaSqm),
              vacancyRate: formatPercent(occupancy.vacancyRate),
            }))}
            ${infoCard("계약 요약", keyValueGrid(home.contractSummary || {}))}
          </div>
        `)}
        ${section("주요 임차인", "Home", renderSearchableInteractiveTable("home_tenants", home.topTenants || home.tenantSummary || [], ["tenantMasterName", "assetCount", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "averageENoc"], 12, { placeholder: "임차인 검색" }))}
        ${section("공실 현황", "Home", renderInteractiveTable("home_vacancy", home.vacancySummary || [], ["assetName", "grossFloorAreaSqm", "vacancyAreaSqm", "vacancyRate"], 12))}
        ${section("임대료 추이", "Home", `
          ${renderBarChart("home_rent_trend_chart", rentTrend, "month", "monthlyCostTotalAdjusted", { title: "월 임관리비 추이" })}
          ${renderInteractiveTable("home_rent_trend", rentTrend, ["month", "activeAssetCount", "leasedAreaSqm", "grossFloorAreaSqm", "monthlyRentTotal", "monthlyCostTotalAdjusted"], 18)}
        `)}
        ${section("자산 위치", "Home", `
          ${renderMapPanel(mapPoints, "home_map")}
          ${renderInteractiveTable("home_map_points", mapPoints, ["assetName", "address", "latitude", "longitude", "issueCount"], 20)}
        `)}
      </div>
    `;
  }

  function renderAsset(asset) {
    const overview = asset.overview || {};
    const title = overview.assetName || selectedAssetName();
    return `
      <div class="page-stack">
        ${section(title, "Asset", `
          ${kpiGrid(normalizeKpis(asset.kpis), "asset_kpi")}
          ${keyValueGrid(overview)}
        `)}
        ${section("임대차 현황", "Asset", renderSearchableInteractiveTable("asset_leases", asset.rows || [], ["tenantMasterName", "floorLabel", "detailAreaLabel", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "currentMonthlyCostTotal", "currentStartDate", "currentEndDate"], 80, { placeholder: "임차인, 층, 구역 검색" }))}
        ${section("주요 임차인", "Asset", `
          ${renderBarChart("asset_top_tenants_chart", asset.topTenants || [], "tenantMasterName", "leasedAreaSqm", { title: "임차인별 임대면적" })}
          ${renderInteractiveTable("asset_top_tenants", asset.topTenants || [], ["tenantMasterName", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "averageENoc"], 20)}
        `)}
        ${section("층별 배치", "Asset", renderInteractiveTable("asset_stacking", asset.stackingPlan || [], null, 80))}
        ${section("면적 구성", "Asset", keyValueGrid(asset.areaBreakdown || {}))}
      </div>
    `;
  }

  function renderCompany(company) {
    const profile = company.profile || {};
    const title = profile.tenantMasterName || selectedCompanyName();
    return `
      <div class="page-stack">
        ${section(title, "Company", `
          ${kpiGrid(normalizeKpis(company.kpis), "company_kpi")}
          ${keyValueGrid(profile)}
        `)}
        ${section("임차 자산", "Company", `
          ${renderMapPanel(company.mapPoints || [], "company_map")}
          ${renderSearchableInteractiveTable("company_assets", company.leasedAssets || [], ["assetName", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "sector", "goodsType"], 40, { placeholder: "자산명 검색" })}
        `)}
        ${section("계약 행", "Company", renderInteractiveTable("company_rows", company.rows || [], ["assetName", "floorLabel", "detailAreaLabel", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "currentMonthlyCostTotal", "currentStartDate", "currentEndDate"], 80))}
        ${section("DART/재무 정보", "Company", renderRecordOrTable("company_financials", company.financials || {}))}
        ${section("운영 정보", "Company", keyValueGrid(company.operations || {}))}
      </div>
    `;
  }

  function renderSector(sector) {
    const monthlyRentTrend = getByPath(sector, ["trends", "monthlyRent"]) || [];
    return `
      <div class="page-stack">
        ${kpiGrid(objectToKpis(sector.kpis || {}), "sector_kpi")}
        ${section("지역별 노출", "Sector", `
          ${renderBarChart("sector_region_chart", sector.regionExposure || [], "region", "monthlyCostTotal", { title: "지역별 월 임관리비" })}
          ${renderInteractiveTable("sector_region", sector.regionExposure || [], ["region", "assetCount", "grossFloorAreaSqm", "leasedAreaSqm", "vacancyRate", "monthlyCostTotal"], 20)}
        `)}
        ${section("만기 구간", "Sector", renderInteractiveTable("sector_expiry_buckets", sector.expiryBuckets || [], null, 20))}
        ${section("만기 상세", "Sector", renderSearchableInteractiveTable("sector_expiry_rows", sector.expiryRows || [], ["expiryMonth", "tenantMasterName", "assetName", "leasedAreaSqm", "monthlyCostTotal", "eNoc", "monthsToExpiry"], 60, { placeholder: "자산/임차인/만기월 검색" }))}
        ${section("랭킹", "Sector", renderRankingTables(sector.rankings || {}))}
        ${section("추이", "Sector", `
          ${renderBarChart("sector_rent_trend", monthlyRentTrend, "month", "monthlyCostTotal", { title: "월 임관리비 추이" })}
          ${keyValueGrid(sector.trends || {})}
        `)}
      </div>
    `;
  }

  function renderTools(tools) {
    return `
      <div class="page-stack">
        ${kpiGrid(objectToKpis(Object.assign({}, tools.deltas || {}, tools.divergence || {})), "tools_kpi")}
        ${section("선택 조건", "Analysis Tools", keyValueGrid(tools.selectionMeta || {}))}
        ${section("자산 비교", "Analysis Tools", renderSearchableInteractiveTable("tools_assets", tools.assets || [], ["assetName", "tenantMasterName", "leasedAreaSqm", "monthlyCostTotal", "vacancyRate"], 30, { placeholder: "자산/임차인 검색" }))}
        ${section("기업 비교", "Analysis Tools", renderSearchableInteractiveTable("tools_companies", tools.companies || [], ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyCostTotal", "eNoc"], 30, { placeholder: "기업/자산 검색" }))}
        ${section("계약 원장", "Analysis Tools", renderSearchableInteractiveTable("tools_contracts", tools.contracts || [], ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "monthlyCostTotal", "currentEndDate"], 80, { placeholder: "계약 원장 검색" }))}
        ${section("벤치마크", "Analysis Tools", `
          ${renderBarChart("tools_benchmark_chart", tools.benchmarkRows || [], "assetName", "leasedAreaSqm", { title: "비교 자산 임대면적" })}
          ${renderInteractiveTable("tools_benchmark", tools.benchmarkRows || [], null, 20)}
        `)}
      </div>
    `;
  }

  function renderPlayground(playground) {
    return `
      <div class="page-stack">
        ${kpiGrid(normalizeKpis(playground.summaryCards), "playground_kpi")}
        ${section("질의 조건", "Data Playground", `
          <div class="split">
            ${infoCard("현재 질의", keyValueGrid(playground.query || {}))}
            ${infoCard("저장된 보기", renderInteractiveTable("playground_saved_views", playground.savedViews || [], ["label", "rowDimension", "columnDimension", "valueMetric", "topN"], 10))}
          </div>
        `)}
        ${section("집계 결과", "Data Playground", `
          ${renderBarChart("playground_result_chart", playground.rows || [], "dimension", "value", { title: "집계 결과" })}
          ${renderInteractiveTable("playground_rows", playground.rows || [], null, 80)}
        `)}
        ${section("원본 행", "Data Playground", renderSearchableInteractiveTable("playground_source_rows", playground.sourceRows || [], ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyCostTotal", "sector", "goodsType"], 80, { placeholder: "임차인/자산/섹터 검색" }))}
      </div>
    `;
  }

  function renderQuality(payload) {
    return `
      <div class="page-stack">
        ${kpiGrid(payload.kpis, "quality_kpi")}
        ${section("스냅샷 파일", "Data Quality", renderInteractiveTable("quality_files", payload.files, ["name", "type", "rows", "status"], 80))}
        ${section("불러온 Payload", "Data Quality", renderInteractiveTable("quality_loaded", payload.loadedTabs, ["tab", "status", "rows", "source"], 20))}
        ${section("검증 규칙", "Data Quality", renderTable(["항목", "상태"], [
          ["화면 서버 호출", "사용 안 함"],
          ["외부 런타임 브리지", "사용 안 함"],
          ["민감 키 노출", "없음"],
          ["데이터 원본", state.payloadSource || FALLBACK_PAYLOAD_SOURCE],
        ]))}
      </div>
    `;
  }

  function renderAdmin(payload) {
    return `
      <div class="page-stack">
        ${section("정적 Admin 미리보기", "Admin", `
          <div class="admin-password-gate">
            ${kpiGrid(payload.kpis, "admin_kpi")}
            <p class="page-note">이 화면은 GitHub Pages 전환 상태를 확인하는 읽기전용 미리보기입니다. 저장, 동기화, 삭제 기능은 비밀키가 필요한 서버 기능으로 분리해야 합니다.</p>
          </div>
        `)}
        ${section("Runtime", "Admin", keyValueGrid(payload.runtime))}
        ${section("사용 가능한 데이터", "Admin", renderInteractiveTable("admin_files", payload.files, ["name", "rows", "status"], 80))}
      </div>
    `;
  }

  function renderAdminData(payload) {
    return `
      <div class="page-stack admin-data-workspace">
        ${section("Admin Data", "Admin", `
          <p class="page-note admin-data-api-note">현재는 GitHub Pages 정적 JSON과 Supabase snapshot 전환 상태를 읽기전용으로 표시합니다. 쓰기 작업은 서버 전용 API 확정 후 연결합니다.</p>
          <div id="admin-data-table">
            ${renderInteractiveTable("admin_data_files", payload.files, ["name", "type", "rows", "source", "status"], 120)}
          </div>
        `)}
        ${section("Cache", "Admin", renderInteractiveTable("admin_data_cache", payload.cache, ["key", "status"], 80))}
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
        source: payload ? (payload.payloadSource || payload.meta?.payloadSource || state.payloadSource || FALLBACK_PAYLOAD_SOURCE) : "-",
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
        ["Payload", state.payloadSource || FALLBACK_PAYLOAD_SOURCE, state.dataSourceMode || FALLBACK_DATA_SOURCE_MODE],
        ["Files", formatNumber(files.length), "docs/data"],
        ["Admin write", "Off", "backend 미연결"],
      ],
      runtime: {
        dataSourceMode: state.dataSourceMode || FALLBACK_DATA_SOURCE_MODE,
        payloadSource: state.payloadSource || FALLBACK_PAYLOAD_SOURCE,
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
      { name: "weekly.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.weekly), source: sourceForPayload(state.lastSuccessfulPayloads.weekly), status: "ready" },
      { name: "home.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.home), source: sourceForPayload(state.lastSuccessfulPayloads.home), status: "ready" },
      { name: "sector.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.sector), source: sourceForPayload(state.lastSuccessfulPayloads.sector), status: "ready" },
      { name: "tools.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.tools), source: sourceForPayload(state.lastSuccessfulPayloads.tools), status: "ready" },
      { name: "playground.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.playground), source: sourceForPayload(state.lastSuccessfulPayloads.playground), status: "ready" },
      { name: "asset/*.json", type: "entity", rows: state.options.assets.length, source: state.payloadSource || FALLBACK_PAYLOAD_SOURCE, status: "ready" },
      { name: "company/*.json", type: "entity", rows: state.options.companies.length, source: state.payloadSource || FALLBACK_PAYLOAD_SOURCE, status: "ready" },
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

  function kpiGrid(items, scope) {
    const rows = (items || []).filter(Boolean);
    if (!rows.length) return "";
    return `
      <div class="kpi-grid summary-strip">
        ${rows.map((item, index) => {
          const row = { label: item[0], value: item[1], note: item[2] || "" };
          const detailKey = registerDetail(scope || "kpi", row, `${formatCell(item[0])} 상세`);
          return `
          <button class="kpi info-card kpi-button" type="button" data-detail-key="${escapeAttr(detailKey)}" aria-label="${escapeAttr(`${formatCell(item[0])} 상세 보기`)}">
            <div class="kpi-label">${escapeHtml(item[0])}</div>
            <div class="kpi-value">${escapeHtml(formatCell(item[1]))}</div>
            ${item[2] ? `<div class="kpi-note">${escapeHtml(formatCell(item[2]))}</div>` : ""}
          </button>
        `;
        }).join("")}
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

  function renderSearchableInteractiveTable(scope, rows, preferredKeys, limit, options) {
    const placeholder = options?.placeholder || "검색";
    return `
      <div class="search-strip">
        <input class="input table-search" type="search" placeholder="${escapeAttr(placeholder)}" data-search-scope="${escapeAttr(scope)}">
      </div>
      ${renderInteractiveTable(scope, rows, preferredKeys, limit)}
    `;
  }

  function renderInteractiveTable(scope, rows, preferredKeys, limit) {
    const list = Array.isArray(rows) ? rows.slice(0, limit || rows.length) : [];
    if (!list.length) return renderEmpty("표시할 행이 없습니다.");
    const keys = preferredKeys && preferredKeys.length ? preferredKeys : inferKeys(list);
    return `
      <div class="table-wrap compact-table" data-table-scope="${escapeAttr(scope)}">
        <table>
          <thead>
            <tr>
              ${keys.map((header) => `<th>${escapeHtml(labelize(header))}</th>`).join("")}
              <th class="action-col">상세</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((row) => {
              const detailKey = registerDetail(scope, row, buildDetailTitle(row, scope));
              return `
                <tr tabindex="0" data-detail-key="${escapeAttr(detailKey)}">
                  ${keys.map((key) => `<td>${formatCellHtml(row?.[key])}</td>`).join("")}
                  <td class="action-col"><button class="row-action" type="button" data-detail-key="${escapeAttr(detailKey)}">보기</button></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderRecordOrTable(scope, value) {
    if (Array.isArray(value)) return renderInteractiveTable(scope, value, null, 80);
    if (value && typeof value === "object") {
      const rows = Object.entries(value).map(([key, item]) => ({ 항목: labelize(key), 값: item }));
      return renderInteractiveTable(scope, rows, ["항목", "값"], 80);
    }
    return keyValueGrid({ value });
  }

  function renderBarChart(scope, rows, labelKey, valueKey, options) {
    const list = (Array.isArray(rows) ? rows : []).filter(Boolean).slice(0, options?.limit || 18);
    if (!list.length) return "";
    const values = list.map((row) => Math.abs(Number(row?.[valueKey]) || 0));
    const max = Math.max(...values, 1);
    return `
      <div class="chart-panel" data-chart-scope="${escapeAttr(scope)}">
        <div class="chart-title">${escapeHtml(options?.title || "차트")}</div>
        <div class="bar-chart">
          ${list.map((row) => {
            const detailKey = registerDetail(scope, row, buildDetailTitle(row, scope));
            const rawValue = Number(row?.[valueKey]) || 0;
            const width = Math.max(4, Math.round((Math.abs(rawValue) / max) * 100));
            return `
              <button class="bar-row" type="button" data-detail-key="${escapeAttr(detailKey)}">
                <span class="bar-label">${escapeHtml(formatCell(row?.[labelKey]))}</span>
                <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
                <span class="bar-value">${escapeHtml(formatCell(rawValue))}</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderMapPanel(points, scope) {
    const list = (Array.isArray(points) ? points : []).filter((point) => point && point.latitude != null && point.longitude != null);
    if (!list.length) return renderEmpty("표시할 지도 좌표가 없습니다.");
    const lats = list.map((point) => Number(point.latitude)).filter(Number.isFinite);
    const lngs = list.map((point) => Number(point.longitude)).filter(Number.isFinite);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latSpan = Math.max(maxLat - minLat, 0.01);
    const lngSpan = Math.max(maxLng - minLng, 0.01);
    return `
      <div class="map-panel" role="group" aria-label="자산 위치 지도">
        <div class="map-grid"></div>
        ${list.map((point, index) => {
          const left = clamp(((Number(point.longitude) - minLng) / lngSpan) * 86 + 7, 5, 93);
          const top = clamp((1 - ((Number(point.latitude) - minLat) / latSpan)) * 78 + 10, 8, 90);
          const detailKey = registerDetail(scope, point, point.assetName || `지도 지점 ${index + 1}`);
          return `
            <button class="map-marker" type="button" style="left:${left}%;top:${top}%" data-detail-key="${escapeAttr(detailKey)}" aria-label="${escapeAttr(`${point.assetName || "자산"} 상세`)}">
              <span>${formatNumber(index + 1)}</span>
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderSourceLine(payload) {
    const generated = payload?.generatedAt || payload?.meta?.generatedAt || state.bootstrap?.generatedAt || "";
    const source = payload?.payloadSource || payload?.meta?.payloadSource || state.payloadSource || FALLBACK_PAYLOAD_SOURCE;
    const mode = payload?.dataSourceMode || payload?.meta?.dataSourceMode || state.dataSourceMode || FALLBACK_DATA_SOURCE_MODE;
    return `
      <div class="source-line">
        <span class="iota-source-chip">${escapeHtml(source)}</span>
        <span class="chip">${escapeHtml(mode)}</span>
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
    return entries.map(([key, rows]) => infoCard(labelize(key), renderInteractiveTable(`ranking_${key}`, rows || [], null, 12))).join("");
  }

  function renderEmpty(message) {
    return `<div class="empty state-shell">${message}</div>`;
  }

  function registerDetail(scope, row, title) {
    const safeScope = String(scope || "detail").replace(/[^a-z0-9_-]/gi, "_");
    const key = `${DETAIL_PREFIX}${safeScope}_${Object.keys(state.detailStore).length}`;
    state.detailStore[key] = { title: title || buildDetailTitle(row, safeScope), row };
    return key;
  }

  function buildDetailTitle(row, fallback) {
    if (!row || typeof row !== "object") return "상세";
    return row.assetName || row.tenantMasterName || row.projectName || row.label || row.dimension || row.month || row.name || fallback || "상세";
  }

  function openDetailByKey(key) {
    const detail = state.detailStore[key];
    if (!detail) return;
    openDrawer(detail.title || "상세", renderDetailBody(detail.row));
  }

  function renderDetailBody(row) {
    if (!row || typeof row !== "object") return `<p class="page-note">${escapeHtml(formatCell(row))}</p>`;
    const simple = {};
    const nested = [];
    Object.entries(row).forEach(([key, value]) => {
      if (value && typeof value === "object") nested.push([key, value]);
      else simple[key] = value;
    });
    return `
      ${keyValueGrid(simple)}
      ${nested.map(([key, value]) => `
        <section class="drawer-section">
          <h3>${escapeHtml(labelize(key))}</h3>
          ${Array.isArray(value)
            ? renderInteractiveTable(`drawer_${key}`, value, null, 40)
            : keyValueGrid(value)}
        </section>
      `).join("")}
    `;
  }

  function bindPanelActions(panel, tab, payload) {
    panel.querySelectorAll("[data-weekly-view]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selections.weeklyAssetView = button.dataset.weeklyView || "core";
        renderPayload(tab, payload);
      });
    });
    if (tab === "weekly") bindWeeklyLegacyRows(panel);
    panel.querySelectorAll("[data-detail-key]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        openDetailByKey(node.dataset.detailKey);
      });
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetailByKey(node.dataset.detailKey);
        }
      });
    });
    panel.querySelectorAll("[data-search-scope]").forEach((input) => {
      input.addEventListener("input", () => filterTableRows(input.dataset.searchScope, input.value));
    });
  }

  function bindWeeklyLegacyRows(panel) {
    panel.querySelectorAll(".weekly-report-page .table-wrap tbody tr:not([data-detail-key])").forEach((row, index) => {
      const table = row.closest("table");
      const headers = Array.from(table?.querySelectorAll("thead th") || []).map((cell) => cell.textContent.trim());
      const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent.trim());
      const detail = {};
      cells.forEach((value, cellIndex) => {
        detail[headers[cellIndex] || `field_${cellIndex + 1}`] = value;
      });
      const title = cells[0] || cells[1] || `Weekly row ${index + 1}`;
      const detailKey = registerDetail("weekly_row", detail, title);
      row.dataset.detailKey = detailKey;
      row.tabIndex = 0;
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

  function filterTableRows(scope, query) {
    const normalized = String(query || "").trim().toLowerCase();
    const table = Array.from(document.querySelectorAll("[data-table-scope]")).find((node) => node.dataset.tableScope === scope);
    if (!table) return;
    table.querySelectorAll("tbody tr").forEach((row) => {
      const text = row.textContent.toLowerCase();
      row.hidden = normalized && !text.includes(normalized);
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

  function optionExists(options, key, value) {
    return !!value && (options || []).some((item) => String(item?.[key] || "") === String(value));
  }

  function isUsableTenantId(value) {
    const text = String(value || "").trim();
    return !!text && text !== "tenant_name_";
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

  function sourceForPayload(payload) {
    return payload?.payloadSource || payload?.meta?.payloadSource || state.payloadSource || FALLBACK_PAYLOAD_SOURCE;
  }

  function formatCellHtml(value) {
    return escapeHtml(formatCell(value));
  }

  function formatCell(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "number") return formatNumber(value);
    if (typeof value === "boolean") return value ? "예" : "아니오";
    if (Array.isArray(value)) return `${formatNumber(value.length)}건`;
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
    if (Array.isArray(value)) return `${formatNumber(value.length)}건`;
    if (typeof value === "object") return `${formatNumber(Object.keys(value).length)}개 필드`;
    return String(value);
  }

  function labelize(key) {
    const raw = String(key || "");
    if (LABELS[raw]) return LABELS[raw];
    return raw
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
    return `${formatNumber(num)}㎡`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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
    content.querySelectorAll("[data-detail-key]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        openDetailByKey(node.dataset.detailKey);
      });
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetailByKey(node.dataset.detailKey);
        }
      });
    });
    backdrop.hidden = false;
    document.getElementById("drawer-close")?.focus({ preventScroll: true });
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
