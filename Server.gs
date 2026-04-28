function doGet(e) {
  const apiResponse = maybeHandleApiGet_(e);
  if (apiResponse) return apiResponse;
  const template = HtmlService.createTemplateFromFile('Index');
  const requestedPage = (e && e.parameter && e.parameter.page) || 'user';
  const viewer = getViewerContext_();
  const requestedAdminShell = requestedPage === 'admin';
  const deployment = getDeploymentContext_(e);
  const runtimeClientConfig = getRuntimeClientConfig_(deployment);
  const adminSessionToken = requestedAdminShell && viewer.isAdmin ? createAdminSessionToken_() : '';
  const adminAuthRequired = requestedAdminShell && !viewer.isAdmin;

  template.IS_ADMIN = viewer.isAdmin || requestedAdminShell;
  template.ADMIN_AUTH_REQUIRED = adminAuthRequired;
  template.VIEWER_EMAIL = viewer.email;
  template.ADMIN_SESSION_TOKEN = adminSessionToken;
  template.DEPLOYMENT_CHANNEL = deployment.channel;
  template.INITIAL_PAGE = requestedAdminShell ? 'admin' : 'home';
  template.RUNTIME_CLIENT_CONFIG = JSON.stringify(runtimeClientConfig);
  template.NAVER_MAP_CLIENT_ID = runtimeClientConfig.naverMapsClientId;
  template.NAVER_STATIC_MAP_KEY_ID = runtimeClientConfig.naverStaticMapKeyId;

  return template
    .evaluate()
    .setTitle(APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function maybeHandleApiGet_(e) {
  const apiName = safeString_(e && e.parameter && e.parameter.api).toLowerCase();
  const pageName = safeString_(e && e.parameter && e.parameter.page).toLowerCase();
  if (apiName !== 'public-snapshot' && pageName !== 'public-snapshot') return null;
  const name = safeString_(e && e.parameter && e.parameter.name).toLowerCase();
  const id = safeString_(e && e.parameter && e.parameter.id);
  const payload = getPublicSnapshotPayload_(name, id);
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getPublicSnapshotPayload_(name, id) {
  if (name === 'bootstrap') return getBootstrapData();
  if (name === 'home') return getHomeData();
  if (name === 'asset-options') return getAssetOptions();
  if (name === 'company-options') return getCompanyOptions();
  if (name === 'asset') return getAssetData(id);
  if (name === 'company') return getCompanyData(id);
  throw new Error('Unknown public snapshot name: ' + name);
}

function getViewerContext() {
  return getViewerContext_();
}

function getViewerContext_(options) {
  const config = getConfig_();
  const normalized = options || {};
  const activeEmail = safeString_(Session.getActiveUser().getEmail()).toLowerCase();
  const activeIsAdmin = config.adminEmails.indexOf(activeEmail) > -1;
  const tokenIsAdmin = isValidAdminSessionToken_(normalized.adminSessionToken);
  const isAdmin = activeIsAdmin || tokenIsAdmin;
  return {
    email: activeEmail,
    hasEmail: !!activeEmail,
    isAdmin: isAdmin,
    matchedAdminEmail: activeIsAdmin ? activeEmail : '',
    activeEmail: activeEmail,
    adminSessionAccepted: tokenIsAdmin,
    adminConfiguredCount: config.adminEmails.length,
  };
}

function isValidAdminKey_(value) {
  const config = getConfig_();
  const expectedHash = safeString_(config.adminRouteKeyHash);
  if (!expectedHash) return false;
  const key = safeString_(value);
  if (!key) return false;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8);
  const hash = digest.map(function (byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
  return hash === expectedHash;
}

function createAdminSessionToken_() {
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  CacheService.getScriptCache().put('admin-session:' + token, '1', 21600);
  return token;
}

function isValidAdminSessionToken_(value) {
  const token = safeString_(value);
  if (!token) return false;
  const cache = CacheService.getScriptCache();
  const cacheKey = 'admin-session:' + token;
  const valid = cache.get(cacheKey) === '1';
  if (valid) cache.put(cacheKey, '1', 21600);
  return valid;
}

function verifyAdminPassword(request) {
  const password = request && request.password;
  if (!isValidAdminKey_(password)) {
    throw new Error('관리자 비밀번호가 올바르지 않습니다.');
  }
  return {
    status: 'ok',
    adminSessionToken: createAdminSessionToken_(),
  };
}

function hasDedicatedQaWebapp_(config) {
  return !!safeString_(config && config.qaWebappUrl);
}

function resolveQaRoutingStatus_(config) {
  if (hasDedicatedQaWebapp_(config)) return 'separate_project';
  if (normalizeQaRoutingMode_(config && config.qaRoutingMode) === 'separate_project') {
    return 'separate_project_requested_but_url_missing';
  }
  return 'same_project_route';
}

function resolveDeploymentBaseUrl_(config, channel) {
  const normalizedChannel = normalizeReleaseChannel_(channel);
  if (normalizedChannel === 'qa' && hasDedicatedQaWebapp_(config)) {
    return safeString_(config.qaWebappUrl);
  }
  if (normalizedChannel === 'main' && safeString_(config.mainWebappUrl)) {
    return safeString_(config.mainWebappUrl);
  }
  return '/exec';
}

function appendQueryParamsToRoute_(baseUrl, params) {
  const cleanedBaseUrl = safeString_(baseUrl) || '/exec';
  if (!params.length) return cleanedBaseUrl;
  return `${cleanedBaseUrl}${cleanedBaseUrl.indexOf('?') === -1 ? '?' : '&'}${params.join('&')}`;
}

function resolveEffectiveWebappAccess_(channel, config) {
  const normalizedChannel = normalizeReleaseChannel_(channel);
  if (normalizedChannel === 'qa' && resolveQaRoutingStatus_(config) === 'separate_project') {
    return config.qaWebappAccess;
  }
  if (normalizedChannel === 'main' && safeString_(config.mainWebappUrl)) {
    return config.mainWebappAccess;
  }
  return config.manifestWebappAccess || 'DOMAIN';
}

function getDeploymentContext_(e) {
  const config = getConfig_();
  const parameterName = config.deploymentQueryParam || 'deployment';
  const requested = safeString_(e && e.parameter && e.parameter[parameterName]);
  const channel = normalizeReleaseChannel_(requested || config.releaseChannel);
  return {
    channel: channel,
    queryParam: parameterName,
    isQa: channel === 'qa',
    qaRoutingStatus: resolveQaRoutingStatus_(config),
    webappAccess: resolveEffectiveWebappAccess_(channel, config),
  };
}

function buildDeploymentRoute_(page, channel) {
  const config = getConfig_();
  const normalizedChannel = normalizeReleaseChannel_(channel);
  const params = [];
  const baseUrl = resolveDeploymentBaseUrl_(config, normalizedChannel);

  if (safeString_(page) && safeString_(page) !== 'user') {
    params.push(`page=${encodeURIComponent(page)}`);
  }
  if (normalizedChannel === 'qa' && resolveQaRoutingStatus_(config) !== 'separate_project') {
    params.push(`${encodeURIComponent(config.deploymentQueryParam || 'deployment')}=qa`);
  }
  return appendQueryParamsToRoute_(baseUrl, params);
}

function getNaverMapsAllowedOriginHints_(config) {
  const origins = [
    'https://script.google.com',
    'https://script.googleusercontent.com',
    'https://docs.google.com',
  ];
  [config && config.mainWebappUrl, config && config.qaWebappUrl].forEach(function (url) {
    const match = safeString_(url).match(/^https?:\/\/[^/?#]+/i);
    if (match && origins.indexOf(match[0]) === -1) origins.push(match[0]);
  });
  return origins;
}

function getRuntimeClientConfig_(deploymentContext) {
  const config = getConfig_();
  const deployment = deploymentContext || {
    channel: normalizeReleaseChannel_(config.releaseChannel),
    webappAccess: resolveEffectiveWebappAccess_(config.releaseChannel, config),
  };
  return {
    naverMapsClientId: safeString_(config.naverMapsClientId),
    naverStaticMapKeyId: safeString_(config.naverStaticMapKeyId || config.naverMapsClientId),
    naverMapsEnabled: !!safeString_(config.naverMapsClientId),
    naverMapsRuntimeSource: safeString_(config.naverMapsClientId) ? 'script_property_or_default' : 'missing',
    publicSnapshotBaseUrl: safeString_(config.publicSnapshotBaseUrl),
    naverMapsAllowedOriginHints: getNaverMapsAllowedOriginHints_(config),
    naverMapsSdkUrlPattern: 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId={NAVER_MAPS_CLIENT_ID}&callback=__dashboardNaverMapsSdkReady',
    deploymentChannel: normalizeReleaseChannel_(deployment.channel),
    webappAccess: safeString_(deployment.webappAccess),
    qaRoutingStatus: resolveQaRoutingStatus_(config),
  };
}

function getBootstrapData() {
  const cacheKey = buildKeyedPayloadKey_('bootstrap');
  const viewer = getViewerContext_();
  const cached = getCachedJson_(cacheKey);
  if (isBootstrapPayloadFresh_(cached)) return sanitizePayloadForViewer_(enrichBootstrapPayload_(cached), viewer);
  const shell = enrichBootstrapPayload_(buildBootstrapShell_());
  if (shell) {
    const dataDirty = isDataDirty_();
    if (!isBootstrapPayloadFresh_(shell) || dataDirty) {
      queueBootstrapBackgroundRefresh_(dataDirty ? 'bootstrap_data_dirty' : 'bootstrap_stale');
    }
    putCachedJson_(cacheKey, shell, getConfig_().payloadCacheTtlSeconds);
    return sanitizePayloadForViewer_(shell, viewer);
  }
  const fallback = buildBootstrapShellFallback_();
  queueBootstrapBackgroundRefresh_('bootstrap_missing_shell');
  return sanitizePayloadForViewer_(putCachedJson_(cacheKey, enrichBootstrapPayload_(fallback), getConfig_().payloadCacheTtlSeconds), viewer);
}

function enrichBootstrapPayload_(payload) {
  const clone = JSON.parse(JSON.stringify(payload || {}));
  clone.defaults = clone.defaults || {};
  clone.defaultAssetPayload = null;
  clone.defaultCompanyPayload = null;
  const persistedHome = clone.home ? null : readPersistedJsonProperty_('HOME_PAYLOAD_JSON');

  if (!clone.home && isHomePayloadFresh_(persistedHome)) {
    clone.home = persistedHome;
  }
  if ((!clone.homeLiteKpis || !clone.homeLiteKpis.length) && clone.home && Array.isArray(clone.home.kpis)) {
    const preferredHomeLiteKeys = ['operating_asset_count', 'leased_area_total', 'vacancy_area_total', 'monthly_total_cost'];
    clone.homeLiteKpis = preferredHomeLiteKeys.map(function (key) {
      return clone.home.kpis.find(function (item) { return safeString_(item && item.key) === key; });
    }).filter(Boolean).map(function (item) {
      return {
        key: item.key,
        value: item.value,
        status: item.status,
        valueType: item.valueType,
      };
    });
  }

  if (!clone.defaults.assetId) {
    const persistedAssetOptions = readPersistedJsonProperty_('ASSET_OPTIONS_JSON') || [];
    clone.defaults.assetId = safeString_(safeGet_(persistedAssetOptions, [0, 'assetId']));
  }
  if (!clone.defaults.tenantId) {
    const persistedCompanyOptions = readPersistedJsonProperty_('COMPANY_OPTIONS_JSON') || [];
    clone.defaults.tenantId = safeString_(safeGet_(persistedCompanyOptions, [0, 'tenantId']));
  }

  return clone;
}

function getViewerContextFromRequest_(request) {
  return getViewerContext_({ adminSessionToken: request && request.adminSessionToken });
}

function getHomeData(request) {
  const cacheKey = buildKeyedPayloadKey_('home');
  const viewer = getViewerContextFromRequest_(request);
  const viewerCached = getCachedPayloadForViewer_(cacheKey, viewer);
  if (viewerCached) return viewerCached;
  const cached = getCachedJson_(cacheKey);
  if (isHomePayloadFresh_(cached)) return returnPayloadForViewer_(cached, viewer, cacheKey);
  const staticHome = readStaticPayloadSnapshot_('home', 'default');
  if (isHomePayloadFresh_(staticHome)) {
    putCachedJson_(cacheKey, staticHome, getConfig_().payloadCacheTtlSeconds);
    if (isDataDirty_()) queueBootstrapBackgroundRefresh_('home_static_snapshot_dirty');
    return returnPayloadForViewer_(staticHome, viewer, cacheKey);
  }
  const persistedHome = readPersistedJsonProperty_('HOME_PAYLOAD_JSON');
  if (isHomePayloadFresh_(persistedHome)) {
    putCachedJson_(cacheKey, persistedHome, getConfig_().payloadCacheTtlSeconds);
    if (isDataDirty_()) queueBootstrapBackgroundRefresh_('home_payload_persisted_dirty');
    return returnPayloadForViewer_(persistedHome, viewer, cacheKey);
  }
  const shell = buildBootstrapShell_();
  if (shell && isHomePayloadFresh_(shell.home)) {
    putCachedJson_(cacheKey, shell.home, getConfig_().payloadCacheTtlSeconds);
    return returnPayloadForViewer_(shell.home, viewer, cacheKey);
  }
  queueBootstrapBackgroundRefresh_('home_payload_stale');
  const payload = buildHomePayload_(getModelOrRefreshCache_());
  putCachedJson_(cacheKey, payload, getConfig_().payloadCacheTtlSeconds);
  if (typeof persistJsonScriptProperty_ === 'function') {
    persistJsonScriptProperty_('HOME_PAYLOAD_JSON', payload, { allowChunking: true });
  }
  return returnPayloadForViewer_(payload, viewer, cacheKey);
}

function resolveDefaultAssetId_() {
  const shell = buildBootstrapShell_();
  return safeString_(safeGet_(shell, ['defaults', 'assetId']));
}

function resolveDefaultTenantId_() {
  const shell = buildBootstrapShell_();
  return safeString_(safeGet_(shell, ['defaults', 'tenantId']));
}

function readPersistedJsonProperty_(key) {
  if (typeof readJsonScriptProperty_ === 'function') {
    return readJsonScriptProperty_(key);
  }
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function normalizeEntityDataRequest_(input, idKey) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return {
      id: safeString_(input[idKey]),
      adminSessionToken: safeString_(input.adminSessionToken),
    };
  }
  return {
    id: safeString_(input),
    adminSessionToken: '',
  };
}

function getAssetData(input) {
  const request = normalizeEntityDataRequest_(input, 'assetId');
  const viewer = getViewerContextFromRequest_(request);
  const defaultAssetId = resolveDefaultAssetId_();
  const selectedAssetId = request.id || defaultAssetId;
  const cacheKey = buildKeyedPayloadKey_('asset', selectedAssetId);
  const viewerCached = getCachedPayloadForViewer_(cacheKey, viewer);
  if (viewerCached) return viewerCached;
  const cached = getCachedJson_(cacheKey);
  if (cached) return returnPayloadForViewer_(cached, viewer, cacheKey);
  const staticPayload = readStaticPayloadSnapshot_('asset', selectedAssetId);
  if (staticPayload) {
    putCachedJson_(cacheKey, staticPayload, getConfig_().payloadCacheTtlSeconds);
    if (isDataDirty_()) queueBootstrapBackgroundRefresh_('asset_static_snapshot_dirty');
    return returnPayloadForViewer_(staticPayload, viewer, cacheKey);
  }
  if (selectedAssetId && selectedAssetId === defaultAssetId) {
    const persisted = readPersistedJsonProperty_('DEFAULT_ASSET_PAYLOAD_JSON');
    if (persisted) {
      putCachedJson_(cacheKey, persisted, getConfig_().payloadCacheTtlSeconds);
      return returnPayloadForViewer_(persisted, viewer, cacheKey);
    }
  }
  const payload = buildAssetPayload_(getModelOrRefreshCache_(), selectedAssetId);
  putCachedJson_(cacheKey, payload, getConfig_().payloadCacheTtlSeconds);
  if (selectedAssetId && selectedAssetId === defaultAssetId && typeof persistJsonScriptProperty_ === 'function') {
    persistJsonScriptProperty_('DEFAULT_ASSET_PAYLOAD_JSON', payload, { allowChunking: true });
  }
  return returnPayloadForViewer_(payload, viewer, cacheKey);
}

function getCompanyData(input) {
  const request = normalizeEntityDataRequest_(input, 'tenantId');
  const viewer = getViewerContextFromRequest_(request);
  const defaultTenantId = resolveDefaultTenantId_();
  const selectedTenantId = request.id || defaultTenantId;
  const cacheKey = buildKeyedPayloadKey_('company', selectedTenantId);
  const viewerCached = getCachedPayloadForViewer_(cacheKey, viewer);
  if (viewerCached) return viewerCached;
  const cached = getCachedJson_(cacheKey);
  if (cached) return returnPayloadForViewer_(cached, viewer, cacheKey);
  const staticPayload = readStaticPayloadSnapshot_('company', selectedTenantId);
  if (staticPayload) {
    putCachedJson_(cacheKey, staticPayload, getConfig_().payloadCacheTtlSeconds);
    if (isDataDirty_()) queueBootstrapBackgroundRefresh_('company_static_snapshot_dirty');
    return returnPayloadForViewer_(staticPayload, viewer, cacheKey);
  }
  if (selectedTenantId && selectedTenantId === defaultTenantId) {
    const persisted = readPersistedJsonProperty_('DEFAULT_COMPANY_PAYLOAD_JSON');
    if (persisted) {
      putCachedJson_(cacheKey, persisted, getConfig_().payloadCacheTtlSeconds);
      return returnPayloadForViewer_(persisted, viewer, cacheKey);
    }
  }
  const payload = buildCompanyPayload_(getModelOrRefreshCache_(), selectedTenantId);
  putCachedJson_(cacheKey, payload, getConfig_().payloadCacheTtlSeconds);
  if (selectedTenantId && selectedTenantId === defaultTenantId && typeof persistJsonScriptProperty_ === 'function') {
    persistJsonScriptProperty_('DEFAULT_COMPANY_PAYLOAD_JSON', payload, { allowChunking: true });
  }
  return returnPayloadForViewer_(payload, viewer, cacheKey);
}

function getSectorData(request) {
  const viewer = getViewerContextFromRequest_(request);
  const cacheKey = buildKeyedPayloadKey_('sector');
  const cached = getCachedJson_(cacheKey);
  if (cached) return sanitizePayloadForViewer_(cached, viewer);
  const staticPayload = readStaticPayloadSnapshot_('sector', 'default');
  if (staticPayload) {
    putCachedJson_(cacheKey, staticPayload, getConfig_().payloadCacheTtlSeconds);
    return sanitizePayloadForViewer_(staticPayload, viewer);
  }
  return sanitizePayloadForViewer_(putCachedJson_(cacheKey, buildSectorPayload_(getModelOrRefreshCache_()), getConfig_().payloadCacheTtlSeconds), viewer);
}

function getToolsData(request) {
  const viewer = getViewerContextFromRequest_(request);
  const normalized = normalizeToolsRequest_(request);
  const cacheKey = buildKeyedPayloadKey_('tools', normalized);
  const cached = getCachedJson_(cacheKey);
  if (cached) return sanitizePayloadForViewer_(cached, viewer);
  if (isDefaultToolsRequest_(normalized)) {
    const staticPayload = readStaticPayloadSnapshot_('tools', 'default');
    if (staticPayload) {
      putCachedJson_(cacheKey, staticPayload, getConfig_().payloadCacheTtlSeconds);
      return sanitizePayloadForViewer_(staticPayload, viewer);
    }
  }
  return sanitizePayloadForViewer_(putCachedJson_(cacheKey, buildToolsPayload_(getModelOrRefreshCache_(), normalized), getConfig_().payloadCacheTtlSeconds), viewer);
}

function getPlaygroundData(request) {
  const viewer = getViewerContextFromRequest_(request);
  const normalized = normalizePlaygroundRequest_(request);
  const cacheKey = buildKeyedPayloadKey_('playground', normalized);
  const cached = getCachedJson_(cacheKey);
  if (cached) return sanitizePayloadForViewer_(cached, viewer);
  if (isDefaultPlaygroundRequest_(normalized)) {
    const staticPayload = readStaticPayloadSnapshot_('playground', 'default');
    if (staticPayload) {
      putCachedJson_(cacheKey, staticPayload, getConfig_().payloadCacheTtlSeconds);
      return sanitizePayloadForViewer_(staticPayload, viewer);
    }
  }
  return sanitizePayloadForViewer_(putCachedJson_(cacheKey, buildPlaygroundPayload_(getModelOrRefreshCache_(), normalized), getConfig_().payloadCacheTtlSeconds), viewer);
}

function getReviewBacklog() {
  return getModelOrRefreshCache_().reviewSummary.unresolvedIssues;
}

function getAdminDashboardData(request) {
  assertAdmin_(request);
  const viewer = getViewerContext_({ adminSessionToken: request && request.adminSessionToken });
  const adminErrors = [];
  const snapshotState = getStaticPayloadSnapshotState_();
  const dashboardSummary = readPersistedJsonProperty_('ADMIN_DASHBOARD_SUMMARY_JSON') || {};
  if (isAdminDashboardSummaryFresh_(dashboardSummary)) {
    return buildAdminDashboardResponse_(viewer, snapshotState, dashboardSummary, adminErrors);
  }

  const summary = readPersistedJsonProperty_('ADMIN_SUMMARY_JSON') || {};
  const reviewCache = readPersistedJsonProperty_('ADMIN_REVIEW_CACHE_JSON') || {};
  let shell = null;
  let homePayload = null;
  let sheetCounts = null;

  function readShellOnce() {
    if (!shell) shell = buildBootstrapShell_();
    return shell;
  }

  function readHomeOnce() {
    if (!homePayload) homePayload = getAdminHomePayloadFast_();
    return homePayload;
  }

  function readSheetCountsOnce() {
    if (!sheetCounts) sheetCounts = buildAdminReviewCountsFromSheet_();
    return sheetCounts;
  }

  const effectiveSummary = Array.isArray(summary.reviewMetrics) && summary.reviewMetrics.length
    ? summary
    : (Array.isArray(reviewCache.reviewMetrics) && reviewCache.reviewMetrics.length
      ? {
          integrations: safeGet_(summary, ['integrations']) || getAdminMinimalIntegrations_(),
          reviewMetrics: reviewCache.reviewMetrics,
          reviewDetails: safeGet_(reviewCache, ['reviewDetails']) || {},
          issueBacklogCount: Number(safeGet_(summary, ['issueBacklogCount']) || safeGet_(reviewCache, ['issueBacklogCount']) || 0),
          openDartBacklogCount: Number(safeGet_(summary, ['openDartBacklogCount']) || safeGet_(reviewCache, ['openDartBacklogCount']) || 0),
          buildingBacklogCount: Number(safeGet_(summary, ['buildingBacklogCount']) || safeGet_(reviewCache, ['buildingBacklogCount']) || 0),
          uiDataReconciliation: {
            status: 'summary_only',
            okCount: 0,
            reviewCount: Number((reviewCache.reviewMetrics || []).find(function (item) { return item.key === 'reviewRequired'; })?.value || 0),
            errorCount: Number((reviewCache.reviewMetrics || []).find(function (item) { return item.key === 'suspectedError'; })?.value || 0),
            generatedAt: safeGet_(reviewCache, ['generatedAt']) || '',
          },
          auditErrorCount: Number(safeGet_(summary, ['auditErrorCount']) || snapshotState.errorCount || 0),
        }
      : (readHomeOnce() && safeGet_(readHomeOnce(), ['missingCounts'])
      ? {
          integrations: safeGet_(readShellOnce(), ['integrations']) || getMinimalIntegrationStatus_(),
          reviewMetrics: buildAdminReviewMetrics_(readHomeOnce(), null),
          reviewDetails: safeGet_(reviewCache, ['reviewDetails']) || {},
          issueBacklogCount: Number(safeGet_(readShellOnce(), ['issueBacklogCount']) || safeGet_(readHomeOnce(), ['missingCounts', 'unresolvedIssueCount']) || safeGet_(readHomeOnce(), ['issueBacklog', 'length']) || 0),
          openDartBacklogCount: Number(safeGet_(readShellOnce(), ['integrations', 'openDart', 'pendingCompanies']) || safeGet_(reviewCache, ['openDartBacklogCount']) || 0),
          buildingBacklogCount: Number(safeGet_(readShellOnce(), ['integrations', 'buildingHub', 'pendingAssets']) || safeGet_(reviewCache, ['buildingBacklogCount']) || 0),
          uiDataReconciliation: {
            status: 'summary_only',
            okCount: 0,
            reviewCount: Number(safeGet_(readHomeOnce(), ['missingCounts', 'reviewRequired']) || 0),
            errorCount: Number(safeGet_(readHomeOnce(), ['missingCounts', 'suspectedError']) || 0),
            generatedAt: safeGet_(readHomeOnce(), ['generatedAt']) || '',
          },
          auditErrorCount: Number(snapshotState.errorCount || 0),
        }
      : {
          integrations: getAdminMinimalIntegrations_(),
          reviewMetrics: buildAdminReviewMetrics_(null, (readSheetCountsOnce().counts || {})),
          reviewDetails: {},
          issueBacklogCount: readAdminIssueBacklogRows_().length,
          openDartBacklogCount: readAdminCompanyBacklogRows_().length,
          buildingBacklogCount: readAdminAssetBacklogRows_().length,
          uiDataReconciliation: {
            status: 'summary_only',
            okCount: 0,
            reviewCount: Number(safeGet_(readSheetCountsOnce(), ['counts', 'reviewRequired']) || 0),
            errorCount: Number(safeGet_(readSheetCountsOnce(), ['counts', 'suspectedError']) || 0),
            generatedAt: '',
          },
          auditErrorCount: Number(snapshotState.errorCount || 0),
        }));

  if (!Array.isArray(effectiveSummary.reviewMetrics) || !effectiveSummary.reviewMetrics.length) {
    adminErrors.push({
      area: 'adminSummary',
      message: '저장된 Home 요약이 부족합니다. 계산 갱신 또는 9시 스냅샷 갱신을 실행하세요.',
    });
  }

  let resolvedOpenDartBacklogCount = resolveAdminCachedCount_(
    safeGet_(effectiveSummary, ['openDartBacklogCount']),
    safeGet_(reviewCache, ['openDartBacklogCount']),
    Array.isArray(reviewCache.openDartBacklog) ? reviewCache.openDartBacklog.length : null
  );
  let resolvedBuildingBacklogCount = resolveAdminCachedCount_(
    safeGet_(effectiveSummary, ['buildingBacklogCount']),
    safeGet_(reviewCache, ['buildingBacklogCount']),
    Array.isArray(reviewCache.buildingBacklog) ? reviewCache.buildingBacklog.length : null
  );
  const resolvedIssueBacklogCount = resolveAdminCachedCount_(
    safeGet_(effectiveSummary, ['issueBacklogCount']),
    safeGet_(reviewCache, ['issueBacklogCount']),
    Array.isArray(safeGet_(reviewCache, ['reviewDetails', 'issueBacklog']))
      ? safeGet_(reviewCache, ['reviewDetails', 'issueBacklog']).length
      : null
  );
  if (resolvedOpenDartBacklogCount === 0 || resolvedBuildingBacklogCount === 0) {
    const backlogCounts = getAdminBacklogCountsFast_();
    if (resolvedOpenDartBacklogCount === 0) resolvedOpenDartBacklogCount = Number(backlogCounts.openDartBacklogCount || 0);
    if (resolvedBuildingBacklogCount === 0) resolvedBuildingBacklogCount = Number(backlogCounts.buildingBacklogCount || 0);
  }

  const dashboardPayload = {
    integrations: safeGet_(effectiveSummary, ['integrations']) || getAdminMinimalIntegrations_(),
    reviewMetrics: safeGet_(effectiveSummary, ['reviewMetrics']) || [],
    issueBacklogCount: resolvedIssueBacklogCount,
    openDartBacklogCount: resolvedOpenDartBacklogCount,
    buildingBacklogCount: resolvedBuildingBacklogCount,
    uiDataReconciliation: {
      status: safeGet_(effectiveSummary, ['uiDataReconciliation', 'status']) || 'summary_only',
      okCount: Number(safeGet_(effectiveSummary, ['uiDataReconciliation', 'okCount']) || 0),
      reviewCount: Number(safeGet_(effectiveSummary, ['uiDataReconciliation', 'reviewCount']) || 0),
      errorCount: Number(safeGet_(effectiveSummary, ['uiDataReconciliation', 'errorCount']) || 0),
      generatedAt: safeGet_(effectiveSummary, ['uiDataReconciliation', 'generatedAt']) || '',
    },
    auditErrorCount: Number(safeGet_(effectiveSummary, ['auditErrorCount']) || snapshotState.errorCount || 0),
    generatedTs: Date.now(),
  };
  persistAdminDashboardSummary_(dashboardPayload);
  return buildAdminDashboardResponse_(viewer, snapshotState, dashboardPayload, adminErrors);
}

function buildAdminDashboardResponse_(viewer, snapshotState, dashboardPayload, adminErrors) {
  return {
    viewer: viewer,
    authorization: {
      status: '인증 완료',
      authorizationUrl: '',
    },
    bootstrapState: {},
    staticSnapshotState: snapshotState,
    integrations: safeGet_(dashboardPayload, ['integrations']) || getAdminMinimalIntegrations_(),
    deployment: getAdminMinimalDeploymentInfo_(),
    reviewMetrics: safeGet_(dashboardPayload, ['reviewMetrics']) || [],
    reviewDetails: {},
    issueBacklogCount: Number(safeGet_(dashboardPayload, ['issueBacklogCount']) || 0),
    openDartBacklogCount: Number(safeGet_(dashboardPayload, ['openDartBacklogCount']) || 0),
    buildingBacklogCount: Number(safeGet_(dashboardPayload, ['buildingBacklogCount']) || 0),
    reviewBacklog: [],
    uiDataReconciliation: {
      status: safeGet_(dashboardPayload, ['uiDataReconciliation', 'status']) || 'summary_only',
      okCount: Number(safeGet_(dashboardPayload, ['uiDataReconciliation', 'okCount']) || 0),
      reviewCount: Number(safeGet_(dashboardPayload, ['uiDataReconciliation', 'reviewCount']) || 0),
      errorCount: Number(safeGet_(dashboardPayload, ['uiDataReconciliation', 'errorCount']) || 0),
      generatedAt: safeGet_(dashboardPayload, ['uiDataReconciliation', 'generatedAt']) || '',
    },
    auditRows: [],
    auditErrorCount: Number(safeGet_(dashboardPayload, ['auditErrorCount']) || snapshotState.errorCount || 0),
    auditNeedsRefresh: true,
    triggers: [],
    jobStates: getAdminJobStates_(),
    loadErrors: adminErrors,
  };
}

function isAdminDashboardSummaryFresh_(summary) {
  const generatedTs = Number(summary && summary.generatedTs || 0);
  if (!generatedTs || Date.now() - generatedTs > 6 * 60 * 60 * 1000) return false;
  return Array.isArray(summary.reviewMetrics) && summary.reviewMetrics.length > 0;
}

function persistAdminDashboardSummary_(summary) {
  try {
    if (typeof persistJsonScriptProperty_ === 'function') {
      persistJsonScriptProperty_('ADMIN_DASHBOARD_SUMMARY_JSON', summary, { allowChunking: true });
    } else {
      PropertiesService.getScriptProperties().setProperty('ADMIN_DASHBOARD_SUMMARY_JSON', JSON.stringify(summary));
    }
  } catch (error) {
    // The dashboard still renders if this small performance cache cannot be saved.
  }
}

function resolveAdminCachedCount_(primary, secondary, fallback) {
  const primaryNumber = toNumber_(primary);
  const secondaryNumber = toNumber_(secondary);
  const fallbackNumber = toNumber_(fallback);
  if (primaryNumber != null && primaryNumber > 0) return primaryNumber;
  if (secondaryNumber != null && secondaryNumber > 0) return secondaryNumber;
  if (fallbackNumber != null && fallbackNumber > 0) return fallbackNumber;
  if (primaryNumber != null) return primaryNumber;
  if (secondaryNumber != null) return secondaryNumber;
  return fallbackNumber != null ? fallbackNumber : 0;
}

function getAdminBacklogCountsFast_() {
  const cached = readPersistedJsonProperty_('ADMIN_BACKLOG_COUNTS_JSON') || {};
  const generatedTs = Number(cached.generatedTs || 0);
  const maxAgeMs = 6 * 60 * 60 * 1000;
  if (
    generatedTs &&
    Date.now() - generatedTs < maxAgeMs &&
    cached.openDartBacklogCount != null &&
    cached.buildingBacklogCount != null
  ) {
    return cached;
  }

  const counts = {
    generatedTs: Date.now(),
    openDartBacklogCount: readAdminCompanyBacklogRows_().length,
    buildingBacklogCount: readAdminAssetBacklogRows_().length,
  };
  if (typeof persistJsonScriptProperty_ === 'function') {
    persistJsonScriptProperty_('ADMIN_BACKLOG_COUNTS_JSON', counts, { allowChunking: true });
  } else {
    PropertiesService.getScriptProperties().setProperty('ADMIN_BACKLOG_COUNTS_JSON', JSON.stringify(counts));
  }
  return counts;
}

function getAdminHomePayloadFast_() {
  const cacheKey = buildKeyedPayloadKey_('home');
  const cached = getCachedJson_(cacheKey);
  if (isHomePayloadFresh_(cached)) return cached;
  const staticHome = typeof readStaticPayloadSnapshot_ === 'function' ? readStaticPayloadSnapshot_('home', 'default') : null;
  if (isHomePayloadFresh_(staticHome)) return staticHome;
  const persisted = readPersistedJsonProperty_('HOME_PAYLOAD_JSON');
  if (isHomePayloadFresh_(persisted)) return persisted;
  const shell = buildBootstrapShell_();
  return shell && isHomePayloadFresh_(shell.home) ? shell.home : null;
}

function getAdminReviewDetail(request) {
  assertAdmin_(request);
  const key = safeString_(request && request.key);
  const detailsCache = readPersistedJsonProperty_('ADMIN_REVIEW_DETAILS_JSON') || {};
  const cachedRows = detailsCache[key];
  if (Array.isArray(cachedRows)) {
    return { key: key, rows: enrichAdminReviewDetailRows_(key, cachedRows), cacheMissing: false, source: 'admin_review_details_cache' };
  }

  const lightweightRows = readAdminGeneralReviewRows_(key);
  if (Array.isArray(lightweightRows) && lightweightRows.length) {
    const enrichedRows = enrichAdminReviewDetailRows_(key, lightweightRows);
    persistAdminReviewDetailRows_(key, enrichedRows);
    return { key: key, rows: enrichedRows, cacheMissing: false, source: 'general_sheet_lightweight' };
  }

  const reviewCache = readPersistedJsonProperty_('ADMIN_REVIEW_CACHE_JSON') || {};
  const legacyCachedRows = safeGet_(reviewCache, ['reviewDetails', key]);
  if (Array.isArray(legacyCachedRows)) {
    const enrichedRows = enrichAdminReviewDetailRows_(key, legacyCachedRows);
    persistAdminReviewDetailRows_(key, enrichedRows);
    return { key: key, rows: enrichedRows, cacheMissing: false, source: 'admin_review_cache' };
  }

  const model = getAdminModelForDetail_();
  const homePayload = getAdminHomePayloadFast_();
  if (!model && key !== 'issueBacklog') return { key: key, rows: [], cacheMissing: true };
  const details = buildAdminReviewDetails_(homePayload, model);
  const rows = enrichAdminReviewDetailRows_(key, details[key] || []);
  if (Array.isArray(rows)) persistAdminReviewDetailRows_(key, rows);
  return {
    key: key,
    rows: rows,
    cacheMissing: false,
  };
}

function enrichAdminReviewDetailRows_(key, rows) {
  return (rows || []).map(function (row) {
    const issue = buildAdminReviewIssueFields_(key, row);
    const clone = Object.assign({}, row);
    clone.issueCategory = clone.issueCategory || issue.issueCategory;
    clone.suspectedCause = clone.suspectedCause || issue.suspectedCause;
    return clone;
  });
}

function buildAdminReviewIssueFields_(key, row) {
  const note = safeString_(row && row.reviewNote);
  if (key === 'historyUnmatched') {
    return {
      issueCategory: '히스토리 미연결',
      suspectedCause: 'DB_히스토리 누적 최신 계약 행과 연결되지 않아 상승률 반영 평당 임대료/관리비를 확인할 수 없습니다.',
    };
  }
  if (key === 'rentMissing') {
    return {
      issueCategory: '임대료 누락',
      suspectedCause: 'DB_일반 월임대료 총액 또는 DB_히스토리 누적 평당 월임대료가 비어 있어 임관리비와 E.NOC 계산이 불완전합니다.',
    };
  }
  if (key === 'mfMissing') {
    return {
      issueCategory: '관리비 누락',
      suspectedCause: 'DB_일반 월관리비 총액 또는 DB_히스토리 누적 평당 월관리비가 비어 있어 월 임관리비와 E.NOC 계산이 불완전합니다.',
    };
  }
  if (key === 'eNocMissing') {
    return {
      issueCategory: 'E.NOC 누락',
      suspectedCause: 'E.NOC 계산에 필요한 평당 임대료/관리비, 계약기간, RF/FO, 전용률, 전용면적 중 하나 이상이 없거나 전용률이 0 이하입니다.',
    };
  }
  if (key === 'reviewRequired') {
    return {
      issueCategory: '검토 필요',
      suspectedCause: note || '공식 API, DB 원천값, 또는 계산 입력값 중 관리자 확인이 필요한 항목입니다.',
    };
  }
  if (key === 'suspectedError') {
    return {
      issueCategory: '오류 의심',
      suspectedCause: note || '계산값이 비정상 범위에 있거나 원천값 간 충돌이 있어 확인이 필요합니다.',
    };
  }
  return {
    issueCategory: '관리자 검토',
    suspectedCause: note || '검토 기준에 해당하는 행입니다.',
  };
}

function persistAdminReviewDetailRows_(key, rows) {
  try {
    const detailsCache = readPersistedJsonProperty_('ADMIN_REVIEW_DETAILS_JSON') || {};
    detailsCache[key] = (rows || []).slice(0, 50);
    detailsCache.generatedTs = Date.now();
    if (typeof persistJsonScriptProperty_ === 'function') {
      persistJsonScriptProperty_('ADMIN_REVIEW_DETAILS_JSON', detailsCache, { allowChunking: true });
    } else {
      PropertiesService.getScriptProperties().setProperty('ADMIN_REVIEW_DETAILS_JSON', JSON.stringify(detailsCache));
    }
  } catch (error) {
    // Detail modal still renders even if the small cache cannot be saved.
  }
}

function getAdminBacklogDetail(request) {
  assertAdmin_(request);
  const kind = safeString_(request && request.kind);
  const reviewCache = readPersistedJsonProperty_('ADMIN_REVIEW_CACHE_JSON') || {};
  if (kind === 'openDart' && Array.isArray(reviewCache.openDartBacklog)) return { kind: kind, rows: reviewCache.openDartBacklog };
  if (kind === 'building' && Array.isArray(reviewCache.buildingBacklog)) return { kind: kind, rows: reviewCache.buildingBacklog };
  if (kind === 'issueBacklog' && Array.isArray(safeGet_(reviewCache, ['reviewDetails', 'issueBacklog']))) {
    return { kind: kind, rows: safeGet_(reviewCache, ['reviewDetails', 'issueBacklog']) };
  }
  if (kind === 'openDart') return { kind: kind, rows: readAdminCompanyBacklogRows_() };
  if (kind === 'building') return { kind: kind, rows: readAdminAssetBacklogRows_() };
  const model = getAdminModelForDetail_();
  if (kind === 'issueBacklog') return { kind: kind, rows: buildAdminReviewDetails_(getAdminHomePayloadFast_(), model).issueBacklog || [] };
  if (kind === 'audit') return { kind: kind, rows: buildAdminAuditPreview_() };
  return { kind: kind, rows: [] };
}

function getAdminModelForDetail_() {
  const cached = getAdminCachedModelFast_();
  if (cached) return cached;
  try {
    return getModelOrRefreshCache_();
  } catch (error) {
    return null;
  }
}

function getAdminCachedModelFast_() {
  try {
    return getCachedJson_('model:full') || null;
  } catch (error) {
    return null;
  }
}

function buildAdminReviewMetrics_(homePayload) {
  return buildAdminReviewMetrics_(homePayload, null);
}

function buildAdminReviewMetrics_(homePayload, fallbackCounts) {
  const counts = safeGet_(homePayload, ['missingCounts']) || fallbackCounts || {};
  return [
    { key: 'historyUnmatched', label: '히스토리 미연결', value: Number(counts.historyUnmatched || 0), unit: '건' },
    { key: 'rentMissing', label: '임대료 누락', value: Number(counts.rentMissing || 0), unit: '건' },
    { key: 'mfMissing', label: '관리비 누락', value: Number(counts.mfMissing || 0), unit: '건' },
    { key: 'eNocMissing', label: 'E.NOC 누락', value: Number(counts.eNocMissing || 0), unit: '건' },
    { key: 'reviewRequired', label: '검토 필요', value: Number(counts.reviewRequired || 0), unit: '건' },
    { key: 'suspectedError', label: '오류 의심', value: Number(counts.suspectedError || 0), unit: '건' },
  ];
}

function buildAdminReviewCountsFromSheet_() {
  try {
    const rows = readAdminGeneralReviewRows_('__counts__');
    return { available: true, counts: rows.counts || {} };
  } catch (error) {
    return { available: false, counts: {} };
  }
}

function buildAdminReviewSheetSummary_() {
  try {
    const objects = readAdminGeneralSheetProjection_();
    const counts = {
      historyUnmatched: 0,
      rentMissing: 0,
      mfMissing: 0,
      eNocMissing: 0,
      reviewRequired: 0,
      suspectedError: 0,
    };
    const details = {
      historyUnmatched: [],
      rentMissing: [],
      mfMissing: [],
      eNocMissing: [],
      reviewRequired: [],
      suspectedError: [],
    };
    objects.forEach(function (row) {
      const normalized = {
        assetName: row.assetName,
        tenantMasterName: row.tenantMasterName,
        leaseSpaceId: row.leaseSpaceId,
        floorLabel: row.floorLabel,
        detailAreaLabel: row.detailAreaLabel,
        currentEndDate: row.currentEndDate,
        reviewStatus: row.reviewStatus,
        reviewNote: row.reviewNote,
      };
      if (row.historyLinked === false || row.reviewStatus === 'history_unmatched') {
        counts.historyUnmatched += 1;
        if (details.historyUnmatched.length < 50) details.historyUnmatched.push(normalized);
      }
      if (row.rentTotal == null) {
        counts.rentMissing += 1;
        if (details.rentMissing.length < 50) details.rentMissing.push(normalized);
      }
      if (row.mfTotal == null) {
        counts.mfMissing += 1;
        if (details.mfMissing.length < 50) details.mfMissing.push(normalized);
      }
      if (row.eNoc == null) {
        counts.eNocMissing += 1;
        if (details.eNocMissing.length < 50) details.eNocMissing.push(normalized);
      }
      if (row.reviewStatus && row.reviewStatus !== 'ok') {
        counts.reviewRequired += 1;
        if (details.reviewRequired.length < 50) details.reviewRequired.push(normalized);
      }
      if (row.reviewStatus === 'suspected_error') {
        counts.suspectedError += 1;
        if (details.suspectedError.length < 50) details.suspectedError.push(normalized);
      }
    });
    return { available: true, counts: counts, details: details };
  } catch (error) {
    return { available: false, counts: {}, details: {} };
  }
}

function buildAdminReviewDetails_(homePayload, model) {
  const details = {};
  const rows = safeGet_(model, ['generalRows']) || [];
  const issueBacklog = safeGet_(homePayload, ['issueBacklog']) || [];
  details.historyUnmatched = rows.filter(function (row) { return !row.historyLinked; }).slice(0, 50).map(buildAdminGeneralDetailRow_);
  details.rentMissing = rows.filter(function (row) { return row.currentMonthlyRentTotal == null; }).slice(0, 50).map(buildAdminGeneralDetailRow_);
  details.mfMissing = rows.filter(function (row) { return row.currentMonthlyMfTotal == null; }).slice(0, 50).map(buildAdminGeneralDetailRow_);
  details.eNocMissing = rows.filter(function (row) { return row.eNoc == null; }).slice(0, 50).map(buildAdminGeneralDetailRow_);
  details.reviewRequired = rows.filter(function (row) { return row.calculatedReviewStatus && row.calculatedReviewStatus !== 'ok'; }).slice(0, 50).map(buildAdminGeneralDetailRow_);
  details.suspectedError = rows.filter(function (row) { return row.calculatedReviewStatus === 'suspected_error'; }).slice(0, 50).map(buildAdminGeneralDetailRow_);
  details.issueBacklog = issueBacklog.slice(0, 50).map(buildAdminIssueDetailRow_);
  return details;
}

function buildAdminGeneralDetailRow_(row) {
  return {
    assetName: row.assetName || '',
    tenantMasterName: row.tenantMasterName || '',
    leaseSpaceId: row.leaseSpaceId || '',
    floorLabel: row.floorLabel || '',
    detailAreaLabel: row.detailAreaLabel || '',
    currentEndDate: row.currentEndDate || '',
    currentMonthlyRentTotal: row.currentMonthlyRentTotal,
    currentMonthlyMfTotal: row.currentMonthlyMfTotal,
    eNoc: row.eNoc,
    historyLinked: row.historyLinked,
    reviewStatus: row.calculatedReviewStatus || row.reviewStatus || '',
    reviewNote: (row.calculatedReviewNotes || []).join(', ') || row.reviewNote || '',
  };
}

function buildAdminIssueDetailRow_(row) {
  return {
    sheetName: row.sheetName || row.sheet_name || '',
    rowRef: row.rowRef || row.row_ref || '',
    ruleName: row.ruleName || row.rule_name || '',
    severity: row.severity || '',
    message: row.message || row.content || '',
    status: row.status || row.reviewStatus || 'review_required',
  };
}

function buildAdminOpenDartBacklog_(model) {
  const rows = safeGet_(model, ['companyRows']) || [];
  return sortBy_(rows.filter(function (row) {
    return !row.dartCorpCode;
  }), 'tenantMasterName').slice(0, 100);
}

function buildAdminBuildingBacklog_(model) {
  const rows = safeGet_(model, ['assetRows']) || [];
  return sortBy_(rows.filter(function (row) {
    return !(row.sigunguCd && row.bjdongCd);
  }), 'assetName').slice(0, 100);
}

function buildAdminAuditPreview_() {
  const rows = readPersistedJsonProperty_('STATIC_PAYLOAD_SNAPSHOT_ERRORS_JSON');
  return Array.isArray(rows) ? rows.slice(0, 50) : [];
}

function buildAdminUiReconciliationPreview_(model, snapshotState) {
  if (model) return buildUiDataReconciliationSummary_(model);
  return {
    status: 'cached_model_missing',
    okCount: 0,
    reviewCount: 0,
    errorCount: Number(snapshotState.errorCount || 0),
    generatedAt: '',
  };
}

function buildAdminSummaryPayload_(model, homePayload, bootstrap, snapshotState) {
  const reviewCache = buildAdminReviewCache_(model, homePayload);
  return {
    generatedAt: model && model.generatedAt ? model.generatedAt : new Date().toISOString(),
    integrations: safeGet_(bootstrap, ['integrations']) || getMinimalIntegrationStatus_(),
    reviewMetrics: reviewCache.reviewMetrics || [],
    reviewDetails: reviewCache.reviewDetails || {},
    issueBacklogCount: Number(reviewCache.issueBacklogCount || 0),
    openDartBacklogCount: Number(reviewCache.openDartBacklogCount || 0),
    buildingBacklogCount: Number(reviewCache.buildingBacklogCount || 0),
    uiDataReconciliation: {
      status: 'summary_only',
      okCount: 0,
      reviewCount: Number(safeGet_(homePayload, ['missingCounts', 'reviewRequired']) || 0),
      errorCount: Number(safeGet_(homePayload, ['missingCounts', 'suspectedError']) || 0),
      generatedAt: safeGet_(bootstrap, ['generatedAt']) || '',
    },
    auditErrorCount: Number(safeGet_(snapshotState, ['errorCount']) || 0),
  };
}

function buildAdminReviewCache_(model, homePayload) {
  const details = buildAdminReviewDetails_(homePayload, model);
  const openDartBacklog = buildAdminOpenDartBacklog_(model);
  const buildingBacklog = buildAdminBuildingBacklog_(model);
  return {
    generatedAt: model && model.generatedAt ? model.generatedAt : new Date().toISOString(),
    reviewMetrics: buildAdminReviewMetrics_(homePayload),
    reviewDetails: details,
    issueBacklogCount: Number(safeGet_(homePayload, ['issueBacklog', 'length']) || 0),
    openDartBacklogCount: openDartBacklog.length,
    buildingBacklogCount: buildingBacklog.length,
    openDartBacklog: openDartBacklog,
    buildingBacklog: buildingBacklog,
  };
}

function readAdminGeneralReviewRows_(key) {
  const objects = readAdminGeneralSheetProjection_();
  if (key === '__counts__') {
    const counts = {
      historyUnmatched: 0,
      rentMissing: 0,
      mfMissing: 0,
      eNocMissing: 0,
      reviewRequired: 0,
      suspectedError: 0,
    };
    objects.forEach(function (row) {
      if (row.historyLinked === false || row.reviewStatus === 'history_unmatched') counts.historyUnmatched += 1;
      if (row.rentTotal == null) counts.rentMissing += 1;
      if (row.mfTotal == null) counts.mfMissing += 1;
      if (row.eNoc == null) counts.eNocMissing += 1;
      if (row.reviewStatus && row.reviewStatus !== 'ok') counts.reviewRequired += 1;
      if (row.reviewStatus === 'suspected_error') counts.suspectedError += 1;
    });
    return { counts: counts };
  }
  return objects.filter(function (row) {
    if (key === 'historyUnmatched') return row.historyLinked === false || row.reviewStatus === 'history_unmatched';
    if (key === 'rentMissing') return row.rentTotal == null;
    if (key === 'mfMissing') return row.mfTotal == null;
    if (key === 'eNocMissing') return row.eNoc == null;
    if (key === 'reviewRequired') return !!row.reviewStatus && row.reviewStatus !== 'ok';
    if (key === 'suspectedError') return row.reviewStatus === 'suspected_error';
    return false;
  }).slice(0, 50).map(function (row) {
    return {
      assetName: row.assetName,
      tenantMasterName: row.tenantMasterName,
      leaseSpaceId: row.leaseSpaceId,
      floorLabel: row.floorLabel,
      detailAreaLabel: row.detailAreaLabel,
      currentEndDate: row.currentEndDate,
      currentMonthlyRentTotal: row.rentTotal,
      currentMonthlyMfTotal: row.mfTotal,
      eNoc: row.eNoc,
      historyLinked: row.historyLinked,
      reviewStatus: row.reviewStatus,
      reviewNote: row.reviewNote,
    };
  });
}

function readAdminGeneralSheetProjection_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.general);
  if (!sheet) return [];
  return readSheetProjection_(sheet, {
    assetName: ['asset_name', 'assetName', '자산명'],
    tenantMasterName: ['tenant_master_name', 'tenantMasterName', '임차인명'],
    leaseSpaceId: ['lease_space_id', 'leaseSpaceId'],
    floorLabel: ['floor_label', 'floorLabel', '임차 층'],
    detailAreaLabel: ['detail_area_label', 'detailAreaLabel', '임차 세부 구역'],
    currentEndDate: ['current_end_date', 'currentEndDate', '현재 계약만기일'],
    historyLinked: ['history_linked', 'historyLinked', '히스토리 연결여부'],
    rentTotal: ['current_monthly_rent_total', 'currentMonthlyRentTotal', '현재 월임대료 총액', '월임대료 총액'],
    mfTotal: ['current_monthly_mf_total', 'currentMonthlyMfTotal', '현재 월관리비 총액', '월관리비 총액'],
    eNoc: ['e_noc', 'eNoc', 'E.NOC', 'e_noc_v2'],
    reviewStatus: ['calculated_review_status', 'calculatedReviewStatus', 'review_status', 'reviewStatus'],
    reviewNote: ['calculated_review_notes', 'calculatedReviewNotes', 'review_note', 'reviewNote'],
  }).map(function (row) {
    return {
      assetName: row.assetName || '',
      tenantMasterName: row.tenantMasterName || '',
      leaseSpaceId: row.leaseSpaceId || '',
      floorLabel: row.floorLabel || '',
      detailAreaLabel: row.detailAreaLabel || '',
      currentEndDate: row.currentEndDate || '',
      historyLinked: readAdminBooleanFieldValue_(row.historyLinked),
      rentTotal: toNumber_(row.rentTotal),
      mfTotal: toNumber_(row.mfTotal),
      eNoc: toNumber_(row.eNoc),
      reviewStatus: normalizeWhitespace_(row.reviewStatus),
      reviewNote: row.reviewNote || '',
    };
  });
}

function readAdminCompanyBacklogRows_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.company);
  if (!sheet) return [];
  return readSheetProjection_(sheet, {
    tenantMasterName: ['tenant_master_name', 'tenantMasterName', '기업명', '임차인명'],
    businessRegistrationNo: ['business_registration_no', 'businessRegistrationNo', '사업자번호', '임차인 사업자번호'],
    dartCorpCode: ['dart_corp_code', 'dartCorpCode'],
    reviewStatus: ['review_status', 'reviewStatus'],
    reviewNote: ['review_note', 'reviewNote'],
  }).filter(function (row) {
    return !normalizeWhitespace_(row.dartCorpCode) || normalizeWhitespace_(row.reviewStatus) === 'review_required';
  }).slice(0, 100).map(function (row) {
    return {
      tenantMasterName: row.tenantMasterName || '',
      businessRegistrationNo: row.businessRegistrationNo || '',
      reviewStatus: row.reviewStatus || '',
      reviewNote: row.reviewNote || '',
    };
  });
}

function readAdminAssetBacklogRows_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.asset);
  if (!sheet) return [];
  return readSheetProjection_(sheet, {
    assetName: ['asset_name', 'assetName', '자산명'],
    standardizedAddress: ['standardized_address', 'standardizedAddress', '주소', '도로명주소'],
    sigunguCd: ['sigunguCd'],
    bjdongCd: ['bjdongCd'],
    reviewStatus: ['review_status', 'reviewStatus'],
    reviewNote: ['review_note', 'reviewNote'],
  }).filter(function (row) {
    const sigunguCd = normalizeWhitespace_(row.sigunguCd);
    const bjdongCd = normalizeWhitespace_(row.bjdongCd);
    return !(sigunguCd && bjdongCd) || normalizeWhitespace_(row.reviewStatus) === 'review_required';
  }).slice(0, 100).map(function (row) {
    return {
      assetName: row.assetName || '',
      standardizedAddress: row.standardizedAddress || '',
      reviewStatus: row.reviewStatus || '',
      reviewNote: row.reviewNote || '',
    };
  });
}

