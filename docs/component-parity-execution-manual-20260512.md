# 물류 임대차 워크 플랫폼 컴포넌트 1:1 복원 실행 매뉴얼

생성일: 2026-05-12 KST

이 문서는 현재 `docs/` GitHub Pages 화면을 성공본으로 보지 않고, 기존 정상 Apps Script 대시보드와 1:1로 맞추기 위한 작업 통제표입니다. 숫자, 계산 의미, 업무 구성은 바꾸지 않고 화면 구조와 상호작용만 복원합니다.

## 1. 고정 기준

| 구분 | 기준 |
|---|---|
| 기능 기준 | Apps Script 정상 User URL, `Client.html`, `Index.html`, `Stylesheet.html`, `Server.gs`, `Metrics.gs`, `RuntimeServices.gs` |
| 구현 대상 | 현재 repo의 `docs/` GitHub Pages 정적 앱 |
| 현재 `docs/` 상태 | 실패/부분 산출물 보존본. 최종본 아님 |
| DB 대상 | Supabase `public.ll_*`만 수정 가능 |
| 금지 | non-`ll_*` 수정, 삭제, RLS 변경, service role/API key 프론트 노출 |
| User/Admin 구조 | 하나의 앱에서 로그인/권한으로 분기 |
| 체크포인트 | `checkpoint/logi-before-component-parity-20260512-1150-KST` |

## 2. 현재 페이지와 검증 링크

| 항목 | 값 |
|---|---|
| GitHub Pages | `https://kylee94.github.io/logi_leasing_db/?page=user` |
| 로컬 QA 산출물 | `qa-artifacts/parity-smoke/2026-05-12T03-53-34-524Z` |
| 최근 로컬 QA | 탭 8개, 상세 drawer 열림, 콘솔 오류 0건, HTTP 오류 0건, `[object Object]`/`undefined`/`NaN` 0건 |

주의: 이 QA는 "기본 렌더링과 클릭 가능성" 확인입니다. 원본과 값/팝업/차트/지도 모양이 완전히 같은지 확인한 것은 아닙니다.

## 3. Supabase readback

| 테이블 | row count | 상태 |
|---|---:|---|
| `ll_assets` | 17 | 적재됨 |
| `ll_tenants` | 36 | 적재됨 |
| `ll_leases` | 45 | 적재됨 |
| `ll_lease_spaces` | 59 | 적재됨 |
| `ll_rent_history` | 163 | 6건 관계 매칭 검토 필요 |
| `ll_asset_managers` | 17 | 적재됨 |
| `ll_issues` | 42 | 적재됨 |
| `ll_sheet_rows` | 347 | live Sheets 5개 탭 row-level만 보존 |
| `ll_source_cells` | 13,752 | xlsx cell-by-cell 보존 완료 |
| `ll_payload_snapshots` | 107 | 전부 `supabase_snapshot`, `user_safe=true` |
| `ll_data_quality_findings` | 44 | 품질 이슈 기록 있음 |

## 4. 원본 보존 상태

| 원본 | 현재 상태 | 다음 조치 |
|---|---|---|
| xlsx | 5개 시트, 13,752 cells, non-empty 8,627, formula 941이 `ll_source_cells`와 일치 | 보존 완료 기준으로 잠금 |
| live Google Sheets | 17개 탭 metadata 확인. `ll_sheet_rows`는 5개 탭 347 rows만 있음 | 17개 탭 cell-level 적재 경로 확보 필요 |
| snapshot | `ll_payload_snapshots` 107 rows가 화면 source | 화면 값 비교 시 이 snapshot 기준으로 확인 |

## 5. 탭별 복원 체크리스트

