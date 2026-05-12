const CACHE_SCHEMA_VERSION_ = '20260429_198';
const SCRIPT_PROPERTY_JSON_MAX_LENGTH_ = 8500;
const SCRIPT_PROPERTY_JSON_CHUNK_SIZE_ = 8000;
const PAYLOAD_SNAPSHOT_SHEET_NAME_ = 'SYS_PAYLOAD_SNAPSHOT';
const PAYLOAD_SNAPSHOT_CHUNK_SIZE_ = 45000;
const DASHBOARD_CACHE_LOG_KEY_ = 'dashboard:cache:last-event';
const DASHBOARD_CACHE_LOG_TTL_SECONDS_ = 21600;

function isDashboardDebugMode_() {
  return getConfig_().debugMode === true;
}

function logDashboardPerfEvent_(functionName, stageName, durationMs, details) {
  if (!isDashboardDebugMode_()) return;
  const payload = {
    scope: 'dashboard_perf',
    functionName: safeString_(functionName),
    stage: safeString_(stageName),
    durationMs: Math.round(Number(durationMs || 0)),
    at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
    details: details || {},
  };
  console.log(JSON.stringify(payload));
}

function measureDashboardStage_(functionName, stageName, callback, details) {
  const startedAt = Date.now();
  try {
    const result = callback();
    logDashboardPerfEvent_(functionName, stageName, Date.now() - startedAt, details);
    return result;
  } catch (error) {
    logDashboardPerfEvent_(functionName, `${stageName}:error`, Date.now() - startedAt, {
      message: safeString_(error && error.message),
      details: details || {},
    });
    throw error;
  }
}

function returnDashboardPerf_(functionName, stageName, startedAt, payload, details) {
  logDashboardPerfEvent_(functionName, stageName, Date.now() - startedAt, details);
  return payload;
}

function logDashboardCacheEvent_(eventName, key, details) {
  const payload = {
    event: safeString_(eventName),
    key: safeString_(key),
    cacheVersion: safeString_(PropertiesService.getScriptProperties().getProperty('CACHE_VERSION') || '1'),
    at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
    details: details || {},
  };
  try {
    CacheService.getScriptCache().put(DASHBOARD_CACHE_LOG_KEY_, JSON.stringify(payload), DASHBOARD_CACHE_LOG_TTL_SECONDS_);
  } catch (error) {
    // Cache diagnostics must never block dashboard rendering.
  }
  if (isDashboardDebugMode_() || eventName === 'clear' || eventName === 'sheet_read') {
    console.log(JSON.stringify(Object.assign({ scope: 'dashboard_cache' }, payload)));
  }
}

function getCacheNamespace_() {
  const props = PropertiesService.getScriptProperties();
  let version = props.getProperty('CACHE_VERSION');
  if (!version) {
    version = '1';
    props.setProperty('CACHE_VERSION', version);
  }
  return `${CACHE_SCHEMA_VERSION_}:${version}`;
}

function buildCacheKey_(key) {
  return ['dashboard', getCacheNamespace_(), key].join(':');
}

function getCachedJson_(key) {
  const cache = CacheService.getScriptCache();
  const namespacedKey = buildCacheKey_(key);
  const raw = cache.get(namespacedKey);
  if (!raw) {
    logDashboardCacheEvent_('miss', key, { storage: 'CacheService' });
    return null;
  }

  const manifest = JSON.parse(raw);
  if (!manifest || !manifest.__chunked) {
    logDashboardCacheEvent_('hit', key, { storage: 'CacheService', chunked: false });
    return manifest;
  }

  const chunks = [];
  const chunkKeys = [];
  for (let index = 0; index < manifest.count; index += 1) {
    chunkKeys.push(`${namespacedKey}:chunk:${index}`);
  }
  const chunkMap = cache.getAll(chunkKeys);
  for (let index = 0; index < chunkKeys.length; index += 1) {
    const chunk = chunkMap[chunkKeys[index]];
    if (chunk == null) {
      logDashboardCacheEvent_('miss_chunk', key, { storage: 'CacheService', chunkIndex: index, chunkCount: manifest.count });
      return null;
    }
    chunks.push(chunk);
  }
  logDashboardCacheEvent_('hit', key, { storage: 'CacheService', chunked: true, chunkCount: manifest.count });
  return JSON.parse(chunks.join(''));
}

function putCachedJson_(key, value, ttlSeconds) {
  const cache = CacheService.getScriptCache();
  const namespacedKey = buildCacheKey_(key);
  const raw = JSON.stringify(value);
  const ttl = ttlSeconds || getConfig_().cacheTtlSeconds;

  if (raw.length < 90000) {
    cache.put(namespacedKey, raw, ttl);
    logDashboardCacheEvent_('put', key, { storage: 'CacheService', ttlSeconds: ttl, size: raw.length, chunked: false });
    return value;
  }

  const chunkSize = 85000;
  const chunkCount = Math.ceil(raw.length / chunkSize);
  const chunkValues = {};
  for (let index = 0; index < chunkCount; index += 1) {
    chunkValues[`${namespacedKey}:chunk:${index}`] = raw.slice(index * chunkSize, (index + 1) * chunkSize);
  }
  cache.putAll(chunkValues, ttl);
  cache.put(namespacedKey, JSON.stringify({ __chunked: true, count: chunkCount }), ttl);
  logDashboardCacheEvent_('put', key, { storage: 'CacheService', ttlSeconds: ttl, size: raw.length, chunked: true, chunkCount: chunkCount });
  return value;
}

function persistJsonScriptProperty_(key, value, options) {
  const props = PropertiesService.getScriptProperties();
  const raw = JSON.stringify(value);
  const limit = Number(safeGet_(options, ['limit'])) || SCRIPT_PROPERTY_JSON_MAX_LENGTH_;
  const allowChunking = safeGet_(options, ['allowChunking']) === true;
  deleteJsonScriptProperty_(key);

  if (raw.length > limit && !allowChunking) {
    return {
      saved: false,
      key: key,
      reason: 'too_large',
      size: raw.length,
      limit: limit,
    };
  }

  if (raw.length > limit && allowChunking) {
    const chunkSize = Number(safeGet_(options, ['chunkSize'])) || SCRIPT_PROPERTY_JSON_CHUNK_SIZE_;
    const chunkCount = Math.ceil(raw.length / chunkSize);
    for (var index = 0; index < chunkCount; index += 1) {
      props.setProperty(`${key}__chunk_${index}`, raw.slice(index * chunkSize, (index + 1) * chunkSize));
    }
    props.setProperty(key, JSON.stringify({ __chunked: true, count: chunkCount }));
    return {
      saved: true,
      key: key,
      size: raw.length,
      limit: limit,
      chunked: true,
      count: chunkCount,
    };
  }

  props.setProperty(key, raw);
  return {
    saved: true,
    key: key,
    size: raw.length,
    limit: limit,
  };
}

function readJsonScriptProperty_(key) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.__chunked) return parsed;
    const chunks = [];
    for (var index = 0; index < parsed.count; index += 1) {
      const chunk = props.getProperty(`${key}__chunk_${index}`);
      if (chunk == null) {
        deleteJsonScriptProperty_(key);
        return null;
      }
      chunks.push(chunk);
    }
    return JSON.parse(chunks.join(''));
  } catch (error) {
    deleteJsonScriptProperty_(key);
    return null;
  }
}

function deleteJsonScriptProperty_(key) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(key);
  props.deleteProperty(key);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.__chunked && Number(parsed.count) > 0) {
      for (var index = 0; index < parsed.count; index += 1) {
        props.deleteProperty(`${key}__chunk_${index}`);
      }
    }
  } catch (error) {
    // Ignore malformed property cleanup failure.
  }
}

function buildStaticPayloadPropertyKey_(page, id) {
  const normalizedPage = safeString_(page || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const normalizedId = safeString_(id || 'DEFAULT').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 80);
  return `STATIC_${normalizedPage}_PAYLOAD_${normalizedId}_JSON`;
}

function readStaticPayloadSnapshot_(page, id) {
  const key = buildStaticPayloadPropertyKey_(page, id);
  const cached = getCachedJson_(`static:${key}`);
  if (cached) return cached;
  const propertyPayload = readJsonScriptProperty_(key);
  if (propertyPayload) return putCachedJson_(`static:${key}`, propertyPayload, getConfig_().payloadCacheTtlSeconds);
  const sheetPayload = readPayloadSnapshotFromSheet_(key);
  if (sheetPayload) return putCachedJson_(`static:${key}`, sheetPayload, getConfig_().payloadCacheTtlSeconds);
  return null;
}

function persistStaticPayloadSnapshot_(page, id, payload) {
  if (!payload) return { saved: false, reason: 'empty_payload' };
  const key = buildStaticPayloadPropertyKey_(page, id);
  putCachedJson_(`static:${key}`, payload, getConfig_().payloadCacheTtlSeconds);
  if (page === 'asset' || page === 'company') {
    return { saved: true, key: key, storage: 'cache_and_snapshot_sheet' };
  }
  try {
    return persistJsonScriptProperty_(key, payload, { allowChunking: true });
  } catch (error) {
    return { saved: false, key: key, storage: 'cache_only', reason: safeString_(error && error.message) };
  }
}

function getPayloadSnapshotSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(PAYLOAD_SNAPSHOT_SHEET_NAME_);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PAYLOAD_SNAPSHOT_SHEET_NAME_);
  }
  const headers = ['snapshot_key', 'chunk_index', 'chunk_count', 'json_chunk', 'updated_at'];
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = headers.some(function (header, index) { return firstRow[index] !== header; });
  if (needsHeader) {
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function buildPayloadSnapshotRows_(key, payload, updatedAt) {
  const raw = JSON.stringify(payload || null);
  const count = Math.max(1, Math.ceil(raw.length / PAYLOAD_SNAPSHOT_CHUNK_SIZE_));
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push([
      key,
      index,
      count,
      raw.slice(index * PAYLOAD_SNAPSHOT_CHUNK_SIZE_, (index + 1) * PAYLOAD_SNAPSHOT_CHUNK_SIZE_),
      updatedAt,
    ]);
  }
  return rows;
}

function writePayloadSnapshotsToSheet_(records) {
  const sheet = getPayloadSnapshotSheet_();
  const headers = ['snapshot_key', 'chunk_index', 'chunk_count', 'json_chunk', 'updated_at'];
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  const rows = [];
  (records || []).forEach(function (record) {
    if (!record || !record.key) return;
    Array.prototype.push.apply(rows, buildPayloadSnapshotRows_(record.key, record.payload, updatedAt));
  });
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  return { recordCount: (records || []).length, chunkCount: rows.length, updatedAt: updatedAt };
}

function readPayloadSnapshotFromSheet_(key) {
  const cacheKey = `snapshot-sheet:${key}`;
  const cached = getCachedJson_(cacheKey);
  if (cached) return cached;
  const sheet = getSpreadsheet_().getSheetByName(PAYLOAD_SNAPSHOT_SHEET_NAME_);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const matches = sheet
    .createTextFinder(key)
    .matchEntireCell(true)
    .findAll();
  const chunks = [];
  (matches || []).forEach(function (range) {
    const rowIndex = range.getRow();
    if (rowIndex < 2 || range.getColumn() !== 1) return;
    const row = sheet.getRange(rowIndex, 1, 1, 4).getValues()[0];
    chunks[Number(row[1] || 0)] = safeString_(row[3]);
  });
  if (!chunks.length) return null;
  try {
    const parsed = JSON.parse(chunks.join(''));
    return putCachedJson_(cacheKey, parsed, getConfig_().payloadCacheTtlSeconds);
  } catch (error) {
    return null;
  }
}

function readPayloadSnapshotsFromSheetByKeys_(keys) {
  const requestedKeys = uniqueValues_((keys || []).map(function (key) {
    return safeString_(key);
  }).filter(Boolean));
  const result = {};
  const missingKeys = [];

  requestedKeys.forEach(function (key) {
    const cached = getCachedJson_(`snapshot-sheet:${key}`);
    if (cached) {
      result[key] = cached;
    } else {
      missingKeys.push(key);
    }
  });

  if (!missingKeys.length) return result;

  const sheet = getSpreadsheet_().getSheetByName(PAYLOAD_SNAPSHOT_SHEET_NAME_);
  if (!sheet || sheet.getLastRow() < 2) return result;

  const missingSet = {};
  missingKeys.forEach(function (key) { missingSet[key] = true; });
  const values = sheet.getDataRange().getValues();
  const groupedChunks = {};

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const key = safeString_(row[0]);
    if (!missingSet[key]) continue;
    if (!groupedChunks[key]) groupedChunks[key] = [];
    groupedChunks[key][Number(row[1] || 0)] = safeString_(row[3]);
  }

  Object.keys(groupedChunks).forEach(function (key) {
    try {
      const parsed = JSON.parse(groupedChunks[key].join(''));
      result[key] = putCachedJson_(`snapshot-sheet:${key}`, parsed, getConfig_().payloadCacheTtlSeconds);
    } catch (error) {
      // Ignore a malformed snapshot row and let caller use its fallback path.
    }
  });

  return result;
}

function readStaticPayloadSnapshotMap_(items) {
  const requests = (items || []).map(function (item) {
    return {
      page: safeString_(item && item.page),
      id: safeString_(item && item.id) || 'default',
      key: buildStaticPayloadPropertyKey_(item && item.page, item && item.id),
    };
  }).filter(function (item) {
    return item.page && item.key;
  });
  const result = {};
  const keysForSheet = [];

  requests.forEach(function (item) {
    const cached = getCachedJson_(`static:${item.key}`);
    if (cached) {
      result[item.key] = cached;
      return;
    }
    const propertyPayload = readJsonScriptProperty_(item.key);
    if (propertyPayload) {
      result[item.key] = putCachedJson_(`static:${item.key}`, propertyPayload, getConfig_().payloadCacheTtlSeconds);
      return;
    }
    keysForSheet.push(item.key);
  });

  const sheetPayloads = readPayloadSnapshotsFromSheetByKeys_(keysForSheet);
  Object.keys(sheetPayloads || {}).forEach(function (key) {
    result[key] = putCachedJson_(`static:${key}`, sheetPayloads[key], getConfig_().payloadCacheTtlSeconds);
  });

  return result;
}

function isDefaultToolsRequest_(request) {
  const normalized = normalizeToolsRequest_(request || {});
  return !normalized.disableDefaultSelection && !normalized.assetIds.length && !normalized.companyIds.length;
}

function isDefaultPlaygroundRequest_(request) {
  const normalized = normalizePlaygroundRequest_(request || {});
  return normalized.rowDimension === 'assetName'
    && normalized.columnDimension === 'none'
    && normalized.valueMetric === 'leasedAreaSqm'
    && !normalized.filterDimension
    && !normalized.filterValue
    && Number(normalized.topN) === 25;
}

function bumpDashboardCacheNamespace_(reason) {
  const props = PropertiesService.getScriptProperties();
  const current = Number(props.getProperty('CACHE_VERSION') || 1);
  const next = current + 1;
  props.setProperty('CACHE_VERSION', String(next));
  props.setProperty('LAST_CACHE_CLEAR_TS', String(Date.now()));
  props.setProperty('LAST_CACHE_CLEAR_REASON', safeString_(reason || 'manual'));
  try {
    if (typeof MODEL_RUNTIME_CACHE !== 'undefined') {
      MODEL_RUNTIME_CACHE = null;
      MODEL_RUNTIME_CACHE_AT = 0;
    }
  } catch (error) {
    // Ignore runtime cache cleanup failure in older script contexts.
  }
  logDashboardCacheEvent_('clear', 'namespace', { previousVersion: current, nextVersion: next, reason: safeString_(reason || 'manual') });
  return next;
}

function clearDashboardCache(reason) {
  const normalizedReason = reason || 'manual_clear';
  const nextVersion = bumpDashboardCacheNamespace_(normalizedReason);
  try {
    writeAuditLog_({
      actionType: 'CACHE_CLEAR',
      entityType: 'cache',
      entityId: 'dashboard',
      fieldName: 'CACHE_VERSION',
      oldValue: '',
      newValue: nextVersion,
      reason: normalizedReason,
      sourceFunction: 'clearDashboardCache',
      sourceType: 'server',
      cacheInvalidated: true,
    });
  } catch (error) {
    // Cache clearing must not fail because audit logging is unavailable.
  }
  queueBootstrapBackgroundRefresh_('cache_cleared');
  return getDashboardCacheStatus_({ cacheVersion: nextVersion });
}

function getDashboardCacheStatus() {
  return getDashboardCacheStatus_();
}

function invalidateDashboardCaches_(reason) {
  return clearDashboardCache(reason || 'data_changed');
}

function getDashboardCacheStatus_(overrides) {
  const props = PropertiesService.getScriptProperties();
  let lastEvent = null;
  try {
    const raw = CacheService.getScriptCache().get(DASHBOARD_CACHE_LOG_KEY_);
    lastEvent = raw ? JSON.parse(raw) : null;
  } catch (error) {
    lastEvent = null;
  }
  return {
    cacheVersion: safeString_((overrides && overrides.cacheVersion) || props.getProperty('CACHE_VERSION') || '1'),
    schemaVersion: CACHE_SCHEMA_VERSION_,
    ttlSeconds: {
      default: getConfig_().cacheTtlSeconds,
      model: getConfig_().modelCacheTtlSeconds,
      payload: getConfig_().payloadCacheTtlSeconds,
    },
    dataDirty: isDataDirty_(),
    dataDirtyReason: safeString_(props.getProperty('DATA_DIRTY_REASON')),
    lastCacheClearAt: props.getProperty('LAST_CACHE_CLEAR_TS')
      ? Utilities.formatDate(new Date(Number(props.getProperty('LAST_CACHE_CLEAR_TS'))), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss")
      : '',
    lastCacheClearReason: safeString_(props.getProperty('LAST_CACHE_CLEAR_REASON')),
    lastCacheEvent: lastEvent,
  };
}

function markDataDirty_(reason) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DATA_DIRTY', 'true');
  props.setProperty('DATA_DIRTY_REASON', safeString_(reason || 'manual'));
  props.setProperty('LAST_DATA_DIRTY_TS', String(Date.now()));
}

function clearDataDirty_() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DATA_DIRTY', 'false');
  props.deleteProperty('DATA_DIRTY_REASON');
  props.setProperty('LAST_DATA_CLEAN_TS', String(Date.now()));
}

function isDataDirty_() {
  return PropertiesService.getScriptProperties().getProperty('DATA_DIRTY') === 'true';
}

function normalizeIdList_(values) {
  return uniqueValues_((values || []).map(function (value) {
    return safeString_(value);
  }).filter(Boolean)).sort();
}

function normalizeToolsRequest_(request) {
  return {
    companyIds: normalizeIdList_(request && request.companyIds),
    assetIds: normalizeIdList_(request && request.assetIds),
    disableDefaultSelection: !!(request && request.disableDefaultSelection),
  };
}

function normalizePlaygroundRequest_(request) {
  const topN = Number(request && request.topN);
  const rowDimension = safeString_(request && (request.rowDimension || request.dimension)) || 'assetName';
  const valueMetric = safeString_(request && (request.valueMetric || request.metric)) || 'leasedAreaSqm';
  return {
    dimension: rowDimension,
    metric: valueMetric,
    rowDimension: rowDimension,
    columnDimension: safeString_(request && request.columnDimension) || 'none',
    valueMetric: valueMetric,
    filterDimension: safeString_(request && request.filterDimension),
    filterValue: safeString_(request && request.filterValue),
    topN: Math.max(1, Math.min(100, Number.isFinite(topN) ? topN : 25)),
  };
}

function buildKeyedPayloadKey_(page, request) {
  const normalizedPage = safeString_(page || '').toLowerCase();
  if (normalizedPage === 'bootstrap') return 'bootstrap:shell';
  if (normalizedPage === 'home') return 'home:default';
  if (normalizedPage === 'asset') return 'asset:' + (safeString_(request) || 'default');
  if (normalizedPage === 'company') return 'company:' + (safeString_(request) || 'default');
  if (normalizedPage === 'sector') return 'sector:default';
  if (normalizedPage === 'weekly') return 'weekly:v2';
  if (normalizedPage === 'tools') {
    const normalizedTools = normalizeToolsRequest_(request);
    return `tools:companies=${normalizedTools.companyIds.join(',')}|assets=${normalizedTools.assetIds.join(',')}|empty=${normalizedTools.disableDefaultSelection ? '1' : '0'}`;
  }
  if (normalizedPage === 'playground') {
    const normalizedPlayground = normalizePlaygroundRequest_(request);
    return `playground:row=${normalizedPlayground.rowDimension}|column=${normalizedPlayground.columnDimension}|value=${normalizedPlayground.valueMetric}|filter=${normalizedPlayground.filterDimension}:${normalizedPlayground.filterValue}|topN=${normalizedPlayground.topN}`;
  }
  if (normalizedPage === 'admin') return 'admin:default';
  return normalizedPage + ':default';
}