function readAdminIssueBacklogRows_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.issue);
  if (!sheet) return [];
  return readSheetProjection_(sheet, {
    resolved: ['resolved', 'is_resolved', '해결여부'],
    sheetName: ['sheet_name', 'sheetName', '시트명'],
    rowRef: ['row_ref', 'rowRef', '행번호'],
    ruleName: ['rule_name', 'ruleName', '규칙명'],
    severity: ['severity', '심각도'],
    message: ['message', 'content', '이슈내용'],
    status: ['status', 'review_status', 'reviewStatus'],
  }).filter(function (row) {
    return !readAdminBooleanFieldValue_(row.resolved);
  }).slice(0, 100).map(function (row) {
    return {
      sheetName: row.sheetName || '',
      rowRef: row.rowRef || '',
      ruleName: row.ruleName || '',
      severity: row.severity || '',
      message: row.message || '',
      status: row.status || 'review_required',
    };
  });
}

function readSheetProjection_(sheet, fieldMap) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(function (value) {
    return safeString_(value);
  });
  const rowCount = lastRow - 1;
  const fieldNames = Object.keys(fieldMap || {});
  const indexMap = {};
  fieldNames.forEach(function (fieldName) {
    indexMap[fieldName] = findSheetColumnIndex_(headers, fieldMap[fieldName]);
  });
  const columnValues = {};
  fieldNames.forEach(function (fieldName) {
    var columnIndex = indexMap[fieldName];
    columnValues[fieldName] = columnIndex > -1
      ? sheet.getRange(2, columnIndex + 1, rowCount, 1).getDisplayValues().map(function (row) { return row[0]; })
      : new Array(rowCount).fill('');
  });
  var output = new Array(rowCount);
  for (var rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    var item = {};
    fieldNames.forEach(function (fieldName) {
      item[fieldName] = columnValues[fieldName][rowIndex];
    });
    output[rowIndex] = item;
  }
  return output;
}

