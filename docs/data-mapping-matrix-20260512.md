# 데이터 매핑표

생성일: 2026-05-12 KST

이 문서는 기존 Google Sheets/xlsx 원본을 Supabase `public.ll_*`와 GitHub Pages snapshot으로 어떻게 옮겼는지 확인하기 위한 작업 기준표입니다. non-`ll_*` 테이블은 조회 외 수정하지 않습니다.

## 원본 보존

| 원본 | 현재 보존 위치 | 보존 수준 | 현재 readback | 남은 갭 |
|---|---|---|---:|---|
| `★ 260414_물류센터 임대차계약 DB_취합본.xlsx` | `ll_source_cells` | cell-by-cell | 13,752 cells / 8,627 non-blank / 941 formulas | 없음 |
| `★ 260414_물류센터 임대차계약 DB_취합본.xlsx` | `ll_sheet_rows` | row JSON | import run 기준 row 보존 | cell 검증은 `ll_source_cells` 기준 |
| Live Google Sheets `IGIS_Logistics_Leasing_Data` | `ll_sheet_rows` | row-level | 347 rows | cell-by-cell 보존 추가 필요 |
| Live Google Sheets 17개 시트 metadata | 감사 문서 | sheet 목록 확인 | 17 sheets | cell 값/수식/표시값 대조 필요 |

## 업무 테이블

| Supabase table | 목적 | 주요 원본 | 현재 row count | 화면 연결 |
|---|---|---|---:|---|
| `ll_assets` | 물류센터 자산 기본 정보 | xlsx/Sheets 자산 행 | 17 | Home, Asset, Sector, 지도 |
| `ll_tenants` | 임차인 기준 정보 | xlsx/Sheets 임차인 행 | 36 | Home, Company, Tools |
| `ll_leases` | 계약 단위 | xlsx/Sheets 계약 행 | 45 | Asset, Company, Tools |
| `ll_lease_spaces` | 층/구역/면적 단위 | xlsx/Sheets 임대 구역 | 59 | Asset 층별 배치, 면적 구성 |
| `ll_rent_history` | 임대료/관리비 이력 | xlsx/Sheets 히스토리 | 163 | Home/Asset/Sector 추이 |
| `ll_asset_managers` | 자산 담당자 연결 | xlsx `자산_담당자 연결` | 17 | Weekly, Work platform |
| `ll_issues` | 이슈/검토 항목 | xlsx/Sheets 주요 이슈 | 42 | Weekly, Data Quality |
| `ll_data_quality_findings` | 데이터 품질 및 null 원인 | migration/QA 결과 | 44 | Data Quality |

## Snapshot

| Snapshot table | source | source_system | user_safe | row count | 목적 |
|---|---|---|---|---:|---|
| `ll_payload_snapshots` | `supabase_snapshot` | `google_sheets` | true | 107 | GitHub Pages 프론트의 우선 데이터 원본 |

## Null/관계 검증

| 항목 | 현재 값 | 판단 |
|---|---:|---|
| `ll_rent_history` 전체 | 163 | 정상 적재됨 |
| `lease_id` null | 6 | 원본 오류/수동 매칭 필요로 분류 유지 |
| `lease_space_id` null | 6 | 원본 오류/수동 매칭 필요로 분류 유지 |
| `asset_id` null | 0 | 관계 연결 정상 |
| `tenant_id` null | 0 | 관계 연결 정상 |
| `match_status` 기록 | 163 | 모든 rent history row에 매칭 상태 있음 |

## 다음 데이터 작업

1. Live Google Sheets 17개 시트의 cell-by-cell 보존을 `source_type='google_sheets'`로 추가합니다.
2. `ll_source_cells`와 live Sheets를 `sheet_name + row_number + column_number + raw/display/formula/hash`로 대조합니다.
3. xlsx에는 값이 있는데 정규화 테이블이 null인 항목은 `ll_data_quality_findings`에 원인과 수정 후보를 남깁니다.
4. `ll_*` 중 삭제/재구조화는 원본 보존 증명 후에만 실행합니다.