function buildIntegrationStatePrefix_(integrationKey) {
  return `INTEGRATION_${safeString_(integrationKey).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

function readIntegrationRunState_(integrationKey) {
  const props = PropertiesService.getScriptProperties();
  const prefix = buildIntegrationStatePrefix_(integrationKey);
  const lastAttemptTs = Number(props.getProperty(`${prefix}_LAST_ATTEMPT_TS`) || 0);
  const lastSuccessTs = Number(props.getProperty(`${prefix}_LAST_SUCCESS_TS`) || 0);
  const lastFailureTs = Number(props.getProperty(`${prefix}_LAST_FAILURE_TS`) || 0);
  return {
    lastStatus: safeString_(props.getProperty(`${prefix}_LAST_STATUS`)),
    lastCode: safeString_(props.getProperty(`${prefix}_LAST_CODE`)),
    lastAttemptTs: lastAttemptTs,
    lastAttemptAt: formatRuntimeTimestamp_(lastAttemptTs),
    lastAttemptMessage: safeString_(props.getProperty(`${prefix}_LAST_ATTEMPT_MESSAGE`)),
    lastSuccessTs: lastSuccessTs,
    lastSuccessAt: formatRuntimeTimestamp_(lastSuccessTs),
    lastSuccessMessage: safeString_(props.getProperty(`${prefix}_LAST_SUCCESS_MESSAGE`)),
    lastFailureTs: lastFailureTs,
    lastFailureAt: formatRuntimeTimestamp_(lastFailureTs),
    lastFailureMessage: safeString_(props.getProperty(`${prefix}_LAST_FAILURE_MESSAGE`)),
  };
}

function recordIntegrationRun_(integrationKey, payload) {
  const props = PropertiesService.getScriptProperties();
  const prefix = buildIntegrationStatePrefix_(integrationKey);
  const now = Date.now();
  const status = safeString_(payload && payload.status) || 'unknown';
  const code = safeString_(payload && payload.code);
  const message = safeString_(payload && payload.message);
  props.setProperty(`${prefix}_LAST_STATUS`, status);
  props.setProperty(`${prefix}_LAST_CODE`, code);
  props.setProperty(`${prefix}_LAST_ATTEMPT_TS`, String(now));
  props.setProperty(`${prefix}_LAST_ATTEMPT_MESSAGE`, message);
  if (status === 'success' || status === 'partial_success') {
    props.setProperty(`${prefix}_LAST_SUCCESS_TS`, String(now));
    props.setProperty(`${prefix}_LAST_SUCCESS_MESSAGE`, message);
  } else if (status === 'failure') {
    props.setProperty(`${prefix}_LAST_FAILURE_TS`, String(now));
    props.setProperty(`${prefix}_LAST_FAILURE_MESSAGE`, message);
  }
}

function isIntegrationAuthBlocked_(runState) {
  const code = safeString_(runState && runState.lastCode).toUpperCase();
  const message = safeString_(runState && runState.lastFailureMessage);
  return code === 'AUTH_REQUIRED' || /authorization|auth|권한/i.test(message);
}

function buildOpenDartBlocker_(config, model, runState) {
  const pendingRows = (model && model.companyRows) || [];
  const unmatchedRows = pendingRows.filter(function (row) { return !row.dartCorpCode; });
  if (!config.openDartApiKey) {
    return {
      state: 'missing_api_key',
      blocking: true,
      message: 'Script Properties에 OPENDART_API_KEY가 없습니다.',
      count: unmatchedRows.length,
    };
  }
  if (isIntegrationAuthBlocked_(runState)) {
    return {
      state: 'authorization_required',
      blocking: true,
      message: runState.lastFailureMessage || 'OpenDART 외부 요청 권한이 필요합니다.',
      count: unmatchedRows.length,
    };
  }
  if (unmatchedRows.length) {
    return {
      state: 'match_backlog',
      blocking: false,
      message: 'DB_기업에 OpenDART 미연결 기업이 남아 있습니다.',
      count: unmatchedRows.length,
    };
  }
  return {
    state: 'clear',
    blocking: false,
    message: '',
    count: 0,
  };
}

function buildBuildingHubBlocker_(config, model, runState) {
  const assetRows = (model && model.assetRows) || [];
  const missingQueryRows = assetRows.filter(function (row) {
    return !(row.sigunguCd && row.bjdongCd);
  });
  const unresolvedRows = assetRows.filter(function (row) {
    return safeString_(row.buildingHubStatus) === 'not_found';
  });
  if (!(config.buildingRegisterApiKeyEncoded || config.buildingHubApiKey)) {
    return {
      state: 'missing_api_key',
      blocking: true,
      message: 'Script Properties에 BUILDING_REGISTER_API_KEY_ENCODED가 없습니다.',
      count: missingQueryRows.length,
    };
  }
  if (isIntegrationAuthBlocked_(runState)) {
    return {
      state: 'authorization_required',
      blocking: true,
      message: runState.lastFailureMessage || '건축물대장 외부 요청 권한이 필요합니다.',
      count: missingQueryRows.length + unresolvedRows.length,
    };
  }
  if (missingQueryRows.length) {
    return {
      state: 'query_mapping_required',
      blocking: true,
      message: 'DB_자산에 sigunguCd/bjdongCd 또는 query_key 보강이 필요한 자산이 있습니다.',
      count: missingQueryRows.length,
    };
  }
  if (unresolvedRows.length) {
    return {
      state: 'not_found_backlog',
      blocking: false,
      message: '공식 건축물대장 조회 결과가 아직 없는 자산이 있습니다.',
      count: unresolvedRows.length,
    };
  }
  return {
    state: 'clear',
    blocking: false,
    message: '',
    count: 0,
  };
}

function buildOpenDartIntegrationStatus_(model) {
  const config = getConfig_();
  const runState = readIntegrationRunState_('open_dart');
  const pendingCompanies = model ? (model.companyRows || []).filter(function (row) { return !row.dartCorpCode; }).length : null;
  return {
    ready: !!config.openDartApiKey,
    scriptProperty: 'OPENDART_API_KEY',
    pendingCompanies: pendingCompanies,
    blocker: buildOpenDartBlocker_(config, model, runState),
    lastStatus: runState.lastStatus || '',
    lastAttemptAt: runState.lastAttemptAt,
    lastAttemptMessage: runState.lastAttemptMessage,
    lastSuccessAt: runState.lastSuccessAt,
    lastSuccessMessage: runState.lastSuccessMessage,
    lastFailureAt: runState.lastFailureAt,
    lastFailureMessage: runState.lastFailureMessage,
  };
}

function buildBuildingHubIntegrationStatus_(model) {
  const config = getConfig_();
  const runState = readIntegrationRunState_('building_hub');
  const pendingAssets = model ? (model.assetRows || []).filter(function (row) { return !(row.sigunguCd && row.bjdongCd); }).length : null;
  return {
    ready: !!(config.buildingRegisterApiKeyEncoded || config.buildingHubApiKey),
    scriptProperty: 'BUILDING_REGISTER_API_KEY_ENCODED',
    pendingAssets: pendingAssets,
    blocker: buildBuildingHubBlocker_(config, model, runState),
    lastStatus: runState.lastStatus || '',
    lastAttemptAt: runState.lastAttemptAt,
    lastAttemptMessage: runState.lastAttemptMessage,
    lastSuccessAt: runState.lastSuccessAt,
    lastSuccessMessage: runState.lastSuccessMessage,
    lastFailureAt: runState.lastFailureAt,
    lastFailureMessage: runState.lastFailureMessage,
  };
}

function buildNaverMapsIntegrationStatus_() {
  const config = getConfig_();
  const clientId = safeString_(config.naverMapsClientId);
  const staticKeyId = safeString_(config.naverStaticMapKeyId || config.naverMapsClientId);
  const clientSecret = safeString_(config.naverMapsClientSecret);
  const ready = !!clientId;
  let blocker = {
    state: 'clear',
    blocking: false,
    message: '',
  };

  if (!clientId) {
    blocker = {
      state: 'missing_client_id',
      blocking: true,
      message: 'Script Properties에 NAVER_MAPS_CLIENT_ID가 없습니다.',
    };
  } else if (!clientSecret) {
    blocker = {
      state: 'missing_client_secret',
      blocking: false,
      message: '정적 지도/서버 연동 확인용 NAVER_MAPS_CLIENT_SECRET이 없습니다.',
    };
  }

  return {
    ready: ready,
    scriptProperties: ['NAVER_MAPS_CLIENT_ID', 'NAVER_STATIC_MAP_KEY_ID', 'NAVER_MAPS_CLIENT_SECRET'],
    dynamicClientIdConfigured: !!clientId,
    staticKeyIdConfigured: !!staticKeyId,
    secretConfigured: !!clientSecret,
    usesServerGeocoding: !!config.enableServerGeocoding,
    runtimeInjectionKey: clientId || staticKeyId || '',
    allowedOriginHints: typeof getNaverMapsAllowedOriginHints_ === 'function' ? getNaverMapsAllowedOriginHints_(config) : ['https://script.google.com', 'https://script.googleusercontent.com', 'https://docs.google.com'],
    dynamicSdkUrlPattern: 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId={NAVER_MAPS_CLIENT_ID}&callback=__dashboardNaverMapsSdkReady',
    blocker: blocker,
  };
}

function getMinimalIntegrationStatus_() {
  return {
    openDart: buildOpenDartIntegrationStatus_(null),
    buildingHub: buildBuildingHubIntegrationStatus_(null),
    naverMaps: buildNaverMapsIntegrationStatus_(),
  };
}

function getIntegrationStatusFromModel_(model) {
  return {
    openDart: buildOpenDartIntegrationStatus_(model),
    buildingHub: buildBuildingHubIntegrationStatus_(model),
    naverMaps: buildNaverMapsIntegrationStatus_(),
  };
}

function getIntegrationStatus() {
  const cached = getCachedJson_('integration-status');
  if (cached) return cached;
  const bootstrap = getCachedJson_(buildKeyedPayloadKey_('bootstrap'));
  if (bootstrap && bootstrap.integrations) return bootstrap.integrations;
  return getMinimalIntegrationStatus_();
}

function getBootstrapRefreshRunState_() {
  const props = PropertiesService.getScriptProperties();
  const queuedTs = Number(props.getProperty('BOOTSTRAP_REFRESH_QUEUED_TS') || 0);
  const savedTs = Number(props.getProperty('BOOTSTRAP_SHELL_UPDATED_TS') || 0);
  return {
    queuedTs: queuedTs,
    queuedAt: formatRuntimeTimestamp_(queuedTs),
    queueReason: safeString_(props.getProperty('BOOTSTRAP_REFRESH_REASON')),
    savedTs: savedTs,
    savedAt: formatRuntimeTimestamp_(savedTs),
  };
}

function canManageProjectTriggers_() {
  try {
    const config = getConfig_();
    const email = safeString_(Session.getActiveUser().getEmail()).toLowerCase();
    return !!(email && config.adminEmails.indexOf(email) > -1);
  } catch (error) {
    return false;
  }
}

function hasBootstrapRefreshTrigger_() {
  if (!canManageProjectTriggers_()) return false;
  try {
    return ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === 'runBootstrapBackgroundRefresh';
    });
  } catch (error) {
    return false;
  }
}

function clearBootstrapRefreshQueue_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('BOOTSTRAP_REFRESH_QUEUED_TS');
  props.deleteProperty('BOOTSTRAP_REFRESH_REASON');
}

function queueBootstrapBackgroundRefresh_(reason) {
  const props = PropertiesService.getScriptProperties();
  if (!canManageProjectTriggers_()) {
    props.setProperty('BOOTSTRAP_REFRESH_REASON', safeString_(reason || 'bootstrap_request'));
    return { queued: false, deduped: false, skipped: true };
  }
  if (hasBootstrapRefreshTrigger_()) {
    if (!props.getProperty('BOOTSTRAP_REFRESH_QUEUED_TS')) {
      props.setProperty('BOOTSTRAP_REFRESH_QUEUED_TS', String(Date.now()));
    }
    if (reason) props.setProperty('BOOTSTRAP_REFRESH_REASON', safeString_(reason));
    return { queued: true, deduped: true };
  }
  try {
    ScriptApp.newTrigger('runBootstrapBackgroundRefresh').timeBased().after(60 * 1000).create();
    props.setProperty('BOOTSTRAP_REFRESH_QUEUED_TS', String(Date.now()));
    props.setProperty('BOOTSTRAP_REFRESH_REASON', safeString_(reason || 'bootstrap_request'));
    return { queued: true, deduped: false };
  } catch (error) {
    props.setProperty('BOOTSTRAP_REFRESH_REASON', safeString_(reason || 'bootstrap_request'));
    return { queued: false, deduped: false, error: safeString_(error && error.message) };
  }
}

function runBootstrapBackgroundRefresh() {
  try {
    refreshDashboardCaches_();
  } finally {
    clearBootstrapRefreshQueue_();
  }
}

function buildBootstrapState_(payload, source) {
  const refreshState = getBootstrapRefreshRunState_();
  return {
    source: safeString_(source) || 'unknown',
    isFresh: isBootstrapPayloadFresh_(payload),
    dataDirty: isDataDirty_(),
    backgroundRefreshQueued: !!refreshState.queuedTs,
    queuedAt: refreshState.queuedAt,
    queueReason: refreshState.queueReason,
    persistedAt: refreshState.savedAt,
  };
}

function attachBootstrapState_(payload, source) {
  const clone = JSON.parse(JSON.stringify(payload || {}));
  clone.bootstrapState = buildBootstrapState_(clone, source);
  return clone;
}

function buildBootstrapShellSnapshot_(payload) {
  const snapshot = {
    appName: payload.appName,
    generatedAt: payload.generatedAt,
    dataVersion: payload.dataVersion || getCacheNamespace_(),
    config: payload.config || { formulaVersion: getConfig_().formulaVersion },
    home: null,
    homeLiteKpis: payload.homeLiteKpis || [],
    assetOptions: payload.assetOptions || [],
    companyOptions: payload.companyOptions || [],
    defaults: payload.defaults || { assetId: '', tenantId: '' },
    defaultAssetPayload: null,
    defaultCompanyPayload: null,
    issueBacklog: [],
    issueBacklogCount: Number(payload.issueBacklogCount || 0),
    integrations: payload.integrations || getMinimalIntegrationStatus_(),
    timing: payload.timing || {},
  };
  snapshot.bootstrapState = buildBootstrapState_(snapshot, safeString_(payload.source) || 'refresh');
  return snapshot;
}

function buildPersistedBootstrapShell_(payload) {
  const config = getConfig_();
  const homePayload = safeGet_(payload, ['home']) || null;
  const persistedHomeLiteKpis = safeGet_(payload, ['homeLiteKpis']) || [];
  const preferredHomeLiteKeys = ['operating_asset_count', 'leased_area_total', 'vacancy_area_total', 'monthly_total_cost'];
  const homeLiteKpis = persistedHomeLiteKpis.length
    ? persistedHomeLiteKpis
    : preferredHomeLiteKeys.map(function (key) {
      return ((homePayload && homePayload.kpis) || []).find(function (item) { return item.key === key; });
    }).filter(Boolean).map(function (item) {
      return {
        key: item.key,
        value: item.value,
        status: item.status,
        valueType: item.valueType,
      };
    });

  return buildBootstrapShellSnapshot_({
    appName: payload && payload.appName,
    generatedAt: payload && payload.generatedAt,
    dataVersion: safeString_(payload && payload.dataVersion) || getCacheNamespace_(),
    config: {
      formulaVersion: safeGet_(payload, ['config', 'formulaVersion']) || config.formulaVersion,
      spreadsheetId: safeGet_(payload, ['config', 'spreadsheetId']) || config.spreadsheetId,
    },
    homeLiteKpis: homeLiteKpis,
    assetOptions: safeGet_(payload, ['assetOptions']) || [],
    companyOptions: safeGet_(payload, ['companyOptions']) || [],
    defaults: safeGet_(payload, ['defaults']) || { assetId: '', tenantId: '' },
    defaultAssetPayload: null,
    defaultCompanyPayload: null,
    issueBacklogCount: Number(safeGet_(payload, ['issueBacklogCount']) || 0),
    integrations: safeGet_(payload, ['integrations']) || getMinimalIntegrationStatus_(),
    timing: safeGet_(payload, ['timing']) || {},
    source: 'persisted_shell',
  });
}

function buildBootstrapShellFallback_() {
  const props = PropertiesService.getScriptProperties();
  const lastTs = Number(props.getProperty('LAST_REFRESH_CALCULATION_TS') || 0);
  return buildBootstrapShellSnapshot_({
    appName: APP_NAME,
    generatedAt: Utilities.formatDate(lastTs ? new Date(lastTs) : new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
    config: {
      formulaVersion: getConfig_().formulaVersion,
      spreadsheetId: getConfig_().spreadsheetId,
    },
    dataVersion: getCacheNamespace_(),
    assetOptions: [],
    companyOptions: [],
    defaults: { assetId: '', tenantId: '' },
    issueBacklogCount: 0,
    integrations: getMinimalIntegrationStatus_(),
    source: 'fallback',
  });
}

function readPersistedBootstrapShell_() {
  const propertyKeys = ['BOOTSTRAP_SHELL_LITE_JSON', 'BOOTSTRAP_SHELL_JSON'];

  for (let index = 0; index < propertyKeys.length; index += 1) {
    const propertyKey = propertyKeys[index];
    const parsed = readJsonScriptProperty_(propertyKey);
    if (!parsed) continue;
    const savedVersion = safeString_(parsed && parsed.dataVersion);

    const normalized = buildPersistedBootstrapShell_(parsed);
    normalized.dataVersion = getCacheNamespace_();

    const needsRewrite = propertyKey !== 'BOOTSTRAP_SHELL_LITE_JSON'
      || savedVersion.indexOf(CACHE_SCHEMA_VERSION_) !== 0
      || !!safeGet_(parsed, ['home'])
      || !!safeGet_(parsed, ['defaultAssetPayload'])
      || !!safeGet_(parsed, ['defaultCompanyPayload']);

    if (needsRewrite) {
      persistJsonScriptProperty_('BOOTSTRAP_SHELL_LITE_JSON', normalized, { allowChunking: true });
    }
    if (propertyKey !== 'BOOTSTRAP_SHELL_LITE_JSON') {
      deleteJsonScriptProperty_(propertyKey);
    }
    return attachBootstrapState_(normalized, 'persisted_property');
  }

  return null;
}

function buildBootstrapShell_() {
  const cacheKey = buildKeyedPayloadKey_('bootstrap');
  const cached = getCachedJson_(cacheKey);
  if (cached) return attachBootstrapState_(cached, 'cache');

  const persisted = readPersistedBootstrapShell_();
  if (persisted) return persisted;

  return attachBootstrapState_(buildBootstrapShellFallback_(), 'fallback');
}

function buildAssetOptionList_(model) {
  return sortBy_(Object.keys(model.assetSummaryById || {}).map(function (assetId) {
    const summary = model.assetSummaryById[assetId];
    return {
      assetId: assetId,
      assetName: summary.assetName,
      monthlyCostTotal: summary.monthlyCostTotal,
      vacancyRate: summary.vacancyRate,
      averageENoc: summary.averageENoc,
      uniqueTenantCount: summary.uniqueTenantCount,
      fetchedAt: summary.fetchedAt || '',
    };
  }), 'assetName');
}

function buildCompanyOptionList_(model) {
  return sortBy_(Object.keys(model.companySummaryById || {}).map(function (tenantId) {
    const summary = model.companySummaryById[tenantId];
    return {
      tenantId: tenantId,
      tenantMasterName: summary.tenantMasterName,
      assetCount: summary.assetCount,
      monthlyCostTotal: summary.monthlyCostTotal,
      latestRevenue: safeGet_(summary, ['company', 'latestRevenue']),
      latestExpiry: summary.latestExpiry,
      exposureAvailable: summary.exposureAvailable,
      selectorSortMeta: summary.selectorSortMeta || {},
    };
  }).filter(function (item) {
    return safeString_(item.tenantMasterName);
  }), 'tenantMasterName');
}

function chooseDefaultAssetOption_(model, assetOptions) {
  const configured = model.defaultAssetId
    ? (assetOptions || []).find(function (item) { return item.assetId === model.defaultAssetId; })
    : null;
  if (configured) return configured;
  const best = (assetOptions || []).find(function (item) {
    const summary = model.assetSummaryById[item.assetId];
    return summary && summary.averageENoc != null && summary.grossFloorAreaSqm != null && summary.monthlyCostTotal != null;
  });
  return best || (assetOptions || [])[0] || null;
}

function chooseDefaultCompanyOption_(model, companyOptions) {
  const configured = model.defaultTenantId
    ? (companyOptions || []).find(function (item) { return item.tenantId === model.defaultTenantId; })
    : null;
  if (configured) return configured;
  const best = (companyOptions || []).find(function (item) {
    const summary = model.companySummaryById[item.tenantId];
    const company = summary && summary.company;
    return company && (
      company.latestRevenue != null ||
      company.latestOperatingIncome != null ||
      company.latestDebtRatio != null ||
      company.latestEmployeeCount != null
    );
  });
  return best || (companyOptions || [])[0] || null;
}

function refreshDashboardCaches_() {
  const props = PropertiesService.getScriptProperties();
  const refreshStartedTs = Date.now();
  props.setProperty('LAST_REFRESH_CALCULATION_TS', String(refreshStartedTs));
  props.setProperty('BOOTSTRAP_SHELL_UPDATED_TS', String(refreshStartedTs));
  clearBootstrapRefreshQueue_();

  const model = loadOperationalModel_({
    forceRefresh: true,
    runtimeTimestamps: {
      lastRefreshCalculationTs: refreshStartedTs,
      lastDerivedRefreshTs: Number(props.getProperty('LAST_DERIVED_REFRESH_TS') || 0),
    },
  });
  const config = getConfig_();
  const assetOptions = buildAssetOptionList_(model);
  const companyOptions = buildCompanyOptionList_(model);
  const defaultAsset = chooseDefaultAssetOption_(model, assetOptions);
  const defaultCompany = chooseDefaultCompanyOption_(model, companyOptions);
  const bootstrapAssetLimit = Math.max(
    Math.max(1, config.bootstrapOptionCount || 1),
    Math.min(assetOptions.length, config.staticSnapshotMaxAssets || 200)
  );
  const bootstrapCompanyLimit = Math.max(
    Math.max(1, config.bootstrapOptionCount || 1),
    Math.min(companyOptions.length, config.staticSnapshotMaxCompanies || 300)
  );
  const bootstrapAssetOptions = defaultAsset
    ? [defaultAsset].concat(assetOptions.filter(function (item) { return item.assetId !== defaultAsset.assetId; })).slice(0, bootstrapAssetLimit)
    : [];
  const bootstrapCompanyOptions = defaultCompany
    ? [defaultCompany].concat(companyOptions.filter(function (item) { return item.tenantId !== defaultCompany.tenantId; })).slice(0, bootstrapCompanyLimit)
    : [];
  const homePayload = buildHomePayload_(model);
  const preferredHomeLiteKeys = ['operating_asset_count', 'leased_area_total', 'vacancy_area_total', 'monthly_total_cost'];
  const bootstrap = buildBootstrapShellSnapshot_({
    appName: APP_NAME,
    generatedAt: model.generatedAt,
    config: model.config,
    dataVersion: getCacheNamespace_(),
    home: homePayload,
    homeLiteKpis: preferredHomeLiteKeys.map(function (key) {
      return (homePayload.kpis || []).find(function (item) { return item.key === key; });
    }).filter(Boolean).map(function (item) {
      return {
        key: item.key,
        value: item.value,
        status: item.status,
        valueType: item.valueType,
      };
    }),
    assetOptions: bootstrapAssetOptions,
    companyOptions: bootstrapCompanyOptions,
    defaults: {
      assetId: defaultAsset ? defaultAsset.assetId : '',
      tenantId: defaultCompany ? defaultCompany.tenantId : '',
    },
    defaultAssetPayload: null,
    defaultCompanyPayload: null,
    issueBacklogCount: model.reviewSummary.unresolvedIssueCount,
    integrations: getIntegrationStatusFromModel_(model),
    timing: model.runtimeMeta || {},
    source: 'refresh',
  });

  putCachedJson_('model:full', model, config.modelCacheTtlSeconds);
  putCachedJson_(buildKeyedPayloadKey_('home'), homePayload, config.payloadCacheTtlSeconds);
  putCachedJson_('asset-options:full', assetOptions, config.payloadCacheTtlSeconds);
  putCachedJson_('company-options:full', companyOptions, config.payloadCacheTtlSeconds);
  putCachedJson_('integration-status', bootstrap.integrations, config.payloadCacheTtlSeconds);

  var defaultAssetPayload = null;
  var defaultCompanyPayload = null;
  if (defaultAsset && defaultAsset.assetId) {
    defaultAssetPayload = buildAssetPayload_(model, defaultAsset.assetId);
    putCachedJson_(buildKeyedPayloadKey_('asset', defaultAsset.assetId), defaultAssetPayload, config.payloadCacheTtlSeconds);
  }
  if (defaultCompany && defaultCompany.tenantId) {
    defaultCompanyPayload = buildCompanyPayload_(model, defaultCompany.tenantId);
    putCachedJson_(buildKeyedPayloadKey_('company', defaultCompany.tenantId), defaultCompanyPayload, config.payloadCacheTtlSeconds);
  }

  putCachedJson_(buildKeyedPayloadKey_('bootstrap'), bootstrap, config.payloadCacheTtlSeconds);
  persistJsonScriptProperty_('BOOTSTRAP_SHELL_LITE_JSON', buildPersistedBootstrapShell_(bootstrap), { allowChunking: true });
  deleteJsonScriptProperty_('BOOTSTRAP_SHELL_JSON');
  persistJsonScriptProperty_('ASSET_OPTIONS_JSON', assetOptions, { allowChunking: true });
  persistJsonScriptProperty_('COMPANY_OPTIONS_JSON', companyOptions, { allowChunking: true });
  persistJsonScriptProperty_('HOME_PAYLOAD_JSON', homePayload || null, { allowChunking: true });
  persistJsonScriptProperty_('DEFAULT_ASSET_PAYLOAD_JSON', defaultAssetPayload || null, { allowChunking: true });
  persistJsonScriptProperty_('DEFAULT_COMPANY_PAYLOAD_JSON', defaultCompanyPayload || null, { allowChunking: true });
  if (typeof buildAdminReviewCache_ === 'function') {
    persistJsonScriptProperty_('ADMIN_REVIEW_CACHE_JSON', buildAdminReviewCache_(model, homePayload), { allowChunking: true });
  }
  if (typeof buildAdminSummaryPayload_ === 'function') {
    persistJsonScriptProperty_('ADMIN_SUMMARY_JSON', buildAdminSummaryPayload_(model, homePayload, bootstrap, {
      errorCount: 0,
    }), { allowChunking: true });
  }
  refreshStaticPayloadSnapshotsFromModel_(model, {
    assetOptions: assetOptions,
    companyOptions: companyOptions,
    homePayload: homePayload,
    defaultAssetPayload: defaultAssetPayload,
    defaultCompanyPayload: defaultCompanyPayload,
  });
  return bootstrap;
}

function refreshStaticPayloadSnapshotsFromModel_(model, context) {
  const config = getConfig_();
  const options = context || {};
  const assetOptions = (options.assetOptions || buildAssetOptionList_(model)).slice(0, Math.max(0, config.staticSnapshotMaxAssets || 200));
  const companyOptions = (options.companyOptions || buildCompanyOptionList_(model)).slice(0, Math.max(0, config.staticSnapshotMaxCompanies || 300));
  const startedAt = Date.now();
  let assetSaved = 0;
  let companySaved = 0;
  const errors = [];
  const snapshotRecords = [];

  function addSnapshotRecord_(page, id, payload) {
    const key = buildStaticPayloadPropertyKey_(page, id);
    persistStaticPayloadSnapshot_(page, id, payload);
    snapshotRecords.push({ key: key, payload: payload });
  }

  addSnapshotRecord_('home', 'default', options.homePayload || buildHomePayload_(model));
  addSnapshotRecord_('sector', 'default', buildSectorPayload_(model));
  addSnapshotRecord_('tools', 'default', buildToolsPayload_(model, {}));
  addSnapshotRecord_('playground', 'default', buildPlaygroundPayload_(model, {}));

  assetOptions.forEach(function (item) {
    try {
      const payload = options.defaultAssetPayload && item.assetId === safeGet_(options.defaultAssetPayload, ['overview', 'assetId'])
        ? options.defaultAssetPayload
        : buildAssetPayload_(model, item.assetId);
      addSnapshotRecord_('asset', item.assetId, payload);
      assetSaved += 1;
    } catch (error) {
      errors.push({ type: 'asset', id: item.assetId, message: safeString_(error && error.message) });
    }
  });

  companyOptions.forEach(function (item) {
    try {
      const payload = options.defaultCompanyPayload && item.tenantId === safeGet_(options.defaultCompanyPayload, ['profile', 'tenantId'])
        ? options.defaultCompanyPayload
        : buildCompanyPayload_(model, item.tenantId);
      addSnapshotRecord_('company', item.tenantId, payload);
      companySaved += 1;
    } catch (error) {
      errors.push({ type: 'company', id: item.tenantId, message: safeString_(error && error.message) });
    }
  });

  const sheetWrite = writePayloadSnapshotsToSheet_(snapshotRecords);

  const props = PropertiesService.getScriptProperties();
  props.setProperty('STATIC_PAYLOAD_SNAPSHOT_UPDATED_TS', String(Date.now()));
  props.setProperty('STATIC_PAYLOAD_SNAPSHOT_ASSET_COUNT', String(assetSaved));
  props.setProperty('STATIC_PAYLOAD_SNAPSHOT_COMPANY_COUNT', String(companySaved));
  props.setProperty('STATIC_PAYLOAD_SNAPSHOT_ERROR_COUNT', String(errors.length));
  props.setProperty('STATIC_PAYLOAD_SNAPSHOT_DURATION_MS', String(Date.now() - startedAt));
  props.setProperty('STATIC_PAYLOAD_SNAPSHOT_RECORD_COUNT', String(sheetWrite.recordCount));
  props.setProperty('STATIC_PAYLOAD_SNAPSHOT_CHUNK_COUNT', String(sheetWrite.chunkCount));
  if (errors.length) {
    persistJsonScriptProperty_('STATIC_PAYLOAD_SNAPSHOT_ERRORS_JSON', errors.slice(0, 50), { allowChunking: true });
  } else {
    deleteJsonScriptProperty_('STATIC_PAYLOAD_SNAPSHOT_ERRORS_JSON');
  }

  try {
    writeAuditLog_({
      actionType: 'SYNC',
      entityType: 'cache',
      entityId: 'static_snapshot',
      fieldName: 'snapshot_status',
      oldValue: '',
      newValue: errors.length ? 'partial_success' : 'success',
      reason: 'static_snapshot_refresh',
      sourceFunction: 'refreshStaticPayloadSnapshotsFromModel_',
      sourceType: 'server',
      cacheInvalidated: false,
    });
  } catch (error) {
    // Snapshot generation should not fail because audit logging is unavailable.
  }

  return {
    status: errors.length ? 'partial_success' : 'success',
    assetSaved: assetSaved,
    companySaved: companySaved,
    errorCount: errors.length,
    durationMs: Date.now() - startedAt,
  };
}

function assertAdmin_(request) {
  const viewer = getViewerContext_({ adminSessionToken: request && request.adminSessionToken });
  if (!viewer.isAdmin) {
    throw new Error('Admin permission is required.');
  }
}

function getModelOrRefreshCache_() {
  const cached = getCachedJson_('model:full');
  if (cached && !isDataDirty_()) return cached;
  if (cached && isDataDirty_()) {
    queueBootstrapBackgroundRefresh_('model_cache_stale_while_revalidate');
    return cached;
  }
  return loadOperationalModel_({ forceRefresh: true });
}

function getPayloadForAiTab_(tab, filters) {
  const normalizedTab = safeString_(tab || 'home').toLowerCase();
  const payloadFilters = filters || {};
  if (normalizedTab === 'home') return getHomeData();
  if (normalizedTab === 'asset') return getAssetData(payloadFilters.assetId);
  if (normalizedTab === 'company') return getCompanyData(payloadFilters.tenantId);
  if (normalizedTab === 'sector') return getSectorData();
  if (normalizedTab === 'tools') return getToolsData(payloadFilters);
  if (normalizedTab === 'playground') return getPlaygroundData(payloadFilters);
  return getHomeData();
}

function getAiContext(request) {
  const tab = (request && request.tab) || 'home';
  const filters = (request && request.filters) || {};
  return {
    tab: tab,
    summary: getPayloadForAiTab_(tab, filters),
    prompts: [
      'Summarize the three most important signals on this page.',
      'Explain which values are missing and why.',
      'List the next validation questions for this view.',
    ],
  };
}

function submitAiQuestion(request) {
  return {
    status: 'placeholder',
    question: request.question,
    answer: 'AI answer generation is not connected yet. The context payload is ready for a later model integration step.',
    context: request.context || null,
  };
}

function installOrUpdateTriggers(request) {
  assertAdmin_(request);
  const config = getConfig_();
  const existing = ScriptApp.getProjectTriggers();
  existing.forEach(function (trigger) {
    if ([
      'scheduledRefreshCalculationSheet',
      'scheduledSyncOpenDartData',
      'scheduledSyncBuildingRegisterData',
      'scheduledRunDataAudit',
      'scheduledRefreshDashboardSnapshot',
      'scheduledAutoMaintenance',
      'runBootstrapBackgroundRefresh',
      'handleSpreadsheetEdit',
      'handleSpreadsheetChange',
    ].indexOf(trigger.getHandlerFunction()) > -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('scheduledRefreshCalculationSheet').timeBased().everyDays(1).atHour(1).create();
  ScriptApp.newTrigger('scheduledSyncOpenDartData').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('scheduledSyncBuildingRegisterData').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('scheduledRunDataAudit').timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger('scheduledRefreshDashboardSnapshot').timeBased().everyDays(1).atHour(Math.max(0, Math.min(23, config.dailySnapshotRefreshHour || 9))).create();
  ScriptApp.newTrigger('scheduledAutoMaintenance').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('handleSpreadsheetEdit').forSpreadsheet(config.spreadsheetId).onEdit().create();
  ScriptApp.newTrigger('handleSpreadsheetChange').forSpreadsheet(config.spreadsheetId).onChange().create();
}

function hasProjectTriggerByHandler_(handlerName) {
  try {
    return ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === handlerName;
    });
  } catch (error) {
    return false;
  }
}

function clearProjectTriggersByHandler_(handlerName) {
  try {
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === handlerName) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
  } catch (error) {
    // no-op
  }
}

function queueAdminOneShotJob_(handlerName, queueKey, delayMs) {
  const props = PropertiesService.getScriptProperties();
  const normalizedDelayMs = Math.max(1000, Number(delayMs || 5000));
  if (!hasProjectTriggerByHandler_(handlerName)) {
    ScriptApp.newTrigger(handlerName).timeBased().after(normalizedDelayMs).create();
  }
  props.setProperty(`ADMIN_JOB_${queueKey}_STATUS`, 'queued');
  props.setProperty(`ADMIN_JOB_${queueKey}_QUEUED_AT`, String(Date.now()));
  try {
    writeAuditLog_({
      actionType: 'SYNC',
      entityType: 'admin_job',
      entityId: queueKey,
      fieldName: 'status',
      oldValue: '',
      newValue: 'queued',
      reason: 'admin_action_queued',
      sourceFunction: handlerName,
      sourceType: 'admin',
      cacheInvalidated: false,
    });
  } catch (error) {
    // Admin queueing should not fail because audit logging is unavailable.
  }
  return {
    status: 'queued',
    handler: handlerName,
    queueKey: queueKey,
    queuedAt: new Date().toISOString(),
  };
}

function finalizeAdminOneShotJob_(handlerName, queueKey, status, message) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(`ADMIN_JOB_${queueKey}_STATUS`, safeString_(status || 'done'));
  props.setProperty(`ADMIN_JOB_${queueKey}_FINISHED_AT`, String(Date.now()));
  props.setProperty(`ADMIN_JOB_${queueKey}_MESSAGE`, safeString_(message || ''));
  try {
    writeAuditLog_({
      actionType: 'SYNC',
      entityType: 'admin_job',
      entityId: queueKey,
      fieldName: 'status',
      oldValue: 'queued',
      newValue: safeString_(status || 'done'),
      reason: safeString_(message || ''),
      sourceFunction: handlerName,
      sourceType: 'admin',
      cacheInvalidated: true,
    });
  } catch (error) {
    // Admin finalization should not fail because audit logging is unavailable.
  }
  clearProjectTriggersByHandler_(handlerName);
}

function runQueuedAdminRefreshCalculation() {
  try {
    refreshDerivedArtifacts_({ force: true, reason: 'queued_admin_refresh' });
    finalizeAdminOneShotJob_('runQueuedAdminRefreshCalculation', 'REFRESH', 'success', '계산 갱신 완료');
  } catch (error) {
    finalizeAdminOneShotJob_('runQueuedAdminRefreshCalculation', 'REFRESH', 'failure', safeString_(error && error.message) || '계산 갱신 실패');
    throw error;
  }
}

function runQueuedAdminRefreshSnapshot() {
  try {
    refreshDerivedArtifacts_({ force: true, reason: 'queued_admin_snapshot' });
    finalizeAdminOneShotJob_('runQueuedAdminRefreshSnapshot', 'SNAPSHOT', 'success', '정적 스냅샷 갱신 완료');
  } catch (error) {
    finalizeAdminOneShotJob_('runQueuedAdminRefreshSnapshot', 'SNAPSHOT', 'failure', safeString_(error && error.message) || '정적 스냅샷 갱신 실패');
    throw error;
  }
}

function runQueuedAdminSyncOpenDart() {
  try {
    syncOpenDartData();
    refreshDerivedArtifacts_({ force: true, reason: 'queued_admin_sync_open_dart' });
    finalizeAdminOneShotJob_('runQueuedAdminSyncOpenDart', 'OPEN_DART', 'success', 'OpenDART 동기화 완료');
  } catch (error) {
    finalizeAdminOneShotJob_('runQueuedAdminSyncOpenDart', 'OPEN_DART', 'failure', safeString_(error && error.message) || 'OpenDART 동기화 실패');
    throw error;
  }
}

function runQueuedAdminSyncBuildingRegister() {
  try {
    syncBuildingRegisterData();
    refreshDerivedArtifacts_({ force: true, reason: 'queued_admin_sync_building' });
    finalizeAdminOneShotJob_('runQueuedAdminSyncBuildingRegister', 'BUILDING', 'success', '건축물대장 동기화 완료');
  } catch (error) {
    finalizeAdminOneShotJob_('runQueuedAdminSyncBuildingRegister', 'BUILDING', 'failure', safeString_(error && error.message) || '건축물대장 동기화 실패');
    throw error;
  }
}

function refreshDerivedArtifacts_(options) {
  const normalized = options || {};
  if (!normalized.force && !isDataDirty_() && getCachedJson_(buildKeyedPayloadKey_('bootstrap'))) {
    return { status: 'noop' };
  }

  MODEL_RUNTIME_CACHE = null;
  MODEL_RUNTIME_CACHE_AT = 0;
  invalidateDashboardCaches_();
  refreshCalculationSheet();
  const bootstrap = refreshDashboardCaches_();
  const audit = runDataAudit();
  clearDataDirty_();
  PropertiesService.getScriptProperties().setProperty('LAST_DERIVED_REFRESH_TS', String(Date.now()));
  return { status: 'ok', generatedAt: bootstrap.generatedAt, auditInserted: audit.inserted };
}

function scheduledRefreshCalculationSheet() {
  refreshDerivedArtifacts_({ force: true, reason: 'scheduled_refresh' });
}

function scheduledSyncOpenDartData() {
  syncOpenDartData();
}

function scheduledSyncBuildingRegisterData() {
  syncBuildingRegisterData();
}

function scheduledRunDataAudit() {
  runDataAudit();
}

function scheduledRefreshDashboardSnapshot() {
  refreshDerivedArtifacts_({ force: true, reason: 'scheduled_static_snapshot' });
}

function scheduledAutoMaintenance() {
  refreshDerivedArtifacts_({ reason: 'scheduled_auto_maintenance' });
}

function handleSpreadsheetEdit(e) {
  handleSpreadsheetMutation_(e, 'edit');
}

function handleSpreadsheetChange(e) {
  handleSpreadsheetMutation_(e, 'change');
}

function handleSpreadsheetMutation_(e, reason) {
  try {
    logSpreadsheetMutationAudit_(e, reason);
  } catch (error) {
    // Data refresh should continue even when edit audit logging is unavailable.
  }
  markDataDirty_(reason);
  invalidateDashboardCaches_(`spreadsheet_${reason}`);
  const props = PropertiesService.getScriptProperties();
  const lastRun = Number(props.getProperty('LAST_DERIVED_REFRESH_TS') || 0);
  const cooldownMs = getConfig_().autoRefreshCooldownMinutes * 60 * 1000;
  if (!lastRun || (Date.now() - lastRun) > cooldownMs) {
    refreshDerivedArtifacts_({ reason: `trigger_${reason}` });
  }
}

function logSpreadsheetMutationAudit_(e, reason) {
  const range = e && e.range;
  if (!range) return;
  const sheet = range.getSheet();
  const sheetName = sheet.getName();
  const config = getConfig_();
  const trackedSheets = [
    config.sheetNames.general,
    config.sheetNames.history,
    config.sheetNames.asset,
    config.sheetNames.company,
    config.sheetNames.sysAssetLookup,
  ];
  if (sheetName === config.sheetNames.auditLog || trackedSheets.indexOf(sheetName) === -1) return;

  const row = range.getRow();
  const column = range.getColumn();
  const rows = range.getNumRows();
  const columns = range.getNumColumns();
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), column + columns - 1)).getDisplayValues()[0];
  const fieldName = headers[column - 1] || `column_${column}`;
  const entityType = sheetName === config.sheetNames.general ? 'contract'
    : sheetName === config.sheetNames.history ? 'history'
      : sheetName === config.sheetNames.asset || sheetName === config.sheetNames.sysAssetLookup ? 'asset'
        : sheetName === config.sheetNames.company ? 'company'
          : 'unknown';
  const actionType = safeString_(reason) === 'change' || rows > 1 || columns > 1 ? 'BULK_UPDATE' : 'UPDATE';
  const newValue = rows === 1 && columns === 1 ? safeString_(range.getDisplayValue()) : `${rows}x${columns} range changed`;
  const oldValue = rows === 1 && columns === 1 ? safeString_(e.oldValue) : 'oldValue unavailable for bulk edit';
  writeAuditLog_({
    actionType: actionType,
    entityType: entityType,
    entityId: '',
    sheetName: sheetName,
    rowNumber: row,
    fieldName: fieldName,
    oldValue: oldValue,
    newValue: newValue,
    reason: isAuditCriticalField_(fieldName) ? 'reason_required' : safeString_(reason),
    sourceFunction: 'handleSpreadsheetMutation_',
    sourceType: 'sheet_trigger',
    cacheInvalidated: true,
  });
}

function refreshCalculationSheetIfStale_() {
  const props = PropertiesService.getScriptProperties();
  const lastRun = Number(props.getProperty('LAST_REFRESH_CALCULATION_TS') || 0);
  if (!lastRun || (Date.now() - lastRun) > 6 * 60 * 60 * 1000) {
    refreshDerivedArtifacts_({ reason: 'stale_refresh' });
  }
}

function adminRefreshCalculationSheet(request) {
  assertAdmin_(request);
  return queueAdminOneShotJob_('runQueuedAdminRefreshCalculation', 'REFRESH', 5000);
}

function adminSyncOpenDartData(request) {
  assertAdmin_(request);
  return queueAdminOneShotJob_('runQueuedAdminSyncOpenDart', 'OPEN_DART', 5000);
}

function adminSyncBuildingRegisterData(request) {
  assertAdmin_(request);
  return queueAdminOneShotJob_('runQueuedAdminSyncBuildingRegister', 'BUILDING', 5000);
}

function adminRunDataAudit(request) {
  assertAdmin_(request);
  return runDataAudit();
}

function adminInstallOrUpdateTriggers(request) {
  assertAdmin_(request);
  installOrUpdateTriggers(request);
  return { status: 'ok' };
}

function logApiEvent_(provider, endpoint, targetId, status, message, rawRef) {
  const sheet = getSpreadsheet_().getSheetByName(getConfig_().sheetNames.logApi);
  if (!sheet) return;
  sheet.appendRow([
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
    provider,
    endpoint,
    targetId,
    status,
    message,
    rawRef || '',
  ]);
}

function ensureAuditSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.audit);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(getConfig_().sheetNames.audit);
  }
  const headers = ['audit_id', 'sheet_name', 'row_ref', 'asset_id', 'tenant_id', 'rule_name', 'severity', 'status', 'message', 'detected_at'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

const AUDIT_LOG_HEADERS_ = Object.freeze([
  'auditId',
  'timestamp',
  'userEmail',
  'actionType',
  'entityType',
  'entityId',
  'sheetName',
  'rowNumber',
  'fieldName',
  'oldValue',
  'newValue',
  'reason',
  'sourceFunction',
  'sourceType',
  'cacheInvalidated',
  'requestId',
]);

const AUDIT_CRITICAL_FIELD_PATTERNS_ = Object.freeze([
  /계약.*시작|계약개시|start.*date/i,
  /계약.*종료|계약만기|end.*date/i,
  /임대료|rent/i,
  /보증금|deposit/i,
  /면적|area/i,
  /임차인|tenant/i,
  /갱신|renew/i,
  /중도해지|termination/i,
  /특약|special/i,
  /계약.*상태|status/i,
]);

function ensureAuditLogSheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheetName = getConfig_().sheetNames.auditLog || 'AuditLog';
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  const currentHeaders = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), AUDIT_LOG_HEADERS_.length)).getDisplayValues()[0] : [];
  const needsHeader = AUDIT_LOG_HEADERS_.some(function (header, index) {
    return currentHeaders[index] !== header;
  });
  if (needsHeader) {
    sheet.getRange(1, 1, 1, AUDIT_LOG_HEADERS_.length).setValues([AUDIT_LOG_HEADERS_]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getAuditUserEmail_() {
  return safeString_(Session.getActiveUser().getEmail()).toLowerCase() || 'unknown';
}

function formatAuditTimestamp_(date) {
  return Utilities.formatDate(date || new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function isAuditCriticalField_(fieldName) {
  const text = safeString_(fieldName);
  return AUDIT_CRITICAL_FIELD_PATTERNS_.some(function (pattern) {
    return pattern.test(text);
  });
}

function buildAuditLogRow_(entry) {
  const now = new Date();
  const fieldName = safeString_(entry && entry.fieldName);
  const reason = safeString_(entry && entry.reason);
  return [
    safeString_(entry && entry.auditId) || Utilities.getUuid(),
    safeString_(entry && entry.timestamp) || formatAuditTimestamp_(now),
    safeString_(entry && entry.userEmail) || getAuditUserEmail_(),
    safeString_(entry && entry.actionType) || 'UPDATE',
    safeString_(entry && entry.entityType) || 'unknown',
    safeString_(entry && entry.entityId),
    safeString_(entry && entry.sheetName),
    safeString_(entry && entry.rowNumber),
    fieldName,
    entry && entry.oldValue != null ? safeString_(entry.oldValue) : '',
    entry && entry.newValue != null ? safeString_(entry.newValue) : '',
    reason || (isAuditCriticalField_(fieldName) ? 'reason_required' : ''),
    safeString_(entry && entry.sourceFunction),
    safeString_(entry && entry.sourceType) || 'server',
    entry && entry.cacheInvalidated === true ? 'Y' : 'N',
    safeString_(entry && entry.requestId),
  ];
}

function writeAuditLogs_(entries) {
  const normalized = (entries || []).filter(Boolean);
  if (!normalized.length) return { inserted: 0 };
  const sheet = ensureAuditLogSheet_();
  const rows = normalized.map(buildAuditLogRow_);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, AUDIT_LOG_HEADERS_.length).setValues(rows);
  return { inserted: rows.length };
}

function writeAuditLog_(entry) {
  return writeAuditLogs_([entry]);
}

function getAuditEntityIdFromRow_(row, idx, entityType) {
  if (entityType === 'contract') return readRowCell_(row, idx, ['lease_id', 'leaseId', '계약ID']);
  if (entityType === 'asset') return readRowCell_(row, idx, ['asset_id', 'asset_code', 'assetId', '자산코드']);
  if (entityType === 'company') return readRowCell_(row, idx, ['tenant_id', 'tenantId', '기업ID']);
  return readRowCell_(row, idx, ['id', 'row_id']) || '';
}

function buildSheetDiffAuditEntries_(beforeRows, afterRows, headers, options) {
  const normalized = options || {};
  const idx = headerIndexes_(headers || []);
  const entries = [];
  const limit = Math.min((beforeRows || []).length, (afterRows || []).length);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const before = beforeRows[rowIndex] || [];
    const after = afterRows[rowIndex] || [];
    const entityId = getAuditEntityIdFromRow_(after, idx, normalized.entityType);
    (headers || []).forEach(function (header, columnIndex) {
      const oldValue = before[columnIndex] == null ? '' : String(before[columnIndex]);
      const newValue = after[columnIndex] == null ? '' : String(after[columnIndex]);
      if (oldValue === newValue) return;
      entries.push({
        actionType: normalized.actionType || 'UPDATE',
        entityType: normalized.entityType || 'unknown',
        entityId: entityId,
        sheetName: normalized.sheetName,
        rowNumber: rowIndex + 2,
        fieldName: header,
        oldValue: oldValue,
        newValue: newValue,
        reason: normalized.reason || (isAuditCriticalField_(header) ? 'system_sync' : ''),
        sourceFunction: normalized.sourceFunction,
        sourceType: normalized.sourceType || 'server',
        cacheInvalidated: normalized.cacheInvalidated === true,
        requestId: normalized.requestId,
      });
    });
  }
  return entries;
}

function makeAuditRow_(detectedAt, sheetName, rowRef, assetId, tenantId, ruleName, severity, status, message) {
  return ['', sheetName, rowRef || '', assetId || '', tenantId || '', ruleName, severity, status, message, detectedAt];
}

function daysBetweenDateText_(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function previewOpenDartBacklog() {
  return sortBy_(getModelOrRefreshCache_().companyRows.filter(function (row) {
    return !row.dartCorpCode;
  }), 'tenantMasterName');
}

function previewBuildingHubBacklog() {
  return sortBy_(getModelOrRefreshCache_().assetRows.filter(function (row) {
    return !(row.sigunguCd && row.bjdongCd);
  }), 'assetName');
}

function normalizeOpenDartLookup_(value) {
  let normalized = normalizeWhitespace_(value).toLowerCase();
  if (!normalized) return '';

  [
    ['㈜', ''],
    ['(주)', ''],
    ['주식회사', ''],
    ['유한책임회사', ''],
    ['유한회사', ''],
    ['합자회사', ''],
    ['합명회사', ''],
    ['씨제이', 'cj'],
    ['엘지', 'lg'],
    ['엘엑스', 'lx'],
    ['에스케이', 'sk'],
    ['케이티', 'kt'],
    ['엔에이치', 'nh'],
    ['에이치엠엠', 'hmm'],
    ['지에스', 'gs'],
    ['엘에스', 'ls'],
  ].forEach(function (pair) {
    normalized = normalized.split(pair[0]).join(pair[1]);
  });

  return normalized
    .replace(/[()]/g, '')
    .replace(/[\s,./&-]+/g, '')
    .trim();
}

function splitOpenDartEntityNames_(value) {
  return normalizeWhitespace_(value)
    .split(/,|\/|&|·|\s+및\s+/)
    .map(normalizeWhitespace_)
    .filter(Boolean);
}

function buildOpenDartLookupVariants_(value) {
  const source = normalizeWhitespace_(value);
  if (!source) return [];

  const variants = [source, source.replace(/[()]/g, '')];
  Array.prototype.push.apply(variants, splitOpenDartEntityNames_(source));

  return uniqueValues_(variants.map(normalizeOpenDartLookup_).filter(Boolean));
}

function dedupeOpenDartCorps_(rows) {
  const seen = {};
  return (rows || []).filter(function (row) {
    if (!row || !row.corp_code || seen[row.corp_code]) return false;
    seen[row.corp_code] = true;
    return true;
  });
}

function collectOpenDartCandidateKeys_(candidateMap, request) {
  const businessRegistrationNos = normalizeOpenDartBusinessNoList_(request.businessRegistrationNo);
  const keys = [];
  if (request.tenantId && candidateMap[request.tenantId]) {
    Array.prototype.push.apply(keys, candidateMap[request.tenantId]);
  }
  businessRegistrationNos.forEach(function (businessRegistrationNo) {
    if (candidateMap[businessRegistrationNo]) {
      Array.prototype.push.apply(keys, candidateMap[businessRegistrationNo]);
    }
  });
  Array.prototype.push.apply(keys, buildOpenDartLookupVariants_(request.tenantMasterName));
  return uniqueValues_(keys.filter(Boolean));
}

function getOpenDartCompanyInfoCached_(corpCode, cache) {
  if (!corpCode) return {};
  if (!cache[corpCode]) {
    cache[corpCode] = fetchOpenDartCompanyInfo_(corpCode);
  }
  return cache[corpCode] || {};
}

function normalizeOpenDartBusinessNoList_(value) {
  return uniqueValues_((safeString_(value).match(/\d+/g) || []).map(function (item) {
    return safeString_(item).replace(/[^0-9]/g, '');
  }).filter(function (item) {
    return item.length >= 10;
  }));
}

function filterOpenDartMatchesByBusinessNo_(matches, businessRegistrationNo, companyInfoCache) {
  const normalizedBusinessNos = normalizeOpenDartBusinessNoList_(businessRegistrationNo);
  if (!normalizedBusinessNos.length) return [];
  return dedupeOpenDartCorps_(matches).filter(function (corp) {
    const companyInfo = getOpenDartCompanyInfoCached_(corp.corp_code, companyInfoCache);
    const candidateBusinessNo = safeString_(companyInfo.bizr_no).replace(/[^0-9]/g, '');
    return candidateBusinessNo && normalizedBusinessNos.indexOf(candidateBusinessNo) > -1;
  });
}

function resolveOpenDartCorpMatch_(corpCodeMap, candidateMap, request, companyInfoCache) {
  const hasBusinessNoConstraint = normalizeOpenDartBusinessNoList_(request.businessRegistrationNo).length > 0;
  const candidateKeys = collectOpenDartCandidateKeys_(candidateMap, request);
  const exactMatches = dedupeOpenDartCorps_(candidateKeys.reduce(function (accumulator, key) {
    if (corpCodeMap[key] && corpCodeMap[key].length) {
      Array.prototype.push.apply(accumulator, corpCodeMap[key]);
    }
    return accumulator;
  }, []));
  const exactByBusinessNo = filterOpenDartMatchesByBusinessNo_(exactMatches, request.businessRegistrationNo, companyInfoCache);

  if (exactByBusinessNo.length === 1) return { corp: exactByBusinessNo[0], reason: 'exact_business_no' };
  if (hasBusinessNoConstraint && exactMatches.length && !exactByBusinessNo.length) return { corp: null, reason: 'business_no_mismatch' };
  if (exactMatches.length === 1) return { corp: exactMatches[0], reason: 'exact' };
  if (exactMatches.length > 1) {
    return {
      corp: null,
      reason: splitOpenDartEntityNames_(request.tenantMasterName).length > 1 ? 'multiple_entities' : 'ambiguous_exact',
    };
  }

  const fuzzyMatches = dedupeOpenDartCorps_(Object.keys(corpCodeMap).reduce(function (accumulator, key) {
    const matched = candidateKeys.some(function (candidate) {
      return candidate && candidate.length >= 4 && (key.indexOf(candidate) > -1 || candidate.indexOf(key) > -1);
    });
    if (matched) {
      Array.prototype.push.apply(accumulator, corpCodeMap[key]);
    }
    return accumulator;
  }, []));
  const fuzzyByBusinessNo = filterOpenDartMatchesByBusinessNo_(fuzzyMatches, request.businessRegistrationNo, companyInfoCache);

  if (fuzzyByBusinessNo.length === 1) return { corp: fuzzyByBusinessNo[0], reason: 'fuzzy_business_no' };
  if (hasBusinessNoConstraint && fuzzyMatches.length && !fuzzyByBusinessNo.length) return { corp: null, reason: 'business_no_mismatch' };
  if (fuzzyMatches.length === 1) return { corp: fuzzyMatches[0], reason: 'fuzzy' };
  if (fuzzyMatches.length > 1) return { corp: null, reason: 'ambiguous_fuzzy' };
  return { corp: null, reason: 'unmatched' };
}

function buildOpenDartNameCandidates_(normalizationRows) {
  const map = {};
  (normalizationRows || []).forEach(function (row) {
    const tenantId = safeString_(pickField_(row, ['tenant_id']));
    const businessRegistrationNo = safeString_(pickField_(row, ['business_registration_no', 'lookup_key'])).replace(/[^0-9]/g, '');
    [tenantId, businessRegistrationNo].filter(Boolean).forEach(function (bucketKey) {
      map[bucketKey] = map[bucketKey] || [];
      [
        pickField_(row, ['tenant_master_name']),
        pickField_(row, ['raw_name']),
        pickField_(row, ['lookup_key']),
      ].forEach(function (value) {
        buildOpenDartLookupVariants_(value).forEach(function (normalized) {
          if (normalized && map[bucketKey].indexOf(normalized) === -1) {
            map[bucketKey].push(normalized);
          }
        });
      });
    });
  });
  return map;
}

function fetchJsonWithMute_(url) {
  try {
    return JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText('UTF-8'));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return {
      status: '999',
      message: message,
      errorType: /권한|authorization|auth/i.test(message) ? 'AUTH_REQUIRED' : 'FETCH_ERROR',
    };
  }
}

function assertNoFetchAuthError_(response, sourceLabel) {
  if (!response) return;
  if (response.errorType === 'AUTH_REQUIRED') {
    throw new Error(`${sourceLabel} external_request authorization is required.`);
  }
}

function fetchOpenDartCorpCodeMap_() {
  const cached = getCachedJson_('opendart:corp-code-map:v2');
  if (cached) return cached;

  const config = getConfig_();
  const response = UrlFetchApp.fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(config.openDartApiKey)}`, { muteHttpExceptions: true });
  const unzip = Utilities.unzip(response.getBlob());
  const xml = XmlService.parse(unzip[0].getDataAsString('UTF-8'));
  const list = xml.getRootElement().getChildren('list');
  const map = {};

  list.forEach(function (item) {
    const corpName = item.getChildText('corp_name');
    const corpCode = item.getChildText('corp_code');
    if (corpName && corpCode) {
      const normalized = normalizeOpenDartLookup_(corpName);
      if (!normalized) return;
      map[normalized] = map[normalized] || [];
      map[normalized].push({ corp_code: corpCode, corp_name: corpName });
    }
  });

  return putCachedJson_('opendart:corp-code-map:v2', map, 86400);
}

