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
    weekly: { title: "Weekly", group: "업무", file: "data/weekly.json" },
    home: { title: "Home", group: "업무", file: "data/home.json" },
    asset: { title: "Asset", group: "업무", file: "asset" },
    company: { title: "Company", group: "업무", file: "company" },
    sector: { title: "Sector", group: "업무", file: "data/sector.json" },
    tools: { title: "Analysis Tools", group: "분석", file: "data/tools.json" },
    playground: { title: "Data Playground", group: "분석", file: "data/playground.json" },
    quality: { title: "Data Quality", group: "분석", file: "virtual" },
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
    exposureAvailable: "노출도 산출 가능",
    expiryMonth: "만기월",
    expiryWithin12Months: "12개월 내 만기",
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

  const VALUE_LABELS = {
    cached: "캐시됨",
    currency: "금액",
    entity: "개별 파일",
    github_snapshot: "GitHub fallback",
    number: "숫자",
    ok: "정상",
    ready: "준비됨",
    review_required: "확인 필요",
    "client cache": "클라이언트 캐시",
    "docs/data": "공개 fallback JSON",
    "not visited": "미방문",
    "Read only": "읽기 전용",
    "static frontend": "정적 프론트",
    "supabase_snapshot": "Supabase 스냅샷",
  };

  const EXTRA_LABELS = {
    activeTab: "현재 탭",
    approvalDate: "승인일",
    category: "분류",
    columnDimension: "열 기준",
    currentValue: "현재 값",
    filterDimension: "필터 기준",
    grossFloorAreaEffectiveAt: "연면적 기준일",
    hasFinancialData: "재무 데이터 보유",
    headquartersAddress: "본점 주소",
    latestDebtRatio: "최근 부채비율",
    latestRevenue: "최근 매출",
    loadedTabs: "불러온 탭",
    monthlyRentMax: "월 임대료 최대",
    monthlyRentMin: "월 임대료 최소",
    previousValue: "이전 값",
    regionCount: "권역 수",
    rowDimension: "행 기준",
    rows: "행 수",
    savedViews: "저장된 보기",
    selectorSortMeta: "선택 목록 정렬 기준",
    sectorCount: "섹터 수",
    goodsTypeCount: "화물 유형 수",
    topN: "상위 N개",
    type: "유형",
    "Snapshot files": "스냅샷 파일",
    "Asset files": "자산 파일",
    "Company files": "기업 파일",
    "Loaded tabs": "불러온 탭",
    vacancyMax: "최대 공실률",
    vacancyMin: "최소 공실률",
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
    closeSurface: () => closeDrawer(),
    openSupport: () => openDrawer("지원/문의", `
      <p class="page-note">현재 화면은 GitHub Pages 정적 프론트와 Supabase 스냅샷을 기준으로 동작합니다.</p>
      ${keyValueGrid({
        payloadSource: state.payloadSource || FALLBACK_PAYLOAD_SOURCE,
        dataSourceMode: state.dataSourceMode || FALLBACK_DATA_SOURCE_MODE,
        apiWrite: "서버 전용 API 연결 전",
      })}
    `),
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    const params = new URLSearchParams(window.location.search);
    state.role = sessionStorage.getItem("ll.static.admin.preview") === "1" ? "admin" : "user";
    setTheme(localStorage.getItem("ll.static.theme") || "dark");
    bindShellActions();

    if (state.role === "admin") ensureAdminDom();
    else removeAdminDom();
    showShell();

    await prepareOptions();
    await switchTab("weekly");
    if (params.get("page") === "admin" && state.role !== "admin") showAdminGate({ keepShell: true });
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
    document.getElementById("admin-login-button")?.addEventListener("click", () => showAdminGate({ keepShell: true }));
    document.getElementById("admin-logout-button")?.addEventListener("click", async () => {
      sessionStorage.removeItem("ll.static.admin.preview");
      state.role = "user";
      removeAdminDom();
      syncAuthUi();
      await switchTab("weekly");
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
    const gate = document.getElementById("admin-auth-root");
    if (gate) gate.hidden = true;
    document.querySelectorAll(".nav-admin").forEach((node) => node.remove());
    document.getElementById("admin-view")?.remove();
    document.getElementById("admin-data-view")?.remove();
  }

  function showAdminGate(options) {
    const keepShell = !!(options && options.keepShell);
    const shell = document.getElementById("app-shell");
    const gate = document.getElementById("admin-auth-root");
    if (shell && !keepShell) shell.hidden = true;
    if (gate) gate.hidden = false;
    const form = document.getElementById("admin-auth-form");
    if (form && form.dataset.bound !== "true") form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("admin-auth-password");
      if (!String(input?.value || "").trim()) return;
      sessionStorage.setItem("ll.static.admin.preview", "1");
      await unlockAdminPreview();
    });
    if (form) form.dataset.bound = "true";
  }

  async function unlockAdminPreview() {
    const gate = document.getElementById("admin-auth-root");
    if (gate) gate.hidden = true;
    state.role = "admin";
    ensureAdminDom();
    showShell();
    syncAuthUi();
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
    syncAuthUi();
  }

  function showShell() {
    const shell = document.getElementById("app-shell");
    if (shell) shell.hidden = false;
    const sourceLabel = document.getElementById("source-label");
    if (sourceLabel) sourceLabel.textContent = state.payloadSource || FALLBACK_PAYLOAD_SOURCE;
    const generatedLabel = document.getElementById("generated-label");
    if (generatedLabel) generatedLabel.textContent = state.dataSourceMode || FALLBACK_DATA_SOURCE_MODE;
    buildRailTabs();
    syncAuthUi();
  }

  function syncAuthUi() {
    const isAdmin = state.role === "admin";
    setText("role-label", isAdmin ? "관리자 미리보기" : "조회 권한");
    const login = document.getElementById("admin-login-button");
    const logout = document.getElementById("admin-logout-button");
    if (login) login.hidden = isAdmin;
    if (logout) logout.hidden = !isAdmin;
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
      ["Lease-up", `${formatNumber(summary.leaseUpIssueCount)}건`, "주요 이슈"],
      ["Risk 자산", `${formatNumber(summary.riskAssetCount)}개`, "운용/Exit 표시"],
    ];
    const projectHeaders = ["프로젝트", "개요", "투자/자금", "현황", "계획"];
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
        ${actionStrip([
          actionButton("총 자산 수 상세", { "data-action": "weekly-summary-assets" }, {
            assetRows,
          }, "총 자산 수 상세"),
          actionButton("총 연면적 상세", { "data-action": "weekly-summary-area" }, {
            assetRows: assetRows.slice().sort((a, b) => (Number(b.grossAreaPy) || 0) - (Number(a.grossAreaPy) || 0)),
          }, "총 연면적 상세"),
          actionButton("6개월 내 만기 상세", { "data-action": "weekly-summary-6" }, {
            assetRows: assetRows.filter((row) => row.fundMaturity || row.loanMaturity),
          }, "6개월 내 만기 상세"),
          actionButton("만기 캘린더 전체 상세", { "data-action": "weekly-maturity-all" }, {
            assetRows: assetRows.filter((row) => row.fundMaturity || row.loanMaturity),
          }, "만기 캘린더 전체 상세"),
          actionButton("Risk 자산", { "data-action": "weekly-summary-risk" }, {
            assetRows: assetRows.filter((row) => /risk|exit|이슈|검토/i.test(`${row.mainIssue || ""} ${row.status || ""}`)),
          }, "Risk 자산"),
          actionButton("신규/관리 프로젝트 상세", { "data-weekly-issue-group": "projects" }, {
            newProjects: report.newProjects || [],
            managementProjects: report.managementProjects || [],
          }, "Weekly 프로젝트 상세"),
          actionButton("만기/이슈 점검", { "data-weekly-maturity-index": "asset-maturity", "data-action": "weekly-summary-assets" }, {
            assetRows: assetRows.filter((row) => row.fundMaturity || row.loanMaturity || row.mainIssue),
          }, "Weekly 만기/이슈 점검"),
          actionButton("원본 메타", { "data-weekly-raw-id": report.reportTitle || "weekly" }, {
            reportTitle: report.reportTitle,
            reportDate: report.reportDate,
            schemaVersion: report.schemaVersion,
            source: report.source,
            generatedAt: report.generatedAt,
          }, "Weekly 원본 메타"),
          actionButton("수정 요청", { "data-weekly-edit": "request" }, {
            status: "권한 기반 편집 API 연결 전",
            안내: "현재 공개 화면에서는 저장하지 않고, 서버 전용 API와 권한 확정 후 수정 기능을 연결합니다.",
          }, "주간 업무 리포트 수정"),
        ])}
        ${section("신규 투자 Projects", "Weekly", renderTable(projectHeaders, projectRows(report.newProjects || []), { compact: true }))}
        ${section("관리 Projects", "Weekly", renderTable(projectHeaders, projectRows(report.managementProjects || []), { compact: true }))}
        ${section("자산현황", "Weekly", `
          <div class="toolbar">
            <div class="segmented" role="tablist" aria-label="자산현황 보기 전환">
              <button class="segment-btn ${full ? "" : "active"}" type="button" data-weekly-view="core">운영 핵심 보기</button>
              <button class="segment-btn ${full ? "active" : ""}" type="button" data-weekly-view="full">원문 전체 보기</button>
            </div>
            <span class="chip">${formatNumber(assetRows.length)}건</span>
          </div>
          ${renderTable(full ? fullHeaders : coreHeaders, assetTableRows, { compact: true, scope: "weekly-assets-table" })}
        `)}
        ${section("기준 및 기타사항", "Weekly", `
          ${renderTable(["구분", "내용"], (report.notes || []).map((note) => [note.title, note.body]), { compact: true })}
          ${renderInteractiveTable("weekly-summary-assets", assetRows, ["assetName", "fundName", "assetType", "grossAreaPy", "occupancyRate", "mainIssue"], 20)}
          ${renderInteractiveTable("weekly-summary-area", assetRows.slice().sort((a, b) => (Number(b.grossAreaPy) || 0) - (Number(a.grossAreaPy) || 0)), ["assetName", "fundName", "assetType", "grossAreaPy", "occupancyRate"], 20)}
          ${renderInteractiveTable("weekly-maturity-detail-table", assetRows.filter((row) => row.fundMaturity || row.loanMaturity), ["assetName", "fundMaturity", "loanMaturity", "mainTenant", "mainIssue"], 20)}
          ${renderInteractiveTable("weekly-maturity-all-table", assetRows.filter((row) => row.fundMaturity || row.loanMaturity), ["assetName", "fundMaturity", "loanMaturity", "mainTenant", "mainIssue"], 20)}
          ${renderInteractiveTable("weekly-issue-detail-table", assetRows.filter((row) => row.mainIssue), ["assetName", "fundName", "mainTenant", "mainIssue"], 20)}
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
          ${actionStrip([
            actionButton("지도 상세", { "data-home-map-detail": "1" }, { mapPoints }, "Home 지도 상세"),
            actionButton("임대료 추이 상세", { "data-home-rent-detail": "1" }, { rentTrend }, "Home 임대료 추이 상세"),
            actionButton("만기/공실 상세", { "data-home-expiry-detail": "1", "data-action": "home-expiry-detail" }, {
              vacancySummary: home.vacancySummary || [],
              contractSummary: home.contractSummary || {},
              tenants: home.topTenants || home.tenantSummary || [],
            }, "Home 만기/공실 상세"),
          ])}
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
        ${section("주요 임차인", "Home", `
          <div class="toolbar dense-toolbar">
            <span class="chip">정렬</span>
            <div class="segmented" aria-label="주요 임차인 정렬">
              ${sortButton("home_tenants", "leasedAreaSqm", "임대면적", { "data-home-tenant-sort": "leasedAreaSqm" })}
              ${sortButton("home_tenants", "monthlyCostTotal", "월 임관리비", { "data-home-tenant-sort": "monthlyCostTotal" })}
              ${sortButton("home_tenants", "latestExpiry", "최근 만기", { "data-home-tenant-sort": "latestExpiry" })}
            </div>
          </div>
          ${renderSearchableInteractiveTable("home_tenants", home.topTenants || home.tenantSummary || [], ["tenantMasterName", "assetCount", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "averageENoc"], 12, { placeholder: "임차인 검색" })}
        `)}
        ${section("공실 현황", "Home", renderInteractiveTable("home_vacancy", home.vacancySummary || [], ["assetName", "grossFloorAreaSqm", "vacancyAreaSqm", "vacancyRate"], 12))}
        ${section("임대료 추이", "Home", `
          ${renderBarChart("home_rent_trend_chart", rentTrend, "month", "monthlyCostTotalAdjusted", { title: "월 임관리비 추이" })}
          ${renderInteractiveTable("home_rent_trend", rentTrend, ["month", "activeAssetCount", "leasedAreaSqm", "grossFloorAreaSqm", "monthlyRentTotal", "monthlyCostTotalAdjusted"], 18)}
        `)}
        ${section("자산 위치", "Home", `
          ${renderMapPanel(mapPoints, "home_map")}
          ${renderInteractiveTable("home_map_points", mapPoints, ["assetName", "address", "latitude", "longitude", "issueCount"], 20)}
        `)}
        ${renderHomeParitySections(home)}
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
          ${actionStrip([
            actionButton("층별/구역 상세", { "data-asset-stacking-detail": "1", "data-action": "asset-panel", "data-asset": overview.assetId || title }, { stackingPlan: asset.stackingPlan || [], rows: asset.rows || [] }, "Asset 층별/구역 상세"),
            actionButton("E.NOC 상세", { "data-asset-enoc-detail": "1" }, { topTenants: asset.topTenants || [], rows: asset.rows || [] }, "Asset E.NOC 상세"),
            actionButton("만기 상세", { "data-asset-expiry-detail": "1" }, { rows: (asset.rows || []).filter((row) => row.currentEndDate || row.latestExpiry) }, "Asset 만기 상세"),
          ])}
          ${keyValueGrid(overview)}
        `)}
        ${section("임대차 현황", "Asset", renderSearchableInteractiveTable("asset_leases", asset.rows || [], ["tenantMasterName", "floorLabel", "detailAreaLabel", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "currentMonthlyCostTotal", "currentStartDate", "currentEndDate"], 80, { placeholder: "임차인, 층, 구역 검색" }))}
        ${section("주요 임차인", "Asset", `
          ${renderBarChart("asset_top_tenants_chart", asset.topTenants || [], "tenantMasterName", "leasedAreaSqm", { title: "임차인별 임대면적" })}
          ${renderInteractiveTable("asset_top_tenants", asset.topTenants || [], ["tenantMasterName", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "averageENoc"], 20)}
        `)}
        ${section("층별 배치", "Asset", renderInteractiveTable("asset_stacking", asset.stackingPlan || [], null, 80))}
        ${section("면적 구성", "Asset", keyValueGrid(asset.areaBreakdown || {}))}
        ${renderAssetParitySections(asset)}
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
          <div class="toolbar dense-toolbar">
            <span class="chip">노출 기준</span>
            <div class="segmented" aria-label="기업 노출 기준">
              ${actionButton("면적", { "data-company-exposure-mode": "area" }, { mode: "면적", leasedAssets: company.leasedAssets || [] }, "기업 노출 기준")}
              ${actionButton("금액", { "data-company-exposure-mode": "amount", "data-action": "cost" }, { mode: "금액", leasedAssets: company.leasedAssets || [] }, "기업 노출 기준")}
              ${actionButton("만기", { "data-company-exposure-mode": "expiry" }, { mode: "만기", rows: company.rows || [] }, "기업 노출 기준")}
            </div>
          </div>
          ${actionStrip([
            actionButton("임차 자산 지도", { "data-company-map-detail": "1" }, { mapPoints: company.mapPoints || [] }, "Company 지도 상세"),
            actionButton("계약 상세", { "data-company-contract-detail": "1" }, { rows: company.rows || [] }, "Company 계약 상세"),
            actionButton("DART/재무 요청", { "data-company-dart-detail": "1" }, { financials: company.financials || {}, status: "서버 전용 API 연결 필요" }, "Company DART/재무 정보"),
          ])}
          ${keyValueGrid(profile)}
        `)}
        ${section("임차 자산", "Company", `
          ${renderMapPanel(company.mapPoints || [], "company_map")}
          ${renderSearchableInteractiveTable("company_assets", company.leasedAssets || [], ["assetName", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "sector", "goodsType"], 40, { placeholder: "자산명 검색" })}
        `)}
        ${section("계약 행", "Company", renderInteractiveTable("company_rows", company.rows || [], ["assetName", "floorLabel", "detailAreaLabel", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "currentMonthlyCostTotal", "currentStartDate", "currentEndDate"], 80))}
        ${section("DART/재무 정보", "Company", renderRecordOrTable("company_financials", company.financials || {}))}
        ${section("운영 정보", "Company", keyValueGrid(company.operations || {}))}
        ${renderCompanyParitySections(company)}
      </div>
    `;
  }

  function renderSector(sector) {
    const monthlyRentTrend = getByPath(sector, ["trends", "monthlyRent"]) || [];
    return `
      <div class="page-stack">
        ${kpiGrid(objectToKpis(sector.kpis || {}), "sector_kpi")}
        ${actionStrip([
          actionButton("자산 랭킹", { "data-sector-asset": "ranking" }, { rankings: sector.rankings || {}, regionExposure: sector.regionExposure || [] }, "Sector 자산 랭킹"),
          actionButton("임차인 만기", { "data-sector-tenant": "expiry" }, { expiryRows: sector.expiryRows || [] }, "Sector 임차인 만기"),
          actionButton("만기 구간", { "data-sector-expiry": "bucket" }, { expiryBuckets: sector.expiryBuckets || [] }, "Sector 만기 구간"),
        ])}
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
        ${renderSectorParitySections(sector)}
      </div>
    `;
  }

  function renderTools(tools) {
    return `
      <div class="page-stack">
        ${kpiGrid(objectToKpis(Object.assign({}, tools.deltas || {}, tools.divergence || {})), "tools_kpi")}
        ${section("선택 조건", "Analysis Tools", `
          <div class="toolbar dense-toolbar">
            <select id="tools-asset-select" class="select" aria-label="비교 자산 선택">
              ${state.options.assets.slice(0, 80).map((asset) => `<option value="${escapeAttr(asset.assetId)}">${escapeHtml(asset.assetName || asset.assetId)}</option>`).join("")}
            </select>
            <select id="tools-company-select" class="select" aria-label="비교 기업 선택">
              ${state.options.companies.slice(0, 80).map((company) => `<option value="${escapeAttr(company.tenantId)}">${escapeHtml(company.tenantMasterName || company.tenantId)}</option>`).join("")}
            </select>
            ${actionButton("적용", { id: "tools-apply-button" }, { selectionMeta: tools.selectionMeta || {}, assets: tools.assets || [], companies: tools.companies || [] }, "Analysis Tools 적용")}
            ${actionButton("기본값", { id: "tools-default-button" }, { defaults: state.bootstrap?.defaults || {}, selectionMeta: tools.selectionMeta || {} }, "Analysis Tools 기본값")}
          </div>
          ${actionStrip([
            ...((tools.assets || []).slice(0, 6).map((row) => actionButton(row.assetName || "자산", { "data-tools-asset": row.assetId || row.assetName || "" }, row, `${row.assetName || "자산"} 상세`))),
            ...((tools.companies || []).slice(0, 6).map((row) => actionButton(row.tenantMasterName || "기업", { "data-tools-company": row.tenantId || row.tenantMasterName || "" }, row, `${row.tenantMasterName || "기업"} 상세`))),
          ])}
          ${keyValueGrid(tools.selectionMeta || {})}
        `)}
        ${section("자산 비교", "Analysis Tools", renderSearchableInteractiveTable("tools_assets", tools.assets || [], ["assetName", "tenantMasterName", "leasedAreaSqm", "monthlyCostTotal", "vacancyRate"], 30, { placeholder: "자산/임차인 검색" }))}
        ${section("기업 비교", "Analysis Tools", renderSearchableInteractiveTable("tools_companies", tools.companies || [], ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyCostTotal", "eNoc"], 30, { placeholder: "기업/자산 검색" }))}
        ${section("계약 원장", "Analysis Tools", renderSearchableInteractiveTable("tools_contracts", tools.contracts || [], ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "monthlyCostTotal", "currentEndDate"], 80, { placeholder: "계약 원장 검색" }))}
        ${section("벤치마크", "Analysis Tools", `
          ${renderBarChart("tools_benchmark_chart", tools.benchmarkRows || [], "assetName", "leasedAreaSqm", { title: "비교 자산 임대면적" })}
          ${renderInteractiveTable("tools_benchmark", tools.benchmarkRows || [], null, 20)}
        `)}
        ${renderToolsParitySections(tools)}
      </div>
    `;
  }

  function renderPlayground(playground) {
    return `
      <div class="page-stack">
        ${kpiGrid(normalizeKpis(playground.summaryCards), "playground_kpi")}
        ${section("질의 조건", "Data Playground", `
          <div class="toolbar dense-toolbar">
            <select id="playground-dimension" class="select" aria-label="행 기준">
              ${playgroundOptions(playground, "rowDimension").map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(labelize(value))}</option>`).join("")}
            </select>
            <select id="playground-column" class="select" aria-label="열 기준">
              ${playgroundOptions(playground, "columnDimension").map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(labelize(value))}</option>`).join("")}
            </select>
            <select id="playground-filter-dimension" class="select" aria-label="필터 기준">
              ${playgroundOptions(playground, "filterDimension").map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(labelize(value))}</option>`).join("")}
            </select>
            <input id="playground-filter-value" class="input" type="search" placeholder="필터 값">
            ${actionButton("집계 적용", { id: "playground-apply-button", "data-playground-apply": "1" }, { query: playground.query || {}, rows: playground.rows || [], sourceRows: playground.sourceRows || [] }, "Data Playground 집계 적용")}
          </div>
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
        ${renderPlaygroundParitySections(playground)}
      </div>
    `;
  }

  function renderQuality(payload) {
    return `
      <div class="page-stack">
        ${kpiGrid(payload.kpis, "quality_kpi")}
        ${actionStrip([
          actionButton("새로고침 점검", { "data-quality-refresh": "1" }, { loadedTabs: payload.loadedTabs || [], files: payload.files || [] }, "Data Quality 새로고침 점검"),
          actionButton("중요 이슈", { "data-quality-critical": "1" }, { files: (payload.files || []).filter((row) => row.status !== "ready"), loadedTabs: payload.loadedTabs || [] }, "Data Quality 중요 이슈"),
          actionButton("수정 대기", { "data-quality-edit-queue": "1" }, { status: "권한 기반 수정 API 연결 전", loadedTabs: payload.loadedTabs || [] }, "Data Quality 수정 대기"),
        ])}
        ${section("스냅샷 파일", "Data Quality", renderQualityInteractiveTable("quality_files", payload.files, ["name", "type", "rows", "status"]))}
        ${section("불러온 Payload", "Data Quality", renderInteractiveTable("quality_loaded", payload.loadedTabs, ["tab", "status", "rows", "source"], 20))}
        ${section("검증 규칙", "Data Quality", renderTable(["항목", "상태"], [
          ["화면 서버 호출", "사용 안 함"],
          ["외부 런타임 브리지", "사용 안 함"],
          ["민감 키 노출", "없음"],
          ["데이터 원본", state.payloadSource || FALLBACK_PAYLOAD_SOURCE],
        ]))}
        ${renderQualityParitySections(payload)}
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
        ${renderAdminParitySections(payload)}
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

  function renderHomeParitySections(home) {
    const occupancy = home.occupancy || {};
    const rentTrend = home.rentTrend || [];
    const contractSummary = home.contractSummary || {};
    const expirySeries = contractSummary.monthlyExpirySeries || contractSummary.monthlyVacancy || [];
    const topTenants = home.topTenants || home.tenantSummary || [];
    const topContracts = home.topContracts || topTenants;
    const vacancyRows = home.vacancySummary || [];
    const mapPoints = home.mapPoints || [];
    const reviewRows = vacancyRows
      .filter((row) => Number(row.vacancyRate) > 0 || Number(row.issueCount) > 0)
      .map((row) => ({
        자산명: row.assetName,
        공실면적: formatArea(row.vacancyAreaSqm),
        공실률: formatPercent(row.vacancyRate),
        검토사항: row.issueCount ? `${formatNumber(row.issueCount)}건` : "공실 확인",
      }));
    return `
      ${section("포트폴리오 위치", "Home", `
        ${actionStrip([
          actionButton("좌표 보유 자산 목록", { "data-action": "home-map-list" }, { mapPoints }, "좌표 보유 자산 목록"),
          actionButton("지도 상세", { "data-action": "home-map-detail" }, { mapPoints }, "포트폴리오 지도 상세"),
        ])}
        ${renderMapPanel(mapPoints, "home-map-detail")}
      `)}
      ${section("관리자 검토 포인트", "Home", renderInteractiveTable("home-review-table", reviewRows, ["자산명", "공실면적", "공실률", "검토사항"], 20))}
      ${section("포트폴리오 스냅샷", "Home", `
        ${actionStrip([
          actionButton("운영 자산 목록", { "data-action": "home-kpi-assets" }, { rows: mapPoints }, "운영 자산 목록"),
          actionButton("총 임대면적 근거", { "data-action": "home-kpi-leased" }, { rows: vacancyRows, occupancy }, "총 임대면적 근거"),
          actionButton("총 공실면적 근거", { "data-action": "home-kpi-vacancy-area" }, { rows: vacancyRows, occupancy }, "총 공실면적 근거"),
          actionButton("공실률 계산 근거", { "data-action": "home-kpi-vacancy-rate" }, occupancy, "공실률 계산 근거"),
          actionButton("월 임관리비 총액 근거", { "data-action": "home-kpi-total-cost" }, { rows: topContracts }, "월 임관리비 총액 근거"),
          actionButton("운영 자산 수 근거", { "data-action": "home-snapshot-assets" }, { rows: mapPoints }, "운영 자산 수 근거"),
          actionButton("현재 공실률 근거", { "data-action": "home-snapshot-vacancy" }, occupancy, "현재 공실률 근거"),
          actionButton("표시 임차인 수 근거", { "data-action": "home-snapshot-tenants" }, { rows: topTenants }, "표시 임차인 수 근거"),
          actionButton("좌표 보유 자산 근거", { "data-action": "home-snapshot-mapped" }, { rows: mapPoints }, "좌표 보유 자산 근거"),
        ])}
        ${keyValueGrid({
          "운영 자산 수": mapPoints.length,
          "총 임대면적": formatArea(occupancy.leasedAreaSqm),
          "총 공실면적": formatArea(occupancy.vacancyAreaSqm),
          "공실률": formatPercent(occupancy.vacancyRate),
        })}
      `)}
      ${section("임대료 추이", "Home", `
        ${actionStrip([
          actionButton("임대료 추이 원본 표", { "data-action": "home-rent-detail" }, { rows: rentTrend }, "임대료 추이 원본 표"),
        ])}
        ${renderBarChart("home-rent-chart", rentTrend.slice(-18), "month", "monthlyCostTotalAdjusted", { title: "월 임관리비 추이" })}
        ${renderInteractiveTable("home-rent-detail", rentTrend.slice(-18), ["month", "monthlyRentTotalAdjusted", "monthlyMfTotalAdjusted", "monthlyCostTotalAdjusted", "activeAssetCount", "grossFloorAreaSqm"], 18)}
      `)}
      ${section("공실 요약", "Home", renderInteractiveTable("home-vacancy-table", vacancyRows, ["assetName", "grossFloorAreaSqm", "vacancyAreaSqm", "vacancyRate"], 20))}
      ${section("만기 집중도", "Home", `
        ${actionStrip([
          actionButton("만기 집중도 상세", { "data-action": "home-expiry-detail" }, { rows: contractSummary.upcoming || expirySeries }, "만기 집중도 상세"),
        ])}
        ${renderBarChart("home-expiry-chart", expirySeries, "month", "contractCount", { title: "월별 만기 계약" })}
        ${renderInteractiveTable("home-expiry-table", contractSummary.upcoming || expirySeries, null, 40)}
      `)}
      ${section("상위 임차인", "Home", renderInteractiveTable("home-tenant-table", topTenants, ["tenantMasterName", "assetCount", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "averageENoc"], 20))}
      ${section("주요 임차인 계약 요약", "Home", renderInteractiveTable("home-contract-table", topContracts, ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "monthlyCombinedTotal", "latestExpiry"], 20))}
    `;
  }

  function renderAssetParitySections(asset) {
    const overview = asset.overview || {};
    const rows = asset.rows || [];
    const topTenants = asset.topTenants || [];
    const expiryRows = rows.filter((row) => row.currentEndDate || row.latestExpiry);
    const reviewRows = rows.filter((row) => /review|검토|오류|risk|만기/i.test(`${row.reviewStatus || ""} ${row.reviewNote || ""} ${row.mainIssue || ""}`));
    return `
      ${section("자산 핵심 요약", "Asset", keyValueGrid(overview))}
      ${section("임차인 현황", "Asset", `
        ${actionStrip([
          actionButton("임차인 현황", { "data-action": "asset-roster-detail" }, { rows }, "임차인 현황"),
          actionButton("자산 위치 정보", { "data-action": "asset-map-detail" }, overview, "자산 위치 정보"),
          actionButton("E.NOC 검산 결과", { "data-action": "asset-enoc-detail" }, { rows, topTenants }, "E.NOC 검산 결과"),
        ])}
        ${renderInteractiveTable("asset-roster-table", rows, ["tenantMasterName", "spaceLabel", "leasedAreaSqm", "currentMonthlyRentTotal", "currentMonthlyMfTotal", "currentMonthlyCostTotal", "currentStartDate", "currentEndDate"], 80)}
      `)}
      ${section("임차인별 월 임관리비", "Asset", `
        ${renderBarChart("asset-rent-chart", topTenants, "tenantMasterName", "monthlyCostTotal", { title: "임차인별 월 임관리비" })}
        ${renderInteractiveTable("asset-rent-table", topTenants, ["tenantMasterName", "leaseSpaceCount", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "monthlyCostTotal"], 30)}
      `)}
      ${section("검토 필요 이슈", "Asset", renderInteractiveTable("asset-review-table", reviewRows, null, 30))}
      ${section("만기 스냅샷", "Asset", `
        ${actionStrip([
          actionButton("만기 스냅샷", { "data-action": "asset-expiry-detail" }, { rows: expiryRows }, "만기 스냅샷"),
        ])}
        ${renderBarChart("asset-expiry-chart", expiryRows, "tenantMasterName", "monthsToExpiry", { title: "임차인별 잔여 개월" })}
        ${renderInteractiveTable("asset-expiry-table", expiryRows, ["tenantMasterName", "spaceLabel", "currentEndDate", "monthsToExpiry", "monthlyCostTotal"], 40)}
      `)}
      ${section("핵심 임차인", "Asset", renderInteractiveTable("asset-core-tenants-table", topTenants, ["tenantMasterName", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "averageENoc"], 20))}
    `;
  }

  function renderCompanyParitySections(company) {
    const leasedAssets = company.leasedAssets || [];
    const rows = company.rows || [];
    const mapPoints = company.mapPoints || [];
    const exposureRows = leasedAssets.map((row) => ({
      assetName: row.assetName,
      leasedAreaSqm: row.leasedAreaSqm,
      monthlyCostTotal: row.monthlyCostTotal,
      latestExpiry: row.latestExpiry,
      monthsToExpiry: row.monthsToExpiry,
    }));
    const exposureMode = state.selections.companyExposureMetric || "amount";
    const exposureValueKey = exposureMode === "area" ? "leasedAreaSqm" : exposureMode === "expiry" ? "monthsToExpiry" : "monthlyCostTotal";
    const exposureTitle = exposureMode === "area" ? "자산별 임차면적" : exposureMode === "expiry" ? "자산별 잔여 개월" : "자산별 월 임관리비";
    return `
      ${section("임차 자산 현황", "Company", renderInteractiveTable("company-assets-table", leasedAssets, ["assetName", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry", "sector", "goodsType"], 60))}
      ${section("회사별 임차 자산 지도", "Company", `
        ${actionStrip([
          actionButton("임차 자산 수", { "data-action": "company-map-detail" }, { mapPoints }, "임차 자산 수"),
        ])}
        ${renderMapPanel(mapPoints, "company-map-detail")}
      `)}
      ${section("자산별 노출도", "Company", `
        ${actionStrip([
          actionButton("자산별 노출도", { "data-action": "company-exposure-detail" }, { rows: exposureRows }, "자산별 노출도"),
        ])}
        ${renderBarChart("company-exposure-chart", exposureRows, "assetName", exposureValueKey, { title: exposureTitle })}
        ${renderInteractiveTable("company-exposure-table", exposureRows, ["assetName", "leasedAreaSqm", "monthlyCostTotal", "latestExpiry"], 40)}
      `)}
      ${section("DART 상세 정보", "Company", `
        ${actionStrip([
          actionButton("DART/재무 요청", { "data-action": "company-dart-detail" }, { financials: company.financials || {}, rows }, "DART 상세 정보"),
        ])}
        ${renderRecordOrTable("company-dart-table", company.financials || {})}
      `)}
    `;
  }

  function renderSectorParitySections(sector) {
    const regionRows = sector.regionExposure || [];
    const expiryRows = sector.expiryRows || [];
    const monthlyRentTrend = getByPath(sector, ["trends", "monthlyRent"]) || [];
    const assetRankRows = getByPath(sector, ["rankings", "assets"]) || getByPath(sector, ["rankings", "topAssets"]) || regionRows;
    const tenantRankRows = getByPath(sector, ["rankings", "tenants"]) || getByPath(sector, ["rankings", "topTenants"]) || expiryRows;
    return `
      ${section("권역·자산·임차인 리스크 비교", "Sector", keyValueGrid(sector.kpis || {}))}
      ${section("권역별 노출도", "Sector", `
        ${actionStrip([
          actionButton("권역별 노출도 원본 표", { "data-action": "sector-region-detail" }, { rows: regionRows }, "권역별 노출도 원본 표"),
        ])}
        ${renderBarChart("sector-region-chart", regionRows, "region", "monthlyCostTotal", { title: "권역별 월 임관리비" })}
        ${renderInteractiveTable("sector-region-detail", regionRows, ["region", "assetCount", "leasedAreaSqm", "monthlyCostTotal", "vacancyRate"], 30)}
      `)}
      ${section("월 임관리비 추이", "Sector", `
        ${actionStrip([
          actionButton("월 임관리비 추이 원본 표", { "data-action": "sector-rent-detail" }, { rows: monthlyRentTrend }, "월 임관리비 추이 원본 표"),
        ])}
        ${renderBarChart("sector-rent-chart", monthlyRentTrend, "month", "monthlyCostTotal", { title: "월 임관리비 추이" })}
      `)}
      ${section("자산 랭킹", "Sector", renderInteractiveTable("sector-assets-table", assetRankRows, null, 30))}
      ${section("임차인 랭킹", "Sector", renderInteractiveTable("sector-tenants-table", tenantRankRows, null, 30))}
      ${section("Top 자산", "Sector", renderInteractiveTable("sector-top-assets-table", assetRankRows, null, 12))}
      ${section("Top 임차인", "Sector", renderInteractiveTable("sector-top-tenants-table", tenantRankRows, null, 12))}
      ${section("만기 집중도", "Sector", `
        ${actionStrip([
          actionButton("12개월 내 만기 상세", { "data-action": "sector-expiry" }, { rows: expiryRows.filter((row) => Number(row.monthsToExpiry) <= 12) }, "12개월 내 만기 상세"),
        ])}
        ${renderInteractiveTable("sector-expiry-detail", expiryRows, ["expiryMonth", "tenantMasterName", "assetName", "leasedAreaSqm", "monthlyCostTotal", "monthsToExpiry"], 60)}
      `)}
    `;
  }

  function renderToolsParitySections(tools) {
    const assets = tools.assets || [];
    const companies = tools.companies || [];
    const contracts = tools.contracts || [];
    const benchmarkRows = tools.benchmarkRows || [];
    return `
      ${section("자산·기업 비교 분석", "Analysis Tools", keyValueGrid(tools.selectionMeta || {}))}
      ${section("자산·기업 비교 도구", "Analysis Tools", keyValueGrid(tools.selectionMeta || {}))}
      ${section("비교 대상 선택", "Analysis Tools", `
        ${renderInteractiveTable("tools-selected-assets-table", assets, ["assetName", "leasedAreaSqm", "monthlyCostTotal", "vacancyRate"], 20)}
        ${renderInteractiveTable("tools-selected-companies-table", companies, ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyCostTotal"], 20)}
      `)}
      ${section("벤치마크 차트", "Analysis Tools", `
        ${actionStrip([
          actionButton("벤치마크 원본 표", { "data-action": "tools-benchmark-detail" }, { rows: benchmarkRows }, "벤치마크 원본 표"),
          actionButton("비교 벤치마크 원본 표", { "data-action": "tools-benchmark-source" }, { rows: benchmarkRows }, "비교 벤치마크 원본 표"),
          actionButton("비교 벤치마크", { "data-action": "tools-benchmark" }, { rows: benchmarkRows }, "비교 벤치마크"),
        ])}
        ${renderBarChart("tools-benchmark-chart", benchmarkRows, "assetName", "monthlyCostTotal", { title: "벤치마크" })}
      `)}
      ${section("비교 매트릭스", "Analysis Tools", renderInteractiveTable("tools-matrix-table", benchmarkRows, null, 40))}
      ${section("계약 원장", "Analysis Tools", renderInteractiveTable("tools-ledger-table", contracts, ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyRentTotal", "monthlyMfTotal", "monthlyCostTotal", "currentEndDate"], 100))}
      ${section("선택 요약", "Analysis Tools", keyValueGrid(tools.selectionMeta || {}))}
      ${section("주요 비교 신호", "Analysis Tools", keyValueGrid(Object.assign({}, tools.deltas || {}, tools.divergence || {})))}
      ${section("비교 인벤토리", "Analysis Tools", renderTable(["구분", "건수"], [["자산", assets.length], ["기업", companies.length], ["계약", contracts.length], ["벤치마크", benchmarkRows.length]], { compact: true }))}
      ${section("검토 항목", "Analysis Tools", renderInteractiveTable("tools-review-table", tools.reviewItems || tools.alerts || [], null, 30))}
      ${section("사용 안내", "Analysis Tools", renderTable(["항목", "내용"], [["비교 대상", "자산과 기업을 선택해 계약/임대료/면적을 비교합니다."], ["상세", "표 행과 차트 막대를 클릭하면 원본 상세가 열립니다."]], { compact: true }))}
      ${section("읽는 순서", "Analysis Tools", renderTable(["순서", "내용"], [["1", "비교 대상 선택"], ["2", "벤치마크 차트"], ["3", "비교 매트릭스"], ["4", "계약 원장"]], { compact: true }))}
      ${section("선택 팁", "Analysis Tools", renderTable(["항목", "내용"], [["자산", "같은 권역/용도 자산을 함께 선택합니다."], ["기업", "동일 임차인 또는 유사 업종을 함께 봅니다."]], { compact: true }))}
    `;
  }

  function renderPlaygroundParitySections(playground) {
    const rows = playground.rows || [];
    const sourceRows = playground.sourceRows || [];
    const savedViews = playground.savedViews || [];
    return `
      ${section("데이터 분석", "Data Playground", kpiGrid(normalizeKpis(playground.summaryCards), "playground-analysis-kpi"))}
      ${section("분석 목적", "Data Playground", renderTable(["항목", "내용"], [["목적", "원본 계약 데이터를 기준별로 빠르게 집계합니다."], ["상세", "결과 행을 클릭하면 원본 값이 열립니다."]], { compact: true }))}
      ${section("조회 조건", "Data Playground", keyValueGrid(playground.query || {}))}
      ${section("현재 조회", "Data Playground", keyValueGrid(playground.query || {}))}
      ${section("현재 조회 조건", "Data Playground", keyValueGrid(playground.query || {}))}
      ${section("결과 차트", "Data Playground", `
        ${actionStrip([
          actionButton("데이터 분석 차트 원본", { "data-action": "playground-chart-detail" }, { rows }, "데이터 분석 차트 원본"),
          actionButton("데이터 분석 원본 표", { "data-action": "playground-detail" }, { rows: sourceRows.length ? sourceRows : rows }, "데이터 분석 원본 표"),
        ])}
        ${renderBarChart("playground-chart", rows, "dimension", "value", { title: "데이터 분석 결과" })}
      `)}
      ${section("결과 표", "Data Playground", renderInteractiveTable("playground-results-table", rows, null, 100))}
      ${section("저장된 분석 View", "Data Playground", renderInteractiveTable("playground-saved-view-table", savedViews, ["label", "rowDimension", "columnDimension", "valueMetric", "topN"], 30))}
      ${section("저장된 분석 뷰", "Data Playground", renderInteractiveTable("playground-saved-view-table-ko", savedViews, ["label", "rowDimension", "columnDimension", "valueMetric", "topN"], 30))}
      ${section("상위 결과", "Data Playground", renderInteractiveTable("playground-top-results-table", rows.slice(0, 20), null, 20))}
      ${section("지표 목록", "Data Playground", renderTable(["지표", "설명"], [
        ["leasedAreaSqm", "임대면적"],
        ["monthlyCostTotal", "월 임관리비"],
        ["monthlyRentTotal", "월 임대료"],
        ["vacancyRate", "공실률"],
      ], { compact: true }))}
      ${section("집계 지표 목록", "Data Playground", renderTable(["지표", "설명"], [
        ["leasedAreaSqm", "임대면적"],
        ["monthlyCostTotal", "월 임관리비"],
        ["monthlyRentTotal", "월 임대료"],
        ["vacancyRate", "공실률"],
      ], { compact: true }))}
      ${section("분석 기준 목록", "Data Playground", renderTable(["기준"], playgroundOptions(playground, "rowDimension").map((value) => [labelize(value)]), { compact: true }))}
      ${section("조회 조건 설정", "Data Playground", renderInteractiveTable("playground-source-rows-table", sourceRows, ["tenantMasterName", "assetName", "leasedAreaSqm", "monthlyCostTotal", "sector", "goodsType"], 100))}
    `;
  }

  function renderQualityParitySections(payload) {
    const files = payload.files || [];
    const issueRows = files.filter((row) => row.status !== "ready");
    const sheetGroups = files.map((row) => ({
      구분: row.name,
      Critical: row.status === "missing" ? 1 : 0,
      Warning: row.status !== "ready" ? 1 : 0,
      Info: row.status === "ready" ? 1 : 0,
      합계: 1,
    }));
    return `
      ${section("데이터 품질 점검", "Data Quality", kpiGrid(payload.kpis, "quality-check-kpi"))}
      ${section("시트별 오류 요약", "Data Quality", renderInteractiveTable("quality-sheet-groups", sheetGroups, ["구분", "Critical", "Warning", "Info", "합계"], 80))}
      ${section("필드별 반복 오류", "Data Quality", renderInteractiveTable("quality-field-groups", issueRows, ["name", "type", "status"], 80))}
      ${section("Critical 우선 조치", "Data Quality", `
        ${actionStrip([
          actionButton("새로고침 점검", { "data-action": "quality-refresh" }, { rows: files }, "새로고침 점검"),
          actionButton("Critical 오류", { "data-action": "quality-critical" }, { rows: issueRows }, "Critical 오류"),
          actionButton("Warning 항목", { "data-action": "quality-warning" }, { rows: issueRows }, "Warning 항목"),
          actionButton("Info 항목", { "data-action": "quality-info" }, { rows: files }, "Info 항목"),
          actionButton("시트별 오류 요약", { "data-action": "quality-sheets" }, { rows: sheetGroups }, "시트별 오류 요약"),
          actionButton("데이터 품질 상세", { "data-action": "quality-detail" }, { rows: files }, "데이터 품질 상세"),
        ])}
        ${renderInteractiveTable("quality-critical-table", issueRows, ["name", "type", "status"], 80)}
      `)}
      ${section("전체 검증 결과", "Data Quality", renderQualityInteractiveTable("quality-all-results", files, ["name", "type", "rows", "source", "status"]))}
      ${section("원천 시트 바로 수정", "Data Quality", `
        <p class="page-note">수정 기능은 로그인/권한과 Edge Function 연결 후 활성화합니다. 현재는 원천 위치와 수정 후보를 확인하는 읽기 전용 단계입니다.</p>
        ${renderInteractiveTable("quality-edit-queue", issueRows, ["name", "type", "status"], 80)}
      `)}
    `;
  }

  function renderAdminParitySections(payload) {
    return `
      ${section("관리자 액션", "Admin", actionStrip([
        actionButton("계산 시트 갱신", { "data-action": "adminRefreshCalculationSheet" }, { status: "Edge Function 연결 대기" }, "계산 시트 갱신"),
        actionButton("OpenDART 동기화", { "data-action": "adminSyncOpenDartData" }, { status: "Edge Function 연결 대기" }, "OpenDART 동기화"),
        actionButton("건축물대장 동기화", { "data-action": "adminSyncBuildingRegisterData" }, { status: "Edge Function 연결 대기" }, "건축물대장 동기화"),
        actionButton("데이터 감사", { "data-action": "adminRunDataAudit" }, { status: "Edge Function 연결 대기" }, "데이터 감사"),
        actionButton("UI-DB 정합성", { "data-action": "adminRunUiDataReconciliation" }, { status: "Edge Function 연결 대기" }, "UI-DB 정합성"),
        actionButton("스냅샷 갱신", { "data-action": "adminRefreshDashboardSnapshot" }, { status: "Edge Function 연결 대기" }, "스냅샷 갱신"),
        actionButton("트리거 설치/갱신", { "data-action": "adminInstallOrUpdateTriggers" }, { status: "Edge Function 연결 대기" }, "트리거 설치/갱신"),
        actionButton("성능 로그", { "data-action": "admin-perf-log" }, { rows: Object.entries(state.renderCounts || {}).map(([tab, count]) => ({ tab, count })) }, "클라이언트 성능 로그"),
      ]))}
      ${section("관리자 실행 오류", "Admin", keyValueGrid({ 상태: "오류 없음", 비고: "실행 API 연결 전" }))}
      ${section("OpenDART 미연결", "Admin", keyValueGrid({ 상태: "Edge Function 미배포", 위치: "서버 전용 API", 프론트키노출: "없음" }))}
      ${section("건축물대장 미연결", "Admin", keyValueGrid({ 상태: "Edge Function 미배포", 위치: "서버 전용 API", 프론트키노출: "없음" }))}
      ${section("AUDIT_데이터이상", "Admin", renderInteractiveTable("admin-audit-table", payload.files || [], ["name", "rows", "status"], 80))}
      ${section("Admin Command Center", "Admin", keyValueGrid(payload.runtime || {}))}
      ${section("AUDIT 데이터", "Admin", renderInteractiveTable("admin-audit-data-table", payload.files || [], ["name", "type", "rows", "status"], 80))}
      ${section("운영 메모", "Admin", renderTable(["항목", "내용"], [["쓰기 기능", "로그인/권한/Edge Function 연결 후 활성화"], ["non-ll_*", "조회만 가능, 수정 금지"], ["ll_*", "허용된 API만 수정"]], { compact: true }))}
      ${section("우선 확인 순서", "Admin", renderTable(["순서", "작업"], [["1", "컴포넌트 1:1 복원"], ["2", "Supabase cell-by-cell 감사"], ["3", "권한/쓰기 연결"], ["4", "API sync 검증"]], { compact: true }))}
      ${section("성능 로그", "Admin", renderInteractiveTable("admin-perf-log", Object.entries(state.renderCounts || {}).map(([tab, count]) => ({ tab, renderCount: count })), ["tab", "renderCount"], 80))}
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
      { name: "weekly.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.weekly), source: sourceForPayload(state.lastSuccessfulPayloads.weekly), status: state.lastSuccessfulPayloads.weekly ? "ready" : "not visited" },
      { name: "home.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.home), source: sourceForPayload(state.lastSuccessfulPayloads.home), status: state.lastSuccessfulPayloads.home ? "ready" : "not visited" },
      { name: "sector.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.sector), source: sourceForPayload(state.lastSuccessfulPayloads.sector), status: state.lastSuccessfulPayloads.sector ? "ready" : "not visited" },
      { name: "tools.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.tools), source: sourceForPayload(state.lastSuccessfulPayloads.tools), status: state.lastSuccessfulPayloads.tools ? "ready" : "not visited" },
      { name: "playground.json", type: "tab", rows: estimateRows(state.lastSuccessfulPayloads.playground), source: sourceForPayload(state.lastSuccessfulPayloads.playground), status: state.lastSuccessfulPayloads.playground ? "ready" : "not visited" },
      { name: "asset/*.json", type: "entity", rows: state.options.assets.length, source: state.payloadSource || FALLBACK_PAYLOAD_SOURCE, status: state.options.assets.length ? "ready" : "not visited" },
      { name: "company/*.json", type: "entity", rows: state.options.companies.length, source: state.payloadSource || FALLBACK_PAYLOAD_SOURCE, status: state.options.companies.length ? "ready" : "not visited" },
    ];
  }

  function normalizeKpis(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
      if (Array.isArray(item)) return item;
      return [labelize(item.label || item.key || "metric"), item.value != null ? item.value : "-", item.status || item.valueType || ""];
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
          const label = labelize(item[0]);
          const row = { label, value: item[1], note: item[2] || "" };
          const detailKey = registerDetail(scope || "kpi", row, `${formatCell(label)} 상세`);
          return `
          <button class="kpi info-card kpi-button" type="button" data-detail-key="${escapeAttr(detailKey)}" aria-label="${escapeAttr(`${formatCell(label)} 상세 보기`)}">
            <div class="kpi-label">${escapeHtml(label)}</div>
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

  function actionStrip(buttons) {
    const html = (buttons || []).filter(Boolean).join("");
    if (!html) return "";
    return `<div class="action-strip">${html}</div>`;
  }

  function actionButton(label, attrs, detail, title) {
    const detailKey = registerDetail("action", detail || {}, title || `${label} 상세`);
    const attrHtml = Object.entries(attrs || {})
      .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
      .join(" ");
    return `<button class="action-btn compact-action" type="button" ${attrHtml} data-detail-key="${escapeAttr(detailKey)}">${escapeHtml(label)}</button>`;
  }

  function sortButton(scope, key, label, attrs) {
    const attrHtml = Object.entries(attrs || {})
      .map(([attr, value]) => `${attr}="${escapeAttr(value)}"`)
      .join(" ");
    return `<button class="segment-btn" type="button" data-sort-table="${escapeAttr(scope)}" data-sort-key="${escapeAttr(key)}" ${attrHtml}>${escapeHtml(label)}</button>`;
  }

  function renderSearchableInteractiveTable(scope, rows, preferredKeys, limit, options) {
    const placeholder = options?.placeholder || "검색";
    const allRows = Array.isArray(rows) ? rows : [];
    const countHint = limit && allRows.length > limit
      ? `<span class="chip">${formatNumber(allRows.length)}건 전체 검색</span>`
      : "";
    return `
      <div class="search-strip">
        <input class="input table-search" type="search" placeholder="${escapeAttr(placeholder)}" data-search-scope="${escapeAttr(scope)}">
        ${countHint}
      </div>
      ${renderInteractiveTable(scope, allRows, preferredKeys, null)}
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

  function playgroundOptions(playground, key) {
    const values = [];
    const add = (value) => {
      const text = String(value || "").trim();
      if (text && !values.includes(text)) values.push(text);
    };
    add(playground?.query?.[key]);
    (playground?.savedViews || []).forEach((view) => add(view?.[key]));
    (playground?.rows || []).slice(0, 12).forEach((row) => Object.keys(row || {}).forEach(add));
    (playground?.sourceRows || []).slice(0, 12).forEach((row) => Object.keys(row || {}).forEach(add));
    ["assetName", "tenantMasterName", "sector", "goodsType", "monthlyCostTotal", "leasedAreaSqm"].forEach(add);
    return values.slice(0, 24);
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
    const scope = options?.scope;
    return `
      <div class="table-wrap ${options?.compact ? "compact-table" : ""}" ${scope ? `data-table-scope="${escapeAttr(scope)}"` : ""}>
        <table>
          <thead>
            <tr>${headers.map((header) => `<th>${escapeHtml(formatCell(header))}</th>`).join("")}${scope ? `<th class="action-col">상세</th>` : ""}</tr>
          </thead>
          <tbody>
            ${safeRows.map((row) => {
              const cells = Array.isArray(row) ? row : [row];
              const detail = {};
              headers.forEach((header, index) => {
                detail[formatCell(header)] = cells[index];
              });
              const detailKey = scope ? registerDetail(scope, detail, cells[1] || cells[0] || "상세") : "";
              return `<tr ${scope ? `tabindex="0" data-detail-key="${escapeAttr(detailKey)}"` : ""}>${cells.map((cell) => `<td>${formatCellHtml(cell)}</td>`).join("")}${scope ? `<td class="action-col"><button class="row-action" type="button" data-detail-key="${escapeAttr(detailKey)}">보기</button></td>` : ""}</tr>`;
            }).join("")}
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
    panel.querySelectorAll("[data-company-exposure-mode]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        state.selections.companyExposureMetric = button.dataset.companyExposureMode || "amount";
        renderPayload(tab, payload);
      });
    });
    panel.querySelector("#tools-apply-button")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const assetId = panel.querySelector("#tools-asset-select")?.value || state.selections.assetId;
      const tenantId = panel.querySelector("#tools-company-select")?.value || state.selections.tenantId;
      state.selections.assetId = assetId || state.selections.assetId;
      state.selections.tenantId = tenantId || state.selections.tenantId;
      fillSelect("asset-select", state.options.assets, "assetId", "assetName", state.selections.assetId);
      fillSelect("company-select", state.options.companies, "tenantId", "tenantMasterName", state.selections.tenantId);
      openDrawer("비교 조건 적용", keyValueGrid({
        assetName: selectedAssetName(),
        tenantMasterName: selectedCompanyName(),
        status: "선택 조건을 화면 상태에 반영했습니다.",
      }));
    });
    panel.querySelector("#tools-default-button")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.selections.assetId = state.bootstrap?.defaults?.assetId || state.selections.assetId;
      state.selections.tenantId = state.bootstrap?.defaults?.tenantId || state.selections.tenantId;
      fillSelect("asset-select", state.options.assets, "assetId", "assetName", state.selections.assetId);
      fillSelect("company-select", state.options.companies, "tenantId", "tenantMasterName", state.selections.tenantId);
      renderPayload(tab, payload);
    });
    panel.querySelector("#playground-apply-button")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPlaygroundResultDrawer(panel, payload);
    });
    panel.querySelectorAll('[data-action="playground-detail"]').forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        openPlaygroundResultDrawer(panel, payload);
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
    panel.querySelectorAll("[data-sort-table]").forEach((button) => {
      button.addEventListener("click", () => sortTableRows(button.dataset.sortTable, button.dataset.sortKey));
    });
  }

  function openPlaygroundResultDrawer(panel, playground) {
    const query = {
      rowDimension: panel.querySelector("#playground-dimension")?.value || playground?.query?.rowDimension || "assetName",
      columnDimension: panel.querySelector("#playground-column")?.value || playground?.query?.columnDimension || "",
      filterDimension: panel.querySelector("#playground-filter-dimension")?.value || playground?.query?.filterDimension || "",
      filterValue: panel.querySelector("#playground-filter-value")?.value || "",
      valueMetric: playground?.query?.valueMetric || "monthlyCostTotal",
    };
    const rows = aggregatePlaygroundRows(playground?.sourceRows || playground?.rows || [], query);
    openDrawer("데이터 분석 원본 표", `
      ${keyValueGrid(query)}
      ${renderBarChart("playground-detail-chart", rows, "dimension", "value", { title: "집계 결과", limit: 20 })}
      ${renderInteractiveTable("playground-detail", rows, ["dimension", "value", "recordCount"], 100)}
    `);
  }

  function aggregatePlaygroundRows(sourceRows, query) {
    const rows = Array.isArray(sourceRows) ? sourceRows : [];
    const dimensionKey = query.rowDimension || "assetName";
    const metricKey = query.valueMetric || "monthlyCostTotal";
    const filterKey = query.filterDimension;
    const filterText = String(query.filterValue || "").trim().toLowerCase();
    const grouped = new Map();
    rows.forEach((row) => {
      if (filterKey && filterText) {
        const value = String(row?.[filterKey] || "").toLowerCase();
        if (!value.includes(filterText)) return;
      }
      const dimension = formatCell(row?.[dimensionKey] || "미분류");
      const current = grouped.get(dimension) || { dimension, value: 0, recordCount: 0 };
      current.value += Number(row?.[metricKey]) || 0;
      current.recordCount += 1;
      grouped.set(dimension, current);
    });
    return Array.from(grouped.values())
      .sort((left, right) => Number(right.value) - Number(left.value))
      .slice(0, 100);
  }

  function renderQualityInteractiveTable(scope, rows, preferredKeys) {
    const list = Array.isArray(rows) ? rows : [];
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
            ${list.map((row, index) => {
              const detailKey = registerDetail(scope, row, buildDetailTitle(row, scope));
              return `
                <tr tabindex="0" data-quality-index="${escapeAttr(index + 1)}" data-detail-key="${escapeAttr(detailKey)}">
                  ${keys.map((key) => `<td>${formatCellHtml(row?.[key])}</td>`).join("")}
                  <td class="action-col"><button class="row-action" type="button" data-quality-index="${escapeAttr(index + 1)}" data-detail-key="${escapeAttr(detailKey)}">보기</button></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
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

  function sortTableRows(scope, key) {
    const table = Array.from(document.querySelectorAll("[data-table-scope]")).find((node) => node.dataset.tableScope === scope);
    if (!table || !key) return;
    const headerLabel = labelize(key);
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent.trim());
    const columnIndex = headers.findIndex((header) => header === headerLabel || header === key);
    if (columnIndex < 0) return;
    const tbody = table.querySelector("tbody");
    const rows = Array.from(tbody?.querySelectorAll("tr") || []);
    rows.sort((a, b) => compareCellText(b.children[columnIndex]?.textContent || "", a.children[columnIndex]?.textContent || ""));
    rows.forEach((row) => tbody.appendChild(row));
  }

  function compareCellText(left, right) {
    const leftNumber = Number(String(left).replace(/[^0-9.\-]/g, ""));
    const rightNumber = Number(String(right).replace(/[^0-9.\-]/g, ""));
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
    return String(left).localeCompare(String(right), "ko-KR");
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
    return displayText(value);
  }

  function formatNested(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "number") return formatNumber(value);
    if (Array.isArray(value)) return `${formatNumber(value.length)}건`;
    if (typeof value === "object") return `${formatNumber(Object.keys(value).length)}개 필드`;
    return displayText(value);
  }

  function labelize(key) {
    const raw = String(key || "");
    if (EXTRA_LABELS[raw]) return EXTRA_LABELS[raw];
    if (LABELS[raw]) return LABELS[raw];
    return raw
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function displayText(value) {
    const raw = String(value);
    return VALUE_LABELS[raw] || raw;
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
