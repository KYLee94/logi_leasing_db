# public.ll_* minimal schema proposal

작성일: 2026-05-08
상태: 승인 대기
범위: Supabase `public.ll_*`만 대상. 기존 non-`ll_*` 테이블은 조회 외 변경 금지.

## 1. 현재 확인 결과

- 기준 원본 xlsx: `★ 260414_물류센터 임대차계약 DB_취합본.xlsx`
- live Google Sheets: `IGIS_Logistics_Leasing_Data`
- spreadsheetId: `1powCa2TV7Pkqi3Un3mz3clJPwJ9xw7lMr1bZ0eLMqVA`
- live Sheets는 xlsx보다 확장되어 있습니다.
  - xlsx: `Meta_데이터 항목 설명`, `DB_일반`, `DB_히스토리 누적`, `Log`, `자산_담당자 연결`
  - live: 위 원천을 운영용으로 정리한 `DB_일반`, `DB_히스토리 누적`, `DB_기업`, `DB_자산`, `DB_계산`, `펀드-자산-담당자 연결`, `이슈 리스트`, `AUDIT_데이터이상`, hidden SYS/LOG 시트 포함
- Supabase 커넥터는 현재 `Unknown tool`/재인증 문제로 실제 DB의 `public.ll_*` row count를 확정 조회하지 못했습니다. 이 문서는 적용 승인안이 아니라 "적용 전 승인 초안"입니다.

## 2. 권장 테이블 수

권장 테이블은 총 10개입니다.

| 테이블 | 이유 | 주요 원본 |
|---|---|---|
| `ll_import_runs` | 어떤 원본을 언제 가져왔는지 1건 단위로 기록 | xlsx, live Sheets |
| `ll_sheet_rows` | 모든 원본 행을 JSON으로 보존. 셀 단위 테이블은 만들지 않음 | 모든 xlsx/live Sheets 시트 |
| `ll_assets` | 자산 마스터 | `DB_자산`, `DB_일반`, 담당자 연결 |
| `ll_tenants` | 임차인 마스터 | `DB_기업`, `DB_일반` |
| `ll_leases` | 계약 단위 기본 조건 | `DB_일반` |
| `ll_lease_spaces` | 임차 층/구역/면적 단위 | `DB_일반` |
| `ll_rent_history` | 임대료/관리비 시계열 | `DB_히스토리 누적` |
| `ll_asset_managers` | 자산별 담당자 | `펀드-자산-담당자 연결`, xlsx `자산_담당자 연결` |
| `ll_issues` | 담당자 확인/감사/품질 이슈 | `이슈 리스트`, `AUDIT_데이터이상`, xlsx `Log` |
| `ll_payload_snapshots` | dashboard 빠른 조회용 snapshot | 위 업무 테이블에서 생성 |

## 3. 만들지 않을 테이블

- `ll_source_cells`, `ll_source_columns`, `ll_source_sheets`, `ll_source_diffs`
  - 이유: xlsx/Sheets가 대규모 원천 시스템이 아니라 시트 몇 개 수준입니다. 원본 보존은 `ll_sheet_rows.row_values_json`으로 충분합니다.
- `ll_user_permissions`, `ll_edit_sessions`, `ll_cell_edits`, `ll_delete_markers`
  - 이유: 사용자 편집/삭제 권한은 추후 확장입니다. 지금 만들면 구조만 복잡해집니다.
- `ll_area_breakdowns`
  - 이유: 면적 세부값은 `ll_lease_spaces.area_breakdown_json`에 담습니다.
- `ll_field_dictionary`
  - 이유: xlsx `Meta_데이터 항목 설명`은 `ll_sheet_rows`에 원본 행으로 보존하고, 필요 시 나중에 별도 view로 빼면 됩니다.
- `ll_funds`
  - 이유: 현재 dashboard 목적에서는 펀드코드/펀드명을 `ll_assets`와 `ll_leases`에 보관하면 충분합니다.
- `ll_quality_checks`
  - 이유: 운영 이슈는 우선 `ll_issues`로 통합합니다.
- `ll_companies`, `ll_building_registers`, `ll_opendart_financials`
  - 이유: 외부 API 보강 데이터는 지금 migration 대상이 아닙니다. 기존 non-`ll_*`에서 복사하지 않습니다.

## 4. 기존 `ll_*` 처리 원칙

실제 Supabase row count 확인 전에는 아무 처리도 하지 않습니다.