function fetchOpenDartCompanyInfo_(corpCode) {
  const config = getConfig_();
  const url = `https://opendart.fss.or.kr/api/company.json?crtfc_key=${encodeURIComponent(config.openDartApiKey)}&corp_code=${corpCode}`;
  const response = fetchJsonWithMute_(url);
  logApiEvent_('OpenDART', 'company.json', corpCode, response.status === '000' ? 'ok' : 'error', response.message || response.status || '', '');
  return response.status === '000' ? response : {};
}

function buildOpenDartReviewNote_(reason) {
  switch (reason) {
    case 'multiple_entities':
      return '복수 기업명이 한 행에 있어 자동 OpenDART 연결을 보류했습니다.';
    case 'ambiguous_exact':
      return '동일한 기업명 후보가 복수라 사업자등록번호 등 추가 확인이 필요합니다.';
    case 'ambiguous_fuzzy':
      return '유사한 OpenDART 후보가 복수라 수동 확인이 필요합니다.';
    case 'business_no_mismatch':
      return 'OpenDART 후보는 있으나 사업자등록번호가 일치하지 않아 자동 연결을 보류했습니다.';
    default:
      return 'OpenDART 대상 법인을 찾지 못했습니다.';
  }
}

function isOpenDartRevenueAccount_(account, accountId) {
  return account.indexOf('revenue') > -1 ||
    account.indexOf('sales') > -1 ||
    account.indexOf('매출') > -1 ||
    account.indexOf('영업수익') > -1 ||
    accountId.indexOf('revenue') > -1 ||
    accountId.indexOf('sales') > -1;
}