function findSheetColumnIndex_(headers, candidates) {
  for (var i = 0; i < candidates.length; i += 1) {
    var found = headers.indexOf(candidates[i]);
    if (found > -1) return found;
  }
  return -1;
}

function readAdminNumberField_(row, candidates) {
  return toNumber_(pickField_(row, candidates));
}

function readAdminBooleanField_(row, candidates) {
  const raw = pickField_(row, candidates);
  return readAdminBooleanFieldValue_(raw);
}

function readAdminBooleanFieldValue_(raw) {
  if (raw === '' || raw == null) return null;
  const text = normalizeWhitespace_(raw).toUpperCase();
  if (['TRUE', 'Y', 'YES', '1'].indexOf(text) > -1) return true;
  if (['FALSE', 'N', 'NO', '0'].indexOf(text) > -1) return false;
  return null;
}

function getAdminMinimalIntegrations_() {
  try {
    return {
      openDart: buildOpenDartIntegrationStatus_(null),
      buildingHub: buildBuildingHubIntegrationStatus_(null),
      naverMaps: buildNaverMapsIntegrationStatus_(),
    };
  } catch (error) {
    return {
      openDart: { ready: false, lastFailureMessage: safeString_(error && error.message) },
      buildingHub: { ready: false, lastFailureMessage: safeString_(error && error.message) },
      naverMaps: { ready: false, lastFailureMessage: safeString_(error && error.message) },
    };
  }
}

