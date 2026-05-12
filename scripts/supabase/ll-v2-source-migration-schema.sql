-- Logistics leasing ll_* v2 migration schema.
-- Scope guard: this file only creates/alters public.ll_* tables.
-- Existing non-ll_* Supabase tables must never be changed by this migration.

begin;

create table if not exists public.ll_source_imports (
  import_id text primary key,
  source_system text not null default 'google_sheets',
  source_kind text not null,
  source_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'prepared',
  row_counts jsonb not null default '{}'::jsonb,
  diff_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_source_imports_google_sheets_ck check (source_system = 'google_sheets')
);

create table if not exists public.ll_source_sheets (
  sheet_id text primary key,
  import_id text,
  source_system text not null default 'google_sheets',
  sheet_name text not null,
  source_file text,
  row_count integer not null default 0,
  column_count integer not null default 0,
  cell_count integer not null default 0,
  header_row integer,
  data_start_row integer,
  source_hash text,
  source_payload jsonb not null default '{}'::jsonb,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_source_sheets_google_sheets_ck check (source_system = 'google_sheets')
);

create table if not exists public.ll_source_columns (
  column_id text primary key,
  sheet_id text not null,
  column_index integer not null,
  column_letter text not null,
  header_value text,
  normalized_header text,
  column_role text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll_source_rows (
  row_id text primary key,
  sheet_id text not null,
  row_number integer not null,
  row_hash text not null,
  non_empty_cell_count integer not null default 0,
  source_payload jsonb not null default '{}'::jsonb,
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
  updated_at timestamptz not null default now(),
  constraint ll_source_diffs_chosen_source_ck check (chosen_source in ('google_sheets', 'xlsx'))
);

create table if not exists public.ll_area_breakdowns (
  area_breakdown_id text primary key,
  lease_space_id text,
  lease_id text,
  asset_id text,
  tenant_id text,
  area_type text not null,
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
  constraint ll_area_breakdowns_google_sheets_ck check (source_system = 'google_sheets')
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

create table if not exists public.ll_field_dictionary (
  field_id text primary key,
  field_no text,
  field_name text not null,
  data_type text,
  unit text,
  is_time_series text,
  sample_value text,
  description text,
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_field_dictionary_google_sheets_ck check (source_system = 'google_sheets')
);

create table if not exists public.ll_quality_checks (
  quality_check_id text primary key,
  check_scope text not null,
  check_type text not null,
  severity text not null default 'info',
  entity_type text,
  entity_id text,
  sheet_name text,
  a1_ref text,
  message text not null,
  status text not null default 'open',
  source_system text not null default 'google_sheets',
  source_table text not null,
  source_pk text not null,
  source_ref text not null,
  source_row_hash text not null,
  source_payload jsonb not null default '{}'::jsonb,
  last_etl_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ll_quality_checks_google_sheets_ck check (source_system = 'google_sheets')
);

create table if not exists public.ll_delete_markers (
  delete_marker_id text primary key,
  target_table text not null,
  target_pk text not null,
  deleted_by text,
  deleted_at timestamptz not null default now(),
  reason text,
  source_system text not null default 'google_sheets',
  source_payload jsonb not null default '{}'::jsonb,
  constraint ll_delete_markers_google_sheets_ck check (source_system = 'google_sheets')
);

alter table public.ll_assets add column if not exists raw_asset_name text;
alter table public.ll_tenants add column if not exists raw_tenant_name text;
alter table public.ll_payload_snapshots add column if not exists user_safe boolean not null default true;
alter table public.ll_source_sheets add column if not exists import_id text;
alter table public.ll_source_sheets add column if not exists header_row integer;
alter table public.ll_source_sheets add column if not exists data_start_row integer;
alter table public.ll_source_sheets add column if not exists source_hash text;
alter table public.ll_source_columns add column if not exists column_id text;
alter table public.ll_source_columns add column if not exists header_value text;
alter table public.ll_source_columns add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table public.ll_source_rows add column if not exists row_id text;
alter table public.ll_source_rows add column if not exists row_hash text;
alter table public.ll_source_rows add column if not exists source_payload jsonb not null default '{}'::jsonb;

create index if not exists ll_source_cells_a1_ref_idx on public.ll_source_cells (a1_ref);
create index if not exists ll_source_cells_row_id_idx on public.ll_source_cells (row_id);
create index if not exists ll_source_diffs_type_idx on public.ll_source_diffs (diff_type);
create index if not exists ll_normalization_links_source_idx on public.ll_normalization_links (source_sheet_name, source_ref);

alter table public.ll_source_imports enable row level security;
alter table public.ll_source_sheets enable row level security;
alter table public.ll_source_columns enable row level security;
alter table public.ll_source_rows enable row level security;
alter table public.ll_source_cells enable row level security;
alter table public.ll_source_diffs enable row level security;
alter table public.ll_area_breakdowns enable row level security;
alter table public.ll_asset_managers enable row level security;
alter table public.ll_field_dictionary enable row level security;
alter table public.ll_quality_checks enable row level security;
alter table public.ll_delete_markers enable row level security;

drop policy if exists ll_payload_snapshots_user_safe_select on public.ll_payload_snapshots;
create policy ll_payload_snapshots_user_safe_select
  on public.ll_payload_snapshots
  for select
  to anon, authenticated
  using (user_safe = true);

commit;