function isOpenDartOperatingIncomeAccount_(account, accountId) {
  return (account.indexOf('operating') > -1 && account.indexOf('income') > -1) ||
    account.indexOf('영업이익') > -1 ||
    account.indexOf('영업손익') > -1 ||
    accountId.indexOf('operatingincome') > -1 ||
    accountId.indexOf('profitlossfromoperatingactivities') > -1;
}

function isOpenDartLiabilitiesAccount_(account, accountId) {
  return account.indexOf('liabil') > -1 ||
    account.indexOf('부채총계') > -1 ||
    accountId.indexOf('liabil') > -1;
}

function isOpenDartEquityAccount_(account, accountId) {
  return account.indexOf('equity') > -1 ||
    account.indexOf('자본총계') > -1 ||
    accountId.indexOf('equity') > -1;
}

function getOpenDartReportCodeCandidates_() {
  return ['11011', '11014', '11012', '11013'];
}

function getOpenDartQuarterReportCodeCandidatesLegacy_() {
  return ['11014', '11012', '11013'];
}

function getOpenDartQuarterReportCodeCandidates_() {
  return ['11014', '11012', '11013'];
}

function getOpenDartReportCodeLabel_(reportCode) {
  switch (reportCode) {
    case '11011':
      return '사업보고서';
    case '11012':
      return '반기보고서';
    case '11013':
      return '1분기보고서';
    case '11014':
      return '3분기보고서';
    default:
      return reportCode;
  }
}

function buildOpenDartCoverageLabel_(payload) {
  const yearText = payload && payload.checkedYears && payload.checkedYears.length
    ? `${payload.checkedYears[0]}~${payload.checkedYears[payload.checkedYears.length - 1]}`
    : '최근 연도';
  const reportLabels = uniqueValues_((payload && payload.checkedReportCodes ? payload.checkedReportCodes : []).map(getOpenDartReportCodeLabel_));
  return reportLabels.length ? `${yearText} ${reportLabels.join('/')}` : yearText;
}

function buildOpenDartTenantId_(tenantMasterName, businessRegistrationNo) {
  const normalizedBusinessNos = normalizeOpenDartBusinessNoList_(businessRegistrationNo);
  if (normalizedBusinessNos.length) {
    return `tenant_brn_${normalizedBusinessNos.join('')}`;
  }
  return makeDeterministicId_('tenant_name', [tenantMasterName]);
}

function iterateOpenDartFinanceRequestsLegacyA_(visitor) {
  const currentYear = new Date().getFullYear() - 1;
  for (let year = currentYear; year >= currentYear - 3; year -= 1) {
    if (visitor(String(year), '11011', 'CFS') === true) return true;
    if (visitor(String(year), '11011', 'OFS') === true) return true;
    const quarterCodes = getOpenDartQuarterReportCodeCandidates_();
    for (let index = 0; index < quarterCodes.length; index += 1) {
      const reportCode = quarterCodes[index];
      if (visitor(String(year), reportCode, 'CFS') === true) return true;
      if (visitor(String(year), reportCode, 'OFS') === true) return true;
    }
  }
  return false;
}

function iterateOpenDartEmployeeRequestsLegacyA_(visitor) {
  const currentYear = new Date().getFullYear() - 1;
  for (let year = currentYear; year >= currentYear - 3; year -= 1) {
    if (visitor(String(year), '11011') === true) return true;
    const quarterCodes = getOpenDartQuarterReportCodeCandidates_();
    for (let index = 0; index < quarterCodes.length; index += 1) {
      if (visitor(String(year), quarterCodes[index]) === true) return true;
    }
  }
  return false;
}

function iterateOpenDartFinanceRequests_(visitor) {
  const currentYear = new Date().getFullYear() - 1;
  for (let year = currentYear; year >= currentYear - 3; year -= 1) {
    if (visitor(String(year), '11011', 'CFS') === true) return true;
    if (visitor(String(year), '11011', 'OFS') === true) return true;
    const quarterCodes = getOpenDartQuarterReportCodeCandidates_();
    for (let index = 0; index < quarterCodes.length; index += 1) {
      const reportCode = quarterCodes[index];
      if (visitor(String(year), reportCode, 'CFS') === true) return true;
      if (visitor(String(year), reportCode, 'OFS') === true) return true;
    }
  }
  return false;
}

function iterateOpenDartEmployeeRequests_(visitor) {
  const currentYear = new Date().getFullYear() - 1;
  for (let year = currentYear; year >= currentYear - 3; year -= 1) {
    if (visitor(String(year), '11011') === true) return true;
    const quarterCodes = getOpenDartQuarterReportCodeCandidates_();
    for (let index = 0; index < quarterCodes.length; index += 1) {
      if (visitor(String(year), quarterCodes[index]) === true) return true;
    }
  }
  return false;
}

function buildOpenDartNoResponseNoteLegacy_(target) {
  if (target === 'finance') {
    return 'OpenDART 공식 무응답(013): 재무 공시 없음. 11011 우선, 없으면 11014→11012→11013 / CFS 우선 후 OFS 조회.';
  }
  return 'OpenDART 공식 무응답(013): 종업원수 공시 없음. 11011 우선, 없으면 11014→11012→11013 조회.';
}

function buildOpenDartErrorNoteLegacy_(target, payload) {
  const label = target === 'finance' ? '재무' : '종업원수';
  return `OpenDART 응답 ${safeString_(payload && payload.status) || 'unknown'}: ${label} 값을 적재하지 못했습니다.`;
}

function selectOpenDartEmployeeTotalRowLegacy_(items) {
  const rows = (items || []).filter(Boolean);
  return rows.find(function (item) {
    return normalizeWhitespace_(item.fo_bbm) === '성별합계';
  }) || null;
}

function fetchOpenDartFinanceInfoLegacy_(corpCode) {
  const config = getConfig_();
  const currentYear = new Date().getFullYear() - 1;
  const checkedYears = [];
  const checkedReportCodes = [];
  let lastStatus = '013';
  let lastMessage = '조회된 데이타가 없습니다.';

  for (let year = currentYear; year >= currentYear - 3; year -= 1) {
    checkedYears.push(String(year));
    const reportCodes = getOpenDartReportCodeCandidates_();
    for (let reportIndex = 0; reportIndex < reportCodes.length; reportIndex += 1) {
      const reportCode = reportCodes[reportIndex];
      checkedReportCodes.push(reportCode);
      const fsDivisions = ['CFS', 'OFS'];
      for (let index = 0; index < fsDivisions.length; index += 1) {
        const fsDiv = fsDivisions[index];
        const url = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=${encodeURIComponent(config.openDartApiKey)}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${reportCode}&fs_div=${fsDiv}`;
        const response = fetchJsonWithMute_(url);
        logApiEvent_('OpenDART', 'fnlttSinglAcntAll.json', corpCode, response.status === '000' ? 'ok' : 'error', response.message || response.status || '', '');
        if (response.status !== '000' || !response.list || !response.list.length) {
          lastStatus = response.status || lastStatus;
          lastMessage = response.message || response.status || lastMessage;
          continue;
        }

        let revenue = null;
        let operatingIncome = null;
        let liabilities = null;
        let equity = null;
        response.list.forEach(function (item) {
          const account = safeString_(item.account_nm).toLowerCase();
          const accountId = safeString_(item.account_id).toLowerCase();
          const amount = toNumber_(item.thstrm_amount);
          if (revenue == null && isOpenDartRevenueAccount_(account, accountId)) revenue = amount;
          if (operatingIncome == null && isOpenDartOperatingIncomeAccount_(account, accountId)) operatingIncome = amount;
          if (liabilities == null && isOpenDartLiabilitiesAccount_(account, accountId)) liabilities = amount;
          if (equity == null && isOpenDartEquityAccount_(account, accountId)) equity = amount;
        });

        return {
          status: '000',
          message: '',
          year: String(year),
          fsDiv: fsDiv,
          reportCode: reportCode,
          revenue: revenue,
          operatingIncome: operatingIncome,
          debtRatio: liabilities != null && equity ? roundNumber_((liabilities / equity) * 100, 2) : null,
          checkedYears: checkedYears.slice(),
          checkedReportCodes: uniqueValues_(checkedReportCodes.slice()),
        };
      }
    }
  }

  return {
    status: lastStatus,
    message: lastMessage,
    year: '',
    fsDiv: '',
    reportCode: '',
    revenue: null,
    operatingIncome: null,
    debtRatio: null,
    checkedYears: checkedYears,
    checkedReportCodes: uniqueValues_(checkedReportCodes),
  };
}

function fetchOpenDartEmployeeInfoLegacy_(corpCode) {
  const config = getConfig_();
  const currentYear = new Date().getFullYear() - 1;
  const checkedYears = [];
  const checkedReportCodes = [];
  let lastStatus = '013';
  let lastMessage = '조회된 데이타가 없습니다.';

  for (let year = currentYear; year >= currentYear - 3; year -= 1) {
    checkedYears.push(String(year));
    const reportCodes = getOpenDartReportCodeCandidates_();
    for (let reportIndex = 0; reportIndex < reportCodes.length; reportIndex += 1) {
      const reportCode = reportCodes[reportIndex];
      checkedReportCodes.push(reportCode);
      const url = `https://opendart.fss.or.kr/api/empSttus.json?crtfc_key=${encodeURIComponent(config.openDartApiKey)}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${reportCode}`;
      const response = fetchJsonWithMute_(url);
      logApiEvent_('OpenDART', 'empSttus.json', corpCode, response.status === '000' ? 'ok' : 'error', response.message || response.status || '', '');
      if (response.status !== '000' || !response.list || !response.list.length) {
        lastStatus = response.status || lastStatus;
        lastMessage = response.message || response.status || lastMessage;
        continue;
      }
      return {
        status: '000',
        message: '',
        year: String(year),
        reportCode: reportCode,
        employeeCount: (function () {
          const totalRow = selectOpenDartEmployeeTotalRow_(response.list);
          if (totalRow) return toNumber_(totalRow.sm) || null;
          return response.list.reduce(function (sum, item) {
            return sum + (toNumber_(item.sm) || 0);
          }, 0) || null;
        })(),
        checkedYears: checkedYears.slice(),
        checkedReportCodes: uniqueValues_(checkedReportCodes.slice()),
      };
    }
  }

  return {
    status: lastStatus,
    message: lastMessage,
    year: '',
    reportCode: '',
    employeeCount: null,
    checkedYears: checkedYears,
    checkedReportCodes: uniqueValues_(checkedReportCodes),
  };
}

function formatOpenDartCheckedYears_(checkedYears) {
  return (checkedYears || []).join('~');
}

function buildOpenDartMatchedReviewNotesLegacy_(request, corpPayload) {
  const notes = [];
  if (splitOpenDartEntityNames_(request.tenantMasterName).length > 1) {
    notes.push('복수 기업명이 함께 입력되어 대표 법인 기준으로 연결했습니다.');
  }
  if (corpPayload.finance && corpPayload.finance.status && corpPayload.finance.status !== '000') {
    notes.push(corpPayload.finance.status === '013'
      ? buildOpenDartNoResponseNote_('finance')
      : buildOpenDartErrorNote_('finance', corpPayload.finance));
  }
  if (corpPayload.employee && corpPayload.employee.status && corpPayload.employee.status !== '000') {
    notes.push(corpPayload.employee.status === '013'
      ? buildOpenDartNoResponseNote_('employee')
      : buildOpenDartErrorNote_('employee', corpPayload.employee));
  }
  return uniqueValues_(notes.filter(Boolean));
}

function resolveOpenDartEffectivePayload_(tenantMasterName, corpPayload) {
  const documentPayload = safeGet_(corpPayload, ['document']) || null;
  const effective = {
    revenue: firstDefinedNumber_(safeGet_(corpPayload, ['finance', 'revenue']), safeGet_(documentPayload, ['revenue'])),
    operatingIncome: firstDefinedNumber_(safeGet_(corpPayload, ['finance', 'operatingIncome']), safeGet_(documentPayload, ['operatingIncome'])),
    debtRatio: firstDefinedNumber_(safeGet_(corpPayload, ['finance', 'debtRatio']), safeGet_(documentPayload, ['debtRatio'])),
    employeeCount: firstDefinedNumber_(safeGet_(corpPayload, ['employee', 'employeeCount']), safeGet_(documentPayload, ['employeeCount'])),
    year: firstNonEmptyValue_(safeGet_(corpPayload, ['finance', 'year']), safeGet_(documentPayload, ['year'])),
    fsDiv: firstNonEmptyValue_(safeGet_(corpPayload, ['finance', 'fsDiv']), safeGet_(documentPayload, ['fsDiv'])),
    reviewNotes: buildOpenDartMatchedReviewNotes_({ tenantMasterName: tenantMasterName }, corpPayload),
  };
  if (documentPayload && documentPayload.status === '000' && (effective.revenue != null || effective.operatingIncome != null || effective.employeeCount != null)) {
    effective.reviewNotes = [];
    if (splitOpenDartEntityNames_(tenantMasterName).length > 1) {
      effective.reviewNotes.push('복수 기업명이 함께 입력되어 대표 법인 기준으로 연결했습니다.');
    }
    effective.reviewNotes.push(`DART 원문 ${safeGet_(documentPayload, ['reportName']) || '문서'} 기준 적재(접수번호 ${safeGet_(documentPayload, ['rceptNo']) || '-'})`);
  }
  return effective;
}

function syncOpenDartDataBasicLegacy_() {
  const config = getConfig_();
  const spreadsheet = getSpreadsheet_();
  const companySheet = spreadsheet.getSheetByName(config.sheetNames.company);
  const existingRowCount = companySheet.getLastRow();
  const rows = companySheet.getRange(1, 1, existingRowCount, companySheet.getLastColumn()).getDisplayValues();
  if (rows.length < 2) return { updated: 0, unmatched: 0 };

  const headers = rows[0];
  const idx = headerIndexes_(headers);
  const corpCodeMap = fetchOpenDartCorpCodeMap_();
  const normalizationRows = loadObjectsFromSheet_(spreadsheet, config.sheetNames.sysTenantNormalize);
  const candidateMap = buildOpenDartNameCandidates_(normalizationRows);
  const corpCompanyInfoCache = {};
  const corpResponseCache = {};
  const output = [];
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  let updated = 0;
  let unmatched = 0;

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index].slice();
    const tenantId = readRowCell_(row, idx, ['tenant_id']);
    const tenantMasterName = readRowCell_(row, idx, ['tenant_master_name', 'raw_name', 'tenant_name', '표준기업명']);
    const businessRegistrationNo = readRowCell_(row, idx, ['business_registration_no', '사업자등록번호']);
    if (!tenantMasterName && !businessRegistrationNo) continue;
    const resolvedTenantId = tenantId || buildOpenDartTenantId_(tenantMasterName, businessRegistrationNo);
    if (!tenantMasterName) {
      writeRowCell_(row, idx, ['tenant_id'], resolvedTenantId);
      output.push(row);
      continue;
    }

    const match = resolveOpenDartCorpMatch_(corpCodeMap, candidateMap, {
      tenantId: tenantId,
      tenantMasterName: tenantMasterName,
      businessRegistrationNo: businessRegistrationNo,
    }, corpCompanyInfoCache);
    const corp = match.corp;

    if (!corp) {
      writeRowCell_(row, idx, ['tenant_id'], resolvedTenantId);
      writeRowCell_(row, idx, ['match_status'], 'unmatched');
      writeRowCell_(row, idx, ['fetched_at'], today);
      writeRowCell_(row, idx, ['review_status'], 'review_required');
      writeRowCell_(row, idx, ['review_note'], buildOpenDartReviewNote_(match.reason));
      unmatched += 1;
      output.push(row);
      continue;
    }

    if (!corpResponseCache[corp.corp_code]) {
      const finance = fetchOpenDartFinanceInfo_(corp.corp_code);
      const employee = fetchOpenDartEmployeeInfo_(corp.corp_code);
      corpResponseCache[corp.corp_code] = {
        company: fetchOpenDartCompanyInfo_(corp.corp_code),
        finance: finance,
        employee: employee,
        document: (finance.status && finance.status !== '000') || (employee.status && employee.status !== '000')
          ? fetchOpenDartDocumentFallback_(corp.corp_code)
          : null,
      };
    }

    const corpPayload = corpResponseCache[corp.corp_code];
    const effective = resolveOpenDartEffectivePayload_(tenantMasterName, corpPayload);
    writeRowCell_(row, idx, ['tenant_id'], resolvedTenantId);
    writeRowCell_(row, idx, ['dart_corp_code'], corp.corp_code);
    writeRowCell_(row, idx, ['match_status'], 'matched');
    writeRowCellPreserve_(row, idx, ['corp_registration_no'], safeGet_(corpPayload, ['company', 'jurir_no']));
    writeRowCellPreserve_(row, idx, ['industry_code'], safeGet_(corpPayload, ['company', 'induty_code']));
    writeRowCellPreserve_(row, idx, ['headquarters_address'], safeGet_(corpPayload, ['company', 'adres']));
    writeRowCell_(row, idx, ['listed_yn'], safeGet_(corpPayload, ['company', 'stock_name']) ? 'Y' : 'N');
    writeRowCellPreserve_(row, idx, ['latest_financial_year', '최근 재무제표 연도'], effective.year);
    writeRowCellPreserve_(row, idx, ['financial_statement_type', '연결_별도_여부'], effective.fsDiv);
    writeRowCellPreserve_(row, idx, ['latest_revenue'], effective.revenue);
    writeRowCellPreserve_(row, idx, ['latest_operating_income'], effective.operatingIncome);
    writeRowCellPreserve_(row, idx, ['latest_debt_ratio'], effective.debtRatio);
    writeRowCellPreserve_(row, idx, ['latest_employee_count'], effective.employeeCount);
    writeRowCell_(row, idx, ['fetched_at'], today);
    writeRowCell_(row, idx, ['review_status'], effective.reviewNotes.length ? 'review_required' : 'ok');
    writeRowCell_(row, idx, ['review_note'], effective.reviewNotes.join(' | '));
    updated += 1;
    output.push(row);
  }

  companySheet.getRange(1, 1, output.length + 1, headers.length).setValues([headers].concat(output));
  if (existingRowCount > output.length + 1) {
    companySheet.getRange(output.length + 2, 1, existingRowCount - output.length - 1, headers.length).clearContent();
  }
  logApiEvent_('OpenDART', 'syncOpenDartData', 'DB_COMPANY', unmatched ? 'partial' : 'ok', updated + ' rows updated / ' + unmatched + ' unmatched', '');
  markDataDirty_('sync_open_dart');
  invalidateDashboardCaches_();
  return { updated: updated, unmatched: unmatched };
}