function getAdminMinimalDeploymentInfo_() {
  const config = getConfig_();
  return {
    currentChannel: config.releaseChannel,
    routes: {
      user: config.mainWebAppUrl ? config.mainWebAppUrl + '?page=user' : '',
      admin: config.mainWebAppUrl ? config.mainWebAppUrl + '?page=admin' : '',
      qaUser: config.qaWebAppUrl ? config.qaWebAppUrl + '?page=user' : '',
    },
    webapp: {
      manifestAccess: config.manifestWebappAccess || 'DOMAIN',
      executeAs: 'USER_DEPLOYING',
      mainConfiguredAccess: config.mainWebappAccess,
      qaConfiguredAccess: config.qaWebappAccess,
    },
  };
}

function getAdminCachedModel_(errors) {
  try {
    const model = getCachedJson_('model:full');
    if (model) return model;
    if (errors) errors.push({ area: 'model', message: '캐시된 모델이 없어 관리자 화면은 경량 상태로 열렸습니다. 계산 갱신 또는 9시 스냅샷 갱신을 실행하세요.' });
  } catch (error) {
    if (errors) errors.push(buildAdminLoadError_('model', error));
  }
  return null;
}

function getAdminBootstrapState_(errors) {
  try {
    return safeGet_(buildBootstrapShell_(), ['bootstrapState']) || {};
  } catch (error) {
    if (errors) errors.push(buildAdminLoadError_('bootstrapState', error));
    return {};
  }
}