승인 후 첫 작업은 read-only 점검입니다.

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'll\_%' escape '\'
order by table_name;
```

현재 로컬 스키마 파일 기준으로 기존 draft에는 과한 테이블이 섞여 있습니다. 실제 DB에도 존재하면 아래처럼 처리합니다.

| 대상 | 처리 |
|---|---|
| `ll_assets`, `ll_tenants`, `ll_leases`, `ll_lease_spaces`, `ll_rent_history`, `ll_issues`, `ll_payload_snapshots` | 같은 이름 유지 또는 재생성 |
| `ll_asset_managers` | 없으면 생성, 있으면 단순 컬럼으로 정리 |
| `ll_etl_runs` | `ll_import_runs`로 대체 |
| `ll_source_rows` | `ll_sheet_rows`로 대체 |
| `ll_source_cells`, `ll_source_columns`, `ll_source_sheets`, `ll_source_diffs`, `ll_normalization_links`, `ll_area_breakdowns`, `ll_field_dictionary`, `ll_quality_checks`, 권한/편집 draft 테이블 | clean reset 승인 시 제거 대상 |

주의: clean reset은 `public.ll_*`에만 한정합니다. non-`ll_*` 테이블은 절대 mutation하지 않습니다.

## 5. 예상 row count

현재 로컬에 남아 있는 생성 산출물 기준 예상입니다. 실제 Supabase readback count가 아닙니다.

| 테이블 | Google Sheets 산출물 | xlsx 산출물 |
|---|---:|---:|
| `ll_assets` | 17 | 17 |
| `ll_tenants` | 33 | 31 |
| `ll_leases` | 45 | 45 |
| `ll_lease_spaces` | 63 | 63 |
| `ll_rent_history` | 164 | 164 |
| `ll_asset_managers` | 미생성 | 17 |
| `ll_issues` | 42 | 51 |
| `ll_payload_snapshots` | 56 | 54 |

`ll_sheet_rows`는 live Sheets 전체를 다시 추출해야 확정됩니다. 기존 Google Sheets 산출물은 운영 5개 시트 기준 `347` source rows였고, xlsx 산출물은 `388` source rows였습니다.

## 6. SQL preview

아래 SQL은 승인용 preview입니다. 아직 실행하지 않았습니다.

```sql
begin;

