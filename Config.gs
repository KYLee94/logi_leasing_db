const APP_NAME = 'IGIS Logistics Leasing Dashboard';

const DEFAULT_SECRETS = Object.freeze({
  openDartApiKey: '',
  buildingRegisterApiKeyEncoded: '',
  buildingRegisterApiKeyDecoded: '',
  naverMapsClientId: 'xmxdr3l9ij',
  naverMapsClientSecret: '',
});

const DASHBOARD_CACHE_TTL_SECONDS = 600;
const DASHBOARD_MODEL_CACHE_TTL_SECONDS = 900;
const DASHBOARD_PAYLOAD_CACHE_TTL_SECONDS = 1800;
const DEBUG_MODE = false;

const DEFAULT_CONFIG = Object.freeze({
  spreadsheetId: '1powCa2TV7Pkqi3Un3mz3clJPwJ9xw7lMr1bZ0eLMqVA',
  formulaVersion: 'E.NOC_v2',
  areaSqmPerPy: 3.305785,
  cacheTtlSeconds: DASHBOARD_CACHE_TTL_SECONDS,
  modelCacheTtlSeconds: DASHBOARD_MODEL_CACHE_TTL_SECONDS,
  payloadCacheTtlSeconds: DASHBOARD_PAYLOAD_CACHE_TTL_SECONDS,
  dailySnapshotRefreshHour: 9,
  staticSnapshotMaxAssets: 200,
  staticSnapshotMaxCompanies: 300,
  bootstrapOptionCount: 1,
  autoRefreshCooldownMinutes: 30,
  adminEmails: ['kylee@igisam.com'],
  adminRouteKeyHash: '02d58b3a1968cdc2493c27603a0b045c26f2ae80100295975691cb2a0ea937eb',
  releaseChannel: 'main',
  deploymentQueryParam: 'deployment',
  manifestWebappAccess: 'DOMAIN',
  mainWebappAccess: 'ANYONE_ANONYMOUS',
  qaWebappAccess: 'ANYONE_ANONYMOUS',
  qaRoutingMode: 'same_project_route',
  mainWebappUrl: '',
  qaWebappUrl: '',
  publicSnapshotBaseUrl: 'https://kylee94.github.io/logi_leasing_db/data',
  debugMode: DEBUG_MODE,
  qaScriptId: '',
  reviewStatuses: ['ok', 'missing', 'suspected_error', 'review_required'],
  calculationStatuses: ['ok', 'missing', 'suspected_error', 'review_required'],
  sheetNames: Object.freeze({
    meta: 'meta_DB_일반',
    general: 'DB_일반',
    history: 'DB_히스토리 누적',
    company: 'DB_기업',
    asset: 'DB_자산',
    calculation: 'DB_계산',
    manager: '펀드-자산-담당자 연결',
    issue: '이슈 리스트',
    sysConfig: 'SYS_설정',
    sysCode: 'SYS_코드',
    sysTenantNormalize: 'SYS_기업명정규화',
    sysAssetLookup: 'SYS_자산조회키',
    logValidation: 'LOG_검증',
    logApi: 'LOG_API',
    logCalculation: 'LOG_계산',
    audit: 'AUDIT_데이터이상',
    auditLog: 'AuditLog',
    permission: 'SYS_권한',
  }),
});

const MAIN_HELPER_HEADERS = Object.freeze([
  'fund_id',
  'asset_id',
  'tenant_id',
  'lease_id',
  'lease_space_id',
  'tenant_master_name',
  'source_row_hash',
  'review_status',
  'review_note',
  'source_doc_ref',
]);

const HISTORY_HELPER_HEADERS = Object.freeze([
  'lease_space_id',
  'history_event_id',
  'is_latest',
  'review_status',
  'review_note',
]);

const COMPANY_HELPER_HEADERS = Object.freeze([
  'tenant_id',
  'dart_corp_code',
  'match_status',
  'industry_code',
  'headquarters_address',
  'listed_yn',
  'group_name',
  'latest_revenue',
  'latest_operating_income',
  'latest_debt_ratio',
  'latest_employee_count',
  'fetched_at',
  'review_status',
  'review_note',
]);

const ASSET_HELPER_HEADERS = Object.freeze([
  'asset_id',
  'standardized_address',
  'sigunguCd',
  'bjdongCd',
  'platGbCd',
  'bun',
  'ji',
  'building_name',
  'approval_date',
  'gross_floor_area',
  'land_area',
  'floor_count',
  'fetched_at',
  'review_status',
  'review_note',
  'latitude',
  'longitude',
  'geocode_status',
  'building_hub_status',
]);

const CALCULATION_HEADERS = Object.freeze([
  'snapshot_month',
  'asset_id',
  'asset_name',
  'tenant_id',
  'tenant_master_name',
  'vacancy_area',
  'vacancy_rate',
  'monthly_rent_total',
  'monthly_mf_total',
  'e_noc',
  'formula_version',
  'calculation_status',
  'created_at',
  'review_status',
  'review_note',
  'source_lease_space_id',
]);

function normalizeReleaseChannel_(value) {
  const normalized = safeString_(value).toLowerCase();
  return normalized === 'qa' ? 'qa' : 'main';
}

