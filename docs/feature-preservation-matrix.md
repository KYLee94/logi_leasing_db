# 기능 보존 매트릭스

작성일: 2026-05-11

대상 구현은 이 repo의 `docs/` GitHub Pages 정적 사이트입니다. `IGIS-Fund-Production-DP`는 UI/UX 참고용이며 구현 대상이 아닙니다.

## 탭별 보존 기준

| 탭 | 기존 원본 기준 주요 컴포넌트 | 현재 `docs/` 이식 위치 | 클릭/상세 복구 상태 | 남은 서버성 기능 |
|---|---|---|---|---|
| Weekly | KPI, 신규 투자 Projects, 관리 Projects, 자산현황, 기준 및 기타사항 | `renderWeekly` | KPI, 표 행, core/full 토글, drawer 상세 | Admin 편집 저장 |
| Home | KPI, 임대/공실 요약, Top tenants, rent trend, 지도 | `renderHome` | KPI, 주요 표, rent trend bar, 지도 marker, drawer 상세 | 실제 지도 SDK 연동 |
| Asset | 자산 선택, KPI, 임차인 현황, 층별 배치, 면적 구성 | `renderAsset` | 자산 select, KPI, 임차인/층별 표, bar chart, drawer 상세 | 원본 서버 modal의 실시간 조회 |
| Company | 기업 선택, KPI, 임차 자산, DART/재무, 자산 지도 | `renderCompany` | 기업 select, KPI, 임차 자산/계약 표, 지도 marker, drawer 상세 | OpenDART 서버 호출 |
| Sector | 지역 노출, 만기, 랭킹, 추이 | `renderSector` | KPI, 지역/만기/랭킹 표, chart, drawer 상세 | 서버 재집계 |
| Analysis Tools | 선택 조건, 자산/기업 비교, 계약 원장, benchmark | `renderTools` | 검색, 표 행 상세, benchmark chart | 체크박스 기반 재계산 |
| Data Playground | 질의 조건, saved views, 집계 결과, 원본 행 | `renderPlayground` | saved view/결과/원본 행 상세, 검색, chart | 질의 builder 재계산 |
| Data Quality | snapshot files, loaded payloads, rules | `renderQuality` | KPI, 파일/로드 상태 상세 | Admin 셀 직접 수정 |
| Admin | 인증 후 runtime, available data | `renderAdmin` | 인증 gate 후 read-only 상세 | sync/snapshot/cache 실행 |
| Admin Data | 정적 보강 탭 | `renderAdminData` | 파일/cache 상세 | 서버 API write |

## Supabase `ll_*` Migration Preview

로컬 preview 산출물:

- Dataset: `qa-artifacts/supabase/ll-minimal-dataset-google-sheets.json`
- SQL chunks: `qa-artifacts/supabase/minimal-sql-chunks/*.sql`

대상 테이블과 preview row 수:

| 테이블 | row 수 |
|---|---:|
| `ll_import_runs` | 1 |
| `ll_sheet_rows` | 347 |
| `ll_assets` | 17 |
| `ll_tenants` | 36 |
| `ll_leases` | 45 |
| `ll_lease_spaces` | 59 |
| `ll_rent_history` | 163 |
| `ll_asset_managers` | 17 |
| `ll_issues` | 42 |
| `ll_payload_snapshots` | 53 |

검증 결과:

- `check-ll-minimal-dataset`: failure 0건
- `check-sql-ll-only`: 36개 SQL chunk 전부 통과
- non-`ll_*` mutation: 0건
- DB write: 사용자 승인 후 `ll_*`에 한정해 실행 완료
- DB readback: `ll_lease_spaces`, `ll_rent_history`, `ll_payload_snapshots`는 중복 primary/conflict key가 upsert에서 병합되어 preview보다 각각 4건, 1건, 3건 적게 저장됨
- 임시 RLS 정책: migration 중에만 사용 후 제거 완료, 잔존 0건

## 완료 판정 규칙

완료는 아래가 모두 끝나야 합니다.

- 이 표의 클릭/상세 복구 상태가 Playwright로 확인됨
- Supabase `ll_*` migration 실행과 row count readback 완료
- `ll_payload_snapshots.source = 'supabase_snapshot'` readback 완료
- GitHub Pages live URL에서 전체 탭 QA 통과
- 공개 번들 secret scan 통과
