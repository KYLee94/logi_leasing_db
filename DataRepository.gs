let MODEL_RUNTIME_CACHE = null;
let MODEL_RUNTIME_CACHE_AT = 0;

function chooseKnownValue_(primary, fallback) {
  return primary == null || primary === '' ? fallback : primary;
}

function mergeLookupPayload_(current, incoming) {
  const base = current || {};
  const next = incoming || {};
  return {
    lookupAddress: chooseKnownValue_(base.lookupAddress, next.lookupAddress) || '',
    queryKey: chooseKnownValue_(base.queryKey, next.queryKey) || '',
    sigunguCd: chooseKnownValue_(base.sigunguCd, next.sigunguCd) || '',
    bjdongCd: chooseKnownValue_(base.bjdongCd, next.bjdongCd) || '',
    platGbCd: chooseKnownValue_(base.platGbCd, next.platGbCd) || '',
    bun: chooseKnownValue_(base.bun, next.bun) || '',
    ji: chooseKnownValue_(base.ji, next.ji) || '',
    latitude: chooseKnownValue_(base.latitude, next.latitude),
    longitude: chooseKnownValue_(base.longitude, next.longitude),
    geocodeStatus: chooseKnownValue_(base.geocodeStatus, next.geocodeStatus) || '',
    buildingHubStatus: chooseKnownValue_(base.buildingHubStatus, next.buildingHubStatus) || '',
  };
}

function storeLookupPayload_(map, key, payload) {
  if (!key) return;
  map[key] = mergeLookupPayload_(map[key], payload);
}

function resolveStructuredBuildingFields_(row) {
  const parsed = typeof parseBuildingQueryKey_ === 'function'
    ? parseBuildingQueryKey_(pickField_(row, ['query_key']))
    : null;
  return {
    sigunguCd: normalizeWhitespace_(pickField_(row, ['sigunguCd'])) || (parsed ? parsed.sigunguCd : ''),
    bjdongCd: normalizeWhitespace_(pickField_(row, ['bjdongCd'])) || (parsed ? parsed.bjdongCd : ''),
    platGbCd: normalizeWhitespace_(pickField_(row, ['platGbCd'])) || (parsed ? parsed.platGbCd : ''),
    bun: normalizeWhitespace_(pickField_(row, ['bun'])) || (parsed ? parsed.bun : ''),
    ji: normalizeWhitespace_(pickField_(row, ['ji'])) || (parsed ? parsed.ji : ''),
  };
}

function sumKnownRowMetric_(rows, selector) {
  let sum = 0;
  let hasValue = false;
  (rows || []).forEach(function (row) {
    const value = typeof selector === 'function' ? selector(row) : row[selector];
    if (value == null || value === '') return;
    sum += Number(value);
    hasValue = true;
  });
  return hasValue ? sum : null;
}

function buildRowCompletenessSummary_(rows) {
  return {
    totalRows: (rows || []).length,
    historyUnmatched: (rows || []).filter(function (row) { return !row.historyLinked; }).length,
    historyFallback: 0,
    latestHistoryMoneyMissing: (rows || []).filter(function (row) { return row.currentMoneyStatus === 'latest_history_money_missing'; }).length,
    rentMissing: (rows || []).filter(function (row) { return row.currentMonthlyRentTotal == null; }).length,
    mfMissing: (rows || []).filter(function (row) { return row.currentMonthlyMfTotal == null; }).length,
    moneyMissing: (rows || []).filter(function (row) {
      return row.currentMonthlyRentTotal == null || row.currentMonthlyMfTotal == null;
    }).length,
    eNocMissing: (rows || []).filter(function (row) { return row.eNoc == null; }).length,
    businessRegistrationMissing: (rows || []).filter(function (row) { return !row.businessRegistrationNo; }).length,
  };
}

function countUniqueRowValues_(rows, selector) {
  return uniqueValues_((rows || []).map(function (row) {
    return typeof selector === 'function' ? selector(row) : row[selector];
  }).filter(function (value) {
    return value != null && value !== '';
  })).length;
}

function computeEffectiveENocFromTotals_(rows) {
  const leasedAreaSqm = sumKnownRowMetric_(rows || [], 'leasedAreaSqm');
  const monthlyCostTotal = sumKnownRowMetric_(rows || [], function (row) {
    if (row.currentMonthlyCostTotal != null) return row.currentMonthlyCostTotal;
    if (row.currentMonthlyRentTotal == null && row.currentMonthlyMfTotal == null) return null;
    return Number(row.currentMonthlyRentTotal || 0) + Number(row.currentMonthlyMfTotal || 0);
  });
  const leasedAreaPy = leasedAreaSqm != null ? safeDivide_(leasedAreaSqm, getConfig_().areaSqmPerPy) : null;
  if (monthlyCostTotal != null && leasedAreaPy != null && leasedAreaPy > 0) {
    return roundNumber_(monthlyCostTotal / leasedAreaPy, 2);
  }
  return averageBy_((rows || []).filter(function (row) { return row.eNoc != null; }), 'eNoc');
}

function buildTenantRollupRows_(rows) {
  return sortBy_(Object.keys(groupBy_(rows || [], 'tenantId')).map(function (tenantId) {
    const tenantRows = (rows || []).filter(function (row) { return row.tenantId === tenantId; });
    const expiryRows = sortBy_(tenantRows.filter(function (row) {
      return row.currentEndDate;
    }), 'currentEndDate');
    const earliestExpiry = expiryRows.length ? expiryRows[0].currentEndDate : '';
    const latestExpiry = expiryRows.length ? expiryRows[expiryRows.length - 1].currentEndDate : '';

    return {
      tenantId: tenantId,
      tenantMasterName: tenantRows[0].tenantMasterName,
      businessRegistrationNo: tenantRows[0].businessRegistrationNo,
      assetCount: countUniqueRowValues_(tenantRows, 'assetId'),
      leaseSpaceCount: countUniqueRowValues_(tenantRows, 'leaseSpaceId'),
      leasedAreaSqm: sumKnownRowMetric_(tenantRows, 'leasedAreaSqm'),
      monthlyRentTotal: sumKnownRowMetric_(tenantRows, 'currentMonthlyRentTotal'),
      monthlyMfTotal: sumKnownRowMetric_(tenantRows, 'currentMonthlyMfTotal'),
      monthlyCostTotal: sumKnownRowMetric_(tenantRows, 'currentMonthlyCostTotal'),
      averageENoc: computeEffectiveENocFromTotals_(tenantRows),
      earliestExpiry: earliestExpiry,
      latestExpiry: latestExpiry,
      reviewStatus: tenantRows.some(function (row) { return row.calculatedReviewStatus === 'suspected_error'; })
        ? 'suspected_error'
        : tenantRows.some(function (row) { return row.calculatedReviewStatus !== 'ok'; }) ? 'review_required' : 'ok',
    };
  }), 'monthlyCostTotal', 'desc');
}

