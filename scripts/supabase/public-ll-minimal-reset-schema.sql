-- Minimal logistics leasing public.ll_* reset + schema.
-- Scope guard:
--   - This script targets public.ll_* objects only.
--   - No CASCADE is used.
--   - Existing non-ll_* tables must not be mutated.

begin;

drop policy if exists ll_payload_snapshots_user_safe_select on public.ll_payload_snapshots;

drop table if exists public.ll_payload_snapshots;
drop table if exists public.ll_cell_edits;
drop table if exists public.ll_edit_sessions;
drop table if exists public.ll_user_permissions;
drop table if exists public.ll_normalization_links;
drop table if exists public.ll_quality_checks;
drop table if exists public.ll_quality_issues;
drop table if exists public.ll_issues;
drop table if exists public.ll_rent_history;
drop table if exists public.ll_area_breakdowns;
drop table if exists public.ll_lease_spaces;
drop table if exists public.ll_leases;
drop table if exists public.ll_asset_managers;
drop table if exists public.ll_field_dictionary;
drop table if exists public.ll_tenants;
drop table if exists public.ll_asset_areas;
drop table if exists public.ll_asset_floors;
drop table if exists public.ll_building_registers;
drop table if exists public.ll_company_financials;
drop table if exists public.ll_assets;
drop table if exists public.ll_funds;
drop table if exists public.ll_weekly_assets;
drop table if exists public.ll_weekly_projects;
drop table if exists public.ll_weekly_reports;
drop table if exists public.ll_audit_log;
drop table if exists public.ll_etl_runs;
drop table if exists public.ll_source_diffs;
drop table if exists public.ll_source_cells;
drop table if exists public.ll_source_rows;
drop table if exists public.ll_source_columns;
drop table if exists public.ll_source_sheets;
drop table if exists public.ll_source_imports;
drop table if exists public.ll_sheet_rows;
drop table if exists public.ll_import_runs;

create table public.ll_import_runs (
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

create table public.ll_sheet_rows (
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

create table public.ll_assets (
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

create table public.ll_tenants (
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

create table public.ll_leases (
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

create table public.ll_lease_spaces (
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
  current_monthly_rent_total numeric,
  current_monthly_mf_total numeric,
  current_monthly_cost_total numeric,
  e_noc numeric,
  formula_version text,
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

create table public.ll_rent_history (
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

create table public.ll_asset_managers (
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

create table public.ll_issues (
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

create table public.ll_payload_snapshots (
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

create index ll_sheet_rows_import_idx on public.ll_sheet_rows(import_id, sheet_name);
create index ll_assets_code_idx on public.ll_assets(asset_code);
create unique index ll_tenants_business_no_uq
  on public.ll_tenants (business_registration_no)
  where business_registration_no is not null and business_registration_no <> '';
create index ll_leases_asset_idx on public.ll_leases(asset_id);
create index ll_leases_tenant_idx on public.ll_leases(tenant_id);
create index ll_lease_spaces_asset_idx on public.ll_lease_spaces(asset_id);
create index ll_lease_spaces_tenant_idx on public.ll_lease_spaces(tenant_id);
create index ll_rent_history_space_date_idx on public.ll_rent_history(lease_space_id, effective_date desc);
create index ll_payload_snapshots_page_idx on public.ll_payload_snapshots(page, entity_id);

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

create policy ll_payload_snapshots_user_safe_select
  on public.ll_payload_snapshots
  for select
  to anon, authenticated
  using (user_safe = true);

commit;
