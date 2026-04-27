function sumKnownMetric_(rows, selector) {
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

function getAssetSummaryList_(model) {
  return sortBy_(Object.keys(model.assetSummaryById || {}).map(function (assetId) {
    return model.assetSummaryById[assetId];
  }), 'assetName');
}

function getCompanySummaryList_(model) {
  return sortBy_(Object.keys(model.companySummaryById || {}).map(function (tenantId) {
    return model.companySummaryById[tenantId];
  }), 'tenantMasterName');
}

function getActiveRows_(model) {
  return (model.generalRows || []).filter(function (row) {
    return row.isContractActive !== false;
  });
}

function buildBasisMeta_(page, overrides) {
  const basis = {
    page: page,
    rowUnit: 'lease_space_id',
    rowScope: 'current_general_rows',
    rentMf: 'latest linked history row per lease_space_id; no older monetary fallback',
    eNoc: 'rent_per_py + mf_per_py, adjusted by RF/FO/TI and exclusive ratio',
    vacancy: 'asset gross floor area if available, otherwise max totalGrossAreaSqm in current rows',
    nullPolicy: 'detail values stay null when source is missing; aggregates sum only known values; missingCounts reports omissions',
  };
  Object.keys(overrides || {}).forEach(function (key) {
    basis[key] = overrides[key];
  });
  return basis;
}

function buildMissingCounts_(rows, extras) {
  const counts = {
    totalRows: (rows || []).length,
    historyUnmatched: 0,
    historyFallback: 0,
    rentMissing: 0,
    mfMissing: 0,
    moneyMissing: 0,
    eNocMissing: 0,
    businessRegistrationMissing: 0,
    assetContextMissing: 0,
    companyContextMissing: 0,
    suspectedError: 0,
    reviewRequired: 0,
  };

  (rows || []).forEach(function (row) {
    if (!row.historyLinked) counts.historyUnmatched += 1;
    if (row.currentMoneyStatus === 'latest_history_money_missing') counts.historyFallback += 1;
    if (row.currentMonthlyRentTotal == null) counts.rentMissing += 1;
    if (row.currentMonthlyMfTotal == null) counts.mfMissing += 1;
    if (row.currentMonthlyRentTotal == null || row.currentMonthlyMfTotal == null) counts.moneyMissing += 1;
    if (row.eNoc == null) counts.eNocMissing += 1;
    if (!row.businessRegistrationNo) counts.businessRegistrationMissing += 1;
    if (!row.asset) counts.assetContextMissing += 1;
    if (!row.company) counts.companyContextMissing += 1;
    if (row.calculatedReviewStatus === 'suspected_error') counts.suspectedError += 1;
    if (row.calculatedReviewStatus && row.calculatedReviewStatus !== 'ok') counts.reviewRequired += 1;
  });

  Object.keys(extras || {}).forEach(function (key) {
    counts[key] = extras[key];
  });
  return counts;
}

function attachPayloadMeta_(payload, page, model, rows, options) {
  const settings = options || {};
  const basis = buildBasisMeta_(page, settings.basis || {});
  const missingCounts = buildMissingCounts_(rows, settings.extraMissingCounts || {});
  const runtimeMeta = model.runtimeMeta || {};
  const basisDisplay = {
    page: page,
    asOf: settings.basisAsOf || model.generatedAt,
    generatedAt: model.generatedAt,
    refreshedAt: runtimeMeta.lastRefreshCalculationAt || model.generatedAt,
    derivedAt: runtimeMeta.lastDerivedRefreshAt || '',
    fetchedAt: settings.fetchedAt || '',
    fetchedAts: settings.fetchedAts || [],
    source: settings.basisSource || '',
  };
  payload.generatedAt = model.generatedAt;
  payload.basis = basis;
  payload.basisDisplay = basisDisplay;
  payload.missingCounts = missingCounts;
  payload.meta = {
    page: page,
    generatedAt: model.generatedAt,
    formulaVersion: safeGet_(model, ['config', 'formulaVersion']) || '',
    rowCount: (rows || []).length,
    selection: settings.selection || {},
    basis: basis,
    basisDisplay: basisDisplay,
    missingCounts: missingCounts,
    timing: {
      refreshedAt: runtimeMeta.lastRefreshCalculationAt || model.generatedAt,
      derivedAt: runtimeMeta.lastDerivedRefreshAt || '',
      fetchedAt: settings.fetchedAt || '',
      fetchedAts: settings.fetchedAts || [],
    },
  };
  return payload;
}

function countUniqueMetric_(rows, selector) {
  return uniqueValues_((rows || []).map(function (row) {
    return typeof selector === 'function' ? selector(row) : row[selector];
  }).filter(function (value) {
    return value != null && value !== '';
  })).length;
}

function buildAssetSummaryLookup_(model) {
  const lookup = {};
  Object.keys(model.assetSummaryById || {}).forEach(function (assetId) {
    lookup[assetId] = model.assetSummaryById[assetId];
  });
  return lookup;
}

function isAssetGrossFloorAreaEffectiveForMonth_(assetSummary, month) {
  const effectiveMonth = safeString_(assetSummary && assetSummary.grossFloorAreaEffectiveMonth);
  if (!effectiveMonth) return true;
  return effectiveMonth <= safeString_(month);
}

function buildHomeGrossFloorAreaBasisRows_(assetSummaries) {
  return sortBy_((assetSummaries || []).map(function (asset) {
    const basis = asset.grossFloorAreaTimelineBasis || {};
    return {
      assetId: asset.assetId,
      assetName: asset.assetName,
      grossFloorAreaSqm: asset.grossFloorAreaSqm,
      firstConfiguredAt: basis.firstConfiguredAt || asset.firstConfiguredAt || '',
      approvalDate: basis.approvalDate || asset.approvalDate || '',
      effectiveAt: basis.effectiveAt || asset.grossFloorAreaEffectiveAt || '',
      effectiveMonth: basis.effectiveMonth || asset.grossFloorAreaEffectiveMonth || '',
      rule: basis.rule || asset.grossFloorAreaTimelineRule || 'active_history_only',
      note: basis.note || '',
    };
  }), 'assetName');
}

function buildRollingRentTrendRows_(model) {
  const months = uniqueValues_((model.historyRows || []).map(function (row) {
    return row.baseMonth;
  }).filter(Boolean)).sort();
  if (!months.length) return [];

  const activeRows = getActiveRows_(model);
  const activeLeaseSpaceIndex = {};
  activeRows.forEach(function (row) {
    if (!row.leaseSpaceId) return;
    activeLeaseSpaceIndex[row.leaseSpaceId] = row;
  });

  const rowsByLeaseSpace = groupBy_((model.historyRows || []).filter(function (row) {
    return row.linkedLeaseSpaceId && activeLeaseSpaceIndex[row.linkedLeaseSpaceId];
  }), 'linkedLeaseSpaceId');
  const assetLookup = buildAssetSummaryLookup_(model);
  let previousAssetIds = [];

  return months.map(function (month) {
    let monthlyRentTotal = 0;
    let monthlyMfTotal = 0;
    let leasedAreaSqm = 0;
    let rentKnownCount = 0;
    let mfKnownCount = 0;
    let leasedAreaKnownCount = 0;
    let selectedLeaseSpaceCount = 0;
    const activeAssetIds = [];

    Object.keys(rowsByLeaseSpace).forEach(function (leaseSpaceId) {
      const candidates = rowsByLeaseSpace[leaseSpaceId]
        .filter(function (row) { return row.baseMonth && row.baseMonth <= month; })
        .sort(function (left, right) { return String(left.baseMonth).localeCompare(String(right.baseMonth)); });
      if (!candidates.length) return;

      const selected = candidates[candidates.length - 1];
      const generalRow = activeLeaseSpaceIndex[leaseSpaceId];
      if (!generalRow) return;

      selectedLeaseSpaceCount += 1;
      if (activeAssetIds.indexOf(generalRow.assetId) === -1) activeAssetIds.push(generalRow.assetId);
      if (selected.monthlyRentTotal != null) {
        monthlyRentTotal += Number(selected.monthlyRentTotal);
        rentKnownCount += 1;
      }
      if (selected.monthlyMfTotal != null) {
        monthlyMfTotal += Number(selected.monthlyMfTotal);
        mfKnownCount += 1;
      }
      if (generalRow.leasedAreaSqm != null) {
        leasedAreaSqm += Number(generalRow.leasedAreaSqm);
        leasedAreaKnownCount += 1;
      }
    });

    const grossFloorAreaAppliedAssetIds = activeAssetIds.filter(function (assetId) {
      return isAssetGrossFloorAreaEffectiveForMonth_(assetLookup[assetId], month);
    });
    const grossFloorAreaPendingAssets = activeAssetIds.filter(function (assetId) {
      return grossFloorAreaAppliedAssetIds.indexOf(assetId) === -1;
    }).map(function (assetId) {
      const asset = assetLookup[assetId] || {};
      return {
        assetId: assetId,
        assetName: asset.assetName || assetId,
        effectiveMonth: asset.grossFloorAreaEffectiveMonth || '',
        rule: asset.grossFloorAreaTimelineRule || 'active_history_only',
      };
    });
    const grossFloorAreaSqm = sumKnownMetric_(grossFloorAreaAppliedAssetIds.map(function (assetId) {
      return assetLookup[assetId];
    }).filter(Boolean), 'grossFloorAreaSqm');
    const newlyAddedAssetIds = activeAssetIds.filter(function (assetId) {
      return previousAssetIds.indexOf(assetId) === -1;
    });
    const newlyAddedAssets = newlyAddedAssetIds.map(function (assetId) {
      const asset = assetLookup[assetId];
      return {
        assetId: assetId,
        assetName: asset ? asset.assetName : assetId,
      };
    });

    previousAssetIds = activeAssetIds.slice();

    return {
      month: month,
      monthlyRentTotal: rentKnownCount ? monthlyRentTotal : null,
      monthlyMfTotal: mfKnownCount ? monthlyMfTotal : null,
      activeAssetCount: activeAssetIds.length,
      leasedAreaSqm: leasedAreaKnownCount ? leasedAreaSqm : null,
      grossFloorAreaSqm: grossFloorAreaSqm,
      grossFloorAreaAppliedAssetCount: grossFloorAreaAppliedAssetIds.length,
      grossFloorAreaPendingAssetCount: grossFloorAreaPendingAssets.length,
      grossFloorAreaPendingAssets: grossFloorAreaPendingAssets,
      newlyAddedAssetCount: newlyAddedAssets.length,
      newlyAddedAssets: newlyAddedAssets,
      knownLeaseSpaceCount: selectedLeaseSpaceCount,
      rentKnownCount: rentKnownCount,
      mfKnownCount: mfKnownCount,
    };
  });
}

function buildAssetUniqueTenantRows_(rows) {
  if (typeof buildTenantRollupRows_ === 'function') return buildTenantRollupRows_(rows || []);
  return [];
}

function buildAssetExpirySnapshot_(tenantRows, generatedAt) {
  const referenceMonth = monthKeyFromIso_(generatedAt) + '-01';
  const entries = (tenantRows || []).map(function (row) {
    const expiryDate = row.earliestExpiry || row.latestExpiry || '';
    return {
      tenantId: row.tenantId,
      tenantMasterName: row.tenantMasterName,
      earliestExpiry: row.earliestExpiry || '',
      latestExpiry: row.latestExpiry || '',
      monthsToExpiry: monthsBetweenIso_(referenceMonth, expiryDate),
      leaseSpaceCount: row.leaseSpaceCount,
      leasedAreaSqm: row.leasedAreaSqm,
      monthlyCostTotal: row.monthlyCostTotal,
      reviewStatus: row.reviewStatus,
    };
  }).filter(function (row) {
    return row.monthsToExpiry != null;
  });

  return {
    entries: sortBy_(entries, 'monthsToExpiry'),
    byBucket: [
      { label: '0-3 months', count: entries.filter(function (row) { return row.monthsToExpiry >= 0 && row.monthsToExpiry <= 3; }).length },
      { label: '4-6 months', count: entries.filter(function (row) { return row.monthsToExpiry >= 4 && row.monthsToExpiry <= 6; }).length },
      { label: '7-12 months', count: entries.filter(function (row) { return row.monthsToExpiry >= 7 && row.monthsToExpiry <= 12; }).length },
      { label: '12+ months', count: entries.filter(function (row) { return row.monthsToExpiry > 12; }).length },
    ],
  };
}

function expandAssetRowsByFloor_(rows) {
  const amountFields = [
    'leasedAreaSqm',
    'exclusiveAreaSqm',
    'warehouseAreaSqm',
    'dockAreaSqm',
    'officeAreaSqm',
    'otherExclusiveAreaSqm',
    'corridorAreaSqm',
    'rampAreaSqm',
    'mechanicalAreaSqm',
    'parkingAreaSqm',
    'coreAreaSqm',
    'otherCommonAreaSqm',
    'currentMonthlyRentTotal',
    'currentMonthlyMfTotal',
    'currentMonthlyCostTotal',
    'monthlyRentTotal',
    'monthlyMfTotal',
    'monthlyCostTotal',
    'tiAmount',
  ];
  return (rows || []).reduce(function (accumulator, row) {
    const floorLabels = typeof expandFloorLabels_ === 'function' ? expandFloorLabels_(row.floorLabel) : [row.floorLabel || '층 미입력'];
    const splitCount = floorLabels.length || 1;
    floorLabels.forEach(function (floorLabel, floorIndex) {
      const expanded = Object.assign({}, row, {
        floorLabel: floorLabel,
        sourceFloorLabel: row.floorLabel || '',
        floorSplitIndex: floorIndex + 1,
        floorSplitCount: splitCount,
      });
      amountFields.forEach(function (field) {
        if (row[field] != null && row[field] !== '' && splitCount > 1) {
          expanded[field] = roundNumber_(Number(row[field]) / splitCount, 2);
        }
      });
      accumulator.push(expanded);
    });
    return accumulator;
  }, []);
}

function buildAssetFloorExpirySnapshot_(rows, generatedAt) {
  const referenceMonth = monthKeyFromIso_(generatedAt) + '-01';
  const entries = (rows || []).map(function (row) {
    const expiryDate = row.currentEndDate || row.latestExpiry || '';
    return {
      leaseSpaceId: row.leaseSpaceId,
      tenantId: row.tenantId,
      tenantMasterName: row.tenantMasterName,
      floorLabel: row.floorLabel || '',
      detailAreaLabel: row.detailAreaLabel || '',
      spaceLabel: [row.floorLabel, row.detailAreaLabel].filter(Boolean).join(' / ') || '-',
      currentEndDate: expiryDate,
      earliestExpiry: expiryDate,
      latestExpiry: expiryDate,
      monthsToExpiry: monthsBetweenIso_(referenceMonth, expiryDate),
      leasedAreaSqm: row.leasedAreaSqm,
      monthlyCostTotal: row.currentMonthlyCostTotal,
      monthlyCombinedTotal: row.currentMonthlyCostTotal,
      reviewStatus: row.calculatedReviewStatus,
    };
  }).filter(function (row) {
    return row.monthsToExpiry != null;
  });

  return {
    entries: sortBy_(entries, 'monthsToExpiry'),
    byBucket: [
      { label: '0-3 months', count: entries.filter(function (row) { return row.monthsToExpiry >= 0 && row.monthsToExpiry <= 3; }).length },
      { label: '4-6 months', count: entries.filter(function (row) { return row.monthsToExpiry >= 4 && row.monthsToExpiry <= 6; }).length },
      { label: '7-12 months', count: entries.filter(function (row) { return row.monthsToExpiry >= 7 && row.monthsToExpiry <= 12; }).length },
      { label: '12+ months', count: entries.filter(function (row) { return row.monthsToExpiry > 12; }).length },
    ],
  };
}

function buildAssetCoreTenantRows_(tenantRows, summary) {
  const totalCost = summary && summary.monthlyCostTotal != null ? Number(summary.monthlyCostTotal) : null;
  const totalArea = summary && summary.leasedAreaSqm != null ? Number(summary.leasedAreaSqm) : null;
  return (tenantRows || []).map(function (row) {
    return Object.assign({}, row, {
      costShare: totalCost ? roundNumber_(Number(row.monthlyCostTotal || 0) / totalCost, 4) : null,
      areaShare: totalArea ? roundNumber_(Number(row.leasedAreaSqm || 0) / totalArea, 4) : null,
    });
  }).slice(0, 10);
}

function buildAssetENocAudit_(rows) {
  const auditRows = (rows || []).map(function (row) {
    const recomputed = computeENoc_(row, {
      rentPerPy: row.currentRentPerPy,
      mfPerPy: row.currentMfPerPy,
    }, getConfig_());
    const variance = row.eNoc == null || recomputed.value == null ? null : roundNumber_(Number(row.eNoc) - Number(recomputed.value), 4);

    return {
      leaseSpaceId: row.leaseSpaceId,
      tenantId: row.tenantId,
      tenantMasterName: row.tenantMasterName,
      currentMoneyAsOf: row.currentMoneyAsOf,
      currentMoneyBasis: row.currentMoneyBasis,
      rentPerPy: row.currentRentPerPy,
      mfPerPy: row.currentMfPerPy,
      exclusiveRatio: normalizeExclusiveRatio_(row.exclusiveRatio, row.exclusiveAreaSqm, row.leasedAreaSqm),
      exclusiveAreaSqm: row.exclusiveAreaSqm,
      leasedAreaSqm: row.leasedAreaSqm,
      currentPeriodYears: row.currentPeriodYears,
      rfMonths: row.rfMonths,
      foMonths: row.foMonths,
      tiAmount: row.tiAmount,
      storedENoc: row.eNoc,
      recomputedENoc: recomputed.value,
      variance: variance,
      calculationStatus: recomputed.status,
      reviewStatus: row.calculatedReviewStatus,
    };
  });

  return {
    summary: {
      rowCount: auditRows.length,
      computedRowCount: auditRows.filter(function (row) { return row.recomputedENoc != null; }).length,
      missingInputCount: auditRows.filter(function (row) { return row.recomputedENoc == null; }).length,
      nonZeroVarianceCount: auditRows.filter(function (row) { return row.variance != null && Math.abs(row.variance) > 0.01; }).length,
    },
    formula: '((rentPerPy * ((periodYears*12 - rfMonths - foMonths)/(periodYears*12)) + mfPerPy) / exclusiveRatio) - (tiAmount / (exclusiveAreaSqm*0.3025) / (periodYears*12))',
    rows: auditRows,
  };
}

function buildExposureDimensionRows_(rows, resolver) {
  const grouped = {};
  (rows || []).forEach(function (row) {
    const label = defaultValue_(typeof resolver === 'function' ? resolver(row) : row[resolver], 'Unclassified');
    grouped[label] = grouped[label] || {
      label: label,
      assetCount: 0,
      leaseSpaceCount: 0,
      leasedAreaSqm: 0,
      monthlyRentTotal: 0,
      monthlyMfTotal: 0,
      monthlyCostTotal: 0,
      _assetIds: [],
      _leaseSpaceIds: [],
      _hasArea: false,
      _hasRent: false,
      _hasMf: false,
      _hasCost: false,
    };

    const bucket = grouped[label];
    if (bucket._assetIds.indexOf(row.assetId) === -1 && row.assetId) bucket._assetIds.push(row.assetId);
    if (bucket._leaseSpaceIds.indexOf(row.leaseSpaceId) === -1 && row.leaseSpaceId) bucket._leaseSpaceIds.push(row.leaseSpaceId);
    if (row.leasedAreaSqm != null) {
      bucket.leasedAreaSqm += Number(row.leasedAreaSqm);
      bucket._hasArea = true;
    }
    if (row.currentMonthlyRentTotal != null) {
      bucket.monthlyRentTotal += Number(row.currentMonthlyRentTotal);
      bucket._hasRent = true;
    }
    if (row.currentMonthlyMfTotal != null) {
      bucket.monthlyMfTotal += Number(row.currentMonthlyMfTotal);
      bucket._hasMf = true;
    }
    if (row.currentMonthlyCostTotal != null) {
      bucket.monthlyCostTotal += Number(row.currentMonthlyCostTotal);
      bucket._hasCost = true;
    }
  });

  return sortBy_(Object.keys(grouped).map(function (key) {
    const bucket = grouped[key];
    return {
      label: key,
      assetCount: bucket._assetIds.length,
      leaseSpaceCount: bucket._leaseSpaceIds.length,
      leasedAreaSqm: bucket._hasArea ? bucket.leasedAreaSqm : null,
      monthlyRentTotal: bucket._hasRent ? bucket.monthlyRentTotal : null,
      monthlyMfTotal: bucket._hasMf ? bucket.monthlyMfTotal : null,
      monthlyCostTotal: bucket._hasCost ? bucket.monthlyCostTotal : null,
    };
  }), 'monthlyCostTotal', 'desc');
}

function buildRentTrendRows_(historyRows) {
  const trendByMonth = {};
  (historyRows || []).forEach(function (row) {
    if (!row.baseMonth) return;
    trendByMonth[row.baseMonth] = trendByMonth[row.baseMonth] || {
      month: row.baseMonth,
      monthlyRentTotal: 0,
      monthlyMfTotal: 0,
      rentKnownCount: 0,
      mfKnownCount: 0,
    };
    if (row.monthlyRentTotal != null) {
      trendByMonth[row.baseMonth].monthlyRentTotal += Number(row.monthlyRentTotal);
      trendByMonth[row.baseMonth].rentKnownCount += 1;
    }
    if (row.monthlyMfTotal != null) {
      trendByMonth[row.baseMonth].monthlyMfTotal += Number(row.monthlyMfTotal);
      trendByMonth[row.baseMonth].mfKnownCount += 1;
    }
  });

  return sortBy_(Object.keys(trendByMonth).map(function (month) {
    return {
      month: month,
      monthlyRentTotal: trendByMonth[month].rentKnownCount ? trendByMonth[month].monthlyRentTotal : null,
      monthlyMfTotal: trendByMonth[month].mfKnownCount ? trendByMonth[month].monthlyMfTotal : null,
    };
  }), 'month');
}

function aggregateDimension_(rows, dimensionField, metricField) {
  const grouped = {};
  (rows || []).forEach(function (row) {
    const metricValue = row[metricField];
    if (metricValue == null || metricValue === '') return;
    const key = defaultValue_(row[dimensionField], 'Unclassified');
    grouped[key] = grouped[key] || { label: key, value: 0, recordCount: 0 };
    grouped[key].value += Number(metricValue);
    grouped[key].recordCount += 1;
  });
  return sortBy_(Object.keys(grouped).map(function (key) {
    return grouped[key];
  }), 'value', 'desc');
}

function buildTopContracts_(rows) {
  return sortBy_(Object.keys(groupBy_(rows || [], 'tenantId')).map(function (tenantId) {
    const tenantRows = (rows || []).filter(function (row) { return row.tenantId === tenantId; });
    const expiryDates = tenantRows.map(function (row) { return row.currentEndDate; }).filter(Boolean).sort();
    return {
      tenantId: tenantId,
      tenantMasterName: tenantRows[0].tenantMasterName,
      assetNames: uniqueValues_(tenantRows.map(function (row) { return row.assetName; })),
      leasedAreaSqm: sumKnownMetric_(tenantRows, 'leasedAreaSqm'),
      monthlyRentTotal: sumKnownMetric_(tenantRows, 'currentMonthlyRentTotal'),
      monthlyMfTotal: sumKnownMetric_(tenantRows, 'currentMonthlyMfTotal'),
      monthlyTotal: sumKnownMetric_(tenantRows, 'currentMonthlyCostTotal'),
      currentEndDate: expiryDates.length ? expiryDates[0] : '',
      reviewStatus: tenantRows.some(function (row) { return row.calculatedReviewStatus === 'suspected_error'; })
        ? 'suspected_error'
        : tenantRows.some(function (row) { return row.calculatedReviewStatus !== 'ok'; }) ? 'review_required' : 'ok',
    };
  }), 'monthlyTotal', 'desc').slice(0, 10);
}

function buildContractSummary_(rows, generatedAt) {
  const referenceMonth = monthKeyFromIso_(generatedAt) + '-01';
  const upcoming = (rows || []).map(function (row) {
    return {
      assetName: row.assetName,
      tenantMasterName: row.tenantMasterName,
      currentEndDate: row.currentEndDate,
      monthsToExpiry: monthsBetweenIso_(referenceMonth, row.currentEndDate),
      leaseSpaceId: row.leaseSpaceId,
      reviewStatus: row.calculatedReviewStatus,
    };
  }).filter(function (row) {
    return row.monthsToExpiry != null && row.monthsToExpiry >= 0 && row.monthsToExpiry <= 18;
  });

  return {
    upcoming: sortBy_(upcoming, 'monthsToExpiry').slice(0, 10),
    tenantCount: countUniqueMetric_(rows || [], 'tenantId'),
    byBucket: [
      { label: '0-3 months', count: upcoming.filter(function (row) { return row.monthsToExpiry <= 3; }).length },
      { label: '0-6 months', count: upcoming.filter(function (row) { return row.monthsToExpiry <= 6; }).length },
      { label: '0-12 months', count: upcoming.filter(function (row) { return row.monthsToExpiry <= 12; }).length },
    ],
  };
}

function buildMapPointsFromAssets_(assetSummaries) {
  return (assetSummaries || []).map(function (asset) {
    return {
      assetId: asset.assetId,
      assetName: asset.assetName,
      address: asset.standardizedAddress || asset.lookupAddress || asset.assetCode || '',
      latitude: asset.latitude,
      longitude: asset.longitude,
      reviewStatus: asset.reviewStatus,
      issueCount: asset.issueCount,
    };
  });
}

function buildAssetAreaBreakdown_(summary, rows) {
  const scopedRows = rows || [];
  const leasedAreaSqm = sumKnownMetric_(scopedRows, 'leasedAreaSqm');
  const exclusiveAreaSqm = sumKnownMetric_(scopedRows, 'exclusiveAreaSqm');
  return {
    grossFloorAreaSqm: summary ? summary.grossFloorAreaSqm : null,
    leasedAreaSqm: leasedAreaSqm,
    vacancyAreaSqm: summary ? summary.vacancyAreaSqm : null,
    exclusiveAreaSqm: exclusiveAreaSqm,
    exclusiveRatio: safeDivide_(exclusiveAreaSqm, leasedAreaSqm),
    warehouseAreaSqm: sumKnownMetric_(scopedRows, 'warehouseAreaSqm'),
    dockAreaSqm: sumKnownMetric_(scopedRows, 'dockAreaSqm'),
    officeAreaSqm: sumKnownMetric_(scopedRows, 'officeAreaSqm'),
    otherExclusiveAreaSqm: sumKnownMetric_(scopedRows, 'otherExclusiveAreaSqm'),
    corridorAreaSqm: sumKnownMetric_(scopedRows, 'corridorAreaSqm'),
    rampAreaSqm: sumKnownMetric_(scopedRows, 'rampAreaSqm'),
    mechanicalAreaSqm: sumKnownMetric_(scopedRows, 'mechanicalAreaSqm'),
    parkingAreaSqm: sumKnownMetric_(scopedRows, 'parkingAreaSqm'),
    coreAreaSqm: sumKnownMetric_(scopedRows, 'coreAreaSqm'),
    otherCommonAreaSqm: sumKnownMetric_(scopedRows, 'otherCommonAreaSqm'),
  };
}

function resolveSelectedSummary_(itemsById, requestedId, preferredId) {
  if (requestedId && itemsById[requestedId]) return itemsById[requestedId];
  if (preferredId && itemsById[preferredId]) return itemsById[preferredId];
  const values = Object.keys(itemsById || {}).map(function (key) { return itemsById[key]; });
  return values.length ? values[0] : null;
}

function safeGet_(value, path) {
  return (path || []).reduce(function (current, key) {
    return current == null ? null : current[key];
  }, value);
}

function buildHomePayload_(model) {
  const activeRows = getActiveRows_(model);
  const assetSummaries = getAssetSummaryList_(model);
  const companySummaries = getCompanySummaryList_(model);
  const totalLeasedAreaSqm = sumKnownMetric_(activeRows, 'leasedAreaSqm');
  const totalVacancyAreaSqm = sumKnownMetric_(assetSummaries, 'vacancyAreaSqm');
  const totalAreaSqm = sumKnownMetric_(assetSummaries, 'grossFloorAreaSqm');
  const weightedVacancyRate = safeDivide_(totalVacancyAreaSqm, totalAreaSqm);
  const contractSummary = buildContractSummary_(activeRows, model.generatedAt);
  const topContracts = buildTopContracts_(activeRows);
  const monthlyTotalCost = sumKnownMetric_(activeRows, function (row) {
    if (row.currentMonthlyRentTotal == null && row.currentMonthlyMfTotal == null) return null;
    return Number(row.currentMonthlyRentTotal || 0) + Number(row.currentMonthlyMfTotal || 0);
  });
  const rentTrend = buildRollingRentTrendRows_(model);
  const latestRentTrend = rentTrend.length ? rentTrend[rentTrend.length - 1] : null;
  const grossFloorAreaBasisRows = buildHomeGrossFloorAreaBasisRows_(assetSummaries);

  const payload = {
    kpis: [
      { key: 'asset_count', label: '운영 자산 수', value: assetSummaries.length, status: 'ok', valueType: 'number' },
      { key: 'operating_asset_count', label: '운영 자산 수', value: assetSummaries.length, status: 'ok', valueType: 'number' },
      { key: 'leased_area_total', label: '총 임대면적', value: totalLeasedAreaSqm, status: totalLeasedAreaSqm == null ? 'review_required' : 'ok', valueType: 'area' },
      { key: 'vacancy_area_total', label: '총 공실면적', value: totalVacancyAreaSqm, status: totalVacancyAreaSqm == null ? 'review_required' : 'ok', valueType: 'area' },
      { key: 'vacancy_rate', label: '공실률', value: weightedVacancyRate, status: weightedVacancyRate == null ? 'review_required' : 'ok', valueType: 'percent' },
      { key: 'monthly_rent_total', label: '월 임대료 총액', value: sumKnownMetric_(activeRows, 'currentMonthlyRentTotal'), status: activeRows.some(function (row) { return row.currentMonthlyRentTotal == null; }) ? 'review_required' : 'ok', valueType: 'currency' },
      { key: 'monthly_total_cost', label: '월 임관리비 총액', value: monthlyTotalCost, status: monthlyTotalCost == null ? 'review_required' : 'ok', valueType: 'currency' },
      { key: 'review_backlog', label: 'Review Backlog', value: model.reviewSummary.unresolvedIssueCount, status: model.reviewSummary.unresolvedIssueCount ? 'review_required' : 'ok', valueType: 'number' },
    ],
    occupancy: {
      grossFloorAreaSqm: totalAreaSqm,
      leasedAreaSqm: totalLeasedAreaSqm,
      vacancyAreaSqm: totalVacancyAreaSqm,
      vacancyRate: weightedVacancyRate,
    },
    dataQuality: model.reviewSummary,
    mapPoints: buildMapPointsFromAssets_(assetSummaries),
    rentTrend: rentTrend,
    rentTrendSummary: {
      monthCount: rentTrend.length,
      latestMonth: latestRentTrend ? latestRentTrend.month : '',
      latestActiveAssetCount: latestRentTrend ? latestRentTrend.activeAssetCount : null,
      latestGrossFloorAreaSqm: latestRentTrend ? latestRentTrend.grossFloorAreaSqm : null,
      latestGrossFloorAreaAppliedAssetCount: latestRentTrend ? latestRentTrend.grossFloorAreaAppliedAssetCount : null,
      latestGrossFloorAreaPendingAssetCount: latestRentTrend ? latestRentTrend.grossFloorAreaPendingAssetCount : null,
      latestLeasedAreaSqm: latestRentTrend ? latestRentTrend.leasedAreaSqm : null,
      latestNewlyAddedAssets: latestRentTrend ? latestRentTrend.newlyAddedAssets : [],
    },
    rentTrendBasis: {
      grossFloorAreaRule: 'later_of_first_configured_at_and_approval_date_when_available',
      assetCount: grossFloorAreaBasisRows.length,
      assetRows: grossFloorAreaBasisRows,
    },
    vacancySummary: sortBy_(assetSummaries, 'vacancyRate', 'desc').slice(0, 10).map(function (row) {
      return {
        assetId: row.assetId,
        assetName: row.assetName,
        grossFloorAreaSqm: row.grossFloorAreaSqm,
        vacancyAreaSqm: row.vacancyAreaSqm,
        vacancyRate: row.vacancyRate,
        reviewStatus: row.reviewStatus,
      };
    }),
    contractSummary: contractSummary,
    tenantSummary: sortBy_(companySummaries, 'monthlyCostTotal', 'desc').slice(0, 10),
    composition: {
      sector: aggregateDimension_(activeRows, 'sector', 'currentMonthlyCostTotal'),
      coldStorage: aggregateDimension_(activeRows, 'coldStorageType', 'leasedAreaSqm'),
      goodsType: aggregateDimension_(activeRows, 'goodsType', 'leasedAreaSqm'),
    },
    topContracts: topContracts,
    topTenants: sortBy_(companySummaries, 'monthlyCostTotal', 'desc').slice(0, 10),
    issueBacklog: model.reviewSummary.unresolvedIssues.slice(0, 20),
  };

  return attachPayloadMeta_(payload, 'home', model, activeRows, {
    selection: { scope: 'portfolio', activeOnly: true },
    basis: { rowScope: 'active_contract_rows' },
    basisAsOf: latestRentTrend ? latestRentTrend.month : model.generatedAt,
    basisSource: 'DB_GENERAL + DB_HISTORY + DB_ASSET',
    extraMissingCounts: {
      unresolvedIssueCount: model.reviewSummary.unresolvedIssueCount,
      assetsWithoutCoordinates: assetSummaries.filter(function (asset) {
        return asset.latitude == null || asset.longitude == null;
      }).length,
    },
  });
}

function getAssetFilterOptionsForPayload_(model) {
  const cached = typeof getCachedJson_ === 'function' ? getCachedJson_('asset-options:full') : null;
  if (cached) return cached;
  const persisted = typeof readPersistedJsonProperty_ === 'function' ? readPersistedJsonProperty_('ASSET_OPTIONS_JSON') : null;
  if (persisted) {
    if (typeof putCachedJson_ === 'function') putCachedJson_('asset-options:full', persisted, getConfig_().payloadCacheTtlSeconds);
    return persisted;
  }
  return getAssetSummaryList_(model).map(function (row) {
    return {
      assetId: row.assetId,
      assetName: row.assetName,
      monthlyCostTotal: row.monthlyCostTotal,
      uniqueTenantCount: row.uniqueTenantCount,
      vacancyRate: row.vacancyRate,
      averageENoc: row.averageENoc,
      fetchedAt: row.fetchedAt || '',
    };
  });
}

function getCompanyFilterOptionsForPayload_(model) {
  const cached = typeof getCachedJson_ === 'function' ? getCachedJson_('company-options:full') : null;
  if (cached) return cached;
  const persisted = typeof readPersistedJsonProperty_ === 'function' ? readPersistedJsonProperty_('COMPANY_OPTIONS_JSON') : null;
  if (persisted) {
    if (typeof putCachedJson_ === 'function') putCachedJson_('company-options:full', persisted, getConfig_().payloadCacheTtlSeconds);
    return persisted;
  }
  return getCompanySummaryList_(model).map(function (row) {
    return {
      tenantId: row.tenantId,
      tenantMasterName: row.tenantMasterName,
      assetCount: row.assetCount,
      monthlyCostTotal: row.monthlyCostTotal,
      latestRevenue: safeGet_(row, ['company', 'latestRevenue']),
      latestExpiry: row.latestExpiry,
      exposureAvailable: row.exposureAvailable,
      selectorSortMeta: row.selectorSortMeta || {},
    };
  });
}

function buildAssetPayload_(model, assetId) {
  const summary = resolveSelectedSummary_(model.assetSummaryById, assetId, model.defaultAssetId);
  if (!summary) {
    return attachPayloadMeta_({ error: 'Asset data is unavailable.' }, 'asset', model, [], {
      selection: { assetId: assetId || '' },
      basis: { rowScope: 'selected_asset_rows' },
    });
  }

  const rows = (model.generalRows || []).filter(function (row) {
    return row.assetId === summary.assetId;
  });
  const floorRows = expandAssetRowsByFloor_(rows);
  const areaBreakdown = buildAssetAreaBreakdown_(summary, floorRows);
  const occupancyRate = safeDivide_(summary.leasedAreaSqm, summary.grossFloorAreaSqm);
  const uniqueTenantRows = buildAssetUniqueTenantRows_(rows);
  const expirySnapshot = buildAssetFloorExpirySnapshot_(floorRows, model.generatedAt);
  const coreTenants = buildAssetCoreTenantRows_(uniqueTenantRows, summary);
  const eNocAudit = buildAssetENocAudit_(floorRows);
  const assetFetchedAts = uniqueValues_([summary.fetchedAt].filter(Boolean));

  const payload = {
    filters: {
      assets: getAssetFilterOptionsForPayload_(model),
      selectedAssetId: summary.assetId,
      selectorMeta: {
        sortOptions: [
          { key: 'asset_name_asc', label: '자산명순' },
          { key: 'monthly_cost_desc', label: '월 임관리비 높은순' },
          { key: 'vacancy_rate_desc', label: '공실률 높은순' },
          { key: 'e_noc_desc', label: 'E.NOC 높은순' },
        ],
        defaultSort: 'asset_name_asc',
      },
    },
    overview: summary,
    kpis: [
      { key: 'occupancy_rate', label: '임대율', value: occupancyRate, valueType: 'percent', status: occupancyRate == null ? 'review_required' : 'ok' },
      { key: 'leased_area_total', label: '총 임대면적', value: summary.leasedAreaSqm, valueType: 'area', status: summary.leasedAreaSqm == null ? 'review_required' : 'ok' },
      { key: 'vacancy_area_total', label: '공실면적', value: summary.vacancyAreaSqm, valueType: 'area', status: summary.vacancyAreaSqm == null ? 'review_required' : 'ok' },
      { key: 'unique_tenant_count', label: '현재 임차인 수', value: uniqueTenantRows.length, valueType: 'number', status: 'ok' },
      { key: 'monthly_total_cost', label: '월 임관리비 총액', value: summary.monthlyCostTotal, valueType: 'currency', status: summary.missingCounts.moneyMissing ? 'review_required' : 'ok' },
      { key: 'average_e_noc', label: 'E.NOC', value: summary.averageENoc, valueType: 'currency', status: summary.averageENoc == null ? 'review_required' : 'ok' },
    ],
    areaBreakdown: areaBreakdown,
    topTenants: summary.topTenants,
    stackingPlan: summary.floors,
    cautionItems: summary.cautionItems,
    analytics: {
      goodsTypeMix: aggregateDimension_(floorRows, 'goodsType', 'leasedAreaSqm'),
      uniqueTenants: uniqueTenantRows,
      expirySnapshot: expirySnapshot,
      coreTenants: coreTenants,
      monthlyCostByTenant: uniqueTenantRows.map(function (row) {
        return {
          tenantId: row.tenantId,
          tenantMasterName: row.tenantMasterName,
          monthlyRentTotal: row.monthlyRentTotal,
          monthlyMfTotal: row.monthlyMfTotal,
          monthlyCostTotal: row.monthlyCostTotal,
          leaseSpaceCount: row.leaseSpaceCount,
          leasedAreaSqm: row.leasedAreaSqm,
        };
      }),
      eNocAudit: eNocAudit,
      contractExpiry: floorRows.map(function (row) {
        return {
          leaseSpaceId: row.leaseSpaceId,
          tenantMasterName: row.tenantMasterName,
          floorLabel: row.floorLabel,
          detailAreaLabel: row.detailAreaLabel,
          spaceLabel: [row.floorLabel, row.detailAreaLabel].filter(Boolean).join(' / ') || '-',
          currentEndDate: row.currentEndDate,
          monthsToExpiry: monthsBetweenIso_(monthKeyFromIso_(model.generatedAt) + '-01', row.currentEndDate),
          reviewStatus: row.calculatedReviewStatus,
        };
      }),
      rentVsMf: floorRows.map(function (row) {
        return {
          leaseSpaceId: row.leaseSpaceId,
          tenantMasterName: row.tenantMasterName,
          monthlyRentTotal: row.currentMonthlyRentTotal,
          monthlyMfTotal: row.currentMonthlyMfTotal,
          monthlyTotal: row.currentMonthlyCostTotal,
          rentPerPy: row.currentRentPerPy,
          mfPerPy: row.currentMfPerPy,
          leasedAreaPy: row.leasedAreaSqm != null ? roundNumber_(row.leasedAreaSqm * 0.3025, 2) : null,
          reviewStatus: row.calculatedReviewStatus,
        };
      }),
    },
    rows: floorRows,
  };

  return attachPayloadMeta_(payload, 'asset', model, rows, {
    selection: { assetId: summary.assetId, assetName: summary.assetName },
    basis: { rowScope: 'selected_asset_rows' },
    basisAsOf: uniqueValues_(rows.map(function (row) { return row.currentMoneyAsOf; }).filter(Boolean)).sort().slice(-1)[0] || model.generatedAt,
    basisSource: 'DB_GENERAL + DB_HISTORY + DB_ASSET',
    fetchedAt: summary.fetchedAt || '',
    fetchedAts: assetFetchedAts,
    extraMissingCounts: {
      assetMasterMissing: summary.grossFloorAreaSqm == null ? 1 : 0,
      missingCoordinates: summary.latitude == null || summary.longitude == null ? 1 : 0,
    },
  });
}

function buildCompanyPayload_(model, tenantId) {
  const summary = resolveSelectedSummary_(model.companySummaryById, tenantId, model.defaultTenantId);
  if (!summary) {
    return attachPayloadMeta_({ error: 'Company data is unavailable.' }, 'company', model, [], {
      selection: { tenantId: tenantId || '' },
      basis: { rowScope: 'selected_company_rows' },
    });
  }

  const rows = (model.generalRows || []).filter(function (row) {
    return row.tenantId === summary.tenantId;
  });
  const companyFetchedAt = summary.company ? summary.company.fetchedAt : '';
  const exposureByAsset = buildExposureDimensionRows_(rows, function (row) { return row.assetName; });
  const exposureBySector = buildExposureDimensionRows_(rows, function (row) { return row.sector; });
  const exposureByGoodsType = buildExposureDimensionRows_(rows, function (row) { return row.goodsType; });
  const exposureByRegion = buildExposureDimensionRows_(rows, function (row) {
    const address = row.asset ? (row.asset.standardizedAddress || row.asset.lookupAddress || row.asset.assetCode || '') : row.assetName;
    return deriveRegionFromAddress_(address);
  });

  const payload = {
    filters: {
      companies: getCompanyFilterOptionsForPayload_(model),
      selectedTenantId: summary.tenantId,
      selectorMeta: {
        sortOptions: [
          { key: 'tenant_name_asc', label: '기업명순' },
          { key: 'monthly_cost_desc', label: '월 임관리비 높은순' },
          { key: 'asset_count_desc', label: '임차 자산 수 많은순' },
          { key: 'latest_revenue_desc', label: '최근 매출 높은순' },
        ],
        defaultSort: 'tenant_name_asc',
      },
    },
    kpis: [
      { key: 'asset_count', label: '임차 자산 수', value: summary.assetCount, valueType: 'number', status: 'ok' },
      { key: 'leased_area', label: '총 임차면적', value: summary.leasedAreaSqm, valueType: 'area', status: summary.leasedAreaSqm == null ? 'review_required' : 'ok' },
      { key: 'monthly_rent_total', label: '월 임대료 총액', value: summary.monthlyRentTotal, valueType: 'currency', status: summary.monthlyRentTotal == null ? 'review_required' : 'ok' },
      { key: 'monthly_mf_total', label: '월 관리비 총액', value: summary.monthlyMfTotal, valueType: 'currency', status: summary.monthlyMfTotal == null ? 'review_required' : 'ok' },
      { key: 'monthly_total_cost', label: '월 임관리비 총액', value: summary.monthlyCostTotal, valueType: 'currency', status: summary.monthlyCostTotal == null ? 'review_required' : 'ok' },
      { key: 'latest_expiry', label: '최근 만기일', value: summary.latestExpiry, valueType: 'date', status: summary.latestExpiry ? 'ok' : 'review_required' },
    ],
    profile: summary,
    leasedAssets: summary.leasedAssets,
    financials: {
      revenue: summary.company ? summary.company.latestRevenue : null,
      operatingIncome: summary.company ? summary.company.latestOperatingIncome : null,
      debtRatio: summary.company ? summary.company.latestDebtRatio : null,
      employeeCount: summary.company ? summary.company.latestEmployeeCount : null,
      fetchedAt: summary.company ? summary.company.fetchedAt : '',
      dartLinked: !!(summary.company && summary.company.dartCorpCode),
      reviewNote: summary.company ? summary.company.reviewNote : '',
      emptyStateMessage: summary.company
        ? (summary.company.dartCorpCode
          ? (summary.company.reviewNote || 'OpenDART???곌껐?먯?留?怨듭떇 怨듭떆 ?묐떟??鍮꾩뼱 ?덉뒿?덈떎.')
          : 'OpenDART媛 ?꾩쭅 ?곌껐?섏? ?딆븯?듬땲??')
        : 'OpenDART媛 ?꾩쭅 ?곌껐?섏? ?딆븯?듬땲??',
    },
    mapPoints: uniqueValues_(rows.map(function (row) {
      return JSON.stringify({
        assetId: row.assetId,
        assetName: row.assetName,
        address: row.asset ? (row.asset.standardizedAddress || row.asset.lookupAddress || row.asset.assetCode || '') : '',
        latitude: row.asset ? row.asset.latitude : null,
        longitude: row.asset ? row.asset.longitude : null,
      });
    })).map(function (item) {
      return JSON.parse(item);
    }),
    operations: {
      goodsTypeMix: aggregateDimension_(rows, 'goodsType', 'leasedAreaSqm'),
      exposure: {
        toggleOptions: [
          { key: 'asset', label: '자산별' },
          { key: 'sector', label: '섹터별' },
          { key: 'goods_type', label: '취급상품별' },
          { key: 'region', label: '권역별' },
        ],
        byAsset: exposureByAsset,
        bySector: exposureBySector,
        byGoodsType: exposureByGoodsType,
        byRegion: exposureByRegion,
      },
      delinquency: rows.filter(function (row) {
        return row.isDelinquent;
      }).map(function (row) {
        return { assetName: row.assetName, leaseSpaceId: row.leaseSpaceId, reviewStatus: 'suspected_error' };
      }),
    },
    rows: rows,
  };

  return attachPayloadMeta_(payload, 'company', model, rows, {
    selection: { tenantId: summary.tenantId, tenantMasterName: summary.tenantMasterName },
    basis: { rowScope: 'selected_company_rows' },
    basisAsOf: companyFetchedAt || model.generatedAt,
    basisSource: 'DB_GENERAL + DB_COMPANY + OpenDART',
    fetchedAt: companyFetchedAt,
    fetchedAts: uniqueValues_([companyFetchedAt].filter(Boolean)),
    extraMissingCounts: {
      dartUnlinked: summary.company && summary.company.dartCorpCode ? 0 : 1,
    },
  });
}

function buildSectorPayload_(model) {
  const assetSummaries = getAssetSummaryList_(model);
  const companySummaries = getCompanySummaryList_(model);
  const activeRows = getActiveRows_(model);
  const contractSummary = buildContractSummary_(activeRows, model.generatedAt);
  const regionMap = {};
  assetSummaries.forEach(function (asset) {
    const region = deriveRegionFromAddress_(asset.standardizedAddress || asset.lookupAddress || asset.assetName);
    regionMap[region] = regionMap[region] || {
      region: region,
      label: region,
      assetCount: 0,
      leasedAreaSqm: 0,
      grossFloorAreaSqm: 0,
      vacancyAreaSqm: 0,
      monthlyCostTotal: 0,
    };
    regionMap[region].assetCount += 1;
    regionMap[region].leasedAreaSqm += Number(asset.leasedAreaSqm || 0);
    regionMap[region].grossFloorAreaSqm += Number(asset.grossFloorAreaSqm || 0);
    regionMap[region].vacancyAreaSqm += Number(asset.vacancyAreaSqm || 0);
    regionMap[region].monthlyCostTotal += Number(asset.monthlyCostTotal || 0);
  });
  const regionExposure = sortBy_(Object.keys(regionMap).map(function (key) {
    const row = regionMap[key];
    row.vacancyRate = row.grossFloorAreaSqm ? row.vacancyAreaSqm / row.grossFloorAreaSqm : null;
    return row;
  }), 'monthlyCostTotal', 'desc');

  const payload = {
    kpis: {
      regionCount: regionExposure.length,
      operatingAssetCount: assetSummaries.length,
      leasedAreaSqm: sumKnownMetric_(assetSummaries, 'leasedAreaSqm'),
      monthlyCostTotal: sumKnownMetric_(assetSummaries, 'monthlyCostTotal'),
      expiryWithin12Months: contractSummary.upcoming.filter(function (row) {
        return row.monthsToExpiry != null && row.monthsToExpiry <= 12;
      }).length,
    },
    regionExposure: regionExposure,
    rankings: {
      assetsByArea: sortBy_(assetSummaries, 'grossFloorAreaSqm', 'desc').slice(0, 10),
      assetsByRent: sortBy_(assetSummaries, 'monthlyCostTotal', 'desc').slice(0, 10),
      tenantsByArea: sortBy_(companySummaries, 'leasedAreaSqm', 'desc').slice(0, 10),
      tenantsByRent: sortBy_(companySummaries, 'monthlyCostTotal', 'desc').slice(0, 10),
    },
    trends: {
      monthlyRent: buildRentTrendRows_(model.historyRows),
      sectorMix: aggregateDimension_(activeRows, 'sector', 'currentMonthlyRentTotal'),
    },
    mapPoints: buildMapPointsFromAssets_(assetSummaries),
    expiryRows: contractSummary.upcoming,
    expiryBuckets: contractSummary.byBucket,
  };

  return attachPayloadMeta_(payload, 'sector', model, activeRows, {
    selection: { scope: 'portfolio' },
    basis: { rowScope: 'portfolio_summary_rows' },
  });
}

function buildToolsPayload_(model, request) {
  const normalized = normalizeToolsRequest_(request);
  const assetSummaries = getAssetSummaryList_(model);
  const companySummaries = getCompanySummaryList_(model);
  const selectedCompanies = normalized.companyIds.length
    ? normalized.companyIds
    : sortBy_(companySummaries, 'monthlyRentTotal', 'desc').slice(0, 3).map(function (row) { return row.tenantId; });
  const selectedAssets = normalized.assetIds.length
    ? normalized.assetIds
    : sortBy_(assetSummaries, 'monthlyRentTotal', 'desc').slice(0, 3).map(function (row) { return row.assetId; });

  const assets = selectedAssets.map(function (id) { return model.assetSummaryById[id]; }).filter(Boolean);
  const companies = selectedCompanies.map(function (id) { return model.companySummaryById[id]; }).filter(Boolean);
  const contracts = sortBy_((model.generalRows || []).filter(function (row) {
    return selectedCompanies.indexOf(row.tenantId) > -1 || selectedAssets.indexOf(row.assetId) > -1;
  }), 'currentMonthlyCostTotal', 'desc').slice(0, 60);

  const benchmarkRows = assets.map(function (asset) {
    return {
      assetId: asset.assetId,
      assetName: asset.assetName,
      region: deriveRegionFromAddress_(asset.standardizedAddress || asset.assetName),
      grossFloorAreaSqm: asset.grossFloorAreaSqm,
      leasedAreaSqm: asset.leasedAreaSqm,
      vacancyRate: asset.vacancyRate,
      monthlyRentTotal: asset.monthlyRentTotal,
      averageENoc: asset.averageENoc,
      reviewStatus: asset.reviewStatus,
    };
  });

  const rentValues = benchmarkRows.map(function (row) { return row.monthlyRentTotal; }).filter(function (value) { return value != null; });
  const vacancyValues = benchmarkRows.map(function (row) { return row.vacancyRate; }).filter(function (value) { return value != null; });
  const selectedAssetNames = assets.map(function (row) { return row.assetName; }).filter(Boolean);
  const selectedCompanyNames = companies.map(function (row) { return row.tenantMasterName; }).filter(Boolean);

  const payload = {
    assets: assets,
    companies: companies,
    contracts: contracts,
    divergence: {
      rentSpread: rentValues.length ? Math.max.apply(null, rentValues) - Math.min.apply(null, rentValues) : null,
      vacancySpread: vacancyValues.length ? Math.max.apply(null, vacancyValues) - Math.min.apply(null, vacancyValues) : null,
      comparedAssetCount: assets.length,
      comparedCompanyCount: companies.length,
    },
    selectionMeta: {
      isDefaultSelection: !normalized.assetIds.length && !normalized.companyIds.length,
      reason: !normalized.assetIds.length && !normalized.companyIds.length ? 'default_top3_by_rent' : 'user_selection',
      assetLabels: selectedAssetNames,
      companyLabels: selectedCompanyNames,
      summaryLabel: (selectedAssetNames.concat(selectedCompanyNames)).slice(0, 6).join(', '),
    },
    deltas: {
      monthlyRentMin: rentValues.length ? Math.min.apply(null, rentValues) : null,
      monthlyRentMax: rentValues.length ? Math.max.apply(null, rentValues) : null,
      vacancyMin: vacancyValues.length ? Math.min.apply(null, vacancyValues) : null,
      vacancyMax: vacancyValues.length ? Math.max.apply(null, vacancyValues) : null,
    },
    benchmarkRows: benchmarkRows,
    reviewHighlights: contracts.filter(function (row) { return row.calculatedReviewStatus !== 'ok'; }).slice(0, 12),
    filters: {
      availableCompanies: companySummaries.map(function (row) {
        return { tenantId: row.tenantId, tenantMasterName: row.tenantMasterName };
      }),
      availableAssets: assetSummaries.map(function (row) {
        return { assetId: row.assetId, assetName: row.assetName };
      }),
    },
  };

  return attachPayloadMeta_(payload, 'tools', model, contracts, {
    selection: {
      assetIds: selectedAssets,
      companyIds: selectedCompanies,
      cacheKey: buildKeyedPayloadKey_('tools', normalized),
    },
    basis: { rowScope: 'selected_entity_rows' },
  });
}

function buildPlaygroundPayload_(model, request) {
  const normalized = normalizePlaygroundRequest_(request);
  const dimensions = [
    { key: 'assetName', label: '자산' },
    { key: 'fundName', label: '펀드' },
    { key: 'tenantMasterName', label: '임차인' },
    { key: 'sector', label: '섹터' },
    { key: 'goodsType', label: '물류 유형' },
    { key: 'coldStorageType', label: '저온 유형' },
    { key: 'calculatedReviewStatus', label: '검토 상태' },
  ];
  const metrics = [
    { key: 'leasedAreaSqm', label: '임대면적' },
    { key: 'currentMonthlyRentTotal', label: '월 임대료' },
    { key: 'currentMonthlyMfTotal', label: '월 관리비' },
    { key: 'monthlyCostTotal', label: '월 임관리비' },
    { key: 'eNoc', label: '평균 E.NOC' },
    { key: 'count', label: '건수' },
  ];
  const allowedDimensions = dimensions.map(function (row) { return row.key; });
  const allowedMetrics = metrics.map(function (row) { return row.key; });
  const rowDimension = allowedDimensions.indexOf(normalized.rowDimension) > -1 ? normalized.rowDimension : 'assetName';
  const columnDimension = allowedDimensions.indexOf(normalized.columnDimension) > -1 ? normalized.columnDimension : 'none';
  const valueMetric = allowedMetrics.indexOf(normalized.valueMetric) > -1 ? normalized.valueMetric : 'leasedAreaSqm';
  const filterDimension = allowedDimensions.indexOf(normalized.filterDimension) > -1 ? normalized.filterDimension : '';
  const filterValue = normalized.filterValue || '';
  const allRows = model.generalRows || [];
  const sourceRows = filterDimension && filterValue
    ? allRows.filter(function (row) { return safeString_(defaultValue_(row[filterDimension], 'Unclassified')) === filterValue; })
    : allRows.slice();

  function aggregatePlaygroundMetric_(bucket) {
    let value = null;
    if (valueMetric === 'count') {
      value = bucket.length;
    } else if (valueMetric === 'eNoc') {
      value = averageBy_(bucket.filter(function (row) { return row.eNoc != null; }), 'eNoc');
    } else if (valueMetric === 'monthlyCostTotal') {
      value = sumKnownMetric_(bucket, 'currentMonthlyCostTotal');
    } else {
      value = sumKnownMetric_(bucket, valueMetric);
    }
    return value;
  }

  function buildReviewStatus_(bucket) {
    return bucket.some(function (row) { return row.calculatedReviewStatus === 'suspected_error'; })
      ? 'suspected_error'
      : bucket.some(function (row) { return row.calculatedReviewStatus !== 'ok'; }) ? 'review_required' : 'ok';
  }

  function buildFilterOptions_(dimensionKey) {
    const grouped = {};
    allRows.forEach(function (row) {
      const key = safeString_(defaultValue_(row[dimensionKey], 'Unclassified'));
      grouped[key] = (grouped[key] || 0) + 1;
    });
    return sortBy_(Object.keys(grouped).map(function (key) {
      return { value: key, label: key, count: grouped[key] };
    }), 'count', 'desc').slice(0, 60);
  }

  const grouped = {};
  sourceRows.forEach(function (row) {
    const key = safeString_(defaultValue_(row[rowDimension], 'Unclassified'));
    grouped[key] = grouped[key] || [];
    grouped[key].push(row);
  });

  const availableColumns = columnDimension === 'none'
    ? []
    : sortBy_(uniqueValues_(sourceRows.map(function (row) {
      return safeString_(defaultValue_(row[columnDimension], 'Unclassified'));
    })).map(function (key) {
      return {
        key: key,
        label: key,
        count: sourceRows.filter(function (row) {
          return safeString_(defaultValue_(row[columnDimension], 'Unclassified')) === key;
        }).length,
      };
    }), 'count', 'desc').slice(0, 12);

  const rows = sortBy_(Object.keys(grouped).map(function (key) {
    const bucket = grouped[key];
    const columns = {};
    availableColumns.forEach(function (column) {
      const columnBucket = bucket.filter(function (row) {
        return safeString_(defaultValue_(row[columnDimension], 'Unclassified')) === column.key;
      });
      columns[column.key] = {
        value: columnBucket.length ? aggregatePlaygroundMetric_(columnBucket) : null,
        recordCount: columnBucket.length,
      };
    });

    return {
      dimension: key,
      value: aggregatePlaygroundMetric_(bucket),
      recordCount: bucket.length,
      columns: columns,
      reviewStatus: buildReviewStatus_(bucket),
    };
  }), 'value', 'desc').slice(0, normalized.topN);

  const payload = {
    query: {
      dimension: rowDimension,
      metric: valueMetric,
      rowDimension: rowDimension,
      columnDimension: columnDimension,
      valueMetric: valueMetric,
      filterDimension: filterDimension,
      filterValue: filterValue,
      topN: normalized.topN,
    },
    dimensions: dimensions,
    metrics: metrics,
    columnOptions: [{ key: 'none', label: '사용 안 함' }].concat(dimensions),
    filterOptions: dimensions.map(function (dimension) {
      return {
        key: dimension.key,
        label: dimension.label,
        values: buildFilterOptions_(dimension.key),
      };
    }),
    activeColumns: availableColumns.map(function (row) {
      return { key: row.key, label: row.label, recordCount: row.count };
    }),
    savedViews: [
      { key: 'asset_rent', label: '자산별 월 임대료', dimension: 'assetName', rowDimension: 'assetName', columnDimension: 'none', metric: 'currentMonthlyRentTotal', valueMetric: 'currentMonthlyRentTotal', topN: 20 },
      { key: 'tenant_area', label: '임차인별 임대면적', dimension: 'tenantMasterName', rowDimension: 'tenantMasterName', columnDimension: 'none', metric: 'leasedAreaSqm', valueMetric: 'leasedAreaSqm', topN: 20 },
      { key: 'sector_cost', label: '섹터별 월 임관리비', dimension: 'sector', rowDimension: 'sector', columnDimension: 'goodsType', metric: 'monthlyCostTotal', valueMetric: 'monthlyCostTotal', topN: 15 },
    ],
    summaryCards: [
      { label: '원천 행', value: allRows.length, valueType: 'number' },
      { label: '필터 후 행', value: sourceRows.length, valueType: 'number' },
      { label: '결과 그룹', value: rows.length, valueType: 'number' },
      { label: '컬럼 수', value: availableColumns.length || 1, valueType: 'number' },
    ],
    rows: rows,
  };

  return attachPayloadMeta_(payload, 'playground', model, sourceRows, {
    selection: {
      dimension: rowDimension,
      metric: valueMetric,
      rowDimension: rowDimension,
      columnDimension: columnDimension,
      valueMetric: valueMetric,
      filterDimension: filterDimension,
      filterValue: filterValue,
      topN: normalized.topN,
      cacheKey: buildKeyedPayloadKey_('playground', normalized),
    },
    basis: { rowScope: 'playground_query_rows' },
  });
}

function deriveRegionFromAddress_(text) {
  const source = String(text || '').toLowerCase();
  if (source.indexOf('gyeonggi') > -1 || source.indexOf('\uacbd\uae30') > -1) return 'Gyeonggi';
  if (source.indexOf('incheon') > -1 || source.indexOf('\uc778\ucc9c') > -1) return 'Incheon';
  if (source.indexOf('seoul') > -1 || source.indexOf('\uc11c\uc6b8') > -1) return 'Seoul';
  if (source.indexOf('busan') > -1 || source.indexOf('\ubd80\uc0b0') > -1) return 'Busan';
  if (source.indexOf('gyeongsang') > -1 || source.indexOf('\uacbd\uc0c1') > -1) return 'Gyeongsang';
  if (source.indexOf('chungcheong') > -1 || source.indexOf('\ucda9\uccad') > -1) return 'Chungcheong';
  if (source.indexOf('jeolla') > -1 || source.indexOf('\uc804\ub77c') > -1) return 'Jeolla';
  return 'Other';
}