function formatRuntimeTimestamp_(value) {
  const numeric = Number(value || 0);
  if (!numeric) return '';
  return Utilities.formatDate(new Date(numeric), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function resolveModelRuntimeMeta_(options) {
  const props = PropertiesService.getScriptProperties();
  const runtime = (options && options.runtimeTimestamps) || {};
  const lastRefreshCalculationTs = Number(runtime.lastRefreshCalculationTs || props.getProperty('LAST_REFRESH_CALCULATION_TS') || 0);
  const lastDerivedRefreshTs = Number(runtime.lastDerivedRefreshTs || props.getProperty('LAST_DERIVED_REFRESH_TS') || 0);

  return {
    lastRefreshCalculationTs: lastRefreshCalculationTs,
    lastDerivedRefreshTs: lastDerivedRefreshTs,
    lastRefreshCalculationAt: formatRuntimeTimestamp_(lastRefreshCalculationTs),
    lastDerivedRefreshAt: formatRuntimeTimestamp_(lastDerivedRefreshTs),
  };
}

function buildAssetLookupMapV2_(assetRows, lookupRows) {
  const map = {};

  (assetRows || []).forEach(function (row) {
    const assetCode = normalizeWhitespace_(pickField_(row, ['asset_code', '자산코드']));
    const assetName = normalizeWhitespace_(pickField_(row, ['asset_name', '자산명']));
    const payload = {
      lookupAddress: normalizeWhitespace_(pickField_(row, ['standardized_address', '도로명주소'])),
      queryKey: normalizeWhitespace_(pickField_(row, ['query_key'])),
      sigunguCd: normalizeWhitespace_(pickField_(row, ['sigunguCd'])),
      bjdongCd: normalizeWhitespace_(pickField_(row, ['bjdongCd'])),
      platGbCd: normalizeWhitespace_(pickField_(row, ['platGbCd'])),
      bun: normalizeWhitespace_(pickField_(row, ['bun'])),
      ji: normalizeWhitespace_(pickField_(row, ['ji'])),
      latitude: toNumber_(pickField_(row, ['latitude'])),
      longitude: toNumber_(pickField_(row, ['longitude'])),
      geocodeStatus: normalizeWhitespace_(pickField_(row, ['geocode_status'])),
      buildingHubStatus: normalizeWhitespace_(pickField_(row, ['building_hub_status'])),
    };
    storeLookupPayload_(map, assetCode, payload);
    storeLookupPayload_(map, normalizeAssetLookup_(assetName), payload);
  });

  (lookupRows || []).forEach(function (row) {
    const assetCode = normalizeWhitespace_(pickField_(row, ['asset_code']));
    const assetName = normalizeWhitespace_(pickField_(row, ['asset_name']));
    const structured = resolveStructuredBuildingFields_(row);
    const payload = {
      lookupAddress: normalizeWhitespace_(pickField_(row, ['lookup_address', 'query_key'])),
      queryKey: normalizeWhitespace_(pickField_(row, ['query_key'])),
      sigunguCd: structured.sigunguCd,
      bjdongCd: structured.bjdongCd,
      platGbCd: structured.platGbCd,
      bun: structured.bun,
      ji: structured.ji,
      latitude: toNumber_(pickField_(row, ['latitude'])),
      longitude: toNumber_(pickField_(row, ['longitude'])),
      geocodeStatus: normalizeWhitespace_(pickField_(row, ['geocode_status'])),
      buildingHubStatus: normalizeWhitespace_(pickField_(row, ['building_hub_status'])),
    };
    storeLookupPayload_(map, assetCode, payload);
    storeLookupPayload_(map, normalizeAssetLookup_(assetName), payload);
  });

  return map;
}

function normalizeAssetRowV2_(row, assetLookupMap) {
  const assetCode = normalizeWhitespace_(pickField_(row, ['asset_code', '자산코드']));
  const assetName = normalizeWhitespace_(pickField_(row, ['asset_name', '자산명']));
  const assetId = normalizeWhitespace_(pickField_(row, ['asset_id'])) || (
    assetCode ? `asset_${sanitizeIdPart_(assetCode)}` : makeDeterministicId_('asset', [assetName])
  );
  const lookupPayload = assetLookupMap[assetCode] || assetLookupMap[normalizeAssetLookup_(assetName)] || {};
  const standardizedAddress = normalizeWhitespace_(pickField_(row, ['standardized_address', '도로명주소'])) || lookupPayload.lookupAddress || '';
  const sigunguCd = normalizeWhitespace_(pickField_(row, ['sigunguCd'])) || lookupPayload.sigunguCd || '';
  const bjdongCd = normalizeWhitespace_(pickField_(row, ['bjdongCd'])) || lookupPayload.bjdongCd || '';
  const platGbCd = normalizeWhitespace_(pickField_(row, ['platGbCd'])) || lookupPayload.platGbCd || '';
  const bun = normalizeWhitespace_(pickField_(row, ['bun'])) || lookupPayload.bun || '';
  const ji = normalizeWhitespace_(pickField_(row, ['ji'])) || lookupPayload.ji || '';
  const latitude = chooseKnownValue_(toNumber_(pickField_(row, ['latitude'])), lookupPayload.latitude);
  const longitude = chooseKnownValue_(toNumber_(pickField_(row, ['longitude'])), lookupPayload.longitude);
  const geocodeStatus = normalizeWhitespace_(pickField_(row, ['geocode_status'])) || lookupPayload.geocodeStatus || ((latitude != null && longitude != null) ? 'ok' : '');
  const buildingHubStatus = normalizeWhitespace_(pickField_(row, ['building_hub_status'])) || lookupPayload.buildingHubStatus || ((sigunguCd && bjdongCd) ? 'ready' : '');
  const reviewStatus = normalizeWhitespace_(pickField_(row, ['review_status'])) || (
    !assetCode || !assetName || !standardizedAddress ? 'missing' : ((sigunguCd && bjdongCd) ? 'ok' : 'review_required')
  );

  return {
    assetId: assetId,
    assetCode: assetCode,
    assetName: assetName,
    standardizedAddress: standardizedAddress,
    queryKey: lookupPayload.queryKey || '',
    sigunguCd: sigunguCd,
    bjdongCd: bjdongCd,
    platGbCd: platGbCd,
    bun: bun,
    ji: ji,
    buildingName: normalizeWhitespace_(pickField_(row, ['building_name', '건물명'])),
    firstConfiguredAt: toIsoDate_(pickField_(row, ['first_configured_at', '최초 설정일', '설정일', 'created_at'])),
    approvalDate: toIsoDate_(pickField_(row, ['approval_date', '사용승인일'])),
    grossFloorAreaSqm: toNumber_(pickField_(row, ['gross_floor_area', '연면적'])),
    landAreaSqm: toNumber_(pickField_(row, ['land_area', '대지면적'])),
    floorCount: normalizeWhitespace_(pickField_(row, ['floor_count', '층수'])),
    areaTableStatus: normalizeWhitespace_(pickField_(row, ['area_table_status', '세부면적표 반영여부'])) || 'unknown',
    fetchedAt: normalizeWhitespace_(pickField_(row, ['fetched_at'])),
    reviewStatus: reviewStatus,
    reviewNote: normalizeWhitespace_(pickField_(row, ['review_note'])),
    latitude: latitude,
    longitude: longitude,
    geocodeStatus: geocodeStatus,
    buildingHubStatus: buildingHubStatus,
  };
}

function buildAssetGrossFloorAreaTimelineBasis_(assetMaster) {
  const firstConfiguredAt = safeString_(assetMaster && assetMaster.firstConfiguredAt);
  const approvalDate = safeString_(assetMaster && assetMaster.approvalDate);
  let effectiveAt = '';
  let rule = 'active_history_only';
  let note = '자산 기준일 정보가 없어 활성 계약이 확인되는 월만 총 연면적 집계 후보로 봅니다.';

  if (firstConfiguredAt && approvalDate) {
    effectiveAt = firstConfiguredAt > approvalDate ? firstConfiguredAt : approvalDate;
    rule = 'later_of_first_configured_at_and_approval_date';
    note = '최초 설정일과 사용승인일 중 더 늦은 날짜부터 총 연면적 시계열에 반영합니다.';
  } else if (approvalDate) {
    effectiveAt = approvalDate;
    rule = 'approval_date';
    note = '사용승인일 기준으로 총 연면적 시계열에 반영합니다.';
  } else if (firstConfiguredAt) {
    effectiveAt = '';
    rule = 'skip_first_configured_only';
    note = '최초 설정일만 있고 사용승인일이 없어 총 연면적 시계열에는 반영하지 않습니다.';
  }

  return {
    firstConfiguredAt: firstConfiguredAt,
    approvalDate: approvalDate,
    effectiveAt: effectiveAt,
    effectiveMonth: effectiveAt ? monthKeyFromIso_(effectiveAt) : '',
    rule: rule,
    note: note,
  };
}

function linkHistoryRowsV2_(generalRows, historyRows) {
  const directIdIndex = {};
  const exactIndex = {};
  const relaxedIndex = {};
  const tenantOnlyIndex = {};

  (generalRows || []).forEach(function (row) {
    if (row.leaseSpaceId) {
      directIdIndex[row.leaseSpaceId] = directIdIndex[row.leaseSpaceId] || [];
      directIdIndex[row.leaseSpaceId].push(row);
    }
    const tenantKey = row.businessRegistrationNo ? row.businessRegistrationNo.replace(/[^0-9]/g, '') : normalizeKoreanLookup_(row.tenantMasterName);
    const exactKey = [
      row.assetCode,
      tenantKey,
      row.floorLabel,
      row.detailAreaLabel,
      row.leasedAreaSqm != null ? Math.round(row.leasedAreaSqm) : '',
    ].join('|');
    const relaxedKey = [
      row.assetCode,
      tenantKey,
      row.floorLabel,
      row.leasedAreaSqm != null ? Math.round(row.leasedAreaSqm) : '',
    ].join('|');
    const tenantOnlyKey = [row.assetCode, tenantKey].join('|');
    exactIndex[exactKey] = exactIndex[exactKey] || [];
    exactIndex[exactKey].push(row);
    relaxedIndex[relaxedKey] = relaxedIndex[relaxedKey] || [];
    relaxedIndex[relaxedKey].push(row);
    tenantOnlyIndex[tenantOnlyKey] = tenantOnlyIndex[tenantOnlyKey] || [];
    tenantOnlyIndex[tenantOnlyKey].push(row);
  });

  (historyRows || []).forEach(function (row) {
    const directCandidates = row.linkedLeaseSpaceId ? (directIdIndex[row.linkedLeaseSpaceId] || []) : [];
    const tenantKey = row.businessRegistrationNo ? row.businessRegistrationNo.replace(/[^0-9]/g, '') : normalizeKoreanLookup_(row.tenantMasterName);
    const exactKey = [
      row.assetCode,
      tenantKey,
      row.floorLabel,
      row.detailAreaLabel,
      row.leasedAreaSqm != null ? Math.round(row.leasedAreaSqm) : '',
    ].join('|');
    const relaxedKey = [
      row.assetCode,
      tenantKey,
      row.floorLabel,
      row.leasedAreaSqm != null ? Math.round(row.leasedAreaSqm) : '',
    ].join('|');
    const tenantOnlyKey = [row.assetCode, tenantKey].join('|');
    const candidates = directCandidates.length
      ? directCandidates
      : (exactIndex[exactKey] || []).length
        ? (exactIndex[exactKey] || [])
        : (relaxedIndex[relaxedKey] || []).length
          ? (relaxedIndex[relaxedKey] || [])
          : (tenantOnlyIndex[tenantOnlyKey] || []);
    let matchedRow = null;

    if (candidates.length === 1) {
      matchedRow = candidates[0];
      row.matchConfidence = directCandidates.length ? 'lease_space_id' : (exactIndex[exactKey] || []).length ? 'exact' : (relaxedIndex[relaxedKey] || []).length ? 'fallback' : 'fallback_loose';
    } else if (candidates.length > 1) {
      matchedRow = sortBy_(candidates, function (candidate) {
        const areaDelta = Math.abs((candidate.leasedAreaSqm || 0) - (row.leasedAreaSqm || 0));
        const floorPenalty = candidate.floorLabel === row.floorLabel ? 0 : 5;
        const detailPenalty = candidate.detailAreaLabel === row.detailAreaLabel ? 0 : 2;
        return areaDelta + floorPenalty + detailPenalty;
      })[0];
      row.matchConfidence = directCandidates.length ? 'ambiguous_lease_space_id' : (exactIndex[exactKey] || []).length ? 'ambiguous' : (relaxedIndex[relaxedKey] || []).length ? 'ambiguous_fallback' : 'ambiguous_loose';
    }

    if (matchedRow) {
      row.linkedLeaseSpaceId = matchedRow.leaseSpaceId;
      row.historyEventId = `${matchedRow.leaseSpaceId}|${row.baseDate || 'nodate'}|${row.rowNumber}`;
      matchedRow.historyCandidates = matchedRow.historyCandidates || [];
      matchedRow.historyCandidates.push(row);
    } else {
      row.reviewStatus = row.reviewStatus || 'review_required';
      row.reviewNote = row.reviewNote || 'Current history row could not be matched to DB_GENERAL.';
    }
  });

  (generalRows || []).forEach(function (row) {
    const candidates = row.historyCandidates || [];
    row.historyCandidateCount = candidates.length;
    row.currentMoneyBasis = 'unresolved';
    row.currentMoneyStatus = 'history_unmatched';
    row.currentMoneyAsOf = '';
    row.currentMonthlyCostTotal = null;
    row.historyLatestDate = '';

    if (!candidates.length) {
      row.historyLinked = false;
      row.historyLinkStatus = 'review_required';
      row.calculationStatus = row.calculatedReviewStatus === 'missing' ? 'missing' : 'review_required';
      row.eNoc = null;
      return;
    }

    const latestByDate = sortBy_(candidates, 'baseDate', 'desc')[0];
    const selectedHistory = latestByDate;
    const latestHasPerPyMoney = selectedHistory && selectedHistory.rentPerPy != null && selectedHistory.mfPerPy != null;

    candidates.forEach(function (candidate) {
      candidate.isLatest = candidate === latestByDate;
      candidate.isSelectedForMoney = candidate === selectedHistory;
    });

    row.historyLinked = true;
    row.historyLinkStatus = selectedHistory.matchConfidence;
    row.historyLatestDate = latestByDate ? latestByDate.baseDate : '';
    row.currentMoneyAsOf = selectedHistory ? (selectedHistory.baseDate || '') : '';
    row.currentMoneyBasis = 'latest_linked_history';
    row.currentMoneyStatus = latestHasPerPyMoney ? 'ok' : 'latest_history_money_missing';
    row.currentMonthlyRentTotal = selectedHistory.monthlyRentTotal;
    row.currentMonthlyMfTotal = selectedHistory.monthlyMfTotal;
    row.currentRentPerPy = selectedHistory.rentPerPy;
    row.currentMfPerPy = selectedHistory.mfPerPy;
    row.currentMonthlyCostTotal = (row.currentMonthlyRentTotal == null && row.currentMonthlyMfTotal == null)
      ? null
      : Number(row.currentMonthlyRentTotal || 0) + Number(row.currentMonthlyMfTotal || 0);

    const calculation = computeENoc_(row, selectedHistory, getConfig_());
    row.eNoc = calculation.value;
    row.calculationStatus = calculation.status;

    if (row.currentMoneyStatus === 'latest_history_money_missing') {
      row.calculatedReviewNotes.push('Latest linked history row is missing rentPerPy or mfPerPy.');
      if (row.calculatedReviewStatus === 'ok') row.calculatedReviewStatus = 'review_required';
    }

    if (calculation.status === 'review_required' && row.calculatedReviewStatus === 'ok') {
      row.calculatedReviewStatus = 'review_required';
      row.calculatedReviewNotes.push('E.NOC requires manual review.');
    }
    flagENocOutlier_(row);
    row.calculatedReviewNotes = uniqueValues_(row.calculatedReviewNotes);
  });
}

function buildAssetSummaryByIdV2_(generalRows, assetRows, managerRows, issueRows) {
  const groupedRows = groupBy_(generalRows, 'assetId');
  const assetMasterIndex = indexBy_(assetRows, 'assetId');
  const assetMasterIndexByCode = indexBy_(assetRows, function (row) { return row.assetCode; });
  const assetMasterIndexByName = indexBy_(assetRows, function (row) { return normalizeAssetLookup_(row.assetName); });
  const managerIndex = indexBy_(managerRows, function (row) { return row.assetCode; });
  const issueIndex = groupBy_((issueRows || []).filter(function (issue) {
    return !issue.resolved && issue.assetId;
  }), 'assetId');
  const summary = {};

  Object.keys(groupedRows).forEach(function (assetId) {
    const rows = groupedRows[assetId];
    const representative = rows[0];
    const assetMaster = assetMasterIndex[assetId] || assetMasterIndexByCode[representative.assetCode] || assetMasterIndexByName[normalizeAssetLookup_(representative.assetName)] || null;
    const grossFloorAreaTimelineBasis = buildAssetGrossFloorAreaTimelineBasis_(assetMaster);
    const areaBase = chooseKnownValue_(
      assetMaster ? assetMaster.grossFloorAreaSqm : null,
      sortBy_(rows, 'totalGrossAreaSqm', 'desc')[0].totalGrossAreaSqm
    );
    const leasedArea = sumKnownRowMetric_(rows, 'leasedAreaSqm');
    const vacancyArea = areaBase != null && leasedArea != null ? Math.max(areaBase - leasedArea, 0) : null;
    const vacancyRate = areaBase != null && areaBase > 0 && vacancyArea != null ? Math.max(0, Math.min(1, vacancyArea / areaBase)) : null;
    const tenantRollups = buildTenantRollupRows_(rows);

    summary[assetId] = {
      assetId: assetId,
      assetCode: representative.assetCode,
      assetName: representative.assetName,
      sector: representative.sector,
      standardizedAddress: assetMaster ? assetMaster.standardizedAddress : (representative.asset && representative.asset.standardizedAddress) || '',
      grossFloorAreaSqm: assetMaster ? assetMaster.grossFloorAreaSqm : representative.totalGrossAreaSqm,
      landAreaSqm: assetMaster ? assetMaster.landAreaSqm : null,
      floorCount: assetMaster ? assetMaster.floorCount : '',
      firstConfiguredAt: assetMaster ? assetMaster.firstConfiguredAt : '',
      approvalDate: assetMaster ? assetMaster.approvalDate : '',
      grossFloorAreaEffectiveAt: grossFloorAreaTimelineBasis.effectiveAt,
      grossFloorAreaEffectiveMonth: grossFloorAreaTimelineBasis.effectiveMonth,
      grossFloorAreaTimelineRule: grossFloorAreaTimelineBasis.rule,
      grossFloorAreaTimelineBasis: grossFloorAreaTimelineBasis,
      areaTableStatus: assetMaster ? assetMaster.areaTableStatus : 'unknown',
      fetchedAt: assetMaster ? assetMaster.fetchedAt : '',
      latitude: assetMaster ? assetMaster.latitude : null,
      longitude: assetMaster ? assetMaster.longitude : null,
      reviewStatus: rows.some(function (row) { return row.calculatedReviewStatus === 'suspected_error'; })
        ? 'suspected_error'
        : rows.some(function (row) { return row.calculatedReviewStatus !== 'ok'; }) ? 'review_required' : 'ok',
      issueCount: (issueIndex[assetId] || []).length,
      issueBacklog: issueIndex[assetId] || [],
      manager: managerIndex[representative.assetCode] || null,
      rowCount: rows.length,
      tenantCount: uniqueValues_(rows.map(function (row) { return row.tenantId; })).length,
      uniqueTenantCount: tenantRollups.length,
      leaseSpaceCount: countUniqueRowValues_(rows, 'leaseSpaceId'),
      leasedAreaSqm: leasedArea,
      vacancyAreaSqm: vacancyArea,
      vacancyRate: vacancyRate,
      monthlyRentTotal: sumKnownRowMetric_(rows, 'currentMonthlyRentTotal'),
      monthlyMfTotal: sumKnownRowMetric_(rows, 'currentMonthlyMfTotal'),
      monthlyCostTotal: sumKnownRowMetric_(rows, 'currentMonthlyCostTotal'),
      averageENoc: computeEffectiveENocFromTotals_(rows),
      missingCounts: buildRowCompletenessSummary_(rows),
      topTenants: tenantRollups.slice(0, 5),
      floors: buildFloorStack_(rows),
      cautionItems: buildAssetCautionItems_(rows, issueIndex[assetId] || []),
    };
  });

  return summary;
}

function buildCompanySummaryByIdV2_(generalRows, companyRows) {
  const groupedRows = groupBy_(generalRows, 'tenantId');
  const companyIndex = indexBy_(companyRows, 'tenantId');
  const summary = {};

  Object.keys(groupedRows).forEach(function (tenantId) {
    const rows = groupedRows[tenantId];
    const representative = rows[0];
    const company = companyIndex[tenantId] || null;
    const sectorCount = countUniqueRowValues_(rows, 'sector');
    const goodsTypeCount = countUniqueRowValues_(rows, 'goodsType');
    const companyReviewNotes = uniqueValues_([
      company && company.reviewNote ? company.reviewNote : '',
      !company || !company.dartCorpCode ? 'OpenDART linkage is missing.' : '',
    ].filter(Boolean));
    const companyLatestExpiry = sortBy_(rows.filter(function (row) {
      return row.currentEndDate;
    }), 'currentEndDate', 'desc')[0];
    const assetRollups = Object.keys(groupBy_(rows, 'assetId')).map(function (assetId) {
      const assetRows = rows.filter(function (row) { return row.assetId === assetId; });
      const latestExpiry = sortBy_(assetRows.filter(function (row) {
        return row.currentEndDate;
      }), 'currentEndDate', 'desc')[0];
      return {
        assetId: assetId,
        assetName: assetRows[0].assetName,
        period: [assetRows[0].currentStartDate, assetRows[0].currentEndDate].filter(Boolean).join(' ~ '),
        floorLabels: uniqueValues_(assetRows.map(function (row) { return row.floorLabel; }).filter(Boolean)),
        detailAreaLabels: uniqueValues_(assetRows.map(function (row) { return row.detailAreaLabel; }).filter(Boolean)),
        leasedAreaSqm: sumKnownRowMetric_(assetRows, 'leasedAreaSqm'),
        leasedAreaPy: sumKnownRowMetric_(assetRows, function (row) {
          return row.leasedAreaSqm != null ? roundNumber_(Number(row.leasedAreaSqm) * 0.3025, 2) : null;
        }),
        monthlyRentTotal: sumKnownRowMetric_(assetRows, 'currentMonthlyRentTotal'),
        monthlyMfTotal: sumKnownRowMetric_(assetRows, 'currentMonthlyMfTotal'),
        monthlyCostTotal: sumKnownRowMetric_(assetRows, 'currentMonthlyCostTotal'),
        latestExpiry: latestExpiry ? latestExpiry.currentEndDate : '',
        reviewStatus: assetRows.some(function (row) { return row.calculatedReviewStatus !== 'ok'; }) ? 'review_required' : 'ok',
      };
    });

    summary[tenantId] = {
      tenantId: tenantId,
      tenantMasterName: representative.tenantMasterName,
      businessRegistrationNo: representative.businessRegistrationNo,
      rowCount: rows.length,
      assetCount: assetRollups.length,
      leaseSpaceCount: countUniqueRowValues_(rows, 'leaseSpaceId'),
      sectorCount: sectorCount,
      goodsTypeCount: goodsTypeCount,
      exposureAvailable: assetRollups.length > 1 || sectorCount > 1 || goodsTypeCount > 1,
      latestExpiry: companyLatestExpiry ? companyLatestExpiry.currentEndDate : '',
      leasedAreaSqm: sumKnownRowMetric_(rows, 'leasedAreaSqm'),
      monthlyRentTotal: sumKnownRowMetric_(rows, 'currentMonthlyRentTotal'),
      monthlyMfTotal: sumKnownRowMetric_(rows, 'currentMonthlyMfTotal'),
      monthlyCostTotal: sumKnownRowMetric_(rows, 'currentMonthlyCostTotal'),
      averageENoc: computeEffectiveENocFromTotals_(rows),
      missingCounts: buildRowCompletenessSummary_(rows),
      company: company,
      leasedAssets: sortBy_(assetRollups, 'monthlyCostTotal', 'desc'),
      selectorSortMeta: {
        tenantMasterName: representative.tenantMasterName,
        monthlyCostTotal: sumKnownRowMetric_(rows, 'currentMonthlyCostTotal'),
        assetCount: assetRollups.length,
        latestRevenue: company ? company.latestRevenue : null,
        latestExpiry: companyLatestExpiry ? companyLatestExpiry.currentEndDate : '',
        hasFinancialData: !!(company && (
          company.latestRevenue != null ||
          company.latestOperatingIncome != null ||
          company.latestDebtRatio != null ||
          company.latestEmployeeCount != null
        )),
        exposureAvailable: assetRollups.length > 1 || sectorCount > 1 || goodsTypeCount > 1,
      },
      reviewStatus: rows.some(function (row) { return row.calculatedReviewStatus === 'suspected_error'; })
        ? 'suspected_error'
        : rows.some(function (row) { return row.calculatedReviewStatus !== 'ok'; }) ? 'review_required'
          : company && company.reviewStatus && company.reviewStatus !== 'ok' ? company.reviewStatus
            : company && company.dartCorpCode ? 'ok' : 'review_required',
      reviewNotes: companyReviewNotes,
    };
  });

  return summary;
}

function loadOperationalModel_(options) {
  const normalizedOptions = options || {};
  const now = Date.now();
  if (!normalizedOptions.forceRefresh && MODEL_RUNTIME_CACHE && (now - MODEL_RUNTIME_CACHE_AT) < 5000) {
    return MODEL_RUNTIME_CACHE;
  }

  const cachedModel = !normalizedOptions.forceRefresh ? getCachedJson_('model:full') : null;
  if (cachedModel) {
    MODEL_RUNTIME_CACHE = cachedModel;
    MODEL_RUNTIME_CACHE_AT = now;
    return cachedModel;
  }

  const spreadsheet = getSpreadsheet_();
  const config = getConfig_();
  const runtimeMeta = resolveModelRuntimeMeta_(normalizedOptions);

  const rawCompanies = loadObjectsFromSheet_(spreadsheet, config.sheetNames.company);
  const rawAssets = loadObjectsFromSheet_(spreadsheet, config.sheetNames.asset);
  const rawManagers = loadObjectsFromSheet_(spreadsheet, config.sheetNames.manager);
  const rawIssues = loadObjectsFromSheet_(spreadsheet, config.sheetNames.issue);
  const rawTenantNormalization = loadObjectsFromSheet_(spreadsheet, config.sheetNames.sysTenantNormalize);
  const rawAssetLookup = loadObjectsFromSheet_(spreadsheet, config.sheetNames.sysAssetLookup);
  const rawGeneral = loadObjectsFromSheet_(spreadsheet, config.sheetNames.general);
  const rawHistory = loadObjectsFromSheet_(spreadsheet, config.sheetNames.history);

  const tenantNormalizationMap = buildTenantNormalizationMap_(rawCompanies, rawTenantNormalization);
  const assetLookupMap = buildAssetLookupMapV2_(rawAssets, rawAssetLookup);

  const companyRows = rawCompanies
    .map(normalizeCompanyRow_)
    .filter(function (row) {
      return row && row.tenantMasterName;
    });

  const assetRows = rawAssets
    .map(function (row) {
      return normalizeAssetRowV2_(row, assetLookupMap);
    })
    .filter(function (row) {
      return row && row.assetName;
    });

  const managerRows = rawManagers
    .map(normalizeManagerRow_)
    .filter(function (row) {
      return row && row.assetCode;
    });

  const issueRows = rawIssues
    .map(normalizeIssueRow_)
    .filter(function (row) {
      return row && row.issueId;
    });

  const generalRows = rawGeneral
    .map(function (row) {
      return normalizeGeneralRow_(row, tenantNormalizationMap, config);
    })
    .filter(function (row) {
      return row && row.assetName;
    });

  const historyRows = rawHistory
    .map(function (row) {
      return normalizeHistoryRow_(row, tenantNormalizationMap);
    })
    .filter(function (row) {
      return row && row.assetName;
    });

  linkHistoryRowsV2_(generalRows, historyRows);
  attachCompanyAndAssetContext_(generalRows, companyRows, assetRows, managerRows);
  attachIssueContext_(generalRows, assetRows, issueRows);

  const assetSummaryById = buildAssetSummaryByIdV2_(generalRows, assetRows, managerRows, issueRows);
  const companySummaryById = buildCompanySummaryByIdV2_(generalRows, companyRows);
  const reviewSummary = buildReviewSummary_(generalRows, historyRows, issueRows);
  const historyMonths = uniqueValues_(
    historyRows
      .map(function (row) { return row.baseMonth; })
      .filter(Boolean)
  ).sort();
  const assetSummaryList = Object.keys(assetSummaryById).map(function (assetId) { return assetSummaryById[assetId]; });
  const companySummaryList = Object.keys(companySummaryById).map(function (tenantId) { return companySummaryById[tenantId]; });
  const defaultAsset = sortBy_(assetSummaryList.filter(function (row) {
    return row.averageENoc != null && row.monthlyCostTotal != null && row.grossFloorAreaSqm != null;
  }), 'monthlyCostTotal', 'desc')[0]
    || sortBy_(assetSummaryList.filter(function (row) {
      return row.monthlyRentTotal != null;
    }), 'monthlyRentTotal', 'desc')[0]
    || sortBy_(assetSummaryList, 'assetName')[0]
    || null;
  const defaultCompany = sortBy_(companySummaryList.filter(function (row) {
    return row.company && (
      row.company.latestRevenue != null ||
      row.company.latestOperatingIncome != null ||
      row.company.latestDebtRatio != null ||
      row.company.latestEmployeeCount != null
    );
  }), 'monthlyCostTotal', 'desc')[0]
    || sortBy_(companySummaryList.filter(function (row) {
      return row.monthlyRentTotal != null;
    }), 'monthlyRentTotal', 'desc')[0]
    || sortBy_(companySummaryList, 'tenantMasterName')[0]
    || null;

  MODEL_RUNTIME_CACHE = {
    generatedAt: runtimeMeta.lastRefreshCalculationAt || runtimeMeta.lastDerivedRefreshAt || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
    config: {
      formulaVersion: config.formulaVersion,
      spreadsheetId: config.spreadsheetId,
    },
    runtimeMeta: runtimeMeta,
    generalRows: generalRows,
    historyRows: historyRows,
    companyRows: companyRows,
    assetRows: assetRows,
    managerRows: managerRows,
    issueRows: issueRows,
    assetSummaryById: assetSummaryById,
    companySummaryById: companySummaryById,
    reviewSummary: reviewSummary,
    historyMonths: historyMonths,
    defaultAssetId: defaultAsset ? defaultAsset.assetId : '',
    defaultTenantId: defaultCompany ? defaultCompany.tenantId : '',
  };
  MODEL_RUNTIME_CACHE_AT = now;
  putCachedJson_('model:full', MODEL_RUNTIME_CACHE, config.modelCacheTtlSeconds);
  return MODEL_RUNTIME_CACHE;
}

function buildTenantNormalizationMap_(companyRows, normalizationRows) {
  const map = {};

  normalizationRows.forEach(function (row) {
    const lookupKey = normalizeWhitespace_(pickField_(row, ['lookup_key', 'business_registration_no', 'raw_name']));
    const tenantMasterName = normalizeWhitespace_(pickField_(row, ['tenant_master_name', '표준기업명']));
    if (!lookupKey || !tenantMasterName) {
      return;
    }
    map[lookupKey] = tenantMasterName;
    map[normalizeKoreanLookup_(lookupKey)] = tenantMasterName;
  });

  companyRows.forEach(function (row) {
    const businessRegistrationNo = normalizeWhitespace_(pickField_(row, ['business_registration_no', '사업자등록번호']));
    const tenantMasterName = normalizeWhitespace_(pickField_(row, ['tenant_master_name', '표준기업명']));
    if (!tenantMasterName) {
      return;
    }
    if (businessRegistrationNo) {
      map[businessRegistrationNo.replace(/[^0-9]/g, '')] = tenantMasterName;
    }
    map[normalizeKoreanLookup_(tenantMasterName)] = tenantMasterName;
  });

  return map;
}

function buildAssetLookupMap_(assetRows, lookupRows) {
  const map = {};

  assetRows.forEach(function (row) {
    const assetCode = normalizeWhitespace_(pickField_(row, ['asset_code', '자산코드']));
    const assetName = normalizeWhitespace_(pickField_(row, ['asset_name', '자산명']));
    const address = normalizeWhitespace_(pickField_(row, ['standardized_address', '도로명주소']));
    const payload = {
      lookupAddress: address,
      queryKey: normalizeWhitespace_(pickField_(row, ['query_key'])),
      sigunguCd: normalizeWhitespace_(pickField_(row, ['sigunguCd'])),
      bjdongCd: normalizeWhitespace_(pickField_(row, ['bjdongCd'])),
      platGbCd: normalizeWhitespace_(pickField_(row, ['platGbCd'])),
      bun: normalizeWhitespace_(pickField_(row, ['bun'])),
      ji: normalizeWhitespace_(pickField_(row, ['ji'])),
      latitude: toNumber_(pickField_(row, ['latitude'])),
      longitude: toNumber_(pickField_(row, ['longitude'])),
    };
    if (assetCode) {
      map[assetCode] = payload;
    }
    if (assetName) {
      map[normalizeAssetLookup_(assetName)] = payload;
    }
  });

  lookupRows.forEach(function (row) {
    const assetCode = normalizeWhitespace_(pickField_(row, ['asset_code']));
    const assetName = normalizeWhitespace_(pickField_(row, ['asset_name']));
    const structured = resolveStructuredBuildingFields_(row);
    const payload = {
      lookupAddress: normalizeWhitespace_(pickField_(row, ['lookup_address', 'query_key'])),
      queryKey: normalizeWhitespace_(pickField_(row, ['query_key'])),
      sigunguCd: structured.sigunguCd,
      bjdongCd: structured.bjdongCd,
      platGbCd: structured.platGbCd,
      bun: structured.bun,
      ji: structured.ji,
      latitude: toNumber_(pickField_(row, ['latitude'])),
      longitude: toNumber_(pickField_(row, ['longitude'])),
    };
    if (assetCode) {
      map[assetCode] = payload;
    }
    if (assetName) {
      map[normalizeAssetLookup_(assetName)] = payload;
    }
  });

  return map;
}

function normalizeCompanyRow_(row) {
  const businessRegistrationNo = normalizeWhitespace_(pickField_(row, ['business_registration_no', '사업자등록번호']));
  const tenantMasterName = normalizeWhitespace_(pickField_(row, ['tenant_master_name', '표준기업명']));
  const tenantId = normalizeWhitespace_(pickField_(row, ['tenant_id'])) || (
    businessRegistrationNo
      ? `tenant_brn_${businessRegistrationNo.replace(/[^0-9]/g, '')}`
      : makeDeterministicId_('tenant_name', [tenantMasterName])
  );

  return {
    tenantId: tenantId,
    tenantMasterName: tenantMasterName,
    businessRegistrationNo: businessRegistrationNo,
    corpRegistrationNo: normalizeWhitespace_(pickField_(row, ['corp_registration_no', '법인등록번호'])),
    dartCorpCode: normalizeWhitespace_(pickField_(row, ['dart_corp_code', 'DART_corp_code'])),
    matchStatus: normalizeWhitespace_(pickField_(row, ['match_status', 'DART 매칭 상태'])) || 'unmatched',
    industryCode: normalizeWhitespace_(pickField_(row, ['industry_code', '업종'])),
    headquartersAddress: normalizeWhitespace_(pickField_(row, ['headquarters_address', '본점소재지'])),
    listedYn: normalizeWhitespace_(pickField_(row, ['listed_yn', '상장여부'])),
    groupName: normalizeWhitespace_(pickField_(row, ['group_name', '그룹명'])),
    latestFinancialYear: normalizeWhitespace_(pickField_(row, ['latest_financial_year', '최근 재무제표 연도'])),
    financialStatementType: normalizeWhitespace_(pickField_(row, ['financial_statement_type', '연결_별도_여부'])),
    latestReportName: normalizeWhitespace_(pickField_(row, ['latest_report_name', '사용한 보고서 종류'])),
    latestReceiptNo: normalizeWhitespace_(pickField_(row, ['latest_receipt_no', '접수번호'])),
    latestRevenue: toNumber_(pickField_(row, ['latest_revenue', '최근 매출액'])),
    latestOperatingIncome: toNumber_(pickField_(row, ['latest_operating_income', '최근 영업이익', '최근 영업이익 '])),
    latestDebtRatio: toPercentNumber_(pickField_(row, ['latest_debt_ratio', '최근 부채비율'])),
    latestEmployeeCount: toNumber_(pickField_(row, ['latest_employee_count', '최근 종업원수'])),
    fetchedAt: normalizeWhitespace_(pickField_(row, ['fetched_at'])),
    reviewStatus: normalizeWhitespace_(pickField_(row, ['review_status'])) || (normalizeWhitespace_(pickField_(row, ['DART 매칭 상태'])) ? 'review_required' : 'ok'),
    reviewNote: normalizeWhitespace_(pickField_(row, ['review_note'])),
    hasFinancialData: false,
  };
}

function normalizeAssetRow_(row, assetLookupMap) {
  const assetCode = normalizeWhitespace_(pickField_(row, ['자산코드', 'asset_code']));
  const assetName = normalizeWhitespace_(pickField_(row, ['자산명', 'asset_name']));
  const assetId = normalizeWhitespace_(pickField_(row, ['asset_id'])) || (assetCode ? `asset_${sanitizeIdPart_(assetCode)}` : makeDeterministicId_('asset', [assetName]));
  const lookupPayload = assetLookupMap[assetCode] || assetLookupMap[normalizeAssetLookup_(assetName)] || {};

  return {
    assetId: assetId,
    assetCode: assetCode,
    assetName: assetName,
    standardizedAddress: normalizeWhitespace_(pickField_(row, ['standardized_address', '도로명주소'])) || lookupPayload.lookupAddress || '',
    sigunguCd: normalizeWhitespace_(pickField_(row, ['sigunguCd'])) || lookupPayload.sigunguCd || '',
    bjdongCd: normalizeWhitespace_(pickField_(row, ['bjdongCd'])) || lookupPayload.bjdongCd || '',
    platGbCd: normalizeWhitespace_(pickField_(row, ['platGbCd'])) || lookupPayload.platGbCd || '',
    bun: normalizeWhitespace_(pickField_(row, ['bun'])) || lookupPayload.bun || '',
    ji: normalizeWhitespace_(pickField_(row, ['ji'])) || lookupPayload.ji || '',
    buildingName: normalizeWhitespace_(pickField_(row, ['building_name', '건물명'])),
    approvalDate: toIsoDate_(pickField_(row, ['approval_date', '사용승인일'])),
    grossFloorAreaSqm: toNumber_(pickField_(row, ['gross_floor_area', '연면적'])),
    landAreaSqm: toNumber_(pickField_(row, ['land_area', '대지면적'])),
    floorCount: normalizeWhitespace_(pickField_(row, ['floor_count', '층수'])),
    areaTableStatus: normalizeWhitespace_(pickField_(row, ['area_table_status', '세부면적표 반영여부'])) || 'unknown',
    fetchedAt: normalizeWhitespace_(pickField_(row, ['fetched_at'])),
    reviewStatus: normalizeWhitespace_(pickField_(row, ['review_status'])) || (!assetCode || !assetName || !pickField_(row, ['도로명주소', 'standardized_address']) ? 'missing' : 'ok'),
    reviewNote: normalizeWhitespace_(pickField_(row, ['review_note'])),
    latitude: lookupPayload.latitude || toNumber_(pickField_(row, ['latitude'])),
    longitude: lookupPayload.longitude || toNumber_(pickField_(row, ['longitude'])),
  };
}

function normalizeManagerRow_(row) {
  return {
    assetCode: normalizeWhitespace_(pickField_(row, ['자산코드'])),
    assetName: normalizeWhitespace_(pickField_(row, ['자산명'])),
    fundCode: normalizeWhitespace_(pickField_(row, ['펀드코드'])),
    fundName: normalizeWhitespace_(pickField_(row, ['펀드명'])),
    managerName: normalizeWhitespace_(pickField_(row, ['담당자'])),
    teamName: normalizeWhitespace_(pickField_(row, ['소속'])),
    email: normalizeWhitespace_(pickField_(row, ['이메일 주소'])),
  };
}

function normalizeIssueRow_(row) {
  const rawId = normalizeWhitespace_(pickField_(row, ['순번']));
  if (!rawId) {
    return null;
  }
  return {
    issueId: `issue_${sanitizeIdPart_(rawId)}`,
    rawId: rawId,
    category: normalizeWhitespace_(pickField_(row, ['구분'])),
    recordedAt: toIsoDate_(pickField_(row, ['기록 일자'])),
    resolved: String(pickField_(row, ['이슈 해결 여부'])).toUpperCase() === 'TRUE',
    relatedAssetLabel: normalizeWhitespace_(pickField_(row, ['관련 자산'])),
    relatedSheet: normalizeWhitespace_(pickField_(row, ['관련 시트'])),
    content: normalizeWhitespace_(pickField_(row, ['내용'])),
    priority: normalizeWhitespace_(pickField_(row, ['우선순위'])) || '미정',
    owner: normalizeWhitespace_(pickField_(row, ['처리주체'])),
    certainty: normalizeWhitespace_(pickField_(row, ['확정/가정 구분'])),
    managerQuestion: normalizeWhitespace_(pickField_(row, ['담당자 확인 질문'])),
    conclusion: normalizeWhitespace_(pickField_(row, ['최종 결론'])),
    needsDevelopment: normalizeWhitespace_(pickField_(row, ['개발반영 필요 여부'])),
  };
}

function normalizeGeneralRow_(row, tenantNormalizationMap, config) {
  const fundCode = normalizeWhitespace_(pickField_(row, ['펀드코드']));
  const fundName = normalizeWhitespace_(pickField_(row, ['펀드명']));
  const assetName = normalizeWhitespace_(pickField_(row, ['자산명']));
  const assetCode = normalizeWhitespace_(pickField_(row, ['자산코드']));
  const rawTenantName = normalizeWhitespace_(pickField_(row, ['임차인명']));
  const businessRegistrationNo = normalizeWhitespace_(pickField_(row, ['임차인 사업자번호']));
  const tenantLookupKey = businessRegistrationNo ? businessRegistrationNo.replace(/[^0-9]/g, '') : normalizeKoreanLookup_(rawTenantName);
  const tenantMasterName = normalizeWhitespace_(pickField_(row, ['tenant_master_name'])) || tenantNormalizationMap[tenantLookupKey] || rawTenantName;
  const fundId = normalizeWhitespace_(pickField_(row, ['fund_id'])) || `fund_${sanitizeIdPart_(fundCode || fundName)}`;
  const assetId = normalizeWhitespace_(pickField_(row, ['asset_id'])) || (assetCode ? `asset_${sanitizeIdPart_(assetCode)}` : makeDeterministicId_('asset', [assetName]));
  const tenantId = normalizeWhitespace_(pickField_(row, ['tenant_id'])) || (
    businessRegistrationNo
      ? `tenant_brn_${businessRegistrationNo.replace(/[^0-9]/g, '')}`
      : makeDeterministicId_('tenant_name', [tenantMasterName])
  );
  const currentStartDate = toIsoDate_(pickField_(row, ['현재 계약개시일']));
  const currentEndDate = toIsoDate_(pickField_(row, ['현재 계약만기일']));
  const leaseId = normalizeWhitespace_(pickField_(row, ['lease_id'])) || [assetId, tenantId, currentStartDate || 'nostart', currentEndDate || 'noend'].join('|');
  const leaseSpaceId = normalizeWhitespace_(pickField_(row, ['lease_space_id'])) || [
    leaseId,
    sanitizeIdPart_(pickField_(row, ['임차 층'])),
    sanitizeIdPart_(pickField_(row, ['임차 세부 구역']) || 'na'),
  ].join('|');
  const sourceRowHash = normalizeWhitespace_(pickField_(row, ['source_row_hash'])) || hashText_([
    fundCode,
    fundName,
    assetCode,
    assetName,
    rawTenantName,
    businessRegistrationNo,
    pickField_(row, ['임차 층']),
    pickField_(row, ['임차 세부 구역']),
    currentStartDate,
    currentEndDate,
    pickField_(row, ['임대면적']),
    pickField_(row, ['전용면적']),
  ].join('|'));

  const normalized = {
    rowNumber: row._rowNumber,
    fundId: fundId,
    fundCode: fundCode,
    fundName: fundName,
    assetId: assetId,
    assetCode: assetCode,
    assetName: assetName,
    sector: normalizeWhitespace_(pickField_(row, ['섹터'])),
    rawTenantName: rawTenantName,
    tenantId: tenantId,
    tenantMasterName: tenantMasterName,
    businessRegistrationNo: businessRegistrationNo,
    coldStorageType: normalizeWhitespace_(pickField_(row, ['저온창고 여부', '저온 창고 여부'])),
    isPreLeased: toBooleanFlag_(pickField_(row, ['선임차 여부'])),
    is3pl: toBooleanFlag_(pickField_(row, ['3PL 여부'])),
    goodsType: normalizeWhitespace_(pickField_(row, ['취급 상품 유형'])),
    floorLabel: normalizeWhitespace_(pickField_(row, ['임차 층'])),
    detailAreaLabel: normalizeWhitespace_(pickField_(row, ['임차 세부 구역'])),
    isSingleTenant: toBooleanFlag_(pickField_(row, ['단일 임차인 여부'])),
    totalGrossAreaSqm: toNumber_(pickField_(row, ['전체 연면적'])),
    leasedAreaSqm: toNumber_(pickField_(row, ['임대면적'])),
    exclusiveAreaSqm: toNumber_(pickField_(row, ['전용면적'])),
    exclusiveRatio: toPercentNumber_(pickField_(row, ['전용률'])) || safeDivide_(toNumber_(pickField_(row, ['전용면적'])), toNumber_(pickField_(row, ['임대면적']))),
    warehouseAreaSqm: toNumber_(pickField_(row, ['세부면적(창고)'])),
    dockAreaSqm: toNumber_(pickField_(row, ['세부면적(하역장)'])),
    officeAreaSqm: toNumber_(pickField_(row, ['세부면적(사무실)'])),
    otherExclusiveAreaSqm: toNumber_(pickField_(row, ['세부면적(기타 전용면적)'])),
    corridorAreaSqm: toNumber_(pickField_(row, ['세부면적(통로)'])),
    rampAreaSqm: toNumber_(pickField_(row, ['세부면적(램프)'])),
    mechanicalAreaSqm: toNumber_(pickField_(row, ['세부면적(기계전기실)'])),
    machineAreaSqm: toNumber_(pickField_(row, ['세부면적(기계전기실)'])),
    parkingAreaSqm: toNumber_(pickField_(row, ['세부면적(주차장)'])),
    coreAreaSqm: toNumber_(pickField_(row, ['세부면적(층별 코어)'])),
    otherCommonAreaSqm: toNumber_(pickField_(row, ['세부면적(기타 공용면적)'])),
    firstContractDate: toIsoDate_(pickField_(row, ['최초 계약일'])),
    firstStartDate: toIsoDate_(pickField_(row, ['최초 계약개시일'])),
    firstEndDate: toIsoDate_(pickField_(row, ['최초 계약만기일'])),
    firstOperationDate: toIsoDate_(pickField_(row, ['최초 운영개시일'])),
    recentContractDate: toIsoDate_(pickField_(row, ['최근 계약일'])),
    currentStartDate: currentStartDate,
    currentEndDate: currentEndDate,
    currentPeriodYears: toNumber_(pickField_(row, ['현재 계약기간'])),
    extensionCount: toNumber_(pickField_(row, ['연장횟수'])),
    depositAmount: toNumber_(pickField_(row, ['임대보증금'])),
    rfMonths: toNumber_(pickField_(row, ['RF'])),
    foMonths: toNumber_(pickField_(row, ['FO'])),
    tiAmount: toNumber_(pickField_(row, ['TI'])),
    contractStatusRaw: normalizeWhitespace_(pickField_(row, ['계약 상태'])),
    isContractActive: toBooleanFlag_(pickField_(row, ['계약 상태'])),
    isDelinquent: toBooleanFlag_(pickField_(row, ['임대료 연체·미납여부'])),
    insuranceSpecialClause: normalizeWhitespace_(pickField_(row, ['보험 관련 특수 계약 조건'])),
    otherSpecialClause: normalizeWhitespace_(pickField_(row, ['기타 각종 특수 계약 조건'])),
    sourceRowHash: sourceRowHash,
    sourceDocRef: normalizeWhitespace_(pickField_(row, ['source_doc_ref'])),
    reviewStatus: normalizeWhitespace_(pickField_(row, ['review_status'])),
    reviewNote: normalizeWhitespace_(pickField_(row, ['review_note'])),
    leaseId: leaseId,
    leaseSpaceId: leaseSpaceId,
    currentMonthlyRentTotal: null,
    currentMonthlyMfTotal: null,
    currentMonthlyCostTotal: null,
    currentRentPerPy: null,
    currentMfPerPy: null,
    historyLinked: false,
    historyLinkStatus: 'review_required',
    historyCandidateCount: 0,
    historyLatestDate: '',
    currentMoneyStatus: 'history_unmatched',
    currentMoneyBasis: 'unresolved',
    currentMoneyAsOf: '',
    eNoc: null,
    calculationStatus: 'review_required',
    calculatedReviewStatus: 'ok',
    calculatedReviewNotes: [],
  };

  normalized.exclusiveRatioRaw = normalized.exclusiveRatio;
  normalized.exclusiveRatio = normalizeExclusiveRatio_(
    normalized.exclusiveRatio,
    normalized.exclusiveAreaSqm,
    normalized.leasedAreaSqm
  );

  if (!normalized.currentPeriodYears && normalized.currentStartDate && normalized.currentEndDate) {
    normalized.currentPeriodYears = deriveContractYears_(normalized.currentStartDate, normalized.currentEndDate);
  }
  applyGeneralReviewStatus_(normalized, config);
  return normalized;
}

function normalizeHistoryRow_(row, tenantNormalizationMap) {
  const assetCode = normalizeWhitespace_(pickField_(row, ['자산코드']));
  const assetName = normalizeWhitespace_(pickField_(row, ['자산명']));
  const rawTenantName = normalizeWhitespace_(pickField_(row, ['임차인명']));
  const businessRegistrationNo = normalizeWhitespace_(pickField_(row, ['임차인 사업자번호']));
  const tenantLookupKey = businessRegistrationNo ? businessRegistrationNo.replace(/[^0-9]/g, '') : normalizeKoreanLookup_(rawTenantName);
  const tenantMasterName = tenantNormalizationMap[tenantLookupKey] || rawTenantName;
  const baseDate = toIsoDate_(pickField_(row, ['기준일자']));

  return {
    rowNumber: row._rowNumber,
    fundCode: normalizeWhitespace_(pickField_(row, ['펀드코드'])),
    fundName: normalizeWhitespace_(pickField_(row, ['펀드명'])),
    assetCode: assetCode,
    assetName: assetName,
    sector: normalizeWhitespace_(pickField_(row, ['섹터'])),
    rawTenantName: rawTenantName,
    tenantMasterName: tenantMasterName,
    businessRegistrationNo: businessRegistrationNo,
    coldStorageType: normalizeWhitespace_(pickField_(row, ['저온창고 여부'])),
    floorLabel: normalizeWhitespace_(pickField_(row, ['임차 층'])),
    detailAreaLabel: normalizeWhitespace_(pickField_(row, ['임차 세부 구역'])),
    leasedAreaSqm: toNumber_(pickField_(row, ['임대면적'])),
    exclusiveAreaSqm: toNumber_(pickField_(row, ['전용면적'])),
    baseDate: baseDate,
    baseMonth: monthKeyFromIso_(baseDate),
    reason: normalizeWhitespace_(pickField_(row, ['임대료 변동 원인'])),
    monthlyRentTotal: toNumber_(pickField_(row, ['월임대료 총액'])),
    monthlyMfTotal: toNumber_(pickField_(row, ['월관리비 총액'])),
    rentPerPy: toNumber_(pickField_(row, ['평당 월임대료'])),
    mfPerPy: toNumber_(pickField_(row, ['평당 월관리비'])),
    linkedLeaseSpaceId: normalizeWhitespace_(pickField_(row, ['lease_space_id'])),
    historyEventId: normalizeWhitespace_(pickField_(row, ['history_event_id'])),
    isLatest: pickField_(row, ['is_latest']) === 'TRUE',
    reviewStatus: normalizeWhitespace_(pickField_(row, ['review_status'])),
    reviewNote: normalizeWhitespace_(pickField_(row, ['review_note'])),
    matchConfidence: 'unmatched',
  };
}

function businessRegistrationMissing_(row) {
  return !row.businessRegistrationNo;
}

function applyGeneralReviewStatus_(row, config) {
  const notes = [];
  let status = row.reviewStatus || 'ok';

  const coreMissing = [
    !row.assetCode && !row.assetName,
    !row.rawTenantName,
    row.leasedAreaSqm == null,
    row.exclusiveAreaSqm == null,
    !row.currentStartDate,
    !row.currentEndDate,
  ].some(Boolean);

  if (coreMissing) {
    status = 'missing';
    if (!row.assetCode && !row.assetName) notes.push('자산 식별값 누락');
    if (!row.rawTenantName) notes.push('임차인명 누락');
    if (row.leasedAreaSqm == null) notes.push('임대면적 누락');
    if (row.exclusiveAreaSqm == null) notes.push('전용면적 누락');
    if (!row.currentStartDate) notes.push('현재 계약개시일 누락');
    if (!row.currentEndDate) notes.push('현재 계약만기일 누락');
  }

  const currentMonths = row.currentPeriodYears == null ? null : row.currentPeriodYears * 12;
  const exclusiveRatio = row.exclusiveRatio;
  const exclusiveAreaSum =
    (row.warehouseAreaSqm || 0) +
    (row.dockAreaSqm || 0) +
    (row.officeAreaSqm || 0) +
    (row.otherExclusiveAreaSqm || 0);

  const isSuspected = [
    row.currentStartDate && row.currentEndDate && row.currentEndDate < row.currentStartDate,
    row.recentContractDate && row.currentStartDate && row.currentStartDate < row.recentContractDate,
    row.firstContractDate && row.firstStartDate && row.firstStartDate < row.firstContractDate,
    row.firstStartDate && row.firstOperationDate && row.firstOperationDate < row.firstStartDate,
    row.leasedAreaSqm != null && row.leasedAreaSqm <= 0,
    row.exclusiveAreaSqm != null && row.exclusiveAreaSqm < 0,
    row.totalGrossAreaSqm != null && row.leasedAreaSqm != null && row.leasedAreaSqm > row.totalGrossAreaSqm * 1.05,
    exclusiveRatio != null && (exclusiveRatio < 0 || exclusiveRatio > 1.05),
    currentMonths != null && row.rfMonths != null && row.foMonths != null && (row.rfMonths + row.foMonths > currentMonths + 0.1),
  ].some(Boolean);

  if (isSuspected && status !== 'missing') {
    status = 'suspected_error';
    if (row.currentStartDate && row.currentEndDate && row.currentEndDate < row.currentStartDate) notes.push('현재 계약만기일이 계약개시일보다 빠름');
    if (row.recentContractDate && row.currentStartDate && row.currentStartDate < row.recentContractDate) notes.push('현재 계약개시일이 최근 계약일보다 빠름');
    if (row.firstContractDate && row.firstStartDate && row.firstStartDate < row.firstContractDate) notes.push('최초 계약개시일이 최초 계약일보다 빠름');
    if (row.firstStartDate && row.firstOperationDate && row.firstOperationDate < row.firstStartDate) notes.push('최초 운영개시일이 계약개시일보다 빠름');
    if (row.leasedAreaSqm != null && row.leasedAreaSqm <= 0) notes.push('임대면적 0 이하');
    if (row.exclusiveAreaSqm != null && row.exclusiveAreaSqm < 0) notes.push('전용면적 음수');
    if (row.totalGrossAreaSqm != null && row.leasedAreaSqm != null && row.leasedAreaSqm > row.totalGrossAreaSqm * 1.05) notes.push('임대면적이 전체 연면적을 초과');
    if (exclusiveRatio != null && (exclusiveRatio < 0 || exclusiveRatio > 1.05)) notes.push('전용률 비정상');
    if (currentMonths != null && row.rfMonths != null && row.foMonths != null && (row.rfMonths + row.foMonths > currentMonths + 0.1)) notes.push('RF+FO가 계약기간을 초과');
  }

  const needsReview = [
    businessRegistrationMissing_(row),
    row.exclusiveAreaSqm != null && exclusiveAreaSum > 0 && Math.abs(exclusiveAreaSum - row.exclusiveAreaSqm) > 1,
    row.leasedAreaSqm != null && row.exclusiveAreaSqm != null && row.exclusiveRatio != null && Math.abs((row.exclusiveAreaSqm / row.leasedAreaSqm) - row.exclusiveRatio) > 0.02,
  ].some(Boolean);

  if (needsReview && status === 'ok') {
    status = 'review_required';
    if (businessRegistrationMissing_(row)) notes.push('임차인 사업자번호 누락');
    if (row.exclusiveAreaSqm != null && exclusiveAreaSum > 0 && Math.abs(exclusiveAreaSum - row.exclusiveAreaSqm) > 1) notes.push('전용면적과 세부 전용면적 합계 불일치');
    if (row.leasedAreaSqm != null && row.exclusiveAreaSqm != null && row.exclusiveRatio != null && Math.abs((row.exclusiveAreaSqm / row.leasedAreaSqm) - row.exclusiveRatio) > 0.02) notes.push('전용률 계산 불일치');
  }

  row.calculatedReviewStatus = status;
  row.calculatedReviewNotes = uniqueValues_(notes);
}

function linkHistoryRows_(generalRows, historyRows) {
  const directIdIndex = {};
  const exactIndex = {};
  const relaxedIndex = {};
  const tenantOnlyIndex = {};

  generalRows.forEach(function (row) {
    if (row.leaseSpaceId) {
      directIdIndex[row.leaseSpaceId] = directIdIndex[row.leaseSpaceId] || [];
      directIdIndex[row.leaseSpaceId].push(row);
    }
    const tenantKey = row.businessRegistrationNo ? row.businessRegistrationNo.replace(/[^0-9]/g, '') : normalizeKoreanLookup_(row.tenantMasterName);
    const exactKey = [
      row.assetCode,
      tenantKey,
      row.floorLabel,
      row.detailAreaLabel,
      row.leasedAreaSqm != null ? Math.round(row.leasedAreaSqm) : '',
    ].join('|');
    const relaxedKey = [
      row.assetCode,
      tenantKey,
      row.floorLabel,
      row.leasedAreaSqm != null ? Math.round(row.leasedAreaSqm) : '',
    ].join('|');
    const tenantOnlyKey = [row.assetCode, tenantKey].join('|');
    exactIndex[exactKey] = exactIndex[exactKey] || [];
    exactIndex[exactKey].push(row);
    relaxedIndex[relaxedKey] = relaxedIndex[relaxedKey] || [];
    relaxedIndex[relaxedKey].push(row);
    tenantOnlyIndex[tenantOnlyKey] = tenantOnlyIndex[tenantOnlyKey] || [];
    tenantOnlyIndex[tenantOnlyKey].push(row);
  });

  historyRows.forEach(function (row) {
    const directCandidates = row.linkedLeaseSpaceId ? (directIdIndex[row.linkedLeaseSpaceId] || []) : [];
    const tenantKey = row.businessRegistrationNo ? row.businessRegistrationNo.replace(/[^0-9]/g, '') : normalizeKoreanLookup_(row.tenantMasterName);
    const exactKey = [
      row.assetCode,
      tenantKey,
      row.floorLabel,
      row.detailAreaLabel,
      row.leasedAreaSqm != null ? Math.round(row.leasedAreaSqm) : '',
    ].join('|');
    const relaxedKey = [
      row.assetCode,
      tenantKey,
      row.floorLabel,
      row.leasedAreaSqm != null ? Math.round(row.leasedAreaSqm) : '',
    ].join('|');
    const tenantOnlyKey = [row.assetCode, tenantKey].join('|');

    const exactCandidates = exactIndex[exactKey] || [];
    const relaxedCandidates = relaxedIndex[relaxedKey] || [];
    const tenantOnlyCandidates = tenantOnlyIndex[tenantOnlyKey] || [];
    const candidates = directCandidates.length
      ? directCandidates
      : exactCandidates.length
        ? exactCandidates
        : relaxedCandidates.length
          ? relaxedCandidates
          : tenantOnlyCandidates;
    let matchedRow = null;

    if (candidates.length === 1) {
      matchedRow = candidates[0];
      row.matchConfidence = directCandidates.length ? 'lease_space_id' : exactCandidates.length ? 'exact' : relaxedCandidates.length ? 'fallback' : 'fallback_loose';
    } else if (candidates.length > 1) {
      matchedRow = sortBy_(candidates, function (candidate) {
        const areaDelta = Math.abs((candidate.leasedAreaSqm || 0) - (row.leasedAreaSqm || 0));
        const floorPenalty = candidate.floorLabel === row.floorLabel ? 0 : 5;
        const detailPenalty = candidate.detailAreaLabel === row.detailAreaLabel ? 0 : 2;
        return areaDelta + floorPenalty + detailPenalty;
      })[0];
      row.matchConfidence = directCandidates.length ? 'ambiguous_lease_space_id' : exactCandidates.length ? 'ambiguous' : relaxedCandidates.length ? 'ambiguous_fallback' : 'ambiguous_loose';
    }

    if (matchedRow) {
      row.linkedLeaseSpaceId = matchedRow.leaseSpaceId;
      row.historyEventId = `${matchedRow.leaseSpaceId}|${row.baseDate || 'nodate'}|${row.rowNumber}`;
      matchedRow.historyCandidates = matchedRow.historyCandidates || [];
      matchedRow.historyCandidates.push(row);
    } else {
      row.reviewStatus = row.reviewStatus || 'review_required';
      row.reviewNote = row.reviewNote || 'DB_일반 매칭 실패';
    }
  });

  generalRows.forEach(function (row) {
    const candidates = row.historyCandidates || [];
    if (!candidates.length) {
      row.historyLinked = false;
      row.historyLinkStatus = 'review_required';
      row.calculationStatus = row.calculatedReviewStatus === 'missing' ? 'missing' : 'review_required';
      row.eNoc = null;
      return;
    }

    const latestHistory = sortBy_(candidates, 'baseDate', 'desc')[0];
    const latestHasPerPyMoney = latestHistory && latestHistory.rentPerPy != null && latestHistory.mfPerPy != null;
    candidates.forEach(function (candidate) {
      candidate.isLatest = candidate === latestHistory;
      candidate.isSelectedForMoney = candidate === latestHistory;
    });

    row.historyLinked = true;
    row.historyLinkStatus = latestHistory.matchConfidence;
    row.currentMonthlyRentTotal = latestHistory.monthlyRentTotal;
    row.currentMonthlyMfTotal = latestHistory.monthlyMfTotal;
    row.currentRentPerPy = latestHistory.rentPerPy;
    row.currentMfPerPy = latestHistory.mfPerPy;
    row.currentMoneyAsOf = latestHistory.baseDate || '';
    row.currentMoneyBasis = 'latest_linked_history';
    row.currentMoneyStatus = latestHasPerPyMoney ? 'ok' : 'latest_history_money_missing';

    const calculation = computeENoc_(row, latestHistory, getConfig_());
    row.eNoc = calculation.value;
    row.calculationStatus = calculation.status;

    if (calculation.status === 'review_required' && row.calculatedReviewStatus === 'ok') {
      row.calculatedReviewStatus = 'review_required';
      row.calculatedReviewNotes.push('E.NOC 계산 입력값 검토 필요');
    }
    flagENocOutlier_(row);
    row.calculatedReviewNotes = uniqueValues_(row.calculatedReviewNotes);
  });
}

function flagENocOutlier_(row) {
  if (!row || row.eNoc == null) return;
  const eNoc = Number(row.eNoc);
  if (!Number.isFinite(eNoc)) return;
  if (eNoc < 1000 || eNoc > 100000) {
    if (row.calculatedReviewStatus === 'ok') row.calculatedReviewStatus = 'suspected_error';
    const ratioText = row.exclusiveRatio != null ? `전용률 ${roundNumber_(Number(row.exclusiveRatio) * 100, 2)}%` : '전용률 미확인';
    row.calculatedReviewNotes = row.calculatedReviewNotes || [];
    row.calculatedReviewNotes.push(`E.NOC 비정상 범위(${roundNumber_(eNoc, 0)}원/평): ${ratioText}와 최신 평당 임대료/관리비 입력값 확인 필요`);
  }
}

function deriveContractYears_(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  const diffDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
  return roundNumber_(diffDays / 365, 2);
}

function computeENoc_(generalRow, latestHistory, config) {
  latestHistory = latestHistory || {};
  config = config || getConfig_();
  const rentPerPy = latestHistory.rentPerPy;
  const mfPerPy = latestHistory.mfPerPy;
  const periodYears = generalRow.currentPeriodYears;
  const rfMonths = defaultValue_(generalRow.rfMonths, 0);
  const foMonths = defaultValue_(generalRow.foMonths, 0);
  const tiAmount = defaultValue_(generalRow.tiAmount, 0);
  const exclusiveRatio = normalizeExclusiveRatio_(generalRow.exclusiveRatio, generalRow.exclusiveAreaSqm, generalRow.leasedAreaSqm);
  const exclusiveAreaSqm = generalRow.exclusiveAreaSqm;

  if ([rentPerPy, mfPerPy, periodYears, exclusiveRatio, exclusiveAreaSqm].some(function (value) { return value == null; })) {
    return { value: null, status: 'review_required' };
  }

  const totalMonths = periodYears * 12;
  if (!totalMonths || totalMonths <= 0 || exclusiveRatio <= 0 || exclusiveRatio > 1) {
    return { value: null, status: 'review_required' };
  }

  const effectiveRentMonths = totalMonths - rfMonths - foMonths;
  if (effectiveRentMonths < 0) {
    return { value: null, status: 'review_required' };
  }

  const exclusiveAreaPy = exclusiveAreaSqm * 0.3025;
  if (!exclusiveAreaPy) {
    return { value: null, status: 'review_required' };
  }

  const discountedRentPerPy = rentPerPy * (effectiveRentMonths / totalMonths);
  const tiPerPyPerMonth = tiAmount / exclusiveAreaPy / totalMonths;
  const value = ((discountedRentPerPy + mfPerPy) / exclusiveRatio) - tiPerPyPerMonth;

  return {
    value: roundNumber_(value, 2),
    status: Number.isFinite(value) ? 'ok' : 'review_required',
  };
}

function normalizeExclusiveRatio_(value, exclusiveAreaSqm, leasedAreaSqm) {
  let ratio = value;
  if (typeof ratio === 'string') ratio = toPercentNumber_(ratio);
  if (ratio != null && ratio !== '') ratio = Number(ratio);
  if (ratio != null && !Number.isFinite(ratio)) ratio = null;
  if (ratio != null && ratio > 1) ratio = ratio / 100;
  if (ratio == null) ratio = safeDivide_(exclusiveAreaSqm, leasedAreaSqm);
  return ratio;
}

function attachCompanyAndAssetContext_(generalRows, companyRows, assetRows, managerRows) {
  const companyIndex = indexBy_(companyRows, 'tenantId');
  const assetIndex = indexBy_(assetRows, 'assetId');
  const assetIndexByCode = indexBy_(assetRows, function (row) { return row.assetCode; });
  const assetIndexByName = indexBy_(assetRows, function (row) { return normalizeAssetLookup_(row.assetName); });
  const managerIndex = indexBy_(managerRows, function (row) { return row.assetCode; });

  generalRows.forEach(function (row) {
    row.company = companyIndex[row.tenantId] || null;
    row.asset = assetIndex[row.assetId] || assetIndexByCode[row.assetCode] || assetIndexByName[normalizeAssetLookup_(row.assetName)] || null;
    row.manager = managerIndex[row.assetCode] || null;
  });
}

function attachIssueContext_(generalRows, assetRows, issueRows) {
  const assetAliasIndex = {};
  assetRows.forEach(function (asset) {
    assetAliasIndex[normalizeAssetLookup_(asset.assetName)] = asset.assetId;
    assetAliasIndex[asset.assetCode] = asset.assetId;
  });

  issueRows.forEach(function (issue) {
    issue.assetId = assetAliasIndex[normalizeAssetLookup_(issue.relatedAssetLabel)] || null;
  });

  const groupedIssues = groupBy_(issueRows.filter(function (issue) {
    return !issue.resolved && issue.assetId;
  }), 'assetId');

  generalRows.forEach(function (row) {
    row.linkedIssues = groupedIssues[row.assetId] || [];
  });
}

function buildAssetSummaryById_(generalRows, assetRows, managerRows, issueRows) {
  const groupedRows = groupBy_(generalRows, 'assetId');
  const assetMasterIndex = indexBy_(assetRows, 'assetId');
  const managerIndex = indexBy_(managerRows, function (row) { return row.assetCode; });
  const issueIndex = groupBy_(issueRows.filter(function (issue) {
    return !issue.resolved && issue.assetId;
  }), 'assetId');

  const summary = {};

  Object.keys(groupedRows).forEach(function (assetId) {
    const rows = groupedRows[assetId];
    const representative = rows[0];
    const assetMaster = assetMasterIndex[assetId] || null;
    const areaBase = defaultValue_(
      assetMaster ? assetMaster.grossFloorAreaSqm : null,
      sortBy_(rows, 'totalGrossAreaSqm', 'desc')[0].totalGrossAreaSqm
    );
    const leasedArea = sumBy_(rows, 'leasedAreaSqm');
    const vacancyArea = areaBase != null ? Math.max(areaBase - leasedArea, 0) : null;
    const vacancyRate = areaBase != null && areaBase > 0 ? Math.max(0, Math.min(1, vacancyArea / areaBase)) : null;
    const topTenants = sortBy_(
      Object.keys(groupBy_(rows, 'tenantId')).map(function (tenantId) {
        const tenantRows = rows.filter(function (row) { return row.tenantId === tenantId; });
        return {
          tenantId: tenantId,
          tenantMasterName: tenantRows[0].tenantMasterName,
          leasedAreaSqm: sumBy_(tenantRows, 'leasedAreaSqm'),
          monthlyRentTotal: sumBy_(tenantRows, 'currentMonthlyRentTotal'),
          reviewStatus: tenantRows.some(function (row) { return row.calculatedReviewStatus !== 'ok'; }) ? 'review_required' : 'ok',
        };
      }),
      'monthlyRentTotal',
      'desc'
    ).slice(0, 5);

    summary[assetId] = {
      assetId: assetId,
      assetCode: representative.assetCode,
      assetName: representative.assetName,
      sector: representative.sector,
      standardizedAddress: assetMaster ? assetMaster.standardizedAddress : '',
      grossFloorAreaSqm: assetMaster ? assetMaster.grossFloorAreaSqm : representative.totalGrossAreaSqm,
      landAreaSqm: assetMaster ? assetMaster.landAreaSqm : null,
      floorCount: assetMaster ? assetMaster.floorCount : '',
      approvalDate: assetMaster ? assetMaster.approvalDate : '',
      areaTableStatus: assetMaster ? assetMaster.areaTableStatus : 'unknown',
      latitude: assetMaster ? assetMaster.latitude : null,
      longitude: assetMaster ? assetMaster.longitude : null,
      reviewStatus: rows.some(function (row) { return row.calculatedReviewStatus === 'suspected_error'; })
        ? 'suspected_error'
        : rows.some(function (row) { return row.calculatedReviewStatus !== 'ok'; }) ? 'review_required' : 'ok',
      issueCount: (issueIndex[assetId] || []).length,
      issueBacklog: issueIndex[assetId] || [],
      manager: managerIndex[representative.assetCode] || null,
      rowCount: rows.length,
      tenantCount: uniqueValues_(rows.map(function (row) { return row.tenantId; })).length,
      leasedAreaSqm: leasedArea,
      vacancyAreaSqm: vacancyArea,
      vacancyRate: vacancyRate,
      monthlyRentTotal: sumBy_(rows, 'currentMonthlyRentTotal'),
      monthlyMfTotal: sumBy_(rows, 'currentMonthlyMfTotal'),
      averageENoc: computeEffectiveENocFromTotals_(rows),
      topTenants: topTenants,
      floors: buildFloorStack_(rows),
      cautionItems: buildAssetCautionItems_(rows, issueIndex[assetId] || []),
    };
  });

  return summary;
}

function buildCompanySummaryById_(generalRows, companyRows) {
  const groupedRows = groupBy_(generalRows, 'tenantId');
  const companyIndex = indexBy_(companyRows, 'tenantId');
  const summary = {};

  Object.keys(groupedRows).forEach(function (tenantId) {
    const rows = groupedRows[tenantId];
    const representative = rows[0];
    const company = companyIndex[tenantId] || null;
    const assetRollups = Object.keys(groupBy_(rows, 'assetId')).map(function (assetId) {
      const assetRows = rows.filter(function (row) { return row.assetId === assetId; });
      const expiryDates = assetRows.map(function (row) { return row.currentEndDate; }).filter(Boolean).sort();
      return {
        assetId: assetId,
        assetName: assetRows[0].assetName,
        floorLabels: uniqueValues_(assetRows.map(function (row) { return row.floorLabel; }).filter(Boolean)),
        detailAreaLabels: uniqueValues_(assetRows.map(function (row) { return row.detailAreaLabel; }).filter(Boolean)),
        period: [assetRows[0].currentStartDate, assetRows[0].currentEndDate].filter(Boolean).join(' ~ '),
        leasedAreaSqm: sumBy_(assetRows, 'leasedAreaSqm'),
        leasedAreaPy: sumBy_(assetRows, function (row) {
          return row.leasedAreaSqm != null ? row.leasedAreaSqm * 0.3025 : null;
        }),
        monthlyRentTotal: sumBy_(assetRows, 'currentMonthlyRentTotal'),
        monthlyMfTotal: sumBy_(assetRows, 'currentMonthlyMfTotal'),
        monthlyCostTotal: sumBy_(assetRows, function (row) {
          return (row.currentMonthlyRentTotal || 0) + (row.currentMonthlyMfTotal || 0);
        }),
        latestExpiry: expiryDates.length ? expiryDates[expiryDates.length - 1] : '',
        reviewStatus: assetRows.some(function (row) { return row.calculatedReviewStatus !== 'ok'; }) ? 'review_required' : 'ok',
      };
    });
    const latestExpiry = rows.map(function (row) { return row.currentEndDate; }).filter(Boolean).sort().slice(-1)[0] || '';
    const monthlyCostTotal = sumBy_(rows, function (row) {
      return (row.currentMonthlyRentTotal || 0) + (row.currentMonthlyMfTotal || 0);
    });

    summary[tenantId] = {
      tenantId: tenantId,
      tenantMasterName: representative.tenantMasterName,
      businessRegistrationNo: representative.businessRegistrationNo,
      rowCount: rows.length,
      assetCount: assetRollups.length,
      leasedAreaSqm: sumBy_(rows, 'leasedAreaSqm'),
      monthlyRentTotal: sumBy_(rows, 'currentMonthlyRentTotal'),
      monthlyMfTotal: sumBy_(rows, 'currentMonthlyMfTotal'),
      monthlyCostTotal: monthlyCostTotal,
      latestExpiry: latestExpiry,
      averageENoc: computeEffectiveENocFromTotals_(rows),
      company: company,
      leasedAssets: sortBy_(assetRollups, 'monthlyCostTotal', 'desc'),
      reviewStatus: rows.some(function (row) { return row.calculatedReviewStatus === 'suspected_error'; })
        ? 'suspected_error'
        : rows.some(function (row) { return row.calculatedReviewStatus !== 'ok'; }) ? 'review_required' : company && company.dartCorpCode ? 'ok' : 'review_required',
      reviewNotes: company && company.dartCorpCode ? [] : ['OpenDART 연결 전'],
    };
  });

  return summary;
}

function buildReviewSummary_(generalRows, historyRows, issueRows) {
  const unresolvedIssues = issueRows.filter(function (issue) { return !issue.resolved; });
  return {
    general: summarizeStatusCounts_(generalRows.map(function (row) { return row.calculatedReviewStatus; })),
    history: summarizeStatusCounts_(historyRows.map(function (row) {
      if (row.reviewStatus) return row.reviewStatus;
      if (!row.linkedLeaseSpaceId) return 'review_required';
      return 'ok';
    })),
    unresolvedIssueCount: unresolvedIssues.length,
    unresolvedIssues: unresolvedIssues,
  };
}

function summarizeStatusCounts_(statuses) {
  return statuses.reduce(function (accumulator, status) {
    const normalized = status || 'ok';
    accumulator[normalized] = (accumulator[normalized] || 0) + 1;
    return accumulator;
  }, {});
}

function expandFloorLabels_(floorLabel) {
  const text = normalizeWhitespace_(floorLabel);
  if (!text) return ['층 미입력'];
  const tokens = text.split(',').map(function (token) { return normalizeWhitespace_(token); }).filter(Boolean);
  const results = [];

  tokens.forEach(function (token) {
    if (token.indexOf('~') === -1) {
      results.push(token);
      return;
    }
    const parts = token.split('~').map(function (part) { return normalizeWhitespace_(part); }).filter(Boolean);
    if (parts.length !== 2) {
      results.push(token);
      return;
    }
    const start = parts[0];
    const end = parts[1];
    const startMatch = start.match(/^([A-Za-z]*)(-?\d+)$/);
    const endMatch = end.match(/^([A-Za-z]*)(-?\d+)$/);
    if (!startMatch || !endMatch) {
      results.push(token);
      return;
    }
    const startPrefix = startMatch[1] || '';
    const endPrefix = endMatch[1] || startPrefix;
    const startNumber = Number(startMatch[2]);
    const endNumber = Number(endMatch[2]);
    if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber) || startPrefix !== endPrefix) {
      results.push(token);
      return;
    }
    const step = startNumber <= endNumber ? 1 : -1;
    for (var value = startNumber; step > 0 ? value <= endNumber : value >= endNumber; value += step) {
      results.push(`${startPrefix}${value}`);
    }
  });

  return results.length ? results : [text];
}

