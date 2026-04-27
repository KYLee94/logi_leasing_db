function getIntegrationStatus() {
  const model = loadOperationalModel_();
  return getIntegrationStatusFromModel_(model);
}

function previewOpenDartBacklog() {
  const model = loadOperationalModel_();
  return sortBy_(model.companyRows.filter(function (company) {
    return !company.dartCorpCode;
  }), 'tenantMasterName').map(function (company) {
    return {
      tenantId: company.tenantId,
      tenantMasterName: company.tenantMasterName,
      businessRegistrationNo: company.businessRegistrationNo,
      matchStatus: company.matchStatus,
      reviewStatus: company.reviewStatus,
    };
  });
}

function previewBuildingHubBacklog() {
  const model = loadOperationalModel_();
  return sortBy_(model.assetRows.filter(function (asset) {
    return !asset.sigunguCd || !asset.bjdongCd || !asset.standardizedAddress;
  }), 'assetName').map(function (asset) {
    return {
      assetId: asset.assetId,
      assetName: asset.assetName,
      assetCode: asset.assetCode,
      standardizedAddress: asset.standardizedAddress,
      reviewStatus: asset.reviewStatus,
    };
  });
}
