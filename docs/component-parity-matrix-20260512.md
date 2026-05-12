# 기준 대시보드 컴포넌트 보존 매트릭스

생성일: 2026-05-12T02:19:44.401Z

이 문서는 기존 정상 Apps Script 코드에서 자동 추출한 1:1 복원 기준입니다. UI 구현은 이 표의 누락 항목을 0건으로 만드는 방식으로 진행합니다.

| 탭 | 기존 섹션 후보 | 기존 표/행 클릭 후보 | 기존 차트 후보 | 기존 지도 후보 | 기존 팝업/상세 후보 | 기존 액션/버튼 후보 | 서버 함수 | 추출 누락 함수 |
|---|---|---|---|---|---|---|---|---|
| 주간 업무 | `신규 투자 Projects`<br>`관리 Projects`<br>`자산현황`<br>`기준 및 기타사항` | `weekly-summary-assets`<br>`weekly-summary-area`<br>`weekly-maturity-detail-table`<br>`weekly-maturity-all-table`<br>`weekly-issue-detail-table`<br>`weekly-assets-table` | - | - | `총 자산 수 상세`<br>`총 연면적 상세`<br>`만기 캘린더 전체 상세`<br>`주간 업무 리포트 수정` | `assetRows`<br>`assetName`<br>`mainIssue` | `getWeeklyReportData`<br>`adminUpdateWeeklyReportItem` | 없음 |
| Home | `포트폴리오 위치`<br>`관리자 검토 포인트`<br>`포트폴리오 스냅샷`<br>`임대료 추이`<br>`공실 요약`<br>`만기 집중도`<br>`상위 임차인`<br>`주요 임차인 계약 요약` | `home-vacancy-table`<br>`home-tenant-table`<br>`home-contract-table` | `home-rent-chart`<br>`home-expiry-chart` | `openPortfolioMapModal_`<br>`renderPortfolioMapPreview_` | `운영 자산 목록`<br>`총 임대면적 근거`<br>`총 공실면적 근거`<br>`공실률 계산 근거`<br>`월 임관리비 총액 근거`<br>`임대료 추이 원본 표`<br>`좌표 보유 자산 목록`<br>`만기 집중도 상세`<br>`운영 자산 수 근거`<br>`현재 공실률 근거`<br>외 2건 | `home-kpi-assets`<br>`home-kpi-leased`<br>`home-kpi-vacancy-area`<br>`home-kpi-vacancy-rate`<br>`home-kpi-total-cost`<br>`home-rent-detail`<br>`home-map-detail`<br>`home-map-list`<br>`home-expiry-detail`<br>`home-snapshot-assets`<br>`home-snapshot-vacancy`<br>`home-snapshot-tenants`<br>외 4건 | `getHomeData` | 없음 |
| Asset | `임차인 현황`<br>`자산 핵심 요약`<br>`임차인별 월 임관리비`<br>`검토 필요 이슈`<br>`층별 배치`<br>`면적 구성`<br>`만기 스냅샷`<br>`핵심 임차인` | `asset-roster-table` | `asset-rent-chart`<br>`asset-expiry-chart` | `openPortfolioMapModal_`<br>`renderPortfolioMapPreview_` | `E.NOC 검산 결과`<br>`자산 위치 정보`<br>`임차인 현황`<br>`만기 스냅샷`<br>`임차인별 월 임관리비` | `asset-roster-detail`<br>`asset-expiry-detail`<br>`asset-map-detail` | `getAssetData`<br>`getAssetOptions` | 없음 |
| Company | `임차 자산 현황`<br>`회사별 임차 자산 지도`<br>`자산별 노출도`<br>`DART 상세 정보` | `company-assets-table` | `company-exposure-chart` | `renderPortfolioMapPreview_`<br>`openPortfolioMapModal_` | `임차 자산 수`<br>`자산별 노출도` | `company-exposure-detail`<br>`company-map-detail`<br>`company`<br>`cost`<br>`area` | `getCompanyData`<br>`getCompanyOptions` | 없음 |
| Sector | `권역·자산·임차인 리스크 비교`<br>`권역별 노출도`<br>`월 임관리비 추이`<br>`자산 랭킹`<br>`임차인 랭킹`<br>`Top 자산`<br>`Top 임차인`<br>`만기 집중도` | `sector-assets-table`<br>`sector-tenants-table` | `sector-region-chart`<br>`sector-rent-chart` | - | `권역별 노출도 원본 표`<br>`12개월 내 만기 상세`<br>`월 임관리비 추이 원본 표` | `sector-region-detail`<br>`sector-expiry` | `getSectorData` | 없음 |
| Analysis Tools | `자산·기업 비교 분석`<br>`비교 대상 선택`<br>`벤치마크 차트`<br>`비교 매트릭스`<br>`계약 원장`<br>`선택 요약`<br>`자산·기업 비교 도구`<br>`비교 벤치마크`<br>`주요 비교 신호`<br>`비교 인벤토리`<br>외 4건 | `tools-matrix-table`<br>`tools-ledger-table` | `tools-benchmark-chart` | - | `벤치마크 원본 표`<br>`비교 벤치마크 원본 표`<br>`비교 벤치마크` | `tools-benchmark-detail`<br>`assets`<br>`companies` | `getToolsData` | 없음 |
| Data Playground | `데이터 분석`<br>`조회 조건`<br>`현재 조회 조건`<br>`결과 차트`<br>`결과 표`<br>`저장된 분석 View`<br>`상위 결과`<br>`Metric Library`<br>`분석 기준 목록`<br>`조회 조건 설정`<br>외 4건 | `playground-results-table` | `playground-chart` | - | `데이터 분석 원본 표`<br>`데이터 분석 차트 원본` | `playground-detail` | `getPlaygroundData` | 없음 |
| Data Quality | `데이터 품질 점검`<br>`시트별 오류 요약`<br>`필드별 반복 오류`<br>`Critical 우선 조치`<br>`전체 검증 결과`<br>`원천 시트 바로 수정` | - | - | - | `데이터 품질 상세`<br>`Critical 오류`<br>`Warning 항목`<br>`Info 항목`<br>`시트별 오류 요약` | `quality-critical`<br>`quality-warning`<br>`quality-info`<br>`quality-sheets`<br>`quality-refresh`<br>`true` | `getDataQualityData`<br>`adminUpdateQualityIssueCell` | 없음 |
| Admin | `관리자 액션`<br>`OpenDART 미연결`<br>`건축물대장 미연결`<br>`AUDIT_데이터이상`<br>`Admin Command Center`<br>`AUDIT 데이터`<br>`운영 메모`<br>`우선 확인 순서`<br>`성능 로그` | - | - | - | `관리자 실행 오류`<br>`클라이언트 성능 로그` | `admin-perf-log`<br>`adminRefreshCalculationSheet`<br>`adminSyncOpenDartData`<br>`adminSyncBuildingRegisterData`<br>`adminRunDataAudit`<br>`adminRunUiDataReconciliation`<br>`adminInstallOrUpdateTriggers`<br>`adminRefreshDashboardSnapshot` | `adminRefreshCalculationSheet`<br>`adminSyncOpenDartData`<br>`adminSyncBuildingRegisterData`<br>`adminRunDataAudit`<br>`adminRunUiDataReconciliation`<br>`adminRefreshDashboardSnapshot` | 없음 |

## 차단 조건

- 이 문서에서 누락으로 잡힌 항목은 "비슷한 UI"로 대체하지 않습니다.
- 탭별 컴포넌트, 클릭 동작, 팝업 내용, 숫자/표 헤더가 기존 기준과 맞기 전에는 해당 탭 완료로 보지 않습니다.
- Admin 기능은 기존 Apps Script 화면을 그대로 공개하지 않고, 통합 로그인/권한 구조로 이식합니다.