function buildFloorStack_(rows) {
  const expandedRows = [];
  (rows || []).forEach(function (row) {
    const floorLabels = expandFloorLabels_(row.floorLabel);
    const splitCount = floorLabels.length || 1;
    floorLabels.forEach(function (floor) {
      expandedRows.push(Object.assign({}, row, {
        floorLabel: floor,
        leasedAreaSqm: row.leasedAreaSqm != null ? roundNumber_(Number(row.leasedAreaSqm) / splitCount, 2) : row.leasedAreaSqm,
      }));
    });
  });
  const grouped = groupBy_(expandedRows, 'floorLabel');
  return sortBy_(Object.keys(grouped).map(function (floorLabel) {
    const floorRows = grouped[floorLabel];
    const totalFloorArea = sumBy_(floorRows, 'leasedAreaSqm') || 0;
    return {
      floorLabel: floorLabel,
      totalFloorAreaSqm: totalFloorArea,
      tenants: floorRows.map(function (row) {
        return {
          tenantId: row.tenantId,
          tenantMasterName: row.tenantMasterName,
          leasedAreaSqm: row.leasedAreaSqm,
          share: totalFloorArea ? roundNumber_(row.leasedAreaSqm / totalFloorArea, 4) : null,
          reviewStatus: row.calculatedReviewStatus,
          detailAreaLabel: row.detailAreaLabel,
        };
      }),
    };
  }), 'floorLabel', 'desc');
}

function buildAssetCautionItems_(rows, issues) {
  const cautionItems = [];
  rows.forEach(function (row) {
    if (row.isDelinquent) {
      cautionItems.push({ type: 'delinquency', label: `${row.tenantMasterName} 연체/미납`, reviewStatus: 'suspected_error' });
    }
    if (row.calculatedReviewStatus !== 'ok') {
      cautionItems.push({ type: 'data_quality', label: `${row.tenantMasterName} ${row.calculatedReviewNotes.join(', ') || row.calculatedReviewStatus}`, reviewStatus: row.calculatedReviewStatus });
    }
  });
  issues.forEach(function (issue) {
    cautionItems.push({ type: 'issue_backlog', label: issue.content, reviewStatus: 'review_required' });
  });
  return cautionItems.slice(0, 12);
}
