function installV1() {
  const spreadsheet = getSpreadsheet_();
  ensureSystemSheets_(spreadsheet);
  ensureMainHelperColumns_(spreadsheet);
  ensureHistoryHelperColumns_(spreadsheet);
  ensureCompanyHelperColumns_(spreadsheet);
  ensureAssetHelperColumns_(spreadsheet);
  ensureCalculationHeaders_(spreadsheet);
  syncMetaDictionary_();
  seedNormalizationSheets_(spreadsheet);
  refreshCalculationSheet();
}

function ensureSystemSheets_(spreadsheet) {
  const config = getConfig_();
  const systemSheets = [
    { name: config.sheetNames.sysConfig, headers: ['key', 'value', 'description'] },
    { name: config.sheetNames.sysCode, headers: ['domain', 'code', 'label', 'description'] },
    { name: config.sheetNames.sysTenantNormalize, headers: ['lookup_key', 'raw_name', 'tenant_master_name', 'business_registration_no', 'match_status', 'review_status', 'note', 'updated_at'] },
    { name: config.sheetNames.sysAssetLookup, headers: ['asset_id', 'asset_code', 'asset_name', 'lookup_address', 'query_key', 'latitude', 'longitude', 'geocode_status', 'building_hub_status', 'note', 'updated_at'] },
    { name: config.sheetNames.logValidation, headers: ['logged_at', 'sheet_name', 'record_id', 'rule_name', 'status', 'message', 'source_row'] },
    { name: config.sheetNames.logApi, headers: ['logged_at', 'provider', 'endpoint', 'target_id', 'status', 'message', 'raw_ref'] },
    { name: config.sheetNames.logCalculation, headers: ['logged_at', 'snapshot_month', 'record_id', 'formula_version', 'status', 'message'] },
  ];

  systemSheets.forEach(function (definition) {
    let sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(definition.name);
    }
    ensureHeaders_(sheet, definition.headers);
    sheet.hideSheet();
  });

  const configSheet = spreadsheet.getSheetByName(config.sheetNames.sysConfig);
  if (configSheet.getLastRow() < 2) {
    configSheet.getRange(2, 1, 5, 3).setValues([
      ['spreadsheet_version', 'v1', '현재 운영 스키마 버전'],
      ['formula_version', config.formulaVersion, 'E.NOC 등 계산 버전'],
      ['opendart_script_property', 'OPENDART_API_KEY', 'OpenDART API 키는 Script Properties에 저장'],
      ['building_hub_script_property', 'BUILDING_HUB_API_KEY', 'Building HUB API 키는 Script Properties에 저장'],
      ['enable_server_geocoding', 'false', '서버 지오코딩 사용 여부'],
    ]);
  }

  const codeSheet = spreadsheet.getSheetByName(config.sheetNames.sysCode);
  if (codeSheet.getLastRow() < 2) {
    codeSheet.getRange(2, 1, 11, 4).setValues([
      ['review_status', 'ok', '정상', '대시보드 노출에 문제 없는 상태'],
      ['review_status', 'missing', '누락', '핵심 입력값이 비어 있음'],
      ['review_status', 'suspected_error', '오류 의심', '날짜/면적/기간 등 기계적으로 이상 징후'],
      ['review_status', 'review_required', '검토 필요', '사람 확인이 필요한 값'],
      ['calculation_status', 'ok', '정상', '계산 완료'],
      ['calculation_status', 'missing', '입력 누락', 'E.NOC 계산 입력값 누락 또는 계산 불가'],
      ['calculation_status', 'suspected_error', '오류 의심', '계산 입력값이 비정상적임'],
      ['calculation_status', 'review_required', '검토 필요', '계산은 가능하지만 값 검토 필요'],
      ['match_status', 'matched', '연결됨', '외부 시스템 매칭 완료'],
      ['match_status', 'unmatched', '미연결', '외부 시스템 매칭 전'],
      ['geocode_status', 'pending', '대기', '지오코딩 대기'],
    ]);
  }
}