function syncOpenDartDataLegacy_() {
  const config = getConfig_();
  const spreadsheet = getSpreadsheet_();
  const companySheet = spreadsheet.getSheetByName(config.sheetNames.company);
  const rows = companySheet.getRange(1, 1, companySheet.getLastRow(), companySheet.getLastColumn()).getDisplayValues();
  if (rows.length < 2) return { updated: 0, unmatched: 0 };

  const headers = rows[0];
  const idx = headerIndexes_(headers);
  const corpCodeMap = fetchOpenDartCorpCodeMap_();
  const normalizationRows = loadObjectsFromSheet_(spreadsheet, config.sheetNames.sysTenantNormalize);
  const candidateMap = buildOpenDartNameCandidates_(normalizationRows);
  const corpCompanyInfoCache = {};
  const corpResponseCache = {};
  const output = [];
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  let updated = 0;
  let unmatched = 0;

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index].slice();
    const tenantId = readRowCell_(row, idx, ['tenant_id']);
    const tenantMasterName = readRowCell_(row, idx, ['tenant_master_name', 'raw_name', 'tenant_name', '표준기업명']);
    const businessRegistrationNo = readRowCell_(row, idx, ['business_registration_no', '사업자등록번호']);
    if (!tenantMasterName && !businessRegistrationNo) continue;

    const resolvedTenantId = tenantId || buildOpenDartTenantId_(tenantMasterName, businessRegistrationNo);
    if (!tenantMasterName) {
      writeRowCell_(row, idx, ['tenant_id'], resolvedTenantId);
      output.push(row);
      continue;
    }

    const match = resolveOpenDartCorpMatch_(corpCodeMap, candidateMap, {
      tenantId: tenantId,
      tenantMasterName: tenantMasterName,
      businessRegistrationNo: businessRegistrationNo,
    }, corpCompanyInfoCache);
    const corp = match.corp;

    if (!corp) {
      writeRowCell_(row, idx, ['tenant_id'], resolvedTenantId);
      writeRowCell_(row, idx, ['match_status'], 'unmatched');
      writeRowCell_(row, idx, ['fetched_at'], today);
      writeRowCell_(row, idx, ['review_status'], 'review_required');
      writeRowCell_(row, idx, ['review_note'], buildOpenDartReviewNote_(match.reason));
      unmatched += 1;
      output.push(row);
      continue;
    }

    if (!corpResponseCache[corp.corp_code]) {
      corpResponseCache[corp.corp_code] = {
        company: fetchOpenDartCompanyInfo_(corp.corp_code),
        finance: fetchOpenDartFinanceInfo_(corp.corp_code),
        employee: fetchOpenDartEmployeeInfo_(corp.corp_code),
      };
    }

    const corpPayload = corpResponseCache[corp.corp_code];
    const reviewNotes = buildOpenDartMatchedReviewNotes_({
      tenantMasterName: tenantMasterName,
      businessRegistrationNo: businessRegistrationNo,
    }, corpPayload);

    writeRowCell_(row, idx, ['tenant_id'], resolvedTenantId);
    writeRowCell_(row, idx, ['dart_corp_code'], corp.corp_code);
    writeRowCell_(row, idx, ['match_status'], 'matched');
    writeRowCellPreserve_(row, idx, ['corp_registration_no'], corpPayload.company.jurir_no);
    writeRowCellPreserve_(row, idx, ['industry_code'], corpPayload.company.induty_code);
    writeRowCellPreserve_(row, idx, ['headquarters_address'], corpPayload.company.adres);
    writeRowCell_(row, idx, ['listed_yn'], corpPayload.company.stock_name ? 'Y' : 'N');
    writeRowCellPreserve_(row, idx, ['latest_financial_year', '최근 재무제표 연도'], corpPayload.finance.year);
    writeRowCellPreserve_(row, idx, ['financial_statement_type', '연결_별도_여부'], corpPayload.finance.fsDiv);
    writeRowCellPreserve_(row, idx, ['latest_revenue'], corpPayload.finance.revenue);
    writeRowCellPreserve_(row, idx, ['latest_operating_income'], corpPayload.finance.operatingIncome);
    writeRowCellPreserve_(row, idx, ['latest_debt_ratio'], corpPayload.finance.debtRatio);
    writeRowCellPreserve_(row, idx, ['latest_employee_count'], corpPayload.employee.employeeCount);
    writeRowCell_(row, idx, ['fetched_at'], today);
    writeRowCell_(row, idx, ['review_status'], reviewNotes.length ? 'review_required' : 'ok');
    writeRowCell_(row, idx, ['review_note'], reviewNotes.join(' | '));
    updated += 1;
    output.push(row);
  }

  companySheet.getRange(1, 1, output.length + 1, headers.length).setValues([headers].concat(output));
  logApiEvent_('OpenDART', 'syncOpenDartData', 'DB_COMPANY', unmatched ? 'partial' : 'ok', updated + ' rows updated / ' + unmatched + ' unmatched', '');
  markDataDirty_('sync_open_dart');
  invalidateDashboardCaches_();
  return { updated: updated, unmatched: unmatched };
}

function headerIndexes_(headers) {
  return (headers || []).reduce(function (accumulator, header, index) {
    accumulator[header] = index;
    return accumulator;
  }, {});
}

function resolveHeaderIndex_(idx, preferredHeaders) {
  for (let index = 0; index < preferredHeaders.length; index += 1) {
    const key = preferredHeaders[index];
    if (idx[key] != null) return idx[key];
  }

  const keys = Object.keys(idx);
  for (let preferredIndex = 0; preferredIndex < preferredHeaders.length; preferredIndex += 1) {
    const preferred = preferredHeaders[preferredIndex];
    const lowerPreferred = preferred.toLowerCase();
    const matched = keys.find(function (key) {
      return String(key).toLowerCase() === lowerPreferred;
    });
    if (matched != null) return idx[matched];
  }

  return null;
}

function readRowCell_(row, idx, preferredHeaders) {
  const resolved = resolveHeaderIndex_(idx, preferredHeaders);
  if (resolved != null) return safeString_(row[resolved]);
  return '';
}

function writeRowCell_(row, idx, preferredHeaders, value) {
  const resolved = resolveHeaderIndex_(idx, preferredHeaders);
  if (resolved != null) {
    row[resolved] = value;
  }
}

function writeRowCellPreserve_(row, idx, preferredHeaders, value) {
  if (value == null || value === '') return;
  writeRowCell_(row, idx, preferredHeaders, value);
}

function buildBuildingLookupIndex_(rows) {
  const index = {};
  (rows || []).forEach(function (row) {
    const payload = {
      assetId: safeString_(pickField_(row, ['asset_id'])),
      assetCode: safeString_(pickField_(row, ['asset_code'])),
      assetName: safeString_(pickField_(row, ['asset_name'])),
      lookupAddress: safeString_(pickField_(row, ['lookup_address'])),
      queryKey: safeString_(pickField_(row, ['query_key'])),
      note: safeString_(pickField_(row, ['note'])),
      sigunguCd: safeString_(pickField_(row, ['sigunguCd'])),
      bjdongCd: safeString_(pickField_(row, ['bjdongCd'])),
      platGbCd: safeString_(pickField_(row, ['platGbCd'])),
      bun: safeString_(pickField_(row, ['bun'])),
      ji: safeString_(pickField_(row, ['ji'])),
      latitude: safeString_(pickField_(row, ['latitude'])),
      longitude: safeString_(pickField_(row, ['longitude'])),
      geocodeStatus: safeString_(pickField_(row, ['geocode_status'])),
      buildingHubStatus: safeString_(pickField_(row, ['building_hub_status'])),
    };
    [payload.assetId, payload.assetCode, normalizeAssetLookup_(payload.assetName)].forEach(function (key) {
      if (key) index[key] = payload;
    });
  });
  return index;
}

function resolveBuildingLookupCandidate_(row, idx, lookupIndex) {
  return lookupIndex[readRowCell_(row, idx, ['asset_id'])] ||
    lookupIndex[readRowCell_(row, idx, ['asset_code', '자산코드'])] ||
    lookupIndex[normalizeAssetLookup_(readRowCell_(row, idx, ['asset_name', '자산명']))] ||
    null;
}

function resolveBuildingLookupCandidateByAlias_(row, idx, lookupIndex) {
  return resolveBuildingLookupCandidate_(row, idx, lookupIndex);
}

function resolveBuildingRegisterQuery_(row, idx, lookup) {
  const parsedList = parseBuildingQueryKeys_(lookup && lookup.queryKey);
  if (parsedList.length > 1) return parsedList;
  if (parsedList.length === 1) return parsedList[0];

  if (lookup && lookup.sigunguCd && lookup.bjdongCd) {
    return {
      sigunguCd: lookup.sigunguCd,
      bjdongCd: lookup.bjdongCd,
      platGbCd: lookup.platGbCd || '0',
      bun: lookup.bun || '',
      ji: lookup.ji || '',
    };
  }

  const fromRow = {
    sigunguCd: readRowCell_(row, idx, ['sigunguCd']),
    bjdongCd: readRowCell_(row, idx, ['bjdongCd']),
    platGbCd: readRowCell_(row, idx, ['platGbCd']) || '0',
    bun: readRowCell_(row, idx, ['bun']),
    ji: readRowCell_(row, idx, ['ji']),
  };
  if (fromRow.sigunguCd && fromRow.bjdongCd) return fromRow;
  return null;
}

function resolveBuildingRegisterQueryByAlias_(row, idx, lookup) {
  return resolveBuildingRegisterQuery_(row, idx, lookup);
}

function parseBuildingQueryKey_(value) {
  const raw = safeString_(value);
  if (!raw) return null;
  const primary = raw.split('||')[0];
  const parts = primary.split('|').map(function (item) { return safeString_(item).trim(); });
  if (parts.length < 2) return null;
  if (!/^\d{5}$/.test(parts[0]) || !/^\d{5}$/.test(parts[1])) return null;
  if (parts[2] && !/^\d+$/.test(parts[2])) return null;
  if (parts[3] && !/^\d+$/.test(parts[3])) return null;
  if (parts[4] && !/^\d+$/.test(parts[4])) return null;
  return {
    sigunguCd: parts[0],
    bjdongCd: parts[1],
    platGbCd: parts[2] || '0',
    bun: parts[3] || '',
    ji: parts[4] || '',
  };
}

function parseBuildingQueryKeys_(value) {
  const raw = safeString_(value);
  if (!raw) return [];
  return raw
    .split('||')
    .map(function (item) { return parseBuildingQueryKey_(item); })
    .filter(Boolean);
}

function buildBuildingQueryKeyLegacy_(query) {
  if (Array.isArray(query)) {
    return query.map(function (item) {
      return buildBuildingQueryKey_(item);
    }).filter(Boolean).join('||');
  }
  if (!query || !query.sigunguCd || !query.bjdongCd) return '';
  return [
    safeString_(query.sigunguCd),
    safeString_(query.bjdongCd),
    safeString_(query.platGbCd || '0'),
    safeString_(query.bun),
    safeString_(query.ji),
  ].join('|');
}

function ensureAssetLookupHeaders_(lookupSheet) {
  if (!lookupSheet) return;
  const requiredHeaders = ['sigunguCd', 'bjdongCd', 'platGbCd', 'bun', 'ji'];
  const headers = lookupSheet.getRange(1, 1, 1, lookupSheet.getLastColumn()).getDisplayValues()[0];
  const missing = requiredHeaders.filter(function (header) {
    return headers.indexOf(header) === -1;
  });
  if (!missing.length) return;
  lookupSheet.insertColumnsAfter(lookupSheet.getLastColumn(), missing.length);
  lookupSheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
}

function parseBuildingRegisterResponse_(response) {
  const header = (((response || {}).response || {}).header) || {};
  const body = (((response || {}).response || {}).body) || {};
  const itemsNode = body.items || {};
  const rawItems = Object.prototype.hasOwnProperty.call(itemsNode, 'item') ? itemsNode.item : [];
  const items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
  return {
    ok: header.resultCode === '00',
    resultCode: safeString_(header.resultCode || response.status),
    resultMsg: safeString_(header.resultMsg || response.message),
    totalCount: Number(body.totalCount || items.length || 0),
    items: items,
  };
}

function fetchBuildingRegisterEndpointItems_(endpoint, query, options) {
  const config = getConfig_();
  const normalizedQuery = query || {};
  const pageSize = Number((options || {}).numOfRows || 100);
  const maxPages = Number((options || {}).maxPages || 20);
  const items = [];
  let pageNo = 1;
  let lastParsed = { ok: false, resultCode: '', resultMsg: '', totalCount: 0, items: [] };

  while (pageNo <= maxPages) {
    const params = [
      `serviceKey=${config.buildingRegisterApiKeyEncoded || config.buildingHubApiKey}`,
      `sigunguCd=${encodeURIComponent(normalizedQuery.sigunguCd || '')}`,
      `bjdongCd=${encodeURIComponent(normalizedQuery.bjdongCd || '')}`,
      `platGbCd=${encodeURIComponent(normalizedQuery.platGbCd || '0')}`,
      `bun=${encodeURIComponent(normalizedQuery.bun || '')}`,
      `ji=${encodeURIComponent(normalizedQuery.ji || '')}`,
      '_type=json',
      `numOfRows=${pageSize}`,
      `pageNo=${pageNo}`,
    ].join('&');
    const url = `https://apis.data.go.kr/1613000/BldRgstHubService/${endpoint}?${params}`;
    const response = fetchJsonWithMute_(url);
    const parsed = parseBuildingRegisterResponse_(response);
    const queryKey = buildBuildingQueryKey_(normalizedQuery) || [normalizedQuery.sigunguCd, normalizedQuery.bjdongCd, normalizedQuery.bun, normalizedQuery.ji].filter(Boolean).join('|');
    logApiEvent_(
      'BuildingRegister',
      endpoint,
      queryKey,
      parsed.ok ? 'ok' : 'error',
      parsed.ok ? `totalCount=${parsed.totalCount}` : `${parsed.resultCode || 'ERR'} ${parsed.resultMsg || ''}`.trim(),
      ''
    );
    lastParsed = parsed;
    if (!parsed.ok) break;
    Array.prototype.push.apply(items, parsed.items);
    if (!parsed.totalCount || parsed.items.length === 0 || items.length >= parsed.totalCount) break;
    pageNo += 1;
  }

  return {
    endpoint: endpoint,
    ok: !!lastParsed.ok,
    resultCode: lastParsed.resultCode,
    resultMsg: lastParsed.resultMsg,
    totalCount: Number(lastParsed.totalCount || items.length || 0),
    items: items,
  };
}

function buildEmptyBuildingQueryAggregate_(query) {
  return {
    query: query || null,
    approvalDate: '',
    grossFloorArea: null,
    landArea: null,
    maxGround: 0,
    maxUnderground: 0,
    buildingNames: [],
    areaRowsFound: 0,
  };
}

function pushUniqueValue_(bucket, value) {
  const normalized = safeString_(value);
  if (!normalized) return;
  if (bucket.indexOf(normalized) === -1) bucket.push(normalized);
}

function buildFloorCountText_(groundCount, undergroundCount) {
  return [
    groundCount ? `${groundCount}F` : '',
    undergroundCount ? `B${undergroundCount}` : '',
  ].filter(Boolean).join(' / ');
}

function aggregateTitleItemsForQuery_(query, items) {
  const aggregate = buildEmptyBuildingQueryAggregate_(query);
  let grossFloorArea = 0;
  let hasGrossFloorArea = false;
  let landArea = 0;

  (items || []).forEach(function (item) {
    const totalArea = Number(item.totArea || 0);
    const platArea = Number(item.platArea || 0);
    if (totalArea > 0) {
      grossFloorArea += totalArea;
      hasGrossFloorArea = true;
    }
    if (platArea > 0) {
      landArea = Math.max(landArea, platArea);
    }
    aggregate.approvalDate = safeString_(item.useAprDay || aggregate.approvalDate);
    aggregate.maxGround = Math.max(aggregate.maxGround, Number(item.grndFlrCnt || 0));
    aggregate.maxUnderground = Math.max(aggregate.maxUnderground, Number(item.ugrndFlrCnt || 0));
    pushUniqueValue_(aggregate.buildingNames, item.bldNm || item.dongNm);
  });

  aggregate.grossFloorArea = hasGrossFloorArea ? grossFloorArea : null;
  aggregate.landArea = landArea > 0 ? landArea : null;
  return aggregate;
}

function aggregateRecapItemsForQuery_(query, items) {
  const aggregate = buildEmptyBuildingQueryAggregate_(query);
  let landArea = 0;

  (items || []).forEach(function (item) {
    const totalArea = Number(item.totArea || 0);
    const platArea = Number(item.platArea || 0);
    if (aggregate.grossFloorArea == null && totalArea > 0) aggregate.grossFloorArea = totalArea;
    if (platArea > 0) landArea = Math.max(landArea, platArea);
    aggregate.approvalDate = safeString_(item.useAprDay || aggregate.approvalDate);
    pushUniqueValue_(aggregate.buildingNames, item.bldNm || item.dongNm);
  });

  aggregate.landArea = landArea > 0 ? landArea : null;
  return aggregate;
}

function aggregateFloorItemsForQuery_(query, items) {
  const aggregate = buildEmptyBuildingQueryAggregate_(query);
  let grossFloorArea = 0;
  let hasGrossFloorArea = false;

  (items || []).forEach(function (item) {
    const area = Number(item.area || 0);
    const floorNo = Math.abs(Number(item.flrNo || 0));
    const floorGb = safeString_(item.flrGbCd || item.flrGbCdNm);
    if (area > 0) {
      grossFloorArea += area;
      hasGrossFloorArea = true;
    }
    if (floorGb === '10' || floorGb.indexOf('지하') > -1) {
      aggregate.maxUnderground = Math.max(aggregate.maxUnderground, floorNo);
    } else {
      aggregate.maxGround = Math.max(aggregate.maxGround, floorNo);
    }
    pushUniqueValue_(aggregate.buildingNames, item.bldNm || item.dongNm);
  });

  aggregate.grossFloorArea = hasGrossFloorArea ? grossFloorArea : null;
  return aggregate;
}

function aggregateExposPubuseItemsForQuery_(query, items) {
  const aggregate = buildEmptyBuildingQueryAggregate_(query);
  aggregate.areaRowsFound = (items || []).length;

  (items || []).forEach(function (item) {
    const floorNo = Math.abs(Number(item.flrNo || 0));
    const floorGb = safeString_(item.flrGbCd || item.flrGbCdNm);
    if (floorGb === '10' || floorGb.indexOf('지하') > -1) {
      aggregate.maxUnderground = Math.max(aggregate.maxUnderground, floorNo);
    } else {
      aggregate.maxGround = Math.max(aggregate.maxGround, floorNo);
    }
    pushUniqueValue_(aggregate.buildingNames, item.bldNm || item.dongNm);
  });

  return aggregate;
}

function mergeBuildingQueryAggregate_(base, incoming) {
  const next = buildEmptyBuildingQueryAggregate_((base && base.query) || (incoming && incoming.query) || null);
  next.approvalDate = safeString_((base && base.approvalDate) || (incoming && incoming.approvalDate));
  next.grossFloorArea = base && base.grossFloorArea != null ? base.grossFloorArea : (incoming ? incoming.grossFloorArea : null);
  next.landArea = base && base.landArea != null ? base.landArea : (incoming ? incoming.landArea : null);
  next.maxGround = Math.max(Number((base && base.maxGround) || 0), Number((incoming && incoming.maxGround) || 0));
  next.maxUnderground = Math.max(Number((base && base.maxUnderground) || 0), Number((incoming && incoming.maxUnderground) || 0));
  next.areaRowsFound = Number((base && base.areaRowsFound) || 0) + Number((incoming && incoming.areaRowsFound) || 0);
  []
    .concat((base && base.buildingNames) || [])
    .concat((incoming && incoming.buildingNames) || [])
    .forEach(function (name) {
      pushUniqueValue_(next.buildingNames, name);
    });
  return next;
}

function getMissingBuildingFields_(aggregate) {
  const missing = [];
  if (!aggregate || !(aggregate.buildingNames || []).length) missing.push('건물명');
  if (!aggregate || !safeString_(aggregate.approvalDate)) missing.push('사용승인일');
  if (!aggregate || aggregate.grossFloorArea == null) missing.push('연면적');
  if (!aggregate || aggregate.landArea == null) missing.push('대지면적');
  if (!aggregate || (!Number(aggregate.maxGround || 0) && !Number(aggregate.maxUnderground || 0))) missing.push('층수');
  return missing;
}

function hasAnyBuildingAggregateValue_(aggregate) {
  if (!aggregate) return false;
  return !!(
    safeString_(aggregate.approvalDate) ||
    aggregate.grossFloorArea != null ||
    aggregate.landArea != null ||
    Number(aggregate.maxGround || 0) ||
    Number(aggregate.maxUnderground || 0) ||
    (aggregate.buildingNames || []).length
  );
}

function buildAttachedQueriesFromItems_(items) {
  const unique = {};
  (items || []).forEach(function (item) {
    const query = {
      sigunguCd: safeString_(item.atchSigunguCd),
      bjdongCd: safeString_(item.atchBjdongCd),
      platGbCd: safeString_(item.atchPlatGbCd) || '0',
      bun: safeString_(item.atchBun),
      ji: safeString_(item.atchJi),
    };
    const key = buildBuildingQueryKey_(query);
    if (key) unique[key] = query;
  });
  return Object.keys(unique).map(function (key) { return unique[key]; });
}

function summarizeBuildingEndpointCounts_(counts, includeZero) {
  const entries = [
    ['표제부', Number((counts || {}).title || 0)],
    ['총괄표제부', Number((counts || {}).recap || 0)],
    ['층별개요', Number((counts || {}).floor || 0)],
    ['전유공용면적', Number((counts || {}).area || 0)],
    ['부속지번', Number((counts || {}).atch || 0)],
    ['부속지번 표제부', Number((counts || {}).attachedTitle || 0)],
    ['부속지번 총괄표제부', Number((counts || {}).attachedRecap || 0)],
  ];
  return entries
    .filter(function (entry) { return includeZero ? true : entry[1] > 0; })
    .map(function (entry) { return `${entry[0]} ${entry[1]}건`; })
    .join(', ');
}

function buildBuildingRegisterSuccessNote_(result, isComposite) {
  if (!result || !result.fallbackUsed) {
    return isComposite ? '건축HUB 표제부 복합조회 적재' : '건축HUB 표제부 적재';
  }
  const summary = summarizeBuildingEndpointCounts_(result.endpointCounts, false) || summarizeBuildingEndpointCounts_(result.endpointCounts, true);
  return isComposite
    ? `건축HUB 공식 fallback 복합조회 적재(${summary})`
    : `건축HUB 공식 fallback 적재(${summary})`;
}

function buildBuildingRegisterFailureNote_(result) {
  const baseSummary = summarizeBuildingEndpointCounts_((result && result.endpointCounts) || {}, true);
  const missingFields = (result && result.missingFields) || [];
  if (result && result.hasOfficialItems && missingFields.length) {
    return `건축HUB 공식 응답 일부 확보, 필수값 누락(${missingFields.join(', ')}) - ${baseSummary}`;
  }
  return `건축HUB 공식 2차 조회 실패(${baseSummary})`;
}

function finalizeBuildingAggregate_(aggregate) {
  if (!aggregate || !hasAnyBuildingAggregateValue_(aggregate)) return null;
  return {
    approvalDate: safeString_(aggregate.approvalDate),
    grossFloorArea: aggregate.grossFloorArea != null ? aggregate.grossFloorArea : null,
    landArea: aggregate.landArea != null ? aggregate.landArea : null,
    floorCount: buildFloorCountText_(aggregate.maxGround, aggregate.maxUnderground),
    buildingName: (aggregate.buildingNames || []).join(' / '),
  };
}

function fetchBuildingRegisterBundle_(query) {
  const titleResult = fetchBuildingRegisterEndpointItems_('getBrTitleInfo', query);
  let aggregate = aggregateTitleItemsForQuery_(query, titleResult.items);
  const endpointCounts = {
    title: titleResult.items.length,
    recap: 0,
    floor: 0,
    area: 0,
    atch: 0,
    attachedTitle: 0,
    attachedRecap: 0,
  };
  const initialMissingFields = getMissingBuildingFields_(aggregate);
  let fallbackUsed = false;

  if (initialMissingFields.length) {
    fallbackUsed = true;

    const recapResult = fetchBuildingRegisterEndpointItems_('getBrRecapTitleInfo', query);
    endpointCounts.recap = recapResult.items.length;
    aggregate = mergeBuildingQueryAggregate_(aggregate, aggregateRecapItemsForQuery_(query, recapResult.items));

    const floorResult = fetchBuildingRegisterEndpointItems_('getBrFlrOulnInfo', query);
    endpointCounts.floor = floorResult.items.length;
    aggregate = mergeBuildingQueryAggregate_(aggregate, aggregateFloorItemsForQuery_(query, floorResult.items));

    const areaResult = fetchBuildingRegisterEndpointItems_('getBrExposPubuseAreaInfo', query);
    endpointCounts.area = areaResult.items.length;
    aggregate = mergeBuildingQueryAggregate_(aggregate, aggregateExposPubuseItemsForQuery_(query, areaResult.items));

    const atchResult = fetchBuildingRegisterEndpointItems_('getBrAtchJibunInfo', query);
    endpointCounts.atch = atchResult.items.length;
    const attachedQueries = buildAttachedQueriesFromItems_(atchResult.items).slice(0, 20);

    attachedQueries.forEach(function (attachedQuery) {
      if (!getMissingBuildingFields_(aggregate).length) return;
      const attachedTitleResult = fetchBuildingRegisterEndpointItems_('getBrTitleInfo', attachedQuery);
      endpointCounts.attachedTitle += attachedTitleResult.items.length;
      aggregate = mergeBuildingQueryAggregate_(aggregate, aggregateTitleItemsForQuery_(attachedQuery, attachedTitleResult.items));
      if (!getMissingBuildingFields_(aggregate).length) return;
      const attachedRecapResult = fetchBuildingRegisterEndpointItems_('getBrRecapTitleInfo', attachedQuery);
      endpointCounts.attachedRecap += attachedRecapResult.items.length;
      aggregate = mergeBuildingQueryAggregate_(aggregate, aggregateRecapItemsForQuery_(attachedQuery, attachedRecapResult.items));
    });
  }

  const missingFields = getMissingBuildingFields_(aggregate);
  const hasOfficialItems = Object.keys(endpointCounts).some(function (key) {
    return Number(endpointCounts[key] || 0) > 0;
  });

  return {
    query: query,
    aggregateRaw: hasAnyBuildingAggregateValue_(aggregate) ? aggregate : null,
    aggregate: finalizeBuildingAggregate_(aggregate),
    hasOfficialItems: hasOfficialItems,
    fallbackUsed: fallbackUsed,
    endpointCounts: endpointCounts,
    missingFields: missingFields,
    reviewStatus: hasOfficialItems && !missingFields.length ? 'ok' : 'review_required',
    note: hasOfficialItems && !missingFields.length
      ? buildBuildingRegisterSuccessNote_({ fallbackUsed: fallbackUsed, endpointCounts: endpointCounts }, false)
      : buildBuildingRegisterFailureNote_({ hasOfficialItems: hasOfficialItems, endpointCounts: endpointCounts, missingFields: missingFields }),
  };
}

