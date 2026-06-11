-- Logistics Leasing Supabase lean schema reference.
-- Scope: only public.ll_* objects are created, altered, or retired here.
-- Existing non-ll_* tables must not be updated, deleted, altered, or dropped.
-- Runtime access is through Apps Script with SUPABASE_SERVICE_ROLE_KEY stored
-- only in Apps Script Script Properties. The service role key is not a client
-- setting and must not be pasted into source code, logs, or Admin UI fields.
--
-- Operating model:
-- - public.ll_source_sheets / ll_source_columns / ll_source_rows preserve the
--   full Google Sheets CSV export, including blank cells within the used range.
-- - The normalized tables below are the dashboard editing/read path. They keep
--   source_* references back to raw sheet rows so future user edits can be
--   audited and reconciled with the original migration.
-- - public.ll_payload_snapshots is the fast dashboard read path.
-- - Existing non-ll Supabase tables are not enrichment inputs for this reset
--   path. This script never creates, alters, updates, deletes, truncates, or
--   drops non-ll tables.
-- - All operational ll_* rows keep explicit source_* columns so Google Sheets
--   logistics-only provenance can be checked without parsing JSON.
--
-- Admin operation order:
-- 0. Authenticate as Admin in the Apps Script web app.
-- 1. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATA_SOURCE_MODE in
--    Apps Script Script Properties. Do not paste the service role key into the
--    Admin panel, source code, logs, or client config.
-- 2. Run adminRunSupabaseDryRun. This checks lean ll_* REST visibility and row
--    count access without writing data.
-- 3. Run adminSyncSheetsToSupabase. This upserts the lean public.ll_* operating
--    rows only and reads back expected primary keys.
-- 4. Run adminRefreshSupabaseSnapshots. This writes ll_payload_snapshots and
--    reads back expected snapshot_key values.
-- 5. Confirm cache clear, then verify screen/server payloadSource is
--    supabase_snapshot. Until every step is green, Admin must treat the
--    Supabase connection as blocked.

begin;

-- Retire empty, over-normalized ll_* tables from the previous draft. Only
-- public.ll_* objects are dropped, and CASCADE is intentionally avoided so
-- dependencies must be reviewed instead of removed as a side effect.
drop table if exists public.ll_asset_areas;
drop table if exists public.ll_asset_floors;
drop table if exists public.ll_building_registers;
drop table if exists public.ll_company_financials;
drop table if exists public.ll_quality_issues;
drop table if exists public.ll_audit_log;
drop table if exists public.ll_weekly_assets;
drop table if exists public.ll_weekly_projects;
drop table if exists public.ll_weekly_reports;

create table if not exists public.ll_etl_runs (
  run_id text primary key,
  source_system text not null default 'google_sheets',
  run_type text not null default 'sheet_to_supabase',
  status text not null default 'prepared',
  started_at timestamptz,
  finished_at timestamptz,
  row_counts jsonb not null default '{}'::jsonb,
  error_message text,
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_etl_runs_source_system_google_sheets_ck check (source_system = 'google_sheets')
);

create table if not exists public.ll_funds (
  fund_id text primary key,
  fund_code text,
  fund_name text,
  raw_fund_name text,
  short_name text,
  sector text,
  setup_date date,
  maturity_date date,
  status text,
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_updated_at timestamptz,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  review_status text not null default 'ok',
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_funds_google_sheets_source_ck check (
    source_system = 'google_sheets'
    and source_table in ('DB_일반', '260520_펀드 정보')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  )
);

create table if not exists public.ll_assets (
  asset_id text primary key,
  asset_code text,
  asset_name text not null,
  raw_asset_name text,
  fund_id text,
  sector text,
  address text,
  latitude numeric,
  longitude numeric,
  approval_date date,
  first_configured_at date,
  gross_floor_area_sqm numeric,
  land_area_sqm numeric,
  floor_count text,
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_updated_at timestamptz,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  review_status text not null default 'ok',
  review_note text,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_assets_google_sheets_source_ck check (
    source_system = 'google_sheets'
    and source_table in ('DB_자산', 'DB_일반', '260520_펀드 정보')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  )
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
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  review_status text,
  review_note text,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_tenants_google_sheets_source_ck check (
    source_system = 'google_sheets'
    and source_table in ('DB_기업', 'DB_일반')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  )
);

create table if not exists public.ll_leases (
  lease_id text primary key,
  asset_id text,
  tenant_id text,
  lease_status text,
  start_date date,
  end_date date,
  contract_years numeric,
  rf_months numeric,
  fo_months numeric,
  ti_amount numeric,
  deposit_amount numeric,
  renewal_option text,
  early_termination_right text,
  special_terms text,
  source_doc_ref text,
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  review_status text,
  review_note text,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_leases_google_sheets_source_ck check (
    source_system = 'google_sheets'
    and source_table = 'DB_일반'
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  )
);

create table if not exists public.ll_lease_spaces (
  lease_space_id text primary key,
  lease_id text,
  asset_id text,
  tenant_id text,
  floor_label text,
  detail_area_label text,
  temperature_type text,
  leased_area_sqm numeric,
  exclusive_area_sqm numeric,
  exclusive_ratio numeric,
  current_monthly_rent_total numeric,
  current_monthly_mf_total numeric,
  current_monthly_cost_total numeric,
  e_noc numeric,
  formula_version text,
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  review_status text,
  review_note text,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_lease_spaces_google_sheets_source_ck check (
    source_system = 'google_sheets'
    and source_table = 'DB_일반'
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  )
);