function ensureMainHelperColumns_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.general);
  appendMissingHeaders_(sheet, MAIN_HELPER_HEADERS);
  const headerIndex = headerMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]);

  sheet.getRange(2, headerIndex.fund_id).setFormula('=ARRAYFORMULA(IF(A2:A="","", "fund_" & LOWER(REGEXREPLACE(TO_TEXT(A2:A),"[^0-9A-Za-z]",""))))');
  sheet.getRange(2, headerIndex.asset_id).setFormula('=ARRAYFORMULA(IF(C2:C="","", IF(D2:D<>"","asset_" & LOWER(REGEXREPLACE(D2:D,"[^0-9A-Za-z]","")), "asset_" & LOWER(REGEXREPLACE(C2:C,"[^0-9A-Za-z가-힣]","")))))');
  sheet.getRange(2, headerIndex.tenant_id).setFormula('=ARRAYFORMULA(IF(F2:F="","", IF(G2:G<>"","tenant_brn_" & REGEXREPLACE(G2:G,"[^0-9]",""), "tenant_name_" & LOWER(REGEXREPLACE(F2:F,"[^0-9A-Za-z가-힣]","")))))');
  sheet.getRange(2, headerIndex.lease_id).setFormula('=ARRAYFORMULA(IF(BU2:BU="","", BU2:BU & "|" & BV2:BV & "|" & IF(AJ2:AJ<>"",TEXT(AJ2:AJ,"yyyymmdd"),"nostart") & "|" & IF(AK2:AK<>"",TEXT(AK2:AK,"yyyymmdd"),"noend")))');
  sheet.getRange(2, headerIndex.lease_space_id).setFormula('=ARRAYFORMULA(IF(BW2:BW="","", BW2:BW & "|" & LOWER(REGEXREPLACE(TO_TEXT(L2:L),"[^0-9A-Za-z가-힣~B-]","")) & "|" & IF(M2:M<>"",LOWER(REGEXREPLACE(TO_TEXT(M2:M),"[^0-9A-Za-z가-힣~]","")),"na")))');
  sheet.getRange(2, headerIndex.tenant_master_name).setFormula('=ARRAYFORMULA(IF(F2:F="","", IFERROR(VLOOKUP(IF(G2:G<>"",REGEXREPLACE(G2:G,"[^0-9]",""),TRIM(F2:F)), {\'SYS_기업명정규화\'!A2:A,\'SYS_기업명정규화\'!C2:C}, 2, FALSE), TRIM(F2:F))))');
  sheet.getRange(2, headerIndex.source_row_hash).setFormula('=ARRAYFORMULA(IF(C2:C="","", IF(D2:D<>"",D2:D,C2:C) & "|" & IF(G2:G<>"",REGEXREPLACE(G2:G,"[^0-9]",""),TRIM(F2:F)) & "|" & TRIM(L2:L) & "|" & TRIM(M2:M) & "|" & IF(AJ2:AJ<>"",TEXT(AJ2:AJ,"yyyymmdd"),"") & "|" & IF(AK2:AK<>"",TEXT(AK2:AK,"yyyymmdd"),"") & "|" & IF(P2:P<>"",ROUND(P2:P,2),"") & "|" & IF(Q2:Q<>"",ROUND(Q2:Q,2),"")))');
  sheet.getRange(2, headerIndex.review_status).setFormula('=ARRAYFORMULA(IF(C2:C="","", IF((LEN(D2:D)=0)+(LEN(F2:F)=0)+(LEN(AJ2:AJ)=0)+(LEN(AK2:AK)=0)+(LEN(P2:P)=0)+(LEN(Q2:Q)=0)>0,"missing", IF((AK2:AK<AJ2:AJ)+(N(P2:P)<=0)+(N(Q2:Q)<0)+(N(R2:R)>1.05)+(N(R2:R)<0)>0,"suspected_error", IF(LEN(G2:G)=0,"review_required","ok")))))');
  sheet.getRange(2, headerIndex.review_note).setFormula('=ARRAYFORMULA(IF(CA2:CA="","", IF(CA2:CA="ok","", IF(CA2:CA="missing","핵심 입력값 누락", IF(CA2:CA="suspected_error","날짜 또는 면적 값 검토 필요","사업자번호 또는 면적 정의 검토 필요")))))');
}