create table if not exists public.ll_import_runs (
  import_id text primary key,
  source_type text not null check (source_type in ('live_google_sheets', 'xlsx')),
  source_name text not null,
  spreadsheet_id text,
  file_name text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'prepared',
  row_counts jsonb not null default '{}'::jsonb,
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists public.ll_sheet_rows (
  sheet_row_id text primary key,
  import_id text not null references public.ll_import_runs(import_id),
  source_type text not null check (source_type in ('live_google_sheets', 'xlsx')),
  source_name text not null,
  sheet_name text not null,
  row_number integer not null,
  header_row_number integer,
  row_values_json jsonb not null,
  row_hash text not null,
  created_at timestamptz not null default now(),
  unique (import_id, sheet_name, row_number)
);

create table if not exists public.ll_assets (
  asset_id text primary key,
  asset_code text,
  asset_name text not null,
  fund_code text,
  fund_name text,
  sector text,
  address text,
  latitude numeric,
  longitude numeric,
  approval_date date,
  first_configured_at date,
  gross_floor_area_sqm numeric,
  land_area_sqm numeric,
  floor_count text,
  current_manager_name text,
  current_manager_team text,
  current_manager_email text,
  source_sheet_row_id text references public.ll_sheet_rows(sheet_row_id),
  source_payload jsonb not null default '{}'::jsonb,
  review_status text,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_tenants (
  tenant_id text primary key,
  tenant_master_name text not null,
  raw_tenant_name text,
  business_registration_no text,
  dart_corp_code text,
  match_status text,
  industry_code text,
  headquarters_address text,
  listed_yn text,
  group_name text,
  source_sheet_row_id text references public.ll_sheet_rows(sheet_row_id),
  source_payload jsonb not null default '{}'::jsonb,
  review_status text,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_leases (
  lease_id text primary key,
  asset_id text references public.ll_assets(asset_id),
  tenant_id text references public.ll_tenants(tenant_id),
  lease_status text,
  first_contract_date date,
  first_start_date date,
  first_end_date date,
  first_operation_date date,
  recent_contract_date date,
  current_start_date date,
  current_end_date date,
  contract_years numeric,
  extension_count integer,
  deposit_amount numeric,
  rf_months numeric,
  fo_months numeric,
  ti_amount numeric,
  rent_escalation_rate numeric,
  management_fee_escalation_rate numeric,
  escalation_cycle_months integer,
  next_escalation_date date,
  tenant_cost_burden text,
  early_termination_right text,
  renewal_option text,
  insurance_terms_json jsonb not null default '{}'::jsonb,
  special_terms text,
  source_doc_ref text,
  source_sheet_row_id text references public.ll_sheet_rows(sheet_row_id),
  source_payload jsonb not null default '{}'::jsonb,
  review_status text,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_lease_spaces (
  lease_space_id text primary key,
  lease_id text references public.ll_leases(lease_id),
  asset_id text references public.ll_assets(asset_id),
  tenant_id text references public.ll_tenants(tenant_id),
  floor_label text,
  detail_area_label text,
  temperature_type text,
  is_single_tenant boolean,
  is_preleased boolean,
  is_3pl boolean,
  goods_type text,
  leased_area_sqm numeric,
  exclusive_area_sqm numeric,
  exclusive_ratio numeric,
  area_breakdown_json jsonb not null default '{}'::jsonb,
  office_use_yn text,
  sublease_yn text,
  facility_specs_json jsonb not null default '{}'::jsonb,
  contract_status text,
  delinquency_yn text,
  source_sheet_row_id text references public.ll_sheet_rows(sheet_row_id),
  source_payload jsonb not null default '{}'::jsonb,
  review_status text,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_rent_history (
  rent_history_id text primary key,
  lease_space_id text references public.ll_lease_spaces(lease_space_id),
  lease_id text references public.ll_leases(lease_id),
  asset_id text references public.ll_assets(asset_id),
  tenant_id text references public.ll_tenants(tenant_id),
  effective_date date not null,
  change_reason text,
  leased_area_sqm numeric,
  exclusive_area_sqm numeric,
  monthly_rent_total numeric,
  monthly_mf_total numeric,
  rent_per_py numeric,
  mf_per_py numeric,
  is_latest boolean,
  match_status text,
  source_sheet_row_id text references public.ll_sheet_rows(sheet_row_id),
  source_payload jsonb not null default '{}'::jsonb,
  review_status text,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_asset_managers (
  asset_manager_id text primary key,
  asset_id text references public.ll_assets(asset_id),
  asset_code text,
  asset_name text,
  fund_code text,
  fund_name text,
  manager_name text,
  manager_team text,
  manager_email text,
  source_sheet_row_id text references public.ll_sheet_rows(sheet_row_id),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_issues (
  issue_id text primary key,
  entity_type text,
  entity_id text,
  asset_id text references public.ll_assets(asset_id),
  tenant_id text references public.ll_tenants(tenant_id),
  issue_type text,
  severity text,
  title text,
  description text,
  status text,
  due_date date,
  owner text,
  source_sheet_row_id text references public.ll_sheet_rows(sheet_row_id),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_payload_snapshots (
  snapshot_key text primary key,
  page text not null,
  entity_id text not null default 'default',
  payload jsonb not null,
  user_safe boolean not null default true,
  generated_at timestamptz,
  schema_version text,
  source text not null default 'supabase_snapshot',
  source_system text not null default 'google_sheets',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source in ('supabase_snapshot', 'github_snapshot')),
  check (source_system = 'google_sheets')
);

create index if not exists ll_sheet_rows_import_idx on public.ll_sheet_rows(import_id, sheet_name);
create index if not exists ll_assets_code_idx on public.ll_assets(asset_code);
create unique index if not exists ll_tenants_business_no_uq
  on public.ll_tenants (business_registration_no)
  where business_registration_no is not null and business_registration_no <> '';
create index if not exists ll_leases_asset_idx on public.ll_leases(asset_id);
create index if not exists ll_leases_tenant_idx on public.ll_leases(tenant_id);
create index if not exists ll_lease_spaces_asset_idx on public.ll_lease_spaces(asset_id);
create index if not exists ll_lease_spaces_tenant_idx on public.ll_lease_spaces(tenant_id);
create index if not exists ll_rent_history_space_date_idx on public.ll_rent_history(lease_space_id, effective_date desc);
create index if not exists ll_payload_snapshots_page_idx on public.ll_payload_snapshots(page, entity_id);

alter table public.ll_import_runs enable row level security;
alter table public.ll_sheet_rows enable row level security;
alter table public.ll_assets enable row level security;
alter table public.ll_tenants enable row level security;
alter table public.ll_leases enable row level security;
alter table public.ll_lease_spaces enable row level security;
alter table public.ll_rent_history enable row level security;
alter table public.ll_asset_managers enable row level security;
alter table public.ll_issues enable row level security;
alter table public.ll_payload_snapshots enable row level security;

drop policy if exists ll_payload_snapshots_user_safe_select on public.ll_payload_snapshots;
create policy ll_payload_snapshots_user_safe_select
  on public.ll_payload_snapshots
  for select
  using (user_safe = true);

commit;
```

## 7. 승인 후 실행 순서

1. Supabase 커넥터 재인증 또는 read-only SQL 경로 확보
2. 현재 `public.ll_*` 목록, schema, row count readback
3. clean reset 대상 확정: `public.ll_*`만, non-`ll_*` 제외
4. 사용자에게 clean reset 승인 재확인
5. 위 minimal schema migration 실행
6. live Google Sheets/xlsx extract
7. `ll_sheet_rows`에 모든 원본 행 JSON 보존
8. 업무 테이블 정규화 적재
9. row count/source/readback 검증
10. `ll_payload_snapshots` 생성
11. dashboard source를 `supabase_snapshot`으로 전환