create table if not exists public.ll_rent_history (
  history_event_id text primary key,
  lease_space_id text,
  lease_id text,
  asset_id text,
  tenant_id text,
  effective_date date,
  leased_area_sqm numeric,
  rent_per_py numeric,
  mf_per_py numeric,
  monthly_rent_total numeric,
  monthly_mf_total numeric,
  is_latest boolean,
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  review_status text,
  review_note text,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_rent_history_google_sheets_source_ck check (
    source_system = 'google_sheets'
    and source_table = 'DB_히스토리 누적'
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  )
);

create table if not exists public.ll_area_breakdowns (
  area_breakdown_id text primary key,
  lease_space_id text,
  lease_id text,
  asset_id text,
  tenant_id text,
  area_type text,
  area_label text,
  area_sqm numeric,
  area_py numeric,
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_area_breakdowns_google_sheets_source_ck check (
    source_system = 'google_sheets'
    and source_table = 'DB_일반'
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  )
);

create table if not exists public.ll_field_dictionary (
  field_id text primary key,
  field_no text,
  field_name text,
  data_type text,
  unit text,
  is_time_series boolean,
  sample_value text,
  description text,
  last_etl_run_id text,
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_field_dictionary_google_sheets_source_ck check (
    source_system = 'google_sheets'
    and source_table = 'Meta_데이터 항목 설명'
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  )
);

create table if not exists public.ll_issues (
  issue_id text primary key,
  entity_type text,
  entity_id text,
  asset_id text,
  tenant_id text,
  issue_type text,
  severity text,
  title text,
  description text,
  status text,
  due_date date,
  owner text,
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_issues_google_sheets_source_ck check (
    source_system = 'google_sheets'
    and source_table in ('이슈 리스트', 'Quality', 'Audit', 'LOG_검증', 'AUDIT_데이터이상')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  )
);

create table if not exists public.ll_source_sheets (
  sheet_id text primary key,
  source_system text not null default 'google_sheets',
  sheet_name text not null,
  source_file text not null,
  row_count integer not null default 0,
  column_count integer not null default 0,
  cell_count integer not null default 0,
  header_hash text not null,
  data_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_source_sheets_google_sheets_ck check (
    source_system = 'google_sheets'
    and sheet_name in ('DB_일반', 'DB_히스토리 누적', 'DB_자산', 'DB_기업', '이슈 리스트')
    and source_file in ('logi_db_general.csv', 'logi_db_history.csv', 'logi_db_asset.csv', 'logi_db_company.csv', 'logi_issue_list.csv')
  )
);

create table if not exists public.ll_source_columns (
  column_uid text primary key,
  sheet_id text not null,
  source_system text not null default 'google_sheets',
  sheet_name text not null,
  column_index integer not null,
  column_letter text not null,
  header_name text not null default '',
  normalized_header text not null,
  column_role text not null default 'business_value',
  value_type_guess text not null default 'text',
  is_blank_header boolean not null default false,
  sample_values jsonb not null default '[]'::jsonb,
  source_ref text not null,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_source_columns_google_sheets_ck check (
    source_system = 'google_sheets'
    and sheet_name in ('DB_일반', 'DB_히스토리 누적', 'DB_자산', 'DB_기업', '이슈 리스트')
  )
);

create table if not exists public.ll_source_rows (
  row_uid text primary key,
  sheet_id text not null,
  source_system text not null default 'google_sheets',
  sheet_name text not null,
  row_index integer not null,
  row_number integer not null,
  source_ref text not null,
  source_row_hash text not null,
  non_empty_cell_count integer not null default 0,
  row_values jsonb not null default '[]'::jsonb,
  raw_row_payload jsonb not null default '{}'::jsonb,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_source_rows_google_sheets_ck check (
    source_system = 'google_sheets'
    and sheet_name in ('DB_일반', 'DB_히스토리 누적', 'DB_자산', 'DB_기업', '이슈 리스트')
  )
);

create table if not exists public.ll_normalization_links (
  link_id text primary key,
  source_system text not null default 'google_sheets',
  source_sheet_name text not null,
  source_ref text not null,
  source_row_uid text,
  target_table text not null,
  target_pk text not null,
  target_column text,
  link_type text not null default 'row_to_entity',
  confidence numeric not null default 1,
  rule_version text not null default 'csv_import_v1',
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_normalization_links_google_sheets_ck check (
    source_system = 'google_sheets'
    and source_sheet_name in ('DB_일반', 'DB_히스토리 누적', 'DB_자산', 'DB_기업', '이슈 리스트')
    and target_table like 'll_%'
  )
);

