-- Align public.ll_* source constraints with the v2 logistics Google Sheets migration.
-- Scope guard: every DDL statement below targets public.ll_* tables only.
-- This prepares both live Google Sheets rows and xlsx-source rows while keeping
-- source_system restricted to google_sheets.

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