| 탭 | 원본 기준 함수 | 현재 구현 상태 | 미복원 핵심 | 다음 구현 배치 |
|---|---|---|---|---|
| Weekly | `renderWeeklyReport`, `openWeekly*Modal_`, `adminUpdateWeeklyReportItem` | KPI, 신규/관리 Projects, 자산현황, 기준/기타사항, 상세 drawer 존재 | 전용 edit modal 저장, 만기/이슈 전용 modal, 자산 상세 패널 | 원본 selector/id 복구, edit request를 권한 기반 서버 API 후보로 분리 |
| Home | `renderHome`, `openMetricModal_`, `openPortfolioMapModal_` | KPI, 임차인 표, 공실 표, 임대료 추이, 지도 패널 존재 | Chart.js 수준 차트, 지도 SDK/fallback modal, KPI별 원본 근거 modal | 지도 modal shell, chart panel shell, KPI 근거 modal 정리 |
| Asset | `renderAsset`, `getAssetData`, `getAssetOptions` | selector, KPI, 임차인 표, 면적/만기/이슈 섹션 존재 | 자산 지도 modal, 층별 배치 시각 구조, E.NOC 상세 동일성 | 자산 상세 패널과 임차인 패널 분기 |
| Company | `renderCompany`, `getCompanyData`, `getCompanyOptions` | selector, KPI, 임차 자산, 노출도, DART 요청 drawer 존재 | DART/재무 실제 서버 전용 호출, 지도 modal, 노출 차트 클릭 | company 패널과 DART 서버 API 후보 분리 |
| Sector | `renderSector`, `getSectorData` | KPI, 권역/랭킹/만기/추이 섹션 존재 | Chart.js 축/값 동일성, 권역/만기 팝업 원본 표 비교 | 차트/표 value parity QA |
| Analysis Tools | `renderTools`, `getToolsData` | select, 적용/초기화, 비교 표, 벤치마크 존재 | 고급 필터, quick select, checkbox 기반 비교 조건, 재집계 흐름 | 고급 조건 UI 복구 |
| Data Playground | `renderPlayground`, `getPlaygroundData` | dimension/filter/topN, 결과 표/차트/원본 행 존재 | mode 전환, 저장 view, metric library 원본 동일성 | 저장 view와 metric library 복구 |
| Data Quality | `renderDataQuality`, `adminGetQualityIssueCell`, `adminUpdateQualityIssueCell` | 품질 KPI, 파일/규칙/이슈 표, 수정 대기 drawer 존재 | 셀 단위 조회/수정/저장, 수정 사유, readback | 셀 편집 modal과 ll_* 쓰기 API 설계 |
| Admin | `renderAdmin`, `data-admin-action`, admin server functions | 로그인 후 미리보기, admin action 버튼, Admin Data 존재 | OpenDART/건축물대장/snapshot/cache 실행, 감사 로그 상세 | Edge Function 또는 서버 전용 API 연결 |

## 6. 현재 반영한 구조 보강

| 항목 | 반영 내용 |
|---|---|
| Weekly legacy selector | `신규 투자 Projects`, `관리 Projects`, `자산현황`, `기준 및 기타사항` 섹션에 원본 QA용 id/class hook 추가 |
| 표 selector | `renderInteractiveTable`, `renderTable`에 `id`, `data-table-scope`, `data-testid` 추가 |
| 버튼 selector | `data-action` 버튼에 `data-testid=action-*` 자동 추가 |
| Home surface 분기 | `home-map-detail`은 `map-modal`, `home-rent-detail`은 `chart-modal`, `home-kpi-assets`는 `metric-modal`로 열리도록 분리 |
| Home row/marker 분기 | 주요 임차인 표 행은 `tenant-panel`, 공실 표 행은 `asset-panel`, 지도 마커는 `map-modal`로 열리도록 QA에 고정 |
| 데이터 변경 | 없음 |
| 숫자/계산 변경 | 없음 |

## 7. 차단 조건

- 탭별 컴포넌트가 "비슷한 카드"로만 있으면 미복원입니다.
- 공통 drawer 하나로 모든 팝업을 대체한 상태는 1:1 복원이 아닙니다.
- 정적 CSS bar는 Chart.js 또는 원본 차트 상호작용과 같다고 보지 않습니다.
- 정적 marker panel은 원본 지도 SDK/fallback modal과 같다고 보지 않습니다.
- Admin 버튼이 "연결 대기"만 보여주면 기능 복원 완료가 아닙니다.
- live Google Sheets 17개 탭 cell-level 보존 전에는 원본 보존 완료가 아닙니다.
- `ll_rent_history` 관계 null 6건은 원인 분류 전까지 미해결입니다.

## 8. 다음 순서

1. Weekly: edit/modal 상세 분리와 저장 API 후보 연결.
2. Home: 지도 SDK/fallback 실제 구현, chart surface를 Chart.js 또는 동등한 canvas로 승격.
3. Asset/Company: 자산·임차인 상세 패널 분기와 지도/차트 surface 복원.
4. Tools/Playground/Quality: 원본 고급 컨트롤과 수정 후보 UI 복원.
5. Supabase: live Sheets cell-level 추출 경로 확보 후 `source_type='live_google_sheets'` 추가 적재.
6. API: OpenDART/건축물대장은 프론트 직접 호출 금지, 서버 전용 Edge Function으로만 연결.
7. QA: local smoke, live Pages, selector parity, value parity, secret scan을 분리해서 실행.