create table if not exists public.ll_user_permissions (
  permission_id text primary key,
  principal_type text not null,
  principal_id text not null,
  scope_type text not null,
  scope_id text,
  can_read boolean not null default true,
  can_write boolean not null default false,
  can_delete boolean not null default false,
  source_system text not null default 'google_sheets',
  created_by text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_asset_managers (
  asset_manager_id text primary key,
  asset_id text,
  asset_code text,
  asset_name text,
  fund_id text,
  fund_code text,
  fund_name text,
  manager_name text,
  organization text,
  email text,
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_asset_managers_google_sheets_ck check (source_system = 'google_sheets')
);

create table if not exists public.ll_staff_profiles (
  staff_id text primary key,
  staff_name text not null,
  email text,
  organization text,
  photo_url text,
  source_system text not null default 'google_sheets',
  source_table text,
  source_pk text,
  source_ref text,
  source_row_hash text,
  source_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_fund_beneficiaries (
  beneficiary_id text primary key,
  asset_id text,
  asset_code text,
  fund_id text,
  fund_code text,
  fund_name text,
  tranche text,
  beneficiary_name text not null,
  investment_amount_krw numeric,
  source_system text not null default 'google_sheets',
  source_table text,
  source_pk text,
  source_ref text,
  source_row_hash text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_fund_lenders (
  lender_id text primary key,
  asset_id text,
  asset_code text,
  fund_id text,
  fund_code text,
  fund_name text,
  loan_type text,
  tranche text,
  lender_name text not null,
  drawn_amount_krw numeric,
  drawn_at date,
  maturity_at date,
  interest_type text,
  base_rate_pct numeric,
  spread_rate_pct numeric,
  loan_rate_pct numeric,
  fee_rate_pct numeric,
  all_in_pct numeric,
  source_system text not null default 'google_sheets',
  source_table text,
  source_pk text,
  source_ref text,
  source_row_hash text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_login_history (
  login_event_id text primary key,
  user_id uuid,
  staff_name text,
  email text,
  event_type text not null default 'login',
  status text not null default 'ok',
  ip_hash text,
  user_agent text,
  event_at timestamptz not null default now(),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ll_edit_sessions (
  edit_session_id text primary key,
  principal_id text,
  status text not null default 'draft',
  source_system text not null default 'google_sheets',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_cell_edits (
  edit_id text primary key,
  edit_session_id text,
  source_row_uid text,
  column_uid text,
  target_table text,
  target_pk text,
  target_column text,
  old_value text,
  new_value text,
  edit_reason text,
  status text not null default 'draft',
  source_system text not null default 'google_sheets',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_cell_edits_target_table_ck check (target_table is null or target_table like 'll_%')
);

create table if not exists public.ll_payload_snapshots (
  snapshot_key text primary key,
  page text not null,
  entity_id text not null default 'default',
  payload jsonb not null,
  user_safe boolean not null default true,
  generated_at timestamptz,
  schema_version text,
  source text not null default 'google_sheets_model_snapshot',
  source_system text not null default 'google_sheets',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_payload_snapshots_google_sheets_source_ck check (
    source_system = 'google_sheets'
    and source = 'google_sheets_model_snapshot'
  )
);

-- Compatibility alters keep the script idempotent when an earlier draft of an
-- ll_* table already exists. They only widen the lean model and never touch
-- non-ll source tables.
alter table public.ll_etl_runs add column if not exists created_at timestamptz not null default now();
alter table public.ll_etl_runs add column if not exists updated_at timestamptz not null default now();

alter table public.ll_funds add column if not exists raw_fund_name text;
alter table public.ll_funds add column if not exists short_name text;
alter table public.ll_funds add column if not exists sector text;
alter table public.ll_funds add column if not exists setup_date date;
alter table public.ll_funds add column if not exists maturity_date date;
alter table public.ll_funds add column if not exists status text;
alter table public.ll_funds add column if not exists source_system text;
alter table public.ll_funds add column if not exists source_table text;
alter table public.ll_funds add column if not exists source_pk text;
alter table public.ll_funds add column if not exists source_updated_at timestamptz;
alter table public.ll_funds add column if not exists source_ref text;
alter table public.ll_funds add column if not exists source_row_hash text;
alter table public.ll_funds add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_funds add column if not exists review_status text not null default 'ok';
alter table public.ll_funds alter column review_status set default 'ok';
alter table public.ll_funds add column if not exists last_etl_run_id text;
alter table public.ll_funds add column if not exists created_at timestamptz not null default now();
alter table public.ll_funds add column if not exists updated_at timestamptz not null default now();

alter table public.ll_assets add column if not exists raw_asset_name text;
alter table public.ll_assets add column if not exists source_system text;
alter table public.ll_assets add column if not exists source_table text;
alter table public.ll_assets add column if not exists source_pk text;
alter table public.ll_assets add column if not exists source_updated_at timestamptz;
alter table public.ll_assets add column if not exists source_ref text;
alter table public.ll_assets add column if not exists source_row_hash text;
alter table public.ll_assets add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_assets add column if not exists review_status text not null default 'ok';
alter table public.ll_assets alter column review_status set default 'ok';
alter table public.ll_assets add column if not exists last_etl_run_id text;
alter table public.ll_assets add column if not exists created_at timestamptz not null default now();
alter table public.ll_assets add column if not exists updated_at timestamptz not null default now();

alter table public.ll_tenants add column if not exists raw_tenant_name text;
alter table public.ll_tenants add column if not exists source_system text;
alter table public.ll_tenants add column if not exists source_table text;
alter table public.ll_tenants add column if not exists source_pk text;
alter table public.ll_tenants add column if not exists source_ref text;
alter table public.ll_tenants add column if not exists source_row_hash text;
alter table public.ll_tenants add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_tenants add column if not exists last_etl_run_id text;
alter table public.ll_tenants add column if not exists created_at timestamptz not null default now();
alter table public.ll_tenants add column if not exists updated_at timestamptz not null default now();

alter table public.ll_leases add column if not exists source_ref text;
alter table public.ll_leases add column if not exists source_system text;
alter table public.ll_leases add column if not exists source_table text;
alter table public.ll_leases add column if not exists source_pk text;
alter table public.ll_leases add column if not exists source_row_hash text;
alter table public.ll_leases add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_leases add column if not exists last_etl_run_id text;
alter table public.ll_leases add column if not exists created_at timestamptz not null default now();
alter table public.ll_leases add column if not exists updated_at timestamptz not null default now();
alter table public.ll_leases alter column tenant_id drop not null;

alter table public.ll_lease_spaces add column if not exists source_ref text;
alter table public.ll_lease_spaces add column if not exists source_system text;
alter table public.ll_lease_spaces add column if not exists source_table text;
alter table public.ll_lease_spaces add column if not exists source_pk text;
alter table public.ll_lease_spaces add column if not exists source_row_hash text;
alter table public.ll_lease_spaces add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_lease_spaces add column if not exists last_etl_run_id text;
alter table public.ll_lease_spaces add column if not exists created_at timestamptz not null default now();
alter table public.ll_lease_spaces add column if not exists updated_at timestamptz not null default now();
alter table public.ll_lease_spaces alter column tenant_id drop not null;

alter table public.ll_rent_history add column if not exists source_ref text;
alter table public.ll_rent_history add column if not exists source_system text;
alter table public.ll_rent_history add column if not exists source_table text;
alter table public.ll_rent_history add column if not exists source_pk text;
alter table public.ll_rent_history add column if not exists source_row_hash text;
alter table public.ll_rent_history add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_rent_history add column if not exists last_etl_run_id text;
alter table public.ll_rent_history add column if not exists created_at timestamptz not null default now();
alter table public.ll_rent_history add column if not exists updated_at timestamptz not null default now();
alter table public.ll_rent_history alter column tenant_id drop not null;

alter table public.ll_issues add column if not exists source_ref text;
alter table public.ll_issues add column if not exists source_system text;
alter table public.ll_issues add column if not exists source_table text;
alter table public.ll_issues add column if not exists source_pk text;
alter table public.ll_issues add column if not exists source_row_hash text;
alter table public.ll_issues add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_issues add column if not exists last_etl_run_id text;
alter table public.ll_issues add column if not exists created_at timestamptz not null default now();
alter table public.ll_issues add column if not exists updated_at timestamptz not null default now();

alter table public.ll_source_sheets add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_source_sheets add column if not exists sheet_name text;
alter table public.ll_source_sheets add column if not exists source_file text;
alter table public.ll_source_sheets add column if not exists row_count integer not null default 0;
alter table public.ll_source_sheets add column if not exists column_count integer not null default 0;
alter table public.ll_source_sheets add column if not exists cell_count integer not null default 0;
alter table public.ll_source_sheets add column if not exists header_hash text;
alter table public.ll_source_sheets add column if not exists data_hash text;
alter table public.ll_source_sheets add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_source_sheets add column if not exists last_etl_run_id text;
alter table public.ll_source_sheets add column if not exists created_at timestamptz not null default now();
alter table public.ll_source_sheets add column if not exists updated_at timestamptz not null default now();

alter table public.ll_source_columns add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_source_columns add column if not exists sheet_id text;
alter table public.ll_source_columns add column if not exists sheet_name text;
alter table public.ll_source_columns add column if not exists column_index integer;
alter table public.ll_source_columns add column if not exists column_letter text;
alter table public.ll_source_columns add column if not exists header_name text not null default '';
alter table public.ll_source_columns add column if not exists normalized_header text;
alter table public.ll_source_columns add column if not exists column_role text not null default 'business_value';
alter table public.ll_source_columns add column if not exists value_type_guess text not null default 'text';
alter table public.ll_source_columns add column if not exists is_blank_header boolean not null default false;
alter table public.ll_source_columns add column if not exists sample_values jsonb not null default '[]'::jsonb;
alter table public.ll_source_columns add column if not exists source_ref text;
alter table public.ll_source_columns add column if not exists last_etl_run_id text;
alter table public.ll_source_columns add column if not exists created_at timestamptz not null default now();
alter table public.ll_source_columns add column if not exists updated_at timestamptz not null default now();

alter table public.ll_source_rows add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_source_rows add column if not exists sheet_id text;
alter table public.ll_source_rows add column if not exists sheet_name text;
alter table public.ll_source_rows add column if not exists row_index integer;
alter table public.ll_source_rows add column if not exists row_number integer;
alter table public.ll_source_rows add column if not exists source_ref text;
alter table public.ll_source_rows add column if not exists source_row_hash text;
alter table public.ll_source_rows add column if not exists non_empty_cell_count integer not null default 0;
alter table public.ll_source_rows add column if not exists row_values jsonb not null default '[]'::jsonb;
alter table public.ll_source_rows add column if not exists raw_row_payload jsonb not null default '{}'::jsonb;
alter table public.ll_source_rows add column if not exists last_etl_run_id text;
alter table public.ll_source_rows add column if not exists created_at timestamptz not null default now();
alter table public.ll_source_rows add column if not exists updated_at timestamptz not null default now();

alter table public.ll_normalization_links add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_normalization_links add column if not exists source_sheet_name text;
alter table public.ll_normalization_links add column if not exists source_ref text;
alter table public.ll_normalization_links add column if not exists source_row_uid text;
alter table public.ll_normalization_links add column if not exists target_table text;
alter table public.ll_normalization_links add column if not exists target_pk text;
alter table public.ll_normalization_links add column if not exists target_column text;
alter table public.ll_normalization_links add column if not exists link_type text not null default 'row_to_entity';
alter table public.ll_normalization_links add column if not exists confidence numeric not null default 1;
alter table public.ll_normalization_links add column if not exists rule_version text not null default 'csv_import_v1';
alter table public.ll_normalization_links add column if not exists last_etl_run_id text;
alter table public.ll_normalization_links add column if not exists created_at timestamptz not null default now();
alter table public.ll_normalization_links add column if not exists updated_at timestamptz not null default now();

alter table public.ll_user_permissions add column if not exists principal_type text;
alter table public.ll_user_permissions add column if not exists principal_id text;
alter table public.ll_user_permissions add column if not exists scope_type text;
alter table public.ll_user_permissions add column if not exists scope_id text;
alter table public.ll_user_permissions add column if not exists can_read boolean not null default true;
alter table public.ll_user_permissions add column if not exists can_write boolean not null default false;
alter table public.ll_user_permissions add column if not exists can_delete boolean not null default false;
alter table public.ll_user_permissions add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_user_permissions add column if not exists created_by text;
alter table public.ll_user_permissions add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_user_permissions add column if not exists created_at timestamptz not null default now();
alter table public.ll_user_permissions add column if not exists updated_at timestamptz not null default now();

alter table public.ll_asset_managers add column if not exists asset_manager_id text;
alter table public.ll_asset_managers add column if not exists asset_id text;
alter table public.ll_asset_managers add column if not exists asset_code text;
alter table public.ll_asset_managers add column if not exists asset_name text;
alter table public.ll_asset_managers add column if not exists fund_id text;
alter table public.ll_asset_managers add column if not exists fund_code text;
alter table public.ll_asset_managers add column if not exists fund_name text;
alter table public.ll_asset_managers add column if not exists manager_name text;
alter table public.ll_asset_managers add column if not exists organization text;
alter table public.ll_asset_managers add column if not exists email text;
alter table public.ll_asset_managers add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_asset_managers add column if not exists source_table text;
alter table public.ll_asset_managers add column if not exists source_pk text;
alter table public.ll_asset_managers add column if not exists source_ref text;
alter table public.ll_asset_managers add column if not exists source_row_hash text;
alter table public.ll_asset_managers add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_asset_managers add column if not exists last_etl_run_id text;
alter table public.ll_asset_managers add column if not exists created_at timestamptz not null default now();
alter table public.ll_asset_managers add column if not exists updated_at timestamptz not null default now();

alter table public.ll_edit_sessions add column if not exists principal_id text;
alter table public.ll_edit_sessions add column if not exists status text not null default 'draft';
alter table public.ll_edit_sessions add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_edit_sessions add column if not exists started_at timestamptz not null default now();
alter table public.ll_edit_sessions add column if not exists submitted_at timestamptz;
alter table public.ll_edit_sessions add column if not exists approved_at timestamptz;
alter table public.ll_edit_sessions add column if not exists approved_by text;
alter table public.ll_edit_sessions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.ll_edit_sessions add column if not exists created_at timestamptz not null default now();
alter table public.ll_edit_sessions add column if not exists updated_at timestamptz not null default now();

alter table public.ll_cell_edits add column if not exists edit_session_id text;
alter table public.ll_cell_edits add column if not exists source_row_uid text;
alter table public.ll_cell_edits add column if not exists column_uid text;
alter table public.ll_cell_edits add column if not exists target_table text;
alter table public.ll_cell_edits add column if not exists target_pk text;
alter table public.ll_cell_edits add column if not exists target_column text;
alter table public.ll_cell_edits add column if not exists old_value text;
alter table public.ll_cell_edits add column if not exists new_value text;
alter table public.ll_cell_edits add column if not exists edit_reason text;
alter table public.ll_cell_edits add column if not exists status text not null default 'draft';
alter table public.ll_cell_edits add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_cell_edits add column if not exists created_by text;
alter table public.ll_cell_edits add column if not exists created_at timestamptz not null default now();
alter table public.ll_cell_edits add column if not exists updated_at timestamptz not null default now();

alter table public.ll_payload_snapshots add column if not exists source text;
alter table public.ll_payload_snapshots add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_payload_snapshots add column if not exists created_at timestamptz not null default now();
alter table public.ll_payload_snapshots add column if not exists updated_at timestamptz not null default now();
alter table public.ll_payload_snapshots alter column source set default 'google_sheets_model_snapshot';

alter table public.ll_etl_runs alter column source_system set default 'google_sheets';
alter table public.ll_funds alter column source_system set default 'google_sheets';
alter table public.ll_assets alter column source_system set default 'google_sheets';
alter table public.ll_tenants alter column source_system set default 'google_sheets';
alter table public.ll_leases alter column source_system set default 'google_sheets';
alter table public.ll_lease_spaces alter column source_system set default 'google_sheets';
alter table public.ll_rent_history alter column source_system set default 'google_sheets';
alter table public.ll_issues alter column source_system set default 'google_sheets';
alter table public.ll_source_sheets alter column source_system set default 'google_sheets';
alter table public.ll_source_columns alter column source_system set default 'google_sheets';
alter table public.ll_source_rows alter column source_system set default 'google_sheets';
alter table public.ll_normalization_links alter column source_system set default 'google_sheets';
alter table public.ll_user_permissions alter column source_system set default 'google_sheets';
alter table public.ll_edit_sessions alter column source_system set default 'google_sheets';
alter table public.ll_cell_edits alter column source_system set default 'google_sheets';
alter table public.ll_payload_snapshots alter column source_system set default 'google_sheets';

alter table public.ll_etl_runs drop constraint if exists ll_etl_runs_source_system_google_sheets_ck;
alter table public.ll_etl_runs add constraint ll_etl_runs_source_system_google_sheets_ck
  check (source_system is not null and source_system = 'google_sheets') not valid;

alter table public.ll_funds drop constraint if exists ll_funds_google_sheets_source_ck;
alter table public.ll_funds add constraint ll_funds_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_table in ('DB_일반', '260520_펀드 정보')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  ) not valid;

alter table public.ll_assets drop constraint if exists ll_assets_google_sheets_source_ck;
alter table public.ll_assets add constraint ll_assets_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_table in ('DB_자산', 'DB_일반', '260520_펀드 정보')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  ) not valid;

alter table public.ll_tenants drop constraint if exists ll_tenants_google_sheets_source_ck;
alter table public.ll_tenants add constraint ll_tenants_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_table in ('DB_기업', 'DB_일반')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  ) not valid;

alter table public.ll_leases drop constraint if exists ll_leases_google_sheets_source_ck;
alter table public.ll_leases add constraint ll_leases_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_table in ('DB_일반')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  ) not valid;

alter table public.ll_lease_spaces drop constraint if exists ll_lease_spaces_google_sheets_source_ck;
alter table public.ll_lease_spaces add constraint ll_lease_spaces_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_table in ('DB_일반')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  ) not valid;

alter table public.ll_rent_history drop constraint if exists ll_rent_history_google_sheets_source_ck;
alter table public.ll_rent_history add constraint ll_rent_history_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_table in ('DB_히스토리 누적')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  ) not valid;

