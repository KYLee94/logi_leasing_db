# Supabase 원본 보존 Cell-by-Cell 감사

생성일: 2026-05-12 KST

이 문서는 `★ 260414_물류센터 임대차계약 DB_취합본.xlsx`, live Google Sheets, Supabase `public.ll_*` 적재 상태를 다시 확인한 감사 기록입니다. non-`ll_*` 테이블은 조회 외 수정하지 않았습니다.

## 1. xlsx 재추출 결과

| 항목 | 값 |
|---|---:|
| 시트 수 | 5 |
| 행 수 | 388 |
| 최대 컬럼 수 합계 | 169 |
| 전체 셀 수 | 13,752 |
| 값이 있는 셀 수 | 8,627 |
| 수식 셀 수 | 941 |

## 2. Supabase `ll_source_cells` readback

| source_type | cells | non_blank | formulas |
|---|---:|---:|---:|
| `xlsx` | 13,752 | 8,627 | 941 |

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

## 5. Live Google Sheets 보존 상태

Google Drive metadata 기준 live 원본은 17개 시트입니다.

| 상태 | 내용 |
|---|---|
| row-level 보존 완료 | `DB_기업`, `DB_일반`, `DB_자산`, `DB_히스토리 누적`, `이슈 리스트` 총 347 rows |
| cell-level 보존 완료 | 아직 없음 |
| 누락된 row/cell 보존 대상 | `meta_DB_일반`, `AuditLog`, `DB_계산`, `펀드-자산-담당자 연결`, `SYS_*`, `LOG_*`, `AUDIT_데이터이상` |

추출 경로 점검 결과:

- Google Sheets API 직접 호출: 403, 현재 OAuth 프로젝트에서 Sheets API 비활성화
- Apps Script Execution API 호출: 403, 현재 OAuth 사용자에게 실행 권한 없음
- Google Drive 커넥터: metadata와 범위 읽기는 가능하나 대량 cell JSON을 로컬 파일로 자동 저장하는 경로는 아직 없음

따라서 현재 보존 증명은 xlsx cell-by-cell 기준입니다. live Sheets 17개 시트의 cell-by-cell 보존은 권한이 있는 추출 경로가 확보되면 `source_type='live_google_sheets'`로 `ll_source_cells`에 추가해야 합니다.

## 6. Null 감사 우선순위

현재 `ll_rent_history`에서 관계 연결이 필요한 6건이 남아 있습니다.

| 유형 | 건수 | 상태 |
|---|---:|---|
| `lease_id` 또는 `lease_space_id` null | 6 | `unmatched_review_required` |
| `exclusive_area_sqm` null | 1 | 원본 오류/누락 여부 재확인 필요 |
| `match_status` null | 0 | 해결됨 |

추정 원인:

- 원본 값이 `#N/A`, `#VALUE!`인 행
- `DB_일반`과 `DB_히스토리 누적`의 계약/구역 연결 실패
- 기준일자, 임대면적, 코드 누락으로 단일 계약에 자동 매칭하기 어려운 행

## 7. 삭제/재구조화 금지 테이블

아래 테이블은 원본 보존 또는 화면 source에 직접 필요하므로 cleanup 후보에서 제외합니다.

- `ll_source_cells`
- `ll_sheet_rows`
- `ll_import_runs`
- `ll_payload_snapshots`
- `ll_data_quality_findings`

## 8. 다음 조치

1. live Google Sheets 17개 시트 cell 추출 권한 경로를 확보합니다.
2. `ll_source_cells.source_type='live_google_sheets'`로 추가 적재합니다.
3. xlsx와 live Sheets를 `sheet_name + row_number + column_number` 기준으로 비교합니다.
4. null 6건을 원본 셀까지 역추적해 `ll_data_quality_findings`에 원인과 수정 후보를 남깁니다.
5. 그 이후에만 `ll_*` 스키마 cleanup/restructure 후보를 확정합니다.