function buildAdminLoadError_(area, error) {
  return {
    area: area,
    message: safeString_(error && error.message) || String(error),
  };
}

function getStaticPayloadSnapshotState_() {
  const props = PropertiesService.getScriptProperties();
  const updatedTs = Number(props.getProperty('STATIC_PAYLOAD_SNAPSHOT_UPDATED_TS') || 0);
  return {
    updatedTs: updatedTs,
    updatedAt: updatedTs ? formatRuntimeTimestamp_(updatedTs) : '',
    assetCount: Number(props.getProperty('STATIC_PAYLOAD_SNAPSHOT_ASSET_COUNT') || 0),
    companyCount: Number(props.getProperty('STATIC_PAYLOAD_SNAPSHOT_COMPANY_COUNT') || 0),
    errorCount: Number(props.getProperty('STATIC_PAYLOAD_SNAPSHOT_ERROR_COUNT') || 0),
    durationMs: Number(props.getProperty('STATIC_PAYLOAD_SNAPSHOT_DURATION_MS') || 0),
    recordCount: Number(props.getProperty('STATIC_PAYLOAD_SNAPSHOT_RECORD_COUNT') || 0),
    chunkCount: Number(props.getProperty('STATIC_PAYLOAD_SNAPSHOT_CHUNK_COUNT') || 0),
    refreshHour: getConfig_().dailySnapshotRefreshHour,
  };
}

