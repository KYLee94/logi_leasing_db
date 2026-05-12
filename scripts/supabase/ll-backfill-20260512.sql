-- 2026-05-12 ll_* backfill record.
-- This file documents the production SQL shape executed through Supabase MCP.
-- Scope: public.ll_* only. Do not run against non-ll tables.

-- Public snapshot read policy for GitHub Pages frontend.
revoke insert, update, delete, truncate, references, trigger
on public.ll_payload_snapshots
from anon, authenticated;

grant select on public.ll_payload_snapshots to anon, authenticated;

drop policy if exists ll_payload_snapshots_public_safe_select
on public.ll_payload_snapshots;

-- Existing policy kept in production:
-- ll_payload_snapshots_user_safe_select
-- using (user_safe = true)

-- Backfill summary actually executed:
-- 1. ll_source_cells loaded 13,752 xlsx cells from the source workbook.
-- 2. ll_rent_history lease_id/lease_space_id:
--    60 rows linked by unique asset + tenant + effective_date period.
--    24 rows linked by xlsx cell floor/detail to a single lease_space candidate.
-- 3. ll_rent_history exclusive_area_sqm:
--    112 rows filled from source row values.
--    50 additional rows filled from linked ll_lease_spaces.exclusive_area_sqm.
-- 4. Quality findings were upserted into ll_data_quality_findings.

-- Post-backfill readback target:
-- lease_id null = 6 / 163
-- lease_space_id null = 6 / 163
-- exclusive_area_sqm null = 1 / 163
-- match_status null = 0 / 163
-- orphan lease_id = 0
-- orphan lease_space_id = 0