alter table public.ll_area_breakdowns drop constraint if exists ll_area_breakdowns_google_sheets_source_ck;
alter table public.ll_area_breakdowns add constraint ll_area_breakdowns_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_table in ('DB_일반')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  ) not valid;

alter table public.ll_field_dictionary drop constraint if exists ll_field_dictionary_google_sheets_source_ck;
alter table public.ll_field_dictionary add constraint ll_field_dictionary_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_table in ('Meta_데이터 항목 설명')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  ) not valid;

alter table public.ll_issues drop constraint if exists ll_issues_google_sheets_source_ck;
alter table public.ll_issues add constraint ll_issues_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_table in ('이슈 리스트', 'Quality', 'Audit', 'LOG_검증', 'AUDIT_데이터이상')
    and source_pk is not null
    and source_ref is not null
    and source_row_hash is not null
  ) not valid;

alter table public.ll_source_sheets drop constraint if exists ll_source_sheets_google_sheets_ck;
alter table public.ll_source_sheets add constraint ll_source_sheets_google_sheets_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and sheet_name in ('DB_일반', 'DB_히스토리 누적', 'DB_자산', 'DB_기업', '이슈 리스트')
    and source_file in ('logi_db_general.csv', 'logi_db_history.csv', 'logi_db_asset.csv', 'logi_db_company.csv', 'logi_issue_list.csv')
  ) not valid;