function getAdminJobStates_() {
  const props = PropertiesService.getScriptProperties();
  function read(key) {
    return {
      status: safeString_(props.getProperty(`ADMIN_JOB_${key}_STATUS`)),
      queuedAt: formatRuntimeTimestamp_(Number(props.getProperty(`ADMIN_JOB_${key}_QUEUED_AT`) || 0)),
      finishedAt: formatRuntimeTimestamp_(Number(props.getProperty(`ADMIN_JOB_${key}_FINISHED_AT`) || 0)),
      message: safeString_(props.getProperty(`ADMIN_JOB_${key}_MESSAGE`)),
    };
  }
  return {
    refresh: read('REFRESH'),
    snapshot: read('SNAPSHOT'),
    openDart: read('OPEN_DART'),
    building: read('BUILDING'),
  };
}

function getUiDataReconciliationReport(request) {
  assertAdmin_(request);
  return buildUiDataReconciliationReport_(getModelOrRefreshCache_(), { includeRows: true });
}

function adminRunUiDataReconciliation(request) {
  assertAdmin_(request);
  const report = buildUiDataReconciliationReport_(getModelOrRefreshCache_(), { includeRows: true });
  writeUiDataReconciliationSheet_(report);
  return report;
}

function adminRefreshDashboardSnapshot(request) {
  assertAdmin_(request);
  return queueAdminOneShotJob_('runQueuedAdminRefreshSnapshot', 'SNAPSHOT', 5000);
}

function getDeploymentInfo() {
  const config = getConfig_();
  const qaRoutingStatus = resolveQaRoutingStatus_(config);
  return {
    currentChannel: config.releaseChannel,
    qaRoutingStatus: qaRoutingStatus,
    webapp: {
      manifestAccess: config.manifestWebappAccess || 'DOMAIN',
      executeAs: 'USER_DEPLOYING',
      mainConfiguredAccess: config.mainWebappAccess,
      qaConfiguredAccess: config.qaWebappAccess,
      mainEffectiveAccess: resolveEffectiveWebappAccess_('main', config),
      qaEffectiveAccess: resolveEffectiveWebappAccess_('qa', config),
      queryParam: config.deploymentQueryParam,
    },
    projects: {
      mainWebappUrlConfigured: !!safeString_(config.mainWebappUrl),
      qaWebappUrlConfigured: !!safeString_(config.qaWebappUrl),
      qaScriptIdConfigured: !!safeString_(config.qaScriptId),
      qaRequestedMode: normalizeQaRoutingMode_(config.qaRoutingMode),
      qaEffectiveMode: qaRoutingStatus,
      qaAccessIsolationReady: qaRoutingStatus === 'separate_project',
    },
    routes: {
      mainUser: buildDeploymentRoute_('user', 'main'),
      mainAdmin: buildDeploymentRoute_('admin', 'main'),
      qaUser: buildDeploymentRoute_('user', 'qa'),
      qaAdmin: buildDeploymentRoute_('admin', 'qa'),
    },
    mapCredentials: {
      naverMapsConfigured: !!(config.naverMapsClientId && config.naverMapsClientSecret),
      naverStaticMapKeyConfigured: !!safeString_(config.naverStaticMapKeyId || config.naverMapsClientId),
      usesServerGeocoding: !!config.enableServerGeocoding,
      runtimeClientConfigReady: !!safeString_(config.naverMapsClientId),
      allowedOriginHints: getNaverMapsAllowedOriginHints_(config),
      dynamicSdkUrlPattern: 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId={NAVER_MAPS_CLIENT_ID}&callback=__dashboardNaverMapsSdkReady',
    },
    spreadsheetId: config.spreadsheetId,
    scriptProperties: [
      'SPREADSHEET_ID',
      'OPENDART_API_KEY',
      'BUILDING_REGISTER_API_KEY_ENCODED',
      'BUILDING_REGISTER_API_KEY_DECODED',
      'NAVER_MAPS_CLIENT_ID',
      'NAVER_STATIC_MAP_KEY_ID',
      'NAVER_MAPS_CLIENT_SECRET',
      'ENABLE_SERVER_GEOCODING',
      'FORMULA_VERSION',
      'CACHE_TTL_SECONDS',
      'RELEASE_CHANNEL',
      'DEPLOYMENT_QUERY_PARAM',
      'MANIFEST_WEBAPP_ACCESS',
      'MAIN_WEBAPP_ACCESS',
      'QA_WEBAPP_ACCESS',
      'QA_ROUTING_MODE',
      'MAIN_WEBAPP_URL',
      'QA_WEBAPP_URL',
      'QA_SCRIPT_ID',
      'ADMIN_EMAILS',
    ],
    triggers: [
      { functionName: 'scheduledRefreshCalculationSheet', cadence: 'Daily 01:00' },
      { functionName: 'scheduledSyncOpenDartData', cadence: 'Daily 02:00' },
      { functionName: 'scheduledSyncBuildingRegisterData', cadence: 'Daily 03:00' },
      { functionName: 'scheduledRunDataAudit', cadence: 'Daily 04:00' },
    ],
  };
}