function ensureHistoryHelperColumns_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.history);
  appendMissingHeaders_(sheet, HISTORY_HELPER_HEADERS);
  const headerIndex = headerMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]);

  sheet.getRange(2, headerIndex.lease_space_id).setFormula('=ARRAYFORMULA(IF(A2:A="","", IFERROR(VLOOKUP(D2:D & "|" & IF(G2:G<>"",REGEXREPLACE(G2:G,"[^0-9]",""),TRIM(F2:F)) & "|" & TRIM(I2:I) & "|" & ROUND(K2:K,0), {DB_일반!D2:D & "|" & IF(DB_일반!G2:G<>"",REGEXREPLACE(DB_일반!G2:G,"[^0-9]",""),TRIM(DB_일반!F2:F)) & "|" & TRIM(DB_일반!L2:L) & "|" & ROUND(DB_일반!P2:P,0), DB_일반!BX2:BX}, 2, FALSE), "UNMATCHED|" & D2:D & "|" & IF(G2:G<>"",REGEXREPLACE(G2:G,"[^0-9]",""),TRIM(F2:F)) & "|" & TRIM(I2:I))))');
  sheet.getRange(2, headerIndex.history_event_id).setFormula('=ARRAYFORMULA(IF(S2:S="","", S2:S & "|" & IF(M2:M<>"",TEXT(M2:M,"yyyymmdd"),"nodate") & "|" & ROW(A2:A)))');
  sheet.getRange(2, headerIndex.is_latest).setFormula("=ARRAYFORMULA(IF(S2:S=\"\",\"\", IF(LEFT(S2:S,10)=\"UNMATCHED|\", FALSE, IFNA(M2:M = VLOOKUP(S2:S, QUERY({S2:S, M2:M}, \"select Col1, max(Col2) where Col1 is not null and not Col1 contains 'UNMATCHED|' group by Col1 label max(Col2) ''\", 0), 2, FALSE), FALSE))))");
  sheet.getRange(2, headerIndex.review_status).setFormula('=ARRAYFORMULA(IF(A2:A="","", IF((D2:D="")+(F2:F="")+(M2:M="")+(K2:K="")>0,"missing", IF(LEFT(S2:S,10)="UNMATCHED|","review_required", IF((O2:O="")+(P2:P="")>0,"review_required","ok")))))');
  sheet.getRange(2, headerIndex.review_note).setFormula('=ARRAYFORMULA(IF(V2:V="","", IF(V2:V="ok","", IF(V2:V="missing","기준일자/임대면적/코드 누락", IF(LEFT(S2:S,10)="UNMATCHED|","DB_일반과 히스토리 연결 실패","최신 임대료 또는 관리비 누락")))))');
}

function ensureCompanyHelperColumns_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.company);
  appendMissingHeaders_(sheet, COMPANY_HELPER_HEADERS);
  const headerIndex = headerMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]);

  sheet.getRange(2, headerIndex.tenant_id).setFormula('=ARRAYFORMULA(IF(B2:B="","", IF(A2:A<>"","tenant_brn_" & REGEXREPLACE(A2:A,"[^0-9]",""), "tenant_name_" & LOWER(REGEXREPLACE(B2:B,"[^0-9A-Za-z가-힣]","")))))');
  sheet.getRange(2, headerIndex.review_status).setFormula('=ARRAYFORMULA(IF(B2:B="","", IF(C2:C="","review_required","ok")))');
  sheet.getRange(2, headerIndex.review_note).setFormula('=ARRAYFORMULA(IF(R2:R="","", IF(R2:R="ok","", "OpenDART corp code 미연결 또는 검토 필요")))');
}

function ensureAssetHelperColumns_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.asset);
  appendMissingHeaders_(sheet, ASSET_HELPER_HEADERS);
  const headerIndex = headerMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]);

  sheet.getRange(2, headerIndex.asset_id).setFormula('=ARRAYFORMULA(IF(B2:B="","", IF(A2:A<>"","asset_" & LOWER(REGEXREPLACE(A2:A,"[^0-9A-Za-z]","")), "asset_" & LOWER(REGEXREPLACE(B2:B,"[^0-9A-Za-z가-힣]","")))))');
  sheet.getRange(2, headerIndex.standardized_address).setFormula('=ARRAYFORMULA(IF(B2:B="","", TRIM(C2:C)))');
  sheet.getRange(2, headerIndex.review_status).setFormula('=ARRAYFORMULA(IF(B2:B="","", IF((A2:A="")+(C2:C="")>0,"missing", IF(J2:J="","review_required","ok"))))');
  sheet.getRange(2, headerIndex.review_note).setFormula('=ARRAYFORMULA(IF(R2:R="","", IF(R2:R="ok","", IF(R2:R="missing","자산코드 또는 주소 누락","사용승인일/속성 검토 필요"))))');
  sheet.getRange(2, headerIndex.geocode_status).setFormula('=ARRAYFORMULA(IF(B2:B="","", IF((T2:T<>"")*(U2:U<>""),"ok","review_required")))');
}