function buildBuildingRegisterResult_(queries) {
  const bundles = (queries || []).map(function (query) {
    return fetchBuildingRegisterBundle_(query);
  });
  const combined = buildEmptyBuildingQueryAggregate_(null);
  const combinedCounts = {
    title: 0,
    recap: 0,
    floor: 0,
    area: 0,
    atch: 0,
    attachedTitle: 0,
    attachedRecap: 0,
  };
  const failedBundles = [];
  let hasOfficialItems = false;
  let fallbackUsed = false;

  bundles.forEach(function (bundle) {
    Object.keys(combinedCounts).forEach(function (key) {
      combinedCounts[key] += Number(((bundle || {}).endpointCounts || {})[key] || 0);
    });
    if (bundle && bundle.aggregateRaw) {
      if (bundle.aggregateRaw.grossFloorArea != null) {
        combined.grossFloorArea = Number(combined.grossFloorArea || 0) + Number(bundle.aggregateRaw.grossFloorArea || 0);
      }
      if (bundle.aggregateRaw.landArea != null) {
        combined.landArea = Number(combined.landArea || 0) + Number(bundle.aggregateRaw.landArea || 0);
      }
      combined.maxGround = Math.max(combined.maxGround, Number(bundle.aggregateRaw.maxGround || 0));
      combined.maxUnderground = Math.max(combined.maxUnderground, Number(bundle.aggregateRaw.maxUnderground || 0));
      combined.approvalDate = safeString_(bundle.aggregateRaw.approvalDate || combined.approvalDate);
      (bundle.aggregateRaw.buildingNames || []).forEach(function (name) {
        pushUniqueValue_(combined.buildingNames, name);
      });
      combined.areaRowsFound += Number(bundle.aggregateRaw.areaRowsFound || 0);
    }
    hasOfficialItems = hasOfficialItems || !!(bundle && bundle.hasOfficialItems);
    fallbackUsed = fallbackUsed || !!(bundle && bundle.fallbackUsed);
    if (!bundle || bundle.reviewStatus !== 'ok') {
      failedBundles.push(bundle);
    }
  });

  const aggregate = finalizeBuildingAggregate_(combined);
  if (!hasOfficialItems) {
    return {
      aggregate: aggregate,
      reviewStatus: 'review_required',
      buildingHubStatus: 'official_not_found',
      note: failedBundles.length
        ? failedBundles.map(function (bundle) {
          return `${buildBuildingQueryKey_(bundle.query)}: ${bundle.note}`;
        }).join(' | ')
        : buildBuildingRegisterFailureNote_({ hasOfficialItems: false, endpointCounts: combinedCounts, missingFields: [] }),
    };
  }

  const missingFields = getMissingBuildingFields_(combined);
  if (failedBundles.length || missingFields.length) {
    return {
      aggregate: aggregate,
      reviewStatus: 'review_required',
      buildingHubStatus: failedBundles.length ? 'official_partial' : 'official_incomplete',
      note: failedBundles.length
        ? failedBundles.map(function (bundle) {
          return `${buildBuildingQueryKey_(bundle.query)}: ${bundle.note}`;
        }).join(' | ')
        : buildBuildingRegisterFailureNote_({ hasOfficialItems: true, endpointCounts: combinedCounts, missingFields: missingFields }),
    };
  }

  return {
    aggregate: aggregate,
    reviewStatus: 'ok',
    buildingHubStatus: queries && queries.length > 1
      ? (fallbackUsed ? 'ok_composite_official_fallback' : 'ok_composite')
      : (fallbackUsed ? 'ok_official_fallback' : 'ok'),
    note: buildBuildingRegisterSuccessNote_({ fallbackUsed: fallbackUsed, endpointCounts: combinedCounts }, queries && queries.length > 1),
  };
}

function ensureAssetLookupSeeds_(assetSheet, lookupSheet) {
  if (!lookupSheet) return;
  ensureAssetLookupHeaders_(lookupSheet);
  const assetValues = assetSheet.getDataRange().getDisplayValues();
  const lookupValues = lookupSheet.getDataRange().getDisplayValues();
  if (assetValues.length < 2 || lookupValues.length < 1) return;

  const assetIdx = headerIndexes_(assetValues[0]);
  const lookupIdx = headerIndexes_(lookupValues[0]);
  const existing = {};
  for (let index = 1; index < lookupValues.length; index += 1) {
    existing[readRowCell_(lookupValues[index], lookupIdx, ['asset_id'])] = true;
  }

  const additions = [];
  for (let index = 1; index < assetValues.length; index += 1) {
    const assetRow = assetValues[index];
    const assetId = readRowCell_(assetRow, assetIdx, ['asset_id']);
    if (!assetId || existing[assetId]) continue;
    const newRow = new Array(lookupValues[0].length).fill('');
    const query = {
      sigunguCd: readRowCell_(assetRow, assetIdx, ['sigunguCd']),
      bjdongCd: readRowCell_(assetRow, assetIdx, ['bjdongCd']),
      platGbCd: readRowCell_(assetRow, assetIdx, ['platGbCd']) || '0',
      bun: readRowCell_(assetRow, assetIdx, ['bun']),
      ji: readRowCell_(assetRow, assetIdx, ['ji']),
    };
    writeRowCell_(newRow, lookupIdx, ['asset_id'], assetId);
    writeRowCell_(newRow, lookupIdx, ['asset_code'], readRowCell_(assetRow, assetIdx, ['asset_code', '자산코드']));
    writeRowCell_(newRow, lookupIdx, ['asset_name'], readRowCell_(assetRow, assetIdx, ['asset_name', '자산명']));
    writeRowCell_(newRow, lookupIdx, ['lookup_address'], readRowCell_(assetRow, assetIdx, ['standardized_address', '도로명주소']));
    writeRowCell_(newRow, lookupIdx, ['query_key'], buildBuildingQueryKey_(query) || readRowCell_(assetRow, assetIdx, ['standardized_address', '도로명주소']));
    writeRowCell_(newRow, lookupIdx, ['sigunguCd'], query.sigunguCd);
    writeRowCell_(newRow, lookupIdx, ['bjdongCd'], query.bjdongCd);
    writeRowCell_(newRow, lookupIdx, ['platGbCd'], query.platGbCd);
    writeRowCell_(newRow, lookupIdx, ['bun'], query.bun);
    writeRowCell_(newRow, lookupIdx, ['ji'], query.ji);
    additions.push(newRow);
  }

  if (additions.length) {
    lookupSheet.getRange(lookupSheet.getLastRow() + 1, 1, additions.length, additions[0].length).setValues(additions);
  }
}

function buildLookupRowNumberIndex_(lookupValues, lookupIdx) {
  const index = {};
  for (let rowIndex = 1; rowIndex < (lookupValues || []).length; rowIndex += 1) {
    const assetId = readRowCell_(lookupValues[rowIndex], lookupIdx, ['asset_id']);
    if (assetId) index[assetId] = rowIndex + 1;
  }
  return index;
}

function queueLookupStatusUpdate_(updates, rowNumber, status, note, updatedAt) {
  if (!rowNumber) return;
  updates.push({
    rowNumber: rowNumber,
    status: safeString_(status),
    note: safeString_(note),
    updatedAt: safeString_(updatedAt),
  });
}

function applyLookupStatusUpdates_(lookupSheet, lookupIdx, updates) {
  if (!lookupSheet || !(updates || []).length) return;
  const statusColumn = resolveHeaderIndex_(lookupIdx, ['building_hub_status']);
  const noteColumn = resolveHeaderIndex_(lookupIdx, ['note']);
  const updatedAtColumn = resolveHeaderIndex_(lookupIdx, ['updated_at']);

  (updates || []).forEach(function (update) {
    if (statusColumn != null) lookupSheet.getRange(update.rowNumber, statusColumn + 1).setValue(update.status);
    if (noteColumn != null) lookupSheet.getRange(update.rowNumber, noteColumn + 1).setValue(update.note);
    if (updatedAtColumn != null) lookupSheet.getRange(update.rowNumber, updatedAtColumn + 1).setValue(update.updatedAt);
  });
}

function syncOpenDartData() {
  try {
    const config = getConfig_();
    const spreadsheet = getSpreadsheet_();
    const companySheet = spreadsheet.getSheetByName(config.sheetNames.company);
    const existingRowCount = companySheet.getLastRow();
    const rows = companySheet.getRange(1, 1, existingRowCount, companySheet.getLastColumn()).getDisplayValues();
    if (rows.length < 2) {
      recordIntegrationRun_('open_dart', {
        status: 'success',
        message: 'DB_COMPANY에 동기화 대상 행이 없습니다.',
      });
      return { updated: 0, unmatched: 0 };
    }

    const headers = rows[0];
    const idx = headerIndexes_(headers);
    const beforeRows = rows.slice(1).map(function (row) { return row.slice(); });
    const corpCodeMap = fetchOpenDartCorpCodeMap_();
    const normalizationRows = loadObjectsFromSheet_(spreadsheet, config.sheetNames.sysTenantNormalize);
    const candidateMap = buildOpenDartNameCandidates_(normalizationRows);
    const corpCompanyInfoCache = {};
    const corpResponseCache = {};
    const output = [];
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    let updated = 0;
    let unmatched = 0;

    for (let index = 1; index < rows.length; index += 1) {
      const row = rows[index].slice();
      const tenantId = readRowCell_(row, idx, ['tenant_id']);
      const tenantMasterName = readRowCell_(row, idx, ['tenant_master_name', 'raw_name', 'tenant_name', '표준기업명']);
      const businessRegistrationNo = readRowCell_(row, idx, ['business_registration_no', '사업자등록번호']);
      if (!tenantMasterName && !businessRegistrationNo) continue;
      const resolvedTenantId = tenantId || buildOpenDartTenantId_(tenantMasterName, businessRegistrationNo);
      if (!tenantMasterName) {
        writeRowCell_(row, idx, ['tenant_id'], resolvedTenantId);
        output.push(row);
        continue;
      }

      const match = resolveOpenDartCorpMatch_(corpCodeMap, candidateMap, {
        tenantId: tenantId,
        tenantMasterName: tenantMasterName,
        businessRegistrationNo: businessRegistrationNo,
      }, corpCompanyInfoCache);
      const corp = match.corp;

      if (!corp) {
        writeRowCell_(row, idx, ['tenant_id'], resolvedTenantId);
        writeRowCell_(row, idx, ['match_status'], 'unmatched');
        writeRowCell_(row, idx, ['fetched_at'], today);
        writeRowCell_(row, idx, ['review_status'], 'review_required');
        writeRowCell_(row, idx, ['review_note'], buildOpenDartReviewNote_(match.reason));
        unmatched += 1;
        output.push(row);
        continue;
      }

      if (!corpResponseCache[corp.corp_code]) {
        const finance = fetchOpenDartFinanceInfo_(corp.corp_code);
        const employee = fetchOpenDartEmployeeInfo_(corp.corp_code);
        corpResponseCache[corp.corp_code] = {
          company: fetchOpenDartCompanyInfo_(corp.corp_code),
          finance: finance,
          employee: employee,
          document: (finance.status && finance.status !== '000') || (employee.status && employee.status !== '000')
            ? fetchOpenDartDocumentFallback_(corp.corp_code)
            : null,
        };
      }

      const corpPayload = corpResponseCache[corp.corp_code];
      const effective = resolveOpenDartEffectivePayload_(tenantMasterName, corpPayload);
      writeRowCell_(row, idx, ['tenant_id'], resolvedTenantId);
      writeRowCell_(row, idx, ['dart_corp_code'], corp.corp_code);
      writeRowCell_(row, idx, ['match_status'], 'matched');
      writeRowCellPreserve_(row, idx, ['corp_registration_no'], safeGet_(corpPayload, ['company', 'jurir_no']));
      writeRowCellPreserve_(row, idx, ['industry_code'], safeGet_(corpPayload, ['company', 'induty_code']));
      writeRowCellPreserve_(row, idx, ['headquarters_address'], safeGet_(corpPayload, ['company', 'adres']));
      writeRowCell_(row, idx, ['listed_yn'], safeGet_(corpPayload, ['company', 'stock_name']) ? 'Y' : 'N');
      writeRowCellPreserve_(row, idx, ['latest_financial_year', '최근 재무제표 연도'], effective.year);
      writeRowCellPreserve_(row, idx, ['financial_statement_type', '연결_별도_여부'], effective.fsDiv);
      writeRowCellPreserve_(row, idx, ['latest_report_name', '사용한 보고서 종류'], safeGet_(corpPayload, ['document', 'reportName']));
      writeRowCellPreserve_(row, idx, ['latest_receipt_no', '접수번호'], safeGet_(corpPayload, ['document', 'rceptNo']));
      writeRowCellPreserve_(row, idx, ['latest_revenue'], effective.revenue);
      writeRowCellPreserve_(row, idx, ['latest_operating_income'], effective.operatingIncome);
      writeRowCellPreserve_(row, idx, ['latest_debt_ratio'], effective.debtRatio);
      writeRowCellPreserve_(row, idx, ['latest_employee_count'], effective.employeeCount);
      writeRowCell_(row, idx, ['fetched_at'], today);
      writeRowCell_(row, idx, ['review_status'], effective.reviewNotes.length ? 'review_required' : 'ok');
      writeRowCell_(row, idx, ['review_note'], effective.reviewNotes.join(' | '));
      updated += 1;
      output.push(row);
    }

    companySheet.getRange(1, 1, output.length + 1, headers.length).setValues([headers].concat(output));
    if (existingRowCount > output.length + 1) {
      companySheet.getRange(output.length + 2, 1, existingRowCount - output.length - 1, headers.length).clearContent();
    }
    const summaryMessage = updated + ' rows updated / ' + unmatched + ' unmatched';
    writeAuditLogs_(buildSheetDiffAuditEntries_(beforeRows, output, headers, {
      actionType: 'SYNC',
      entityType: 'company',
      sheetName: config.sheetNames.company,
      reason: 'OpenDART 동기화',
      sourceFunction: 'syncOpenDartData',
      sourceType: 'server',
      cacheInvalidated: true,
    }));
    logApiEvent_('OpenDART', 'syncOpenDartData', 'DB_COMPANY', unmatched ? 'partial' : 'ok', summaryMessage, '');
    recordIntegrationRun_('open_dart', {
      status: unmatched ? 'partial_success' : 'success',
      message: summaryMessage,
    });
    markDataDirty_('sync_open_dart');
    invalidateDashboardCaches_();
    return { updated: updated, unmatched: unmatched };
  } catch (error) {
    const message = safeString_(error && error.message) || 'OpenDART sync failed.';
    recordIntegrationRun_('open_dart', {
      status: 'failure',
      code: /authorization|auth|권한/i.test(message) ? 'AUTH_REQUIRED' : 'ERROR',
      message: message,
    });
    throw error;
  }
}

function syncBuildingRegisterDataLegacy_() {
  const config = getConfig_();
  const spreadsheet = getSpreadsheet_();
  const assetSheet = spreadsheet.getSheetByName(config.sheetNames.asset);
  const lookupSheet = spreadsheet.getSheetByName(config.sheetNames.sysAssetLookup);
  ensureAssetLookupSeeds_(assetSheet, lookupSheet);

  const lookupRows = loadObjectsFromSheet_(spreadsheet, config.sheetNames.sysAssetLookup);
  const lookupIndex = buildBuildingLookupIndex_(lookupRows);
  const lookupValues = lookupSheet ? lookupSheet.getDataRange().getDisplayValues() : [];
  const lookupIdx = lookupValues.length ? headerIndexes_(lookupValues[0]) : {};
  const lookupRowNumberIndex = buildLookupRowNumberIndex_(lookupValues, lookupIdx);
  const rows = assetSheet.getDataRange().getDisplayValues();
  if (rows.length < 2) return { updated: 0, pending: 0 };

  const headers = rows[0];
  const idx = headerIndexes_(headers);
  const output = [];
  const lookupStatusUpdates = [];
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  let updated = 0;
  let pending = 0;

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index].slice();
    const assetId = readRowCell_(row, idx, ['asset_id']);
    const lookup = resolveBuildingLookupCandidateByAlias_(row, idx, lookupIndex);
    const query = resolveBuildingRegisterQueryByAlias_(row, idx, lookup);
    if (!query) {
      if (!readRowCell_(row, idx, ['review_status'])) writeRowCell_(row, idx, ['review_status'], 'review_required');
      if (!readRowCell_(row, idx, ['review_note'])) {
        const lookupQueryKey = lookup && lookup.queryKey;
        writeRowCell_(row, idx, ['review_note'], (lookup && lookup.note) || (lookupQueryKey
          ? '건축물대장 query_key 형식이 맞지 않습니다. sigunguCd/bjdongCd 또는 파이프 구분 query_key를 확인해 주세요.'
          : '건축물대장 query_key가 비어 있습니다.'));
      }
      writeRowCellPreserve_(row, idx, ['building_hub_status'], 'pending');
      queueLookupStatusUpdate_(
        lookupStatusUpdates,
        lookupRowNumberIndex[assetId],
        'pending',
        readRowCell_(row, idx, ['review_note']),
        today
      );
      pending += 1;
      output.push(row);
      continue;
    }

    const queryList = Array.isArray(query) ? query : [query];
    const primaryQuery = queryList[0];
    writeRowCell_(row, idx, ['sigunguCd'], primaryQuery.sigunguCd);
    writeRowCell_(row, idx, ['bjdongCd'], primaryQuery.bjdongCd);
    writeRowCell_(row, idx, ['platGbCd'], primaryQuery.platGbCd || '0');
    writeRowCell_(row, idx, ['bun'], primaryQuery.bun || '');
    writeRowCell_(row, idx, ['ji'], primaryQuery.ji || '');

    const buildingResult = buildBuildingRegisterResult_(queryList);
    if (!buildingResult.aggregate) {
      writeRowCell_(row, idx, ['building_hub_status'], buildingResult.buildingHubStatus || 'official_not_found');
      writeRowCell_(row, idx, ['review_status'], 'review_required');
      writeRowCell_(row, idx, ['review_note'], buildingResult.note || (lookup && lookup.note) || '건축물대장 공식 조회 결과가 없습니다.');
      queueLookupStatusUpdate_(
        lookupStatusUpdates,
        lookupRowNumberIndex[assetId],
        buildingResult.buildingHubStatus || 'official_not_found',
        buildingResult.note || '',
        today
      );
      pending += 1;
      output.push(row);
      continue;
    }

    writeRowCellPreserve_(row, idx, ['approval_date', '사용승인일'], buildingResult.aggregate.approvalDate);
    writeRowCellPreserve_(row, idx, ['gross_floor_area', '연면적'], buildingResult.aggregate.grossFloorArea);
    writeRowCellPreserve_(row, idx, ['land_area', '대지면적'], buildingResult.aggregate.landArea);
    writeRowCellPreserve_(row, idx, ['floor_count', '층수'], buildingResult.aggregate.floorCount);
    writeRowCellPreserve_(row, idx, ['building_name', '건물명'], buildingResult.aggregate.buildingName);
    writeRowCell_(row, idx, ['fetched_at'], today);
    writeRowCell_(row, idx, ['review_status'], buildingResult.reviewStatus);
    writeRowCell_(row, idx, ['review_note'], buildingResult.note || '');
    writeRowCell_(row, idx, ['building_hub_status'], buildingResult.buildingHubStatus || (queryList.length > 1 ? 'ok_composite' : 'ok'));
    queueLookupStatusUpdate_(
      lookupStatusUpdates,
      lookupRowNumberIndex[assetId],
      buildingResult.buildingHubStatus || (queryList.length > 1 ? 'ok_composite' : 'ok'),
      buildingResult.note || '',
      today
    );
    if (buildingResult.reviewStatus === 'ok') {
      updated += 1;
    } else {
      pending += 1;
    }
    output.push(row);
  }

  assetSheet.getRange(1, 1, output.length + 1, headers.length).setValues([headers].concat(output));
  applyLookupStatusUpdates_(lookupSheet, lookupIdx, lookupStatusUpdates);
  logApiEvent_('BuildingRegister', 'syncBuildingRegisterData', 'DB_ASSET', pending ? 'partial' : 'ok', updated + ' rows updated / ' + pending + ' pending', '');
  markDataDirty_('sync_building_register');
  invalidateDashboardCaches_();
  return { updated: updated, pending: pending };
}

function collectCalculationAuditRows_(spreadsheet, model, detectedAt) {
  const sheet = spreadsheet.getSheetByName(getConfig_().sheetNames.calculation);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const calculationRows = rowsToObjects_(sheet.getDataRange().getDisplayValues());
  const duplicates = {};
  calculationRows.forEach(function (row) {
    const sourceId = safeString_(pickField_(row, ['source_lease_space_id']));
    if (sourceId) duplicates[sourceId] = (duplicates[sourceId] || 0) + 1;
  });

  const modelIndex = indexBy_(model.generalRows || [], 'leaseSpaceId');
  const expectedSnapshotMonth = monthKeyFromIso_(model.generatedAt);
  const rows = [];

  if (calculationRows.length !== (model.generalRows || []).length) {
    rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', '', '', '', 'calculation_row_count_mismatch', 'high', 'review_required', 'Calculation sheet row count does not match current general row count.'));
  }

  calculationRows.forEach(function (row) {
    const sourceId = safeString_(pickField_(row, ['source_lease_space_id']));
    const assetId = safeString_(pickField_(row, ['asset_id']));
    const tenantId = safeString_(pickField_(row, ['tenant_id']));
    const calculationStatus = safeString_(pickField_(row, ['calculation_status']));
    const reviewStatus = safeString_(pickField_(row, ['review_status']));
    const snapshotMonth = safeString_(pickField_(row, ['snapshot_month']));
    const formulaVersion = safeString_(pickField_(row, ['formula_version']));
    const rent = toNumber_(pickField_(row, ['monthly_rent_total']));
    const mf = toNumber_(pickField_(row, ['monthly_mf_total']));
    const eNoc = toNumber_(pickField_(row, ['e_noc']));
    const vacancyRate = toPercentNumber_(pickField_(row, ['vacancy_rate']));
    const modelRow = sourceId ? modelIndex[sourceId] : null;

    if (!sourceId) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', '', assetId, tenantId, 'missing_source_lease_space_id', 'high', reviewStatus || 'review_required', 'source_lease_space_id is empty.'));
    if (sourceId && duplicates[sourceId] > 1) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', sourceId, assetId, tenantId, 'duplicate_source_lease_space_id', 'high', reviewStatus || 'review_required', 'Duplicate source_lease_space_id exists in the calculation sheet.'));
    if (snapshotMonth && snapshotMonth !== expectedSnapshotMonth) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', sourceId, assetId, tenantId, 'snapshot_month_mismatch', 'medium', reviewStatus || 'review_required', 'snapshot_month does not match the current model snapshot.'));
    if (formulaVersion && formulaVersion !== model.config.formulaVersion) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', sourceId, assetId, tenantId, 'formula_version_mismatch', 'medium', reviewStatus || 'review_required', 'formula_version does not match the current configuration.'));
    if (vacancyRate != null && (vacancyRate < 0 || vacancyRate > 1.05)) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', sourceId, assetId, tenantId, 'vacancy_rate_out_of_range', 'high', reviewStatus || 'review_required', 'vacancy_rate is outside the expected range.'));

    if (!modelRow) {
      if (sourceId) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', sourceId, assetId, tenantId, 'orphan_calculation_row', 'high', reviewStatus || 'review_required', 'Calculation row does not map to a current general row.'));
      return;
    }

    if (modelRow.isContractActive !== false && rent == null) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', sourceId, assetId, tenantId, 'calc_monthly_rent_missing', 'high', calculationStatus || 'review_required', 'Calculation row is missing monthly_rent_total for an active contract.'));
    if (modelRow.isContractActive !== false && mf == null) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', sourceId, assetId, tenantId, 'calc_monthly_mf_missing', 'high', calculationStatus || 'review_required', 'Calculation row is missing monthly_mf_total for an active contract.'));
    if (modelRow.historyLinked && modelRow.eNoc != null && eNoc == null) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', sourceId, assetId, tenantId, 'calc_e_noc_missing', 'medium', calculationStatus || 'review_required', 'Calculation row is missing e_noc even though the model has a computed value.'));
    if (calculationStatus && modelRow.calculationStatus && calculationStatus !== modelRow.calculationStatus) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', sourceId, assetId, tenantId, 'calculation_status_mismatch', 'medium', calculationStatus, 'Calculation status differs from the current model.'));
    if (reviewStatus && modelRow.calculatedReviewStatus && reviewStatus !== modelRow.calculatedReviewStatus) rows.push(makeAuditRow_(detectedAt, 'DB_CALCULATION', sourceId, assetId, tenantId, 'review_status_mismatch', 'medium', reviewStatus, 'Review status differs from the current model.'));
  });

  return rows;
}