function getAssetOptions() {
  const cacheKey = 'asset-options:full';
  const cached = getCachedJson_(cacheKey);
  if (cached) return cached;
  const persisted = readPersistedJsonProperty_('ASSET_OPTIONS_JSON');
  if (persisted) {
    putCachedJson_(cacheKey, persisted, getConfig_().payloadCacheTtlSeconds);
    return persisted;
  }
  const model = getModelOrRefreshCache_();
  const options = buildAssetOptionList_(model);
  if (typeof persistJsonScriptProperty_ === 'function') {
    persistJsonScriptProperty_('ASSET_OPTIONS_JSON', options, { allowChunking: true });
  }
  return putCachedJson_(cacheKey, options, getConfig_().payloadCacheTtlSeconds);
}

function getCompanyOptions() {
  const cacheKey = 'company-options:full';
  const cached = getCachedJson_(cacheKey);
  if (cached) return cached;
  const persisted = readPersistedJsonProperty_('COMPANY_OPTIONS_JSON');
  if (persisted) {
    putCachedJson_(cacheKey, persisted, getConfig_().payloadCacheTtlSeconds);
    return persisted;
  }
  const model = getModelOrRefreshCache_();
  const options = buildCompanyOptionList_(model);
  if (typeof persistJsonScriptProperty_ === 'function') {
    persistJsonScriptProperty_('COMPANY_OPTIONS_JSON', options, { allowChunking: true });
  }
  return putCachedJson_(cacheKey, options, getConfig_().payloadCacheTtlSeconds);
}

function isBootstrapPayloadFresh_(payload) {
  if (!payload) return false;
  const dataVersion = safeString_(payload.dataVersion);
  if (!dataVersion || dataVersion === '0' || dataVersion === '1') return false;
  const homeLite = payload.homeLiteKpis || [];
  const homeLiteKeys = homeLite.map(function (item) { return safeString_(item && item.key); });
  if (homeLiteKeys.indexOf('operating_asset_count') === -1) return false;
  if (homeLiteKeys.indexOf('leased_area_total') === -1) return false;
  if (homeLiteKeys.indexOf('vacancy_area_total') === -1) return false;
  if (homeLiteKeys.indexOf('monthly_total_cost') === -1) return false;
  const defaults = payload.defaults || {};
  return !!(defaults.assetId && defaults.tenantId);
}

function isHomePayloadFresh_(payload) {
  if (!payload) return false;
  const kpiKeys = (payload.kpis || []).map(function (item) { return safeString_(item && item.key); });
  if (kpiKeys.indexOf('operating_asset_count') === -1) return false;
  if (kpiKeys.indexOf('leased_area_total') === -1) return false;
  if (kpiKeys.indexOf('vacancy_area_total') === -1) return false;
  if (kpiKeys.indexOf('monthly_total_cost') === -1) return false;
  if (!payload.occupancy) return false;
  const mapPoints = payload.mapPoints || [];
  if (mapPoints.length && !mapPoints.some(function (point) { return safeString_(point.address); })) return false;
  return true;
}

function buildViewerPayloadCacheKey_(cacheKey) {
  return 'viewer:public:' + safeString_(cacheKey);
}

function getCachedPayloadForViewer_(cacheKey, viewer) {
  if (!cacheKey || (viewer && viewer.isAdmin)) return null;
  return getCachedJson_(buildViewerPayloadCacheKey_(cacheKey));
}

function returnPayloadForViewer_(payload, viewer, cacheKey) {
  if (!payload || (viewer && viewer.isAdmin) || !cacheKey) {
    return sanitizePayloadForViewer_(payload, viewer);
  }
  const publicCacheKey = buildViewerPayloadCacheKey_(cacheKey);
  const cached = getCachedJson_(publicCacheKey);
  if (cached) return cached;
  const sanitized = sanitizePayloadForViewer_(payload, viewer);
  putCachedJson_(publicCacheKey, sanitized, getConfig_().payloadCacheTtlSeconds);
  return sanitized;
}

function sanitizePayloadForViewer_(payload, viewer) {
  if (!payload || (viewer && viewer.isAdmin)) return payload;
  const clone = JSON.parse(JSON.stringify(payload));
  stripInternalFieldsForUser_(clone);
  if (clone.issueBacklogCount != null) clone.issueBacklogCount = 0;
  return clone;
}

function stripInternalFieldsForUser_(value) {
  if (Array.isArray(value)) {
    value.forEach(stripInternalFieldsForUser_);
    return value;
  }
  if (!value || typeof value !== 'object') return value;

  [
    'missingCounts',
    'issueBacklog',
    'reviewBacklog',
    'reviewHighlights',
    'cautionItems',
    'dataQuality',
    'reviewStatus',
    'reviewNote',
    'reviewNotes',
    'calculatedReviewStatus',
    'calculatedReviewNotes',
    'buildingBacklog',
    'openDartBacklog',
    'auditRows',
    'triggers'
  ].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(value, key)) delete value[key];
  });

  if (Array.isArray(value.kpis)) {
    value.kpis = value.kpis.filter(function (item) {
      return safeString_(item && item.key) !== 'review_backlog';
    });
  }

  if (value.meta && value.meta.missingCounts) delete value.meta.missingCounts;

  Object.keys(value).forEach(function (key) {
    stripInternalFieldsForUser_(value[key]);
  });
  return value;
}

function getApiAuthorizationStatus_() {
  try {
    const authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    return {
      status: String(authInfo.getAuthorizationStatus()),
      authorizationUrl: authInfo.getAuthorizationUrl ? authInfo.getAuthorizationUrl() : '',
    };
  } catch (error) {
    return {
      status: 'UNKNOWN',
      authorizationUrl: '',
      error: safeString_(error && error.message),
    };
  }
}

function getNaverStaticMapDataUrl(request) {
  const config = getConfig_();
  const clientId = safeString_(config.naverStaticMapKeyId || config.naverMapsClientId);
  const clientSecret = safeString_(config.naverMapsClientSecret);
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      message: 'NAVER Maps client id or client secret is missing.',
    };
  }

  const points = ((request && request.points) || []).map(function (point, index) {
    const latitude = Number(point && point.latitude);
    const longitude = Number(point && point.longitude);
    if (!isFinite(latitude) || !isFinite(longitude)) return null;
    return {
      latitude: latitude,
      longitude: longitude,
      markerIndex: index + 1,
    };
  }).filter(Boolean).slice(0, 20);

  if (!points.length) {
    return {
      ok: false,
      message: 'No valid map coordinates.',
    };
  }

  const width = Math.max(320, Math.min(1024, Math.round(Number(request && request.width) || 920)));
  const height = Math.max(280, Math.min(640, Math.round(Number(request && request.height) || 420)));
  const latitudes = points.map(function (point) { return point.latitude; });
  const longitudes = points.map(function (point) { return point.longitude; });
  const minLat = Math.min.apply(null, latitudes);
  const maxLat = Math.max.apply(null, latitudes);
  const minLng = Math.min.apply(null, longitudes);
  const maxLng = Math.max.apply(null, longitudes);
  const latSpan = Math.max(maxLat - minLat, 0.02);
  const lngSpan = Math.max(maxLng - minLng, 0.02);
  const span = Math.max(latSpan, lngSpan);
  let level = 14;
  if (span > 5) level = 6;
  else if (span > 2) level = 7;
  else if (span > 1) level = 8;
  else if (span > 0.45) level = 9;
  else if (span > 0.22) level = 10;
  else if (span > 0.12) level = 11;
  else if (span > 0.06) level = 12;
  else if (span > 0.03) level = 13;

  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const markerPositions = points.map(function (point) {
    return point.longitude + ' ' + point.latitude;
  }).join(',');
  const params = [
    'w=' + encodeURIComponent(String(width)),
    'h=' + encodeURIComponent(String(height)),
    'center=' + encodeURIComponent(centerLng + ',' + centerLat),
    'level=' + encodeURIComponent(String(level)),
    'scale=2',
    'lang=ko',
    'markers=' + encodeURIComponent('type:d|size:mid|color:blue|pos:' + markerPositions),
  ];
  const requestUrl = 'https://maps.apigw.ntruss.com/map-static/v2/raster?' + params.join('&');

  try {
    const response = UrlFetchApp.fetch(requestUrl, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
      },
    });
    const status = response.getResponseCode();
    const contentType = safeString_(response.getHeaders()['Content-Type'] || response.getHeaders()['content-type']) || 'image/png';
    if (status < 200 || status >= 300 || contentType.indexOf('image/') !== 0) {
      return {
        ok: false,
        status: status,
        message: response.getContentText().slice(0, 500),
        requestUrl: requestUrl,
      };
    }
    return {
      ok: true,
      dataUrl: 'data:' + contentType + ';base64,' + Utilities.base64Encode(response.getBlob().getBytes()),
      requestUrl: requestUrl,
      status: status,
    };
  } catch (error) {
    return {
      ok: false,
      message: safeString_(error && error.message) || String(error),
      requestUrl: requestUrl,
    };
  }
}

function buildUiDataReconciliationSummary_(model) {
  const assetCount = Object.keys(model.assetSummaryById || {}).length;
  const companyCount = Object.keys(model.companySummaryById || {}).length;
  const rowCount = (model.generalRows || []).length;
  const eNocOutlierCount = buildENocOutlierRows_(model, new Date().toISOString()).length;
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      total: assetCount * 5 + companyCount * 3 + 5 + eNocOutlierCount,
      ok: null,
      displayRounding: null,
      sourceMissing: null,
      formulaDifference: null,
      apiNoResponse: null,
      reviewRequired: eNocOutlierCount,
    },
    scope: {
      homeKpiCount: 5,
      assetCount: assetCount,
      companyCount: companyCount,
      leaseRowCount: rowCount,
    },
    eNocOutlierCount: eNocOutlierCount,
    prioritySamples: [],
  };
}