function ensureCalculationHeaders_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.calculation);
  ensureHeaders_(sheet, CALCULATION_HEADERS);
}

function refreshCalculationSheet() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.calculation);
  ensureHeaders_(sheet, CALCULATION_HEADERS);

  const model = loadOperationalModel_();
  const rows = model.generalRows.map(function (row) {
    const assetSummary = model.assetSummaryById[row.assetId];
    return [
      monthKeyFromIso_(model.generatedAt),
      row.assetId,
      row.assetName,
      row.tenantId,
      row.tenantMasterName,
      assetSummary ? assetSummary.vacancyAreaSqm : '',
      assetSummary ? assetSummary.vacancyRate : '',
      row.currentMonthlyRentTotal,
      row.currentMonthlyMfTotal,
      row.eNoc,
      model.config.formulaVersion,
      row.calculationStatus,
      model.generatedAt,
      row.calculatedReviewStatus,
      row.calculatedReviewNotes.join(', '),
      row.leaseSpaceId,
    ];
  });

  const lastRow = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 1, lastRow, CALCULATION_HEADERS.length).clearContent();
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, CALCULATION_HEADERS.length).setValues(rows);
  }
}

function syncMetaDictionary_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.meta);
  const headers = ['column_name', 'column_label_ko', 'business_meaning', 'data_type', 'unit', 'required_yn', 'source_type', 'allowed_values_or_rule', 'validation_rule_summary', 'dashboard_use_summary'];
  const rows = [
    ['fund_id', '펀드 ID', '펀드 식별용 안정 ID', 'STRING', '', 'Y', 'derived', 'fund_ + 펀드코드', '공란 불가', '필터/집계 키'],
    ['asset_id', '자산 ID', '자산 식별용 안정 ID', 'STRING', '', 'Y', 'derived', 'asset_ + 자산코드', '공란 불가', '자산 화면/집계/연결 키'],
    ['tenant_id', '임차인 ID', '임차인 식별용 안정 ID', 'STRING', '', 'Y', 'derived', '사업자번호 우선, 없으면 이름 기반', '공란 시 review_required', '기업 화면/집계/연결 키'],
    ['lease_id', '계약 ID', '현재 계약 단위 ID', 'STRING', '', 'Y', 'derived', 'asset_id + tenant_id + 현재 계약기간', '중복 시 검토', '계약 추적'],
    ['lease_space_id', '임차공간 ID', '임차 공간 단위 ID', 'STRING', '', 'Y', 'derived', 'lease_id + 층 + 세부구역', '중복 시 검토', '히스토리 연결/스태킹 플랜'],
    ['tenant_master_name', '표준 임차인명', '정규화된 기업명', 'STRING', '', 'Y', 'derived/manual', 'SYS_기업명정규화 우선', '매칭 실패 시 raw name 사용 + review', '기업 탭/랭킹'],
    ['source_row_hash', '소스 행 핑거프린트', '원본 행 비교용 문자열', 'STRING', '', 'Y', 'derived', '핵심 식별 필드 결합', '행 변경 추적용', '동기화/검증'],
    ['review_status', '검토 상태', '운영 검토 상태', 'ENUM', '', 'Y', 'derived/manual', 'ok/missing/suspected_error/review_required', '규칙 기반 자동 분류', '배지/필터/백로그'],
    ['review_note', '검토 메모', '검토 사유 요약', 'STRING', '', 'N', 'derived/manual', '대표 사유 1~N개', '상태가 ok가 아니면 메모 권장', '상세 패널'],
    ['source_doc_ref', '소스 문서 참조', '원천 문서 링크/ID', 'STRING', '', 'N', 'manual', '있으면 유지, 없으면 공란', '자동 생성 금지', '원문 추적'],
    ['펀드코드', '펀드코드', '원본 펀드 코드', 'STRING', '', 'Y', 'manual', '사내 운용 코드', '공란 불가', '기본 식별'],
    ['펀드명', '펀드명', '펀드 정식 명칭', 'STRING', '', 'Y', 'manual', '자유 텍스트', '공란 불가', '필터/표시'],
    ['자산명', '자산명', '자산 표기명', 'STRING', '', 'Y', 'manual', '자유 텍스트', '공란 불가', '필터/표시'],
    ['자산코드', '자산코드', '원본 자산 코드', 'STRING', '', 'Y', 'manual', '사내 자산 코드', '가능하면 공란 금지', '자산 마스터 연결'],
    ['섹터', '섹터', '자산 유형 분류', 'ENUM', '', 'Y', 'manual', '물류센터 등', '정의 미확정 시 기존 값 유지', '구성 차트'],
    ['임차인명', '임차인명', '원본 임차인명', 'STRING', '', 'Y', 'manual', '원문 유지', '애매해도 자동수정 금지', '행 표시/정규화 원본'],
    ['임차인 사업자번호', '사업자번호', '기업 식별 보조키', 'STRING', '', 'N', 'manual', '숫자/하이픈', '없으면 review_required', '기업 매칭/OpenDART'],
    ['임차 층', '임차 층', '임차 공간 층 정보', 'STRING', '층', 'Y', 'manual', '예: 1, B2~B1, 1~10', '공란 시 히스토리 연결 약화', '스태킹 플랜'],
    ['임차 세부 구역', '임차 세부 구역', '층 내 세부 구역', 'STRING', '', 'N', 'manual', '예: 1섹터', '없으면 보수적으로 매칭', '스태킹 플랜/드릴다운'],
    ['전체 연면적', '전체 연면적', '자산 전체 기준 면적', 'NUMBER', '㎡', 'N', 'manual/external', '양수', '임대면적 초과 여부 검토', '공실률 기초값'],
    ['임대면적', '임대면적', '현재 계약 기준 임대면적', 'NUMBER', '㎡', 'Y', 'manual', '양수', '0 이하 금지', '임대율/랭킹/스태킹'],
    ['전용면적', '전용면적', '현재 계약 기준 전용면적', 'NUMBER', '㎡', 'Y', 'manual', '0 이상', '세부 전용면적 합계와 비교', '전용률/E.NOC'],
    ['전용률', '전용률', '전용면적/임대면적', 'NUMBER', '%', 'N', 'manual/derived', '0~1 권장', '임대/전용면적과 불일치 시 검토', 'E.NOC'],
    ['세부면적(창고)', '창고면적', '전용 창고면적', 'NUMBER', '㎡', 'N', 'manual', '0 이상', '전용면적 합계 검토', '상세 분석'],
    ['세부면적(하역장)', '하역장면적', '전용 하역장면적', 'NUMBER', '㎡', 'N', 'manual', '0 이상', '전용면적 합계 검토', '상세 분석'],
    ['세부면적(사무실)', '사무실면적', '전용 사무실면적', 'NUMBER', '㎡', 'N', 'manual', '0 이상', '히스토리와 차이 가능', '상세 분석'],
    ['세부면적(기타 전용면적)', '기타 전용면적', '기타 전용면적', 'NUMBER', '㎡', 'N', 'manual', '0 이상', '세부 설명 권장', '상세 분석'],
    ['세부면적(통로)', '통로면적', '공용 통로면적', 'NUMBER', '㎡', 'N', 'manual', '0 이상', '공용면적 참고', '검토용'],
    ['세부면적(램프)', '램프면적', '공용 램프면적', 'NUMBER', '㎡', 'N', 'manual', '0 이상', '공용면적 참고', '검토용'],
    ['세부면적(기타 공용면적)', '기타 공용면적', '기타 공용면적', 'NUMBER', '㎡', 'N', 'manual', '0 이상', '공용면적 누락 여부 검토', '검토용'],
    ['현재 계약개시일', '현재 계약개시일', '현재 유효 계약 시작일', 'DATE', '', 'Y', 'manual', 'YYYY-MM-DD', '최근 계약일보다 빠르면 의심', '만기/비교'],
    ['현재 계약만기일', '현재 계약만기일', '현재 유효 계약 종료일', 'DATE', '', 'Y', 'manual', 'YYYY-MM-DD', '계약개시일보다 빠르면 오류 의심', '만기/비교'],
    ['현재 계약기간', '현재 계약기간', '현재 계약 기간(년)', 'NUMBER', '년', 'N', 'manual/derived', '양수', 'RF/FO 대비 검토', 'E.NOC'],
    ['RF', 'RF', '렌트프리 개월 수', 'NUMBER', '개월', 'N', 'manual', '0 이상', 'FO와 합이 계약개월 수 이하', 'E.NOC'],
    ['FO', 'FO', 'Fit-out 개월 수', 'NUMBER', '개월', 'N', 'manual', '0 이상', 'RF와 합이 계약개월 수 이하', 'E.NOC'],
    ['TI', 'TI', 'Tenant Improvement 총액', 'NUMBER', '원', 'N', 'manual', '0 이상', '전용면적/기간 없으면 계산 불가', 'E.NOC'],
    ['계약 상태', '계약 상태', '현 시점 유효 여부', 'ENUM', '', 'Y', 'manual', 'Y/N', '공란 시 기존 값 유지', '활성 계약 필터'],
    ['임대료 연체·미납여부', '연체 여부', '연체/미납 상태', 'ENUM', '', 'N', 'manual', 'Y/N', 'Y면 caution 노출', '자산/기업 주의 섹션'],
    ['저온창고 여부', '저온창고 여부', '저온/상온/사무실 구분', 'ENUM', '', 'N', 'manual', 'Y/N/혼합/사무실', '기존 값 유지', '구성 차트'],
    ['3PL 여부', '3PL 여부', '3PL 사용 여부', 'ENUM', '', 'N', 'manual', 'Y/N', '기존 값 유지', '구성 차트'],
    ['취급 상품 유형', '취급 상품 유형', '취급 품목 분류', 'STRING', '', 'N', 'manual', '자유 텍스트', '복수 가능', '구성 차트/기업 분석'],
    ['E. NOC', 'E. NOC', 'v1 계산값(원/평)', 'NUMBER', '원/평', 'N', 'derived', '현재 계약 기준 공식', '필수 입력 누락 시 공란 + review', 'KPI/비교'],
  ];

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
}

