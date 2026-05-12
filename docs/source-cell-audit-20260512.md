# Supabase 원본 보존 Cell-by-Cell 감사

생성일: 2026-05-12 KST

이 문서는 `★ 260414_물류센터 임대차계약 DB_취합본.xlsx`와 Supabase `public.ll_*` 적재 상태를 다시 확인한 감사 기록입니다. non-`ll_*` 테이블은 조회만 했고 수정하지 않았습니다.

## 1. xlsx 재추출 결과

로컬 파일 `★ 260414_물류센터 임대차계약 DB_취합본.xlsx`를 다시 추출했습니다.

| 항목 | 값 |
|---|---:|
| 시트 수 | 5 |
| 행 수 | 388 |
| 최대 컬럼 수 합산 | 169 |
| 전체 셀 수 | 13,752 |
| 값이 있는 셀 수 | 8,627 |
| 수식 셀 수 | 941 |

## 2. Supabase `ll_source_cells` readback

| 시트 | 셀 수 | 값 있는 셀 | 수식 셀 | 행 범위 | 최대 컬럼 |
|---|---:|---:|---:|---:|---:|
| `DB_일반` | 6,216 | 4,909 | 763 | 1-74 | 84 |
| `DB_히스토리 누적` | 3,382 | 2,885 | 172 | 1-178 | 19 |
| `Log` | 518 | 321 | 0 | 1-37 | 14 |
| `Meta_데이터 항목 설명` | 3,476 | 385 | 6 | 1-79 | 44 |
| `자산_담당자 연결` | 160 | 127 | 0 | 1-20 | 8 |
| 합계 | 13,752 | 8,627 | 941 | - | - |

판정: xlsx 기준 전체 셀 수, 값 있는 셀 수, 수식 셀 수는 Supabase `ll_source_cells`와 일치합니다.

## 3. `ll_*` row count readback

| 테이블 | rows |
|---|---:|
| `ll_asset_managers` | 17 |
| `ll_assets` | 17 |
| `ll_data_quality_findings` | 44 |
| `ll_import_runs` | 2 |
| `ll_issues` | 42 |
| `ll_lease_spaces` | 59 |
| `ll_leases` | 45 |
| `ll_payload_snapshots` | 107 |
| `ll_rent_history` | 163 |
| `ll_sheet_rows` | 347 |
| `ll_source_cells` | 13,752 |
| `ll_tenants` | 36 |

## 4. Snapshot source readback

| page | rows | `supabase_snapshot` | `user_safe=true` |
|---|---:|---:|---:|
| `asset` | 34 | 34 | 34 |
| `bootstrap` | 2 | 2 | 2 |
| `company` | 61 | 61 | 61 |
| `home` | 2 | 2 | 2 |
| `playground` | 2 | 2 | 2 |
| `sector` | 2 | 2 | 2 |
| `tools` | 2 | 2 | 2 |
| `weekly` | 2 | 2 | 2 |

## 5. Null 감사 우선순위

현재 `ll_rent_history`에서 관계 연결이 필요한 6건이 남아 있습니다.

| 유형 | 건수 | 상태 |
|---|---:|---|
| `lease_id` 또는 `lease_space_id` null | 6 | `unmatched_review_required` |
| `exclusive_area_sqm` null | 1 | 원본 오류/누락 여부 재확인 필요 |
| `match_status` null | 0 | 해결됨 |

대표 원인:

- 원본 값이 `#N/A`, `#VALUE!`인 행
- `DB_일반`과 `DB_히스토리 누적`의 계약/구역 연결 실패
- 기준일자, 임대면적, 코드 누락으로 단일 계약에 자동 매칭하기 어려운 행

## 6. 아직 완료로 볼 수 없는 부분

- Google Sheets live 원본의 cell-by-cell 보존은 아직 `source_type='google_sheets'` 형태로 확인되지 않았습니다.
- 현재 보존 증명은 xlsx 기준입니다. Google Sheets와 xlsx 차이는 별도 추출 후 `ll_source_cells` 또는 별도 `ll_source_diffs`에 남겨야 합니다.
- `ll_*` cleanup/restructure는 이 감사가 끝나기 전까지 금지합니다.

## 7. 삭제/재구조화 금지 테이블

아래 테이블은 원본 보존 또는 화면 source에 직접 필요하므로 cleanup 후보에서 제외합니다.

- `ll_source_cells`
- `ll_sheet_rows`
- `ll_import_runs`
- `ll_payload_snapshots`
- `ll_data_quality_findings`

## 8. 다음 조치

1. Google Sheets live 원본을 cell 단위로 추출합니다.
2. xlsx와 Google Sheets를 `sheet_name + row_number + column_number` 기준으로 비교합니다.
3. null 6건을 원본 셀까지 역추적해 `ll_data_quality_findings`에 원인/수정 후보를 추가합니다.
4. 이후에만 `ll_*` 스키마 재구조화 후보를 확정합니다.
