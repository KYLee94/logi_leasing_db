(function () {
  const params = new URLSearchParams(location.search);
  const IS_ADMIN_APP = params.get("page") === "admin";
  const BASE_TAB_ORDER = ["weekly", "home", "asset", "company", "sector", "tools", "playground", "quality"];
  const ADMIN_TAB_ORDER = ["admin", "admin-data"];
  const TAB_ORDER = IS_ADMIN_APP ? BASE_TAB_ORDER.concat(ADMIN_TAB_ORDER) : BASE_TAB_ORDER;
  const CONFIG = Object.freeze({
    supabaseUrl: "https://qvegpozwrcmspdvjokiz.supabase.co",
    supabasePublishableKey: "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P",
    githubDataBaseUrl: "./data",
  });
  const IS_LOCAL_QA_ORIGIN = location.protocol === "file:" || ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const TAB_META = {
    weekly: { label: "주간 업무", subtitle: "물류센터 주간 투자·운용 현황" },
    home: { label: "Home", subtitle: "임대료 추세와 기본 운영 요약" },
    asset: { label: "Asset", subtitle: "자산 옵션과 개별 자산 상세" },
    company: { label: "Company", subtitle: "임차인 옵션과 개별 기업 상세" },
    sector: { label: "Sector", subtitle: "섹터 노출과 만기 분포" },
    tools: { label: "Tools", subtitle: "필터와 비교 보조 정보" },
    playground: { label: "Playground", subtitle: "탐색용 요약 카드와 행형 데이터" },
    quality: { label: "Quality", subtitle: "데이터 기준, 생성 시점, 출처 요약" },
    admin: { label: "Admin", subtitle: "인증 전에는 관리 기능을 표시하지 않습니다." },
    "admin-data": { label: "Admin Data", subtitle: "인증 뒤 Supabase 운영 데이터를 확인합니다." },
  };

  const state = {
    bootstrap: null,
    initial: null,
    tabs: {},
    assetOptions: [],
    companyOptions: [],
    assetSelection: null,
    companySelection: null,
    assetDetail: null,
    companyDetail: null,
    activeTab: "weekly",
    activeProject: "total",
    sectionOrder: {},
    collapsedSections: {},
    payloadSources: {},
    adminVerified: false,
    adminMessage: "",
    modal: null,
    drawer: null,
  };

  const el = {
    shell: document.getElementById("app-shell"),
    app: document.getElementById("app"),
    sidebarToggle: document.getElementById("sidebar-toggle"),
    sidebarNav: document.getElementById("sidebar-nav"),
    pageKicker: document.getElementById("page-kicker"),
    pageTitle: document.getElementById("page-title"),
    pageSubtitle: document.getElementById("page-subtitle"),
    headMeta: document.getElementById("head-meta"),
    tabPanels: document.getElementById("tab-panels"),
    rail: document.getElementById("workspace-rail"),
    metaSource: document.getElementById("meta-source"),
    metaFreshness: document.getElementById("meta-freshness"),
    brandCopy: document.getElementById("brand-copy"),
    modalHost: document.getElementById("modal-host"),
    drawerHost: document.getElementById("drawer-host"),
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function formatNumber(value, digits = 0) {
    if (value === null || value === undefined || value === "") return "-";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(numeric);
  }

  function formatMoney(value) {
    if (value === null || value === undefined || value === "") return "-";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(numeric);
  }

  function formatPercent(value, digits = 1) {
    if (value === null || value === undefined || value === "") return "-";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return `${numeric.toFixed(digits)}%`;
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function tabLabel(tab) {
    return TAB_META[tab]?.label || tab;
  }

  function normalizeSnapshotPart(value, fallback) {
    return String(value || fallback || "default").toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 80);
  }

  function snapshotKey(page, id) {
    return `STATIC_${normalizeSnapshotPart(page)}_PAYLOAD_${normalizeSnapshotPart(id || "default")}_JSON`;
  }

  function githubDataUrl(path) {
    return `${CONFIG.githubDataBaseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  function unwrapSnapshotRow(row, page, id) {
    if (!row) return null;
    const payload = row.payload || row;
    if (payload && typeof payload === "object") {
      payload.__payloadSource = "supabase_snapshot";
      payload.__snapshotKey = row.snapshot_key || snapshotKey(page, id);
      payload.__snapshotGeneratedAt = row.generated_at || payload.generatedAt || "";
    }
    return payload;
  }

  function markGithubPayload(payload, key) {
    if (payload && typeof payload === "object") {
      payload.__payloadSource = "github_snapshot";
      payload.__snapshotKey = key || "";
    }
    return payload;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, Object.assign({ cache: "no-store" }, options));
    if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
    return response.json();
  }

  async function fetchSupabaseSnapshot(page, id = "default") {
    const key = snapshotKey(page, id);
    const query = [
      "select=snapshot_key,payload,generated_at,source",
      `snapshot_key=eq.${encodeURIComponent(key)}`,
      "user_safe=eq.true",
      "limit=1",
    ].join("&");
    const rows = await fetchJson(`${CONFIG.supabaseUrl}/rest/v1/ll_payload_snapshots?${query}`, {
      headers: { apikey: CONFIG.supabasePublishableKey, Accept: "application/json" },
    });
    if (!Array.isArray(rows) || !rows.length) return null;
    return unwrapSnapshotRow(rows[0], page, id);
  }

  async function loadJsonCandidates(candidates, key) {
    for (const candidate of candidates) {
      try {
        if (!candidate) continue;
        if (candidate.type === "supabase") {
          if (IS_LOCAL_QA_ORIGIN) continue;
          const payload = await fetchSupabaseSnapshot(candidate.page, candidate.id);
          if (payload) {
            state.payloadSources[key || candidate.page] = "supabase_snapshot";
            return payload;
          }
        } else {
          const payload = await fetchJson(candidate.url || candidate);
          state.payloadSources[key || candidate.key || candidate.url || "github"] = "github_snapshot";
          return markGithubPayload(payload, key);
        }
      } catch (error) {
        // fall through to the next candidate
      }
    }
    return null;
  }

  async function loadBootstrap() {
    const bootstrap = await loadJsonCandidates([
      { type: "supabase", page: "bootstrap", id: "shell" },
      { url: githubDataUrl("bootstrap.json") },
    ], "bootstrap");
    state.bootstrap = bootstrap || {};
  }

  async function loadInitial() {
    const initial = await loadJsonCandidates([
      { url: githubDataUrl("initial.json") },
    ], "initial");
    state.initial = initial || { tabPayloads: {} };
    await Promise.all(["weekly", "home", "sector", "tools", "playground"].map(async (tab) => {
      state.tabs[tab] = await loadTabPayload(tab);
    }));
  }

  async function loadTabPayload(tab) {
    const direct = await loadJsonCandidates([
      { type: "supabase", page: tab, id: "default" },
      { url: githubDataUrl(`${tab}.json`) },
    ], tab);
    if (direct) return direct;
    return state.initial?.tabPayloads?.[tab] || null;
  }

  async function loadOptions() {
    const bootstrapAssetOptions = Array.isArray(state.bootstrap?.assetOptions) ? state.bootstrap.assetOptions : [];
    const bootstrapCompanyOptions = Array.isArray(state.bootstrap?.companyOptions) ? state.bootstrap.companyOptions : [];
    state.assetOptions = await loadJsonCandidates([
      bootstrapAssetOptions.length ? { url: "data:application/json," + encodeURIComponent(JSON.stringify(bootstrapAssetOptions)) } : null,
      { url: githubDataUrl("asset-options.json") },
    ].filter(Boolean), "asset-options") || [];
    state.companyOptions = await loadJsonCandidates([
      bootstrapCompanyOptions.length ? { url: "data:application/json," + encodeURIComponent(JSON.stringify(bootstrapCompanyOptions)) } : null,
      { url: githubDataUrl("company-options.json") },
    ].filter(Boolean), "company-options") || [];
    state.assetSelection = state.assetOptions[0] || null;
    state.companySelection = state.companyOptions[0] || null;
    state.assetDetail = state.assetSelection ? await loadEntityDetail("asset", state.assetSelection.assetId) : null;
    state.companyDetail = state.companySelection ? await loadEntityDetail("company", state.companySelection.tenantId) : null;
  }

  async function loadEntityDetail(type, id) {
    if (!id) return null;
    return loadJsonCandidates([
      { type: "supabase", page: type, id },
      { url: githubDataUrl(`${type}/${encodeURIComponent(id)}.json`) },
    ], `${type}:${id}`);
  }

  function currentSourceLabel() {
    const source = state.payloadSources[state.activeTab] || state.payloadSources.bootstrap || state.payloadSources.initial || "loading";
    if (source === "supabase_snapshot") return "supabase_snapshot";
    if (source === "github_snapshot") return "github_snapshot";
    return source;
  }

  function currentFreshness() {
    const stamp = state.bootstrap?.generatedAt || state.initial?.generatedAt || state.tabs.weekly?.generatedAt || "";
    return stamp ? formatDateTime(stamp) : "unknown freshness";
  }

  function setHead(tab) {
    const meta = TAB_META[tab] || TAB_META.weekly;
    el.pageKicker.textContent = tab === "weekly" ? "Weekly Operations" : meta.label;
    el.pageTitle.textContent = meta.label;
    el.pageSubtitle.textContent = meta.subtitle;
    el.headMeta.innerHTML = [
      `<div class="meta-chip"><span>Source</span><strong>${escapeHtml(currentSourceLabel())}</strong></div>`,
      `<div class="meta-chip"><span>Freshness</span><strong>${escapeHtml(currentFreshness())}</strong></div>`,
      `<div class="meta-chip"><span>Version</span><strong>${escapeHtml(state.bootstrap?.dataVersion || state.initial?.schemaVersion || "static")}</strong></div>`,
    ].join("");
  }

  function setSidebarMeta() {
    if (el.metaSource) el.metaSource.textContent = currentSourceLabel();
  }

  function navIcon(tab) {
    const paths = {
      weekly: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
      home: ['M3 11.5 12 4l9 7.5', 'M5 10.5V20h14v-9.5'],
      asset: ['M4 21V4h9v17', 'M13 9h7v12', 'M7 8h3', 'M7 12h3'],
      company: ['M16 21v-2a4 4 0 0 0-8 0v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
      sector: ['M4 12a8 8 0 1 0 8-8v8Z', 'M12 4a8 8 0 0 1 8 8h-8Z'],
      tools: ['M3 11h18', 'M7 7h10', 'M6 15h12', 'M10 19h4'],
      playground: ['M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z', 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06'],
      quality: ['M5 20h14', 'M7 20V6h10v14', 'M9 10h6', 'M9 14h6'],
      admin: ['M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z'],
      "admin-data": ['M4 5h16v14H4Z', 'M4 10h16', 'M9 5v14'],
    };
    return `<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${(paths[tab] || paths.weekly).map((path) => `<path d="${path}"></path>`).join("")}</svg></span>`;
  }

  function renderSidebar() {
    const userTabs = BASE_TAB_ORDER.map((tab) => `
      <button class="nav-item${tab === state.activeTab ? " is-active" : ""}" type="button" data-tab="${tab}"${tab === state.activeTab ? ' aria-current="page"' : ""}>
        ${navIcon(tab)}<span class="nav-label">${escapeHtml(tabLabel(tab))}</span>
      </button>
    `).join("");
    const adminTabs = IS_ADMIN_APP ? `
      <div class="nav-group"><span>Admin</span><span>⌄</span></div>
      ${ADMIN_TAB_ORDER.map((tab) => `
        <button class="nav-item${tab === state.activeTab ? " is-active" : ""}" type="button" data-tab="${tab}"${tab === state.activeTab ? ' aria-current="page"' : ""}>
          ${navIcon(tab)}<span class="nav-label">${escapeHtml(tabLabel(tab))}</span>
        </button>
      `).join("")}
    ` : "";
    el.sidebarNav.innerHTML = `
      <div class="nav-group"><span>Dashboard</span><span>⌄</span></div>
      ${userTabs}
      ${adminTabs}
    `;
  }

  function renderPanels() {
    const tab = state.activeTab;
    el.tabPanels.innerHTML = `
      <section class="tab-panel is-active" data-panel="${escapeHtml(tab)}">
        <div class="tab-panel-inner">${renderTab(tab)}</div>
      </section>
    `;
    applySectionOrder(tab);
  }

  function renderTab(tab) {
    switch (tab) {
      case "weekly":
        return renderWeekly();
      case "home":
        return renderHome();
      case "asset":
        return renderAsset();
      case "company":
        return renderCompany();
      case "sector":
        return renderSector();
      case "tools":
        return renderTools();
      case "playground":
        return renderPlayground();
      case "quality":
        return renderQuality();
      case "admin":
        return renderAdmin();
      case "admin-data":
        return renderAdminData();
      default:
        return `<div class="empty-state">탭을 찾을 수 없습니다.</div>`;
    }
  }

  function sectionIdFromTitle(title) {
    return `section-${String(title || "item")
      .toLowerCase()
      .replace(/[^0-9a-z가-힣]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "item"}`;
  }

  function currentSectionIndex(tab = state.activeTab) {
    const panel = document.querySelector(`[data-panel="${CSS.escape(tab)}"]`);
    return Array.from(panel?.querySelectorAll(".section[data-section-id]") || []).map((section) => ({
      id: section.dataset.sectionId,
      title: section.dataset.sectionTitle || section.querySelector(".section-title")?.textContent || "Section",
    }));
  }

  function sectionStateKey(tab, sectionId) {
    return `${tab}:${sectionId}`;
  }

  function applySectionOrder(tab) {
    const panel = document.querySelector(`[data-panel="${CSS.escape(tab)}"] .tab-panel-inner`);
    if (!panel) return;
    const sections = Array.from(panel.querySelectorAll(".section[data-section-id]"));
    const defaultIds = sections.map((section) => section.dataset.sectionId);
    const orderedIds = (state.sectionOrder[tab] || []).filter((id) => defaultIds.includes(id));
    const finalIds = orderedIds.concat(defaultIds.filter((id) => !orderedIds.includes(id)));
    finalIds.forEach((id) => {
      const section = sections.find((item) => item.dataset.sectionId === id);
      if (section) panel.appendChild(section);
    });
  }

  function moveSection(tab, sectionId, direction) {
    const sections = currentSectionIndex(tab);
    const ids = sections.map((section) => section.id);
    const currentIndex = ids.indexOf(sectionId);
    if (currentIndex < 0) return;
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[currentIndex], ids[nextIndex]] = [ids[nextIndex], ids[currentIndex]];
    state.sectionOrder[tab] = ids;
    renderPanels();
    renderRail();
  }

  function renderSection(title, subtitle, body, extra = "", id = "") {
    const sectionId = id || sectionIdFromTitle(title);
    const collapsed = !!state.collapsedSections[sectionStateKey(state.activeTab, sectionId)];
    const kicker = TAB_META[state.activeTab]?.label || "Workspace";
    return `
      <section class="section ${collapsed ? "collapsed" : "open"}" id="${escapeHtml(sectionId)}" data-section-id="${escapeHtml(sectionId)}" data-section-title="${escapeHtml(title)}">
        <div class="section-head">
          <div>
            <p class="section-kicker">${escapeHtml(kicker)}</p>
            <h2 class="section-title">${escapeHtml(title)}</h2>
            ${subtitle ? `<p class="section-subtitle">${escapeHtml(subtitle)}</p>` : ""}
          </div>
          <div class="section-head-actions">
            ${extra}
            <button class="section-toggle" type="button" data-section-toggle="${escapeHtml(sectionId)}" aria-expanded="${collapsed ? "false" : "true"}" aria-label="${collapsed ? "섹션 펼치기" : "섹션 접기"}">${collapsed ? "+" : "-"}</button>
          </div>
        </div>
        <div class="section-body">${body}</div>
      </section>
    `;
  }

  function renderSummaryCards(items) {
    return `
      <div class="summary-strip">
        ${items.map((item) => `
          <article class="summary-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            ${item.note ? `<em>${escapeHtml(item.note)}</em>` : ""}
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderFacts(rows) {
    return `
      <div class="fact-grid">
        ${rows.map((row) => `
          <div class="fact">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value || "-")}</strong>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderWeekly() {
    const data = state.tabs.weekly || state.initial?.tabPayloads?.weekly || {};
    const summary = data.summary || {};
    const topCards = [
      { label: "자산 수", value: formatNumber(summary.assetCount), note: "weekly summary" },
      { label: "완전임대", value: formatNumber(summary.fullyLeasedCount), note: "weekly summary" },
      { label: "임대이슈", value: formatNumber(summary.leaseUpIssueCount), note: "weekly summary" },
      { label: "연면적 합계", value: `${formatNumber(summary.totalGrossAreaPy)}평`, note: "weekly summary" },
    ];

    const newProjects = data.newProjects || [];
    const managementProjects = data.managementProjects || [];
    const assetRows = data.assetRows || [];
    const notes = data.notes || [];

    const newProjectBody = newProjects.length
      ? `<div class="card-grid">${newProjects.map((item) => `
          <article class="project-card" data-drawer-target="new-project" data-project-id="${escapeHtml(item.id)}" tabindex="0" role="button">
            <h4>${escapeHtml(item.projectName || `프로젝트 ${item.no || ""}`)}</h4>
            <p>${escapeHtml(item.overview || "")}</p>
            ${renderFacts([
              { label: "자금", value: item.funding || "-" },
              { label: "이슈", value: item.issue || "-" },
              { label: "계획", value: item.plan || "-" },
            ])}
          </article>
        `).join("")}</div>`
      : `<div class="empty-state">신규 투자 Projects가 없습니다.</div>`;

    const managementBody = managementProjects.length
      ? `<div class="card-grid">${managementProjects.map((item) => `
          <article class="project-card" data-drawer-target="management-project" data-project-id="${escapeHtml(item.id)}" tabindex="0" role="button">
            <h4>${escapeHtml(item.projectName || `관리 Project ${item.no || ""}`)}</h4>
            <p>${escapeHtml(item.overview || item.status || "")}</p>
            ${renderFacts([
              { label: "이슈", value: item.issue || "-" },
              { label: "계획", value: item.plan || "-" },
              { label: "현황", value: item.status || "-" },
            ])}
          </article>
        `).join("")}</div>`
      : `<div class="empty-state">관리 Projects가 없습니다.</div>`;

    const summaryBody = renderSummaryCards(topCards);
    const assetTable = `
        ${assetRows.length
          ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width:56px">No</th>
                <th>자산명</th>
                <th>구분</th>
                <th>취득</th>
                <th>준공</th>
                <th class="numeric">Gross Area</th>
                <th>주요 임차사</th>
                <th>임대율</th>
                <th>주요 이슈</th>
                <th>원가 비교</th>
                <th>대출 만기</th>
                <th>펀드 만기</th>
              </tr>
            </thead>
            <tbody>
              ${assetRows.map((row) => `
                <tr data-drawer-target="weekly-asset" data-row-id="${escapeHtml(row.id)}" tabindex="0" role="button">
                  <td>${escapeHtml(row.no)}</td>
                  <td>${escapeHtml(row.assetName)}</td>
                  <td>${escapeHtml(row.category)}</td>
                  <td>${escapeHtml(row.acquisition || "-")}</td>
                  <td>${escapeHtml(row.completion || "-")}</td>
                  <td class="numeric">${escapeHtml(row.grossAreaPy ? `${formatNumber(row.grossAreaPy)}평` : "-")}</td>
                  <td>${escapeHtml(row.mainTenant || "-")}</td>
                  <td>${escapeHtml(row.occupancyRate || "-")}</td>
                  <td>${escapeHtml(row.mainIssue || "-")}</td>
                  <td>${escapeHtml(row.costTrend || "-")}</td>
                  <td>${escapeHtml(row.loanMaturity || "-")}</td>
                  <td>${escapeHtml(row.fundMaturity || "-")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`
          : `<div class="empty-state">자산현황 데이터가 없습니다.</div>`}
      `;

    const notesBody = notes.length
      ? `<div class="card-grid">${notes.map((note) => `
          <article class="info-card" data-modal-target="note" data-note-id="${escapeHtml(note.id)}" tabindex="0" role="button">
            <h4>${escapeHtml(note.title || "기준 및 기타사항")}</h4>
            <p>${escapeHtml(note.body || "")}</p>
          </article>
        `).join("")}</div>`
      : `<div class="empty-state">기준 및 기타사항이 없습니다.</div>`;

    return `
      ${renderSection("요약", "주간업무자료 주요 지표", summaryBody, "", "weekly-summary")}
      ${renderSection("신규 투자 Projects", "신규 투자 프로젝트 진행 현황", newProjectBody, "", "weekly-new-projects")}
      ${renderSection("관리 Projects", "기설정 물류 프로젝트 운용 현황", managementBody, "", "weekly-management-projects")}
      ${renderSection("자산현황", "주간업무자료 원래 구성의 물류 전체 자산현황", assetTable, "", "weekly-assets")}
      ${renderSection("기준 및 기타사항", "원문 기준과 운영상 유의사항", notesBody, "", "weekly-notes")}
    `;
  }

  function renderHome() {
    const data = state.tabs.home || {};
    const kpis = data.kpis || [];
    const topTenants = data.topTenants || [];
    const rentTrendSummary = data.rentTrendSummary || {};
    const occupancy = data.occupancy || [];
    const rentTrend = data.rentTrend || [];
    const tenantSummary = data.tenantSummary || [];

    const kpiCards = kpis.length
      ? renderSummaryCards(kpis.slice(0, 5).map((item) => ({
          label: item.label || item.key || "KPI",
          value: item.value ?? item.displayValue ?? "-",
          note: item.note || "",
        })))
      : `<div class="empty-state">Home KPI가 없습니다.</div>`;

    const tenantTable = topTenants.length
      ? `<div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Asset</th>
                <th class="numeric">Leased Area</th>
                <th class="numeric">Monthly Cost</th>
                <th>Expiry</th>
              </tr>
            </thead>
            <tbody>
              ${topTenants.map((row) => `
                <tr>
                  <td>${escapeHtml(row.tenantMasterName || row.label || "-")}</td>
                  <td>${escapeHtml(row.assetName || row.asset || "-")}</td>
                  <td class="numeric">${escapeHtml(row.leasedAreaSqm ? formatNumber(row.leasedAreaSqm, 2) : row.area || "-")}</td>
                  <td class="numeric">${escapeHtml(row.monthlyCostTotal ? formatMoney(row.monthlyCostTotal) : "-")}</td>
                  <td>${escapeHtml(row.latestExpiry || "-")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`
      : `<div class="empty-state">Top tenants 데이터가 없습니다.</div>`;

    const occupancyCards = occupancy.length
      ? `<div class="card-grid">${occupancy.slice(0, 4).map((item) => `
          <article class="info-card">
            <h4>${escapeHtml(item.label || item.assetName || "Occupancy")}</h4>
            <p>${escapeHtml(item.value || item.monthlyCostTotal || "")}</p>
          </article>
        `).join("")}</div>`
      : `<div class="empty-state">Occupancy 데이터가 없습니다.</div>`;

    return `
      ${renderSection("Home KPI", "홈 탭의 핵심 요약", kpiCards)}
      ${renderSection("임대료 추세", rentTrendSummary?.title || "rentTrendSummary", renderFacts([
        { label: "Summary", value: rentTrendSummary.summary || "-" },
        { label: "Basis", value: data.rentTrendBasis || data.basis || "-" },
        { label: "Latest", value: data.generatedAt ? formatDateTime(data.generatedAt) : "-" },
      ]))}
      ${renderSection("Top Tenants", "상위 임차인", tenantTable)}
      ${renderSection("Occupancy", "기존 payload의 occupancy 배열", occupancyCards)}
      ${renderSection("Tenant Summary", "요약 리스트", tenantSummary.length ? `<div class="card-grid">${tenantSummary.slice(0, 4).map((item) => `
        <article class="info-card"><h4>${escapeHtml(item.label || item.title || "Summary")}</h4><p>${escapeHtml(item.value || item.text || "")}</p></article>
      `).join("")}</div>` : `<div class="empty-state">Tenant summary가 없습니다.</div>`)}
      ${renderSection("Rent Trend", "원문 배열은 그대로 내부 검토용 테이블로 확인합니다.", rentTrend.length ? `<div class="table-wrap"><table><thead><tr><th>Month</th><th class="numeric">Monthly Rent</th><th class="numeric">Leased Area</th><th class="numeric">Monthly Total</th></tr></thead><tbody>${rentTrend.slice(0, 12).map((row) => `
        <tr><td>${escapeHtml(row.month || "-")}</td><td class="numeric">${escapeHtml(row.monthlyRentTotal ? formatMoney(row.monthlyRentTotal) : "-")}</td><td class="numeric">${escapeHtml(row.leasedAreaSqm ? formatNumber(row.leasedAreaSqm, 2) : "-")}</td><td class="numeric">${escapeHtml(row.monthlyTotal ? formatMoney(row.monthlyTotal) : "-")}</td></tr>
      `).join("")}</tbody></table></div>` : `<div class="empty-state">Rent trend가 없습니다.</div>`)}
    `;
  }

  function renderAsset() {
    const options = state.assetOptions || [];
    const selection = state.assetSelection || options[0] || null;
    const detail = state.assetDetail || {};
    const analytics = detail.analytics || {};
    const kpis = detail.kpis || [];
    const topTenants = detail.topTenants || [];
    const rows = detail.rows || [];
    const areaBreakdown = detail.areaBreakdown || [];

    const selector = `
      <div class="select-row">
        <label class="kicker" for="asset-select">ASSET SELECTOR</label>
        <select id="asset-select">
          ${options.map((option) => `<option value="${escapeHtml(option.assetId)}"${selection?.assetId === option.assetId ? " selected" : ""}>${escapeHtml(option.assetName)}</option>`).join("")}
        </select>
      </div>
    `;

    const headline = renderSummaryCards([
      { label: "Selected Asset", value: selection?.assetName || detail.meta?.selection?.assetName || "-" },
      { label: "Tenant Count", value: formatNumber(selection?.uniqueTenantCount || detail.meta?.rowCount || 0) },
      { label: "Vacancy Rate", value: formatPercent((selection?.vacancyRate || 0) * 100, 1) },
      { label: "Monthly Cost", value: formatMoney(selection?.monthlyCostTotal || detail.meta?.monthlyCostTotal || 0) },
      { label: "Fetched", value: selection?.fetchedAt || detail.generatedAt || "-" },
    ]);

    const tenantCards = (analytics.coreTenants || topTenants || []).slice(0, 4);
    const coreCards = tenantCards.length
      ? `<div class="card-grid">${tenantCards.map((item) => `
          <article class="company-card">
            <h4>${escapeHtml(item.tenantMasterName || item.label || "Tenant")}</h4>
            <p>${escapeHtml(item.assetCount ? `${item.assetCount} assets` : "")}</p>
            ${renderFacts([
              { label: "Area", value: item.leasedAreaSqm ? `${formatNumber(item.leasedAreaSqm, 2)} ㎡` : "-" },
              { label: "Cost", value: item.monthlyCostTotal ? formatMoney(item.monthlyCostTotal) : "-" },
              { label: "Expiry", value: item.latestExpiry || item.earliestExpiry || "-" },
            ])}
          </article>
        `).join("")}</div>`
      : `<div class="empty-state">핵심 임차인 정보가 없습니다.</div>`;

    const rentVsMf = analytics.rentVsMf || [];
    const rentTable = rentVsMf.length
      ? `<div class="table-wrap">
          <table>
            <thead><tr><th>Tenant</th><th class="numeric">Rent</th><th class="numeric">MF</th><th class="numeric">Total</th><th class="numeric">Area</th></tr></thead>
            <tbody>${rentVsMf.slice(0, 12).map((row) => `
              <tr>
                <td>${escapeHtml(row.tenantMasterName || "-")}</td>
                <td class="numeric">${escapeHtml(row.monthlyRentTotal ? formatMoney(row.monthlyRentTotal) : "-")}</td>
                <td class="numeric">${escapeHtml(row.monthlyMfTotal ? formatMoney(row.monthlyMfTotal) : "-")}</td>
                <td class="numeric">${escapeHtml(row.monthlyTotal ? formatMoney(row.monthlyTotal) : "-")}</td>
                <td class="numeric">${escapeHtml(row.leasedAreaPy ? formatNumber(row.leasedAreaPy, 2) : "-")}</td>
              </tr>
            `).join("")}</tbody>
          </table>
        </div>`
      : `<div class="empty-state">Rent vs MF 데이터가 없습니다.</div>`;

    const areaTable = areaBreakdown.length
      ? `<div class="table-wrap">
          <table>
            <thead><tr><th>Label</th><th class="numeric">Area</th><th class="numeric">Share</th></tr></thead>
            <tbody>${areaBreakdown.slice(0, 8).map((row) => `
              <tr><td>${escapeHtml(row.label || row.detailAreaLabel || "-")}</td><td class="numeric">${escapeHtml(row.leasedAreaSqm ? formatNumber(row.leasedAreaSqm, 2) : "-")}</td><td class="numeric">${escapeHtml(row.share ? formatPercent(row.share * 100, 1) : "-")}</td></tr>
            `).join("")}</tbody>
          </table>
        </div>`
      : `<div class="empty-state">Area breakdown이 없습니다.</div>`;

    return `
      ${renderSection("자산 선택", "option list를 통해 개별 JSON을 읽습니다.", selector)}
      ${renderSection("자산 요약", "정적 데이터 기준의 현재 자산 상태", headline)}
      ${renderSection("핵심 임차인", "지표를 임의로 재배치하지 않습니다.", coreCards)}
      ${renderSection("Rent vs MF", "원문 rows를 테이블로 확인", rentTable)}
      ${renderSection("Area Breakdown", "보조 영역", areaTable)}
      ${renderSection("Raw Rows", "기본 화면은 추론 섹션을 두지 않습니다.", rows.length ? `<div class="table-wrap"><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${rows.slice(0, 8).map((row) => `
        <tr><td>${escapeHtml(row.label || row.key || "-")}</td><td>${escapeHtml(row.value || row.text || "-")}</td></tr>
      `).join("")}</tbody></table></div>` : `<div class="empty-state">Raw rows가 없습니다.</div>`)}
    `;
  }

  function renderCompany() {
    const options = state.companyOptions || [];
    const selection = state.companySelection || options[0] || null;
    const detail = state.companyDetail || {};
    const financials = detail.financials || {};
    const operations = detail.operations || {};
    const profile = detail.profile || {};
    const leasedAssets = detail.leasedAssets || [];
    const rows = detail.rows || [];

    const selector = `
      <div class="select-row">
        <label class="kicker" for="company-select">COMPANY SELECTOR</label>
        <select id="company-select">
          ${options.map((option) => `<option value="${escapeHtml(option.tenantId)}"${selection?.tenantId === option.tenantId ? " selected" : ""}>${escapeHtml(option.tenantMasterName)}</option>`).join("")}
        </select>
      </div>
    `;

    const headline = renderSummaryCards([
      { label: "Selected Company", value: selection?.tenantMasterName || profile.tenantMasterName || "-" },
      { label: "Asset Count", value: formatNumber(selection?.assetCount || profile.assetCount || 0) },
      { label: "Revenue", value: financials.revenue ? formatMoney(financials.revenue) : formatMoney(selection?.latestRevenue) },
      { label: "Monthly Cost", value: formatMoney(selection?.monthlyCostTotal || profile.monthlyCostTotal || 0) },
      { label: "Latest Expiry", value: selection?.latestExpiry || profile.latestExpiry || "-" },
    ]);

    const exposure = operations.exposure || {};
    const exposureCards = [
      { label: "By Asset", rows: exposure.byAsset || [] },
      { label: "By Sector", rows: exposure.bySector || [] },
      { label: "By Goods Type", rows: exposure.byGoodsType || [] },
      { label: "By Region", rows: exposure.byRegion || [] },
    ];

    const exposureHtml = exposureCards.some((card) => card.rows && card.rows.length)
      ? `<div class="card-grid">${exposureCards.map((card) => `
          <article class="info-card">
            <h4>${escapeHtml(card.label)}</h4>
            <p>${escapeHtml((card.rows || []).length ? `${card.rows.length} row(s)` : "No rows")}</p>
            <div class="rail-list">${(card.rows || []).slice(0, 3).map((row) => `
              <div class="rail-item">
                <span>${escapeHtml(row.label || row.assetName || row.tenantMasterName || "-")}</span>
                <strong>${escapeHtml(row.monthlyCostTotal ? formatMoney(row.monthlyCostTotal) : row.leasedAreaSqm ? `${formatNumber(row.leasedAreaSqm, 2)} ㎡` : "-")}</strong>
              </div>
            `).join("")}</div>
          </article>
        `).join("")}</div>`
      : `<div class="empty-state">Exposure 데이터가 없습니다.</div>`;

    const leasedTable = leasedAssets.length
      ? `<div class="table-wrap">
          <table>
            <thead><tr><th>Asset</th><th>Period</th><th class="numeric">Area</th><th class="numeric">Monthly Cost</th></tr></thead>
            <tbody>${leasedAssets.map((row) => `
              <tr>
                <td>${escapeHtml(row.assetName || "-")}</td>
                <td>${escapeHtml(row.period || "-")}</td>
                <td class="numeric">${escapeHtml(row.leasedAreaSqm ? formatNumber(row.leasedAreaSqm, 2) : "-")}</td>
                <td class="numeric">${escapeHtml(row.monthlyCostTotal ? formatMoney(row.monthlyCostTotal) : "-")}</td>
              </tr>
            `).join("")}</tbody>
          </table>
        </div>`
      : `<div class="empty-state">Leased assets가 없습니다.</div>`;

    return `
      ${renderSection("기업 선택", "옵션 목록을 통해 개별 기업 JSON을 읽습니다.", selector)}
      ${renderSection("기업 요약", "재배치 없이 기본 수치를 먼저 보여줍니다.", headline)}
      ${renderSection("Financials", "DART 연동 또는 수집 기준", renderFacts([
        { label: "Revenue", value: financials.revenue ? formatMoney(financials.revenue) : "-" },
        { label: "Operating Income", value: financials.operatingIncome ? formatMoney(financials.operatingIncome) : "-" },
        { label: "Debt Ratio", value: financials.debtRatio ? formatPercent(financials.debtRatio, 2) : "-" },
        { label: "Employees", value: financials.employeeCount ? formatNumber(financials.employeeCount) : "-" },
      ]))}
      ${renderSection("Operations Exposure", "권역 / 섹터 / 상품군", exposureHtml)}
      ${renderSection("Leased Assets", "선택 기업과 연결된 자산", leasedTable)}
      ${renderSection("Raw Rows", "기본 화면에서는 추론 카드를 넣지 않습니다.", rows.length ? `<div class="table-wrap"><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${rows.slice(0, 8).map((row) => `
        <tr><td>${escapeHtml(row.label || row.key || "-")}</td><td>${escapeHtml(row.value || row.text || "-")}</td></tr>
      `).join("")}</tbody></table></div>` : `<div class="empty-state">Raw rows가 없습니다.</div>`)}
    `;
  }

  function renderSector() {
    const data = state.tabs.sector || {};
    const rankings = data.rankings || {};
    const assetsByArea = rankings.assetsByArea || [];
    const expiryRows = data.expiryRows || [];
    const expiryBuckets = data.expiryBuckets || [];
    const kpis = data.kpis || [];

    return `
      ${renderSection("Sector KPI", "섹터 노출과 만기 분포", kpis.length ? renderSummaryCards(kpis.slice(0, 5).map((item) => ({ label: item.label || "KPI", value: item.value ?? "-", note: item.note || "" }))) : `<div class="empty-state">Sector KPI가 없습니다.</div>`)}
      ${renderSection("Assets by Area", "assetsByArea", assetsByArea.length ? `<div class="table-wrap"><table><thead><tr><th>Asset</th><th class="numeric">Area</th><th class="numeric">Vacancy</th><th class="numeric">Monthly Cost</th></tr></thead><tbody>${assetsByArea.slice(0, 12).map((row) => `
        <tr><td>${escapeHtml(row.assetName || "-")}</td><td class="numeric">${escapeHtml(row.leasedAreaSqm ? formatNumber(row.leasedAreaSqm, 2) : "-")}</td><td class="numeric">${escapeHtml(row.vacancyRate !== undefined ? formatPercent(row.vacancyRate * 100, 1) : "-")}</td><td class="numeric">${escapeHtml(row.monthlyCostTotal ? formatMoney(row.monthlyCostTotal) : "-")}</td></tr>
      `).join("")}</tbody></table></div>` : `<div class="empty-state">assetsByArea 데이터가 없습니다.</div>`)}
      ${renderSection("Expiry Rows", "만기 우선 확인용 데이터", expiryRows.length ? `<div class="table-wrap"><table><thead><tr><th>Asset</th><th>Tenant</th><th>Expiry</th><th class="numeric">Area</th></tr></thead><tbody>${expiryRows.slice(0, 12).map((row) => `
        <tr><td>${escapeHtml(row.assetName || "-")}</td><td>${escapeHtml(row.tenantMasterName || "-")}</td><td>${escapeHtml(row.latestExpiry || "-")}</td><td class="numeric">${escapeHtml(row.leasedAreaSqm ? formatNumber(row.leasedAreaSqm, 2) : "-")}</td></tr>
      `).join("")}</tbody></table></div>` : `<div class="empty-state">Expiry rows가 없습니다.</div>`)}
      ${renderSection("Expiry Buckets", "bucket summary", expiryBuckets.length ? `<div class="card-grid">${expiryBuckets.map((item) => `
        <article class="info-card"><h4>${escapeHtml(item.label || item.month || "Bucket")}</h4><p>${escapeHtml(item.value || item.count || "-")}</p></article>
      `).join("")}</div>` : `<div class="empty-state">Expiry buckets가 없습니다.</div>`)}
    `;
  }

  function renderTools() {
    const data = state.tabs.tools || {};
    const filters = data.filters || [];
    const benchmarkRows = data.benchmarkRows || [];
    const companies = data.companies || [];
    const assets = data.assets || [];
    const deltas = data.deltas || [];

    return `
      ${renderSection("Selection", "기준 선택 상태", renderFacts([
        { label: "Selection", value: data.selectionMeta?.summaryLabel || "-" },
        { label: "Reason", value: data.selectionMeta?.reason || "-" },
        { label: "Default", value: String(!!data.selectionMeta?.isDefaultSelection) },
      ]))}
      ${renderSection("Filters", "기본 필터 목록", filters.length ? `<div class="card-grid">${filters.map((item) => `
        <article class="info-card"><h4>${escapeHtml(item.label || item.key || "Filter")}</h4><p>${escapeHtml(item.value || item.text || "")}</p></article>
      `).join("")}</div>` : `<div class="empty-state">Filters가 없습니다.</div>`)}
      ${renderSection("Benchmark Rows", "비교 보조 테이블", benchmarkRows.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th class="numeric">Value</th><th>Basis</th></tr></thead><tbody>${benchmarkRows.slice(0, 10).map((row) => `
        <tr><td>${escapeHtml(row.label || row.name || "-")}</td><td class="numeric">${escapeHtml(row.value || row.displayValue || "-")}</td><td>${escapeHtml(row.basis || row.note || "-")}</td></tr>
      `).join("")}</tbody></table></div>` : `<div class="empty-state">Benchmark rows가 없습니다.</div>`)}
      ${renderSection("Companies", "선택 후보", companies.length ? `<div class="card-grid">${companies.slice(0, 4).map((item) => `
        <article class="info-card"><h4>${escapeHtml(item.tenantMasterName || item.label || "Company")}</h4><p>${escapeHtml(item.latestExpiry || item.value || "")}</p></article>
      `).join("")}</div>` : `<div class="empty-state">Companies가 없습니다.</div>`)}
      ${renderSection("Assets", "선택 후보", assets.length ? `<div class="card-grid">${assets.slice(0, 4).map((item) => `
        <article class="info-card"><h4>${escapeHtml(item.assetName || item.label || "Asset")}</h4><p>${escapeHtml(item.vacancyRate !== undefined ? formatPercent(item.vacancyRate * 100, 1) : item.value || "")}</p></article>
      `).join("")}</div>` : `<div class="empty-state">Assets가 없습니다.</div>`)}
      ${renderSection("Deltas", "차이값 요약", deltas.length ? `<div class="table-wrap"><table><thead><tr><th>Label</th><th class="numeric">Delta</th><th>Memo</th></tr></thead><tbody>${deltas.slice(0, 10).map((row) => `
        <tr><td>${escapeHtml(row.label || row.name || "-")}</td><td class="numeric">${escapeHtml(row.delta || row.value || "-")}</td><td>${escapeHtml(row.memo || row.note || "-")}</td></tr>
      `).join("")}</tbody></table></div>` : `<div class="empty-state">Deltas가 없습니다.</div>`)}
    `;
  }

  function renderPlayground() {
    const data = state.tabs.playground || {};
    const summaryCards = data.summaryCards || [];
    const rows = data.rows || [];
    const savedViews = data.savedViews || [];
    const metrics = data.metrics || [];

    return `
      ${renderSection("Summary Cards", "탐색용 요약", summaryCards.length ? `<div class="summary-strip">${summaryCards.slice(0, 5).map((item) => `
        <article class="summary-card"><span>${escapeHtml(item.label || item.title || "Card")}</span><strong>${escapeHtml(item.value || item.displayValue || "-")}</strong><em>${escapeHtml(item.caption || item.note || "")}</em></article>
      `).join("")}</div>` : `<div class="empty-state">Summary cards가 없습니다.</div>`)}
      ${renderSection("Metrics", "탐색 지표", metrics.length ? `<div class="card-grid">${metrics.slice(0, 4).map((item) => `
        <article class="info-card"><h4>${escapeHtml(item.label || item.key || "Metric")}</h4><p>${escapeHtml(item.value || item.text || "-")}</p></article>
      `).join("")}</div>` : `<div class="empty-state">Metrics가 없습니다.</div>`)}
      ${renderSection("Saved Views", "저장된 보기", savedViews.length ? `<div class="card-grid">${savedViews.map((item) => `
        <article class="info-card"><h4>${escapeHtml(item.label || item.title || "Saved view")}</h4><p>${escapeHtml(item.description || item.note || "")}</p></article>
      `).join("")}</div>` : `<div class="empty-state">Saved views가 없습니다.</div>`)}
      ${renderSection("Rows", "원시 행 데이터를 테이블로 확인", rows.length ? `<div class="table-wrap"><table><thead><tr><th>Label</th><th>Value</th><th>Basis</th></tr></thead><tbody>${rows.slice(0, 12).map((row) => `
        <tr><td>${escapeHtml(row.label || row.name || "-")}</td><td>${escapeHtml(row.value || row.displayValue || "-")}</td><td>${escapeHtml(row.basis || row.note || "-")}</td></tr>
      `).join("")}</tbody></table></div>` : `<div class="empty-state">Rows가 없습니다.</div>`)}
    `;
  }

  function renderQuality() {
    const bootstrap = state.bootstrap || {};
    const initial = state.initial || {};
    const sourceRule = IS_LOCAL_QA_ORIGIN
      ? "로컬 QA에서는 Supabase 요청을 건너뛰고 GitHub JSON을 사용"
      : "GitHub Pages 실URL에서는 Supabase snapshot 우선, 실패 시 GitHub JSON 사용";
    return `
      ${renderSection("Data Source", sourceRule, renderFacts([
        { label: "Source", value: currentSourceLabel() },
        { label: "Generated", value: currentFreshness() },
        { label: "Schema", value: state.tabs.weekly?.schemaVersion || initial.schemaVersion || "-" },
        { label: "Mode", value: IS_LOCAL_QA_ORIGIN ? "Local QA static app" : "GitHub Pages static app" },
      ]))}
      ${renderSection("Payloads", "읽은 JSON 파일", `<div class="card-grid">
        ${["bootstrap", "initial", "weekly", "home", "sector", "tools", "playground"].map((name) => `
          <article class="info-card"><h4>${escapeHtml(name)}</h4><p>${escapeHtml(state.payloadSources[name] || "pending")}</p></article>
        `).join("")}
      </div>`)}
    `;
  }

  function renderAdminLocked(message = "") {
    return `
      <div class="empty-state">${escapeHtml(message || "관리자 기능은 백엔드 인증 연결 뒤에만 사용할 수 있습니다.")}</div>
      <form class="admin-auth-form" id="admin-auth-form" autocomplete="off">
        <div class="select-row">
          <label class="kicker" for="admin-password">관리자 인증</label>
          <input id="admin-password" name="password" type="password" autocomplete="current-password" required>
        </div>
        <div style="height:12px"></div>
        <button class="button" type="submit">인증</button>
      </form>
    `;
  }

  function renderAdmin() {
    if (!IS_ADMIN_APP) return `<div class="empty-state">Admin 페이지가 아닙니다.</div>`;
    if (!state.adminVerified) {
      return renderSection("Admin 잠금", "백엔드 인증이 연결되기 전에는 관리 기능을 렌더링하지 않습니다.", renderAdminLocked(state.adminMessage));
    }
    return `
      ${renderSection("Admin Actions", "인증된 서버 작업", `<div class="button-row">
        <button class="button" type="button" data-admin-action="dry-run">Dry Run</button>
        <button class="button" type="button" data-admin-action="sync">Sheets to Supabase</button>
        <button class="button" type="button" data-admin-action="snapshot">Refresh Snapshots</button>
        <button class="button" type="button" data-admin-action="cache-clear">Cache Clear</button>
      </div>`)}
      ${renderSection("상태", "브라우저에는 서버 비밀키를 표시하지 않습니다.", renderFacts([
        { label: "Supabase URL", value: CONFIG.supabaseUrl },
        { label: "Server Secret", value: "서버 보관" },
        { label: "Data Source", value: currentSourceLabel() },
        { label: "Backend", value: "관리 서버 연결 대기" },
      ]))}
    `;
  }

  function renderAdminData() {
    if (!IS_ADMIN_APP) return `<div class="empty-state">Admin Data 페이지가 아닙니다.</div>`;
    if (!state.adminVerified) {
      return renderSection("Admin Data 잠금", "백엔드 인증이 연결되기 전에는 운영 데이터를 렌더링하지 않습니다.", renderAdminLocked(state.adminMessage));
    }
    const rows = [
      ["ll_assets", "물류 자산"],
      ["ll_tenants", "임차인"],
      ["ll_leases", "계약"],
      ["ll_lease_spaces", "계약 공간"],
      ["ll_rent_history", "임대료 이력"],
      ["ll_payload_snapshots", "화면 snapshot"],
    ];
    return renderSection("Supabase ll_*", "Google Sheets 물류 원본 기준 운영 테이블", `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Table</th><th>Description</th><th>Source Rule</th></tr></thead>
          <tbody>${rows.map(([table, desc]) => `<tr><td>${escapeHtml(table)}</td><td>${escapeHtml(desc)}</td><td>google_sheets only</td></tr>`).join("")}</tbody>
        </table>
      </div>
    `);
  }

  function renderRail() {
    const current = state.activeTab;
    const panelData = state.tabs[current] || {};
    const visibleTabs = TAB_ORDER.slice(0, IS_ADMIN_APP ? 10 : 8);
    const sections = currentSectionIndex(current);
    const projectButtons = [
      ["total", "통합"],
      ["logistics", "Logistics"],
      ["leasing", "Leasing"],
    ];
    el.rail.innerHTML = `
      <div class="rail-label">Project</div>
      ${projectButtons.map(([id, label], index) => `
        <button class="rail-btn project-btn${id === state.activeProject ? " active" : ""}" type="button" data-project="${id}" aria-pressed="${id === state.activeProject ? "true" : "false"}">${escapeHtml(label)}</button>
      `).join("")}
      <div class="rail-divider"></div>
      <div class="rail-label">View</div>
      ${visibleTabs.map((tab) => `
        <button class="view-btn${tab === current ? " active" : ""}" type="button" data-tab="${tab}"${tab === current ? ' aria-current="page"' : ""}>${escapeHtml(tabLabel(tab))}</button>
      `).join("")}
      <button class="view-btn" type="button" data-theme-toggle>Theme</button>
      <div class="rail-index" aria-label="현재 화면 목차">
        <div class="rail-index-title">Index</div>
        <div class="rail-index-list">
          ${sections.map((section, index) => `
            <div class="rail-index-item" data-section-target="${escapeHtml(section.id)}">
              <button class="rail-index-btn${index === 0 ? " active" : ""}" type="button" data-section-target="${escapeHtml(section.id)}">${escapeHtml(section.title)}</button>
              <button class="rail-order-btn" type="button" data-section-target="${escapeHtml(section.id)}" data-section-move="up" aria-label="위로">↑</button>
              <button class="rail-order-btn" type="button" data-section-target="${escapeHtml(section.id)}" data-section-move="down" aria-label="아래로">↓</button>
            </div>
          `).join("") || `<div class="empty-state">목차가 없습니다.</div>`}
        </div>
      </div>
      <div class="rail-divider"></div>
      <div class="rail-label">State</div>
      <button class="rail-btn rail-state" type="button">${escapeHtml(currentSourceLabel())}</button>
      <button class="rail-btn rail-state" type="button">${escapeHtml(panelData.schemaVersion || panelData.basisDisplay?.page || current)}</button>
    `;
  }

  function openModal(title, subtitle, bodyHtml) {
    el.modalHost.innerHTML = `
      <div class="backdrop">
        <article class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="dialog-head">
            <div>
              <h3 id="modal-title">${escapeHtml(title)}</h3>
              ${subtitle ? `<p class="section-subtitle">${escapeHtml(subtitle)}</p>` : ""}
            </div>
            <button class="close-button button" type="button" data-close-modal aria-label="닫기">×</button>
          </div>
          <div class="dialog-body">${bodyHtml}</div>
        </article>
      </div>
    `;
    el.modalHost.classList.add("is-open");
    el.modalHost.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    el.modalHost.classList.remove("is-open");
    el.modalHost.setAttribute("aria-hidden", "true");
    el.modalHost.innerHTML = "";
  }

  function openDrawer(title, subtitle, bodyHtml) {
    el.drawerHost.innerHTML = `
      <div class="backdrop">
        <article class="drawer-card" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
          <div class="drawer-head">
            <div>
              <h3 id="drawer-title">${escapeHtml(title)}</h3>
              ${subtitle ? `<p class="section-subtitle">${escapeHtml(subtitle)}</p>` : ""}
            </div>
            <button class="close-button button" type="button" data-close-drawer aria-label="닫기">×</button>
          </div>
          <div class="drawer-body">${bodyHtml}</div>
        </article>
      </div>
    `;
    el.drawerHost.classList.add("is-open");
    el.drawerHost.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    el.drawerHost.classList.remove("is-open");
    el.drawerHost.setAttribute("aria-hidden", "true");
    el.drawerHost.innerHTML = "";
  }

  function buildDetailRows(detailRows = []) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Label</th><th>Value</th></tr></thead>
          <tbody>
            ${detailRows.map((row) => `<tr><td>${escapeHtml(row.label || "-")}</td><td>${escapeHtml(row.value || "-")}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function bindGlobalEvents() {
    if (el.sidebarToggle) {
      el.sidebarToggle.addEventListener("click", () => {
        el.app.classList.toggle("sidebar-collapsed");
      });
    }

    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-tab]");
      if (!button) return;
      await switchTab(button.dataset.tab);
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-project]");
      if (!button) return;
      state.activeProject = button.dataset.project || "total";
      renderRail();
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-section-target]");
      if (!button) return;
      if (button.dataset.sectionMove) {
        moveSection(state.activeTab, button.dataset.sectionTarget, button.dataset.sectionMove);
        return;
      }
      const target = document.getElementById(button.dataset.sectionTarget);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelectorAll(".rail-index-btn.active").forEach((node) => node.classList.remove("active"));
      button.closest(".rail-index-item")?.querySelector(".rail-index-btn")?.classList.add("active");
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-section-toggle]");
      if (!button) return;
      const key = sectionStateKey(state.activeTab, button.dataset.sectionToggle);
      state.collapsedSections[key] = !state.collapsedSections[key];
      renderPanels();
      renderRail();
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-modal]")) closeModal();
      if (event.target.closest("[data-close-drawer]")) closeDrawer();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal();
        closeDrawer();
      }
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-theme-toggle]")) return;
      const nextTheme = document.body.dataset.theme === "light" ? "dark" : "light";
      document.body.dataset.theme = nextTheme;
      sessionStorage.setItem("logi-iota-theme", nextTheme);
    });

    document.addEventListener("submit", (event) => {
      const form = event.target.closest("#admin-auth-form");
      if (!form) return;
      event.preventDefault();
      const password = String(new FormData(form).get("password") || "");
      if (!password) return;
      state.adminVerified = false;
      state.adminMessage = "현재 정적 앱에는 백엔드 관리자 인증 검증이 연결되어 있지 않아 인증을 완료할 수 없습니다.";
      form.reset();
      render();
    });

    document.addEventListener("click", async (event) => {
      const drawerTarget = event.target.closest("[data-drawer-target]");
      const modalTarget = event.target.closest("[data-modal-target]");
      if (drawerTarget) {
        const target = drawerTarget.dataset.drawerTarget;
        if (target === "new-project" || target === "management-project") {
          const list = target === "new-project" ? state.tabs.weekly?.newProjects || [] : state.tabs.weekly?.managementProjects || [];
          const item = list.find((row) => String(row.id) === String(drawerTarget.dataset.projectId));
          if (!item) return;
          openDrawer(item.projectName || item.title || "세부 정보", item.overview || item.status || "", `
            ${renderFacts([
              { label: "Issue", value: item.issue || "-" },
              { label: "Plan", value: item.plan || "-" },
              { label: "Status", value: item.status || "-" },
              { label: "Funding", value: item.funding || "-" },
              { label: "Investment", value: item.investment || "-" },
            ])}
            <div style="height:12px"></div>
            ${buildDetailRows(item.detailRows || [])}
          `);
          return;
        }
        if (target === "weekly-asset") {
          const row = (state.tabs.weekly?.assetRows || []).find((item) => String(item.id) === String(drawerTarget.dataset.rowId));
          if (!row) return;
          openDrawer(row.assetName || "Asset", row.mainIssue || "", `
            ${renderFacts([
              { label: "Category", value: row.category || "-" },
              { label: "Gross Area", value: row.grossAreaPy ? `${formatNumber(row.grossAreaPy)}평` : "-" },
              { label: "Occupancy", value: row.occupancyRate || "-" },
              { label: "Main Tenant", value: row.mainTenant || "-" },
              { label: "Cost Trend", value: row.costTrend || "-" },
            ])}
          `);
          return;
        }
      }
      if (modalTarget) {
        const note = (state.tabs.weekly?.notes || []).find((item) => String(item.id) === String(modalTarget.dataset.noteId));
        if (!note) return;
        openModal(note.title || "기준 및 기타사항", "주간업무 notes", `<p class="section-subtitle">${escapeHtml(note.body || "")}</p>`);
      }
    });

    document.addEventListener("keydown", (event) => {
      const interactive = event.target.closest("[data-drawer-target], [data-modal-target]");
      if (!interactive) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      interactive.click();
    });

    document.addEventListener("change", async (event) => {
      const assetSelect = event.target.closest("#asset-select");
      const companySelect = event.target.closest("#company-select");
      if (assetSelect) {
        state.assetSelection = state.assetOptions.find((item) => item.assetId === assetSelect.value) || state.assetOptions[0] || null;
        state.assetDetail = state.assetSelection ? await loadEntityDetail("asset", state.assetSelection.assetId) : null;
        render();
      }
      if (companySelect) {
        state.companySelection = state.companyOptions.find((item) => item.tenantId === companySelect.value) || state.companyOptions[0] || null;
        state.companyDetail = state.companySelection ? await loadEntityDetail("company", state.companySelection.tenantId) : null;
        render();
      }
    });
  }

  async function switchTab(tab) {
    if (!TAB_ORDER.includes(tab)) tab = "weekly";
    state.activeTab = tab;
    history.replaceState(null, "", `#${tab}`);
    render();
  }

  function getQaPayloadForTab(tab) {
    if (tab === "asset") return state.assetDetail || state.tabs.asset || null;
    if (tab === "company") return state.companyDetail || state.tabs.company || null;
    return state.tabs[tab] || null;
  }

  function exposeDashboardQaApi() {
    window.dashboardApp = {
      getState() {
        const lastSuccessfulPayloads = {};
        const pageCache = {};
        BASE_TAB_ORDER.forEach((tab) => {
          const payload = getQaPayloadForTab(tab);
          if (payload) {
            lastSuccessfulPayloads[tab] = payload;
            pageCache[tab] = payload;
            pageCache[`page:${tab}:default`] = payload;
          }
        });
        return {
          activeTab: state.activeTab,
          activePayload: getQaPayloadForTab(state.activeTab),
          bootstrap: state.bootstrap || {},
          payloadSources: Object.assign({}, state.payloadSources),
          lastSuccessfulPayloads,
          pageCache,
          loadingCount: 0,
        };
      },
      switchTab,
    };
  }

  function render() {
    setSidebarMeta();
    renderSidebar();
    setHead(state.activeTab);
    renderPanels();
    renderRail();
  }

  async function init() {
    document.body.dataset.theme = sessionStorage.getItem("logi-iota-theme") || params.get("theme") || "dark";
    const requested = location.hash.replace("#", "");
    state.activeTab = TAB_ORDER.includes(requested) ? requested : (IS_ADMIN_APP ? "admin" : "weekly");
    bindGlobalEvents();
    exposeDashboardQaApi();
    render();
    await loadBootstrap();
    await loadInitial();
    await loadOptions();
    render();
    window.addEventListener("hashchange", () => switchTab(location.hash.replace("#", "") || (IS_ADMIN_APP ? "admin" : "weekly")));
  }

  init().catch((error) => {
    console.error(error);
    document.body.innerHTML = `<pre style="white-space:pre-wrap;padding:24px;color:#f5f5f5;background:#1f1f1e">초기화 실패: ${escapeHtml(error.message || String(error))}</pre>`;
  });
})();