alter table public.ll_source_columns drop constraint if exists ll_source_columns_google_sheets_ck;
alter table public.ll_source_columns add constraint ll_source_columns_google_sheets_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and sheet_name in ('DB_일반', 'DB_히스토리 누적', 'DB_자산', 'DB_기업', '이슈 리스트')
  ) not valid;

alter table public.ll_source_rows drop constraint if exists ll_source_rows_google_sheets_ck;
alter table public.ll_source_rows add constraint ll_source_rows_google_sheets_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and sheet_name in ('DB_일반', 'DB_히스토리 누적', 'DB_자산', 'DB_기업', '이슈 리스트')
  ) not valid;

alter table public.ll_normalization_links drop constraint if exists ll_normalization_links_google_sheets_ck;
alter table public.ll_normalization_links add constraint ll_normalization_links_google_sheets_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_sheet_name in ('DB_일반', 'DB_히스토리 누적', 'DB_자산', 'DB_기업', '이슈 리스트')
    and target_table like 'll_%'
  ) not valid;

alter table public.ll_cell_edits drop constraint if exists ll_cell_edits_target_table_ck;
alter table public.ll_cell_edits add constraint ll_cell_edits_target_table_ck
  check (target_table is null or target_table like 'll_%') not valid;

alter table public.ll_payload_snapshots drop constraint if exists ll_payload_snapshots_google_sheets_source_ck;
alter table public.ll_payload_snapshots add constraint ll_payload_snapshots_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source is not null
    and source = 'google_sheets_model_snapshot'
  ) not valid;