function buildUiDataReconciliationReport_(model, options) {
  const includeRows = safeGet_(options || {}, ['includeRows']) === true;
  const rows = [];
  const generatedAt = new Date().toISOString();
  const areaTol = 0.01;
  const currencyTol = 1;
  const percentTol = 0.001;

  function add(area, itemId, itemName, sourceValue, payloadValue, tolerance, unit, note) {
    rows.push(buildReconRow_(generatedAt, area, itemId, itemName, sourceValue, payloadValue, tolerance, unit, note));
  }

  const home = buildHomePayload_(model);
  const homeKpis = indexBy_(home.kpis || [], 'key');
  const assetSummaries = Object.keys(model.assetSummaryById || {}).map(function (assetId) {
    return model.assetSummaryById[assetId];
  });
  const grossTotal = sumRecon_(assetSummaries, 'grossFloorAreaSqm');
  const leasedTotal = sumRecon_(assetSummaries, 'leasedAreaSqm');
  const vacancyTotal = sumRecon_(assetSummaries, 'vacancyAreaSqm');
  const monthlyTotal = sumRecon_(model.generalRows || [], function (row) { return row.currentMonthlyCostTotal; });
  add('Home KPI', 'operating_asset_count', 'operating asset count', assetSummaries.length, safeGet_(homeKpis, ['operating_asset_count', 'value']), 0, 'count', 'DB asset summary count vs Home payload');
  add('Home KPI', 'leased_area_total', 'leased area total', leasedTotal, safeGet_(homeKpis, ['leased_area_total', 'value']), areaTol, 'sqm', 'DB asset leased sum vs Home payload');
  add('Home KPI', 'vacancy_area_total', 'vacancy area total', vacancyTotal, safeGet_(homeKpis, ['vacancy_area_total', 'value']), areaTol, 'sqm', 'DB asset vacancy sum vs Home payload');
  add('Home KPI', 'monthly_total_cost', 'monthly total cost', monthlyTotal, safeGet_(homeKpis, ['monthly_total_cost', 'value']), currencyTol, 'krw', 'DB general current monthly cost sum vs Home payload');
  add('Home KPI', 'vacancy_rate', 'vacancy rate', safeDivideRecon_(vacancyTotal, grossTotal), safeGet_(homeKpis, ['vacancy_rate', 'value']), percentTol, 'ratio', 'vacancy area / gross area');

  assetSummaries.forEach(function (summary) {
    const assetPayload = buildAssetPayload_(model, summary.assetId);
    const assetKpis = indexBy_(assetPayload.kpis || [], 'key');
    const assetRows = (model.generalRows || []).filter(function (row) { return row.assetId === summary.assetId; });
    add('Asset KPI', summary.assetId + ':leased_area_total', summary.assetName + ' leased area', summary.leasedAreaSqm, safeGet_(assetKpis, ['leased_area_total', 'value']), areaTol, 'sqm', 'asset summary vs asset payload');
    add('Asset KPI', summary.assetId + ':vacancy_area_total', summary.assetName + ' vacancy area', summary.vacancyAreaSqm, safeGet_(assetKpis, ['vacancy_area_total', 'value']), areaTol, 'sqm', 'asset summary vs asset payload');
    add('Asset KPI', summary.assetId + ':monthly_total_cost', summary.assetName + ' monthly cost', summary.monthlyCostTotal, safeGet_(assetKpis, ['monthly_total_cost', 'value']), currencyTol, 'krw', 'asset summary vs asset payload');
    add('Asset KPI', summary.assetId + ':unique_tenant_count', summary.assetName + ' unique tenants', countUniqueRecon_(assetRows, 'tenantId'), safeGet_(assetKpis, ['unique_tenant_count', 'value']), 0, 'count', 'unique tenant count from DB general rows');
    add('Asset E.NOC', summary.assetId + ':average_e_noc', summary.assetName + ' effective E.NOC', computeEffectiveENocRecon_(assetRows), safeGet_(assetKpis, ['average_e_noc', 'value']), currencyTol, 'krw_per_py', 'total monthly cost / total leased py');
  });

  Object.keys(model.companySummaryById || {}).forEach(function (tenantId) {
    const summary = model.companySummaryById[tenantId];
    const companyPayload = buildCompanyPayload_(model, tenantId);
    const companyKpis = indexBy_(companyPayload.kpis || [], 'key');
    const companyRows = (model.generalRows || []).filter(function (row) { return row.tenantId === tenantId; });
    add('Company KPI', tenantId + ':asset_count', summary.tenantMasterName + ' asset count', countUniqueRecon_(companyRows, 'assetId'), safeGet_(companyKpis, ['asset_count', 'value']), 0, 'count', 'unique asset count from DB general rows');
    add('Company KPI', tenantId + ':leased_area', summary.tenantMasterName + ' leased area', sumRecon_(companyRows, 'leasedAreaSqm'), safeGet_(companyKpis, ['leased_area', 'value']), areaTol, 'sqm', 'DB general rows vs company payload');
    add('Company KPI', tenantId + ':monthly_total_cost', summary.tenantMasterName + ' monthly cost', sumRecon_(companyRows, function (row) { return row.currentMonthlyCostTotal; }), safeGet_(companyKpis, ['monthly_total_cost', 'value']), currencyTol, 'krw', 'DB general rows vs company payload');
  });

  const eNocRows = buildENocOutlierRows_(model, generatedAt);
  const allRows = rows.concat(eNocRows);
  const totals = summarizeReconRows_(allRows);
  return {
    generatedAt: generatedAt,
    totals: totals,
    rows: includeRows ? allRows : [],
    eNocOutlierCount: eNocRows.length,
    prioritySamples: allRows.filter(function (row) { return row.status !== 'ok' && row.status !== 'display_rounding'; }).slice(0, 20),
  };
}

function buildReconRow_(generatedAt, area, itemId, itemName, sourceValue, payloadValue, tolerance, unit, note) {
  const sourceNumber = toReconNumber_(sourceValue);
  const payloadNumber = toReconNumber_(payloadValue);
  let status = 'ok';
  let delta = null;
  let deltaRate = null;
  if (sourceNumber == null && payloadNumber == null) {
    status = 'source_missing';
  } else if (sourceNumber == null || payloadNumber == null) {
    status = 'review_required';
  } else {
    delta = roundNumber_(payloadNumber - sourceNumber, 6);
    deltaRate = sourceNumber ? roundNumber_(delta / sourceNumber, 6) : null;
    if (Math.abs(delta) <= Number(tolerance || 0)) status = Math.abs(delta) > 0 ? 'display_rounding' : 'ok';
    else status = 'formula_difference';
  }
  return {
    generatedAt: generatedAt,
    area: area,
    itemId: itemId,
    itemName: itemName,
    status: status,
    sourceValue: sourceNumber,
    payloadValue: payloadNumber,
    delta: delta,
    deltaRate: deltaRate,
    tolerance: tolerance,
    unit: unit,
    note: note || '',
  };
}

function buildENocOutlierRows_(model, generatedAt) {
  return (model.generalRows || []).map(function (row) {
    const recomputed = computeENoc_(row, {
      rentPerPy: row.currentRentPerPy,
      mfPerPy: row.currentMfPerPy,
    }, getConfig_());
    const stored = toReconNumber_(row.eNoc);
    const recalculated = toReconNumber_(recomputed.value);
    const delta = stored == null || recalculated == null ? null : roundNumber_(stored - recalculated, 6);
    const deltaRate = recalculated ? roundNumber_(delta / recalculated, 6) : null;
    const reasons = [];
    if (stored == null || stored === 0) reasons.push('zero_or_null');
    if (stored != null && stored < 1000) reasons.push('below_1000');
    if (stored != null && stored > 100000) reasons.push('above_100000');
    if (delta != null && Math.abs(delta) > 1000) reasons.push('absolute_variance_over_1000');
    if (deltaRate != null && Math.abs(deltaRate) > 0.05) reasons.push('variance_over_5pct');
    if (row.leasedAreaSqm == null || row.leasedAreaSqm === 0) reasons.push('leased_area_missing');
    if (row.currentRentPerPy == null || row.currentMfPerPy == null) reasons.push('latest_history_money_missing');
    const normalizedExclusiveRatio = normalizeExclusiveRatio_(row.exclusiveRatio, row.exclusiveAreaSqm, row.leasedAreaSqm);
    if (normalizedExclusiveRatio == null || normalizedExclusiveRatio <= 0 || normalizedExclusiveRatio > 1) reasons.push('exclusive_ratio_invalid');
    if (!reasons.length) return null;
    return {
      generatedAt: generatedAt,
      area: 'Asset E.NOC Row',
      itemId: row.leaseSpaceId || row.contractId || row.assetId + ':' + row.tenantId,
      itemName: [row.assetName, row.tenantMasterName, row.floorLabel, row.detailAreaLabel].filter(Boolean).join(' / '),
      status: 'review_required',
      sourceValue: stored,
      payloadValue: recalculated,
      delta: delta,
      deltaRate: deltaRate,
      tolerance: 1,
      unit: 'krw_per_py',
      note: reasons.join(', '),
    };
  }).filter(Boolean);
}

function summarizeReconRows_(rows) {
  const counts = {};
  (rows || []).forEach(function (row) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  });
  return {
    total: (rows || []).length,
    ok: counts.ok || 0,
    displayRounding: counts.display_rounding || 0,
    sourceMissing: counts.source_missing || 0,
    formulaDifference: counts.formula_difference || 0,
    apiNoResponse: counts.api_no_response || 0,
    reviewRequired: counts.review_required || 0,
  };
}

function writeUiDataReconciliationSheet_(report) {
  const spreadsheet = getSpreadsheet_();
  const sheetName = 'AUDIT_UI_DATA_RECON';
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  const headers = ['generated_at', 'area', 'item_id', 'item_name', 'status', 'source_value', 'payload_value', 'delta', 'delta_rate', 'tolerance', 'unit', 'note'];
  const values = [headers].concat((report.rows || []).map(function (row) {
    return [row.generatedAt, row.area, row.itemId, row.itemName, row.status, row.sourceValue, row.payloadValue, row.delta, row.deltaRate, row.tolerance, row.unit, row.note];
  }));
  sheet.clearContents();
  if (values.length) sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
}

function sumRecon_(rows, selector) {
  let total = 0;
  let found = false;
  (rows || []).forEach(function (row) {
    const value = typeof selector === 'function' ? selector(row) : row[selector];
    const number = toReconNumber_(value);
    if (number != null) {
      total += number;
      found = true;
    }
  });
  return found ? roundNumber_(total, 6) : null;
}

function safeDivideRecon_(numerator, denominator) {
  const left = toReconNumber_(numerator);
  const right = toReconNumber_(denominator);
  if (left == null || right == null || right === 0) return null;
  return roundNumber_(left / right, 6);
}

function computeEffectiveENocRecon_(rows) {
  const leasedAreaSqm = sumRecon_(rows || [], 'leasedAreaSqm');
  const monthlyCostTotal = sumRecon_(rows || [], function (row) { return row.currentMonthlyCostTotal; });
  const leasedAreaPy = safeDivideRecon_(leasedAreaSqm, getConfig_().areaSqmPerPy);
  if (monthlyCostTotal == null || leasedAreaPy == null || leasedAreaPy <= 0) return null;
  return roundNumber_(monthlyCostTotal / leasedAreaPy, 2);
}

function countUniqueRecon_(rows, field) {
  const seen = {};
  (rows || []).forEach(function (row) {
    const value = safeString_(row && row[field]);
    if (value) seen[value] = true;
  });
  return Object.keys(seen).length;
}

function toReconNumber_(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return isFinite(number) ? number : null;
}
