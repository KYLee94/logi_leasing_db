# 물류 임대차 대시보드 구현 통제표

작성일: 2026-05-11

이 문서는 현재 구현 기준을 흔들리지 않게 고정하기 위한 작업표입니다. 구현 대상은 이 repo의 `docs/` GitHub Pages 정적 사이트이며, `IGIS-Fund-Production-DP`는 UI/UX 참고용일 뿐 구현 대상이 아닙니다.

## 1. 기능 보존 매트릭스

| 탭 | 보존 대상 | 현재 구현 위치 | 클릭/상세 QA | 남은 서버성 작업 |
|---|---|---|---|---|
| Weekly | KPI, 신규 투자 Projects, 관리 Projects, 자산현황, 기준 및 기타사항 | `docs/assets/app.js` `renderWeekly` | KPI, 표 행, core/full 토글, drawer 확인 | Admin 편집 저장 |
| Home | KPI, 임대/공실 요약, 주요 임차인, 임대료 추이, 지도 | `renderHome` | KPI, 표 행, chart, map marker 확인 | 실제 지도 SDK 전환 여부 결정 |
| Asset | 자산 선택, KPI, 임차인 현황, 층별 배치, 면적 구성 | `renderAsset` | select, KPI, 표 행, chart 확인 | 원본 서버 modal 실시간 조회 대체 |
| Company | 기업 선택, KPI, 임차 자산, 계약 행, DART/재무, 자산 지도 | `renderCompany` | select, KPI, 표 행, map marker 확인 | OpenDART 서버 호출 |
| Sector | 지역 노출, 만기 구간, 만기 상세, 랭킹, 추이 | `renderSector` | KPI, 표 행, chart 확인 | 서버 재집계 |
| Analysis Tools | 선택 조건, 자산/기업 비교, 계약 원장, benchmark | `renderTools` | 검색, 표 행, chart 확인 | 체크박스 기반 재계산 |
| Data Playground | 질의 조건, 저장된 보기, 집계 결과, 원본 행 | `renderPlayground` | 검색, 표 행, chart 확인 | 질의 builder 재계산 |
| Data Quality | snapshot files, loaded payloads, rules | `renderQuality` | KPI, 표 행 확인 | Admin 직접 수정 |
| Admin/Admin Data | 인증 gate 후 read-only runtime/cache/data 상태 | `renderAdmin`, `renderAdminData` | 인증 전 관리 DOM 미노출 확인 | sync/snapshot/cache write API |

## 2. 데이터 매핑표

| 원본/산출물 | Supabase 대상 | 화면 사용 |
|---|---|---|
| live Google Sheets 전체 원본 행 | `ll_sheet_rows` 347건 | 원본 보존, 재적재 검증 |
| 자산 기준 정보 | `ll_assets` 17건 | Asset/Home/Company 지도 좌표 보강 |
| 임차인 기준 정보 | `ll_tenants` 36건 | Company 선택/프로필 |
| 임대차 계약 | `ll_leases` 45건 | Asset/Company 계약 행 |
| 임대 구역 | `ll_lease_spaces` 59건 | 면적/임대료/층별 구성 |
| 임대료 이력 | `ll_rent_history` 163건 | rent trend, E.NOC 관련 지표 |
| 자산 담당자 | `ll_asset_managers` 17건 | Asset/Issue 상세 |
| 이슈 | `ll_issues` 42건 | Weekly/Home/Asset 주요 이슈 |
| 화면 payload snapshot | `ll_payload_snapshots` 107건 | GitHub Pages 주 데이터 source |
| GitHub JSON | `docs/data/*.json` | Supabase 실패 시 fallback |

## 3. 권한 매트릭스

| 권한 | 메뉴 노출 | 읽기 | 쓰기/수정/삭제 | 현재 상태 |
|---|---|---|---|---|
| User | Weekly, Home, Asset, Company, Sector, Analysis Tools, Data Playground, Data Quality | 가능 | 불가 | Admin nav 제거, edit/delete 버튼 미노출 |
| Admin preview | 인증 gate 통과 후 Admin/Admin Data 표시 | 가능 | 불가 | 현재는 정적 read-only preview |
| 운영 Admin | 향후 로그인/권한 연동 후 노출 | 가능 | 서버 API를 통해서만 가능 | 미구현 |
| 종합 관리 | 향후 별도 권한 필요 | 가능 | sync/snapshot/cache/API 호출 | 미구현 |

## 4. QA 체크표

| QA 항목 | 최신 증거 |
|---|---|
| GitHub Pages 전체 탭 캡처 | `qa-artifacts/github-pages-static/2026-05-11T10-05-23-865Z` |
| Live deep interaction | `qa-artifacts/github-pages-deep-interactions/2026-05-11T10-06-20-823Z` |
| Local deep interaction | `qa-artifacts/github-pages-deep-interactions/2026-05-11T10-01-18-636Z` |
| Admin 사전 인증 | `qa-artifacts/admin-preauth/2026-05-11T10-07-42-601Z` |
| Data contract | `qa-artifacts/data-contract/2026-05-11T10-02-50-811Z` |
| UX storyline | `qa-artifacts/ux-storyline/2026-05-11T10-02-51-124Z` |
| Supabase readback | `ll_payload_snapshots=107`, temp RLS policy 0건 |
| 보안 scan | 공개 `docs/`에서 service role/API key/load token marker 0건 |

## 5. 현재 남은 작업

- OpenDART, 건축물대장, snapshot refresh, cache clear는 공개 프론트가 아니라 서버 전용 API로 분리해야 합니다.
- Admin write/sync/cache는 아직 read-only preview입니다.
- 지도는 현재 정적 marker panel이며, 실제 지도 SDK로 전환할지는 별도 결정이 필요합니다.