create index if not exists ll_assets_fund_id_idx on public.ll_assets (fund_id);
create index if not exists ll_funds_fund_code_idx on public.ll_funds (fund_code);
create index if not exists ll_funds_source_lookup_idx on public.ll_funds (source_system, source_table, source_pk);
create index if not exists ll_assets_source_lookup_idx on public.ll_assets (source_system, source_table, source_pk);
create index if not exists ll_assets_review_status_idx on public.ll_assets (review_status);
create index if not exists ll_tenants_business_registration_no_idx on public.ll_tenants (business_registration_no);
create index if not exists ll_tenants_source_lookup_idx on public.ll_tenants (source_system, source_table, source_pk);
create index if not exists ll_tenants_review_status_idx on public.ll_tenants (review_status);
create index if not exists ll_leases_asset_id_idx on public.ll_leases (asset_id);
create index if not exists ll_leases_tenant_id_idx on public.ll_leases (tenant_id);
create index if not exists ll_leases_source_lookup_idx on public.ll_leases (source_system, source_table, source_pk);
create index if not exists ll_lease_spaces_lease_id_idx on public.ll_lease_spaces (lease_id);
create index if not exists ll_lease_spaces_asset_id_idx on public.ll_lease_spaces (asset_id);
create index if not exists ll_lease_spaces_tenant_id_idx on public.ll_lease_spaces (tenant_id);
create index if not exists ll_lease_spaces_source_lookup_idx on public.ll_lease_spaces (source_system, source_table, source_pk);
create index if not exists ll_rent_history_lease_space_id_idx on public.ll_rent_history (lease_space_id);
create index if not exists ll_rent_history_asset_id_idx on public.ll_rent_history (asset_id);
create index if not exists ll_rent_history_tenant_id_idx on public.ll_rent_history (tenant_id);
create index if not exists ll_rent_history_source_lookup_idx on public.ll_rent_history (source_system, source_table, source_pk);
create index if not exists ll_area_breakdowns_lease_space_idx on public.ll_area_breakdowns (lease_space_id);
create index if not exists ll_area_breakdowns_asset_idx on public.ll_area_breakdowns (asset_id);
create index if not exists ll_area_breakdowns_source_lookup_idx on public.ll_area_breakdowns (source_system, source_table, source_pk);
create index if not exists ll_field_dictionary_name_idx on public.ll_field_dictionary (field_name);
create index if not exists ll_field_dictionary_source_lookup_idx on public.ll_field_dictionary (source_system, source_table, source_pk);
create index if not exists ll_issues_entity_idx on public.ll_issues (entity_type, entity_id);
create index if not exists ll_issues_asset_id_idx on public.ll_issues (asset_id);
create index if not exists ll_issues_source_lookup_idx on public.ll_issues (source_system, source_table, source_pk);
create index if not exists ll_source_sheets_sheet_name_idx on public.ll_source_sheets (sheet_name);
create index if not exists ll_source_columns_sheet_column_idx on public.ll_source_columns (sheet_id, column_index);
create index if not exists ll_source_columns_role_idx on public.ll_source_columns (column_role);
create index if not exists ll_source_rows_sheet_row_idx on public.ll_source_rows (sheet_id, row_number);
create index if not exists ll_source_rows_sheet_hash_idx on public.ll_source_rows (sheet_id, source_row_hash);
create index if not exists ll_normalization_links_source_row_idx on public.ll_normalization_links (source_row_uid);
create index if not exists ll_normalization_links_target_idx on public.ll_normalization_links (target_table, target_pk);
create index if not exists ll_user_permissions_principal_idx on public.ll_user_permissions (principal_type, principal_id);
create index if not exists ll_user_permissions_scope_idx on public.ll_user_permissions (scope_type, scope_id);
create index if not exists ll_asset_managers_asset_idx on public.ll_asset_managers (asset_id, asset_code);
create index if not exists ll_asset_managers_manager_idx on public.ll_asset_managers (manager_name, email);
create index if not exists ll_staff_profiles_name_idx on public.ll_staff_profiles (staff_name);
create index if not exists ll_staff_profiles_email_idx on public.ll_staff_profiles (email);
create index if not exists ll_fund_beneficiaries_asset_idx on public.ll_fund_beneficiaries (asset_id, asset_code);
create index if not exists ll_fund_lenders_asset_idx on public.ll_fund_lenders (asset_id, asset_code);
create index if not exists ll_login_history_event_at_idx on public.ll_login_history (event_at desc);
create index if not exists ll_login_history_email_idx on public.ll_login_history (email);
create index if not exists ll_cell_edits_session_idx on public.ll_cell_edits (edit_session_id);
create index if not exists ll_cell_edits_source_cell_idx on public.ll_cell_edits (source_row_uid, column_uid);
create index if not exists ll_cell_edits_target_idx on public.ll_cell_edits (target_table, target_pk, target_column);
create index if not exists ll_payload_snapshots_page_entity_idx on public.ll_payload_snapshots (page, entity_id);
create index if not exists ll_payload_snapshots_generated_at_idx on public.ll_payload_snapshots (generated_at desc);

