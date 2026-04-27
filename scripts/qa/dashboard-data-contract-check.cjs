const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUTPUT_DIR = path.join(ROOT, "qa-artifacts", "data-contract", RUN_STAMP);

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function has(source, pattern) {
  return pattern instanceof RegExp ? pattern.test(source) : source.includes(pattern);
}

function row(id, title, ok, evidence, action) {
  return { id, title, status: ok ? "PASS" : "REVIEW", evidence, action: action || "" };
}

function renderTable(rows) {
  return [
    "| ID | 상태 | 항목 | 근거 | 조치/메모 |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((item) => `| ${item.id} | ${item.status} | ${item.title} | ${item.evidence} | ${item.action || "-"} |`),
  ].join("\n");
}

function main() {
  ensureDir(OUTPUT_DIR);

  const client = read("Client.html");
  const metrics = read("Metrics.gs");
  const runtime = read("RuntimeServices.gs");
  const server = read("Server.gs");
  const index = read("Index.html");
  const idd = read("260205_IDD_v1.0.html");

  const sheetPayloadRows = [
    row(
      "DATA-01",
      "Home KPI가 Google Sheet 기반 model에서 생성됨",
      has(metrics, "function buildHomePayload_") && has(metrics, "attachPayloadMeta_(payload, 'home'") && has(client, "renderHome(home)"),
      "buildHomePayload_ -> getHomeData -> renderHome 흐름 확인",
      "실제 숫자 대조는 Apps Script 런타임에서 getHomeData() 결과와 시트 합계를 함께 export해야 합니다."
    ),
    row(
      "DATA-02",
      "Asset KPI/표가 DB_일반, DB_자산, DB_계산 기준 payload를 사용함",
      has(metrics, "function buildAssetPayload_") && has(metrics, "eNocAudit") && has(client, "asset-roster-table"),
      "Asset payload에 areaBreakdown, eNocAudit, contractExpiry 포함",
      ""
    ),
    row(
      "DATA-03",
      "Company payload가 DB_기업/OpenDART 상태를 함께 전달함",
      has(metrics, "function buildCompanyPayload_") && has(metrics, "dartLinked") && has(metrics, "basisSource: 'DB_GENERAL + DB_COMPANY + OpenDART'"),
      "Company payload에 financials.dartLinked와 basisSource 확인",
      ""
    ),
    row(
      "DATA-04",
      "Sector 만기/랭킹/추이 payload와 화면 사용 필드가 맞음",
      has(metrics, "expiryRows: contractSummary.upcoming") && has(metrics, "rankings") && has(client, "sector-expiry"),
      "Sector render가 expiryRows, rankings.assetsByRent, rankings.tenantsByRent, trends.monthlyRent 사용",
      ""
    ),
    row(
      "DATA-05",
      "Tools 기본 선택값과 화면 체크 상태가 payload selection을 따름",
      has(client, "activeToolAssetIds") && has(client, "activeToolCompanyIds") && has(client, '["meta", "selection", "assetIds"]') && has(metrics, "cacheKey: buildKeyedPayloadKey_('tools', normalized)"),
      "Tools render에서 meta.selection.assetIds/companyIds를 우선 사용",
      ""
    ),
    row(
      "DATA-06",
      "시트 직접 대조 자동화가 아직 없음",
      false,
      "로컬 Node 환경에는 SpreadsheetApp이 없어 Google Sheet 값 직접 조회 불가",
      "Apps Script 함수로 payload와 시트 집계 차이를 JSON으로 반환하는 admin 전용 진단 엔드포인트를 추가하는 것이 다음 수정 지점입니다."
    ),
  ];

  const componentRows = [
    row("IDD-01", "Home 지도", has(idd, "initHomeMap") && has(client, "home-map"), "IDD initHomeMap / 현재 home-map", ""),
    row("IDD-02", "Home KPI 5종", has(idd, "운영 자산 수") && has(client, "운영 자산 수") && has(client, "총 임대면적"), "운영 자산/임차인/면적/공실 KPI 확인", ""),
    row("IDD-03", "월간 임대료 추이", has(idd, "homeRentChart") && has(client, "home-rent-chart"), "IDD homeRentChart / 현재 home-rent-chart", ""),
    row("IDD-04", "구성비 차트 3종", has(idd, "pieArea") && has(client, "home-area-chart") && has(client, "home-cold-chart") && has(client, "home-sector-chart"), "현재는 면적/저온/섹터 구성 차트로 재구성", "IDD의 임대료/임차인 수 구성비와 정확히 1:1은 아닙니다."),
    row("IDD-05", "계약/임차인 상세 리스트", has(idd, "openFullListModal") && has(client, "home-contract-table") && has(client, "home-tenant-table"), "현재 Home 표와 모달 액션으로 대체", ""),
    row("IDD-06", "Asset 지도", has(idd, "initAssetMap") && has(client, "asset-map"), "현재 asset map preview 사용", ""),
    row("IDD-07", "Asset 재무 및 구성 분석 콤보 차트", has(idd, "comboChart") && has(client, "asset-rent-chart") && has(client, "asset-expiry-chart"), "현재는 임차인별 임관리비/만기 차트로 분해", "IDD의 업종별 누적 콤보 차트는 직접 대응 컴포넌트가 없습니다."),
    row("IDD-08", "Company 재무 추이", has(idd, "compFinChart") && has(client, "company-financials"), "현재 DART 상세 표와 KPI 중심", "5개년 재무 차트는 현재 표 중심이라 시각화 누락 후보입니다."),
    row("IDD-09", "Company 인력 입퇴사 차트", has(idd, "compHRChart") && has(client, "employeeCount"), "현재 employeeCount 단일 지표만 확인", "3/6/12개월 입퇴사율 차트는 현재 누락 후보입니다."),
    row("IDD-10", "Sector 지도", has(idd, "initSectorMap") && has(client, "sector-region-chart"), "현재 Sector는 지도 대신 지역별 노출도 차트", "지도형 컴포넌트는 MVP에서 축약된 것으로 보입니다."),
    row("IDD-11", "Sector 임대료 수취 추이", has(idd, "sectorTrendChart") && has(client, "sector-rent-chart"), "현재 sector-rent-chart 대응", ""),
    row("IDD-12", "Analysis Tools 비교 차트", has(idd, "toolCompChart") && has(client, "tools-benchmark-chart"), "현재 benchmark chart 대응", ""),
    row("IDD-13", "Analysis Tools 자산 비교 차트", has(idd, "toolAssetChart") && has(client, "tools-matrix-table"), "현재 matrix table 중심", "두 번째 차트는 현재 표로 대체되어 시각화 누락 후보입니다."),
  ];

  const apiRows = [
    row("API-01", "OpenDART blocker 판정 로직", has(runtime, "function buildOpenDartBlocker_") && has(runtime, "missing_api_key") && has(runtime, "authorization_required") && has(runtime, "match_backlog"), "missing key/auth/backlog/clear 상태 확인", ""),
    row("API-02", "건축물대장 blocker 판정 로직", has(runtime, "function buildBuildingHubBlocker_") && has(runtime, "query_mapping_required") && has(runtime, "not_found_backlog"), "missing key/auth/query/not_found/clear 상태 확인", ""),
    row("API-03", "지도 API blocker 판정 로직", has(runtime, "function buildNaverMapsIntegrationStatus_") && has(runtime, "missing_client_id") && has(runtime, "missing_client_secret"), "NAVER client id/secret 상태 확인", ""),
    row("API-04", "관리자 payload에 integration 상태 포함", has(server, "integrations: getIntegrationStatusFromModel_(model)") || has(server, "integrations:"), "getAdminDashboardData.integrations 확인", ""),
    row("API-05", "관리자 화면에서 blocker 상세 표시", has(client, "integration-diagnostics") && has(client, "renderIntegrationDiagnosticCard_"), "Admin diagnostic panel 확인", "없으면 관리자 화면에서 blocker 원인이 보이지 않습니다."),
  ];

  const allRows = [...sheetPayloadRows, ...componentRows, ...apiRows];
  const summary = {
    generatedAt: new Date().toISOString(),
    counts: {
      pass: allRows.filter((item) => item.status === "PASS").length,
      review: allRows.filter((item) => item.status === "REVIEW").length,
      total: allRows.length,
    },
    sheetPayloadRows,
    componentRows,
    apiRows,
  };

  const markdown = [
    "# Dashboard Data/QA Checklist",
    "",
    `생성 시각: ${summary.generatedAt}`,
    "",
    `요약: PASS ${summary.counts.pass} / REVIEW ${summary.counts.review} / TOTAL ${summary.counts.total}`,
    "",
    "## Google Sheet 기준 숫자와 화면 payload 정합성",
    renderTable(sheetPayloadRows),
    "",
    "## 260205_IDD_v1.0.html 대비 컴포넌트",
    renderTable(componentRows),
    "",
    "## OpenDART / 건축물대장 / 지도 API blocker",
    renderTable(apiRows),
    "",
    "## 남은 blocker",
    "",
    "- 실제 Google Sheet 숫자와 payload 숫자의 값 대조는 로컬 Node가 아닌 Apps Script 런타임에서 수행해야 합니다.",
    "- IDD의 Company 5개년 재무 차트, Company HR 입퇴사율 차트, Tools 두 번째 자산 비교 차트, Sector 지도는 현재 구현에서 표/요약/차트로 축약되었거나 직접 대응이 약합니다.",
    "- OpenDART/건축물대장/지도 API의 실제 상태는 관리자 payload의 `integrations`와 Script Properties, 마지막 실행 상태를 함께 확인해야 합니다.",
  ].join("\n");

  const mdPath = path.join(OUTPUT_DIR, "checklist.md");
  const jsonPath = path.join(OUTPUT_DIR, "checklist.json");
  fs.writeFileSync(mdPath, markdown, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify({ outputDir: OUTPUT_DIR, markdown: mdPath, json: jsonPath, summary: summary.counts }, null, 2));
}

main();