function normalizeQaRoutingMode_(value) {
  const normalized = safeString_(value).toLowerCase();
  return normalized === 'separate_project' ? 'separate_project' : 'same_project_route';
}

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: props.getProperty('SPREADSHEET_ID') || DEFAULT_CONFIG.spreadsheetId,
    openDartApiKey: props.getProperty('OPENDART_API_KEY') || DEFAULT_SECRETS.openDartApiKey,
    buildingRegisterApiKeyEncoded: props.getProperty('BUILDING_REGISTER_API_KEY_ENCODED') || DEFAULT_SECRETS.buildingRegisterApiKeyEncoded,
    buildingRegisterApiKeyDecoded: props.getProperty('BUILDING_REGISTER_API_KEY_DECODED') || DEFAULT_SECRETS.buildingRegisterApiKeyDecoded,
    buildingHubApiKey: props.getProperty('BUILDING_HUB_API_KEY') || props.getProperty('BUILDING_REGISTER_API_KEY_ENCODED') || DEFAULT_SECRETS.buildingRegisterApiKeyEncoded,
    naverMapsClientId: props.getProperty('NAVER_MAPS_CLIENT_ID') || DEFAULT_SECRETS.naverMapsClientId,
    naverStaticMapKeyId: props.getProperty('NAVER_STATIC_MAP_KEY_ID') || props.getProperty('NAVER_MAPS_CLIENT_ID') || DEFAULT_SECRETS.naverMapsClientId,
    naverMapsClientSecret: props.getProperty('NAVER_MAPS_CLIENT_SECRET') || DEFAULT_SECRETS.naverMapsClientSecret,
    enableServerGeocoding: String(props.getProperty('ENABLE_SERVER_GEOCODING') || 'false') === 'true',
    formulaVersion: props.getProperty('FORMULA_VERSION') || DEFAULT_CONFIG.formulaVersion,
    areaSqmPerPy: Number(props.getProperty('AREA_SQM_PER_PY') || DEFAULT_CONFIG.areaSqmPerPy),
    cacheTtlSeconds: Number(props.getProperty('CACHE_TTL_SECONDS') || DEFAULT_CONFIG.cacheTtlSeconds),
    modelCacheTtlSeconds: Number(props.getProperty('MODEL_CACHE_TTL_SECONDS') || DEFAULT_CONFIG.modelCacheTtlSeconds),
    payloadCacheTtlSeconds: Number(props.getProperty('PAYLOAD_CACHE_TTL_SECONDS') || DEFAULT_CONFIG.payloadCacheTtlSeconds),
    dailySnapshotRefreshHour: Number(props.getProperty('DAILY_SNAPSHOT_REFRESH_HOUR') || DEFAULT_CONFIG.dailySnapshotRefreshHour),
    staticSnapshotMaxAssets: Number(props.getProperty('STATIC_SNAPSHOT_MAX_ASSETS') || DEFAULT_CONFIG.staticSnapshotMaxAssets),
    staticSnapshotMaxCompanies: Number(props.getProperty('STATIC_SNAPSHOT_MAX_COMPANIES') || DEFAULT_CONFIG.staticSnapshotMaxCompanies),
    bootstrapOptionCount: Number(props.getProperty('BOOTSTRAP_OPTION_COUNT') || DEFAULT_CONFIG.bootstrapOptionCount),
    autoRefreshCooldownMinutes: Number(props.getProperty('AUTO_REFRESH_COOLDOWN_MINUTES') || DEFAULT_CONFIG.autoRefreshCooldownMinutes),
    releaseChannel: normalizeReleaseChannel_(props.getProperty('RELEASE_CHANNEL') || DEFAULT_CONFIG.releaseChannel),
    deploymentQueryParam: props.getProperty('DEPLOYMENT_QUERY_PARAM') || DEFAULT_CONFIG.deploymentQueryParam,
    manifestWebappAccess: props.getProperty('MANIFEST_WEBAPP_ACCESS') || DEFAULT_CONFIG.manifestWebappAccess,
    mainWebappAccess: props.getProperty('MAIN_WEBAPP_ACCESS') || DEFAULT_CONFIG.mainWebappAccess,
    qaWebappAccess: props.getProperty('QA_WEBAPP_ACCESS') || DEFAULT_CONFIG.qaWebappAccess,
    qaRoutingMode: normalizeQaRoutingMode_(props.getProperty('QA_ROUTING_MODE') || DEFAULT_CONFIG.qaRoutingMode),
    mainWebappUrl: safeString_(props.getProperty('MAIN_WEBAPP_URL') || DEFAULT_CONFIG.mainWebappUrl),
    qaWebappUrl: safeString_(props.getProperty('QA_WEBAPP_URL') || DEFAULT_CONFIG.qaWebappUrl),
    publicSnapshotBaseUrl: safeString_(props.getProperty('PUBLIC_SNAPSHOT_BASE_URL') || DEFAULT_CONFIG.publicSnapshotBaseUrl),
    debugMode: String(props.getProperty('DEBUG_MODE') || DEFAULT_CONFIG.debugMode).toLowerCase() === 'true',
    qaScriptId: safeString_(props.getProperty('QA_SCRIPT_ID') || DEFAULT_CONFIG.qaScriptId),
    adminEmails: (props.getProperty('ADMIN_EMAILS') || DEFAULT_CONFIG.adminEmails.join(',')).split(',').map(function (value) { return safeString_(value).toLowerCase(); }).filter(Boolean),
    adminRouteKeyHash: safeString_(props.getProperty('ADMIN_ROUTE_KEY_HASH') || DEFAULT_CONFIG.adminRouteKeyHash),
    sheetNames: DEFAULT_CONFIG.sheetNames,
  };
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getConfig_().spreadsheetId);
}