alter table public.ll_etl_runs enable row level security;
alter table public.ll_funds enable row level security;
alter table public.ll_assets enable row level security;
alter table public.ll_tenants enable row level security;
alter table public.ll_leases enable row level security;
alter table public.ll_lease_spaces enable row level security;
alter table public.ll_rent_history enable row level security;
alter table public.ll_area_breakdowns enable row level security;
alter table public.ll_field_dictionary enable row level security;
alter table public.ll_issues enable row level security;
alter table public.ll_source_sheets enable row level security;
alter table public.ll_source_columns enable row level security;
alter table public.ll_source_rows enable row level security;
alter table public.ll_normalization_links enable row level security;
alter table public.ll_user_permissions enable row level security;
alter table public.ll_asset_managers enable row level security;
alter table public.ll_staff_profiles enable row level security;
alter table public.ll_fund_beneficiaries enable row level security;
alter table public.ll_fund_lenders enable row level security;
alter table public.ll_login_history enable row level security;
alter table public.ll_edit_sessions enable row level security;
alter table public.ll_cell_edits enable row level security;
alter table public.ll_payload_snapshots enable row level security;

commit;

-- Source constraints compatibility fix.
-- Keep source_system restricted to google_sheets, but allow both live Google
-- Sheets source rows and xlsx-source rows in public.ll_* tables.

begin;