function runDataAudit() {
  const spreadsheet = getSpreadsheet_();
  const model = getModelOrRefreshCache_();
  const sheet = ensureAuditSheet_();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }

  const detectedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const rows = [];
  const leaseSpaceCounts = {};
  const historyEventCounts = {};
  const latestHistoryCounts = {};

  (model.generalRows || []).forEach(function (row) {
    if (row.leaseSpaceId) leaseSpaceCounts[row.leaseSpaceId] = (leaseSpaceCounts[row.leaseSpaceId] || 0) + 1;
  });
  (model.historyRows || []).forEach(function (row) {
    if (row.historyEventId) historyEventCounts[row.historyEventId] = (historyEventCounts[row.historyEventId] || 0) + 1;
    if (row.linkedLeaseSpaceId && row.isLatest) latestHistoryCounts[row.linkedLeaseSpaceId] = (latestHistoryCounts[row.linkedLeaseSpaceId] || 0) + 1;
  });

  (model.generalRows || []).forEach(function (row) {
    const status = row.calculatedReviewStatus || 'review_required';
    if (row.leasedAreaSqm != null && row.leasedAreaSqm <= 0) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'non_positive_leased_area', 'high', status, 'leasedAreaSqm must be greater than zero.'));
    if (row.exclusiveAreaSqm != null && row.exclusiveAreaSqm < 0) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'negative_exclusive_area', 'high', status, 'exclusiveAreaSqm is negative.'));
    if (row.exclusiveRatio != null && row.exclusiveRatio > 1.05) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'exclusive_ratio_over_100', 'high', status, 'exclusiveRatio is greater than 100%.'));
    if (row.totalGrossAreaSqm != null && row.leasedAreaSqm != null && row.leasedAreaSqm > row.totalGrossAreaSqm) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'leased_gt_gfa', 'high', status, 'leasedAreaSqm exceeds totalGrossAreaSqm.'));
    if (row.currentStartDate && row.currentEndDate && row.currentEndDate < row.currentStartDate) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'contract_date_reversal', 'high', status, 'currentEndDate is earlier than currentStartDate.'));
    if (!row.leaseSpaceId) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'missing_lease_space_id', 'high', status, 'leaseSpaceId is empty.'));
    if (row.leaseSpaceId && leaseSpaceCounts[row.leaseSpaceId] > 1) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'duplicate_lease_space_id', 'high', status, 'Duplicate leaseSpaceId exists.'));
    if (!row.businessRegistrationNo) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'missing_business_registration_no', 'medium', status, 'businessRegistrationNo is empty.'));
    if (!row.historyLinked) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'history_unmatched', 'high', status, 'No history row is linked to this current row.'));
    if (row.currentMoneyStatus === 'latest_history_money_missing') rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'latest_history_money_missing', 'high', status, 'Latest linked history row is missing rentPerPy or mfPerPy.'));
    if (row.isContractActive !== false && row.currentMonthlyRentTotal == null) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'monthly_rent_missing_with_active_contract', 'high', status, 'Active contract is missing currentMonthlyRentTotal.'));
    if (row.isContractActive !== false && row.currentMonthlyMfTotal == null) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'monthly_mf_missing_with_active_contract', 'high', status, 'Active contract is missing currentMonthlyMfTotal.'));
    if (row.historyLinked && row.eNoc == null) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'e_noc_missing_despite_history_linked', 'medium', row.calculationStatus || status, 'E.NOC is missing even though history is linked.'));
    if (row.currentPeriodYears && (defaultValue_(row.rfMonths, 0) + defaultValue_(row.foMonths, 0)) > (row.currentPeriodYears * 12)) rows.push(makeAuditRow_(detectedAt, 'DB_GENERAL', row.rowNumber, row.assetId, row.tenantId, 'rf_fo_exceeds_total_months', 'high', status, 'RF + FO exceeds the total contract months.'));
  });

  (model.historyRows || []).forEach(function (row) {
    const status = row.reviewStatus || 'review_required';
    if (!row.linkedLeaseSpaceId) rows.push(makeAuditRow_(detectedAt, 'DB_HISTORY', row.rowNumber, row.assetCode, row.businessRegistrationNo || '', 'unmatched_history', 'high', status, 'History row is not matched to a current row.'));
    if (row.historyEventId && historyEventCounts[row.historyEventId] > 1) rows.push(makeAuditRow_(detectedAt, 'DB_HISTORY', row.rowNumber, row.assetCode, row.businessRegistrationNo || '', 'duplicate_history_event_id', 'high', status, 'Duplicate historyEventId exists.'));
    if (row.linkedLeaseSpaceId && row.isLatest && latestHistoryCounts[row.linkedLeaseSpaceId] > 1) rows.push(makeAuditRow_(detectedAt, 'DB_HISTORY', row.rowNumber, row.assetCode, row.businessRegistrationNo || '', 'multiple_latest_history_same_space', 'high', status, 'More than one latest history row exists for the same leaseSpaceId.'));
    if (row.linkedLeaseSpaceId && row.monthlyRentTotal == null && row.monthlyMfTotal == null) rows.push(makeAuditRow_(detectedAt, 'DB_HISTORY', row.rowNumber, row.assetCode, row.businessRegistrationNo || '', 'history_money_missing', 'medium', status, 'History row is linked but both monthlyRentTotal and monthlyMfTotal are empty.'));
  });

  (model.companyRows || []).forEach(function (row) {
    const status = row.reviewStatus || 'review_required';
    if (!row.dartCorpCode) rows.push(makeAuditRow_(detectedAt, 'DB_COMPANY', '', '', row.tenantId, 'dart_unmatched', 'medium', status, 'OpenDART corp code is missing.'));
    if (row.fetchedAt && daysBetweenDateText_(row.fetchedAt) > 30) rows.push(makeAuditRow_(detectedAt, 'DB_COMPANY', '', '', row.tenantId, 'stale_company_api_data', 'low', status, 'Company API data is older than 30 days.'));
  });

  (model.assetRows || []).forEach(function (row) {
    const status = row.reviewStatus || 'review_required';
    if (!row.sigunguCd || !row.bjdongCd) rows.push(makeAuditRow_(detectedAt, 'DB_ASSET', '', row.assetId, '', 'building_register_unmatched', 'medium', status, 'Building register lookup key is incomplete.'));
    if (row.latitude == null || row.longitude == null) rows.push(makeAuditRow_(detectedAt, 'DB_ASSET', '', row.assetId, '', 'missing_coordinates', 'low', status, 'Latitude or longitude is missing.'));
    if (row.fetchedAt && daysBetweenDateText_(row.fetchedAt) > 30) rows.push(makeAuditRow_(detectedAt, 'DB_ASSET', '', row.assetId, '', 'stale_building_api_data', 'low', status, 'Building register data is older than 30 days.'));
  });

  Array.prototype.push.apply(rows, collectCalculationAuditRows_(spreadsheet, model, detectedAt));

  rows.forEach(function (row, index) {
    row[0] = 'audit_' + Utilities.formatString('%05d', index + 1);
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  logApiEvent_('AUDIT', 'runDataAudit', 'AUDIT', 'ok', rows.length + ' rows inserted', '');
  return { inserted: rows.length };
}

function makeDashboardValidationIssue_(severity, sheetName, rowNumber, fieldName, issue, suggestedFix, details) {
  return {
    severity: severity,
    sheetName: sheetName,
    rowNumber: rowNumber || '',
    fieldName: fieldName || '',
    issue: issue || '',
    suggestedFix: suggestedFix || '',
    details: details || {},
  };
}

function isLikelyMalformedDate_(rawValue, parsedValue) {
  const text = safeString_(rawValue);
  if (!text) return false;
  if (parsedValue) return false;
  return /[0-9]/.test(text);
}

function validateDashboardData() {
  return measureDashboardStage_('validateDashboardData', 'total', function () {
    const spreadsheet = getSpreadsheet_();
    const config = getConfig_();
    const model = getModelOrRefreshCache_();
    const issues = [];
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const rawGeneralByRow = indexBy_(loadObjectsFromSheet_(spreadsheet, config.sheetNames.general), function (row) {
      return String(row._rowNumber || '');
    });
    const rawHistoryByRow = indexBy_(loadObjectsFromSheet_(spreadsheet, config.sheetNames.history), function (row) {
      return String(row._rowNumber || '');
    });
    const assetById = indexBy_(model.assetRows || [], 'assetId');
    const leaseIdCounts = {};
    const assetAreaRollup = {};

    (model.generalRows || []).forEach(function (row) {
      if (row.leaseId) leaseIdCounts[row.leaseId] = (leaseIdCounts[row.leaseId] || 0) + 1;
      if (!row.assetId) return;
      assetAreaRollup[row.assetId] = assetAreaRollup[row.assetId] || {
        assetName: row.assetName,
        grossArea: row.totalGrossAreaSqm || safeGet_(assetById[row.assetId], ['grossFloorAreaSqm']) || null,
        leasedArea: 0,
      };
      assetAreaRollup[row.assetId].leasedArea += Number(row.leasedAreaSqm || 0);
      if (!assetAreaRollup[row.assetId].grossArea && row.totalGrossAreaSqm) {
        assetAreaRollup[row.assetId].grossArea = row.totalGrossAreaSqm;
      }
    });

    function add(severity, sheetName, rowNumber, fieldName, issue, suggestedFix, details) {
      issues.push(makeDashboardValidationIssue_(severity, sheetName, rowNumber, fieldName, issue, suggestedFix, details));
    }

    (model.generalRows || []).forEach(function (row) {
      const raw = rawGeneralByRow[String(row.rowNumber || '')] || {};
      const rowRef = row.rowNumber || '';
      const statusRaw = safeString_(row.contractStatusRaw).toLowerCase();
      const activeText = /active|유효|진행|운영|계약중|true|y|yes|1/.test(statusRaw);
      const endedText = /end|expired|종료|만료|해지|false|n|no|0/.test(statusRaw);
      const isActive = row.isContractActive !== false || activeText;

      [
        ['assetName', '자산명', row.assetName],
        ['tenantMasterName', '임차인명', row.tenantMasterName || row.rawTenantName],
        ['leaseId', 'lease_id', row.leaseId],
        ['leaseSpaceId', 'lease_space_id', row.leaseSpaceId],
        ['currentStartDate', '현재 계약개시일', row.currentStartDate],
        ['currentEndDate', '현재 계약만기일', row.currentEndDate],
        ['leasedAreaSqm', '임대면적', row.leasedAreaSqm],
      ].forEach(function (item) {
        if (item[2] == null || item[2] === '') {
          add('Critical', config.sheetNames.general, rowRef, item[1], '필수값이 누락되었습니다.', '원천 시트에 값을 입력하고 lease/helper ID를 재생성하세요.', { key: item[0] });
        }
      });

      if (row.currentStartDate && row.currentEndDate && row.currentStartDate > row.currentEndDate) {
        add('Critical', config.sheetNames.general, rowRef, '현재 계약개시일/현재 계약만기일', '계약 시작일이 종료일보다 늦습니다.', '계약 시작일과 종료일을 원문 계약서 기준으로 재확인하세요.');
      }
      if (row.leasedAreaSqm != null && row.leasedAreaSqm <= 0) {
        add('Critical', config.sheetNames.general, rowRef, '임대면적', '임대면적이 0 이하입니다.', '㎡ 단위의 양수 임대면적을 입력하세요.');
      }
      if (row.currentMonthlyRentTotal != null && row.currentMonthlyRentTotal < 0) {
        add('Critical', config.sheetNames.general, rowRef, '월임대료', '임대료가 음수입니다.', 'DB_히스토리 누적의 월임대료 총액 또는 평당 월임대료를 확인하세요.');
      }
      if (row.depositAmount != null && row.depositAmount < 0) {
        add('Critical', config.sheetNames.general, rowRef, '임대보증금', '보증금이 음수입니다.', '보증금은 원 단위 양수로 입력하세요.');
      }
      const assetMaster = assetById[row.assetId];
      if (assetMaster && row.assetName && assetMaster.assetName && normalizeWhitespace_(assetMaster.assetName) !== normalizeWhitespace_(row.assetName)) {
        add('Warning', config.sheetNames.general, rowRef, '자산명', '자산명 표기가 DB_자산과 일치하지 않습니다.', 'DB_자산의 표준 자산명으로 통일하세요.', { standardName: assetMaster.assetName, currentName: row.assetName });
      }
      if (row.rawTenantName && row.tenantMasterName && normalizeWhitespace_(row.rawTenantName) !== normalizeWhitespace_(row.tenantMasterName)) {
        add('Info', config.sheetNames.general, rowRef, '임차인명', '원천 임차인명과 표준 임차인명이 다릅니다.', 'SYS_기업명정규화 매핑이 의도된 것인지 확인하세요.', { rawName: row.rawTenantName, standardName: row.tenantMasterName });
      }
      if (row.leaseId && leaseIdCounts[row.leaseId] > 1) {
        add('Warning', config.sheetNames.general, rowRef, 'lease_id', '계약 ID가 중복됩니다.', '동일 계약의 공간 분할이면 lease_space_id로 구분하고, 별도 계약이면 lease_id를 분리하세요.', { leaseId: row.leaseId, count: leaseIdCounts[row.leaseId] });
      }
      if (row.currentEndDate && row.currentEndDate < today && isActive) {
        add('Critical', config.sheetNames.general, rowRef, '계약 상태', '만기일이 지났는데 계약 상태가 Active로 해석됩니다.', '계약 상태를 종료로 바꾸거나 갱신 계약 정보를 입력하세요.', { currentEndDate: row.currentEndDate, contractStatusRaw: row.contractStatusRaw });
      }
      if (row.currentEndDate && row.currentEndDate >= today && endedText) {
        add('Warning', config.sheetNames.general, rowRef, '계약 상태', '종료 상태로 보이지만 계약만기일은 아직 도래하지 않았습니다.', '중도해지 여부 또는 상태값을 확인하세요.', { currentEndDate: row.currentEndDate, contractStatusRaw: row.contractStatusRaw });
      }
      [
        ['최초 계약일', row.firstContractDate],
        ['최초 계약개시일', row.firstStartDate],
        ['최초 계약만기일', row.firstEndDate],
        ['최근 계약일', row.recentContractDate],
        ['현재 계약개시일', row.currentStartDate],
        ['현재 계약만기일', row.currentEndDate],
      ].forEach(function (item) {
        if (isLikelyMalformedDate_(pickField_(raw, [item[0]]), item[1])) {
          add('Warning', config.sheetNames.general, rowRef, item[0], '날짜 형식 오류 가능성이 있습니다.', 'yyyy-mm-dd 형식으로 입력하세요.', { rawValue: pickField_(raw, [item[0]]) });
        }
      });
      if (row.depositAmount != null && row.depositAmount > 0 && row.depositAmount < 1000000) {
        add('Info', config.sheetNames.general, rowRef, '임대보증금', '금액 단위가 원 단위가 아닐 가능성이 있습니다.', '원 단위 금액인지, 천원/백만원 단위 입력인지 확인하세요.', { value: row.depositAmount });
      }
      if (row.currentMonthlyRentTotal != null && row.currentMonthlyRentTotal > 0 && row.currentMonthlyRentTotal < 10000) {
        add('Info', config.sheetNames.general, rowRef, '월임대료', '임대료 단위 오류 가능성이 있습니다.', '월임대료가 원 단위 총액인지 확인하세요.', { value: row.currentMonthlyRentTotal });
      }
      const totalFreeMonths = Number(row.rfMonths || 0) + Number(row.foMonths || 0);
      const contractMonths = row.currentPeriodYears == null ? null : Number(row.currentPeriodYears) * 12;
      if (contractMonths != null && totalFreeMonths > contractMonths) {
        add('Critical', config.sheetNames.general, rowRef, 'RF/FO', '렌트프리 기간이 계약 기간을 초과합니다.', 'RF와 FO의 단위가 월인지 확인하고 계약기간을 재검토하세요.', { totalFreeMonths: totalFreeMonths, contractMonths: contractMonths });
      }
      if (!row.sourceDocRef) {
        add('Warning', config.sheetNames.general, rowRef, 'source_doc_ref', '계약서 또는 원문 파일 링크가 누락되었습니다.', '계약서 파일 URL 또는 문서 참조 ID를 입력하세요.');
      }
    });

    (model.historyRows || []).forEach(function (row) {
      const raw = rawHistoryByRow[String(row.rowNumber || '')] || {};
      if (isLikelyMalformedDate_(pickField_(raw, ['기준일자']), row.baseDate)) {
        add('Warning', config.sheetNames.history, row.rowNumber, '기준일자', '날짜 형식 오류 가능성이 있습니다.', 'yyyy-mm-dd 형식으로 입력하세요.', { rawValue: pickField_(raw, ['기준일자']) });
      }
      if (row.monthlyRentTotal != null && row.monthlyRentTotal < 0) {
        add('Critical', config.sheetNames.history, row.rowNumber, '월임대료 총액', '임대료가 음수입니다.', '월임대료 총액을 원 단위 양수로 입력하세요.');
      }
      if (row.monthlyMfTotal != null && row.monthlyMfTotal < 0) {
        add('Critical', config.sheetNames.history, row.rowNumber, '월관리비 총액', '관리비가 음수입니다.', '월관리비 총액을 원 단위 양수로 입력하세요.');
      }
      if (row.rentPerPy != null && row.rentPerPy > 0 && row.rentPerPy < 100) {
        add('Info', config.sheetNames.history, row.rowNumber, '평당 월임대료', '평당 임대료 단위 오류 가능성이 있습니다.', '원/평/월 단위인지 확인하세요.', { value: row.rentPerPy });
      }
    });

    Object.keys(assetAreaRollup).forEach(function (assetId) {
      const item = assetAreaRollup[assetId];
      if (item.grossArea != null && item.leasedArea - item.grossArea > 0.01) {
        add('Critical', config.sheetNames.general, '', '임대면적/공실면적', '계약 면적 합계가 자산 연면적을 초과합니다.', '자산 연면적, 임대면적, 공실면적 기준을 재확인하세요.', {
          assetId: assetId,
          assetName: item.assetName,
          grossArea: item.grossArea,
          leasedArea: item.leasedArea,
          excessArea: item.leasedArea - item.grossArea,
        });
      }
    });

    return issues.sort(function (left, right) {
      const rank = { Critical: 0, Warning: 1, Info: 2 };
      const leftRank = Object.prototype.hasOwnProperty.call(rank, left.severity) ? rank[left.severity] : 9;
      const rightRank = Object.prototype.hasOwnProperty.call(rank, right.severity) ? rank[right.severity] : 9;
      return leftRank - rightRank;
    });
  });
}

function summarizeDataQualityIssues_(issues) {
  const summary = issues.reduce(function (accumulator, issue) {
    accumulator.total += 1;
    accumulator[issue.severity] = (accumulator[issue.severity] || 0) + 1;
    return accumulator;
  }, { total: 0, Critical: 0, Warning: 0, Info: 0 });
  return summary;
}

function buildDataQualityResponse_(issues, startedAt, source) {
  const summary = summarizeDataQualityIssues_(issues || []);
  return returnDashboardPerf_('getDataQualityData', 'total', startedAt, {
    generatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
    summary: summary,
    issues: issues || [],
    source: source || 'validateDashboardData',
  });
}

function buildDataQualityIssuesFromAdminReviewCache_(reviewCache) {
  const issues = [];
  const details = safeGet_(reviewCache, ['reviewDetails']) || {};
  const generalSheet = getConfig_().sheetNames.general;
  const historySheet = getConfig_().sheetNames.history;
  const companySheet = getConfig_().sheetNames.company;
  const assetSheet = getConfig_().sheetNames.asset;

  function addRows(rows, severity, sheetName, fieldName, issue, suggestedFix) {
    (rows || []).forEach(function (row) {
      issues.push(makeDashboardValidationIssue_(severity, sheetName, row.rowNumber || row.rowRef || '', fieldName, issue, suggestedFix, {
        assetName: row.assetName || '',
        tenantMasterName: row.tenantMasterName || '',
        leaseSpaceId: row.leaseSpaceId || '',
        floorLabel: row.floorLabel || '',
        detailAreaLabel: row.detailAreaLabel || '',
        currentEndDate: row.currentEndDate || '',
        currentMonthlyRentTotal: row.currentMonthlyRentTotal,
        currentMonthlyMfTotal: row.currentMonthlyMfTotal,
        eNoc: row.eNoc,
        reviewStatus: row.reviewStatus || row.status || '',
        reviewNote: row.reviewNote || row.message || '',
      }));
    });
  }

  addRows(details.historyUnmatched, 'Warning', generalSheet, 'history_linked', 'DB_일반 계약 행과 DB_히스토리 누적 최신 금액 행이 연결되지 않았습니다.', 'lease_space_id와 히스토리 기준일/임차인/자산 매칭 값을 확인하세요.');
  addRows(details.rentMissing, 'Critical', historySheet, '평당 월임대료', '최신 히스토리 행의 평당 월임대료가 비어 있어 임대료/E.NOC 계산이 불안정합니다.', 'DB_히스토리 누적 시트의 최신 계약 기준 평당 월임대료를 입력하세요.');
  addRows(details.mfMissing, 'Critical', historySheet, '평당 월관리비', '최신 히스토리 행의 평당 월관리비가 비어 있어 관리비/E.NOC 계산이 불안정합니다.', 'DB_히스토리 누적 시트의 최신 계약 기준 평당 월관리비를 입력하세요.');
  addRows(details.eNocMissing, 'Critical', generalSheet, 'E.NOC', 'E.NOC_v2 계산 입력값이 부족하거나 계산값이 비어 있습니다.', '현재 계약기간, RF, FO, 전용률, 전용면적, TI, 최신 평당 임대료/관리비를 확인하세요.');
  addRows(details.suspectedError, 'Critical', generalSheet, 'review_status', '계산 결과가 정상 범위를 벗어난 의심 오류입니다.', 'review_note의 원인과 원천 입력값을 함께 확인하세요.');
  addRows(details.reviewRequired, 'Warning', generalSheet, 'review_status', '관리자 검토가 필요한 계약 행입니다.', 'review_note를 확인하고 원천값을 보정하세요.');

  (details.issueBacklog || []).forEach(function (row) {
    issues.push(makeDashboardValidationIssue_(row.severity || 'Warning', row.sheetName || generalSheet, row.rowRef || '', row.ruleName || 'AUDIT', row.message || 'AUDIT 데이터 이상 항목입니다.', 'AUDIT_데이터이상 기준으로 원천 행을 확인하세요.', row));
  });

  (reviewCache.openDartBacklog || []).forEach(function (row) {
    issues.push(makeDashboardValidationIssue_('Warning', companySheet, '', 'OpenDART', 'OpenDART 연결 또는 공식 공시 확인이 필요한 기업입니다.', '사업자번호, 법인명, DART corp code, review_note를 확인하세요.', row));
  });

  (reviewCache.buildingBacklog || []).forEach(function (row) {
    issues.push(makeDashboardValidationIssue_('Warning', assetSheet, '', '건축물대장', '건축물대장 조회키 또는 공식 API 확인이 필요한 자산입니다.', 'query_key, sigunguCd, bjdongCd, bun/ji, review_note를 확인하세요.', row));
  });

  return issues.slice(0, 500);
}

function getDataQualityData() {
  const startedAt = Date.now();
  const cacheKey = 'data-quality:admin-review-cache:v1';
  const cached = getCachedJson_(cacheKey);
  if (cached) return returnDashboardPerf_('getDataQualityData', 'total:cache', startedAt, cached);

  const reviewCache = readPersistedJsonProperty_('ADMIN_REVIEW_CACHE_JSON') || {};
  const cachedIssues = buildDataQualityIssuesFromAdminReviewCache_(reviewCache);
  if (cachedIssues.length) {
    return putCachedJson_(cacheKey, buildDataQualityResponse_(cachedIssues, startedAt, 'ADMIN_REVIEW_CACHE_JSON'), getConfig_().payloadCacheTtlSeconds);
  }

  try {
    return putCachedJson_(cacheKey, buildDataQualityResponse_(validateDashboardData(), startedAt, 'validateDashboardData'), getConfig_().payloadCacheTtlSeconds);
  } catch (error) {
    const fallbackIssue = makeDashboardValidationIssue_('Warning', 'System', '', 'validateDashboardData', '데이터 품질 전체 검증을 제한 시간 안에 완료하지 못했습니다.', safeString_(error && error.message) || 'Admin 스냅샷 갱신 후 다시 실행하세요.');
    return buildDataQualityResponse_([fallbackIssue], startedAt, 'fallback_error');
  }
}

function readAuditLogRows_(limit) {
  const sheet = getSpreadsheet_().getSheetByName(getConfig_().sheetNames.auditLog || 'AuditLog');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const lastRow = sheet.getLastRow();
  const width = Math.min(sheet.getLastColumn(), AUDIT_LOG_HEADERS_.length);
  const normalizedLimit = Math.max(1, Math.min(500, Number(limit || 100)));
  const startRow = Math.max(2, lastRow - normalizedLimit + 1);
  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, width).getDisplayValues();
  return values.map(function (row) {
    return AUDIT_LOG_HEADERS_.reduce(function (accumulator, header, index) {
      accumulator[header] = row[index] || '';
      return accumulator;
    }, {});
  }).reverse();
}

function summarizeAuditLog_(rows) {
  return (rows || []).reduce(function (summary, row) {
    summary.total += 1;
    const actionType = safeString_(row.actionType || 'unknown');
    summary.byAction[actionType] = (summary.byAction[actionType] || 0) + 1;
    if (safeString_(row.reason) === 'reason_required') summary.reasonRequired += 1;
    return summary;
  }, { total: 0, reasonRequired: 0, byAction: {} });
}