function seedNormalizationSheets_(spreadsheet) {
  const config = getConfig_();
  const tenantSheet = spreadsheet.getSheetByName(config.sheetNames.sysTenantNormalize);
  const assetSheet = spreadsheet.getSheetByName(config.sheetNames.sysAssetLookup);

  if (tenantSheet.getLastRow() < 2) {
    const companies = loadObjectsFromSheet_(spreadsheet, config.sheetNames.company);
    const rows = companies
      .map(function (row) {
        const rawName = normalizeWhitespace_(pickField_(row, ['표준기업명']));
        const businessRegistrationNo = normalizeWhitespace_(pickField_(row, ['사업자등록번호']));
        if (!rawName) return null;
        return [
          businessRegistrationNo ? businessRegistrationNo.replace(/[^0-9]/g, '') : rawName,
          rawName,
          rawName,
          businessRegistrationNo,
          pickField_(row, ['DART 매칭 상태']) || 'unmatched',
          businessRegistrationNo ? 'ok' : 'review_required',
          '',
          Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        ];
      })
      .filter(Boolean);
    if (rows.length) tenantSheet.getRange(2, 1, rows.length, 8).setValues(rows);
  }

  if (assetSheet.getLastRow() < 2) {
    const assets = loadObjectsFromSheet_(spreadsheet, config.sheetNames.asset);
    const rows = assets
      .map(function (row) {
        const assetCode = normalizeWhitespace_(pickField_(row, ['자산코드']));
        const assetName = normalizeWhitespace_(pickField_(row, ['자산명']));
        const address = normalizeWhitespace_(pickField_(row, ['도로명주소']));
        if (!assetName) return null;
        return [
          assetCode ? `asset_${sanitizeIdPart_(assetCode)}` : makeDeterministicId_('asset', [assetName]),
          assetCode,
          assetName,
          address,
          address,
          '',
          '',
          'pending',
          'pending',
          '',
          Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        ];
      })
      .filter(Boolean);
    if (rows.length) assetSheet.getRange(2, 1, rows.length, 11).setValues(rows);
  }
}

function ensureHeaders_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
}

function appendMissingHeaders_(sheet, headers) {
  const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const missingHeaders = headers.filter(function (header) {
    return existingHeaders.indexOf(header) === -1;
  });
  if (!missingHeaders.length) return;
  const startColumn = existingHeaders.length + 1;
  sheet.insertColumnsAfter(existingHeaders.length, missingHeaders.length);
  sheet.getRange(1, startColumn, 1, missingHeaders.length).setValues([missingHeaders]);
}

function headerMap_(headers) {
  return headers.reduce(function (accumulator, header, index) {
    accumulator[header] = index + 1;
    return accumulator;
  }, {});
}