create table if not exists public.ll_source_imports (
  import_id text primary key,
  source_system text not null default 'google_sheets',
  source_kind text not null default 'live_google_sheets',
  source_name text not null default 'live_google_sheets',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'prepared',
  row_counts jsonb not null default '{}'::jsonb,
  diff_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_source_cells (
  cell_id text primary key,
  row_id text not null,
  column_id text not null,
  sheet_name text not null,
  row_number integer not null,
  column_index integer not null,
  column_letter text not null,
  a1_ref text not null,
  display_value text,
  raw_value text,
  formula text,
  is_blank boolean not null default false,
  number_format text,
  note text,
  value_type text,
  source_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_source_diffs (
  diff_id text primary key,
  import_id text,
  a1_ref text not null,
  diff_type text not null,
  xlsx_value text,
  sheet_value text,
  xlsx_formula text,
  sheet_formula text,
  chosen_source text not null default 'google_sheets',
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ll_source_imports add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_source_imports add column if not exists source_kind text not null default 'live_google_sheets';
alter table public.ll_source_imports add column if not exists source_name text not null default 'live_google_sheets';
alter table public.ll_source_imports add column if not exists row_counts jsonb not null default '{}'::jsonb;
alter table public.ll_source_imports add column if not exists diff_summary jsonb not null default '{}'::jsonb;
alter table public.ll_source_imports add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.ll_source_imports add column if not exists created_at timestamptz not null default now();
alter table public.ll_source_imports add column if not exists updated_at timestamptz not null default now();

alter table public.ll_source_sheets add column if not exists import_id text;
alter table public.ll_source_sheets add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_source_sheets add column if not exists source_file text;
alter table public.ll_source_sheets add column if not exists header_row integer;
alter table public.ll_source_sheets add column if not exists data_start_row integer;
alter table public.ll_source_sheets add column if not exists source_hash text;
alter table public.ll_source_sheets add column if not exists header_hash text;
alter table public.ll_source_sheets add column if not exists data_hash text;
alter table public.ll_source_sheets add column if not exists source_payload jsonb not null default '{}'::jsonb;

alter table public.ll_source_columns add column if not exists column_uid text;
alter table public.ll_source_columns add column if not exists column_id text;
alter table public.ll_source_columns add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_source_columns add column if not exists sheet_name text;
alter table public.ll_source_columns add column if not exists header_name text not null default '';
alter table public.ll_source_columns add column if not exists header_value text;
alter table public.ll_source_columns add column if not exists value_type_guess text not null default 'text';
alter table public.ll_source_columns add column if not exists is_blank_header boolean not null default false;
alter table public.ll_source_columns add column if not exists sample_values jsonb not null default '[]'::jsonb;
alter table public.ll_source_columns add column if not exists source_ref text;
alter table public.ll_source_columns add column if not exists source_payload jsonb not null default '{}'::jsonb;

alter table public.ll_source_rows add column if not exists row_uid text;
alter table public.ll_source_rows add column if not exists row_id text;
alter table public.ll_source_rows add column if not exists source_system text not null default 'google_sheets';
alter table public.ll_source_rows add column if not exists sheet_name text;
alter table public.ll_source_rows add column if not exists row_index integer;
alter table public.ll_source_rows add column if not exists source_ref text;
alter table public.ll_source_rows add column if not exists source_row_hash text;
alter table public.ll_source_rows add column if not exists row_hash text;
alter table public.ll_source_rows add column if not exists row_values jsonb not null default '[]'::jsonb;
alter table public.ll_source_rows add column if not exists raw_row_payload jsonb not null default '{}'::jsonb;
alter table public.ll_source_rows add column if not exists source_payload jsonb not null default '{}'::jsonb;

alter table public.ll_payload_snapshots add column if not exists user_safe boolean not null default true;
alter table public.ll_payload_snapshots add column if not exists source text not null default 'google_sheets_model_snapshot';
alter table public.ll_payload_snapshots add column if not exists source_system text not null default 'google_sheets';

alter table public.ll_source_imports alter column source_system set default 'google_sheets';
alter table public.ll_source_imports alter column source_kind set default 'live_google_sheets';
alter table public.ll_source_imports alter column source_name set default 'live_google_sheets';
alter table public.ll_source_sheets alter column source_system set default 'google_sheets';
alter table public.ll_source_sheets alter column source_file set default 'live_google_sheets';
alter table public.ll_source_columns alter column source_system set default 'google_sheets';
alter table public.ll_source_rows alter column source_system set default 'google_sheets';
alter table public.ll_normalization_links alter column source_system set default 'google_sheets';
alter table public.ll_payload_snapshots alter column source_system set default 'google_sheets';
alter table public.ll_payload_snapshots alter column source set default 'google_sheets_model_snapshot';

alter table public.ll_source_imports drop constraint if exists ll_source_imports_google_sheets_ck;
alter table public.ll_source_imports add constraint ll_source_imports_google_sheets_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source_name is not null
    and source_name <> ''
    and (
      source_name = 'live_google_sheets'
      or lower(source_name) like '%.xlsx'
      or lower(source_name) like '%.csv'
    )
  ) not valid;

alter table public.ll_source_sheets drop constraint if exists ll_source_sheets_google_sheets_ck;
alter table public.ll_source_sheets add constraint ll_source_sheets_google_sheets_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and sheet_name is not null
    and sheet_name <> ''
    and (
      source_file = 'live_google_sheets'
      or lower(source_file) like '%.xlsx'
      or lower(source_file) like '%.csv'
    )
  ) not valid;

alter table public.ll_source_columns drop constraint if exists ll_source_columns_google_sheets_ck;
alter table public.ll_source_columns add constraint ll_source_columns_google_sheets_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and (sheet_name is null or sheet_name <> '')
  ) not valid;

alter table public.ll_source_rows drop constraint if exists ll_source_rows_google_sheets_ck;
alter table public.ll_source_rows add constraint ll_source_rows_google_sheets_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and (sheet_name is null or sheet_name <> '')
  ) not valid;

alter table public.ll_normalization_links drop constraint if exists ll_normalization_links_google_sheets_ck;
alter table public.ll_normalization_links add constraint ll_normalization_links_google_sheets_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and target_table like 'll_%'
  ) not valid;

alter table public.ll_source_diffs drop constraint if exists ll_source_diffs_chosen_source_ck;
alter table public.ll_source_diffs add constraint ll_source_diffs_chosen_source_ck
  check (chosen_source in ('google_sheets', 'xlsx')) not valid;

alter table public.ll_payload_snapshots drop constraint if exists ll_payload_snapshots_google_sheets_source_ck;
alter table public.ll_payload_snapshots add constraint ll_payload_snapshots_google_sheets_source_ck
  check (
    source_system is not null
    and source_system = 'google_sheets'
    and source is not null
    and source in (
      'supabase_snapshot',
      'google_sheets_model_snapshot',
      'google_sheets_xlsx_snapshot',
      'github_snapshot',
      'hybrid_cache',
      'fallback'
    )
  ) not valid;

drop policy if exists ll_payload_snapshots_user_safe_select on public.ll_payload_snapshots;
create policy ll_payload_snapshots_user_safe_select
  on public.ll_payload_snapshots
  for select
  to anon, authenticated
  using (user_safe = true);

commit;