function getAuditLogData(request) {
  assertAdmin_(request);
  const rows = readAuditLogRows_(request && request.limit);
  if (typeof persistAdminAuditLogCache_ === 'function') {
    persistAdminAuditLogCache_(rows);
  }
  return {
    generatedAt: formatAuditTimestamp_(new Date()),
    summary: summarizeAuditLog_(rows),
    rows: rows,
  };
}

function normalizeBuildingParcelPart_(value) {
  const digits = safeString_(value).replace(/[^0-9]/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0');
}

function normalizeBuildingQueryForApi_(query) {
  return {
    sigunguCd: safeString_(query && query.sigunguCd),
    bjdongCd: safeString_(query && query.bjdongCd),
    platGbCd: safeString_((query && query.platGbCd) || '0'),
    bun: normalizeBuildingParcelPart_(query && query.bun),
    ji: normalizeBuildingParcelPart_(query && query.ji),
  };
}

function fetchBuildingRegisterItems_(endpointName, query, numOfRows) {
  const config = getConfig_();
  const normalized = normalizeBuildingQueryForApi_(query);
  const params = [
    `serviceKey=${config.buildingRegisterApiKeyEncoded || config.buildingHubApiKey}`,
    `sigunguCd=${encodeURIComponent(normalized.sigunguCd)}`,
    `bjdongCd=${encodeURIComponent(normalized.bjdongCd)}`,
    `platGbCd=${encodeURIComponent(normalized.platGbCd || '0')}`,
    `bun=${encodeURIComponent(normalized.bun || '')}`,
    `ji=${encodeURIComponent(normalized.ji || '')}`,
    '_type=json',
    `numOfRows=${numOfRows || 100}`,
    'pageNo=1',
  ].join('&');
  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/${endpointName}?${params}`;
  const response = fetchJsonWithMute_(url);
  assertNoFetchAuthError_(response, `BuildingRegister ${endpointName}`);
  const item = (((response || {}).response || {}).body || {}).items;
  const rows = item && item.item ? (Array.isArray(item.item) ? item.item : [item.item]) : [];
  return rows.map(function (entry) {
    return {
      endpoint: endpointName,
      query: normalized,
      item: entry,
    };
  });
}

function buildBuildingQueryKey_(query) {
  if (Array.isArray(query)) {
    return query.map(function (item) {
      return buildBuildingQueryKey_(item);
    }).filter(Boolean).join('||');
  }
  const normalized = normalizeBuildingQueryForApi_(query || {});
  if (!normalized.sigunguCd || !normalized.bjdongCd) return '';
  return [
    normalized.sigunguCd,
    normalized.bjdongCd,
    normalized.platGbCd || '0',
    normalized.bun || '',
    normalized.ji || '',
  ].join('|');
}

function fetchBuildingRegisterTitleInfo_(sigunguCd, bjdongCd, platGbCd, bun, ji) {
  return fetchBuildingRegisterItems_('getBrTitleInfo', {
    sigunguCd: sigunguCd,
    bjdongCd: bjdongCd,
    platGbCd: platGbCd,
    bun: bun,
    ji: ji,
  }, 100);
}

function fetchBuildingRegisterTitleInfos_(queries) {
  return (queries || []).reduce(function (accumulator, query) {
    return accumulator.concat(fetchBuildingRegisterTitleInfo_(query.sigunguCd, query.bjdongCd, query.platGbCd || '0', query.bun || '', query.ji || ''));
  }, []);
}

function aggregateBuildingRegisterInfo_(queries, items) {
  if (!(items || []).length) return null;

  const normalizedEntries = (items || []).map(function (entry, index) {
    if (entry && entry.item) return entry;
    return {
      endpoint: 'getBrTitleInfo',
      query: normalizeBuildingQueryForApi_((queries || [])[index] || {}),
      item: entry,
    };
  }).filter(function (entry) {
    return entry && entry.item;
  });

  if (!normalizedEntries.length) return null;

  const landAreaByParcel = {};
  let grossFloorArea = 0;
  let approvalDate = '';
  let maxGround = 0;
  let maxUnderground = 0;
  const buildingNames = [];

  normalizedEntries.forEach(function (entry) {
    const query = entry.query || {};
    const item = entry.item || {};
    const parcelKey = [query.sigunguCd, query.bjdongCd, query.platGbCd || '0', query.bun || '', query.ji || ''].join('|');
    const buildingName = safeString_(item.bldNm || item.dongNm);
    if (buildingName && buildingNames.indexOf(buildingName) === -1) buildingNames.push(buildingName);
    if (item.useAprDay) approvalDate = safeString_(item.useAprDay);
    if (item.totArea != null && item.totArea !== '') grossFloorArea += Number(item.totArea || 0);
    if (item.platArea != null && item.platArea !== '') landAreaByParcel[parcelKey] = Math.max(Number(landAreaByParcel[parcelKey] || 0), Number(item.platArea || 0));
    maxGround = Math.max(maxGround, Number(item.grndFlrCnt || 0));
    maxUnderground = Math.max(maxUnderground, Number(item.ugrndFlrCnt || 0));
    const floorNo = Math.abs(Number(item.flrNo || 0));
    if (safeString_(item.flrGbCd) === '20' || safeString_(item.flrGbCdNm).indexOf('지상') > -1) maxGround = Math.max(maxGround, floorNo);
    if (safeString_(item.flrGbCd) === '10' || safeString_(item.flrGbCdNm).indexOf('지하') > -1) maxUnderground = Math.max(maxUnderground, floorNo);
  });

  const totalLandArea = Object.keys(landAreaByParcel).reduce(function (sum, key) {
    return sum + Number(landAreaByParcel[key] || 0);
  }, 0);

  return {
    approvalDate: approvalDate || '',
    grossFloorArea: grossFloorArea || null,
    landArea: totalLandArea || null,
    floorCount: [maxGround ? String(maxGround) + 'F' : '', maxUnderground ? 'B' + String(maxUnderground) : ''].filter(Boolean).join(' / '),
    buildingName: buildingNames.join(' / '),
  };
}

function fetchBuildingRegisterFallbackSnapshot_(queries) {
  const fallbackEndpoints = ['getBrRecapTitleInfo', 'getBrFlrOulnInfo', 'getBrExposPubuseAreaInfo', 'getBrAtchJibunInfo'];
  const entries = [];
  (queries || []).forEach(function (query) {
    fallbackEndpoints.forEach(function (endpointName) {
      Array.prototype.push.apply(entries, fetchBuildingRegisterItems_(endpointName, query, endpointName === 'getBrFlrOulnInfo' ? 200 : 100));
    });
  });
  if (!entries.length) return null;

  const recapEntries = entries.filter(function (entry) { return entry.endpoint === 'getBrRecapTitleInfo'; });
  if (recapEntries.length) {
    return {
      aggregate: aggregateBuildingRegisterInfo_(queries, recapEntries),
      reviewStatus: 'ok',
      buildingHubStatus: 'ok_official_fallback',
      reviewNote: '건축HUB getBrTitleInfo 미응답. 공식 총괄표제부 fallback으로 적재했습니다.',
    };
  }

  const floorEntries = entries.filter(function (entry) { return entry.endpoint === 'getBrFlrOulnInfo'; });
  if (floorEntries.length) {
    const aggregate = aggregateBuildingRegisterInfo_(queries, floorEntries);
    return {
      aggregate: aggregate,
      reviewStatus: 'review_required',
      buildingHubStatus: 'official_fallback_partial',
      reviewNote: '건축HUB getBrTitleInfo 미응답. 공식 층별개요 fallback으로 일부 항목만 보완했습니다.',
    };
  }

  const exposEntries = entries.filter(function (entry) { return entry.endpoint === 'getBrExposPubuseAreaInfo'; });
  const atchEntries = entries.filter(function (entry) { return entry.endpoint === 'getBrAtchJibunInfo'; });
  if (exposEntries.length || atchEntries.length) {
    return {
      aggregate: null,
      reviewStatus: 'review_required',
      buildingHubStatus: 'official_fallback_partial',
      reviewNote: '건축HUB getBrTitleInfo 미응답. 공식 전유공용면적/부속지번 조회만 확인돼 자산 기본값은 추가 검토가 필요합니다.',
    };
  }

  return null;
}

function syncBuildingRegisterData() {
  try {
    const config = getConfig_();
    const spreadsheet = getSpreadsheet_();
    const assetSheet = spreadsheet.getSheetByName(config.sheetNames.asset);
    const lookupSheet = spreadsheet.getSheetByName(config.sheetNames.sysAssetLookup);
    ensureAssetLookupSeeds_(assetSheet, lookupSheet);

    const lookupRows = loadObjectsFromSheet_(spreadsheet, config.sheetNames.sysAssetLookup);
    const lookupIndex = buildBuildingLookupIndex_(lookupRows);
    const existingRowCount = assetSheet.getLastRow();
    const rows = assetSheet.getRange(1, 1, existingRowCount, assetSheet.getLastColumn()).getDisplayValues();
    if (rows.length < 2) {
      recordIntegrationRun_('building_hub', {
        status: 'success',
        message: 'DB_ASSET에 동기화 대상 행이 없습니다.',
      });
      return { updated: 0, pending: 0 };
    }

    const headers = rows[0];
    const idx = headerIndexes_(headers);
    const beforeRows = rows.slice(1).map(function (row) { return row.slice(); });
    const output = [];
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    let updated = 0;
    let pending = 0;

    for (let index = 1; index < rows.length; index += 1) {
      const row = rows[index].slice();
      if (!readRowCell_(row, idx, ['asset_code', '자산코드']) && !readRowCell_(row, idx, ['asset_name', '자산명'])) continue;
      const lookup = resolveBuildingLookupCandidateByAlias_(row, idx, lookupIndex);
      const query = resolveBuildingRegisterQueryByAlias_(row, idx, lookup);
      if (!query) {
        if (!readRowCell_(row, idx, ['review_status'])) writeRowCell_(row, idx, ['review_status'], 'review_required');
        if (!readRowCell_(row, idx, ['review_note'])) {
          const lookupQueryKey = lookup && lookup.queryKey;
          writeRowCell_(row, idx, ['review_note'], (lookup && lookup.note) || (lookupQueryKey
            ? 'Building register query key is not structured. Fill sigunguCd/bjdongCd or a pipe-delimited query_key.'
            : 'Building register query key is missing.'));
        }
        writeRowCellPreserve_(row, idx, ['building_hub_status'], 'pending');
        pending += 1;
        output.push(row);
        continue;
      }

      const queryList = Array.isArray(query) ? query : [query];
      const primaryQuery = normalizeBuildingQueryForApi_(queryList[0]);
      writeRowCell_(row, idx, ['sigunguCd'], primaryQuery.sigunguCd);
      writeRowCell_(row, idx, ['bjdongCd'], primaryQuery.bjdongCd);
      writeRowCell_(row, idx, ['platGbCd'], primaryQuery.platGbCd || '0');
      writeRowCell_(row, idx, ['bun'], primaryQuery.bun || '');
      writeRowCell_(row, idx, ['ji'], primaryQuery.ji || '');

      const titleRows = fetchBuildingRegisterTitleInfos_(queryList);
      let aggregate = aggregateBuildingRegisterInfo_(queryList, titleRows);
      let reviewStatus = 'ok';
      let reviewNote = '';
      let buildingHubStatus = queryList.length > 1 ? 'ok_composite' : 'ok';

      if (!aggregate) {
        const fallbackSnapshot = fetchBuildingRegisterFallbackSnapshot_(queryList);
        if (fallbackSnapshot && fallbackSnapshot.aggregate) {
          aggregate = fallbackSnapshot.aggregate;
          reviewStatus = fallbackSnapshot.reviewStatus || 'review_required';
          reviewNote = fallbackSnapshot.reviewNote || '';
          buildingHubStatus = fallbackSnapshot.buildingHubStatus || 'official_fallback_partial';
        } else {
          writeRowCell_(row, idx, ['building_hub_status'], 'not_found');
          writeRowCell_(row, idx, ['review_status'], 'review_required');
          writeRowCell_(row, idx, ['review_note'], (lookup && lookup.note) || 'Official building register sources returned no matching record.');
          pending += 1;
          output.push(row);
          continue;
        }
      }

      writeRowCellPreserve_(row, idx, ['approval_date', '사용승인일'], aggregate.approvalDate);
      writeRowCellPreserve_(row, idx, ['gross_floor_area', '연면적'], aggregate.grossFloorArea);
      writeRowCellPreserve_(row, idx, ['land_area', '대지면적'], aggregate.landArea);
      writeRowCellPreserve_(row, idx, ['floor_count', '층수'], aggregate.floorCount);
      writeRowCellPreserve_(row, idx, ['building_name', '건물명'], aggregate.buildingName);
      writeRowCell_(row, idx, ['fetched_at'], today);
      writeRowCell_(row, idx, ['review_status'], reviewStatus);
      writeRowCell_(row, idx, ['review_note'], reviewNote);
      writeRowCell_(row, idx, ['building_hub_status'], buildingHubStatus);
      updated += 1;
      output.push(row);
    }

    assetSheet.getRange(1, 1, output.length + 1, headers.length).setValues([headers].concat(output));
    if (existingRowCount > output.length + 1) {
      assetSheet.getRange(output.length + 2, 1, existingRowCount - output.length - 1, headers.length).clearContent();
    }
    const summaryMessage = updated + ' rows updated / ' + pending + ' pending';
    writeAuditLogs_(buildSheetDiffAuditEntries_(beforeRows, output, headers, {
      actionType: 'SYNC',
      entityType: 'asset',
      sheetName: config.sheetNames.asset,
      reason: '건축물대장 동기화',
      sourceFunction: 'syncBuildingRegisterData',
      sourceType: 'server',
      cacheInvalidated: true,
    }));
    logApiEvent_('BuildingRegister', 'syncBuildingRegisterData', 'DB_ASSET', pending ? 'partial' : 'ok', summaryMessage, '');
    recordIntegrationRun_('building_hub', {
      status: pending ? 'partial_success' : 'success',
      message: summaryMessage,
    });
    markDataDirty_('sync_building_register');
    invalidateDashboardCaches_();
    return { updated: updated, pending: pending };
  } catch (error) {
    const message = safeString_(error && error.message) || 'Building register sync failed.';
    recordIntegrationRun_('building_hub', {
      status: 'failure',
      code: /authorization|auth|권한/i.test(message) ? 'AUTH_REQUIRED' : 'ERROR',
      message: message,
    });
    throw error;
  }
}

function fetchOpenDartFinanceInfo_(corpCode) {
  const config = getConfig_();
  const checkedYears = [];
  const checkedReportCodes = [];
  let lastStatus = '013';
  let lastMessage = '조회된 데이타가 없습니다.';
  let matchedPayload = null;

  iterateOpenDartFinanceRequests_(function (year, reportCode, fsDiv) {
    if (checkedYears.indexOf(year) === -1) checkedYears.push(year);
    if (checkedReportCodes.indexOf(reportCode) === -1) checkedReportCodes.push(reportCode);
    const url = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=${encodeURIComponent(config.openDartApiKey)}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${reportCode}&fs_div=${fsDiv}`;
    const response = fetchJsonWithMute_(url);
    logApiEvent_('OpenDART', 'fnlttSinglAcntAll.json', corpCode, response.status === '000' ? 'ok' : 'error', response.message || response.status || '', '');
    if (response.status !== '000' || !response.list || !response.list.length) {
      lastStatus = response.status || lastStatus;
      lastMessage = response.message || response.status || lastMessage;
      return false;
    }

    let revenue = null;
    let operatingIncome = null;
    let liabilities = null;
    let equity = null;
    response.list.forEach(function (item) {
      const account = safeString_(item.account_nm).toLowerCase();
      const accountId = safeString_(item.account_id).toLowerCase();
      const amount = toNumber_(item.thstrm_amount);
      if (revenue == null && isOpenDartRevenueAccount_(account, accountId)) revenue = amount;
      if (operatingIncome == null && isOpenDartOperatingIncomeAccount_(account, accountId)) operatingIncome = amount;
      if (liabilities == null && isOpenDartLiabilitiesAccount_(account, accountId)) liabilities = amount;
      if (equity == null && isOpenDartEquityAccount_(account, accountId)) equity = amount;
    });

    matchedPayload = {
      status: '000',
      message: '',
      year: year,
      fsDiv: fsDiv,
      reportCode: reportCode,
      revenue: revenue,
      operatingIncome: operatingIncome,
      debtRatio: liabilities != null && equity ? roundNumber_((liabilities / equity) * 100, 2) : null,
      checkedYears: checkedYears.slice(),
      checkedReportCodes: uniqueValues_(checkedReportCodes.slice()),
    };
    return true;
  });

  if (matchedPayload) return matchedPayload;

  return {
    status: lastStatus,
    message: lastMessage,
    year: '',
    fsDiv: '',
    reportCode: '',
    revenue: null,
    operatingIncome: null,
    debtRatio: null,
    checkedYears: checkedYears,
    checkedReportCodes: uniqueValues_(checkedReportCodes),
  };
}

function selectOpenDartEmployeeTotalRow_(items) {
  const rows = (items || []).filter(Boolean);
  return rows.find(function (item) {
    const focus = normalizeWhitespace_(item.fo_bbm);
    return focus === '성별합계' || focus.toLowerCase() === 'total';
  }) || null;
}

function fetchOpenDartEmployeeInfo_(corpCode) {
  const config = getConfig_();
  const checkedYears = [];
  const checkedReportCodes = [];
  let lastStatus = '013';
  let lastMessage = '조회된 데이타가 없습니다.';
  let matchedPayload = null;

  iterateOpenDartEmployeeRequests_(function (year, reportCode) {
    if (checkedYears.indexOf(year) === -1) checkedYears.push(year);
    if (checkedReportCodes.indexOf(reportCode) === -1) checkedReportCodes.push(reportCode);
    const url = `https://opendart.fss.or.kr/api/empSttus.json?crtfc_key=${encodeURIComponent(config.openDartApiKey)}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${reportCode}`;
    const response = fetchJsonWithMute_(url);
    logApiEvent_('OpenDART', 'empSttus.json', corpCode, response.status === '000' ? 'ok' : 'error', response.message || response.status || '', '');
    if (response.status !== '000' || !response.list || !response.list.length) {
      lastStatus = response.status || lastStatus;
      lastMessage = response.message || response.status || lastMessage;
      return false;
    }
    const totalRow = selectOpenDartEmployeeTotalRow_(response.list);
    matchedPayload = {
      status: '000',
      message: '',
      year: year,
      reportCode: reportCode,
      employeeCount: totalRow
        ? (toNumber_(totalRow.sm) || null)
        : (response.list.reduce(function (sum, item) {
          return sum + (toNumber_(item.sm) || 0);
        }, 0) || null),
      checkedYears: checkedYears.slice(),
      checkedReportCodes: uniqueValues_(checkedReportCodes.slice()),
    };
    return true;
  });

  if (matchedPayload) return matchedPayload;

  return {
    status: lastStatus,
    message: lastMessage,
    year: '',
    reportCode: '',
    employeeCount: null,
    checkedYears: checkedYears,
    checkedReportCodes: uniqueValues_(checkedReportCodes),
  };
}

function fetchOpenDartRecentReports_(corpCode) {
  const config = getConfig_();
  const currentYear = new Date().getFullYear();
  const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${encodeURIComponent(config.openDartApiKey)}&corp_code=${corpCode}&bgn_de=${currentYear - 4}0101&end_de=${currentYear}1231&page_no=1&page_count=30`;
  const response = fetchJsonWithMute_(url);
  assertNoFetchAuthError_(response, 'OpenDART list.json');
  if (response.status !== '000' || !response.list || !response.list.length) return [];
  return response.list;
}

function chooseOpenDartDocumentReport_(reports) {
  const items = reports || [];
  for (let index = 0; index < items.length; index += 1) {
    if (safeString_(items[index].report_nm).indexOf('연결감사보고서') > -1) return items[index];
  }
  for (let index = 0; index < items.length; index += 1) {
    if (safeString_(items[index].report_nm).indexOf('감사보고서') > -1) return items[index];
  }
  for (let index = 0; index < items.length; index += 1) {
    if (safeString_(items[index].report_nm).indexOf('사업보고서') > -1) return items[index];
  }
  return items[0] || null;
}

function fetchOpenDartDocumentXmlText_(rceptNo) {
  const config = getConfig_();
  const url = `https://opendart.fss.or.kr/api/document.xml?crtfc_key=${encodeURIComponent(config.openDartApiKey)}&rcept_no=${rceptNo}`;
  const blob = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getBlob();
  const unzip = Utilities.unzip(blob);
  return unzip.length ? unzip[0].getDataAsString('UTF-8') : '';
}

function parseOpenDartDocumentExtractions_(xmlText) {
  const map = {};
  const regex = /<EXTRACTION ACODE="([^"]+)"[^>]*>([^<]*)<\/EXTRACTION>/g;
  let match = regex.exec(xmlText);
  while (match) {
    map[match[1]] = match[2];
    match = regex.exec(xmlText);
  }
  return map;
}

function toOpenDartDocWon_(value) {
  const numeric = toNumber_(value);
  return numeric == null ? null : numeric * 1000000;
}

function normalizeOpenDartPlainText_(xmlText) {
  return safeString_(xmlText).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function findOpenDartOperatingIncomeFromText_(plainText, revenue) {
  const patterns = [
    { regex: /영\s*업\s*이\s*익\s*\(?\s*손\s*실\s*\)?\s*(\(?)\s*([0-9,]+)\)?\s*(\(?)\s*([0-9,]+)\)?/, negative: false },
    { regex: /영\s*업\s*이\s*익\s*(\(?)\s*([0-9,]+)\)?\s*(\(?)\s*([0-9,]+)\)?/, negative: false },
    { regex: /영\s*업\s*손\s*실\s*(\(?)\s*([0-9,]+)\)?\s*(\(?)\s*([0-9,]+)\)?/, negative: true },
  ];
  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index];
    const match = pattern.regex.exec(plainText);
    if (!match) continue;
    let value = toNumber_(match[2]);
    if (value == null) continue;
    if (pattern.negative || match[1] === '(') value = -value;
    if (revenue != null && Math.abs(value) > revenue) continue;
    if (revenue != null && revenue / Math.max(Math.abs(value), 1) > 1000) {
      value = value * 1000000;
    }
    return value;
  }
  return null;
}

function fetchOpenDartDocumentFallback_(corpCode) {
  const reports = fetchOpenDartRecentReports_(corpCode);
  const report = chooseOpenDartDocumentReport_(reports);
  if (!report || !report.rcept_no) {
    return { status: '013', message: 'No document report is available.', revenue: null, operatingIncome: null, debtRatio: null, employeeCount: null };
  }
  const xmlText = fetchOpenDartDocumentXmlText_(report.rcept_no);
  const extractions = parseOpenDartDocumentExtractions_(xmlText);
  const plainText = normalizeOpenDartPlainText_(xmlText);
  const revenue = toOpenDartDocWon_(extractions.TOT_SALES);
  const employeeCount = toNumber_(extractions.TOT_EMPL);
  const assets = toOpenDartDocWon_(extractions.TOT_ASSETS);
  const debts = toOpenDartDocWon_(extractions.TOT_DEBTS);
  const debtRatio = assets != null && debts != null && (assets - debts) !== 0
    ? roundNumber_((debts / (assets - debts)) * 100, 2)
    : null;
  const operatingIncome = findOpenDartOperatingIncomeFromText_(plainText, revenue);
  return {
    status: '000',
    message: '',
    year: safeString_(report.rcept_dt).slice(0, 4),
    fsDiv: safeString_(report.report_nm).indexOf('연결') > -1 ? 'CFS_DOC' : 'OFS_DOC',
    reportCode: 'DOC',
    reportName: report.report_nm,
    rceptNo: report.rcept_no,
    revenue: revenue,
    operatingIncome: operatingIncome,
    debtRatio: debtRatio,
    employeeCount: employeeCount,
  };
}

function buildOpenDartNoResponseNote_(target) {
  if (target === 'finance') {
    return 'OpenDART 공식 공시 없음(013): 재무 공시를 찾지 못했습니다. 사업보고서 우선, 없으면 최근 분반기와 CFS/OFS를 순차 조회했습니다.';
  }
  return 'OpenDART 공식 공시 없음(013): 직원 현황 공시를 찾지 못했습니다. 사업보고서 우선, 없으면 최근 분반기를 순차 조회했습니다.';
}

function buildOpenDartErrorNote_(target, payload) {
  const label = target === 'finance' ? '재무' : '직원수';
  return `OpenDART 응답 ${safeString_(payload && payload.status) || 'unknown'}: ${label} 값을 적재하지 못했습니다.`;
}

function buildOpenDartMatchedReviewNotes_(request, corpPayload) {
  const notes = [];
  if (splitOpenDartEntityNames_(request.tenantMasterName).length > 1) {
    notes.push('복수 기업명이 함께 입력되어 대표 법인 기준으로 연결했습니다.');
  }
  if (corpPayload.finance && corpPayload.finance.status && corpPayload.finance.status !== '000') {
    notes.push(corpPayload.finance.status === '013'
      ? buildOpenDartNoResponseNote_('finance')
      : buildOpenDartErrorNote_('finance', corpPayload.finance));
  }
  if (corpPayload.employee && corpPayload.employee.status && corpPayload.employee.status !== '000') {
    notes.push(corpPayload.employee.status === '013'
      ? buildOpenDartNoResponseNote_('employee')
      : buildOpenDartErrorNote_('employee', corpPayload.employee));
  }
  return uniqueValues_(notes.filter(Boolean));
}
